import asyncio
import os, sys
sys.path.insert(0, "/opt/dtd-mirror/venv/lib/python3.12/site-packages")
from telethon import TelegramClient
from telethon.tl.functions.channels import EditBannedRequest, EditAdminRequest, EditTitleRequest
from telethon.tl.functions.messages import EditChatAboutRequest
from telethon.tl.types import ChatBannedRights, ChatAdminRights

api_id = int(os.environ.get("TELEGRAM_API_ID") or "35323803")
api_hash = os.environ.get("TELEGRAM_API_HASH") or "3a4481cccf87a314e449f142829ee78f"
session_path = "/opt/dtd-mirror/telethon_sessions/dtd_mirror"

GROUP_ID = -1004318041006
NEW_TITLE = "GMONEY STORE\U0001F4B5"
NEW_DESCRIPTION = (
    "\U0001F525 Premium Products | Verified Vendors\n"
    "\u26A1 Real Reviews | Instant Deals\n"
    "\n"
    "\U0001F48E Store: dtdpaymentsbot.pages.dev\n"
    "\U0001F4E2 Main: t.me/+ysMSObZyNWpjNTA0\n"
    "\u2B50 Premium: t.me/+ZYBP2Qrr-JgyYTQ0\n"
    "\U0001F916 @DTDSTOREBOT\n"
    "DV Technologies \u00B7 dtdpaymentsbot.pages.dev"
)

VENDORS = [
    (7663030842, "B1yteBandit"),
    (572441506, "Oxy1Monster"),
]

async def main():
    client = TelegramClient(session_path, api_id, api_hash)
    await client.start()
    print("[setup] Client started")

    # Get group entity
    try:
        chat = await client.get_entity(GROUP_ID)
        print(f"[ok] Found group: {chat.title} (id={chat.id})")
    except Exception as e:
        print(f"[error] Could not find group: {e}")
        await client.disconnect()
        return

    # 1. Rename group
    try:
        await client(EditTitleRequest(chat, NEW_TITLE))
        print(f"[ok] Renamed to: {NEW_TITLE}")
    except Exception as e:
        print(f"[error] Rename failed: {e}")

    # 2. Set description
    try:
        await client(EditChatAboutRequest(chat, NEW_DESCRIPTION))
        print("[ok] Description set")
    except Exception as e:
        print(f"[error] Description failed: {e}")

    # 3. Set permissions (members can send messages but not spam)
    try:
        await client(EditBannedRequest(
            chat,
            "channel",
            ChatBannedRights(
                until_date=None,
                view_messages=False,
                send_messages=True,
                send_media=True,
                send_stickers=True,
                send_gifs=True,
                send_inline=False,
                embed_links=False,
                send_polls=True,
                change_info=False,
                invite_users=True,
                pin_messages=False,
                manage_topics=False,
            )
        ))
        print("[ok] Permissions set (default member rights)")
    except Exception as e:
        print(f"[warn] Default permissions: {e}")

    # 4. Promote vendors to admin
    for user_id, username in VENDORS:
        try:
            user_entity = await client.get_entity(user_id)
            await client(EditAdminRequest(
                chat,
                user_entity,
                ChatAdminRights(
                    change_info=False,
                    delete_messages=True,
                    invite_users=True,
                    pin_messages=True,
                    manage_call=True,
                    ban_users=True,
                    post_messages=True,
                    edit_messages=True,
                    add_admins=False,
                ),
                rank="Vendor"
            ))
            print(f"[ok] @{username} promoted to admin")
        except Exception as e:
            print(f"[error] Could not promote @{username}: {e}")

    # 5. Promote the old bot @DTDSTOREBOT to admin
    try:
        bot_entity = await client.get_entity(8689676260)
        await client(EditAdminRequest(
            chat,
            bot_entity,
            ChatAdminRights(
                change_info=True,
                delete_messages=True,
                invite_users=True,
                pin_messages=True,
                manage_call=True,
                ban_users=True,
                post_messages=True,
                edit_messages=True,
                add_admins=False,
            ),
            rank="Bot"
        ))
        print("[ok] @DTDSTOREBOT promoted to admin")
    except Exception as e:
        print(f"[warn] Could not promote bot: {e}")

    # 6. Pin a welcome message
    try:
        from telethon.tl.functions.messages import PinMessageRequest
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
        await client(PinMessageRequest(chat, msg.id, silent=False))
        print("[ok] Welcome message pinned")
    except Exception as e:
        print(f"[error] Pin failed: {e}")

    await client.disconnect()
    print("\n[done] Group setup complete!")

asyncio.run(main())
