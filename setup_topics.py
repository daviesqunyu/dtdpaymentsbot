import asyncio, os, sys
sys.path.insert(0, "/opt/dtd-mirror/venv/lib/python3.12/site-packages")
from telethon import TelegramClient
from telethon.tl.functions.channels import (
    CreateForumTopicRequest, DeleteTopicsRequest,
    EditAdminRequest, GetParticipantRequest
)
from telethon.tl.types import ChatAdminRights, InputForumTopic

api_id = int(os.environ.get("TELEGRAM_API_ID") or "35323803")
api_hash = os.environ.get("TELEGRAM_API_HASH") or "3a4481cccf87a314e449f142829ee78f")
session_path = "/opt/dtd-mirror/telethon_sessions/dtd_mirror"
GROUP_ID = -1004318041006

OLD_TOPICS = [1685, 1686, 1687, 1688]

NEW_TOPICS = [
    ("🔥 Deals & Drops", 0x6FB340),
    ("📦 Product Catalog", 0x5C6BC0),
    ("💎 Premium Lounge", 0xE53935),
    ("🤖 Bot Orders", 0x7C4DFF),
    ("💬 Community", 0x00897B),
]

VENDORS = [
    (7663030842, "B1yteBandit"),
    (572441506, "Oxy1Monster"),
]
BOT_ID = 8689676260

async def main():
    client = TelegramClient(session_path, api_id, api_hash)
    await client.start()
    print("[ok] Client started")

    chat = await client.get_entity(GROUP_ID)
    print(f"[ok] Group: {chat.title}")

    # 1. Delete old topics
    for tid in OLD_TOPICS:
        try:
            await client(DeleteTopicsRequest(chat, [tid]))
            print(f"[ok] Deleted old topic {tid}")
        except Exception as e:
            print(f"[warn] Delete topic {tid}: {e}")

    # 2. Create new topics
    topic_ids = {}
    for name, color in NEW_TOPICS:
        try:
            result = await client(CreateForumTopicRequest(chat, title=name, icon_color=color))
            tid = None
            for update in result.updates:
                if hasattr(update, 'message'):
                    tid = update.message.id
                    break
            if tid is None:
                for update in result.updates:
                    if hasattr(update, 'id'):
                        tid = update.id
                        break
            topic_ids[name] = tid
            print(f"[ok] Created '{name}' (id={tid})")
        except Exception as e:
            print(f"[error] Create '{name}': {e}")

    # 3. Post intro messages
    intros = {
        "🔥 Deals & Drops": (
            '<b>🔥 Deals & Drops</b>\n\n'
            'Hot deals mirror from our verified vendor network.\n'
            'Premium emoji • AI-crafted descriptions • Instant buy links\n\n'
            'Every post is reviewed before it drops. Tap the bot below to buy.'
        ),
        "📦 Product Catalog": (
            '<b>📦 Product Catalog</b>\n\n'
            'Scheduled product posts with images, pricing, and details.\n'
            'Updated regularly with the latest stock.\n\n'
            'Product images • Full descriptions • Direct purchase'
        ),
        "💎 Premium Lounge": (
            '<b>💎 Premium Lounge</b>\n\n'
            'Exclusive drops from DTD PREMIUM.\n'
            'Members-only pricing and early access.\n\n'
            '<a href="https://t.me/+ZYBP2Qrr-JgyYTQ0">Join Premium</a>'
        ),
        "🤖 Bot Orders": (
            '<b>🤖 Bot Orders</b>\n\n'
            'Track your orders, make payments, and manage purchases.\n'
            'All transactions go through @DTDSTOREBOT.\n\n'
            'Send /buy to start • Send /order to track'
        ),
        "💬 Community": (
            '<b>💬 Community</b>\n\n'
            'Vibes, questions, and direct access to vendors.\n'
            'Verified vendors only — no scammers.\n\n'
            'Rules: No scam links • Respect vendors • Have fun'
        ),
    }
    for name, text in intros.items():
        tid = topic_ids.get(name)
        if tid:
            try:
                await client.send_message(chat, text, parse_mode="html", link_preview=False, reply_to=tid)
                print(f"[ok] Intro posted to {name}")
            except Exception as e:
                print(f"[warn] Intro {name}: {e}")

    # 4. Try promoting bot + vendors
    for uid, name in [(BOT_ID, "DTDSTOREBOT")] + VENDORS:
        try:
            user = await client.get_entity(uid)
            rights = ChatAdminRights(
                change_info=True, delete_messages=True, invite_users=True,
                pin_messages=True, manage_call=True, ban_users=True,
                post_messages=True, edit_messages=True, add_admins=False,
            )
            await client(EditAdminRequest(chat, user, rights, rank="Admin"))
            print(f"[ok] Promoted @{name}")
        except Exception as e:
            print(f"[warn] Promote @{name}: {e}")

    # Print IDs for config
    print(f"\n=== TOPIC IDS ===")
    for name, tid in topic_ids.items():
        if tid:
            print(f"  {name} = {tid}")

    await client.disconnect()
    print("\n[done]")

asyncio.run(main())
