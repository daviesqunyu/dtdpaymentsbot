"""Migrate dtd-mirror systemd service from root to dvtech."""
from __future__ import annotations

import os
import time
import paramiko

HOST = os.environ["VPS_HOST"]
USER = os.environ["VPS_USER"]
PASSWORD = os.environ["VPS_PASS"]
REMOTE = "/opt/dtd-mirror"
SERVICE = "/etc/systemd/system/dtd-mirror.service"


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 120) -> str:
    print(f"$ {cmd}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.strip()[:3000])
    if code != 0 and err.strip():
        print("ERR:", err.strip()[:1000])
    if code != 0:
        raise RuntimeError(f"command failed ({code}): {cmd}")
    return out


def main() -> None:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)
    print("[ok] connected")

    # Ensure user exists
    run(client, "id dvtech")

    run(client, "systemctl stop dtd-mirror || true")

    # Ownership + private env/session
    run(client, f"chown -R dvtech:dvtech {REMOTE}")
    run(client, f"chmod 750 {REMOTE}")
    run(client, f"chmod 600 {REMOTE}/.env")
    run(client, f"chmod 700 {REMOTE}/telethon_sessions")
    run(client, f"chmod 600 {REMOTE}/telethon_sessions/* || true")

    unit = f"""[Unit]
Description=DTD Telethon Mirror
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=dvtech
Group=dvtech
WorkingDirectory={REMOTE}
Environment=PYTHONIOENCODING=utf-8
Environment=PYTHONUNBUFFERED=1
ExecStart={REMOTE}/venv/bin/python {REMOTE}/scripts/telethon_mirror.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
"""
    sftp = client.open_sftp()
    with sftp.file(SERVICE, "w") as f:
        f.write(unit)
    sftp.close()

    run(client, "systemctl daemon-reload")
    run(client, "systemctl enable dtd-mirror")
    run(client, "systemctl restart dtd-mirror")
    time.sleep(8)
    run(client, "systemctl is-active dtd-mirror")
    run(client, "systemctl --no-pager --full status dtd-mirror | head -n 25")
    run(client, "journalctl -u dtd-mirror -n 20 --no-pager")
    run(client, "ps -o user,pid,cmd -C python | grep telethon_mirror || true")

    client.close()
    print("[ok] migrated to dvtech")


if __name__ == "__main__":
    main()
