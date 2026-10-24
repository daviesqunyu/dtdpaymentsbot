"""List all dialogs the account can see, so the user can pick promo targets."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from telethon import TelegramClient
from telethon.tl.types import Channel, Chat, User

from telethon_mirror import API_ID, API_HASH, SESSION_PATH


async def main() -> None:
    client = TelegramClient(str(SESSION_PATH), API_ID, API_HASH)
    await client.start()
    me = await client.get_me()
    print(f"@{getattr(me, 'username', None) or me.id}", flush=True)

    rows = []
    async for dialog in client.iter_dialogs():
        e = dialog.entity
        if isinstance(e, Channel):
            kind = "channel" if not e.megagroup else "group(mega)"
            username = getattr(e, "username", None) or ""
            uname = f"@{username}" if username else ""
            rows.append((kind, e.id, dialog.title or "", uname))
        elif isinstance(e, Chat):
            username = getattr(e, "username", None) or ""
            uname = f"@{username}" if username else ""
            rows.append(("group", e.id, dialog.title or "", uname))
        elif isinstance(e, User):
            username = getattr(e, "username", None) or ""
            uname = f"@{username}" if username else ""
            rows.append(("user", e.id, getattr(e, "first_name", "") or "", uname))

    rows.sort(key=lambda r: r[0])
    for kind, cid, title, uname in rows:
        print(f"{kind:12s} {cid:16d} {title[:40]:40s} {uname}", flush=True)
    print(f"\nTOTAL: {len(rows)}", flush=True)

    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
