"""One-shot: deploy Telethon mirror to VPS over SSH (paramiko)."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
HOST = os.environ.get("VPS_HOST", "185.209.229.34")
USER = os.environ.get("VPS_USER", "root")
PASSWORD = os.environ.get("VPS_PASS", "")
REMOTE = "/opt/dtd-mirror"

UPLOADS = [
    "scripts/telethon_mirror.py",
    "requirements-telethon.txt",
    ".env",
    "assets/dtd-promo-banner.png",
    "assets/dtd-howto-banner.png",
]

SESSION_FILES = [
    "telethon_sessions/dtd_mirror.session",
]


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 180) -> tuple[int, str, str]:
    print(f"$ {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.strip()[:2000])
    if err.strip() and code != 0:
        print(err.strip()[:1000])
    return code, out, err


def sftp_put(sftp: paramiko.SFTPClient, local: Path, remote: str) -> None:
    remote_dir = "/".join(remote.split("/")[:-1])
    # ensure remote dir
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for part in parts:
        cur += "/" + part
        try:
            sftp.stat(cur)
        except OSError:
            sftp.mkdir(cur)
    print(f"upload {local} -> {remote}")
    sftp.put(str(local), remote)


def main() -> None:
    if not PASSWORD:
        print("Set VPS_PASS env var")
        sys.exit(1)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting {USER}@{HOST} ...")
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30, look_for_keys=False, allow_agent=False)
    print("[ok] connected")

    run(client, "apt-get update -y")
    run(
        client,
        "DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-pip python3-venv",
        timeout=300,
    )
    run(client, f"mkdir -p {REMOTE}/scripts {REMOTE}/telethon_sessions {REMOTE}/assets")

    sftp = client.open_sftp()
    for rel in UPLOADS:
        local = ROOT / rel
        if local.exists():
            sftp_put(sftp, local, f"{REMOTE}/{rel}")
        else:
            print(f"[warn] missing {rel}")

    for rel in SESSION_FILES:
        local = ROOT / rel
        if local.exists():
            sftp_put(sftp, local, f"{REMOTE}/{rel}")
        else:
            print(f"[warn] missing session {rel} — first login may be required")
    # journal companion if present
    journal = ROOT / "telethon_sessions" / "dtd_mirror.session-journal"
    if journal.exists():
        sftp_put(sftp, journal, f"{REMOTE}/telethon_sessions/dtd_mirror.session-journal")
    sftp.close()

    run(client, f"python3 -m venv {REMOTE}/venv")
    run(client, f"{REMOTE}/venv/bin/pip install -U pip")
    run(client, f"{REMOTE}/venv/bin/pip install -r {REMOTE}/requirements-telethon.txt", timeout=300)

    unit = f"""[Unit]
Description=DTD Telethon Mirror
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={REMOTE}
Environment=PYTHONIOENCODING=utf-8
Environment=PYTHONUNBUFFERED=1
ExecStart={REMOTE}/venv/bin/python {REMOTE}/scripts/telethon_mirror.py
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
"""
    # write unit via sftp
    sftp = client.open_sftp()
    with sftp.file("/etc/systemd/system/dtd-mirror.service", "w") as f:
        f.write(unit)
    sftp.close()

    run(client, "systemctl daemon-reload")
    run(client, "systemctl enable dtd-mirror.service")
    run(client, "systemctl restart dtd-mirror.service")
    time.sleep(4)
    run(client, "systemctl --no-pager --full status dtd-mirror.service | head -n 30")
    run(client, "journalctl -u dtd-mirror.service -n 40 --no-pager")

    client.close()
    print("[ok] VPS mirror deployed")


if __name__ == "__main__":
    main()
