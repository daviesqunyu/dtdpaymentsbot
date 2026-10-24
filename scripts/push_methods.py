"""Daily batch push: DTDSTORE METHOD PDFs -> DTD MAIN STORE.

Sends all files together (one batch). Run with --force to ignore the
once-a-day guard. Uses a temp copy of the mirror session to avoid locking
the live mirror session.
"""
import asyncio
import json
import random
import shutil
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from telethon import TelegramClient

from telethon_mirror import API_ID, API_HASH, SESSION_PATH

TARGET = -1004317499796  # DTD MAIN STORE
METHODS_DIR = Path("/opt/dtd-mirror/methods")
STATE_FILE = Path("/opt/dtd-mirror/methods_state.json")
TMP_SESSION = Path("/tmp/methods_push.session")
GAP = (10, 25)  # seconds between the two files (anti-spam)

FILES = [
    (
        "APPLE PAY UPDATED METHOD.pdf",
        "📱 <b>APPLE PAY UPDATED METHOD</b> 💳\n\n"
        "🔗 Full details, captions & links are inside the file.\n"
        "🛍 <a href=\"https://dtdpaymentsbot.pages.dev\">dtdpaymentsbot.pages.dev</a>",
    ),
    (
        "PAYPAL UPDATED METHOD.pdf",
        "💙 <b>PAYPAL UPDATED METHOD</b> 💳\n\n"
        "🔗 Full details, captions & links are inside the file.\n"
        "🛍 <a href=\"https://dtdpaymentsbot.pages.dev\">dtdpaymentsbot.pages.dev</a>",
    ),
]


def log(msg: str) -> None:
    print(msg, flush=True)


async def main() -> int:
    today = str(date.today())
    force = "--force" in sys.argv

    state: dict = {}
    if STATE_FILE.exists():
        try:
            state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            state = {}
    if not force and state.get("last_date") == today:
        log(f"[skip] already pushed today ({today})")
        return 0

    shutil.copy(Path(str(SESSION_PATH) + ".session"), TMP_SESSION)
    client = TelegramClient(str(TMP_SESSION), API_ID, API_HASH)
    await client.start()
    me = await client.get_me()
    log(f"[ok] connected as @{getattr(me, 'username', None) or me.id}")

    chat = await client.get_entity(TARGET)
    log(f"[ok] target: {getattr(chat, 'title', None) or TARGET}")

    posted = 0
    total = 0
    for fname, caption in FILES:
        fpath = METHODS_DIR / fname
        if not fpath.exists():
            log(f"[warn] missing {fname}")
            continue
        total += 1
        try:
            await client.send_file(chat, file=str(fpath), caption=caption, parse_mode="html", force_document=True)
            log(f"[ok] {fname}")
            posted += 1
        except Exception as exc:  # noqa: BLE001
            log(f"[error] {fname}: {exc}")
        if total < len(FILES):
            await asyncio.sleep(random.uniform(*GAP))

    await client.disconnect()
    try:
        TMP_SESSION.unlink()
    except Exception:
        pass

    if posted == len(FILES):
        state["last_date"] = today
        STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
        log(f"[done] {posted}/{len(FILES)} posted")
    else:
        log(f"[warn] partial send {posted}/{len(FILES)}, not marking done")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
