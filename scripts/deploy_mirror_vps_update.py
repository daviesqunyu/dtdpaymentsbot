#!/usr/bin/env python3
"""
Update the running DTD Telethon mirror on the VPS with the new product-promo /
story / chat-mirror code and assets, then restart the service as dvtech.

* uploads scripts/telethon_mirror.py + assets/promo-*.jpg
* ensures Pillow in the venv
* patches /opt/dtd-mirror/.env with MIRROR_* + wallet keys (never wipes)
* chowns everything to dvtech and restarts dtd-mirror.service

Usage:
  python scripts/deploy_mirror_vps_update.py
"""
from __future__ import annotations

import io
import os
import stat
import sys
import time
from pathlib import Path

import paramiko

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parents[1]

MIRROR_KEYS = {
    "MIRROR_PRODUCT_PROMO_ENABLED": "true",
    "MIRROR_PRODUCT_PROMO_CHATS": "-1004317499796,-1004435691493",
    "MIRROR_PRODUCT_PROMO_INTERVAL_HOURS": "1.25",
    "MIRROR_PRODUCT_PROMO_ON_START": "true",
    "MIRROR_STORY_ENABLED": "true",
    "MIRROR_STORY_CHATS": "-1004317499796,-1004435691493",
    "MIRROR_STORY_HOUR": "9",
    "MIRROR_CHAT_MIRROR_ENABLED": "true",
    "MIRROR_CHAT_MIRROR_CHANNELS": "-1004317499796,-1004435691493",
    "MIRROR_CHAT_MIRROR_INTERVAL": "120",
    "MIRROR_PRODUCT_AI_IMAGES": "true",
    "MIRROR_PRODUCT_AI_BUDGET": "20",
}

LOCAL_ENV_KEYS = [
    "TON_PAYMENT_ADDRESS",
    "TON_ADDRESS",
    "USDT_TRC20_ADDRESS",
    "TON_PRICE_USD",
    "STARS_PER_USD",
    "TELEGRAM_CHANNEL_LINK",
    "TELEGRAM_PREMIUM_LINK",
]


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            values[k.strip()] = v.strip().strip('"').strip("'")
    return values


def run(ssh, command: str, timeout: int = 300) -> str:
    print(f"$ {command}")
    stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    if out.strip():
        print(out.strip()[:2500])
    if err.strip():
        print(err.strip()[:1200], file=sys.stderr)
    return out


def main() -> None:
    local = load_env()
    host = local.get("VPS_HOST", "185.209.229.34")
    user = local.get("VPS_USER", "root")
    password = local.get("VPS_PASS", "")
    if not password:
        print("VPS_PASS missing in .env", file=sys.stderr)
        sys.exit(1)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"[..] connect {user}@{host}")
    ssh.connect(host, username=user, password=password, timeout=40)
    sftp = ssh.open_sftp()

    remote = "/opt/dtd-mirror"

    print("[..] upload mirror script")
    with sftp.open(f"{remote}/scripts/telethon_mirror.py", "wb") as fh:
        fh.write((ROOT / "scripts" / "telethon_mirror.py").read_bytes())

    print("[..] upload promo banners")
    try:
        sftp.stat(f"{remote}/assets")
    except FileNotFoundError:
        sftp.mkdir(f"{remote}/assets")
    for banner in sorted((ROOT / "assets").glob("promo-*.jpg")):
        with sftp.open(f"{remote}/assets/{banner.name}", "wb") as fh:
            fh.write(banner.read_bytes())
        print(f"  {banner.name}")

    print("[..] ensure Pillow in venv")
    run(ssh, f"{remote}/venv/bin/pip install -q Pillow")

    print("[..] patch /opt/dtd-mirror/.env")
    try:
        with sftp.open(f"{remote}/.env", "r") as fh:
            current = fh.read().decode("utf-8", "replace")
    except FileNotFoundError:
        current = ""
    lines = [ln.rstrip("\n") for ln in current.splitlines()]
    keys_in_file = {ln.split("=", 1)[0].strip() for ln in lines if "=" in ln and not ln.strip().startswith("#")}
    patch = dict(MIRROR_KEYS)
    for key in LOCAL_ENV_KEYS:
        if local.get(key):
            patch[key] = local[key]
    for key, value in patch.items():
        if key in keys_in_file:
            for i, ln in enumerate(lines):
                if ln.split("=", 1)[0].strip() == key:
                    lines[i] = f"{key}={value}"
                    break
        else:
            lines.append(f"{key}={value}")
    with sftp.open(f"{remote}/.env", "w") as fh:
        fh.write(("\n".join(lines) + "\n").encode("utf-8"))
    print(f"  patched {len(patch)} keys: {', '.join(sorted(patch))}")

    print("[..] fix ownership (dvtech)")
    run(ssh, f"chown -R dvtech:dvtech {remote} && chmod 600 {remote}/.env")

    print("[..] restart mirror")
    run(ssh, "systemctl daemon-reload")
    run(ssh, "systemctl restart dtd-mirror.service")
    time.sleep(6)
    print(run(ssh, "systemctl is-active dtd-mirror.service").strip())
    print("[..] journalctl")
    print(run(ssh, "journalctl -u dtd-mirror.service -n 30 --no-pager").strip())

    sftp.close()
    ssh.close()
    print("[ok] mirror update deployed")


if __name__ == "__main__":
    main()
