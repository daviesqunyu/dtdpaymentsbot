#!/usr/bin/env python3
"""Deploy Binance proxy to VPS and open port 8788."""
from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]


def load_env():
    env = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.strip().startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
        os.environ.setdefault(k.strip(), env[k.strip()])
    return env


def main():
    env = load_env()
    secret = env["VPS_MAILER_SECRET"]
    host = env.get("VPS_HOST", "185.209.229.34")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(host, username=env.get("VPS_USER", "root"), password=env["VPS_PASS"], timeout=40)
    sftp = c.open_sftp()
    sftp.put(str(ROOT / "scripts" / "vps_binance_proxy.py"), "/opt/dtd-mailer/vps_binance_proxy.py")
    sftp.close()

    unit = f"""[Unit]
Description=DTD Binance API proxy
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/dtd-mailer
Environment=VPS_MAILER_SECRET={secret}
Environment=BINANCE_PROXY_BIND=0.0.0.0
Environment=BINANCE_PROXY_PORT=8788
ExecStart=/opt/dtd-mailer/venv/bin/python /opt/dtd-mailer/vps_binance_proxy.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
"""
    # write unit via sftp
    with sftp_reopen(c) as sftp2:
        with sftp2.file("/etc/systemd/system/dtd-binance-proxy.service", "w") as fh:
            fh.write(unit)

    cmd = """
set -e
ufw allow 8788/tcp || true
systemctl daemon-reload
systemctl enable --now dtd-binance-proxy
systemctl restart dtd-binance-proxy
systemctl is-active dtd-binance-proxy
"""
    _i, out, err = c.exec_command(cmd, timeout=60)
    print(out.read().decode())
    e = err.read().decode()
    if e.strip():
        print(e[:400])
    c.close()

    # probe from outside
    body = json.dumps(
        {"method": "GET", "path": "/api/v3/ticker/price", "params": {"symbol": "BTCUSDT"}, "secret": secret}
    ).encode()
    req = urllib.request.Request(
        f"http://{host}:8788/binance",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "X-Mailer-Secret": secret},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        print("external", resp.read()[:200].decode())


def sftp_reopen(client):
    return client.open_sftp()


if __name__ == "__main__":
    main()
