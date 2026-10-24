"""
DTD Telethon channel mirror
Listens to source channels, rewrites links/usernames, optional EN translate,
short delay, then posts to your destinations.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("utf-8", errors="replace").decode("ascii", errors="replace"), flush=True)


try:
    from telethon import TelegramClient, events, utils
    from telethon.tl.functions.account import UpdateProfileRequest
    from telethon.tl.functions.messages import EditChatAboutRequest
    from telethon.tl.functions.stories import SendStoryRequest
    from telethon.tl.types import InputMediaUploadedPhoto, MessageMediaWebPage
except ImportError:
    log("Install deps first: pip install -r requirements-telethon.txt")
    sys.exit(1)


def env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def env_bool(name: str, default: bool = True) -> bool:
    raw = env(name, "true" if default else "false").lower()
    return raw not in {"0", "false", "off", "no"}


def env_list(name: str) -> list[str]:
    raw = env(name)
    if not raw:
        return []
    return [part.strip() for part in re.split(r"[\s,]+", raw) if part.strip()]


# ─── Premium emoji helpers ────────────────────────────────────────────
# Telegram premium custom emoji IDs — these render as animated premium
# emoji when wrapped in <tg-emoji emoji-id="..."> tags with HTML parse mode.
_PREMIUM_EMOJI_MAP: dict[str, tuple[str, str]] = {
    "\U0001F525": ("5424972470023104089", "\U0001F525"),  # fire
    "\U0001F48E": ("5409048419211682843", "\U0001F48E"),  # diamond
    "\u2B50": ("5384352958686449866", "\u2B50"),  # star
    "\u2705": ("5368320147261603213", "\u2705"),  # checkmark
    "\u274C": ("5371283405415067580", "\u274C"),  # cross
    "\U0001F4A1": ("5438496463044752972", "\U0001F4A1"),  # lightbulb
    "\U0001F3F7\uFE0F": ("5406683434124859552", "\U0001F3F7\uFE0F"),  # label tag
    "\U0001F4E2": ("5424818078833715060", "\U0001F4E2"),  # megaphone
    "\U0001F195": ("5382357040008021292", "\U0001F195"),  # NEW
    "\U0001F516": ("5222444124698853913", "\U0001F516"),  # bookmark
    "\U0001F680": ("5368454834396208275", "\U0001F680"),  # rocket
    "\U0001F4B0": ("5427254297411038110", "\U0001F4B0"),  # money bag
    "\U0001F4E9": ("5206607081334906820", "\U0001F4E9"),  # envelope / email
    "\U0001F3E0": ("5427547778786482882", "\U0001F3E0"),  # house / store
    "\U0001F514": ("5427423642640229556", "\U0001F514"),  # bell / alert
}

# Keyword → premium emoji mapping for intelligent injection
_KEYWORD_EMOJI: list[tuple[list[str], str]] = [
    (["flash", "sale", "limited", "hurry", "last chance", "ends soon"], "\U0001F525"),
    (["premium", "exclusive", "vip", "members only"], "\U0001F48E"),
    (["price", "cost", "pay", "cheap", "afford", "discount", "% off"], "\U0001F4B0"),
    (["new", "fresh", "drop", "just added", "launch"], "\U0001F195"),
    (["verified", "trusted", "secure", "safe", "legit"], "\u2705"),
    (["scam", "warning", "fraud", "fake", "avoid"], "\U0001F6A8"),
    (["crypto", "bitcoin", "btc", "usdt", "ton", "trc20"], "\u2B50"),
    (["fast", "instant", "quick", "rapid", "speed"], "\U0001F680"),
    (["store", "shop", "browse", "catalog"], "\U0001F3E0"),
    (["email", "contact", "support", "help"], "\U0001F4E9"),
    (["deal", "offer", "bundle", "combo"], "\U0001F525"),
    (["tip", "trick", "hint", "advice", "guide"], "\U0001F4A1"),
    (["save", "bookmark", "pin", "keep"], "\U0001F516"),
    (["announce", "update", "news", "alert"], "\U0001F4E2"),
    (["community", "group", "chat", "join"], "\U0001F514"),
]


def prem(char: str) -> str:
    """Wrap a single emoji char with <tg-emoji> tags for premium rendering."""
    info = _PREMIUM_EMOJI_MAP.get(char)
    if info:
        return f'<tg-emoji emoji-id="{info[0]}">{info[1]}</tg-emoji>'
    return char


def prem_block(text: str) -> str:
    """Replace known emoji chars in a text block with premium <tg-emoji> tags."""
    out = text
    for char, (eid, fb) in _PREMIUM_EMOJI_MAP.items():
        if char in out:
            out = out.replace(char, f'<tg-emoji emoji-id="{eid}">{fb}</tg-emoji>')
    return out


def _pick_context_emoji(text: str, max_emoji: int = 2) -> list[str]:
    """Pick 1-2 premium emoji that match the message context (intelligent injection)."""
    low = text.lower()
    picked: list[str] = []
    seen: set[str] = set()
    for keywords, emoji_char in _KEYWORD_EMOJI:
        if len(picked) >= max_emoji:
            break
        if emoji_char in seen:
            continue
        if any(kw in low for kw in keywords):
            picked.append(emoji_char)
            seen.add(emoji_char)
    return picked


def _inject_premium_emoji(text: str) -> str:
    """Intelligently inject premium emoji into lines that lack emoji."""
    lines = text.split("\n")
    result: list[str] = []
    emoji_count = 0
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("\u2014") or stripped.startswith("http"):
            result.append(line)
            continue
        has_emoji = any(ch in stripped for ch in _PREMIUM_EMOJI_MAP)
        if has_emoji or emoji_count >= 3:
            result.append(line)
            continue
        candidates = _pick_context_emoji(stripped, max_emoji=1)
        if candidates and not any(ch in stripped for ch in _PREMIUM_EMOJI_MAP):
            result.append(f"{prem(candidates[0])} {stripped}")
            emoji_count += 1
        else:
            result.append(line)
    return "\n".join(result)


# ─── AI Message Crafter ───────────────────────────────────────────────
# Generates varied, natural, context-aware messages with premium emoji.
# Every message feels different — no two posts look templated.

# Tone styles for different contexts
_AI_TONES = {
    "hype": [
        "{emoji} {product} just dropped \u2014 this one's fire.\nTap in before it's gone.",
        "{emoji} New alert: {product} is LIVE.\nEveryone's grabbing it.",
        "{emoji} {product} is here. {price} \u2014 instant delivery.\nDon't sleep on this.",
        "{emoji} Yo this {product} is moving FAST.\n{price} and it's yours in seconds.",
    ],
    "premium": [
        "{emoji} For our premium members \u2014 {product}.\nExclusive pricing at {price}.",
        "{emoji} DTD PREMIUM exclusive: {product}\n{price} \u2014 members only.",
        "{emoji} This one's for the inner circle.\n{product} \u2014 {price}.",
        "{emoji} Premium drop: {product}\n{price} \u2014 unlock with /premium.",
    ],
    "trust": [
        "{emoji} Verified seller. Instant delivery. {product} at {price}.",
        "{emoji} No scammers here \u2014 {product} at {price}.\nTrusted by 488+ members.",
        "{emoji} {product} \u2014 {price}.\n@{owner} has your back.",
        "{emoji} Buy with confidence.\n{product} at {price} \u2014 delivery in seconds.",
    ],
    "casual": [
        "{emoji} anyone need {product}? we got it at {price}.",
        "{emoji} just restocked {product} \u2014 {price}. link below.",
        "{emoji} {product} available rn \u2014 {price}. tap the button.",
        "{emoji} {product} is in stock. {price}. go go go.",
    ],
    "flash": [
        "{emoji} FLASH: {product} at {price}!\nThis won't last \u2014 ends soon.",
        "{emoji} TIME SENSITIVE: {product}\nWas full price, now {price}.\nMove fast.",
        "{emoji} Flash alert {emoji}: {product}\n{price} \u2014 countdown started.",
        "{emoji} Hurry: {product} at {price}.\nLimited slots, first come first serve.",
    ],
    "community": [
        "{emoji} community pick: {product}\nY'all been asking for this one \u2014 {price}.",
        "{emoji} the group asked, we delivered.\n{product} at {price}.",
        "{emoji} popular demand: {product}\nBack in stock at {price}.",
        "{emoji} you asked for {product} \u2014 here it is at {price}.",
    ],
}

# Generic channel posts (no specific product)
_AI_CHANNEL_POSTS = [
    '<tg-emoji emoji-id="5424972470023104089">\U0001F525</tg-emoji> DTD is live. Browse, pay, get delivered.\n<a href="{store}">Open store \u2192</a>',
    '<tg-emoji emoji-id="5409048419211682843">\U0001F48E</tg-emoji> Premium members get deals first.\n<a href="{premium}">Join \u2192</a>',
    '<tg-emoji emoji-id="5384352958686449866">\u2B50</tg-emoji> Pay with Stars, USDT, BTC, or card.\nInstant delivery on every order.',
    '<tg-emoji emoji-id="5368454834396208275">\U0001F680</tg-emoji> New to DTD? Start here.\n<a href="{store}">Browse products</a> \u00B7 <a href="{bot}">Pay via bot</a>',
    '<tg-emoji emoji-id="5424818078833715060">\U0001F4E2</tg-emoji> Join both channels for full access.\nMain: <a href="{channel}">DTD STORE</a> \u00B7 Premium: <a href="{premium}">DTD PREMIUM</a>',
    '<tg-emoji emoji-id="5438496463044752972">\U0001F4A1</tg-emoji> Tip: use @{bot} for fastest checkout.\nSend /buy \u2192 scan QR \u2192 done.',
    '<tg-emoji emoji-id="5424972470023104089">\U0001F525</tg-emoji> 488 members strong.\nDTD Store \u2014 trusted, fast, no scammers.',
    '<tg-emoji emoji-id="5409048419211682843">\U0001F48E</tg-emoji> Every product verified. Every order tracked.\nThat\'s the DTD difference.',
    '<tg-emoji emoji-id="5222444124698853913">\U0001F516</tg-emoji> Save this channel. New drops daily.\n<a href="{store}">DTD Store</a>',
    '<tg-emoji emoji-id="5382357040008021292">\U0001F195</tg-emoji> Fresh deals dropping this week.\nStay tuned \u2014 premium members get early access.',
]

# Group engagement posts (GMONEY STORE style)
_AI_GROUP_POSTS = [
    '<tg-emoji emoji-id="5424972470023104089">\U0001F525</tg-emoji> Welcome to GMONEY STORE \u2014 this is where we eat.\nAsk questions, grab deals, vibe with the community.',
    '<tg-emoji emoji-id="5409048419211682843">\U0001F48E</tg-emoji> This group is your backend.\nChannels = front-end. Group = real talk + exclusive drops.',
    '<tg-emoji emoji-id="5384352958686449866">\u2B50</tg-emoji> GMONEY STORE rules:\n1. No scam links\n2. Respect the community\n3. Use @{bot} for all purchases\n4. Have fun',
    '<tg-emoji emoji-id="5424818078833715060">\U0001F4E2</tg-emoji> Link up:\nMain channel: <a href="{channel}">DTD STORE</a>\nPremium: <a href="{premium}">DTD PREMIUM</a>\nBot: <a href="{bot}">@{bot}</a>\nStore: <a href="{store}">dtdpaymentsbot.pages.dev</a>',
    '<tg-emoji emoji-id="5438496463044752972">\U0001F4A1</tg-emoji> Pro tip: the bot can track your orders.\nSend /order with your email + order ID.',
    '<tg-emoji emoji-id="5368320147261603213">\u2705</tg-emoji> Verified by DV Technologies.\n<a href="{company}">dvtechnologies.xyz</a> \u2014 {powered_by}',
    '<tg-emoji emoji-id="5424972470023104089">\U0001F525</tg-emoji> Drop incoming \u2014 keep notifications on.\nYou don\'t want to miss this one.',
    '<tg-emoji emoji-id="5409048419211682843">\U0001F48E</tg-emoji> GMONEY STORE = community first.\nAsk anything. We got you.',
]

# Reaction comments for the bot agent
_AI_REACTION_COMMENTS = [
    '<tg-emoji emoji-id="5424972470023104089">\U0001F525</tg-emoji> Grab it before it\'s gone!',
    '<tg-emoji emoji-id="5384352958686449866">\u2B50</tg-emoji> Pay with Stars or crypto \u2014 instant delivery.',
    '<tg-emoji emoji-id="5409048419211682843">\U0001F48E</tg-emoji> Premium quality, verified seller.',
    '<tg-emoji emoji-id="5368454834396208275">\U0001F680</tg-emoji> Fast delivery. Tap the button below.',
    '<tg-emoji emoji-id="5427254297411038110">\U0001F4B0</tg-emoji> Best prices on USDT/BTC/Paystack.',
    '<tg-emoji emoji-id="5206607081334906820">\U0001F4E9</tg-emoji> DM @{bot} to order now.',
    '<tg-emoji emoji-id="5222444124698853913">\U0001F516</tg-emoji> Save this post \u2014 new drops daily.',
    '<tg-emoji emoji-id="5438496463044752972">\U0001F4A1</tg-emoji> Need help? @{owner} is online.',
    '<tg-emoji emoji-id="5424818078833715060">\U0001F4E2</tg-emoji> Join both channels for full access.',
    '<tg-emoji emoji-id="5424972470023104089">\U0001F525</tg-emoji><tg-emoji emoji-id="5409048419211682843">\U0001F48E</tg-emoji> DTD Store \u2014 trusted since day one.',
]


def ai_product_message(product: dict, tone: str = "auto") -> str:
    """
    Generate an AI-crafted product message with premium emoji.
    tone: hype | premium | trust | casual | flash | community | auto (random)
    """
    name = str(product.get("name") or "Product")
    price = float(product.get("price_usd") or 0)
    price_txt = f"${price:,.2f}".rstrip("0").rstrip(".") if price else "$\u2014"

    if tone == "auto":
        tone = random.choice(list(_AI_TONES.keys()))

    templates = _AI_TONES.get(tone, _AI_TONES["hype"])
    template = random.choice(templates)
    emoji = random.choice(["\U0001F525", "\U0001F48E", "\u2B50", "\U0001F680", "\U0001F4B0"])

    msg = template.format(
        emoji=prem(emoji), product=name, price=price_txt, owner=OWNER,
    )

    links = (
        f'\n\n<a href="{STORE_URL}">DTD Store</a> \u00B7 '
        f'<a href="https://t.me/{BOT_USERNAME}">@{BOT_USERNAME}</a> \u00B7 '
        f'<a href="{PREMIUM_LINK}">Premium</a>'
    )
    return msg + links


def ai_channel_post() -> str:
    """Generate a random AI channel post with premium emoji."""
    template = random.choice(_AI_CHANNEL_POSTS)
    return template.format(
        store=STORE_URL, bot=BOT_USERNAME, channel=CHANNEL_LINK,
        premium=PREMIUM_LINK, owner=OWNER,
    )


def ai_group_post() -> str:
    """Generate a random AI group engagement post."""
    template = random.choice(_AI_GROUP_POSTS)
    return template.format(
        store=STORE_URL, bot=BOT_USERNAME, channel=CHANNEL_LINK,
        premium=PREMIUM_LINK, owner=OWNER, company=COMPANY_URL,
        powered_by=POWERED_BY,
    )


def ai_reaction_comment() -> str:
    """Generate a context-aware reaction comment."""
    template = random.choice(_AI_REACTION_COMMENTS)
    return template.format(bot=BOT_USERNAME, owner=OWNER)


API_ID = int(env("TELEGRAM_API_ID") or "0")
API_HASH = env("TELEGRAM_API_HASH")
SESSION = env("TELETHON_SESSION", "dtd_mirror")
SESSION_PATH = ROOT / "telethon_sessions" / SESSION

SOURCES = env_list("MIRROR_SOURCE_CHANNELS") or env_list("TELEGRAM_MIRROR_FROM_CHANNEL_ID")
DESTS = env_list("MIRROR_DEST_CHANNEL") or env_list("TELEGRAM_MIRROR_TO_CHAT_ID") or env_list("TELEGRAM_CHANNEL_ID")
if not DESTS:
    single = env("TELEGRAM_CHANNEL_ID")
    DESTS = [single] if single else []

# GMONEY STORE group — load early so DESTS can include it
GMONEY_GROUP_ID = env("GMONEY_GROUP_ID")  # set in .env, e.g. -100xxxxxxxxxx

# Add GMONEY STORE group to destinations (channels = front-end, group = backend)
if GMONEY_GROUP_ID and GMONEY_GROUP_ID not in DESTS:
    DESTS.append(GMONEY_GROUP_ID)

# ─── Premium source → Premium channel routing ─────────────────────────
# Sources listed here will ONLY mirror to the Premium destination, not the main store.
PREMIUM_SOURCES: list[int] = [int(x) for x in env_list("MIRROR_PREMIUM_SOURCES") if x.lstrip("-").isdigit()]
PREMIUM_DEST = env("MIRROR_PREMIUM_DEST", "")  # Premium channel ID

STORE_URL = env("STORE_URL", "https://dtdpaymentsbot.pages.dev").rstrip("/")
COMPANY_URL = env("COMPANY_URL", "https://dvtechnologies.xyz").rstrip("/")
OWNER = env("TELEGRAM_OWNER_USERNAME", "Glock7money").lstrip("@")
SUPPORT_EMAIL = env("SUPPORT_EMAIL", "contact@dvtechnologies.xyz").strip().lower()
CHANNEL_USERNAME = env("TELEGRAM_CHANNEL_USERNAME", "").lstrip("@")
# Telegram purchases bot (@DTDSTOREBOT) — do not rename.
BOT_USERNAME = env("TELEGRAM_BOT_USERNAME", "DTDSTOREBOT").lstrip("@")
# Public invite links for the shop channels (private channels need these).
# Finalised below (line ~141) with code defaults so the two channels ALWAYS
# show on every mirrored post, even if the .env ever loses the values.
CHANNEL_LINK = env("TELEGRAM_CHANNEL_LINK") or (
    f"https://t.me/{CHANNEL_USERNAME}" if CHANNEL_USERNAME else ""
)
PREMIUM_LINK = env("TELEGRAM_PREMIUM_LINK") or ""


def channel_buttons():
    """Inline buttons attached to mirrored posts (links to the shop channels)."""
    from telethon import Button

    keyboard = []
    row = []
    if CHANNEL_LINK:
        row.append(Button.url("🛍 DTD MAIN STORE", CHANNEL_LINK))
    if PREMIUM_LINK:
        row.append(Button.url("💎 DTD PREMIUM", PREMIUM_LINK))
    if row:
        keyboard.append(row)
    keyboard.append([Button.url("🛒 Buy / Store", STORE_URL)])
    return keyboard

# Strict official links only (used in rewrite + footer + promos):
# 1) @BOT — Telegram purchases
# 2) STORE_URL — web store
# 3) COMPANY_URL — DV Technologies
# 4) SUPPORT_EMAIL — track & communicate
# 5) @OWNER — Telegram support username
FOOTER = env(
    "MIRROR_FOOTER",
    (
        f"\n\n\u2014 <tg-emoji emoji-id=\"5409048419211682843\">\U0001F48E</tg-emoji> DTD MAIN STORE \u2014\n"
        f"<tg-emoji emoji-id=\"5424972470023104089\">\U0001F525</tg-emoji> Pay: @{BOT_USERNAME} \u00B7 <tg-emoji emoji-id=\"5438496463044752972\">\U0001F3E0</tg-emoji> {STORE_URL}\n"
        f"<tg-emoji emoji-id=\"5424818078833715060\">\U0001F4E2</tg-emoji> Main channel: {CHANNEL_LINK} \u00B7 <tg-emoji emoji-id=\"5409048419211682843\">\U0001F48E</tg-emoji> Premium: {PREMIUM_LINK}\n"
        f"<tg-emoji emoji-id=\"5384352958686449866\">\u2B50</tg-emoji> USDT (TRC20) \u00B7 \u20BF BTC \u00B7 Stars \u00B7 Paystack\n"
        f"<tg-emoji emoji-id=\"5427547778786482882\">\U0001F3E0</tg-emoji> {COMPANY_URL} \u00B7 <tg-emoji emoji-id=\"5206607081334906820\">\U0001F4E9</tg-emoji> {SUPPORT_EMAIL} \u00B7 <tg-emoji emoji-id=\"5424818078833715060\">\U0001F464</tg-emoji> @{OWNER}\n"
        f"<tg-emoji emoji-id=\"5368320147261603213\">\u2705</tg-emoji> NO SCAMMERS \u2014 verified DTD admin @{OWNER}"
    ),
)

# Faster defaults (was 5–30s)
DELAY_MIN = float(env("MIRROR_DELAY_MIN", "2") or "2")
DELAY_MAX = float(env("MIRROR_DELAY_MAX", "8") or "8")

SKIP_KEYWORDS = [k.lower() for k in env_list("MIRROR_SKIP_KEYWORDS")]
# Strict: only keep the purchase bot + owner. Everything else is rewritten.
KEEP_USERNAMES = {u.lstrip("@").lower() for u in env_list("MIRROR_KEEP_USERNAMES")} | {
    OWNER.lower(),
    BOT_USERNAME.lower(),
    "dtdpaymentbot",
    "dtdpaymentsbot",
    "Glock7money",
}

# ─── Vendor roster ────────────────────────────────────────────────────
# Users who are trusted vendors in the ecosystem.
# Format: user_id → {username, role, label}
VENDORS: dict[str, dict] = {
    "6690788369": {
        "username": "Glock7money",
        "role": "owner",
        "label": "\uD83D\uDC51 DTD Owner",
    },
    "7663030842": {
        "username": "B1yteBandit",
        "role": "vendor",
        "label": "\uD83D\uDC8E Verified Vendor",
    },
    "572441506": {
        "username": "Oxy1Monster",
        "role": "vendor",
        "label": "\uD83D\uDC8E Verified Vendor",
    },
}
REPLACE_LINK_HOSTS = env_list("MIRROR_REPLACE_LINK_HOSTS")
ENABLED = env_bool("MIRROR_ENABLED", True)
TRANSLATE_TO_EN = env_bool("MIRROR_TRANSLATE_TO_EN", True)
# Soft mode: translate, but do NOT drop posts
ENGLISH_ONLY = env_bool("MIRROR_ENGLISH_ONLY", False)
CATCH_UP = int(env("MIRROR_CATCH_UP", "0") or "0")
PROMO_ENABLED = env_bool("MIRROR_PROMO_ENABLED", True)
PROMO_ON_START = env_bool("MIRROR_PROMO_ON_START", False)
GROUP_ID = env("TELEGRAM_GROUP_ID")
# Finalise the channel links with safe defaults so both shop channels always
# render on mirrored content (private channels rely on the invite links).
CHANNEL_LINK = (
    CHANNEL_LINK
    or (f"https://t.me/{CHANNEL_USERNAME}" if CHANNEL_USERNAME else "https://t.me/+ysMSObZyNWpjNTA0")
)
PREMIUM_LINK = PREMIUM_LINK or "https://t.me/+ZYBP2Qrr-JgyYTQ0"
BOT_LINK = f"https://t.me/{BOT_USERNAME}"
OWNER_LINK = f"https://t.me/{OWNER}"
# Optional public invite link for the discussion group (private groups have none)
GROUP_LINK = env("TELEGRAM_GROUP_LINK") or env("MIRROR_GROUP_LINK")

# ─── GMONEY STORE group config ────────────────────────────────────────
# Personal engagement group — channels are front-end, group is the backend.
# GMONEY_GROUP_ID loaded earlier (line ~316) for DESTS inclusion.
GMONEY_GROUP_LINK = env("GMONEY_GROUP_LINK") or ""
GMONEY_GROUP_NAME = "GMONEY STORE\U0001F4B5"
# Admins who can manage the group (Telegram user IDs, comma-separated)
GMONEY_ADMINS: list[str] = env_list("GMONEY_GROUP_ADMINS")
# User IDs allowed to post marketing links (whitelist)
GMONEY_MARKETERS: list[str] = env_list("GMONEY_MARKETERS")
# Anti-spam: max messages per user per hour before mute
GMONEY_SPAM_LIMIT = int(env("GMONEY_SPAM_LIMIT", "15") or "15")
# DVTechnologies powered-by branding
POWERED_BY = "Powered by DV Technologies \u00B7 dvtechnologies.xyz"

# ─── GMONEY topic routing ─────────────────────────────────────────────
# Messages are routed to specific forum topics by reply_to ID.
GMONEY_TOPIC_MIRROR = int(env("GMONEY_TOPIC_MIRROR", "0") or "0")    # 🔥 DEALS & DROPS
GMONEY_TOPIC_PRODUCTS = int(env("GMONEY_TOPIC_PRODUCTS", "0") or "0")  # 📦 PRODUCT CATALOG
GMONEY_TOPIC_PREMIUM = int(env("GMONEY_TOPIC_PREMIUM", "0") or "0")  # 💎 PREMIUM LOUNGE
GMONEY_TOPIC_BOT = int(env("GMONEY_TOPIC_BOT", "0") or "0")        # 🤖 BOT & ORDERS
GMONEY_TOPIC_COMMUNITY = int(env("GMONEY_TOPIC_COMMUNITY", "0") or "0")  # 💬 COMMUNITY
GMONEY_TOPIC_DROPS = int(env("GMONEY_TOPIC_DROPS", "0") or "0")    # 🛒 Drops
GMONEY_TOPIC_TALK = int(env("GMONEY_TOPIC_TALK", "0") or "0")      # 💬 Talk
GMONEY_TOPIC_VAULT = int(env("GMONEY_TOPIC_VAULT", "0") or "0")    # 📁 Vault

# Legacy hour-based knob kept for backward compat, but the promo scheduler now
# runs on a short, systematic minute gap (default 30–60 min) so promos land
# steadily without tripping spam detection. These are code-level defaults so the
# VPS .env does NOT need to change.
PROMO_GAP_MIN = float(env("MIRROR_PROMO_GAP_MIN", "30") or "30")
PROMO_GAP_MAX = float(env("MIRROR_PROMO_GAP_MAX", "60") or "60")
PROMO_CHATS = env_list("MIRROR_PROMO_CHATS") or (DESTS + ([GROUP_ID] if GROUP_ID else []))
PROMO_IMAGE = ROOT / "assets" / "dtd-promo-banner.png"


def _gmoney_topic(chat, content_type: str = "mirror") -> int:
    """Return the reply_to topic message ID for the GMONEY group, or 0 if not the group."""
    if not GMONEY_GROUP_ID:
        return 0
    try:
        chat_id = str(int(utils.get_peer_id(chat)))
    except Exception:
        return 0
    if chat_id != str(GMONEY_GROUP_ID):
        return 0
    if content_type == "product" and GMONEY_TOPIC_PRODUCTS:
        return GMONEY_TOPIC_PRODUCTS
    if content_type == "premium" and GMONEY_TOPIC_PREMIUM:
        return GMONEY_TOPIC_PREMIUM
    if content_type == "bot" and GMONEY_TOPIC_BOT:
        return GMONEY_TOPIC_BOT
    if content_type == "community" and GMONEY_TOPIC_COMMUNITY:
        return GMONEY_TOPIC_COMMUNITY
    if content_type == "drops" and GMONEY_TOPIC_DROPS:
        return GMONEY_TOPIC_DROPS
    if content_type == "talk" and GMONEY_TOPIC_TALK:
        return GMONEY_TOPIC_TALK
    if content_type == "vault" and GMONEY_TOPIC_VAULT:
        return GMONEY_TOPIC_VAULT
    return GMONEY_TOPIC_MIRROR  # default: mirror feed (🔥 DEALS & DROPS)

_BUY_ALIASES = {
    BOT_USERNAME.lower(),
    "dtdpaymentbot",
    "dtdpaymentsbot",  # common misspelling — still maps to @DTDSTOREBOT
    "dtd_payment_bot",
    "dtdstorebot",
    "dtdstore",
}

# Support / contact aliases stay as owner
_SUPPORT_ALIASES = {
    OWNER.lower(),
    "Glock7money",
    "Glock7moneyv",
}

_LINKS_BLOCK = "\n".join(
    [
        "<tg-emoji emoji-id=\"5409048419211682843\">\U0001F48E</tg-emoji> DTD MAIN STORE",
        f"<tg-emoji emoji-id=\"5424972470023104089\">\U0001F525</tg-emoji> @{BOT_USERNAME} \u00B7 <tg-emoji emoji-id=\"5438496463044752972\">\U0001F3E0</tg-emoji> {STORE_URL}",
        f"<tg-emoji emoji-id=\"5424818078833715060\">\U0001F4E2</tg-emoji> Main channel: {CHANNEL_LINK}",
        f"<tg-emoji emoji-id=\"5409048419211682843\">\U0001F48E</tg-emoji> Premium: {PREMIUM_LINK}",
        "<tg-emoji emoji-id=\"5384352958686449866\">\u2B50</tg-emoji> USDT (TRC20) \u00B7 \u20BF BTC \u00B7 <tg-emoji emoji-id=\"5427254297411038110\">\U0001F4B3</tg-emoji> Card \u00B7 Stars",
        f"<tg-emoji emoji-id=\"5206607081334906820\">\U0001F4E9</tg-emoji> {SUPPORT_EMAIL} \u00B7 <tg-emoji emoji-id=\"5427547778786482882\">\U0001F3E0</tg-emoji> {COMPANY_URL} \u00B7 <tg-emoji emoji-id=\"5424818078833715060\">\U0001F464</tg-emoji> @{OWNER}",
    ]
)

PROMO_MESSAGE = env(
    "MIRROR_PROMO_MESSAGE",
    f'<tg-emoji emoji-id="5409048419211682843">\U0001F48E</tg-emoji> DTD Store \u2014 open now.\n{_LINKS_BLOCK}',
)

# Premium-style promo library for the main channel. Content-only variants;
# picker / schedule logic is unchanged.
PROMO_VARIANTS = [
    (
        '<tg-emoji emoji-id="5368454834396208275">\U0001F680</tg-emoji> DTD MAIN STORE '
        '<tg-emoji emoji-id="5409048419211682843">\U0001F48E</tg-emoji>\n'
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n"
        "Digital products with fast delivery.\n"
        '<tg-emoji emoji-id="5384352958686449866">\u2B50</tg-emoji> Pay USDT (TRC20) \u00B7 \u20BF BTC \u00B7 '
        '<tg-emoji emoji-id="5427254297411038110">\U0001F4B3</tg-emoji> Paystack\n\n'
        f"{_LINKS_BLOCK}"
    ),
    (
        '<tg-emoji emoji-id="5424972470023104089">\U0001F525</tg-emoji> Fresh drop energy \u2014 shop DTD today.\n'
        "Browse \u2192 pay \u2192 get delivery.\n"
        "Preferred crypto: USDT on Tron (TRC20).\n\n"
        f"{_LINKS_BLOCK}"
    ),
    (
        '<tg-emoji emoji-id="5438496463044752972">\U0001F4A1</tg-emoji> Prefer Telegram checkout?\n'
        "Open the bot \u2192 /buy \u2192 scan QR \u2192 paste tx hash \u2192 send delivery email.\n\n"
        f"{_LINKS_BLOCK}"
    ),
    (
        '<tg-emoji emoji-id="5409048419211682843">\U0001F48E</tg-emoji> Why people stay with DTD:\n'
        "clear pricing \u00B7 USDT/BTC/Paystack \u00B7 tracked delivery \u00B7 real support.\n\n"
        f"{_LINKS_BLOCK}"
    ),
    (
        '<tg-emoji emoji-id="5368454834396208275">\U0001F680</tg-emoji> Mini App + in-chat shop.\n'
        "One brand. One payments bot. Smooth from cart to inbox.\n\n"
        f"{_LINKS_BLOCK}"
    ),
    (
        '<tg-emoji emoji-id="5424818078833715060">\U0001F4E2</tg-emoji> LIVE store updates on this channel.\n'
        "Save the links \u2014 shop anytime:\n\n"
        f"{_LINKS_BLOCK}"
    ),
    (
        '<tg-emoji emoji-id="5382357040008021292">\U0001F195</tg-emoji> Thanks for being in the DTD community.\n'
        "Share with a friend who needs digital products + proper delivery.\n\n"
        f"{_LINKS_BLOCK}"
    ),
    (
        '<tg-emoji emoji-id="5424972470023104089">\U0001F525</tg-emoji> Short version of DTD '
        '<tg-emoji emoji-id="5222444124698853913">\U0001F447</tg-emoji>\n'
        f"{_LINKS_BLOCK}\n\n"
        '<tg-emoji emoji-id="5222444124698853913">\U0001F4CC</tg-emoji> Save this message.'
    ),
    (
        '<tg-emoji emoji-id="5438496463044752972">\U0001F4A1</tg-emoji> Got a custom request? Talk to the owner \u2014 bulk deals & product questions welcome.\n\n'
        f"{_LINKS_BLOCK}"
    ),
    (
        '<tg-emoji emoji-id="5409048419211682843">\U0001F48E</tg-emoji> DTD Store is supported internationally by DV Technologies \u2014 global ops, '
        "steady delivery, and a brand you can trust.\n\n"
        f"{_LINKS_BLOCK}"
    ),
]
# How much to randomly attach a promo banner image (feels less templated)
PROMO_IMAGE_CHANCE = float(env("MIRROR_PROMO_IMAGE_CHANCE", "0.4") or "0.4")
# Directory scanned for promo-*.jpg banners so promos rotate between many designs
# instead of always showing one fixed banner (looks less bot-like).
PROMO_IMAGES_DIR = Path(env("MIRROR_PROMO_IMAGES_DIR", str(ROOT / "assets")))
# Post promo to ONE chat per cycle (rotate) instead of blasting all at once
PROMO_ONE_PER_CYCLE = env_bool("MIRROR_PROMO_ONE_PER_CYCLE", True)

# ─── Product promo scheduler ─────────────────────────────
# Posts one active product (image + caption with links) to the product promo
# chats on a daily rotation. Mainly used for the premium channel, which should
# carry promos / product posts only (no mirrored group content).
PRODUCT_PROMO_ENABLED = env_bool("MIRROR_PRODUCT_PROMO_ENABLED", True)
# Default targets: DTD MAIN STORE + DTD PREMIUM only (the bot is admin in both).
PRODUCT_PROMO_CHATS = env_list("MIRROR_PRODUCT_PROMO_CHATS") or ["-1004317499796", "-1004435691493"]
# One product every 1h15m, rotating #1 → #last → loop. Never stops while the
# mirror is up, and never touches the products table on write — read-only + cache.
PRODUCT_PROMO_INTERVAL_HOURS = float(env("MIRROR_PRODUCT_PROMO_INTERVAL_HOURS", "0.42") or "0.42")
PRODUCT_PROMO_ON_START = env_bool("MIRROR_PRODUCT_PROMO_ON_START", True)
PRODUCT_PROMO_STATE = ROOT / "telethon_sessions" / "product_promo_state.json"
# Local mirror of the product list (ordered #1 → #last). The loop keeps posting
# from this cache even if Supabase is temporarily unreachable.
PRODUCT_PROMO_CACHE = ROOT / "telethon_sessions" / "product_promo_products.json"
PRODUCT_PROMO_IMG_DIR = ROOT / "assets" / "product-promo"

# Daily "general promo" — posted as a channel Story (sendStory) with fallback to
# a normal photo message. Rotates through the banner set day by day.
STORY_ENABLED = env_bool("MIRROR_STORY_ENABLED", True)
STORY_CHATS = env_list("MIRROR_STORY_CHATS") or PRODUCT_PROMO_CHATS
STORY_HOUR = int(env("MIRROR_STORY_HOUR", "9") or "9")
STORY_STATE = ROOT / "telethon_sessions" / "story_state.json"

# Mirror the store channels INTO the community chat feed (Channels tab).
CHAT_MIRROR_ENABLED = env_bool("MIRROR_CHAT_MIRROR_ENABLED", True)
CHAT_MIRROR_CHANNELS = (
    env_list("MIRROR_CHAT_MIRROR_CHANNELS") or ["-1004317499796", "-1004435691493"]
)
CHAT_MIRROR_INTERVAL = int(env("MIRROR_CHAT_MIRROR_INTERVAL", "120") or "120")
CHAT_MIRROR_STATE = ROOT / "telethon_sessions" / "chat_mirror_state.json"

# Rotating "AI-style" product cards. When enabled, the mirror tries to fetch a
# free generative-AI background (Pollinations) per product and falls back to a
# procedural theme. The design theme itself rotates daily so cards never repeat.
PRODUCT_AI_IMAGES = env_bool("MIRROR_PRODUCT_AI_IMAGES", True)
PRODUCT_AI_BUDGET = int(env("MIRROR_PRODUCT_AI_BUDGET", "20") or "20")
PREMIUM_USERNAME = env("MIRROR_PREMIUM_USERNAME", "dtdpremium").lstrip("@")
# The premium channel id — gets premium-only copy for promos, welcomes & nudges.
PREMIUM_CHAT = env("MIRROR_PREMIUM_CHANNEL") or "-1004435691493"
SUPABASE_URL = env("SUPABASE_URL")
SUPABASE_KEY = env("SUPABASE_SERVICE_ROLE_KEY") or env("SUPABASE_ANON_KEY")

URL_RE = re.compile(r"https?://[^\s<>\"']+", re.I)
USER_RE = re.compile(r"(?<!\w)@([A-Za-z0-9_]{4,})", re.I)
TME_RE = re.compile(r"(?:https?://)?t\.me/([A-Za-z0-9_]+)", re.I)
LATIN_RE = re.compile(r"[A-Za-z]")
NON_LATIN_RE = re.compile(r"[^\W\d_]", re.UNICODE)

# Prevent double-posts (catch-up + live, album parts, restarts)
_seen: set[str] = set()
_SEEN_MAX = 5000


def _mark_seen(chat_id: int, msg_id: int) -> bool:
    """Return True if already seen (skip)."""
    key = f"{chat_id}:{msg_id}"
    if key in _seen:
        return True
    _seen.add(key)
    if len(_seen) > _SEEN_MAX:
        # drop arbitrary older half
        for _ in range(len(_seen) // 2):
            _seen.pop()
    return False


_TG_EMOJI_RE = re.compile(r"<tg-emoji\s+emoji-id=\"\d+\">([^<]*)</tg-emoji>")


def _strip_tg_emoji(text: str) -> str:
    """Strip <tg-emoji> tags to their fallback characters (safe for non-premium)."""
    return _TG_EMOJI_RE.sub(lambda m: m.group(1), text)


def _safe_html(text: str) -> str:
    """Keep <b>, <a>, <br> but strip <tg-emoji> tags for API compatibility."""
    return _strip_tg_emoji(text)


async def _safe_send_message(client, chat, text: str, **kwargs) -> None:
    """Try HTML send; on failure, strip tg-emoji and retry; final fallback plain."""
    try:
        await client.send_message(chat, text, parse_mode="html", **kwargs)
        return
    except Exception:
        pass
    try:
        safe = _safe_html(text)
        await client.send_message(chat, safe, parse_mode="html", **kwargs)
        return
    except Exception:
        pass
    plain = re.sub(r"<[^>]+>", "", _safe_html(text))
    await client.send_message(chat, plain, **kwargs)


def _protect_tokens(text: str) -> tuple[str, list[str]]:
    tokens: list[str] = []

    def stash(match: re.Match[str]) -> str:
        tokens.append(match.group(0))
        return f"⟦T{len(tokens) - 1}⟧"

    out = _TG_EMOJI_RE.sub(stash, text)
    out = URL_RE.sub(stash, out)
    out = USER_RE.sub(stash, out)
    out = TME_RE.sub(stash, out)
    return out, tokens


def _restore_tokens(text: str, tokens: list[str]) -> str:
    out = text
    for i, token in enumerate(tokens):
        for placeholder in (f"⟦T{i}⟧", f"[T{i}]", f"(T{i})"):
            out = out.replace(placeholder, token)
    return out


def _looks_non_english(text: str) -> bool:
    letters = NON_LATIN_RE.findall(text)
    if len(letters) < 8:
        return False
    latin = sum(1 for ch in letters if LATIN_RE.fullmatch(ch))
    return (latin / len(letters)) < 0.75


def translate_to_english(text: str) -> str:
    if not TRANSLATE_TO_EN or not text or not text.strip():
        return text
    if not _looks_non_english(text):
        return text
    try:
        from deep_translator import GoogleTranslator
    except ImportError:
        return text

    protected, tokens = _protect_tokens(text)
    try:
        chunks: list[str] = []
        buf = protected
        max_len = 4200
        while buf:
            if len(buf) <= max_len:
                chunks.append(buf)
                break
            cut = buf.rfind("\n", 0, max_len)
            if cut < max_len // 2:
                cut = max_len
            chunks.append(buf[:cut])
            buf = buf[cut:].lstrip("\n")
        translated = "\n".join(
            GoogleTranslator(source="auto", target="en").translate(chunk) or chunk for chunk in chunks
        )
        return _restore_tokens(translated, tokens)
    except Exception as exc:  # noqa: BLE001
        log(f"[warn] translate failed: {exc}")
        return text


def _map_username(name: str) -> str:
    """Payments → @DTDSTOREBOT. Support/contact → @Glock7money."""
    low = name.lstrip("@").lower()
    if low in _SUPPORT_ALIASES:
        return OWNER
    if low in _BUY_ALIASES or low.startswith("dtdpayment"):
        return BOT_USERNAME
    # Mirrored competitor handles → payments bot
    return BOT_USERNAME


def _map_url(url: str) -> str:
    """Map any inbound URL to one of the 4 official links."""
    lower = url.lower().rstrip("/")
    store_host = STORE_URL.lower().replace("https://", "").replace("http://", "").split("/")[0]
    company_host = COMPANY_URL.lower().replace("https://", "").replace("http://", "").split("/")[0]

    if company_host and company_host in lower:
        return COMPANY_URL
    if store_host and store_host in lower:
        return STORE_URL
    if "dvtechnologies" in lower or "dv-tech" in lower:
        return COMPANY_URL
    if "dtdpaymentsbot.pages.dev" in lower or "dtdpaymentbot.pages.dev" in lower:
        return STORE_URL

    tme = TME_RE.search(url)
    if tme:
        return f"https://t.me/{_map_username(tme.group(1))}"

    if REPLACE_LINK_HOSTS:
        if any(host.lower() in lower for host in REPLACE_LINK_HOSTS):
            return STORE_URL
        return url
    return STORE_URL


def rewrite_text(text: str | None) -> str | None:
    """Rewrite body using official links. Always keep @DTDSTOREBOT + @owner visible."""
    raw = text or ""
    out = translate_to_english(raw)

    if ENGLISH_ONLY and out.strip() and _looks_non_english(out):
        kept = []
        for line in out.splitlines():
            letters = NON_LATIN_RE.findall(line)
            if len(letters) < 4:
                kept.append(line)
                continue
            latin = sum(1 for ch in letters if LATIN_RE.fullmatch(ch))
            if (latin / max(len(letters), 1)) >= 0.55:
                kept.append(line)
        cleaned = "\n".join(kept).strip()
        if cleaned:
            out = cleaned

    out = URL_RE.sub(lambda m: _map_url(m.group(0)), out)
    out = USER_RE.sub(lambda m: f"@{_map_username(m.group(1))}", out)
    out = TME_RE.sub(lambda m: f"t.me/{_map_username(m.group(1))}", out)

    cleaned_lines = []
    for line in out.splitlines():
        low = line.strip().lower()
        if low.startswith("forwarded from"):
            continue
        if SKIP_KEYWORDS and any(k in low for k in SKIP_KEYWORDS):
            return None
        cleaned_lines.append(line)
    out = "\n".join(cleaned_lines).strip()

    for official in (STORE_URL, COMPANY_URL, BOT_LINK, OWNER_LINK, CHANNEL_LINK, PREMIUM_LINK):
        if official in out:
            first, _, rest = out.partition(official)
            rest = rest.replace(official, "")
            out = (first + official + rest).strip()

    out = re.sub(r"[ \t]+\n", "\n", out)
    out = re.sub(r"\n{3,}", "\n\n", out)

    # Guarantee payments bot + both channels + webstore + owner on every post
    must_have = [
        f"@{BOT_USERNAME}",
        f"@{OWNER}",
        STORE_URL,
        SUPPORT_EMAIL,
        CHANNEL_LINK,
        PREMIUM_LINK,
    ]
    missing = [item for item in must_have if item.lower() not in out.lower()]
    if missing:
        out = f"{out}\n\n" + "\n".join(
            [
                f'<tg-emoji emoji-id="5424972470023104089">\U0001F525</tg-emoji> Pay / Mini App: @{BOT_USERNAME}',
                f'<tg-emoji emoji-id="5438496463044752972">\U0001F3E0</tg-emoji> Store: {STORE_URL}',
                f'<tg-emoji emoji-id="5424818078833715060">\U0001F4E2</tg-emoji> Main channel: {CHANNEL_LINK}',
                f'<tg-emoji emoji-id="5409048419211682843">\U0001F48E</tg-emoji> Premium: {PREMIUM_LINK}',
                f'<tg-emoji emoji-id="5206607081334906820">\U0001F4E9</tg-emoji> Email: {SUPPORT_EMAIL}',
                f'<tg-emoji emoji-id="5424818078833715060">\U0001F464</tg-emoji> Support: @{OWNER}',
            ]
        )

    if FOOTER and FOOTER.strip() not in out:
        out = f"{out}{FOOTER}" if out else FOOTER.strip()

    out = _inject_premium_emoji(out)
    return out


async def resolve_entities(client: TelegramClient, values: list[str], label: str = "chat"):
    entities = []
    for value in values:
        try:
            entity = await client.get_entity(int(value) if re.fullmatch(r"-?\d+", value) else value)
            entities.append(entity)
            title = getattr(entity, "title", None) or getattr(entity, "username", value)
            log(f"[ok] {label}: {title}")
        except Exception as exc:  # noqa: BLE001
            log(f"[warn] skip {label} {value}: {exc}")
    return entities


def _pick_promo_text() -> str:
    """Pick a fresh promo variant, avoiding an immediate repeat."""
    pool = PROMO_VARIANTS or [PROMO_MESSAGE]
    text = random.choice(pool)
    last = getattr(_pick_promo_text, "_last", None)
    if len(pool) > 1 and text == last:
        text = random.choice([t for t in pool if t != last])
    _pick_promo_text._last = text  # type: ignore[attr-defined]
    return text


def _promo_images() -> list[Path]:
    if not PROMO_IMAGES_DIR.exists():
        return []
    return sorted(PROMO_IMAGES_DIR.glob("promo-*.jpg"))


async def _send_one_promo(client: TelegramClient, chat) -> None:  # type: ignore[no-untyped-def]
    title = getattr(chat, "title", None) or getattr(chat, "username", chat)
    text = _pick_promo_text()
    topic = _gmoney_topic(chat, "mirror")
    reply_kw = {"reply_to": topic} if topic else {}
    try:
        images = _promo_images()
        if images and random.random() < PROMO_IMAGE_CHANCE:
            last = getattr(_send_one_promo, "_last_img", None)
            candidates = [img for img in images if str(img) != last] or images
            image = random.choice(candidates)
            _send_one_promo._last_img = str(image)  # type: ignore[attr-defined]
            try:
                await client.send_file(chat, file=str(image), caption=_safe_html(text)[:1024], force_document=False, parse_mode="html", **reply_kw)
                log(f"[ok] promo (image) -> {title}")
                return
            except Exception as exc:
                log(f"[warn] promo image failed ({title}): {exc}")
        await _safe_send_message(client, chat, text, link_preview=False, **reply_kw)
        log(f"[ok] promo -> {title}")
    except Exception as exc:  # noqa: BLE001
        log(f"[error] promo {title}: {exc}")


async def send_promo(client: TelegramClient, chats) -> None:  # type: ignore[no-untyped-def]
    """Send an initial promo — staggered, one variant per chat."""
    for chat in chats:
        await _send_one_promo(client, chat)
        await asyncio.sleep(random.uniform(20, 90))


def _next_promo_gap_seconds() -> float:
    """Randomized gap (seconds) between promos — systematic but not clockwork."""
    lo = min(PROMO_GAP_MIN, PROMO_GAP_MAX)
    hi = max(PROMO_GAP_MIN, PROMO_GAP_MAX)
    if hi <= 0:
        hi = 45.0
    if lo <= 0:
        lo = hi
    return random.uniform(lo, hi) * 60.0


async def promo_loop(client: TelegramClient, chats) -> None:  # type: ignore[no-untyped-def]
    if not PROMO_ENABLED or not chats:
        return
    # Rotate through chats so each destination/group gets a promo on its own
    # beat. One promo fires every 30–60 min (jittered), and with rotation each
    # single chat only sees a promo every (gap * number_of_chats), which keeps
    # any one channel well under spam thresholds while still marketing steadily.
    order = list(chats)
    random.shuffle(order)
    idx = 0

    # Kick off promptly so promos are visible right after (re)start, then settle
    # into the systematic 30-60 min rotation. Small stagger avoids a burst.
    await asyncio.sleep(random.uniform(10, 25))
    for chat in order:
        await _send_one_promo(client, chat)
        await asyncio.sleep(random.uniform(15, 40))

    while True:
        await asyncio.sleep(_next_promo_gap_seconds())

        if PROMO_ONE_PER_CYCLE:
            chat = order[idx % len(order)]
            idx += 1
            if idx % len(order) == 0:
                random.shuffle(order)  # reshuffle each full pass
            await _send_one_promo(client, chat)
        else:
            for chat in order:
                await _send_one_promo(client, chat)
                await asyncio.sleep(random.uniform(20, 90))


# ─── Control plane (on-demand commands + tunable settings) ──

_SETTINGS_CACHE: dict[str, tuple[str, float]] = {}


def _sb_headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }


def _sb_get(table: str, params: str = "") -> list[dict]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{table}" + (f"?{params}" if params else "?limit=10")
    req = urllib.request.Request(url, headers=_sb_headers())
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8", "replace"))
    return data if isinstance(data, list) else []


def _sb_patch(table: str, row_id: str, values: dict) -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{urllib.parse.quote(str(row_id))}"
    req = urllib.request.Request(
        url,
        data=json.dumps(values).encode("utf-8"),
        method="PATCH",
        headers={**_sb_headers(), "Prefer": "return=minimal"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        resp.read()


def _settings_value(key: str, default: str = "") -> str:
    """Read a tunable from Supabase app_settings, cached ~60s."""
    cached = _SETTINGS_CACHE.get(key)
    if cached and (time.time() - cached[1]) < 60:
        return cached[0]
    value = default
    try:
        rows = _sb_get("app_settings", f"key=eq.{urllib.parse.quote(key)}&limit=1&select=value")
        if rows:
            value = str(rows[0].get("value") or default)
    except Exception as exc:  # noqa: BLE001
        log(f"[warn] settings read {key}: {exc}")
    _SETTINGS_CACHE[key] = (value, time.time())
    return value


def _command_result(command: dict, status: str, result: str) -> None:
    try:
        _sb_patch("agent_commands", str(command["id"]), {
            "status": status,
            "result": str(result)[:500],
            "done_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:  # noqa: BLE001
        log(f"[warn] command result update: {exc}")


async def command_loop(client: TelegramClient, product_promo_targets) -> None:  # type: ignore[no-untyped-def]
    """Runs on-demand owner commands posted via the bot (agent_commands table)."""
    while True:
        await asyncio.sleep(30)
        try:
            rows = _sb_get(
                "agent_commands",
                "status=eq.pending&order=created_at.asc&limit=5&select=id,command,args",
            )
        except Exception as exc:  # noqa: BLE001
            log(f"[warn] commands poll: {exc}")
            continue
        for command in rows:
            cmd = str(command.get("command") or "").strip()
            args = str(command.get("args") or "").strip()
            if cmd not in ("promo", "story", "pin"):
                continue  # agent's jobs (deal, etc.)
            log(f"[cmd] received: {cmd} {args}".rstrip())
            try:
                if cmd == "promo" and product_promo_targets:
                    ok = await post_product_promo_now(client, product_promo_targets)
                    _command_result(command, "done" if ok else "failed", "promo posted" if ok else "no products")
                elif cmd == "story" and product_promo_targets:
                    posted = await _send_daily_story(client, product_promo_targets)
                    _command_result(command, "done" if posted else "failed", f"story/drop sent to {posted} chat(s)")
                elif cmd == "pin" and product_promo_targets:
                    ok = await _pin_product(client, product_promo_targets, args)
                    _command_result(command, "done" if ok else "failed", f"pinned {args}" if ok else f"no match for {args}")
                else:
                    _command_result(command, "failed", f"unsupported command or no targets: {cmd}")
            except Exception as exc:  # noqa: BLE001
                log(f"[error] command {cmd}: {exc}")
                _command_result(command, "failed", str(exc)[:300])


async def _pin_product(client: TelegramClient, chats, query: str) -> bool:  # type: ignore[no-untyped-def]
    products = await asyncio.to_thread(_fetch_products)
    q = query.lower()
    match = next((p for p in products if q in str(p.get("name", "")).lower() or q in str(p.get("id", "")).lower()), None)
    if not match:
        return False
    for chat in chats:
        try:
            await _send_product_promo(client, chat, match)
            last = await client.get_messages(chat, limit=1)
            if last and last[0].id:
                await client.pin_message(chat, last[0].id)
                log(f"[cmd] pinned product promo -> {getattr(chat, 'title', chat)}")
        except Exception as exc:  # noqa: BLE001
            log(f"[error] pin {query}: {exc}")
    return True


def _fetch_products() -> list[dict]:
    """Fetch active products from Supabase (read-only).

    Returns a stable, ordered list #1 → #last (created_at, then id). On success
    the list is cached to disk; on failure the cached list is returned so the
    promo loop never stalls.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        return _load_product_cache()
    try:
        url = (
            f"{SUPABASE_URL}/rest/v1/products"
            "?select=id,name,description,price_usd,color,image_url,created_at,active"
            "&active=eq.true&limit=200"
        )
        req = urllib.request.Request(
            url,
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
            },
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
        if not isinstance(data, list):
            return _load_product_cache()
        rows = [p for p in data if p.get("name")]
        rows.sort(key=lambda p: (str(p.get("created_at") or ""), str(p.get("id") or "")))
        _save_product_cache(rows)
        return rows
    except Exception as exc:  # noqa: BLE001
        log(f"[warn] product fetch failed ({exc}); using cache")
        return _load_product_cache()


def _save_product_cache(products: list[dict]) -> None:
    try:
        PRODUCT_PROMO_CACHE.parent.mkdir(parents=True, exist_ok=True)
        with open(PRODUCT_PROMO_CACHE, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(products))
    except Exception as exc:  # noqa: BLE001
        log(f"[warn] product cache save failed: {exc}")


def _load_product_cache() -> list[dict]:
    try:
        with open(PRODUCT_PROMO_CACHE, "r", encoding="utf-8") as fh:
            data = json.loads(fh.read() or "[]")
        if isinstance(data, list):
            return [p for p in data if p.get("name")]
    except Exception:
        pass
    return []


def _load_product_state() -> dict:
    try:
        with open(PRODUCT_PROMO_STATE, "r", encoding="utf-8") as fh:
            return json.loads(fh.read() or "{}")
    except Exception:
        return {}


def _save_product_state(state: dict) -> None:
    try:
        PRODUCT_PROMO_STATE.parent.mkdir(parents=True, exist_ok=True)
        with open(PRODUCT_PROMO_STATE, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(state))
    except Exception as exc:  # noqa: BLE001
        log(f"[warn] product state save failed: {exc}")


def _product_image_url(product: dict) -> str:
    raw = str(product.get("image_url") or "").strip()
    if not raw or raw.startswith("data:") or raw.startswith("blob:"):
        return ""
    if raw.startswith("http"):
        return raw
    if raw.startswith("/") and SUPABASE_URL:
        return f"{SUPABASE_URL.rstrip('/')}{raw}"
    return raw


def _product_caption(product: dict) -> str:
    name = str(product.get("name") or "Product").strip()
    description = str(product.get("description") or "").strip()
    price = float(product.get("price_usd") or 0)
    price_txt = f"${price:,.2f}".rstrip("0").rstrip(".") if price else "$—"
    desc = description[:600]

    return "\n".join(
        [
            f'<tg-emoji emoji-id="5438496463044752972">\U0001F3E0</tg-emoji> <b>{name}</b>',
            "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
            desc,
            "",
            f'<tg-emoji emoji-id="5427254297411038110">\U0001F4B0</tg-emoji> <b>Price: {price_txt} USD</b>',
            "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
            f'<tg-emoji emoji-id="5424818078833715060">\U0001F4E2</tg-emoji> <a href="{STORE_URL}">DTD Main Store</a> \u00B7 <tg-emoji emoji-id="5424972470023104089">\U0001F525</tg-emoji> <a href="{BOT_LINK}">@{BOT_USERNAME}</a>',
            f'<tg-emoji emoji-id="5424818078833715060">\U0001F4E2</tg-emoji> Main channel: <a href="{CHANNEL_LINK}">join \u2192</a> \u00B7 <tg-emoji emoji-id="5409048419211682843">\U0001F48E</tg-emoji> Premium: <a href="{PREMIUM_LINK}">join \u2192</a>',
            "<tg-emoji emoji-id=\"5384352958686449866\">\u2B50</tg-emoji> USDT (TRC20) \u00B7 \u20BF BTC \u00B7 <tg-emoji emoji-id=\"5427254297411038110\">\U0001F4B3</tg-emoji> Card \u00B7 Stars",
            f'<tg-emoji emoji-id="5384352958686449866">\u2B50</tg-emoji> <a href="{PREMIUM_LINK}">DTD PREMIUM</a> \u00B7 <tg-emoji emoji-id="5424818078833715060">\U0001F464</tg-emoji> <a href="{OWNER_LINK}">@{OWNER}</a>',
        ]
    )


# ─── Branded product-promo image generation (Pillow, optional) ───────────────
_IMG_ACCENTS = ["#7c3aed", "#0d9488", "#ea580c", "#0284c7", "#16a34a", "#db2777", "#d97706", "#4f46e5"]


def _img_font(paths: list[str], size: int):
    try:
        from PIL import ImageFont
    except ImportError:
        return None
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default(size)
    except Exception:
        return ImageFont.load_default()


def _stable_digest(seed: str, width: int = 6) -> int:
    try:
        import hashlib

        return int(hashlib.md5(seed.encode("utf-8", "replace")).hexdigest()[: width * 2], 16)
    except Exception:
        return 0


def _product_accent(product: dict) -> tuple[int, int, int]:
    raw = str(product.get("color") or "").strip().lstrip("#")
    if len(raw) == 6:
        try:
            return tuple(int(raw[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
        except ValueError:
            pass
    idx = _stable_digest(str(product.get("id") or product.get("name") or "")) % len(_IMG_ACCENTS)
    h = _IMG_ACCENTS[idx].lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _feature_bullets(description: str, max_items: int = 3) -> list[str]:
    out: list[str] = []
    for line in str(description or "").splitlines():
        line = re.sub(r"^\s*[\d\W]+\s*", "", line).strip()
        if not line:
            continue
        if len(line) > 46:
            line = line[:45].rstrip() + "…"
        out.append(line)
        if len(out) >= max_items:
            break
    return out


_CARD_THEMES = [
    {"name": "rings", "bg": ((30, 36, 60), (10, 15, 26)), "deco": "rings"},
    {"name": "rays", "bg": ((58, 22, 72), (12, 12, 30)), "deco": "rays"},
    {"name": "dots", "bg": ((18, 48, 58), (8, 16, 28)), "deco": "dots"},
    {"name": "burst", "bg": ((72, 28, 28), (16, 10, 22)), "deco": "burst"},
    {"name": "waves", "bg": ((20, 32, 76), (8, 14, 26)), "deco": "waves"},
    {"name": "rings_small", "bg": ((38, 50, 84), (12, 16, 32)), "deco": "rings_small"},
]


def _ai_budget_today() -> int:
    state = _load_json_state(PRODUCT_PROMO_IMG_DIR / "_ai_budget.json")
    today = datetime.now().astimezone().date().isoformat()
    if state.get("date") != today:
        return PRODUCT_AI_BUDGET
    return max(0, PRODUCT_AI_BUDGET - int(state.get("count", 0)))


def _spend_ai_budget() -> None:
    state = _load_json_state(PRODUCT_PROMO_IMG_DIR / "_ai_budget.json")
    today = datetime.now().astimezone().date().isoformat()
    if state.get("date") != today:
        state = {"date": today, "count": 0}
    state["count"] = int(state.get("count", 0)) + 1
    _save_json_state(PRODUCT_PROMO_IMG_DIR / "_ai_budget.json", state)


def _ai_background(prompt: str, seed: int):
    """Free generative-AI background (Pollinations). Returns a PIL Image or None."""
    try:
        from PIL import Image as _Image
    except ImportError:
        return None
    if not PRODUCT_AI_IMAGES or _ai_budget_today() <= 0:
        return None
    try:
        import io

        q = urllib.parse.quote(prompt)
        url = (
            f"https://image.pollinations.ai/prompt/{q}"
            f"?width=1024&height=1024&nologo=true&seed={seed}"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = resp.read()
        img = _Image.open(io.BytesIO(data)).convert("RGB").resize((1024, 1024))
        _spend_ai_budget()
        return img
    except Exception:
        return None


def _theme_background(theme: dict, accent: tuple[int, int, int]):
    """Procedural themed background — used when AI art is unavailable."""
    from PIL import Image, ImageDraw, ImageFilter

    W = H = 1024
    top, dark = theme["bg"]
    img = Image.new("RGB", (W, H))
    dr0 = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        dr0.line([(0, y), (W, y)], fill=tuple(int(top[i] + (dark[i] - top[i]) * t) for i in range(3)))
    deco = theme.get("deco", "rings")
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    drg = ImageDraw.Draw(glow)
    if deco == "rays":
        for i in range(14):
            drg.line([(i * 80, 0), (i * 80 + 420, H)], fill=(*accent, 22), width=4)
    elif deco == "dots":
        for x in range(0, W, 64):
            for y in range(0, H, 64):
                drg.ellipse((x - 5, y - 5, x + 5, y + 5), fill=(*accent, 42))
    elif deco == "burst":
        cx, cy, rad = W // 2, H // 2, 520
        for i in range(rad, 0, -26):
            a = max(0, 130 - (rad - i) // 4)
            drg.ellipse((cx - i, cy - i, cx + i, cy + i), fill=(*accent, a))
    elif deco == "waves":
        for i, y in enumerate(range(0, H, 84)):
            a = 34 - (i % 4) * 6
            drg.rectangle((0, y, W, y + 42), fill=(*accent, max(10, a)))
    else:  # rings / rings_small
        cx, cy, rad = int(W * 0.82), int(H * 0.16), 380
        for i in range(rad, 0, -20):
            drg.ellipse((cx - i, cy - i, cx + i, cy + i), fill=(*accent, int(150 * (rad - i) / rad)))
        for radius, alpha in ((230, 26), (180, 20)):
            drg.ellipse((W - 20 - radius, H * 0.12 - radius, W - 20 + radius, H * 0.12 + radius),
                        outline=(*accent, alpha), width=6)
        for rx, ry, radius, alpha in ((90, 820, 150, 22), (180, 840, 100, 16)):
            drg.ellipse((rx - radius, ry - radius, rx + radius, ry + radius), outline=(*accent, alpha), width=5)
    glow = glow.filter(ImageFilter.GaussianBlur(30))
    return Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")


def _product_promo_image(product: dict) -> str:
    """Render a 1024×1024 premium marketing card for the product (v3).

    Design theme rotates daily (deterministic per product + day); a generative-AI
    background is tried first with a procedural theme as fallback. The card adds
    glow orbs, badges, rating stars, corner accents and a vignette. Cached on disk.

    Returns an empty string if Pillow is unavailable so the mirror keeps working.
    """
    try:
        from PIL import Image, ImageDraw, ImageFilter
    except ImportError:
        return ""
    pid = str(product.get("id") or product.get("name") or "product")
    name = str(product.get("name") or "Product").strip()
    desc = str(product.get("description") or "").strip()
    price = float(product.get("price_usd") or 0)
    price_txt = f"${price:,.0f}".rstrip("0").rstrip(". ") if price else "PRICE ON REQUEST"
    accent = _product_accent(product)
    gold = (255, 209, 84)
    yday = datetime.now().astimezone().timetuple().tm_yday
    theme = _CARD_THEMES[_stable_digest(f"{pid}|{yday}") % len(_CARD_THEMES)]
    digest = _stable_digest(f"{pid}|{name}|{desc}|{price_txt}|{yday}|{theme['name']}|v3")
    out_ai = PRODUCT_PROMO_IMG_DIR / f"promo-{pid[:8]}-{digest}a.jpg"
    out_proc = PRODUCT_PROMO_IMG_DIR / f"promo-{pid[:8]}-{digest}.jpg"
    if out_ai.exists():
        return str(out_ai)
    if out_proc.exists():
        return str(out_proc)

    PRODUCT_PROMO_IMG_DIR.mkdir(parents=True, exist_ok=True)
    if sys.platform.startswith("win"):
        font_paths = [r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf"]
        font_semi = [r"C:\Windows\Fonts\seguisb.ttf", r"C:\Windows\Fonts\arial.ttf"]
    else:
        font_paths = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
        font_semi = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]

    W = H = 1024
    # Base: AI-generated art (when available) or a rotating procedural theme.
    base = _ai_background(
        f"{name} premium digital product marketing background, {theme['name']} "
        f"futuristic abstract tech, deep space gradient, glowing neon light streaks, "
        f"floating particles, bokeh, cinematic lighting, ultra detailed, dark elegant",
        digest,
    )
    used_ai = base is not None
    if base is None:
        base = _theme_background(theme, accent)
    else:
        overlay = Image.new("RGBA", (W, H), (6, 10, 18, 150))
        base = Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")
    img = base

    # Glow orbs behind the content
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    drg = ImageDraw.Draw(glow)
    for ox, oy, orad, col, al in (
        (int(W * 0.24), int(H * 0.30), 230, accent, 95),
        (int(W * 0.80), int(H * 0.26), 190, gold, 70),
        (int(W * 0.52), int(H * 0.66), 320, accent, 45),
    ):
        drg.ellipse((ox - orad, oy - orad, ox + orad, oy + orad), fill=(*col, al))
    glow = glow.filter(ImageFilter.GaussianBlur(60))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")

    # Vignette (soft dark edges)
    vig = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    drv = ImageDraw.Draw(vig)
    rad = int(W * 0.62)
    for i in range(rad, W, 6):
        a = int(95 * (i - rad) / (W - rad))
        drv.ellipse((W / 2 - i, H / 2 - i, W / 2 + i, H / 2 + i), fill=(0, 0, 0, a))
    vig = vig.filter(ImageFilter.GaussianBlur(18))
    img = Image.alpha_composite(img.convert("RGBA"), vig).convert("RGB")

    dr = ImageDraw.Draw(img, "RGBA")
    accent_line = (*accent, 200)

    def pill(cx, cy, w, h, fill=None, outline=None, owidth=0, radius=None):
        r = radius if radius is not None else int(h / 2)
        dr.rounded_rectangle((cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2),
                             radius=r, fill=fill, outline=outline, width=owidth)

    def corner(cx, cy, arm, width, color, fx=1, fy=1):
        dr.line([(cx, cy), (cx + arm * fx, cy)], fill=color, width=width)
        dr.line([(cx, cy), (cx, cy + arm * fy)], fill=color, width=width)

    # Corner accents
    for cx, cy, fx, fy in ((44, 44, 1, 1), (W - 44, 44, -1, 1), (44, H - 44, 1, -1), (W - 44, H - 44, -1, -1)):
        corner(cx, cy, 56, 6, (*accent, 220), fx, fy)

    # Top row: category chip (left), DTD monogram (center), PREMIUM chip (right)
    category = str(product.get("category") or "DIGITAL").strip().upper()[:14]
    f_chip = _img_font(font_paths, 22)
    if category and f_chip:
        cw = dr.textlength(category, font=f_chip) + 64
        pill(int(W * 0.5) - 300, 96, cw, 58, fill=(*accent, 200), radius=20)
        dr.text((int(W * 0.5) - 300, 96), category, font=f_chip, fill=(255, 255, 255), anchor="mm")
    chip = 130
    chip_x, chip_y = W / 2, 96
    pill(chip_x, chip_y, chip, chip, fill=accent, radius=30)
    f_mono = _img_font(font_paths, 46)
    if f_mono:
        dr.text((chip_x, chip_y), "DTD", font=f_mono, fill=(10, 15, 26), anchor="mm")
    if f_chip:
        pw2 = dr.textlength("PREMIUM", font=f_chip) + 56
        pill(int(W * 0.5) + 300, 96, pw2, 58, outline=gold, owidth=3, radius=20)
        dr.text((int(W * 0.5) + 300, 96), "PREMIUM", font=f_chip, fill=gold, anchor="mm")

    dr.line([(W / 2 - 210, 210), (W / 2 + 210, 210)], fill=accent_line, width=4)

    # Product name (wrapped, auto-fit, with soft shadow)
    def draw_block(text: str, font_paths: list[str], base: int, max_w: int, y_top: float,
                   fill, anchor: str = "mm", line_h: float = 0) -> float:
        size = base
        f = _img_font(font_paths, size)
        while f and size > 26 and dr.textlength(text, font=f) > max_w:
            size -= 4
            f = _img_font(font_paths, size)
        if f is None:
            return y_top
        words = text.split()
        lines, cur = [], ""
        for w in words:
            test = (cur + " " + w).strip()
            if dr.textlength(test, font=f) <= max_w:
                cur = test
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        line_h = line_h or size * 1.12
        ty = y_top - (len(lines) - 1) * line_h / 2
        for line in lines:
            if anchor == "mm":
                dr.text((W / 2 + 4, ty + 4), line, font=f, fill=(0, 0, 0, 150), anchor=anchor)
            dr.text((W / 2, ty), line, font=f, fill=fill, anchor=anchor)
            ty += line_h
        return ty - line_h / 2

    title_y = draw_block(name, font_paths, 84, int(W * 0.8), 342, (245, 247, 252))
    sub = (desc[:64].replace("\n", " ") or "Digital products · Fast delivery").strip()
    if len(sub) > 64:
        sub = sub[:63].rstrip() + "…"
    sub_y = title_y + 96
    f_sub = _img_font(font_semi, 32)
    if f_sub:
        dr.text((W / 2, sub_y), sub, font=f_sub, fill=(170, 180, 200), anchor="mm")

    # Divider
    dr.line([(W / 2 - 260, sub_y + 46), (W / 2 + 260, sub_y + 46)], fill=(*accent, 90), width=2)

    # Feature bullets
    feats = _feature_bullets(desc, 3)
    fy = sub_y + 104
    if feats:
        f_feat = _img_font(font_semi, 30)
        for feat in feats:
            if f_feat:
                pill(W / 2 - 252, fy, 40, 40, fill=(*accent, 220), radius=20)
                dr.text((W / 2 - 252, fy), "✓", font=_img_font(font_paths, 24), fill=(255, 255, 255), anchor="mm")
                dr.text((W / 2 - 214, fy), feat, font=f_feat, fill=(215, 222, 234), anchor="lm")
            fy += 52
        fy += 18
    else:
        fy += 8

    # Rating stars (deterministic, honest to product quality rating if present)
    rating = float(product.get("rating") or 0)
    if rating <= 0:
        rating = 4.6 + (digest % 5) * 0.1
    stars_full = int(round(rating))
    f_star = _img_font(font_semi, 34)
    f_rating = _img_font(font_semi, 28)
    if f_star and f_rating:
        dr.text((W / 2 - 90, fy), "★" * stars_full + "☆" * (5 - stars_full), font=f_star,
                fill=gold, anchor="mm")
        dr.text((W / 2 + 120, fy), f"{rating:.1f} · TRUSTED", font=f_rating,
                fill=(150, 160, 185), anchor="mm")

    # Price pill + BUY NOW chip
    py = H - 205
    pw, ph = 430, 100
    pill(W / 2, py, pw, ph, fill=(*accent, 240), radius=ph / 2)
    f_price = _img_font(font_paths, 52)
    if f_price:
        dr.text((W / 2, py), price_txt, font=f_price, fill=(255, 255, 255), anchor="mm")
    f_buy = _img_font(font_paths, 26)
    if f_buy:
        bw = dr.textlength("BUY NOW →", font=f_buy) + 64
        pill(W / 2 + 330, py, bw, 64, fill=(8, 12, 22, 120), outline=gold, owidth=3, radius=32)
        dr.text((W / 2 + 330, py), "BUY NOW →", font=f_buy, fill=gold, anchor="mm")

    # Payment row + footer
    f_pay = _img_font(font_semi, 26)
    if f_pay:
        dr.text((W / 2, H - 110), "USDT (TRC20)   ·   TON   ·   BTC   ·   CARD   ·   ⭐ STARS",
                font=f_pay, fill=(150, 160, 185), anchor="mm")
        dr.text((W / 2, H - 46), "DTD STORE  ·  DV TECHNOLOGIES",
                font=_img_font(font_semi, 22), fill=(105, 115, 140), anchor="mm")

    out = out_ai if used_ai else out_proc
    img.save(out, "JPEG", quality=92)
    log(f"[img] promo card generated: {out.name} ({theme['name']}{' · AI' if used_ai else ''})")
    return str(out)


async def _send_product_promo(client: TelegramClient, chat, product: dict) -> None:  # type: ignore[no-untyped-def]
    title = getattr(chat, "title", None) or getattr(chat, "username", chat)
    caption = _product_caption(product)
    topic = _gmoney_topic(chat, "product")
    reply_kw = {"reply_to": topic} if topic else {}
    try:
        peer = str(int(utils.get_peer_id(chat)))
        if peer == PREMIUM_CHAT:
            caption = "💎 <b>PREMIUM PICK</b> — exclusive to DTD PREMIUM\n\n" + caption
    except Exception:  # noqa: BLE001
        pass
    db_image = _product_image_url(product)
    image = db_image or await asyncio.to_thread(_product_promo_image, product)
    # Validate local file exists and has content
    if image and not str(image).startswith("http"):
        import os as _os
        if not _os.path.isfile(image) or _os.path.getsize(image) < 1024:
            log(f"[warn] product image invalid/missing ({title}): {image}")
            image = ""
    # Validate remote URL returns an image
    if image and str(image).startswith("http"):
        try:
            import urllib.request as _urlreq
            req = _urlreq.Request(str(image), method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
            with _urlreq.urlopen(req, timeout=10) as resp:
                ct = resp.headers.get("Content-Type", "")
                if "image" not in ct and "octet" not in ct:
                    log(f"[warn] product image URL not an image ({title}): {ct}")
                    image = ""
        except Exception:
            pass  # allow it to try sending anyway
    try:
        if image:
            try:
                await client.send_file(
                    chat,
                    file=image,
                    caption=_safe_html(caption),
                    parse_mode="html",
                    force_document=False,
                    link_preview=False,
                    **reply_kw,
                )
                log(f"[ok] product promo -> {title}")
                return
            except Exception as exc:  # noqa: BLE001
                log(f"[warn] product image failed ({title}): {exc}")
        await _safe_send_message(client, chat, caption, link_preview=False, **reply_kw)
        log(f"[ok] product promo (text) -> {title}")
    except Exception as exc:  # noqa: BLE001
        log(f"[error] product promo {title}: {exc}")


async def post_product_promo_now(client: TelegramClient, chats) -> bool:  # type: ignore[no-untyped-def]
    """Post the next product promo immediately (used by the scheduled loop and on-demand /promo)."""
    products = await asyncio.to_thread(_fetch_products)
    if not products:
        log("[warn] product promo: no active products")
        return False
    state = _load_product_state()
    index = int(state.get("index", 0)) % len(products)
    state["index"] = index + 1
    state["last"] = datetime.now(timezone.utc).isoformat()
    _save_product_state(state)
    product = products[index]
    for chat in chats:
        await _send_product_promo(client, chat, product)
        await asyncio.sleep(random.uniform(20, 60))
    return True


async def product_promo_loop(client: TelegramClient, chats) -> None:  # type: ignore[no-untyped-def]
    """Posts one active product per interval (default daily) to the product chats."""
    if not PRODUCT_PROMO_ENABLED or not chats:
        return

    if PRODUCT_PROMO_ON_START:
        await asyncio.sleep(random.uniform(15, 45))
        await post_product_promo_now(client, chats)

    while True:
        interval = float(_settings_value("promo_interval_hours", str(PRODUCT_PROMO_INTERVAL_HOURS)) or PRODUCT_PROMO_INTERVAL_HOURS)
        await asyncio.sleep(max(interval * 3600.0, 300.0))
        await post_product_promo_now(client, chats)


# ─── Daily general promo (channel Story) ─────────────────

def _bot_token() -> str:
    return env("TELEGRAM_BOT_TOKEN")


def _general_promo_caption() -> str:
    return (
        '<tg-emoji emoji-id="5409048419211682843">\U0001F48E</tg-emoji> DTD STORE \u2014 daily drop '
        '<tg-emoji emoji-id="5409048419211682843">\u2728</tg-emoji>\n'
        "Digital products \u00B7 fast delivery.\n"
        f"{_LINKS_BLOCK}"
    )


def _story_pick_image() -> Path | None:
    imgs = _promo_images()
    if not imgs:
        return None
    yday = datetime.now().astimezone().timetuple().tm_yday
    return imgs[yday % len(imgs)]


# ─── Channel member management (welcome + activation) ──────────────

def _sb_insert(table: str, values: dict) -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{table}",
        data=json.dumps(values).encode("utf-8"),
        method="POST",
        headers={**_sb_headers(), "Prefer": "return=minimal"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        resp.read()


def _sb_set(table: str, col: str, val: str, values: dict) -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}?{col}=eq.{urllib.parse.quote(str(val))}"
    req = urllib.request.Request(
        url,
        data=json.dumps(values).encode("utf-8"),
        method="PATCH",
        headers={**_sb_headers(), "Prefer": "return=minimal"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        resp.read()


def _bot_api_message(chat_id, text: str):
    token = _bot_token()
    if not token:
        return None
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=json.dumps({"chat_id": chat_id, "text": text, "parse_mode": "HTML"}).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8", "replace"))
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


def _parse_ts(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        return None


def _welcome_message(channel_id: str = "") -> str:
    if channel_id == PREMIUM_CHAT:
        return (
            "👑 <b>Welcome to DTD PREMIUM!</b>\n\n"
            "You're in the members-only tier.\n"
            f"🛒 Shop: <a href='{STORE_URL}'>Open the store →</a>\n"
            f"🛍 Main channel: <a href='{CHANNEL_LINK}'>join →</a>\n"
            f"💎 Premium channel: <a href='{PREMIUM_LINK}'>join →</a>\n"
            f"🤖 Instant deals: <a href='https://t.me/{BOT_USERNAME}'>@{BOT_USERNAME}</a>\n\n"
            "💎 <b>Your perks</b>\n"
            "· Early access to every flash sale\n"
            "· Premium-only offers before the main store\n"
            f"· Unlock full perks with 20⭐: <a href='https://t.me/{BOT_USERNAME}?start=premium'>Get Premium →</a>\n\n"
            f"👤 Questions? @{OWNER}"
        )
    return (
        "👋 <b>Welcome to DTD Store!</b>\n\n"
        f"🛒 Shop everything here: <a href='{STORE_URL}'>Open the store →</a>\n"
        f"🛍 Main channel: <a href='{CHANNEL_LINK}'>join →</a>\n"
        f"💎 Premium channel: <a href='{PREMIUM_LINK}'>join →</a>\n"
        f"🤖 Instant checkout & deals: <a href='https://t.me/{BOT_USERNAME}'>@{BOT_USERNAME}</a>\n\n"
        "💎 Pay with ⭐ Stars · USDT · TON · BTC · card\n"
        "⚡ Instant delivery · 24/7 support\n"
        f"👤 Questions? @{OWNER}"
    )


def _activation_message(channel_id: str = "") -> str:
    if channel_id == PREMIUM_CHAT:
        return (
            "🎁 <b>DTD PREMIUM exclusive drop</b>\n\n"
            "New members-only deals just landed:\n"
            f"🛒 <a href='{STORE_URL}'>Browse premium picks →</a>\n"
            f"🛍 Main channel: <a href='{CHANNEL_LINK}'>join →</a>\n"
            f"💎 Premium channel: <a href='{PREMIUM_LINK}'>join →</a>\n"
            f"🤖 @{BOT_USERNAME}\n\n"
            "⚡ Flash sales are announced here first.\n"
            f"💎 Unlock everything with <a href='https://t.me/{BOT_USERNAME}?start=premium'>20⭐ Premium</a>."
        )
    return (
        "🎁 <b>DTD exclusive for you</b>\n\n"
        "We just dropped fresh products — check today's picks:\n"
        f"🛒 <a href='{STORE_URL}'>Browse the store →</a>\n"
        f"🛍 Main channel: <a href='{CHANNEL_LINK}'>join →</a>\n"
        f"💎 Premium channel: <a href='{PREMIUM_LINK}'>join →</a>\n"
        f"🤖 @{BOT_USERNAME}\n\n"
        "💎 Pay with ⭐ Stars · USDT · TON · BTC · card\n"
        "⚡ Instant delivery."
    )


async def _fetch_members(client: TelegramClient, chat) -> list[dict]:  # type: ignore[no-untyped-def]
    out: list[dict] = []
    try:
        async for u in client.iter_participants(chat, limit=200):
            if u and getattr(u, "id", None):
                out.append({
                    "id": u.id,
                    "username": getattr(u, "username", None),
                    "first_name": getattr(u, "first_name", None),
                    "last_name": getattr(u, "last_name", None),
                })
    except Exception as exc:  # noqa: BLE001
        log(f"[warn] participants {getattr(chat, 'title', chat)}: {exc}")
    return out


async def _member_activation() -> None:
    hours = float(_settings_value("activation_hours", "48") or 48)
    per = int(float(_settings_value("activation_per_cycle", "8") or 8))
    try:
        rows = _sb_get(
            "channel_members",
            "select=telegram_user_id,telegram_username,status,last_activation_at,order_count,channel"
            "&status=in.(welcomed,activated)&limit=500",
        )
    except Exception as exc:  # noqa: BLE001
        log(f"[warn] activation fetch: {exc}")
        return
    due: list[dict] = []
    for r in rows or []:
        last = _parse_ts(r.get("last_activation_at"))
        if not last or (datetime.now(timezone.utc) - last) >= timedelta(hours=hours):
            due.append(r)
    sent = 0
    for r in due[:per]:
        uid = str(r.get("telegram_user_id") or "")
        if not uid.isdigit():
            continue
        _bot_api_message(uid, _activation_message(str(r.get("channel") or "")))
        try:
            _sb_set("channel_members", "telegram_user_id", uid, {
                "last_activation_at": datetime.now(timezone.utc).isoformat(),
                "status": "activated",
            })
        except Exception as exc:  # noqa: BLE001
            log(f"[warn] activation update {uid}: {exc}")
        sent += 1
        await asyncio.sleep(random.uniform(60, 150))
    if sent:
        log(f"[ok] member activation: {sent} nudge(s)")


async def member_loop(client: TelegramClient, channels) -> None:  # type: ignore[no-untyped-def]
    if not channels or not SUPABASE_URL or not SUPABASE_KEY:
        log("[warn] member loop disabled (no channels or Supabase)")
        return
    if env("MEMBER_ENABLED", "1") not in ("1", "true", "True"):
        log("[ok] member loop disabled via MEMBER_ENABLED")
        return
    log(f"[ok] member management: welcome + activation on {len(channels)} channel(s)")
    while True:
        try:
            welcome_enabled = _settings_value("welcome_enabled", "1") in ("1", "true", "True")
            known: set[str] = set()
            try:
                rows = _sb_get("channel_members", "select=telegram_user_id&limit=2000")
                known = {str(r["telegram_user_id"]) for r in rows if r.get("telegram_user_id")}
            except Exception as exc:  # noqa: BLE001
                log(f"[warn] known members fetch: {exc}")
            for chat in channels:
                members = await _fetch_members(client, chat)
                if not members:
                    continue
                peer = str(int(utils.get_peer_id(chat)))
                newbies = 0
                for m in members:
                    uid = str(m.get("id") or "")
                    if not uid or uid in known:
                        continue
                    known.add(uid)
                    try:
                        _sb_insert("channel_members", {
                            "telegram_user_id": uid,
                            "telegram_username": str(m.get("username") or "")[:60] or None,
                            "first_name": str(m.get("first_name") or "")[:80] or None,
                            "last_name": str(m.get("last_name") or "")[:80] or None,
                            "channel": peer,
                            "status": "new",
                        })
                    except Exception as exc:  # noqa: BLE001
                        log(f"[warn] member insert {uid}: {exc}")
                    if welcome_enabled:
                        result = _bot_api_message(uid, _welcome_message(peer))
                        try:
                            _sb_set("channel_members", "telegram_user_id", uid, {
                                "welcomed_at": datetime.now(timezone.utc).isoformat(),
                                "status": "welcomed" if result and result.get("ok") else "new",
                            })
                        except Exception as exc:  # noqa: BLE001
                            log(f"[warn] welcome update {uid}: {exc}")
                        newbies += 1
                        await asyncio.sleep(random.uniform(45, 120))
                if newbies:
                    log(f"[ok] member scan: {newbies} new member(s) handled in {getattr(chat, 'title', chat)}")
            await _member_activation()
        except Exception as exc:  # noqa: BLE001
            log(f"[warn] member loop: {exc}")
        scan_min = int(float(_settings_value("member_scan_minutes", "15") or 15))
        await asyncio.sleep(max(scan_min, 5) * 60)


def _bot_api_photo(method: str, chat_id, image_path: Path, caption: str):
    """Multipart photo upload to the Bot API (sendStory / sendPhoto)."""
    token = _bot_token()
    if not token:
        return None
    url = f"https://api.telegram.org/bot{token}/{method}"
    boundary = f"----DTD{random.randrange(1 << 48):012x}"
    body = b""
    fields = [("chat_id", str(chat_id))]
    if method == "sendStory":
        fields.append(("active_period", "86400"))
    fields.append(("caption", caption or ""))
    fields.append(("parse_mode", "HTML"))
    for key, val in fields:
        body += (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{key}"\r\n\r\n{val}\r\n'
        ).encode("utf-8")
    body += (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="photo"; filename="promo.jpg"\r\n'
        "Content-Type: image/jpeg\r\n\r\n"
    ).encode("utf-8")
    body += Path(image_path).read_bytes() + b"\r\n"
    body += f"--{boundary}--\r\n".encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as exc:
        try:
            return json.loads(exc.read().decode("utf-8", "replace"))
        except Exception:
            return {"ok": False, "error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


def _load_json_state(path: Path) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_json_state(path: Path, state: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
    except Exception:
        pass


async def _send_daily_story(client: TelegramClient, story_chats) -> int:  # type: ignore[no-untyped-def]
    """Post a channel Story via the user account (Telethon); fall back to a photo message."""
    image = _story_pick_image()
    caption = _general_promo_caption()
    if image is None:
        log("[warn] story: no promo banners in assets/ (promo-*.jpg)")
        return 0
    try:
        uploaded = await client.upload_file(str(image))
        media = InputMediaUploadedPhoto(file=uploaded)
    except Exception as exc:  # noqa: BLE001
        log(f"[warn] story upload failed: {exc}")
        media = None

    posted = 0
    for chat in story_chats:
        cid = int(utils.get_peer_id(chat))
        title = getattr(chat, "title", None) or getattr(chat, "username", cid)
        try:
            if media is not None:
                try:
                    await client(SendStoryRequest(
                        peer=chat,
                        media=media,
                        privacy_rules=[],
                        pinned=False,
                        caption=caption,
                        period=86400,
                    ))
                    log(f"[ok] daily story -> {title}")
                    posted += 1
                    continue
                except Exception as exc:  # noqa: BLE001
                    log(f"[warn] story failed ({title}): {exc}")
            result = _bot_api_photo("sendPhoto", cid, image, caption)
            if result and result.get("ok"):
                log(f"[ok] daily drop (photo fallback) -> {title}")
                posted += 1
            else:
                log(f"[warn] story + photo fallback failed {title}: {result}")
        except Exception as exc:  # noqa: BLE001
            log(f"[error] story {title}: {exc}")
        await asyncio.sleep(random.uniform(20, 60))
    return posted


async def story_loop(client: TelegramClient, story_chats) -> None:  # type: ignore[no-untyped-def]
    if not STORY_ENABLED or not story_chats:
        return
    while True:
        now = datetime.now().astimezone()
        hour = int(float(_settings_value("story_hour", str(STORY_HOUR)) or STORY_HOUR))
        target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
        if now >= target:
            target += timedelta(days=1)
        await asyncio.sleep(max((target - now).total_seconds(), 5.0))
        today = datetime.now().astimezone().date().isoformat()
        state = _load_json_state(STORY_STATE)
        if state.get("last") == today:
            continue
        await _send_daily_story(client, story_chats)
        state["last"] = today
        state["at"] = datetime.now(timezone.utc).isoformat()
        _save_json_state(STORY_STATE, state)


# ─── Channel → chat feed mirror ──────────────────────────

def _chat_mirror_insert(chat, chat_id: int, msg_id: int, body: str) -> None:
    url = SUPABASE_URL.rstrip("/")
    if not url or not SUPABASE_KEY:
        return
    title = getattr(chat, "title", "") or "DTD Store"
    username = (getattr(chat, "username", "") or "dtdstore").lstrip("@")
    payload = {
        "telegram_user_id": int(chat_id),
        "telegram_username": username,
        "display_name": title,
        "body": body,
        "is_premium": False,
        "source": "channel",
        "tg_message_id": int(msg_id),
        "tg_chat_id": int(chat_id),
    }
    req = urllib.request.Request(
        f"{url}/rest/v1/chat_messages",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()
    log(f"[chat] mirrored {msg_id} -> feed ({title})")


async def _chat_mirror_once(client: TelegramClient, chats) -> None:  # type: ignore[no-untyped-def]
    state = _load_json_state(CHAT_MIRROR_STATE)
    for chat in chats:
        cid = int(utils.get_peer_id(chat))
        try:
            last = int(state.get(str(cid), 0))
            recent = await client.get_messages(chat, limit=30)
            newest = last
            for msg in reversed(list(recent)):
                if int(msg.id) <= last:
                    continue
                if getattr(msg, "grouped_id", None):
                    continue
                body = (msg.message or msg.text or "").strip()
                if not body:
                    continue
                try:
                    _chat_mirror_insert(chat, cid, msg.id, body)
                    newest = max(newest, int(msg.id))
                except Exception as exc:  # noqa: BLE001
                    log(f"[warn] chat insert {msg.id}: {exc}")
            if newest > last:
                state[str(cid)] = newest
        except Exception as exc:  # noqa: BLE001
            log(f"[warn] chat mirror {getattr(chat, 'title', cid)}: {exc}")
    _save_json_state(CHAT_MIRROR_STATE, state)


async def chat_mirror_loop(client: TelegramClient) -> None:  # type: ignore[no-untyped-def]
    if not CHAT_MIRROR_ENABLED or not CHAT_MIRROR_CHANNELS:
        return
    chats = await resolve_entities(client, CHAT_MIRROR_CHANNELS, "chat mirror")
    if not chats:
        return
    await _chat_mirror_once(client, chats)
    while True:
        await asyncio.sleep(max(CHAT_MIRROR_INTERVAL, 60))
        await _chat_mirror_once(client, chats)


async def _set_channel_about(client: TelegramClient, dest, desc: str) -> bool:  # type: ignore[no-untyped-def]
    """Set a channel's description across Telethon versions.

    Telethon >= 1.44.0 removed channels.EditChannelRequest in favour of
    messages.EditChatAboutRequest. Try both so the mirror never dies on a
    package upgrade.
    """
    try:
        from telethon.tl.functions.channels import EditChannelRequest  # type: ignore[no-redef]

        await client(EditChannelRequest(channel=dest, about=desc))
        return True
    except ImportError:
        pass
    except Exception as exc:  # noqa: BLE001
        log(f"[warn] EditChannelRequest {getattr(dest, 'title', dest)}: {exc}")
    try:
        await client(EditChatAboutRequest(peer=dest, about=desc))
        return True
    except Exception as exc:  # noqa: BLE001
        log(f"[warn] about {getattr(dest, 'title', dest)}: {exc}")
    return False


async def _update_identity(client: TelegramClient, destinations) -> None:  # type: ignore[no-untyped-def]
    """Set the owner bio + both channel descriptions so clients see the admin.

    Telegram caps the personal bio at ~70 chars, so the short "no scammers"
    brand fits there; full links live in the channel descriptions.
    """
    try:
        me = await client.get_me()
        wanted_bio = "\uD83D\uDC8E Premium Vendor \u00B7 @DTDSTOREBOT \u00B7 dtdpaymentsbot.pages.dev"
        fallback_bio = "\uD83D\uDC8E Premium Vendor \u00B7 @DTDSTOREBOT"
        for candidate in (wanted_bio, fallback_bio):
            if getattr(me, "about", None) == candidate:
                break
            try:
                await client(UpdateProfileRequest(about=candidate))
                log(f"[ok] bio set ({len(candidate)} chars)")
                break
            except Exception as exc:  # noqa: BLE001
                log(f"[warn] bio '{candidate}': {exc}")
    except Exception as exc:  # noqa: BLE001
        log(f"[warn] bio check: {exc}")

    main_desc = (
        "\uD83D\uDED2 DTD MAIN STORE \u2014 official store & flash deals.\n"
        f"\uD83D\uDEC8 Join: {CHANNEL_LINK}\n"
        f"\uD83E\uDD16 Pay & shop: @{BOT_USERNAME} \u00B7 {STORE_URL}\n"
        f"\uD83D\uDC8E Premium vendor: @{OWNER} \u00B7 \u2705 NO SCAMMERS \u2014 verified seller, instant delivery"
    )
    prem_desc = (
        "\uD83D\uDC8E DTD PREMIUM \u2014 members-only drops before the main store.\n"
        f"\uD83D\uDC8E Join: {PREMIUM_LINK}\n"
        f"\uD83E\uDD16 @{BOT_USERNAME} \u00B7 {STORE_URL}\n"
        f"\uD83D\uDC8E Premium vendor: @{OWNER} \u00B7 \u2705 NO SCAMMERS \u2014 verified seller"
    )
    for dest in destinations:
        try:
            desc = prem_desc if str(int(utils.get_peer_id(dest))) == PREMIUM_CHAT else main_desc
            if getattr(dest, "about", None) == desc:
                continue
            if await _set_channel_about(client, dest, desc):
                log(f"[ok] about set: {getattr(dest, 'title', dest)}")
        except Exception as exc:  # noqa: BLE001
            log(f"[warn] about {getattr(dest, 'title', dest)}: {exc}")


# ─── Agent: reactions + comments ──────────────────────────────────────
# After each mirrored post, the bot agent:
# 1. Adds a premium emoji reaction (random from curated set)
# 2. Occasionally posts a context-aware comment to boost engagement

_REACTION_SET = [
    "\U0001F525",  # fire
    "\U0001F48E",  # diamond
    "\u2B50",      # star
    "\U0001F44D",  # thumbs up
    "\U0001F680",  # rocket
    "\U0001F4B0",  # money bag
    "\U0001F525\U0001F525",  # double fire
    "\u2728",      # sparkles
    "\U0001F195",  # NEW
    "\U0001F4E2",  # megaphone
]

_COMMENT_TEMPLATES = [
    "\U0001F525 Grab it before it's gone!",
    "\u2B50 Pay with Stars or crypto — instant delivery.",
    "\U0001F48E Premium quality, verified seller.",
    "\U0001F680 Fast delivery. Tap the button below.",
    "\U0001F4B0 Best prices on USDT/BTC/Paystack.",
    "\U0001F4E9 DM @{bot} to order now.",
    "\U0001F516 Save this post — new drops daily.",
    "\U0001F4A1 Need help? @{owner} is online.",
    "\U0001F4E2 Join both channels for full access.",
    "\U0001F525\U0001F48E DTD Store — trusted since day one.",
]


async def _agent_react_and_comment(client, sent_msg, text: str, dest) -> None:
    """React + optionally comment on a freshly posted message (agent behaviour)."""
    try:
        await asyncio.sleep(random.uniform(2.0, 6.0))
        emoji = random.choice(_REACTION_SET)
        try:
            from telethon.tl.functions.messages import SendReactionRequest
            from telethon.tl.types import InputReactionEmoji
            await client(SendReactionRequest(
                peer=dest,
                msg_id=sent_msg.id,
                reaction=[InputReactionEmoji(emoticon=emoji)],
            ))
            log(f"[agent] reacted {emoji} on {sent_msg.id}")
        except Exception as exc:  # noqa: BLE001
            log(f"[agent] reaction failed: {exc}")

        if random.random() < 0.35:
            await asyncio.sleep(random.uniform(3.0, 8.0))
            comment = random.choice(_COMMENT_TEMPLATES).format(bot=BOT_USERNAME, owner=OWNER)
            try:
                await client.send_message(
                    dest, comment, comment_to=sent_msg.id,
                    parse_mode="html", link_preview=False,
                )
                log(f"[agent] commented on {sent_msg.id}")
            except Exception as exc:  # noqa: BLE001
                log(f"[agent] comment failed: {exc}")
    except Exception as exc:  # noqa: BLE001
        log(f"[agent] error: {exc}")


# ─── Channel agent: monitor + engage ──────────────────────────────────
async def _channel_agent_loop(client, destinations) -> None:
    """
    Background agent that monitors both channels and:
    - Reacts to recent posts that missed a reaction
    - Posts engagement comments
    - Reports channel health
    """
    while True:
        try:
            await asyncio.sleep(1800)
            for dest in destinations:
                try:
                    async for msg in client.iter_messages(dest, limit=5):
                        if msg.out and not getattr(msg, "_reacted", False):
                            emoji = random.choice(_REACTION_SET[:5])
                            try:
                                from telethon.tl.functions.messages import SendReactionRequest
                                from telethon.tl.types import InputReactionEmoji
                                await client(SendReactionRequest(
                                    peer=dest,
                                    msg_id=msg.id,
                                    reaction=[InputReactionEmoji(emoticon=emoji)],
                                ))
                                log(f"[channel-agent] retro-reacted {emoji} on {msg.id}")
                            except Exception:
                                pass
                except Exception as exc:
                    log(f"[channel-agent] scan error: {exc}")
        except Exception as exc:
            log(f"[channel-agent] loop error: {exc}")


# ─── Behavior tracker: engagement analytics ────────────────────────────
async def _behavior_tracker_loop(client, destinations) -> None:
    """
    Periodically scans recent posts on both channels and logs engagement
    metrics (reactions count, views) to build a behaviour picture.
    Runs every 30 min.
    """
    while True:
        try:
            await asyncio.sleep(1800)
            for dest in destinations:
                try:
                    dest_id = int(utils.get_peer_id(dest))
                    async for msg in client.iter_messages(dest, limit=10):
                        if not msg.out:
                            continue
                        reactions_count = 0
                        if msg.reactions and hasattr(msg.reactions, "results"):
                            reactions_count = sum(
                                getattr(r, "count", 0) or 0 for r in msg.reactions.results
                            )
                        text_preview = (msg.message or "")[:120].replace("\n", " ")
                        log(
                            f"[tracker] {dest_id} msg={msg.id} "
                            f"views={msg.views or 0} reactions={reactions_count} "
                            f"preview={text_preview}"
                        )
                except Exception as exc:
                    log(f"[tracker] scan error: {exc}")
        except Exception as exc:
            log(f"[tracker] loop error: {exc}")


# ─── Store agent: order monitoring + auto-promo ────────────────────────
async def _store_agent_loop(client, destinations) -> None:
    """
    Monitors Supabase orders table every 15 min:
    - Counts recent orders (last 2h)
    - If surge detected (>3 orders in 2h) → posts flash deal promo
    - If quiet period → posts engagement promo
    - Logs order volume for the behavior tracker
    """
    last_count = 0
    while True:
        try:
            await asyncio.sleep(900)
            now = datetime.now(timezone.utc)
            since = (now - timedelta(hours=2)).isoformat()
            orders = _sb_get("orders", f"created_at=gte.{since}&select=id,created_at,status&order=created_at.desc&limit=50")
            current_count = len(orders) if orders else 0

            if current_count > 0:
                log(f"[store-agent] {current_count} orders in last 2h")

            if current_count >= 3 and current_count > last_count:
                surge_msg = (
                    f'<tg-emoji emoji-id="5424972470023104089">\U0001F525</tg-emoji> <b>DTD IS LIVE</b> \u2014 {current_count} orders just landed!\n'
                    f'<tg-emoji emoji-id="5424818078833715060">\U0001F4E2</tg-emoji> People are grabbing deals right now.\n\n'
                    f'<tg-emoji emoji-id="5368454834396208275">\U0001F680</tg-emoji> <a href="{STORE_URL}">Shop now \u2192</a>\n'
                    f'<tg-emoji emoji-id="5384352958686449866">\u2B50</tg-emoji> Pay with Stars, USDT, BTC, or card.\n'
                    f'<tg-emoji emoji-id="5409048419211682843">\U0001F48E</tg-emoji> <a href="{PREMIUM_LINK}">Join DTD PREMIUM</a> for early access.'
                )
                for dest in destinations:
                    try:
                        await client.send_message(dest, surge_msg, parse_mode="html", link_preview=False, buttons=channel_buttons())
                        log(f"[store-agent] surge promo -> {getattr(dest, 'title', dest)}")
                    except Exception as exc:
                        log(f"[store-agent] surge error: {exc}")

            last_count = current_count
        except Exception as exc:
            log(f"[store-agent] loop error: {exc}")


# ─── Ecosystem heartbeat ──────────────────────────────────────────────
async def _heartbeat_loop() -> None:
    """Logs a heartbeat every 10 min so the VPS operator knows the ecosystem is alive."""
    while True:
        try:
            await asyncio.sleep(600)
            now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            log(f"[heartbeat] ecosystem alive at {now}")
        except Exception as exc:
            log(f"[heartbeat] error: {exc}")


async def main() -> None:
    if not ENABLED:
        log("MIRROR_ENABLED=false")
        return
    if not API_ID or not API_HASH:
        log("Missing TELEGRAM_API_ID / TELEGRAM_API_HASH")
        sys.exit(1)
    if not SOURCES or not DESTS:
        log("Set MIRROR_SOURCE_CHANNELS and MIRROR_DEST_CHANNEL")
        sys.exit(1)

    SESSION_PATH.parent.mkdir(parents=True, exist_ok=True)
    client = TelegramClient(str(SESSION_PATH), API_ID, API_HASH)
    await client.start()
    me = await client.get_me()
    log(f"[ok] @{getattr(me, 'username', None) or me.id}")

    sources = await resolve_entities(client, SOURCES, "source")
    destinations = await resolve_entities(client, DESTS, "dest")
    if not sources or not destinations:
        sys.exit(1)
    # Compare raw Telegram chat IDs at runtime instead of relying on Telethon's
    # entity-filter matching. This stays reliable after a session is moved from
    # Windows to the VPS or Telegram refreshes an access hash.
    source_chat_ids = {int(utils.get_peer_id(source)) for source in sources}
    log(f"[ok] watching {len(source_chat_ids)} resolved source chat(s)")
    promo_targets = await resolve_entities(client, PROMO_CHATS, "promo") if PROMO_ENABLED else []

    # Owner identity: prove admin of both channels + store ("no scammers").
    # Must never be fatal — the mirror + product promo schedule keep running
    # even if the bio / channel descriptions can't be updated.
    try:
        await _update_identity(client, destinations)
    except Exception as exc:  # noqa: BLE001
        log(f"[warn] identity update skipped: {exc}")
    product_promo_targets = (
        await resolve_entities(client, PRODUCT_PROMO_CHATS, "product promo")
        if PRODUCT_PROMO_ENABLED
        else []
    )

    log(f"[ok] delay={DELAY_MIN}-{DELAY_MAX}s translate={TRANSLATE_TO_EN} catch_up={CATCH_UP}")

    async def post_rewritten(msg, source_chat_id: int = 0) -> None:  # type: ignore[no-untyped-def]
        chat_id = getattr(msg.peer_id, "channel_id", None) or getattr(msg, "chat_id", 0) or 0
        if _mark_seen(int(chat_id or 0), int(msg.id)):
            return

        original = msg.message or msg.text or ""
        rewritten = rewrite_text(original)
        if rewritten is None:
            log(f"[skip] {msg.id}")
            return

        # Route: premium sources → premium channel + GMONEY drops; others → main destinations
        if source_chat_id and source_chat_id in PREMIUM_SOURCES and PREMIUM_DEST:
            route_dests = [PREMIUM_DEST]
            # Also mirror to GMONEY group Drops topic
            if GMONEY_GROUP_ID and GMONEY_GROUP_ID not in route_dests:
                route_dests.append(GMONEY_GROUP_ID)
        else:
            route_dests = destinations

        for dest in route_dests:
            try:
                sent = None
                # Survival Mode source → drops topic in GMONEY
                if source_chat_id and source_chat_id in PREMIUM_SOURCES:
                    topic = _gmoney_topic(dest, "drops")
                else:
                    topic = _gmoney_topic(dest, "mirror")
                reply_kw = {"reply_to": topic} if topic else {}
                safe_text = _safe_html(rewritten)
                if msg.media and not isinstance(msg.media, MessageMediaWebPage):
                    try:
                        sent = await client.send_file(
                            dest,
                            file=msg.media,
                            caption=(safe_text[:1024] if safe_text else None),
                            force_document=False,
                            buttons=channel_buttons(),
                            parse_mode="html",
                            **reply_kw,
                        )
                    except Exception:
                        plain = re.sub(r"<[^>]+>", "", safe_text)[:1024] if safe_text else STORE_URL
                        sent = await client.send_file(
                            dest,
                            file=msg.media,
                            caption=plain,
                            force_document=False,
                            buttons=channel_buttons(),
                            **reply_kw,
                        )
                else:
                    await _safe_send_message(
                        client, dest, rewritten or STORE_URL, link_preview=False,
                        buttons=channel_buttons(),
                        **reply_kw,
                    )
                    sent = True  # marked as sent
                log(f"[ok] {msg.id} -> {getattr(dest, 'title', dest)}")
                if sent and sent is not True:
                    asyncio.create_task(_agent_react_and_comment(client, sent, rewritten, dest))
            except Exception as exc:  # noqa: BLE001
                log(f"[error] {msg.id}: {exc}")

    if CATCH_UP > 0:
        for source in sources:
            try:
                recent = await client.get_messages(source, limit=CATCH_UP)
                for msg in reversed(list(recent)):
                    if msg and not msg.out:
                        await post_rewritten(msg)
                        await asyncio.sleep(1.0)
            except Exception as exc:  # noqa: BLE001
                log(f"[warn] catch-up: {exc}")

    if PROMO_ENABLED and PROMO_ON_START and promo_targets:
        await send_promo(client, promo_targets)

    if PROMO_ENABLED and promo_targets:
        log(
            f"[ok] promo every ~{PROMO_GAP_MIN:.0f}-{PROMO_GAP_MAX:.0f} min, "
            f"rotating {len(promo_targets)} chat(s), {len(PROMO_VARIANTS)} variants"
        )
        asyncio.create_task(promo_loop(client, promo_targets))

    if PRODUCT_PROMO_ENABLED and product_promo_targets:
        log(
            f"[ok] product promo every ~{PRODUCT_PROMO_INTERVAL_HOURS:.0f}h, "
            f"rotating {len(product_promo_targets)} chat(s)"
        )
        asyncio.create_task(product_promo_loop(client, product_promo_targets))

    if STORY_ENABLED and _bot_token() and product_promo_targets:
        log(
            f"[ok] daily story every day ~{STORY_HOUR:02d}:00 "
            f"to {len(product_promo_targets)} chat(s), banners rotating daily"
        )
        asyncio.create_task(story_loop(client, product_promo_targets))

    if CHAT_MIRROR_ENABLED and CHAT_MIRROR_CHANNELS:
        log(
            f"[ok] channel -> chat feed mirror every ~{CHAT_MIRROR_INTERVAL}s "
            f"({len(CHAT_MIRROR_CHANNELS)} channel(s))"
        )
        asyncio.create_task(chat_mirror_loop(client))

    asyncio.create_task(command_loop(client, product_promo_targets))
    log("[ok] control plane active (promo / story / pin via agent_commands)")

    asyncio.create_task(member_loop(client, product_promo_targets))

    asyncio.create_task(_channel_agent_loop(client, destinations))
    log("[ok] channel agent active (react + comment on both channels)")

    asyncio.create_task(_behavior_tracker_loop(client, destinations))
    log("[ok] behavior tracker active (engagement analytics)")

    asyncio.create_task(_store_agent_loop(client, destinations))
    log("[ok] store agent active (order monitoring + auto-promo)")

    asyncio.create_task(_heartbeat_loop())
    log("[ok] ecosystem heartbeat active (10 min cycle)")

    @client.on(events.Album)
    async def on_album(event):  # type: ignore[no-untyped-def]
        try:
            msgs = list(event.messages)
            if not msgs:
                return
            first = msgs[0]
            chat_id = int(utils.get_peer_id(first.peer_id))
            if chat_id not in source_chat_ids:
                return
            for m in msgs:
                _mark_seen(int(chat_id), int(m.id))

            delay = random.uniform(min(DELAY_MIN, DELAY_MAX), max(DELAY_MIN, DELAY_MAX))
            await asyncio.sleep(delay)

            caption = rewrite_text(first.message or first.text or "")
            if caption is None:
                return
            files = [m.media for m in msgs if m.media and not isinstance(m.media, MessageMediaWebPage)]
            if not files:
                return
            # Route: premium sources → premium channel + GMONEY drops
            if int(chat_id or 0) in PREMIUM_SOURCES and PREMIUM_DEST:
                album_dests = [PREMIUM_DEST]
                if GMONEY_GROUP_ID and GMONEY_GROUP_ID not in album_dests:
                    album_dests.append(GMONEY_GROUP_ID)
            else:
                album_dests = destinations
            for dest in album_dests:
                try:
                    if int(chat_id or 0) in PREMIUM_SOURCES:
                        topic = _gmoney_topic(dest, "drops")
                    else:
                        topic = _gmoney_topic(dest, "mirror")
                    reply_kw = {"reply_to": topic} if topic else {}
                    sent = await client.send_file(dest, file=files, caption=(caption[:1024] if caption else None), buttons=channel_buttons(), parse_mode="html", **reply_kw)
                    log(f"[ok] album {first.id} -> {getattr(dest, 'title', dest)}")
                    if sent:
                        asyncio.create_task(_agent_react_and_comment(client, sent, caption, dest))
                except Exception as exc:  # noqa: BLE001
                    log(f"[error] album {first.id} -> {getattr(dest, 'title', dest)}: {exc}")
        except Exception as exc:
            log(f"[fatal] album handler crash (non-fatal): {exc}")

    @client.on(events.NewMessage)
    async def on_new_message(event):  # type: ignore[no-untyped-def]
        try:
            msg = event.message
            if not msg or msg.out:
                return
            chat_id = getattr(event, "chat_id", None)
            if chat_id is None:
                chat_id = int(utils.get_peer_id(msg.peer_id)) if msg.peer_id else 0
            if int(chat_id or 0) not in source_chat_ids:
                return
            if getattr(msg, "grouped_id", None):
                return

            delay = random.uniform(min(DELAY_MIN, DELAY_MAX), max(DELAY_MIN, DELAY_MAX))
            log(f"[info] {msg.id} in {delay:.0f}s")
            await asyncio.sleep(delay)
            await post_rewritten(msg, source_chat_id=int(chat_id or 0))
        except Exception as exc:
            log(f"[fatal] new_message handler crash (non-fatal): {exc}")

    # Auto-reconnect loop — stays alive 24/7
    while True:
        try:
            log("[ok] listening...")
            await client.run_until_disconnected()
            log("[warn] disconnected, reconnecting in 10s...")
        except Exception as exc:
            log(f"[warn] connection lost: {exc}, reconnecting in 10s...")
        await asyncio.sleep(10)
        try:
            if not client.is_connected():
                await client.connect()
                log("[ok] reconnected!")
        except Exception as exc:
            log(f"[error] reconnect failed: {exc}, retrying in 30s...")
            await asyncio.sleep(30)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log("Stopped.")
    except Exception as exc:  # noqa: BLE001
        # Log a real traceback so systemd journal shows the cause, then let the
        # service manager restart us (Restart=always). Never swallow silently.
        import traceback

        log(f"[fatal] mirror crashed: {exc}")
        log(traceback.format_exc())
        sys.exit(1)

