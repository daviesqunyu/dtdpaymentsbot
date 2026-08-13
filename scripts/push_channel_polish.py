"""
One-shot channel polish: better bios + How-to-Order promo to your owned chats.
Stop the mirror first if session is locked, then:
  python scripts/push_channel_polish.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from telethon import TelegramClient
from telethon.tl.functions.messages import EditChatAboutRequest

API_ID = int(os.getenv("TELEGRAM_API_ID") or "0")
API_HASH = os.getenv("TELEGRAM_API_HASH", "")
SESSION = ROOT / "telethon_sessions" / (os.getenv("TELETHON_SESSION") or "dtd_mirror")
STORE = (os.getenv("STORE_URL") or "https://dtdpaymentsbot.pages.dev").rstrip("/")
COMPANY = (os.getenv("COMPANY_URL") or "https://dvtechnologies.xyz").rstrip("/")
OWNER = (os.getenv("TELEGRAM_OWNER_USERNAME") or "Glock7money").lstrip("@")
SUPPORT_EMAIL = (os.getenv("SUPPORT_EMAIL") or "contact@dvtechnologies.xyz").strip().lower()
CHANNEL = (os.getenv("TELEGRAM_CHANNEL_USERNAME") or "").lstrip("@")
BOT = (os.getenv("TELEGRAM_BOT_USERNAME") or "DTDSTOREBOT").lstrip("@")
HOWTO = ROOT / "assets" / "dtd-howto-banner.png"

ABOUT = (
    f"DTD MAIN STORE — powered internationally by DV Technologies.\n"
    f"🛒 {STORE}\n"
    f"🌐 {COMPANY}\n"
    f"📧 {SUPPORT_EMAIL}\n"
    f"🤖 @{BOT} · 👤 @{OWNER}"
)[:255]

HOWTO_CAPTION = (
    "👑 HOW TO ORDER — DTD MAIN STORE\n"
    "━━━━━━━━━━━━━━━━━━━━\n"
    "1️⃣ Open the store / Mini App\n"
    f"{STORE}\n"
    f"or Telegram bot @{BOT} → /buy\n\n"
    "2️⃣ Add products → Checkout\n"
    "💎 Preferred: USDT on Tron (TRC20)\n"
    "also ₿ Bitcoin · 💳 Paystack (global card / bank)\n\n"
    "3️⃣ Crypto: scan QR → paste tx hash\n"
    "4️⃣ Send delivery email → get product\n"
    f"Bot @{BOT} · Support @{OWNER}\n"
    f"📧 {SUPPORT_EMAIL}\n"
    "━━━━━━━━━━━━━━━━━━━━\n"
    f"🌐 Company (international): {COMPANY}\n"
    f"📢 Channel: https://t.me/{CHANNEL}\n"
    "✨ Join · Shop · Stay updated"
)

TARGETS = [
    os.getenv("TELEGRAM_CHANNEL_ID", "-1004311503458"),
    os.getenv("TELEGRAM_BACKUP_CHANNEL_ID", ""),
    os.getenv("TELEGRAM_GROUP_ID", ""),
]


async def main() -> None:
    if not API_ID or not API_HASH:
        print("Missing TELEGRAM_API_ID / TELEGRAM_API_HASH")
        sys.exit(1)

    client = TelegramClient(str(SESSION), API_ID, API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        print("Session not authorized. Run telethon_sign_in first.")
        sys.exit(1)

    me = await client.get_me()
    print(f"[ok] @{me.username}")

    for raw in TARGETS:
        if not raw:
            continue
        try:
            chat = await client.get_entity(int(raw))
            title = getattr(chat, "title", raw)
            try:
                await client(EditChatAboutRequest(peer=chat, about=ABOUT))
                print(f"[ok] about updated: {title}")
            except Exception as exc:  # noqa: BLE001
                print(f"[warn] about skip {title}: {exc}")

            if HOWTO.exists():
                await client.send_file(chat, file=str(HOWTO), caption=HOWTO_CAPTION)
            else:
                await client.send_message(chat, HOWTO_CAPTION)
            print(f"[ok] how-to posted: {title}")
            await asyncio.sleep(1.5)
        except Exception as exc:  # noqa: BLE001
            print(f"[error] {raw}: {exc}")

    await client.disconnect()
    print("[ok] done")


if __name__ == "__main__":
    asyncio.run(main())

