#!/usr/bin/env python3
"""
Sync selected keys from local .env → VPS /opt/dtd-mailer/poller.env
and restart the mail/SMS poller + mailer.

Usage:
  python scripts/sync_env_vps.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]

# Keys the VPS mailer / SMS / Telethon worker needs
SYNC_KEYS = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VPS_MAILER_SECRET",
    "VPS_MAIL_MODE",
    "SMTP_HOST",
    "SMTP_USERNAME",
    "SMTP_PASSWORD",
    "MAIL_FROM",
    "MAIL_DOMAIN",
    "SUPPORT_EMAIL",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_ADMIN_CHAT_ID",
    "TELEGRAM_API_ID",
    "TELEGRAM_API_HASH",
    "TELETHON_PHONE",
    "TELETHON_SESSION",
    "SMS_BACKEND",
    "SMS_GATEWAY_URL",
    "SMS_GATEWAY_USER",
    "SMS_GATEWAY_PASS",
    "SMS_GATEWAY_TOKEN",
    "WHATSAPP_TOKEN",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_PHONE_ID",
]


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    path = ROOT / ".env"
    if not path.exists():
        print("Missing .env", file=sys.stderr)
        sys.exit(1)
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip().strip('"').strip("'")
    return values


def main() -> None:
    local = load_env()
    host = local.get("VPS_HOST", "185.209.229.34")
    user = local.get("VPS_USER", "root")
    password = local.get("VPS_PASS", "")
    if not password:
        print("VPS_PASS missing in .env", file=sys.stderr)
        sys.exit(1)

    # Build poller.env content
    lines = [
        "LOCAL_MAILER_URL=http://127.0.0.1:8787",
        "SMTP_POLL_SECONDS=2",
        f"SMS_BACKEND={local.get('SMS_BACKEND') or 'multi'}",
        "TELETHON_SESSION=/opt/dtd-mailer/telethon",
    ]
    for key in SYNC_KEYS:
        if key == "TELETHON_SESSION":
            continue  # keep VPS path above
        val = local.get(key, "")
        if val:
            lines.append(f"{key}={val}")

    body = "\n".join(lines) + "\n"

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"[..] connect {user}@{host}")
    ssh.connect(host, username=user, password=password, timeout=40)

    ssh.exec_command("mkdir -p /opt/dtd-mailer")[1].channel.recv_exit_status()
    sftp = ssh.open_sftp()
    with sftp.file("/opt/dtd-mailer/poller.env", "w") as f:
        f.write(body)
    sftp.chmod("/opt/dtd-mailer/poller.env", 0o600)
    sftp.close()

    _i, out, err = ssh.exec_command(
        "systemctl daemon-reload; "
        "systemctl restart dtd-vps-mailer dtd-smtp-poller 2>/dev/null; "
        "systemctl is-active dtd-vps-mailer dtd-smtp-poller; "
        "wc -l /opt/dtd-mailer/poller.env",
        timeout=60,
    )
    print(out.read().decode("utf-8", "replace"))
    e = err.read().decode("utf-8", "replace")
    if e.strip():
        print(e[:400], file=sys.stderr)
    ssh.close()
    print("[ok] VPS /opt/dtd-mailer/poller.env updated from local .env")


if __name__ == "__main__":
    main()
