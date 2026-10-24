"""
Rename channels + set public username + profile photo.

Useful for the Ebony -> DTD rebrand. Reads targets from env:
  RENAME_CHANNELS="-1004317499796:DTD MAIN STORE:dtdmainstore,-1004435691493:DTD PREMIUM:dtdpremium"
  RENAME_PHOTO=assets/dtd-logo.png
Stop the mirror first if the session is locked, then:
  python scripts/rename_channels.py
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
from telethon.errors import UsernameOccupiedError
from telethon.tl.functions.channels import (
    EditPhotoRequest,
    EditTitleRequest,
    UpdateUsernameRequest,
)
from telethon.tl.types import InputChatUploadedPhoto

API_ID = int(os.getenv("TELEGRAM_API_ID") or "0")
API_HASH = os.getenv("TELEGRAM_API_HASH", "")
SESSION = ROOT / "telethon_sessions" / (os.getenv("TELETHON_SESSION") or "dtd_mirror")

RAW_TARGETS = os.getenv("RENAME_CHANNELS") or (
    "-1004317499796:DTD MAIN STORE:dtdmainstore,"
    "-1004435691493:DTD PREMIUM:dtdpremium"
)
PHOTO = Path(os.getenv("RENAME_PHOTO") or (ROOT / "assets" / "dtd-logo.png"))


def parse_targets(raw: str) -> list[tuple[int, str, str]]:
    out: list[tuple[int, str, str]] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        bits = [b.strip() for b in part.split(":")]
        if len(bits) < 2:
            continue
        chat_id = int(bits[0])
        title = bits[1]
        username = bits[2] if len(bits) > 2 and bits[2] else ""
        out.append((chat_id, title, username))
    return out


async def main() -> None:
    if not API_ID or not API_HASH:
        print("Missing TELEGRAM_API_ID / TELEGRAM_API_HASH")
        sys.exit(1)

    client = TelegramClient(str(SESSION), API_ID, API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        print("Session not authorized. Run telethon_request_code/telethon_sign_in first.")
        sys.exit(1)

    me = await client.get_me()
    print(f"[ok] @{getattr(me, 'username', None) or me.id}")

    photo_file = None
    if PHOTO.exists():
        photo_file = await client.upload_file(str(PHOTO))
        print(f"[ok] photo staged: {PHOTO.name}")
    else:
        print(f"[warn] photo not found: {PHOTO}")

    for chat_id, title, username in parse_targets(RAW_TARGETS):
        try:
            chat = await client.get_entity(chat_id)
            old_title = getattr(chat, "title", chat_id)
            old_username = getattr(chat, "username", None) or ""

            if title and title != old_title:
                await client(EditTitleRequest(channel=chat, title=title))
                print(f"[ok] renamed '{old_title}' -> '{title}'")

            if username:
                if username != old_username:
                    try:
                        await client(UpdateUsernameRequest(channel=chat, username=username))
                        print(f"[ok] username @{username} set on {title}")
                    except UsernameOccupiedError:
                        print(f"[warn] @{username} already taken — not changed")
                    except Exception as exc:  # noqa: BLE001
                        print(f"[warn] username @{username} failed: {exc}")
                else:
                    print(f"[ok] username @{username} already set")

            if photo_file:
                await client(EditPhotoRequest(channel=chat, photo=InputChatUploadedPhoto(file=photo_file)))
                print(f"[ok] photo set on {title}")

            await asyncio.sleep(1.5)
        except Exception as exc:  # noqa: BLE001
            print(f"[error] {chat_id}: {exc}")

    await client.disconnect()
    print("[ok] done")


if __name__ == "__main__":
    asyncio.run(main())
