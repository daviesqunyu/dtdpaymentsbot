#!/usr/bin/env python3
"""
Deploy the earning engine to the VPS: upload earn_poller.py + ai_agent.py,
create their systemd services (running as dvtech), and patch /opt/dtd-mirror/.env
with any wallet/config keys present in the local .env.

Usage:
  python scripts/deploy_earn_vps.py
"""
from __future__ import annotations

import io
import os
import stat
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]

UPLOAD = [
    (ROOT / "scripts" / "earn_poller.py", "/opt/dtd-mirror/scripts/earn_poller.py"),
    (ROOT / "scripts" / "ai_agent.py", "/opt/dtd-mirror/scripts/ai_agent.py"),
]

ENV_KEYS = [
    "TON_PAYMENT_ADDRESS",
    "TON_ADDRESS",
    "USDT_TRC20_ADDRESS",
    "TON_PRICE_USD",
    "STARS_PER_USD",
    "AGENT_CHANNELS",
    "AGENT_DEAL_INTERVAL_HOURS",
    "AGENT_PROMO_INTERVAL_HOURS",
    "AGENT_PNL_HOUR",
]

POLLER_UNIT = """[Unit]
Description=DTD earn poller (TON + TRC20 auto-confirm)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=dvtech
Group=dvtech
WorkingDirectory=/opt/dtd-mirror
ExecStart=/opt/dtd-mirror/venv/bin/python /opt/dtd-mirror/scripts/earn_poller.py
Restart=always
RestartSec=10
EnvironmentFile=/opt/dtd-mirror/.env

[Install]
WantedBy=multi-user.target
"""

AGENT_UNIT = """[Unit]
Description=DTD self-promo & self-earn AI agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=dvtech
Group=dvtech
WorkingDirectory=/opt/dtd-mirror
ExecStart=/opt/dtd-mirror/venv/bin/python /opt/dtd-mirror/scripts/ai_agent.py
Restart=always
RestartSec=15
EnvironmentFile=/opt/dtd-mirror/.env

[Install]
WantedBy=multi-user.target
"""


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


def put_bytes(sftp, remote: str, data: bytes) -> None:
    with sftp.open(remote, "wb") as fh:
        fh.write(data)
    sftp.chmod(remote, stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)


def run(ssh, command: str) -> str:
    stdin, stdout, stderr = ssh.exec_command(command, timeout=120)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    if out.strip():
        print(out.strip())
    if err.strip():
        print(err.strip(), file=sys.stderr)
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

    print("[..] upload scripts")
    for src, dst in UPLOAD:
        put_bytes(sftp, dst, src.read_bytes())
        print(f"  uploaded {dst}")

    print("[..] ensure scripts dir owned by dvtech")
    run(ssh, "chown -R dvtech:dvtech /opt/dtd-mirror/scripts")

    print("[..] patch /opt/dtd-mirror/.env")
    env_path = "/opt/dtd-mirror/.env"
    try:
        with sftp.open(env_path, "r") as fh:
            current = fh.read().decode("utf-8", "replace")
    except FileNotFoundError:
        current = ""
    lines = [ln.rstrip("\n") for ln in current.splitlines()]
    keys_in_file = {ln.split("=", 1)[0].strip() for ln in lines if "=" in ln and not ln.strip().startswith("#")}
    added = []
    for key in ENV_KEYS:
        val = local.get(key, "")
        if not val:
            continue
        if key in keys_in_file:
            for i, ln in enumerate(lines):
                if ln.split("=", 1)[0].strip() == key:
                    lines[i] = f"{key}={val}"
                    break
        else:
            lines.append(f"{key}={val}")
        added.append(key)
    new_env = "\n".join(lines) + ("\n" if lines else "")
    with sftp.open(env_path, "w") as fh:
        fh.write(new_env.encode("utf-8"))
    print(f"  wrote {len(added)} keys: {', '.join(added)}" if added else "  no keys to add")
    run(ssh, "chown dvtech:dvtech /opt/dtd-mirror/.env && chmod 600 /opt/dtd-mirror/.env")

    print("[..] write systemd units")
    for name, unit in (("dtd-earn-poller", POLLER_UNIT), ("dtd-ai-agent", AGENT_UNIT)):
        put_bytes(sftp, f"/etc/systemd/system/{name}.service", unit.encode("utf-8"))

    print("[..] start services")
    run(ssh, "systemctl daemon-reload")
    run(ssh, "systemctl enable dtd-earn-poller dtd-ai-agent")
    run(ssh, "systemctl restart dtd-earn-poller dtd-ai-agent")

    print("[..] status")
    print(run(ssh, "systemctl is-active dtd-earn-poller dtd-ai-agent").strip())

    print("[..] recent logs")
    print(run(ssh, "journalctl -u dtd-earn-poller -n 8 --no-pager").strip())
    print(run(ssh, "journalctl -u dtd-ai-agent -n 8 --no-pager").strip())

    sftp.close()
    ssh.close()
    print("[ok] earn deploy done")


if __name__ == "__main__":
    main()
