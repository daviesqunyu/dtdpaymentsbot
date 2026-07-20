"""Step 1: request Telegram login code for Telethon session."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.errors import FloodWaitError, PhoneNumberInvalidError

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

API_ID = int(os.getenv("TELEGRAM_API_ID") or "0")
API_HASH = (os.getenv("TELEGRAM_API_HASH") or "").strip()
SESSION = (os.getenv("TELETHON_SESSION") or "dtd_mirror").strip()
PHONE = (os.getenv("TELETHON_PHONE") or "").strip()
SESSION_PATH = ROOT / "telethon_sessions" / SESSION


async def main() -> None:
    if not API_ID or not API_HASH or not PHONE:
        print("Missing TELEGRAM_API_ID / TELEGRAM_API_HASH / TELETHON_PHONE")
        sys.exit(1)
    if not PHONE.startswith("+"):
        phone = "+" + PHONE
    else:
        phone = PHONE

    SESSION_PATH.parent.mkdir(parents=True, exist_ok=True)
    client = TelegramClient(str(SESSION_PATH), API_ID, API_HASH)
    await client.connect()

    if await client.is_user_authorized():
        me = await client.get_me()
        print(f"ALREADY_LOGGED_IN @{getattr(me, 'username', None) or me.id}")
        await client.disconnect()
        return

    try:
        result = await client.send_code_request(phone)
        phone_code_hash = result.phone_code_hash
        hash_file = SESSION_PATH.parent / f"{SESSION}.phone_code_hash"
        hash_file.write_text(phone_code_hash, encoding="utf-8")
        print(f"CODE_SENT to {phone}")
        print("Check Telegram (or SMS) for the login code, then reply with the code.")
    except PhoneNumberInvalidError:
        print("INVALID_PHONE")
        sys.exit(1)
    except FloodWaitError as exc:
        print(f"FLOOD_WAIT {exc.seconds} seconds")
        sys.exit(1)
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
