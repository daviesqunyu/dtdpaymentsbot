#!/usr/bin/env python3
"""Deploy/update VPS mailer + SMS poller (Postfix path + SMS worker)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]


def load_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def run(ssh: paramiko.SSHClient, cmd: str, timeout: int = 120) -> str:
    _i, out, err = ssh.exec_command(cmd, timeout=timeout)
    stdout = out.read().decode("utf-8", "replace")
    stderr = err.read().decode("utf-8", "replace")
    code = out.channel.recv_exit_status()
    if code != 0:
        raise RuntimeError(f"cmd failed ({code}): {cmd}\n{stderr or stdout}")
    return stdout


def sftp_put(ssh: paramiko.SSHClient, local: Path, remote: str) -> None:
    sftp = ssh.open_sftp()
    try:
        sftp.put(str(local), remote)
    finally:
        sftp.close()


def main() -> None:
    load_env()
    host = os.environ.get("VPS_HOST", "185.209.229.34")
    user = os.environ.get("VPS_USER", "root")
    password = os.environ.get("VPS_PASS")
    if not password:
        print("VPS_PASS missing", file=sys.stderr)
        sys.exit(1)

    secret = os.environ.get("VPS_MAILER_SECRET", "").strip()
    sb_url = os.environ.get("SUPABASE_URL", "").strip()
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    bot = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    admin = os.environ.get("TELEGRAM_ADMIN_CHAT_ID", "").strip()
    mail_from = os.environ.get("MAIL_FROM", "contact@dvtechnologies.xyz")
    mail_domain = os.environ.get("MAIL_DOMAIN", "dvtechnologies.xyz").strip()
    vps_mail_mode = os.environ.get("VPS_MAIL_MODE", "aws_ses").strip()
    smtp_host = os.environ.get("SMTP_HOST", os.environ.get("AWS_SES_SMTP_HOST", "")).strip()
    smtp_user = os.environ.get("SMTP_USERNAME", os.environ.get("AWS_SES_SMTP_USERNAME", "")).strip()
    smtp_pass = os.environ.get("SMTP_PASSWORD", os.environ.get("AWS_SES_SMTP_PASSWORD", "")).strip()
    sms_url = os.environ.get("SMS_GATEWAY_URL", "").strip()
    sms_user = os.environ.get("SMS_GATEWAY_USER", "").strip()
    sms_pass = (os.environ.get("SMS_GATEWAY_PASS") or os.environ.get("SMS_GATEWAY_TOKEN") or "").strip()
    api_id = os.environ.get("TELEGRAM_API_ID", "").strip()
    api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
    session = os.environ.get("TELETHON_SESSION", "").strip()

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"[..] connect {user}@{host}")
    ssh.connect(host, username=user, password=password, timeout=40)

    run(ssh, "mkdir -p /opt/dtd-mailer")
    for name in ("vps_mailer.py", "smtp_job_poller.py", "vps_sms_send.py"):
        sftp_put(ssh, ROOT / "scripts" / name, f"/opt/dtd-mailer/{name}")
        print(f"[ok] uploaded {name}")

    # poller.env holds the SES transport creds + smtp/sms settings.
    env_lines = [
        f"VPS_MAILER_SECRET={secret}",
        f"LOCAL_MAILER_URL=http://127.0.0.1:8787",
        f"SUPABASE_URL={sb_url}",
        f"SUPABASE_SERVICE_ROLE_KEY={sb_key}",
        f"MAIL_FROM={mail_from}",
        f"MAIL_DOMAIN={mail_domain}",
        f"VPS_MAIL_MODE={vps_mail_mode}",
        f"SMTP_HOST={smtp_host}",
        f"SMTP_USERNAME={smtp_user}",
        f"SMTP_PASSWORD={smtp_pass}",
        f"SMTP_POLL_SECONDS=2",
        f"TELEGRAM_BOT_TOKEN={bot}",
        f"TELEGRAM_ADMIN_CHAT_ID={admin}",
        f"SMS_BACKEND=auto",
        f"SMS_GATEWAY_URL={sms_url}",
        f"SMS_GATEWAY_USER={sms_user}",
        f"SMS_GATEWAY_PASS={sms_pass}",
        f"TELEGRAM_API_ID={api_id}",
        f"TELEGRAM_API_HASH={api_hash}",
    ]
    if session and len(session) < 500 and not session.startswith("1"):
        # path only; long string session goes to file below
        env_lines.append(f"TELETHON_SESSION={session}")
    else:
        env_lines.append("TELETHON_SESSION=/opt/dtd-mailer/telethon.session")

    env_body = "\n".join(env_lines) + "\n"
    sftp = ssh.open_sftp()
    with sftp.file("/opt/dtd-mailer/poller.env", "w") as f:
        f.write(env_body)
    if session and len(session) > 20 and ("/" not in session[:3] or session.startswith("1")):
        # StringSession: write for Telethon StringSession usage later if needed
        with sftp.file("/opt/dtd-mailer/telethon.string", "w") as f:
            f.write(session)
    sftp.close()

    unit = """[Unit]
Description=DTD SMTP/SMS job poller (Supabase → Postfix / SMS)
After=network-online.target dtd-vps-mailer.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/dtd-mailer
EnvironmentFile=/opt/dtd-mailer/poller.env
ExecStart=/usr/bin/python3 /opt/dtd-mailer/smtp_job_poller.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
"""
    sftp = ssh.open_sftp()
    with sftp.file("/etc/systemd/system/dtd-smtp-poller.service", "w") as f:
        f.write(unit)
    sftp.close()

    # Mailer must read SES transport creds from poller.env (EnvironmentFile) so
    # VPS_MAIL_MODE=aws_ses is honored as the primary relay instead of Postfix.
    mailer_unit = """[Unit]
Description=DTD VPS mailer API
After=network.target postfix.service opendkim.service

[Service]
Type=simple
EnvironmentFile=/opt/dtd-mailer/poller.env
Environment=VPS_MAILER_SECRET=%s
Environment=BIND_HOST=127.0.0.1
Environment=BIND_PORT=8787
WorkingDirectory=/opt/dtd-mailer
ExecStart=/usr/bin/python3 /opt/dtd-mailer/vps_mailer.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
""" % secret
    sftp = ssh.open_sftp()
    try:
        with sftp.file("/etc/systemd/system/dtd-vps-mailer.service", "w") as f:
            f.write(mailer_unit)
    finally:
        sftp.close()

    run(ssh, "chmod 600 /opt/dtd-mailer/poller.env; chmod 755 /opt/dtd-mailer/*.py")
    run(ssh, "pip3 install -q telethon 2>/dev/null || pip install -q telethon 2>/dev/null || true")
    run(ssh, "systemctl daemon-reload")
    run(ssh, "systemctl enable --now dtd-vps-mailer dtd-smtp-poller postfix 2>/dev/null || systemctl restart dtd-smtp-poller dtd-vps-mailer")
    # Restart BOTH services so the mailer picks up the SES env and the poller reconnects.
    run(ssh, "systemctl restart dtd-smtp-poller dtd-vps-mailer")
    status = run(ssh, "systemctl is-active dtd-smtp-poller dtd-vps-mailer postfix; curl -sS http://127.0.0.1:8787/health || true")
    print(status)
    print("[ok] VPS poller updated (email + SMS).")
    print("DNS still required for Gmail: SPF must include ip4:185.209.229.34 — see docs/smtp-sms-setup.md")
    ssh.close()


if __name__ == "__main__":
    main()
