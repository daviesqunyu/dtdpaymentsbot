import paramiko, time

HOST = "185.209.229.34"
USER = "root"
PASS = "6CxmbBGm0sLL3EPIl"

def run():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=22, username=USER, password=PASS, timeout=15)
    print("Connected!")

    # 1. Stop
    ssh.exec_command("systemctl stop dtd-mirror 2>/dev/null; pkill -f telethon_mirror.py || true")
    time.sleep(3)

    sftp = ssh.open_sftp()

    # 2. Upload fixed mirror code
    sftp.put(r"C:\Users\davie\dtdpaymentsbot\scripts\telethon_mirror.py",
             "/opt/dtd-mirror/scripts/telethon_mirror.py")
    print("[ok] mirror code uploaded")

    # 3. Upload promo banners
    import os
    assets = r"C:\Users\davie\dtdpaymentsbot\assets"
    remote_assets = "/opt/dtd-mirror/assets"
    ssh.exec_command(f"mkdir -p {remote_assets}")
    time.sleep(1)
    for f in os.listdir(assets):
        if f.startswith("promo-banner-") and f.endswith(".jpg"):
            local = os.path.join(assets, f)
            sftp.put(local, f"{remote_assets}/{f}")
    print("[ok] promo banners uploaded")

    # 4. Update .env with correct schedules
    stdin, stdout, stderr = ssh.exec_command("cat /opt/dtd-mirror/.env")
    env_content = stdout.read().decode("utf-8", errors="replace")
    
    lines = env_content.split("\n")
    new_lines = []
    replacements = {
        "MIRROR_PROMO_GAP_MIN": "30",
        "MIRROR_PROMO_GAP_MAX": "60",
        "MIRROR_PRODUCT_PROMO_INTERVAL_HOURS": "0.42",
        "MIRROR_PROMO_CHATS": "-1004317499796,-1004318041006",
        "MIRROR_PRODUCT_PROMO_CHATS": "-1004317499796,-1004435691493",
        "MIRROR_PRODUCT_PROMO_ON_START": "true",
        "GMONEY_GROUP_ID": "-1004318041006",
        "MIRROR_PROMO_ONE_PER_CYCLE": "true",
        "MIRROR_PROMO_IMAGE_CHANCE": "0.7",
    }
    seen_keys = set()
    for line in lines:
        stripped = line.strip()
        key = stripped.split("=")[0].strip() if "=" in stripped else ""
        seen_keys.add(key)
        if key in replacements:
            new_lines.append(f"{key}={replacements[key]}")
            del replacements[key]
        else:
            new_lines.append(line)
    for key, val in replacements.items():
        if key not in seen_keys:
            new_lines.append(f"{key}={val}")
    
    with sftp.open("/opt/dtd-mirror/.env", "w") as f:
        f.write("\n".join(new_lines))
    sftp.close()
    print("[ok] .env updated")

    # 5. Clear caches + old product images
    ssh.exec_command("find /opt/dtd-mirror -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true")
    ssh.exec_command("rm -f /opt/dtd-mirror/telethon_sessions/product_promo_state.json 2>/dev/null || true")
    print("[ok] caches cleared")

    # 6. Create systemd service
    service = """[Unit]
Description=DTD Mirror Bot (24/7)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/dtd-mirror
ExecStart=/opt/dtd-mirror/venv/bin/python scripts/telethon_mirror.py
Restart=always
RestartSec=10
Environment=PYTHONUNBUFFERED=1
StandardOutput=append:/var/log/dtd_mirror.log
StandardError=append:/var/log/dtd_mirror.log

[Install]
WantedBy=multi-user.target
"""
    sftp = ssh.open_sftp()
    with sftp.open("/etc/systemd/system/dtd-mirror.service", "w") as f:
        f.write(service)
    sftp.close()
    print("[ok] systemd service written")

    # 7. Enable and start
    cmds = [
        "systemctl daemon-reload",
        "systemctl enable dtd-mirror",
        "systemctl start dtd-mirror",
        "sleep 10",
    ]
    for cmd in cmds:
        ssh.exec_command(cmd)
        time.sleep(2)

    # 8. Verify
    stdin, stdout, stderr = ssh.exec_command("systemctl is-active dtd-mirror")
    active = stdout.read().decode("utf-8", errors="replace").strip()
    stdin, stdout, stderr = ssh.exec_command("ps aux | grep telethon | grep -v grep | head -1")
    proc = stdout.read().decode("utf-8", errors="replace").strip()
    stdin, stdout, stderr = ssh.exec_command("tail -20 /var/log/dtd_mirror.log")
    log_out = stdout.read().decode("utf-8", errors="replace").strip()
    
    with open("mirror_status.txt", "w", encoding="utf-8") as f:
        f.write(f"Service: {active}\nProcess: {proc}\n\n=== Latest log ===\n{log_out}\n")
    
    ssh.close()
    print(f"Service: {active}")
    print(f"Latest log:\n{log_out}")

if __name__ == "__main__":
    run()
