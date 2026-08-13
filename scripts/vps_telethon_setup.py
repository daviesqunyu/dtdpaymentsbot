#!/usr/bin/env python3
"""
Install Telethon on VPS and request login code for SMS-by-phone.
After CODE_SENT, run: python scripts/vps_telethon_signin.py <CODE> [2FA]
"""

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


def run(ssh: paramiko.SSHClient, cmd: str, timeout: int = 180) -> tuple[int, str, str]:
    _i, out, err = ssh.exec_command(cmd, timeout=timeout)
    stdout = out.read().decode("utf-8", "replace")
    stderr = err.read().decode("utf-8", "replace")
    code = out.channel.recv_exit_status()
    return code, stdout, stderr


def main() -> None:
    load_env()
    host = os.environ.get("VPS_HOST", "185.209.229.34")
    user = os.environ.get("VPS_USER", "root")
    password = os.environ["VPS_PASS"]
    api_id = os.environ.get("TELEGRAM_API_ID", "").strip()
    api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
    phone = os.environ.get("TELETHON_PHONE", "").strip()
    if not phone.startswith("+"):
        phone = f"+{phone}"
    if not api_id or not api_hash or not phone:
        print("Need TELEGRAM_API_ID, TELEGRAM_API_HASH, TELETHON_PHONE", file=sys.stderr)
        sys.exit(1)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(host, username=user, password=password, timeout=40)

    print("[..] create venv + install telethon")
    code, out, err = run(
        ssh,
        """
set -e
mkdir -p /opt/dtd-mailer
cd /opt/dtd-mailer
python3 -m venv venv
./venv/bin/pip install -q -U pip telethon
./venv/bin/python -c 'import telethon; print(telethon.__version__)'
""",
        timeout=300,
    )
    print(out or err)
    if code != 0:
        print(err, file=sys.stderr)
        sys.exit(code)

    # Write request-code helper on VPS
    helper = f'''#!/usr/bin/env python3
import asyncio
from pathlib import Path
from telethon import TelegramClient
from telethon.errors import FloodWaitError, PhoneNumberInvalidError

API_ID = {int(api_id)}
API_HASH = "{api_hash}"
PHONE = "{phone}"
SESSION = "/opt/dtd-mailer/telethon"
HASH_FILE = Path("/opt/dtd-mailer/telethon.phone_code_hash")

async def main():
    client = TelegramClient(SESSION, API_ID, API_HASH)
    await client.connect()
    if await client.is_user_authorized():
        me = await client.get_me()
        print(f"ALREADY_LOGGED_IN @{{getattr(me, 'username', None) or me.id}} id={{me.id}}")
        await client.disconnect()
        return
    try:
        result = await client.send_code_request(PHONE)
        HASH_FILE.write_text(result.phone_code_hash, encoding="utf-8")
        print(f"CODE_SENT to {{PHONE}}")
    except PhoneNumberInvalidError:
        print("INVALID_PHONE")
        raise SystemExit(1)
    except FloodWaitError as e:
        print(f"FLOOD_WAIT {{e.seconds}}")
        raise SystemExit(1)
    finally:
        await client.disconnect()

asyncio.run(main())
'''
    sftp = ssh.open_sftp()
    with sftp.file("/opt/dtd-mailer/telethon_request_code.py", "w") as f:
        f.write(helper)
    sftp.close()

    print("[..] requesting Telegram login code…")
    code, out, err = run(ssh, "/opt/dtd-mailer/venv/bin/python /opt/dtd-mailer/telethon_request_code.py", timeout=120)
    print(out.strip() or err.strip())
    if "ALREADY_LOGGED_IN" in out:
        # Export string session for poller
        export = '''#!/usr/bin/env python3
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession
API_ID = %s
API_HASH = "%s"
async def main():
    client = TelegramClient("/opt/dtd-mailer/telethon", API_ID, API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        print("NOT_AUTHORIZED")
        return
    s = StringSession.save(client.session)
    open("/opt/dtd-mailer/telethon.string","w").write(s)
    me = await client.get_me()
    print(f"SESSION_EXPORTED @{getattr(me,'username',None) or me.id}")
    await client.disconnect()
asyncio.run(main())
''' % (api_id, api_hash)
        sftp = ssh.open_sftp()
        with sftp.file("/opt/dtd-mailer/telethon_export.py", "w") as f:
            f.write(export)
        sftp.close()
        run(ssh, "/opt/dtd-mailer/venv/bin/python /opt/dtd-mailer/telethon_export.py")
        print("[ok] Telethon already logged in; session exported.")
    elif "CODE_SENT" in out:
        print("\n>>> Check Telegram (or SMS) on", phone, "for the login code.")
        print(">>> Then run:  python scripts/vps_telethon_signin.py YOUR_CODE")
        print(">>> If 2FA:    python scripts/vps_telethon_signin.py YOUR_CODE YOUR_2FA_PASSWORD")
    else:
        print(err, file=sys.stderr)
        sys.exit(1)
    ssh.close()


if __name__ == "__main__":
    main()
