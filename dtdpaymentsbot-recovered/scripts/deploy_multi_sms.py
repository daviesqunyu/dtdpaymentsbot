#!/usr/bin/env python3
"""Deploy multi-channel SMS worker + set SMS_BACKEND=multi on VPS."""

from __future__ import annotations

import os
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]


def load_env() -> None:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main() -> None:
    load_env()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(
        os.environ.get("VPS_HOST", "185.209.229.34"),
        username=os.environ.get("VPS_USER", "root"),
        password=os.environ["VPS_PASS"],
        timeout=40,
    )
    sftp = ssh.open_sftp()
    sftp.put(str(ROOT / "scripts" / "vps_sms_send.py"), "/opt/dtd-mailer/vps_sms_send.py")
    sftp.put(str(ROOT / "scripts" / "smtp_job_poller.py"), "/opt/dtd-mailer/smtp_job_poller.py")
    sftp.close()

    # Patch poller.env: SMS_BACKEND=multi + optional WhatsApp keys from local .env
    wa_token = (
        os.environ.get("WHATSAPP_TOKEN") or os.environ.get("WHATSAPP_ACCESS_TOKEN") or ""
    ).strip()
    wa_phone = (
        os.environ.get("WHATSAPP_PHONE_NUMBER_ID") or os.environ.get("WHATSAPP_PHONE_ID") or ""
    ).strip()
    sms_url = os.environ.get("SMS_GATEWAY_URL", "").strip()
    sms_user = os.environ.get("SMS_GATEWAY_USER", "").strip()
    sms_pass = (os.environ.get("SMS_GATEWAY_PASS") or os.environ.get("SMS_GATEWAY_TOKEN") or "").strip()

    cmd = f"""
set -e
ENV=/opt/dtd-mailer/poller.env
grep -q '^SMS_BACKEND=' "$ENV" && sed -i 's|^SMS_BACKEND=.*|SMS_BACKEND=multi|' "$ENV" || echo 'SMS_BACKEND=multi' >> "$ENV"
# refresh gateway lines
sed -i '/^SMS_GATEWAY_URL=/d;/^SMS_GATEWAY_USER=/d;/^SMS_GATEWAY_PASS=/d;/^WHATSAPP_TOKEN=/d;/^WHATSAPP_PHONE_NUMBER_ID=/d' "$ENV"
echo 'SMS_GATEWAY_URL={sms_url}' >> "$ENV"
echo 'SMS_GATEWAY_USER={sms_user}' >> "$ENV"
echo 'SMS_GATEWAY_PASS={sms_pass}' >> "$ENV"
echo 'WHATSAPP_TOKEN={wa_token}' >> "$ENV"
echo 'WHATSAPP_PHONE_NUMBER_ID={wa_phone}' >> "$ENV"
systemctl restart dtd-smtp-poller
systemctl is-active dtd-smtp-poller
grep '^SMS_BACKEND=' "$ENV"
# show configured channels (lengths only)
python3 - <<'PY'
from pathlib import Path
env={{}}
for line in Path('/opt/dtd-mailer/poller.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1); env[k]=v
print('telegram_session', Path('/opt/dtd-mailer/telethon.string').exists())
print('sms_gateway_len', len(env.get('SMS_GATEWAY_URL','')))
print('whatsapp_token_len', len(env.get('WHATSAPP_TOKEN','')))
print('whatsapp_phone_id_len', len(env.get('WHATSAPP_PHONE_NUMBER_ID','')))
PY
"""
    _i, out, err = ssh.exec_command(cmd, timeout=60)
    print(out.read().decode())
    e = err.read().decode()
    if e.strip():
        print(e[:400])
    ssh.close()
    print("[ok] multi-channel worker deployed (telegram + sms + whatsapp when configured)")


if __name__ == "__main__":
    main()
