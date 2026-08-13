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

    run(client, f"chown -R root:root {REMOTE}")

    # Force sane mirror behaviour (avoid restart spam / old-post dumps)
    overrides = {
        "MIRROR_CATCH_UP": "0",
        "MIRROR_PROMO_ON_START": "false",
        "MIRROR_DELAY_MIN": "2",
        "MIRROR_DELAY_MAX": "8",
        "MIRROR_PROMO_INTERVAL_HOURS": "12",
        "MIRROR_ENGLISH_ONLY": "false",
    }
    for key, value in overrides.items():
        run(
            client,
            (
                f"grep -q '^{key}=' {REMOTE}/.env "
                f"&& sed -i 's|^{key}=.*|{key}={value}|' {REMOTE}/.env "
                f"|| echo '{key}={value}' >> {REMOTE}/.env"
            ),
        )
    # Destinations must stay on owned store channels only
    run(
        client,
        (
            f"grep -q '^MIRROR_DEST_CHANNEL=' {REMOTE}/.env "
            f"&& sed -i 's|^MIRROR_DEST_CHANNEL=.*|MIRROR_DEST_CHANNEL=-1004311503458,|' {REMOTE}/.env "
            f"|| echo 'MIRROR_DEST_CHANNEL=-1004311503458,' >> {REMOTE}/.env"
        ),
    )
    # Keep only known-good job/news sources (never deploy carding/spam ID dumps)
    run(
        client,
        (
            f"grep -q '^MIRROR_SOURCE_CHANNELS=' {REMOTE}/.env "
            f"&& sed -i 's|^MIRROR_SOURCE_CHANNELS=.*|MIRROR_SOURCE_CHANNELS=-1001641308540,-1001454374209|' {REMOTE}/.env "
            f"|| echo 'MIRROR_SOURCE_CHANNELS=-1001641308540,-1001454374209' >> {REMOTE}/.env"
        ),
    )

    run(client, "systemctl daemon-reload")
    run(client, "systemctl enable dtd-mirror.service")
    run(client, "systemctl restart dtd-mirror.service")
    time.sleep(4)
    run(client, "systemctl --no-pager --full status dtd-mirror.service | head -n 30")
    run(client, "journalctl -u dtd-mirror.service -n 40 --no-pager")
    run(
        client,
        f"grep -E '^(MIRROR_SOURCE_CHANNELS|MIRROR_DEST_CHANNEL|MIRROR_CATCH_UP|MIRROR_PROMO_ON_START|MIRROR_DELAY_)=' {REMOTE}/.env",
    )

    client.close()
    print("[ok] VPS mirror deployed")


if __name__ == "__main__":
    main()
