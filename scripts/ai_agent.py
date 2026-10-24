"""DTD Self-Promo & Self-Earn Agent.

Generates its own promos and earning opportunities and pushes them to the
channels automatically:
  * deal_loop  — every N hours, posts a limited-time product deal (Stars deep
                 link) with fresh AI copy to both channels.
  * promo_loop — every M hours, posts a rotating store promo (links to store,
                 bot, chat, channels, /tip).
  * pnl_loop   — daily P&L report (orders + payments + Stars) to the admin.

Uses the Bot API only (bot is admin in both channels) + Pollinations text AI —
no Telethon session, so it never conflicts with the mirror.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
for candidate in (ROOT / ".env", Path("/opt/dtd-mirror/.env")):
    if candidate.exists():
        load_dotenv(candidate)

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY") or ""
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
ADMIN_CHAT = os.getenv("TELEGRAM_ADMIN_CHAT_ID", "").strip()
BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "DTDSTOREBOT").lstrip("@")
STORE_URL = os.getenv("STORE_URL", "https://dtdpaymentsbot.pages.dev").rstrip("/")
CHANNELS = (os.getenv("AGENT_CHANNELS") or "-1004317499796,-1004435691493").split(",")
PREMIUM_CHANNEL_ENV = os.getenv("AGENT_PREMIUM_CHANNEL", "").strip()
DEAL_INTERVAL_H = float(os.getenv("AGENT_DEAL_INTERVAL_HOURS", "6") or "6")
PROMO_INTERVAL_H = float(os.getenv("AGENT_PROMO_INTERVAL_HOURS", "8") or "8")
PNL_HOUR = int(os.getenv("AGENT_PNL_HOUR", "23") or "23")
STATE = ROOT / "telethon_sessions" / "ai_agent_state.json"
DEALS_STATE = ROOT / "telethon_sessions" / "ai_agent_deals.json"


def log(msg: str) -> None:
    print(f"[agent] {datetime.now(timezone.utc).strftime('%H:%M:%S')} {msg}", flush=True)


def http_json(url: str, headers: dict | None = None, timeout: int = 40):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "DTDAgent/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def sb_get(table: str, params: dict):
    qs = urllib.parse.urlencode(params)
    return http_json(f"{SUPABASE_URL}/rest/v1/{table}?{qs}", {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })


def sb_patch(table: str, row_id: str, data: dict):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{urllib.parse.quote(str(row_id))}",
        data=json.dumps(data).encode("utf-8"),
        method="PATCH",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()


_SETTINGS_CACHE: dict[str, tuple[str, float]] = {}


def settings_value(key: str, default: str = "") -> str:
    """Read a tunable from Supabase app_settings, cached ~60s."""
    cached = _SETTINGS_CACHE.get(key)
    if cached and (time.time() - cached[1]) < 60:
        return cached[0]
    value = default
    try:
        rows = sb_get("app_settings", {"select": "value", "key": f"eq.{urllib.parse.quote(key)}", "limit": "1"})
        if isinstance(rows, list) and rows:
            value = str(rows[0].get("value") or default)
    except Exception as exc:  # noqa: BLE001
        log(f"settings read {key} failed: {exc}")
    _SETTINGS_CACHE[key] = (value, time.time())
    return value


def command_result(row_id: str, status: str, result: str) -> None:
    try:
        sb_patch("agent_commands", row_id, {
            "status": status,
            "result": str(result)[:500],
            "done_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:  # noqa: BLE001
        log(f"command result update failed: {exc}")


def fetch_commands() -> list[dict]:
    try:
        rows = sb_get("agent_commands", {"select": "id,command,args", "status": "eq.pending", "order": "created_at.asc", "limit": "5"})
        return rows if isinstance(rows, list) else []
    except Exception as exc:  # noqa: BLE001
        log(f"fetch commands failed: {exc}")
        return []


def ai_text(prompt: str) -> str:
    try:
        url = f"https://text.pollinations.ai/{urllib.parse.quote(prompt)}?model=openai"
        req = urllib.request.Request(url, headers={"User-Agent": "DTDAgent/1.0"})
        with urllib.request.urlopen(req, timeout=45) as resp:
            return resp.read().decode("utf-8", "replace").strip()
    except Exception as exc:  # noqa: BLE001
        log(f"ai_text failed: {exc}")
        return ""


def bot_post(method: str, body: dict):
    if not BOT_TOKEN:
        return None
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/{method}",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            return json.loads(resp.read().decode("utf-8", "replace"))
    except Exception as exc:  # noqa: BLE001
        log(f"bot {method} failed: {exc}")
        return None


def load_state() -> dict:
    try:
        with open(STATE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_state(state: dict) -> None:
    try:
        STATE.parent.mkdir(parents=True, exist_ok=True)
        with open(STATE, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
    except Exception:
        pass


def fetch_products() -> list[dict]:
    try:
        rows = sb_get("products", {"select": "*", "active": "eq.true", "order": "price_usd.asc"})
        return rows if isinstance(rows, list) else []
    except Exception as exc:  # noqa: BLE001
        log(f"fetch products failed: {exc}")
        return []


def rotate_choice(items: list, key: str) -> int:
    state = load_state()
    idx = int(state.get(key, 0) or 0)
    state[key] = (idx + 1) % max(len(items), 1)
    save_state(state)
    return idx


def premium_channel_id() -> str:
    """The premium channel id, only if it's one of the agent's channels."""
    pid = PREMIUM_CHANNEL_ENV or "-1004435691493"
    if pid in [c.strip() for c in CHANNELS]:
        return pid
    return ""


# ─── Market brain: flash deals, recovery, surges, social proof ──────

def sb_insert(table: str, data: dict) -> None:
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{table}",
        data=json.dumps(data).encode("utf-8"),
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


def sb_set(table: str, where_col: str, where_val: str, data: dict) -> None:
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{table}?{where_col}=eq.{urllib.parse.quote(str(where_val))}",
        data=json.dumps(data).encode("utf-8"),
        method="PATCH",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()


def market_log(action: str, payload: dict | None = None) -> None:
    try:
        sb_insert("market_log", {"action": action, "payload": payload or {}})
    except Exception as exc:  # noqa: BLE001
        log(f"market_log {action} failed: {exc}")


def parse_ts(value) -> datetime | None:
    if not value:
        return None
    try:
        s = str(value).replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except Exception:  # noqa: BLE001
        return None


def active_flash() -> dict | None:
    try:
        rows = sb_get("flash_deals", {"select": "*", "status": "in.(active,last_chance)", "order": "created_at.desc", "limit": "1"})
        return (rows or [None])[0] if isinstance(rows, list) and rows else None
    except Exception as exc:  # noqa: BLE001
        log(f"active_flash failed: {exc}")
        return None


def _flash_time_left(expires_at: str) -> str:
    exp = parse_ts(expires_at)
    if not exp:
        return "?"
    left = (exp - datetime.now(timezone.utc)).total_seconds()
    if left <= 0:
        return "0m"
    h = int(left // 3600)
    m = int((left % 3600) // 60)
    return f"{h}h {m}m" if h else f"{m}m"


def flash_message(product: dict, flash: dict, phase: str = "start", premium: bool = False) -> str:
    name = str(product.get("name") or flash.get("product_name") or "Product")
    price = float(flash.get("flash_price_usd") or product.get("price_usd") or 0)
    orig = float(flash.get("original_price_usd") or product.get("price_usd") or 0)
    pct = float(flash.get("discount_pct") or 0)
    left = _flash_time_left(str(flash.get("expires_at") or ""))
    pid = str(product.get("id") or flash.get("product_id") or "")
    link = f"https://t.me/{BOT_USERNAME}?start=deal_{pid[:12]}"
    if premium:
        head = "\uD83D\uDC8E <b>DTD PREMIUM EARLY ACCESS \u2014 FLASH SALE</b>"
    elif phase == "last_chance":
        head = "\u23F3 <b>LAST CHANCE \u2014 FLASH SALE ENDS IN 30 MIN</b>"
    elif phase == "expired":
        head = "\uD83D\uDEA8 <b>FLASH SALE OVER \u2014 BACK TO FULL PRICE</b>"
    else:
        head = "\u26A1 <b>FLASH SALE \u2014 LIMITED TIME ONLY</b>"
    if orig > price and price > 0:
        price_line = f"<s>${orig:.2f}</s> \u2192 <b>${price:.2f}</b>  \u00B7  <b>{pct:.0f}% OFF</b>"
    else:
        price_line = f"<b>${price:.2f}</b>"
    lines = [
        head, "",
        f"\uD83D\uDED2 <b>{name}</b>",
        price_line,
        "",
        f"\u23F3 Ends in: <b>{left}</b>",
        f"\uD83D\uDC49 <a href='{link}'>Grab it now \u2192</a>",
        f"\uD83D\uDEC8 <a href='{STORE_URL}'>Open store</a> \u00B7 pay by \u2B50 Stars \u00B7 USDT \u00B7 TON \u00B7 BTC \u00B7 card",
    ]
    if premium:
        lines.append("\uD83D\uDC8E <b>Premium members see the flash first \u2014 the main store follows.</b>")
    return "\n".join(lines)


def start_flash(force: bool = False) -> bool:
    products = fetch_products()
    if not products:
        log("flash: no products")
        return False
    if active_flash() and not force:
        log("flash: already active — skipping")
        return False
    if not force:
        try:
            rows = sb_get("flash_deals", {"select": "created_at,status", "order": "created_at.desc", "limit": "1"})
            last = (rows or [None])[0] if isinstance(rows, list) and rows else None
            if last:
                created = parse_ts(last.get("created_at"))
                min_h = float(settings_value("flash_min_interval_hours", "6") or 6)
                if created and last.get("status") not in ("active", "last_chance") and \
                        (datetime.now(timezone.utc) - created).total_seconds() < min_h * 3600:
                    log(f"flash: last one was {min_h:.0f}h ago — waiting")
                    return False
        except Exception as exc:  # noqa: BLE001
            log(f"flash interval check failed: {exc}")

    discount = max(5, min(90, float(settings_value("flash_discount_pct", "35") or 35)))
    hours = max(1, min(72, float(settings_value("flash_hours", "4") or 4)))
    product = products[rotate_choice(products, "flash_index")]
    pid = str(product.get("id") or "")
    orig = float(product.get("price_usd") or 0)
    if orig <= 0:
        log("flash: product has no price")
        return False
    price = max(0.01, round(orig * (1 - discount / 100.0), 2))
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=hours)
    last_chance = expires - timedelta(minutes=30)
    try:
        import uuid as _uuid
        fid = str(_uuid.uuid4())
        sb_insert("flash_deals", {
            "id": fid, "product_id": pid, "product_name": str(product.get("name") or ""),
            "image_url": str(product.get("image_url") or ""),
            "original_price_usd": orig, "flash_price_usd": price, "discount_pct": discount,
            "started_at": now.isoformat(), "expires_at": expires.isoformat(),
            "last_chance_at": last_chance.isoformat(), "status": "active",
        })
    except Exception as exc:  # noqa: BLE001
        log(f"flash insert failed: {exc}")
        return False

    img = str(product.get("image_url") or "").strip()
    if img.startswith("/"):
        img = f"{SUPABASE_URL.rstrip('/')}{img}"
    premium_cid = premium_channel_id()
    flash_data = {
        "flash_price_usd": price, "original_price_usd": orig, "discount_pct": discount,
        "expires_at": expires.isoformat(), "product_id": pid,
    }
    text = flash_message(product, flash_data)
    premium_text = flash_message(product, flash_data, premium=True) if premium_cid else text
    for cid in CHANNELS:
        cid = cid.strip()
        if not cid:
            continue
        chosen = premium_text if premium_cid and cid == premium_cid else text
        if img:
            bot_post("sendPhoto", {"chat_id": cid, "photo": img, "caption": chosen, "parse_mode": "HTML"})
        else:
            bot_post("sendMessage", {"chat_id": cid, "text": chosen, "parse_mode": "HTML", "disable_web_page_preview": True})
    market_log("flash_started", {"product_id": pid, "discount_pct": discount, "hours": hours})
    log(f"flash started: {product.get('name')} {discount:.0f}% off for {hours}h")
    return True


def check_flash() -> None:
    flash = active_flash()
    if not flash:
        return
    fid = str(flash.get("id") or "")
    status = str(flash.get("status") or "active")
    now = datetime.now(timezone.utc)
    last_chance = parse_ts(flash.get("last_chance_at"))
    expires = parse_ts(flash.get("expires_at"))
    product = {"name": flash.get("product_name"), "id": flash.get("product_id"), "price_usd": flash.get("original_price_usd")}
    if status == "active" and last_chance and now >= last_chance and not flash.get("last_chance_posted"):
        post_to_channels(flash_message(product, flash, phase="last_chance"))
        try:
            sb_set("flash_deals", "id", fid, {"status": "last_chance", "last_chance_posted": True})
        except Exception as exc:  # noqa: BLE001
            log(f"flash last_chance update failed: {exc}")
        market_log("flash_last_chance", {"id": fid})
        log("flash last-chance posted")
        return
    if expires and now >= expires and status != "expired":
        post_to_channels(flash_message(product, flash, phase="expired"))
        try:
            sb_set("flash_deals", "id", fid, {"status": "expired"})
        except Exception as exc:  # noqa: BLE001
            log(f"flash expire update failed: {exc}")
        market_log("flash_expired", {"id": fid})
        log("flash expired")


def _already_nudged(source: str, source_id: str) -> bool:
    try:
        rows = sb_get("abandoned_nudges", {"select": "id", "source": f"eq.{source}", "source_id": f"eq.{source_id}", "limit": "1"})
        return bool(isinstance(rows, list) and rows)
    except Exception:  # noqa: BLE001
        return False


def recover_abandoned() -> int:
    minutes = float(settings_value("abandon_after_minutes", "10") or 10)
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    count = 0
    try:
        rows = sb_get("stars_invoices", {
            "select": "id,status,telegram_user_id,telegram_username,chat_id,product_name,total_usd,created_at",
            "status": "eq.pending", "created_at": f"lt.{cutoff}", "order": "created_at.asc", "limit": "5",
        })
    except Exception as exc:  # noqa: BLE001
        log(f"recover stars fetch failed: {exc}")
        rows = []
    for inv in rows or []:
        uid = str(inv.get("chat_id") or inv.get("telegram_user_id") or "").strip()
        if not uid.isdigit():
            continue
        src_id = str(inv.get("id") or "")
        if _already_nudged("stars", src_id):
            continue
        name = str(inv.get("product_name") or "order")
        amount = float(inv.get("total_usd") or 0)
        text = (
            f"\u23F3 <b>Your order is waiting!</b>\n"
            f"\uD83D\uDED2 {name} \u2014 <b>${amount:.2f}</b> USD\n\n"
            f"Complete your payment now: <a href='{STORE_URL}'>Open checkout \u2192</a>\n"
            f"\u26A1 Your spot is reserved \u00B7 24/7 support"
        )
        ok = bot_post("sendMessage", {"chat_id": uid, "text": text, "parse_mode": "HTML"})
        sb_insert("abandoned_nudges", {
            "source": "stars", "source_id": src_id, "telegram_user_id": uid,
            "telegram_username": str(inv.get("telegram_username") or ""),
            "amount_usd": amount, "product_name": name,
            "nudge_sent_at": datetime.now(timezone.utc).isoformat(),
            "status": "sent" if ok and ok.get("ok") else "pending",
        })
        market_log("nudge_sent", {"source": "stars", "source_id": src_id})
        count += 1

    try:
        rows = sb_get("payments", {
            "select": "id,status,currency,amount_usd,telegram_user_id,telegram_username,created_at",
            "status": "eq.pending", "created_at": f"lt.{cutoff}", "order": "created_at.asc", "limit": "5",
        })
    except Exception as exc:  # noqa: BLE001
        log(f"recover crypto fetch failed: {exc}")
        rows = []
    for pay in rows or []:
        uid = str(pay.get("telegram_user_id") or "").strip()
        if not uid.isdigit():
            continue
        src_id = str(pay.get("id") or "")
        if _already_nudged("crypto", src_id):
            continue
        amount = float(pay.get("amount_usd") or 0)
        cur = str(pay.get("currency") or "crypto")
        text = (
            f"\u23F3 <b>Your crypto payment is still pending</b>\n"
            f"\uD83D\uDC8E <b>{amount:.2f} USD</b> in <b>{cur}</b> hasn't arrived yet.\n\n"
            f"\uD83D\uDC49 <a href='{STORE_URL}'>Continue checkout \u2192</a>\n"
            f"Sent already? Our support verifies it fast."
        )
        ok = bot_post("sendMessage", {"chat_id": uid, "text": text, "parse_mode": "HTML"})
        sb_insert("abandoned_nudges", {
            "source": "crypto", "source_id": src_id, "telegram_user_id": uid,
            "telegram_username": str(pay.get("telegram_username") or ""),
            "amount_usd": amount, "product_name": "crypto order",
            "nudge_sent_at": datetime.now(timezone.utc).isoformat(),
            "status": "sent" if ok and ok.get("ok") else "pending",
        })
        market_log("nudge_sent", {"source": "crypto", "source_id": src_id})
        count += 1

    if count:
        log(f"recovery: {count} nudge(s) sent")
    return count


def surge_active() -> bool:
    try:
        mult = float(settings_value("referral_multiplier", "1") or 1)
        hours = float(settings_value("referral_surge_hours", "0") or 0)
        started = settings_value("referral_surge_started_at", "")
        if mult <= 1 or hours <= 0 or not started:
            return False
        start = parse_ts(started)
        if start and (datetime.now(timezone.utc) - start) > timedelta(hours=hours):
            try:
                sb_set("app_settings", "key", "referral_multiplier", {"value": "1"})
            except Exception as exc:  # noqa: BLE001
                log(f"surge reset failed: {exc}")
            market_log("surge_ended", {"multiplier": mult})
            log("referral surge ended")
            return False
        return True
    except Exception as exc:  # noqa: BLE001
        log(f"surge check failed: {exc}")
        return False


_SURGE_LAST_POST = 0.0


def run_surge(force: bool = False) -> bool:
    global _SURGE_LAST_POST
    if not surge_active() and not force:
        return False
    if not force and time.time() - _SURGE_LAST_POST < 3600:
        return False
    mult = float(settings_value("referral_multiplier", "1") or 1)
    text = (
        f"\uD83E\uDD1D <b>REFERRAL SURGE \u2014 {mult:.0f}X CREDIT</b>\n\n"
        f"Every friend who buys earns you <b>{mult:.0f}X</b> your usual credit.\n"
        f"Share your link \u2192 they get the deal, you get paid.\n\n"
        f"\uD83D\uDC49 <a href='https://t.me/{BOT_USERNAME}?start=refer'>Get your link \u2192</a>\n"
        f"\u26A1 Limited time only!"
    )
    post_to_channels(text)
    _SURGE_LAST_POST = time.time()
    market_log("surge_posted", {"multiplier": mult})
    log(f"surge promo posted ({mult:.0f}x)")
    return True


def post_social_proof() -> int:
    if str(settings_value("social_proof_enabled", "1") or "1") not in ("1", "true", "True"):
        return 0
    min_usd = float(settings_value("proof_min_usd", "0") or 0)
    try:
        rows = sb_get("social_proof_posts", {"select": "*", "status": "eq.pending", "order": "created_at.asc", "limit": "3"})
    except Exception as exc:  # noqa: BLE001
        log(f"proof fetch failed: {exc}")
        return 0
    posted = 0
    for row in rows or []:
        rid = str(row.get("id") or "")
        if not rid:
            continue
        amount = float(row.get("amount_usd") or 0)
        if amount < min_usd:
            try:
                sb_set("social_proof_posts", "id", rid, {"status": "skipped"})
            except Exception:  # noqa: BLE001
                pass
            continue
        name = str(row.get("buyer_name") or "").strip()
        if not name or name.lower() in ("telegram customer", "anon", "a customer") or name.isdigit():
            name = "A customer"
        product = str(row.get("product_name") or "an order").strip()
        kind = str(row.get("kind") or "order")
        if kind == "refer":
            text = f"\uD83E\uDD1D <b>{name}</b> referred a friend \u2014 reward added!"
        elif kind == "tip":
            text = f"\uD83D\uDC9B <b>{name}</b> sent a Star tip \u2014 thank you for supporting DTD!"
        elif kind == "premium":
            text = f"\uD83D\uDC51 <b>{name}</b> joined DTD PREMIUM \u2014 membership unlocked \u2B50"
        else:
            text = (
                f"\uD83D\uDD25 <b>{name}</b> just grabbed <b>{product}</b> \u2014 <b>${amount:.2f}</b> USD\n"
                f"\u26A1 Instant delivery \u00B7 <a href='{STORE_URL}'>Get yours \u2192</a>"
            )
        post_to_channels(text)
        try:
            sb_set("social_proof_posts", "id", rid, {
                "status": "posted", "posted_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception as exc:  # noqa: BLE001
            log(f"proof update failed: {exc}")
        market_log("proof_posted", {"id": rid, "kind": kind})
        posted += 1
        time.sleep(60)
    if posted:
        log(f"social proof: {posted} post(s)")
    return posted


def collect_stats(today: str) -> dict:
    stats = {"orders": 0, "revenue": 0.0, "payments": 0, "crypto_usd": 0.0,
             "stars": 0, "stars_usd": 0.0, "referrals": 0, "chat_activity": 0, "flash": None}
    try:
        orders = sb_get("orders", {"select": "total_usd,created_at,payment_status", "order": "created_at.desc", "limit": "200"})
        for o in orders or []:
            if str(o.get("created_at", ""))[:10] != today:
                continue
            if "paid" in str(o.get("payment_status") or "").lower() or "confirmed" in str(o.get("payment_status") or "").lower():
                stats["orders"] += 1
                stats["revenue"] += float(o.get("total_usd") or 0)
    except Exception as exc:  # noqa: BLE001
        log(f"stats orders failed: {exc}")
    try:
        pays = sb_get("payments", {"select": "amount_usd,created_at,status,currency", "order": "created_at.desc", "limit": "200"})
        for p in pays or []:
            if str(p.get("created_at", ""))[:10] != today or p.get("status") != "confirmed":
                continue
            stats["payments"] += 1
            stats["crypto_usd"] += float(p.get("amount_usd") or 0)
    except Exception as exc:  # noqa: BLE001
        log(f"stats payments failed: {exc}")
    try:
        inv = sb_get("stars_invoices", {"select": "total_usd,stars_amount,status,updated_at", "order": "updated_at.desc", "limit": "200"})
        for i in inv or []:
            if str(i.get("updated_at", ""))[:10] != today or i.get("status") != "paid":
                continue
            stats["stars"] += int(i.get("stars_amount") or 0)
            stats["stars_usd"] += float(i.get("total_usd") or 0)
    except Exception as exc:  # noqa: BLE001
        log(f"stats stars failed: {exc}")
    try:
        refs = sb_get("bot_referrals", {"select": "created_at", "order": "created_at.desc", "limit": "200"})
        for r in refs or []:
            if str(r.get("created_at", ""))[:10] == today:
                stats["referrals"] += 1
    except Exception as exc:  # noqa: BLE001
        log(f"stats referrals failed: {exc}")
    try:
        ch = sb_get("chat_messages", {"select": "created_at", "order": "created_at.desc", "limit": "200"})
        for c in ch or []:
            if str(c.get("created_at", ""))[:10] == today:
                stats["chat_activity"] += 1
    except Exception as exc:  # noqa: BLE001
        log(f"stats chat failed: {exc}")
    try:
        stats["flash"] = (active_flash() or {}).get("product_name")
    except Exception:  # noqa: BLE001
        pass
    return stats


def run_snapshot() -> None:
    today = datetime.now(timezone.utc).date().isoformat()
    stats = collect_stats(today)
    stats["total_usd"] = stats["revenue"] + stats["crypto_usd"] + stats["stars_usd"]
    market_log("snapshot", stats)
    log(f"snapshot: ${stats['total_usd']:.2f} today")


def run_pnl() -> None:
    if not ADMIN_CHAT:
        log("no admin chat — skipping P&L")
        return
    today = datetime.now(timezone.utc).date().isoformat()
    stats = collect_stats(today)
    total = stats["revenue"] + stats["crypto_usd"] + stats["stars_usd"]
    lines = [
        "<b>\uD83D\uDCCA DTD Daily Report</b>",
        f"\uD83D\uDCC5 {today}",
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
        f"\uD83D\uDCCB Orders: <b>{stats['orders']}</b> \u00B7 ${stats['revenue']:.2f}",
        f"\u26D3 Crypto paid: <b>{stats['payments']}</b> \u00B7 ${stats['crypto_usd']:.2f}",
        f"\u2B50 Stars: <b>{stats['stars']}</b> \u00B7 ${stats['stars_usd']:.2f}",
        f"\uD83E\uDD1D Referrals: <b>{stats['referrals']}</b> \u00B7 \uD83D\uDCAC Chat: <b>{stats['chat_activity']}</b>",
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
        f"\uD83D\uDCB0 <b>Total earned today: ${total:.2f}</b>",
    ]
    bot_post("sendMessage", {"chat_id": ADMIN_CHAT, "text": "\n".join(lines), "parse_mode": "HTML"})
    log(f"P&L posted: ${total:.2f} today")


def post_to_channels(text: str, image_url: str | None = None) -> None:
    for cid in CHANNELS:
        cid = cid.strip()
        if not cid:
            continue
        if image_url:
            bot_post("sendPhoto", {"chat_id": cid, "photo": image_url, "caption": text, "parse_mode": "HTML"})
        else:
            bot_post("sendMessage", {"chat_id": cid, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True})


def deal_message(product: dict) -> str:
    name = str(product.get("name") or "")
    desc = str(product.get("description") or "")
    price = float(product.get("price_usd") or 0)
    pid = str(product.get("id") or "")
    link = f"https://t.me/{BOT_USERNAME}?start=deal_{pid[:12]}"
    short = " ".join(desc.split("\n")[0].split()[:18]) if desc else "Instant delivery, trusted store."
    return (
        f"\uD83D\uDD25 <b>DTD DEAL OF THE HOUR</b>\n"
        f"\n"
        f"\uD83D\uDED2 <b>{name}</b>\n"
        f"{short}\n"
        f"\n"
        f"\uD83D\uDC8E Pay instantly with <b>Telegram Stars</b> or crypto.\n"
        f"\u26A1 Instant delivery \u00B7 24/7 support\n"
        f"\n"
        f"\uD83D\uDC49 <a href=\"{link}\">Tap to grab it now \u2192</a>\n"
        f"\n"
        f"Price: ${price:.2f} USD \u00B7 limited slot"
    )


def promo_message() -> str:
    bot_link = f"https://t.me/{BOT_USERNAME}"
    return (
        "\uD83D\uDC51 <b>DTD STORE \u2014 all in one place</b>\n"
        "\n"
        "\uD83D\uDEC8 <b>Store</b>: browse every product & pay your way (\uD83D\uDCB3 Card \u00B7 \u2B50 Stars \u00B7 USDT \u00B7 TON \u00B7 BTC).\n"
        f"\uD83D\uDD17 <a href='{STORE_URL}'>Open the store \u2192</a>\n"
        "\n"
        f"\uD83E\uDD16 <b>Bot</b>: instant checkout & deals \u2192 <a href='{bot_link}'>@{BOT_USERNAME}</a>\n"
        "\n"
        "\uD83D\uDCAC <b>Community chat</b>: deals, questions, video calls.\n"
        "\n"
        "\u2B50 Love what we do? Send a Star tip: /tip\n"
        "\uD83E\uDD1D Refer friends and earn 10% forever: /refer\n"
        "\n"
        "\u26A1 Fast delivery \u00B7 24/7 support"
    )


def run_deal() -> None:
    products = fetch_products()
    if not products:
        log("no products — skipping deal")
        return
    product = products[rotate_choice(products, "deal_index")]
    name = str(product.get("name") or "")
    hook = ai_text(
        f"Write a short punchy one-line sales hook (max 12 words) for a "
        f"premium {name} digital product sold on Telegram. No hashtags."
    )
    if hook:
        log(f"ai hook: {hook}")
    text = deal_message(product)
    if hook and len(hook) < 140:
        text = f"✨ {hook}\n\n" + text
    post_to_channels(text)
    log(f"deal posted for {name}")


def run_promo() -> None:
    post_to_channels(promo_message())
    log("promo posted")


def premium_deal_message(product: dict, pct: float, price: float, orig: float) -> str:
    name = str(product.get("name") or "")
    desc = str(product.get("description") or "")
    pid = str(product.get("id") or "")
    link = f"https://t.me/{BOT_USERNAME}?start=deal_{pid[:12]}"
    short = " ".join(desc.split("\n")[0].split()[:16]) if desc else "Premium member exclusive."
    return "\n".join([
        "\uD83D\uDC8E <b>PREMIUM EXCLUSIVE \u2014 DTD PREMIUM ONLY</b>", "",
        f"\uD83D\uDC51 <b>{name}</b>",
        short, "",
        f"<s>${orig:.2f}</s> \u2192 <b>${price:.2f}</b>  \u00B7  <b>{pct:.0f}% OFF</b>", "",
        "\uD83D\uDEC8 This deal is <b>not on the main store</b>.",
        "\u2B50 Pay with Stars or crypto in seconds.",
        f"\uD83D\uDC49 <a href=\"{link}\">Claim the premium price \u2192</a>", "",
        "\uD83D\uDC8E Join DTD PREMIUM for early access to every deal.",
    ])


def _premium_buttons() -> dict:
    return {
        "inline_keyboard": [[
            {"text": "💎 Get Premium · 20⭐", "url": f"https://t.me/{BOT_USERNAME}?start=premium"},
        ]],
    }


def run_premium_deal() -> bool:
    cid = premium_channel_id()
    if not cid:
        log("premium deal: no premium channel configured")
        return False
    products = fetch_products()
    if not products:
        log("premium deal: no products")
        return False
    product = products[rotate_choice(products, "premium_deal_index")]
    orig = float(product.get("price_usd") or 0)
    if orig <= 0:
        log("premium deal: product has no price")
        return False
    pct = max(10, min(80, float(settings_value("premium_deal_discount_pct", "45") or 45)))
    price = max(0.01, round(orig * (1 - pct / 100.0), 2))
    text = premium_deal_message(product, pct, price, orig)
    ok = bot_post("sendMessage", {
        "chat_id": cid, "text": text, "parse_mode": "HTML", "reply_markup": _premium_buttons(),
    })
    if ok and ok.get("ok"):
        market_log("premium_deal_posted", {"product_id": str(product.get("id") or ""), "discount_pct": pct})
        log(f"premium deal posted: {product.get('name')} {pct:.0f}% off")
    else:
        log("premium deal post failed")
    return bool(ok and ok.get("ok"))


def run_premium_digest() -> None:
    cid = premium_channel_id()
    if not cid:
        log("premium digest: no premium channel configured")
        return
    today = datetime.now(timezone.utc).date().isoformat()
    stats = collect_stats(today)
    total = stats["revenue"] + stats["crypto_usd"] + stats["stars_usd"]
    flash = active_flash()
    flash_line = (
        f"\u26A1 Flash live: <b>{flash.get('product_name')}</b> \u2014 on premium now"
        if flash
        else "\u26A1 Next flash drops soon \u2014 announced here first"
    )
    lines = [
        "\uD83D\uDC51 <b>DTD PREMIUM DIGEST</b>",
        f"\uD83D\uDCC5 {today}",
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
        f"\uD83D\uDD25 Sold today: <b>{stats['orders']} orders</b> \u00B7 <b>${total:.2f}</b>",
        f"\u2B50 Stars: <b>{stats['stars']}</b> \u00B7 \uD83E\uDD1D Referrals: <b>{stats['referrals']}</b>",
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
        flash_line,
        "",
        "\uD83D\uDC8E Premium members get deals before anyone else.",
        f"\uD83D\uDC49 <a href='https://t.me/{BOT_USERNAME}?start=premium'>Claim today's premium offer \u2192</a>",
        f"\uD83D\uDEC8 <a href='{STORE_URL}'>Open store</a>",
    ]
    ok = bot_post("sendMessage", {
        "chat_id": cid, "text": "\n".join(lines), "parse_mode": "HTML", "reply_markup": _premium_buttons(),
    })
    market_log("premium_digest", {"total_today": total})
    log("premium digest posted")


def sleep_until(hour: int) -> float:
    now = datetime.now().astimezone()
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if now >= target:
        target += timedelta(days=1)
    return max((target - now).total_seconds(), 5.0)


def main() -> None:
    if not BOT_TOKEN:
        log("Missing TELEGRAM_BOT_TOKEN")
        sys.exit(1)
    if not CHANNELS or not CHANNELS[0]:
        log("Missing AGENT_CHANNELS")
        sys.exit(1)
    log(f"agent started (deal={DEAL_INTERVAL_H}h promo={PROMO_INTERVAL_H}h pnl={PNL_HOUR}h market=on)")

    next_deal = time.monotonic() + 300  # first deal shortly after start
    next_promo = time.monotonic() + 600
    next_pnl = time.monotonic() + sleep_until(PNL_HOUR)
    next_cmd = time.monotonic() + 45
    next_flash = time.monotonic() + 90
    next_recover = time.monotonic() + 120
    next_proof = time.monotonic() + 150
    next_surge = time.monotonic() + 60
    next_snapshot = time.monotonic() + 600
    next_premium_deal = time.monotonic() + 420
    next_premium_digest = time.monotonic() + sleep_until(int(float(settings_value("premium_digest_hour", "18") or 18)))

    while True:
        now = time.monotonic()
        try:
            deal_h = float(settings_value("deal_interval_hours", str(DEAL_INTERVAL_H)) or DEAL_INTERVAL_H)
            promo_h = float(settings_value("promo_interval_hours", str(PROMO_INTERVAL_H)) or PROMO_INTERVAL_H)
            pnl_hour = int(float(settings_value("pnl_hour", str(PNL_HOUR)) or PNL_HOUR))
            premium_deal_h = float(settings_value("premium_deal_interval_hours", "6") or 6)
            premium_digest_hour = int(float(settings_value("premium_digest_hour", "18") or 18))

            # Scheduled marketing loops
            if now >= next_deal:
                run_deal()
                next_deal = time.monotonic() + max(deal_h, 0.5) * 3600
            if now >= next_promo:
                run_promo()
                next_promo = time.monotonic() + max(promo_h, 0.5) * 3600
            if now >= next_pnl:
                run_pnl()
                next_pnl = time.monotonic() + sleep_until(pnl_hour)

            # Market brain
            if now >= next_flash:
                next_flash = time.monotonic() + 60
                check_flash()
                if not active_flash():
                    start_flash(force=False)
            if now >= next_recover:
                next_recover = time.monotonic() + 90
                recover_abandoned()
            if now >= next_proof:
                next_proof = time.monotonic() + 90
                post_social_proof()
            if now >= next_surge:
                next_surge = time.monotonic() + 60
                run_surge(force=False)
            if now >= next_snapshot:
                next_snapshot = time.monotonic() + 900
                run_snapshot()

            # Premium channel — exclusive deals + daily digest
            if now >= next_premium_deal:
                run_premium_deal()
                next_premium_deal = time.monotonic() + max(premium_deal_h, 0.5) * 3600
            if now >= next_premium_digest:
                run_premium_digest()
                next_premium_digest = time.monotonic() + sleep_until(premium_digest_hour)

            # Admin-queued commands (mirror owns promo/story/pin)
            if now >= next_cmd:
                next_cmd = time.monotonic() + 45
                for cmd in fetch_commands():
                    cname = str(cmd.get("command") or "").strip()
                    cid = str(cmd.get("id") or "")
                    if not cid:
                        continue
                    if cname == "deal":
                        run_deal()
                        command_result(cid, "done", "deal posted")
                    elif cname == "flash":
                        ok = start_flash(force=True)
                        command_result(cid, "done" if ok else "failed", "flash started" if ok else "flash could not start")
                    elif cname == "surge":
                        ok = run_surge(force=True)
                        command_result(cid, "done" if ok else "failed", "surge promo posted" if ok else "surge not active")
        except Exception as exc:  # noqa: BLE001
            log(f"loop failed: {exc}")
        time.sleep(60)


if __name__ == "__main__":
    main()
