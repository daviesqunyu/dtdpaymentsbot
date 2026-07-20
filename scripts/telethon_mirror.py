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

try:
    from telethon import TelegramClient, events
    from telethon.tl.types import MessageMediaWebPage
except ImportError:
    print("Install deps first: pip install -r requirements-telethon.txt")
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
DEST = env("MIRROR_DEST_CHANNEL") or env("TELEGRAM_CHANNEL_ID")
STORE_URL = env("STORE_URL", "https://dtdpaymentsbot.pages.dev").rstrip("/")
OWNER = env("TELEGRAM_OWNER_USERNAME", "Davetheedev").lstrip("@")
FOOTER = env(
    "MIRROR_FOOTER",
    f"\n\n🔥 DTD MAIN STORE\n🛒 {STORE_URL}\n👤 Owner: @{OWNER}",
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

URL_RE = re.compile(r"https?://[^\s<>\"']+", re.I)
USER_RE = re.compile(r"(?<!\w)@([A-Za-z0-9_]{4,})", re.I)
TME_RE = re.compile(r"(?:https?://)?t\.me/([A-Za-z0-9_]+)", re.I)


def rewrite_text(text: str | None) -> str | None:
    if not text:
        return text

    out = text

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

    if FOOTER and FOOTER.strip() not in out:
        out = f"{out}{FOOTER}" if out else FOOTER.strip()

    return out


async def resolve_entities(client: TelegramClient, values: list[str]):
    entities = []
    for value in values:
        try:
            entity = await client.get_entity(int(value) if re.fullmatch(r"-?\d+", value) else value)
            entities.append(entity)
            title = getattr(entity, "title", None) or getattr(entity, "username", value)
            print(f"[ok] source: {title} ({value})")
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] cannot resolve source {value}: {exc}")
    return entities


async def main() -> None:
    if not ENABLED:
        print("MIRROR_ENABLED=false — exiting.")
        return
    if not API_ID or not API_HASH:
        print("Missing TELEGRAM_API_ID / TELEGRAM_API_HASH in .env (from https://my.telegram.org)")
        sys.exit(1)
    if not SOURCES:
        print("Set MIRROR_SOURCE_CHANNELS to one or more channel ids/@usernames")
        sys.exit(1)
    if not DEST:
        print("Set MIRROR_DEST_CHANNEL or TELEGRAM_CHANNEL_ID (your DTD MAIN STORE channel)")
        sys.exit(1)

    SESSION_PATH.parent.mkdir(parents=True, exist_ok=True)
    client = TelegramClient(str(SESSION_PATH), API_ID, API_HASH)
    await client.start()
    me = await client.get_me()
    print(f"[ok] logged in as @{getattr(me, 'username', None) or me.id}")

    sources = await resolve_entities(client, SOURCES)
    if not sources:
        print("No valid source channels resolved.")
        sys.exit(1)

    try:
        dest = await client.get_entity(int(DEST) if re.fullmatch(r"-?\d+", DEST) else DEST)
    except Exception as exc:  # noqa: BLE001
        print(f"Cannot resolve destination {DEST}: {exc}")
        sys.exit(1)

    dest_title = getattr(dest, "title", None) or getattr(dest, "username", DEST)
    print(f"[ok] destination: {dest_title}")
    print(f"[ok] rewrite → store={STORE_URL} owner=@{OWNER} delay={DELAY_MIN}-{DELAY_MAX}s")
    print("[ok] listening for new posts… (Ctrl+C to stop)")

    source_ids = {e.id for e in sources}

    @client.on(events.NewMessage(chats=sources))
    async def on_new_message(event):  # type: ignore[no-untyped-def]
        msg = event.message
        if not msg or msg.out:
            return
        # Only channel / broadcast posts (and groups if configured as source)
        chat = await event.get_chat()
        chat_id = getattr(chat, "id", None)
        if chat_id not in source_ids and getattr(chat, "username", None) is None:
            # still allow if chats=sources matched
            pass

        original = msg.message or msg.text or ""
        caption_source = original
        rewritten = rewrite_text(caption_source)
        if rewritten is None:
            print(f"[skip] keyword filter matched message {msg.id}")
            return

        delay = random.uniform(min(DELAY_MIN, DELAY_MAX), max(DELAY_MIN, DELAY_MAX))
        print(f"[info] mirroring msg {msg.id} after {delay:.1f}s")
        await asyncio.sleep(delay)

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
            print(f"[ok] posted rewritten copy of {msg.id} → {dest_title}")
        except Exception as exc:  # noqa: BLE001
            print(f"[error] failed to post {msg.id}: {exc}")

    await client.run_until_disconnected()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nStopped.")
