"""Step 2: complete Telethon login with the code from Telegram."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

API_ID = int(os.getenv("TELEGRAM_API_ID") or "0")
API_HASH = (os.getenv("TELEGRAM_API_HASH") or "").strip()
SESSION = (os.getenv("TELETHON_SESSION") or "dtd_mirror").strip()
PHONE = (os.getenv("TELETHON_PHONE") or "").strip()
SESSION_PATH = ROOT / "telethon_sessions" / SESSION


async def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python scripts/telethon_sign_in.py <CODE> [2FA_PASSWORD]")
        sys.exit(1)

    code = sys.argv[1].strip()
    password = sys.argv[2].strip() if len(sys.argv) > 2 else ""
    phone = PHONE if PHONE.startswith("+") else f"+{PHONE}"

    hash_file = SESSION_PATH.parent / f"{SESSION}.phone_code_hash"
    if not hash_file.exists():
        print("Missing phone_code_hash. Run telethon_request_code.py first.")
        sys.exit(1)
    phone_code_hash = hash_file.read_text(encoding="utf-8").strip()

    client = TelegramClient(str(SESSION_PATH), API_ID, API_HASH)
    await client.connect()
    try:
        try:
            await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
        except SessionPasswordNeededError:
            if not password:
                print("2FA_REQUIRED")
                sys.exit(2)
            await client.sign_in(password=password)

        me = await client.get_me()
        print(f"LOGIN_OK @{getattr(me, 'username', None) or me.id} id={me.id}")
        hash_file.unlink(missing_ok=True)
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
