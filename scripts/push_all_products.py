"""One-off: push + advertise every active product to the DTD MAIN STORE channel."""
import asyncio
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from telethon import TelegramClient

from telethon_mirror import (
    API_ID,
    API_HASH,
    SESSION_PATH,
    _fetch_products,
    _product_caption,
    _product_image_url,
)

TARGET = -1004317499796  # DTD MAIN STORE
GAP = (90, 180)  # seconds between posts (anti-spam)


async def main() -> None:
    client = TelegramClient(str(SESSION_PATH), API_ID, API_HASH)
    await client.start()
    me = await client.get_me()
    print(f"[ok] connected as @{getattr(me, 'username', None) or me.id}")

    chat = await client.get_entity(TARGET)
    title = getattr(chat, "title", None) or TARGET
    print(f"[ok] target: {title} ({TARGET})")

    products = await asyncio.to_thread(_fetch_products)
    print(f"[ok] {len(products)} active products found")

    if not products:
        print("[warn] nothing to post")
        await client.disconnect()
        return

    for i, p in enumerate(products, 1):
        caption = _product_caption(p)
        image = _product_image_url(p)
        name = str(p.get("name") or "?")
        try:
            if image:
                await client.send_file(
                    chat,
                    file=image,
                    caption=caption,
                    parse_mode="html",
                    force_document=False,
                    link_preview=False,
                )
                print(f"[ok] {i}/{len(products)} {name} (with image)")
            else:
                await client.send_message(chat, caption, parse_mode="html", link_preview=False)
                print(f"[ok] {i}/{len(products)} {name} (text only)")
        except Exception as exc:  # noqa: BLE001
            print(f"[error] {i}/{len(products)} {name}: {exc}")

        if i < len(products):
            await asyncio.sleep(random.uniform(*GAP))

    await client.disconnect()
    print("[done] all products posted")


if __name__ == "__main__":
    asyncio.run(main())
