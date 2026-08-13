"""
DTD Telethon channel mirror
Listens to source channels, rewrites links/usernames, optional EN translate,
short delay, then posts to your destinations.
"""

from __future__ import annotations

import asyncio
import os
import random
import re
import sys
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
    from telethon.tl.types import MessageMediaWebPage
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


API_ID = int(env("TELEGRAM_API_ID") or "0")
API_HASH = env("TELEGRAM_API_HASH")
SESSION = env("TELETHON_SESSION", "dtd_mirror")
SESSION_PATH = ROOT / "telethon_sessions" / SESSION

SOURCES = env_list("MIRROR_SOURCE_CHANNELS") or env_list("TELEGRAM_MIRROR_FROM_CHANNEL_ID")
DESTS = env_list("MIRROR_DEST_CHANNEL") or env_list("TELEGRAM_MIRROR_TO_CHAT_ID") or env_list("TELEGRAM_CHANNEL_ID")
if not DESTS:
    single = env("TELEGRAM_CHANNEL_ID")
    DESTS = [single] if single else []

STORE_URL = env("STORE_URL", "https://dtdpaymentsbot.pages.dev").rstrip("/")
COMPANY_URL = env("COMPANY_URL", "https://dvtechnologies.xyz").rstrip("/")
OWNER = env("TELEGRAM_OWNER_USERNAME", "Glock7money").lstrip("@")
SUPPORT_EMAIL = env("SUPPORT_EMAIL", "contact@dvtechnologies.xyz").strip().lower()
CHANNEL_USERNAME = env("TELEGRAM_CHANNEL_USERNAME", "").lstrip("@")
# Telegram purchases bot (@DTDSTOREBOT) — do not rename.
BOT_USERNAME = env("TELEGRAM_BOT_USERNAME", "DTDSTOREBOT").lstrip("@")

# Strict official links only (used in rewrite + footer + promos):
# 1) @BOT — Telegram purchases
# 2) STORE_URL — web store
# 3) COMPANY_URL — DV Technologies
# 4) SUPPORT_EMAIL — track & communicate
# 5) @OWNER — Telegram support username
FOOTER = env(
    "MIRROR_FOOTER",
    (
        f"\n\n—\n"
        f"✨ DTD MAIN STORE\n"
        f"🤖 Pay / Mini App: @{BOT_USERNAME}\n"
        f"🛒 Web store: {STORE_URL}\n"
        f"💎 Pay: USDT (TRC20) · BTC · Paystack\n"
        f"🏢 DV Tech: {COMPANY_URL}\n"
        f"📧 Email: {SUPPORT_EMAIL}\n"
        f"👤 Support: @{OWNER}"
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
REPLACE_LINK_HOSTS = env_list("MIRROR_REPLACE_LINK_HOSTS")
ENABLED = env_bool("MIRROR_ENABLED", True)
TRANSLATE_TO_EN = env_bool("MIRROR_TRANSLATE_TO_EN", True)
# Soft mode: translate, but do NOT drop posts
ENGLISH_ONLY = env_bool("MIRROR_ENGLISH_ONLY", False)
CATCH_UP = int(env("MIRROR_CATCH_UP", "0") or "0")
PROMO_ENABLED = env_bool("MIRROR_PROMO_ENABLED", True)
PROMO_ON_START = env_bool("MIRROR_PROMO_ON_START", False)
GROUP_ID = env("TELEGRAM_GROUP_ID")
CHANNEL_LINK = f"https://t.me/{CHANNEL_USERNAME}"
BOT_LINK = f"https://t.me/{BOT_USERNAME}"
OWNER_LINK = f"https://t.me/{OWNER}"
# Optional public invite link for the discussion group (private groups have none)
GROUP_LINK = env("TELEGRAM_GROUP_LINK") or env("MIRROR_GROUP_LINK")

# Legacy hour-based knob kept for backward compat, but the promo scheduler now
# runs on a short, systematic minute gap (default 30–60 min) so promos land
# steadily without tripping spam detection. These are code-level defaults so the
# VPS .env does NOT need to change.
PROMO_GAP_MIN = float(env("MIRROR_PROMO_GAP_MIN", "30") or "30")
PROMO_GAP_MAX = float(env("MIRROR_PROMO_GAP_MAX", "60") or "60")
PROMO_CHATS = env_list("MIRROR_PROMO_CHATS") or (DESTS + ([GROUP_ID] if GROUP_ID else []))
PROMO_IMAGE = ROOT / "assets" / "dtd-promo-banner.png"

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
        "✨ DTD MAIN STORE",
        f"🤖 Pay / Mini App: @{BOT_USERNAME}",
        f"🛒 Web store: {STORE_URL}",
        "💎 Pay: USDT (TRC20) · BTC · Paystack",
        f"🏢 DV Tech: {COMPANY_URL}",
        f"📧 Email: {SUPPORT_EMAIL}",
        f"👤 Support: @{OWNER}",
    ]
)

PROMO_MESSAGE = env(
    "MIRROR_PROMO_MESSAGE",
    f"👑 DTD Store — open now.\n{_LINKS_BLOCK}",
)

# Premium-style promo library for the main channel. Content-only variants;
# picker / schedule logic is unchanged.
PROMO_VARIANTS = [
    (
        "👑 DTD MAIN STORE ✨\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "Digital products with fast delivery.\n"
        "Pay ₮ USDT (TRC20) · ₿ BTC · 💳 Paystack\n\n"
        f"{_LINKS_BLOCK}"
    ),
    (
        "🔥 Fresh drop energy — shop DTD today.\n"
        "Browse → pay → get delivery.\n"
        "Preferred crypto: USDT on Tron (TRC20).\n\n"
        f"{_LINKS_BLOCK}"
    ),
    (
        "🤖 Prefer Telegram checkout?\n"
        "Open the bot → /buy → scan QR → paste tx hash → send delivery email.\n\n"
        f"{_LINKS_BLOCK}"
    ),
    (
        "💎 Why people stay with DTD:\n"
        "clear pricing · USDT/BTC/Paystack · tracked delivery · real support.\n\n"
        f"{_LINKS_BLOCK}"
    ),
    (
        "🚀 Mini App + in-chat shop.\n"
        "One brand. One payments bot. Smooth from cart to inbox.\n\n"
        f"{_LINKS_BLOCK}"
    ),
    (
        "🔴 LIVE store updates on this channel.\n"
        "Save the links — shop anytime:\n\n"
        f"{_LINKS_BLOCK}"
    ),
    (
        "🎉 Thanks for being in the DTD community.\n"
        "Share with a friend who needs digital products + proper delivery.\n\n"
        f"{_LINKS_BLOCK}"
    ),
    (
        "⚡ Short version of DTD 👇\n"
        f"{_LINKS_BLOCK}\n\n"
        "📌 Save this message."
    ),
    (
        "Got a custom request? Talk to the owner — bulk deals & product questions welcome.\n\n"
        f"{_LINKS_BLOCK}"
    ),
    (
        "DTD Store is supported internationally by DV Technologies — global ops, "
        "steady delivery, and a brand you can trust.\n\n"
        f"{_LINKS_BLOCK}"
    ),
]
# How much to randomly attach the promo banner image (feels less templated)
PROMO_IMAGE_CHANCE = float(env("MIRROR_PROMO_IMAGE_CHANCE", "0.4") or "0.4")
# Post promo to ONE chat per cycle (rotate) instead of blasting all at once
PROMO_ONE_PER_CYCLE = env_bool("MIRROR_PROMO_ONE_PER_CYCLE", True)

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


def _protect_tokens(text: str) -> tuple[str, list[str]]:
    tokens: list[str] = []

    def stash(match: re.Match[str]) -> str:
        tokens.append(match.group(0))
        return f"⟦T{len(tokens) - 1}⟧"

    out = URL_RE.sub(stash, text)
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

    for official in (STORE_URL, COMPANY_URL, BOT_LINK, OWNER_LINK):
        if official in out:
            first, _, rest = out.partition(official)
            rest = rest.replace(official, "")
            out = (first + official + rest).strip()

    out = re.sub(r"[ \t]+\n", "\n", out)
    out = re.sub(r"\n{3,}", "\n\n", out)

    # Guarantee payments bot + support email + owner appear on every mirrored post
    must_have = [
        f"@{BOT_USERNAME}",
        f"@{OWNER}",
        STORE_URL,
        SUPPORT_EMAIL,
    ]
    missing = [item for item in must_have if item.lower() not in out.lower()]
    if missing:
        out = f"{out}\n\n" + "\n".join(
            [
                f"🤖 Pay / Mini App: @{BOT_USERNAME}",
                f"🛒 Store: {STORE_URL}",
                f"📧 Email: {SUPPORT_EMAIL}",
                f"👤 Support: @{OWNER}",
            ]
        )

    if FOOTER and FOOTER.strip() not in out:
        out = f"{out}{FOOTER}" if out else FOOTER.strip()
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


async def _send_one_promo(client: TelegramClient, chat) -> None:  # type: ignore[no-untyped-def]
    title = getattr(chat, "title", None) or getattr(chat, "username", chat)
    text = _pick_promo_text()
    try:
        if PROMO_IMAGE.exists() and random.random() < PROMO_IMAGE_CHANCE:
            await client.send_file(chat, file=str(PROMO_IMAGE), caption=text[:1024], force_document=False)
        else:
            await client.send_message(chat, text, link_preview=False)
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

    log(f"[ok] delay={DELAY_MIN}-{DELAY_MAX}s translate={TRANSLATE_TO_EN} catch_up={CATCH_UP}")

    async def post_rewritten(msg) -> None:  # type: ignore[no-untyped-def]
        chat_id = getattr(msg.peer_id, "channel_id", None) or getattr(msg, "chat_id", 0) or 0
        if _mark_seen(int(chat_id or 0), int(msg.id)):
            return

        original = msg.message or msg.text or ""
        rewritten = rewrite_text(original)
        if rewritten is None:
            log(f"[skip] {msg.id}")
            return

        for dest in destinations:
            try:
                if msg.media and not isinstance(msg.media, MessageMediaWebPage):
                    await client.send_file(
                        dest,
                        file=msg.media,
                        caption=(rewritten[:1024] if rewritten else None),
                        force_document=False,
                    )
                else:
                    await client.send_message(dest, rewritten or STORE_URL, link_preview=False)
                log(f"[ok] {msg.id} -> {getattr(dest, 'title', dest)}")
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

    log("[ok] listening...")

    @client.on(events.Album)
    async def on_album(event):  # type: ignore[no-untyped-def]
        # Use the first message's caption for the whole album; send grouped media once per dest
        msgs = list(event.messages)
        if not msgs:
            return
        first = msgs[0]
        chat_id = getattr(first.peer_id, "channel_id", None) or 0
        if int(chat_id or 0) not in source_chat_ids:
            return
        # mark all ids seen
        for m in msgs:
            _mark_seen(int(chat_id or 0), int(m.id))

        delay = random.uniform(min(DELAY_MIN, DELAY_MAX), max(DELAY_MIN, DELAY_MAX))
        await asyncio.sleep(delay)

        caption = rewrite_text(first.message or first.text or "")
        if caption is None:
            return
        files = [m.media for m in msgs if m.media and not isinstance(m.media, MessageMediaWebPage)]
        if not files:
            return
        for dest in destinations:
            try:
                await client.send_file(dest, file=files, caption=(caption[:1024] if caption else None))
                log(f"[ok] album {first.id} -> {getattr(dest, 'title', dest)}")
            except Exception as exc:  # noqa: BLE001
                log(f"[error] album {first.id}: {exc}")

    @client.on(events.NewMessage)
    async def on_new_message(event):  # type: ignore[no-untyped-def]
        msg = event.message
        if not msg or msg.out:
            return
        chat_id = getattr(event, "chat_id", None) or getattr(getattr(msg, "peer_id", None), "channel_id", None)
        if int(chat_id or 0) not in source_chat_ids:
            return
        # Albums are handled by on_album
        if getattr(msg, "grouped_id", None):
            return

        delay = random.uniform(min(DELAY_MIN, DELAY_MAX), max(DELAY_MIN, DELAY_MAX))
        log(f"[info] {msg.id} in {delay:.0f}s")
        await asyncio.sleep(delay)
        await post_rewritten(msg)

    await client.run_until_disconnected()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log("Stopped.")

