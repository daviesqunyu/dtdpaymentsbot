"""
DTD Telethon channel mirror
---------------------------
Listens to one or more source Telegram channels, rewrites text/captions
(links, usernames, footer), optionally delays, then posts to your destination
channel (e.g. DTD MAIN STORE).

Requires a USER account session (Telethon), not a bot token.
Get api_id + api_hash from https://my.telegram.org

Usage:
  pip install -r requirements-telethon.txt
  # fill TELEGRAM_API_ID / TELEGRAM_API_HASH in .env
  python scripts/telethon_mirror.py

First run will ask for phone + login code and create dtd_mirror.session
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

# Avoid Windows cp1252 crashes on emoji / fancy channel titles
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
    from telethon import TelegramClient, events
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
OWNER = env("TELEGRAM_OWNER_USERNAME", "Davetheedev").lstrip("@")
FOOTER = env(
    "MIRROR_FOOTER",
    f"\n\n🔥 DTD MAIN STORE\n🛒 {STORE_URL}\n🌐 Supported by DV Technologies (intl)\n{COMPANY_URL}\n👤 Owner: @{OWNER}",
)
DELAY_MIN = float(env("MIRROR_DELAY_MIN", "5") or "5")
DELAY_MAX = float(env("MIRROR_DELAY_MAX", "30") or "30")
SKIP_KEYWORDS = [k.lower() for k in env_list("MIRROR_SKIP_KEYWORDS")]
KEEP_USERNAMES = {u.lstrip("@").lower() for u in env_list("MIRROR_KEEP_USERNAMES")} | {
    OWNER.lower(),
    "dtdpaymentbot",
    "davistechbot",
    "davetheedev",
}
REPLACE_LINK_HOSTS = env_list("MIRROR_REPLACE_LINK_HOSTS")  # empty = replace ALL http(s) links
ENABLED = env_bool("MIRROR_ENABLED", True)
TRANSLATE_TO_EN = env_bool("MIRROR_TRANSLATE_TO_EN", True)
ENGLISH_ONLY = env_bool("MIRROR_ENGLISH_ONLY", True)  # drop posts that stay non-English after translate
CATCH_UP = int(env("MIRROR_CATCH_UP", "1") or "1")  # re-post last N msgs per source on start
PROMO_ENABLED = env_bool("MIRROR_PROMO_ENABLED", True)
PROMO_ON_START = env_bool("MIRROR_PROMO_ON_START", True)
PROMO_INTERVAL_HOURS = float(env("MIRROR_PROMO_INTERVAL_HOURS", "6") or "6")
CHANNEL_USERNAME = env("TELEGRAM_CHANNEL_USERNAME", "DTDMAINSTORE").lstrip("@")
BOT_USERNAME = env("TELEGRAM_BOT_USERNAME", "Dtdpaymentbot").lstrip("@")
GROUP_ID = env("TELEGRAM_GROUP_ID")
# Promo targets = destinations + group + any extra ids (YOUR chats only — never random groups)
PROMO_CHATS = env_list("MIRROR_PROMO_CHATS") or (
    DESTS + ([GROUP_ID] if GROUP_ID else [])
)
PROMO_IMAGE = ROOT / "assets" / "dtd-promo-banner.png"
PROMO_MESSAGE = env(
    "MIRROR_PROMO_MESSAGE",
    (
        "🔥 DTD MAIN STORE — OPEN NOW\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        f"🛒 Webstore\n{STORE_URL}\n\n"
        f"🌐 Company (international)\nDV Technologies\n{COMPANY_URL}\n\n"
        f"📢 Main channel\nhttps://t.me/{CHANNEL_USERNAME}\n\n"
        f"🤖 Store bot\n@{BOT_USERNAME}\n\n"
        f"👤 Owner / support\n@{OWNER}\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "💳 Paystack (KES) · ₿ Bitcoin\n"
        "⚡ Digital products · Fast delivery\n"
        "🤝 Join the community — shop safe with DTD"
    ),
)

URL_RE = re.compile(r"https?://[^\s<>\"']+", re.I)
USER_RE = re.compile(r"(?<!\w)@([A-Za-z0-9_]{4,})", re.I)
TME_RE = re.compile(r"(?:https?://)?t\.me/([A-Za-z0-9_]+)", re.I)
# Rough "already English" check (letters that are mostly Latin)
LATIN_RE = re.compile(r"[A-Za-z]")
NON_LATIN_RE = re.compile(r"[^\W\d_]", re.UNICODE)  # letters only


def _protect_tokens(text: str) -> tuple[str, list[str]]:
    """Replace URLs / @users / t.me links so translation won't break them."""
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
    """True when the text has enough non-Latin letters to need translation."""
    letters = NON_LATIN_RE.findall(text)
    if len(letters) < 8:
        return False
    latin = sum(1 for ch in letters if LATIN_RE.fullmatch(ch))
    return (latin / len(letters)) < 0.75


def translate_to_english(text: str) -> str:
    """Translate non-English post body to English. Keeps links/mentions intact."""
    if not TRANSLATE_TO_EN or not text or not text.strip():
        return text
    if not _looks_non_english(text):
        return text

    try:
        from deep_translator import GoogleTranslator
    except ImportError:
        log("[warn] deep-translator not installed — skipping translate")
        return text

    protected, tokens = _protect_tokens(text)
    try:
        # Google free endpoint accepts ~4500 chars; chunk long posts.
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

        translated_parts = [
            GoogleTranslator(source="auto", target="en").translate(chunk) or chunk
            for chunk in chunks
        ]
        translated = "\n".join(translated_parts)
        return _restore_tokens(translated, tokens)
    except Exception as exc:  # noqa: BLE001
        log(f"[warn] translate failed: {exc}")
        return text


def english_only_text(text: str) -> str | None:
    """Keep English content; drop post if it stays mostly non-English after translate."""
    if not ENGLISH_ONLY or not text:
        return text

    # Prefer Latin-script lines; drop heavy non-English lines
    kept: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            kept.append(line)
            continue
        # Always keep lines that are mostly icons/urls/mentions
        letters = NON_LATIN_RE.findall(stripped)
        if len(letters) < 4:
            kept.append(line)
            continue
        latin = sum(1 for ch in letters if LATIN_RE.fullmatch(ch))
        if (latin / len(letters)) >= 0.6:
            kept.append(line)
    out = "\n".join(kept).strip()
    if not out:
        return None
    if _looks_non_english(out):
        return None
    return out


def rewrite_text(text: str | None) -> str | None:
    if not text:
        return text

    out = translate_to_english(text)
    out = english_only_text(out)
    if out is None:
        return None

    def swap_url(match: re.Match[str]) -> str:
        url = match.group(0)
        if not REPLACE_LINK_HOSTS:
            return STORE_URL
        lower = url.lower()
        if any(host.lower() in lower for host in REPLACE_LINK_HOSTS):
            return STORE_URL
        return url

    out = URL_RE.sub(swap_url, out)

    def swap_user(match: re.Match[str]) -> str:
        name = match.group(1)
        if name.lower() in KEEP_USERNAMES:
            return f"@{name}"
        return f"@{OWNER}"

    out = USER_RE.sub(swap_user, out)
    out = TME_RE.sub(lambda m: f"t.me/{OWNER}" if m.group(1).lower() not in KEEP_USERNAMES else m.group(0), out)

    # Drop common "forwarded / contact seller" noise lines (light touch)
    cleaned_lines = []
    for line in out.splitlines():
        low = line.strip().lower()
        if low.startswith("forwarded from"):
            continue
        if SKIP_KEYWORDS and any(k in low for k in SKIP_KEYWORDS):
            return None  # skip whole post
        cleaned_lines.append(line)
    out = "\n".join(cleaned_lines).strip()
    if not out:
        return None

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
            log(f"[ok] {label}: {title} ({value})")
        except Exception as exc:  # noqa: BLE001
            log(f"[warn] cannot resolve {label} {value}: {exc}")
    return entities


async def send_promo(client: TelegramClient, chats) -> None:  # type: ignore[no-untyped-def]
    if not chats:
        log("[warn] no promo chats configured")
        return
    caption = PROMO_MESSAGE[:1024]
    for chat in chats:
        title = getattr(chat, "title", None) or getattr(chat, "username", chat)
        try:
            if PROMO_IMAGE.exists():
                await client.send_file(chat, file=str(PROMO_IMAGE), caption=caption, force_document=False)
            else:
                await client.send_message(chat, PROMO_MESSAGE, link_preview=False)
            log(f"[ok] promo sent -> {title}")
        except Exception as exc:  # noqa: BLE001
            log(f"[error] promo failed -> {title}: {exc}")
        await asyncio.sleep(1.2)


async def promo_loop(client: TelegramClient, chats) -> None:  # type: ignore[no-untyped-def]
    if not PROMO_ENABLED or PROMO_INTERVAL_HOURS <= 0:
        return
    while True:
        await asyncio.sleep(max(PROMO_INTERVAL_HOURS, 0.25) * 3600)
        log("[ok] periodic promo tick...")
        await send_promo(client, chats)


async def main() -> None:
    if not ENABLED:
        log("MIRROR_ENABLED=false — exiting.")
        return
    if not API_ID or not API_HASH:
        log("Missing TELEGRAM_API_ID / TELEGRAM_API_HASH in .env (from https://my.telegram.org)")
        sys.exit(1)
    if not SOURCES:
        log("Set MIRROR_SOURCE_CHANNELS to one or more channel ids/@usernames")
        sys.exit(1)
    if not DESTS:
        log("Set MIRROR_DEST_CHANNEL (comma-separated ids for main + backup)")
        sys.exit(1)

    SESSION_PATH.parent.mkdir(parents=True, exist_ok=True)
    client = TelegramClient(str(SESSION_PATH), API_ID, API_HASH)
    await client.start()
    me = await client.get_me()
    log(f"[ok] logged in as @{getattr(me, 'username', None) or me.id}")

    sources = await resolve_entities(client, SOURCES, label="source")
    if not sources:
        log("No valid source channels resolved.")
        sys.exit(1)

    destinations = await resolve_entities(client, DESTS, label="destination")
    if not destinations:
        log("No valid destinations resolved.")
        sys.exit(1)

    promo_targets = await resolve_entities(client, PROMO_CHATS, label="promo")

    log(
        f"[ok] rewrite -> store={STORE_URL} owner=@{OWNER} "
        f"delay={DELAY_MIN}-{DELAY_MAX}s translate_en={TRANSLATE_TO_EN} "
        f"english_only={ENGLISH_ONLY} catch_up={CATCH_UP} promo={PROMO_ENABLED}"
    )

    async def post_rewritten(msg, destinations) -> None:  # type: ignore[no-untyped-def]
        original = msg.message or msg.text or ""
        rewritten = rewrite_text(original)
        if rewritten is None:
            log(f"[skip] filtered/non-English message {msg.id}")
            return

        for dest in destinations:
            try:
                if msg.media and not isinstance(msg.media, MessageMediaWebPage):
                    await client.send_file(
                        dest,
                        file=msg.media,
                        caption=rewritten[:1024] if rewritten else None,
                        force_document=False,
                    )
                else:
                    await client.send_message(dest, rewritten or STORE_URL, link_preview=False)
                log(f"[ok] posted rewritten copy of {msg.id} -> {getattr(dest, 'title', dest)}")
            except Exception as exc:  # noqa: BLE001
                log(f"[error] failed to post {msg.id}: {exc}")

    # Catch-up: mirror recent posts once so channels aren't empty while waiting
    if CATCH_UP > 0:
        log(f"[ok] catch-up: mirroring last {CATCH_UP} post(s) from each source...")
        for source in sources:
            try:
                recent = await client.get_messages(source, limit=CATCH_UP)
                for msg in reversed(list(recent)):
                    if not msg or msg.out:
                        continue
                    await post_rewritten(msg, destinations)
                    await asyncio.sleep(1.5)
            except Exception as exc:  # noqa: BLE001
                log(f"[warn] catch-up failed for {getattr(source, 'title', source)}: {exc}")

    if PROMO_ENABLED and PROMO_ON_START and promo_targets:
        log("[ok] sending startup promo to your channels/group...")
        await send_promo(client, promo_targets)

    if PROMO_ENABLED and promo_targets and PROMO_INTERVAL_HOURS > 0:
        asyncio.create_task(promo_loop(client, promo_targets))
        log(f"[ok] promo scheduler every {PROMO_INTERVAL_HOURS}h")

    log("[ok] listening for new posts... (Ctrl+C to stop)")

    @client.on(events.NewMessage(chats=sources))
    async def on_new_message(event):  # type: ignore[no-untyped-def]
        msg = event.message
        if not msg or msg.out:
            return

        delay = random.uniform(min(DELAY_MIN, DELAY_MAX), max(DELAY_MIN, DELAY_MAX))
        log(f"[info] mirroring msg {msg.id} after {delay:.1f}s to {len(destinations)} destination(s)")
        await asyncio.sleep(delay)
        await post_rewritten(msg, destinations)

    await client.run_until_disconnected()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log("\nStopped.")
