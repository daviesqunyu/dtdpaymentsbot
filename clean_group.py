import asyncio, os, sys
sys.path.insert(0, "/opt/dtd-mirror/venv/lib/python3.12/site-packages")
from telethon import TelegramClient
from telethon.tl.functions.channels import EditPhotoRequest
from telethon.tl.types import InputChatUploadedPhoto

api_id = int(os.environ.get("TELEGRAM_API_ID") or "35323803")
api_hash = os.environ.get("TELEGRAM_API_HASH") or "3a4481cccf87a314e449f142829ee78f"
session_path = "/opt/dtd-mirror/telethon_sessions/dtd_mirror"
GROUP_ID = -1004318041006

async def main():
    client = TelegramClient(session_path, api_id, api_hash)
    await client.start()
    print("[ok] Client started")

    chat = await client.get_entity(GROUP_ID)
    print(f"[ok] Group: {chat.title}")

    # 1. Create a clean group photo using Pillow
    print("[..] Creating group photo...")
    try:
        from PIL import Image, ImageDraw, ImageFont
        W = H = 512
        img = Image.new("RGB", (W, H), (15, 15, 30))
        dr = ImageDraw.Draw(img)
        # Gradient background
        for y in range(H):
            t = y / H
            r = int(15 + (40 - 15) * t)
            g = int(15 + (20 - 15) * t)
            b = int(30 + (80 - 30) * t)
            dr.line([(0, y), (W, y)], fill=(r, g, b))
        # Gold accent circle
        accent = (255, 209, 84)
        cx, cy, rad = W // 2, H // 2 - 30, 160
        for i in range(rad, 0, -3):
            a = int(180 * (rad - i) / rad)
            dr.ellipse((cx - i, cy - i, cx + i, cy + i), outline=(*accent, a), width=2)
        # Dollar sign
        try:
            font_big = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 120)
            font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
            font_xs = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
        except Exception:
            font_big = ImageFont.load_default()
            font_sm = font_big
            font_xs = font_big
        dr.text((W // 2, H // 2 - 50), "$", fill=accent, font=font_big, anchor="mm")
        dr.text((W // 2, H // 2 + 70), "GMONEY STORE", fill=(255, 255, 255), font=font_sm, anchor="mm")
        dr.text((W // 2, H // 2 + 105), "Premium Products \u00B7 Verified Vendors", fill=(160, 160, 180), font=font_xs, anchor="mm")
        photo_path = "/tmp/gmoney_store_photo.jpg"
        img.save(photo_path, "JPEG", quality=95)
        print("[ok] Photo created")
    except Exception as e:
        print(f"[error] Photo creation failed: {e}")
        photo_path = None

    # 2. Upload new photo
    if photo_path and os.path.exists(photo_path):
        try:
            await client(EditPhotoRequest(chat, InputChatUploadedPhoto(
                await client.upload_file(photo_path)
            )))
            print("[ok] Group photo updated!")
        except Exception as e:
            print(f"[error] Photo upload failed: {e}")

    # 3. Delete ALL messages (clean slate)
    print("[..] Deleting all messages...")
    deleted = 0
    try:
        async for msg in client.iter_messages(chat, limit=None):
            try:
                await msg.delete()
                deleted += 1
                if deleted % 50 == 0:
                    print(f"    deleted {deleted} messages...")
            except Exception:
                pass  # skip pinned or protected messages
        print(f"[ok] Deleted {deleted} messages")
    except Exception as e:
        print(f"[error] Bulk delete failed: {e}")

    # 4. Re-pin the welcome message
    print("[..] Re-pinning welcome...")
    try:
        from telethon.tl.functions.messages import UpdatePinnedMessageRequest
        msg = await client.send_message(
            chat,
            '<b>\U0001F4B5 Welcome to GMONEY STORE!</b>\n\n'
            '\U0001F525 <b>Premium Products</b> \u2014 Verified Vendors\n'
            '\u26A1 <b>Real Reviews</b> \u2014 Instant Deals\n\n'
            '\U0001F48E <a href="https://dtdpaymentsbot.pages.dev">DTD Store</a>\n'
            '\U0001F4E2 <a href="https://t.me/+ysMSObZyNWpjNTA0">Main Channel</a>\n'
            '\u2B50 <a href="https://t.me/+ZYBP2Qrr-JgyYTQ0">Premium Channel</a>\n'
            '\U0001F916 <a href="https://t.me/DTDSTOREBOT">@DTDSTOREBOT</a>\n\n'
            '\u2705 Verified by DV Technologies\n'
            '\U0001F516 <b>Rules:</b> No scams \u00B7 Respect vendors \u00B7 Use bot for purchases',
            parse_mode="html",
            link_preview=False,
        )
        await client(UpdatePinnedMessageRequest(chat, msg.id))
        print("[ok] Welcome re-pinned!")
    except Exception as e:
        print(f"[error] Pin failed: {e}")

    await client.disconnect()
    print("\n[done] Group cleaned!")

asyncio.run(main())
