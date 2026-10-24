import paramiko, time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('185.209.229.34', port=22, username='root', password='6CxmbBGm0sLL3EPIl', timeout=15)

# Kill mirror
ssh.exec_command("pkill -f telethon_mirror.py || true")
time.sleep(3)

# Check promo images on VPS
cmds = [
    "ls -la /opt/dtd-mirror/assets/promo-*.jpg 2>/dev/null",
    "file /opt/dtd-mirror/assets/promo-*.jpg 2>/dev/null",
    "ls -la /opt/dtd-mirror/assets/product-promo/ 2>/dev/null || echo 'no product-promo dir'",
]
with open('image_check.txt', 'w', encoding='utf-8') as f:
    for cmd in cmds:
        stdin, stdout, stderr = ssh.exec_command(cmd)
        f.write(f"--- {cmd[:50]} ---\n")
        f.write(stdout.read().decode('utf-8', errors='replace'))
        f.write("\n")
        f.write(stderr.read().decode('utf-8', errors='replace'))
        f.write("\n\n")

# Delete corrupt promo images so fresh ones get generated
ssh.exec_command("rm -f /opt/dtd-mirror/assets/promo-*.jpg /opt/dtd-mirror/assets/promo-*.png 2>/dev/null")
ssh.exec_command("rm -rf /opt/dtd-mirror/assets/product-promo/ 2>/dev/null")

# Also delete from state files
ssh.exec_command("rm -f /opt/dtd-mirror/assets/promo_state.json /opt/dtd-mirror/assets/product_state.json 2>/dev/null")

ssh.close()
print("Done")
