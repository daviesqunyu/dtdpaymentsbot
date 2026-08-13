#!/usr/bin/env python3
"""Complete Telethon login on VPS after code is received. Usage: python scripts/vps_telethon_signin.py CODE [2FA]"""

from __future__ import annotations

import os
import sys
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
    if len(sys.argv) < 2:
        print("Usage: python scripts/vps_telethon_signin.py <CODE> [2FA_PASSWORD]")
        sys.exit(1)
    code = sys.argv[1].strip()
    password = sys.argv[2].strip() if len(sys.argv) > 2 else ""

    load_env()
    api_id = os.environ.get("TELEGRAM_API_ID", "").strip()
    api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
    phone = os.environ.get("TELETHON_PHONE", "").strip()
    if not phone.startswith("+"):
        phone = f"+{phone}"

    signin = f'''#!/usr/bin/env python3
import asyncio
from pathlib import Path
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError
from telethon.sessions import StringSession

API_ID = {int(api_id)}
API_HASH = "{api_hash}"
PHONE = "{phone}"
CODE = "{code}"
PASSWORD = """{password}"""
SESSION = "/opt/dtd-mailer/telethon"
HASH_FILE = Path("/opt/dtd-mailer/telethon.phone_code_hash")

async def main():
    if not HASH_FILE.exists():
        print("MISSING_HASH — run vps_telethon_setup.py first")
        raise SystemExit(1)
    phone_code_hash = HASH_FILE.read_text(encoding="utf-8").strip()
    client = TelegramClient(SESSION, API_ID, API_HASH)
    await client.connect()
    try:
        try:
            await client.sign_in(phone=PHONE, code=CODE, phone_code_hash=phone_code_hash)
        except SessionPasswordNeededError:
            if not PASSWORD:
                print("2FA_REQUIRED")
                raise SystemExit(2)
            await client.sign_in(password=PASSWORD)
        me = await client.get_me()
        s = StringSession.save(client.session)
        Path("/opt/dtd-mailer/telethon.string").write_text(s, encoding="utf-8")
        HASH_FILE.unlink(missing_ok=True)
        print(f"LOGIN_OK @{{getattr(me, 'username', None) or me.id}} id={{me.id}}")
        print("SESSION_EXPORTED")
    finally:
        await client.disconnect()

asyncio.run(main())
'''

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(
        os.environ.get("VPS_HOST", "185.209.229.34"),
        username=os.environ.get("VPS_USER", "root"),
        password=os.environ["VPS_PASS"],
        timeout=40,
    )
    sftp = ssh.open_sftp()
    with sftp.file("/opt/dtd-mailer/telethon_signin.py", "w") as f:
        f.write(signin)
    sftp.close()

    _i, out, err = ssh.exec_command(
        "/opt/dtd-mailer/venv/bin/python /opt/dtd-mailer/telethon_signin.py", timeout=120
    )
    stdout = out.read().decode("utf-8", "replace")
    stderr = err.read().decode("utf-8", "replace")
    print(stdout.strip() or stderr.strip())
    code_exit = out.channel.recv_exit_status()
    if code_exit != 0:
        ssh.close()
        sys.exit(code_exit)

    # Point poller at venv python + telethon.string; restart
    patch = r"""
set -e
# Ensure poller uses venv python (has telethon)
sed -i 's|^ExecStart=.*|ExecStart=/opt/dtd-mailer/venv/bin/python /opt/dtd-mailer/smtp_job_poller.py|' /etc/systemd/system/dtd-smtp-poller.service
grep -q TELETHON_SESSION= /opt/dtd-mailer/poller.env || echo 'TELETHON_SESSION=/opt/dtd-mailer/telethon' >> /opt/dtd-mailer/poller.env
# Prefer string session file (vps_sms_send reads telethon.string)
systemctl daemon-reload
systemctl restart dtd-smtp-poller
systemctl is-active dtd-smtp-poller
test -f /opt/dtd-mailer/telethon.string && echo STRING_OK || echo STRING_MISSING
"""
    _i, out, err = ssh.exec_command(patch, timeout=60)
    print(out.read().decode("utf-8", "replace"))
    ssh.close()
    print("[ok] Telethon ready for SMS-by-phone on VPS.")


if __name__ == "__main__":
    main()
