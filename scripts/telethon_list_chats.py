"""List channels/groups your Telethon account can see (easy ID lookup)."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.tl.types import Channel, Chat

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

API_ID = int(os.getenv("TELEGRAM_API_ID") or "0")
API_HASH = (os.getenv("TELEGRAM_API_HASH") or "").strip()
SESSION = (os.getenv("TELETHON_SESSION") or "dtd_mirror").strip()
SESSION_PATH = ROOT / "telethon_sessions" / SESSION


async def main() -> None:
    client = TelegramClient(str(SESSION_PATH), API_ID, API_HASH)
    await client.start()
    print("Your channels / groups (join them first, then re-run):\n")
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        if isinstance(entity, Channel):
            kind = "channel" if entity.broadcast else "group"
            username = f"@{entity.username}" if entity.username else "(no username)"
            # Telethon internal id → bot API style -100…
            api_id = f"-100{entity.id}"
            print(f"{kind:8} | {api_id:18} | {username:24} | {dialog.name}")
        elif isinstance(entity, Chat):
            print(f"{'chat':8} | {str(-entity.id):18} | {'(basic group)':24} | {dialog.name}")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
