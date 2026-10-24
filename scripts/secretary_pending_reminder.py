#!/usr/bin/env python3
"""DTD Secretary — automatic pending-order reminders (every 3 hours via systemd timer).

Reads /opt/dtd-mirror/.env for Supabase + Telegram credentials.
For each order still pending payment, resolves the buyer's Telegram chat and
sends a reminder. State is kept so a single order is reminded at most once
per 3 hours (prevents spammy duplicate sends).
"""
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

ENV_FILE = Path("/opt/dtd-mirror/.env")
STATE_FILE = Path("/opt/dtd-mirror/secretary_state.json")
LOG_FILE = Path("/opt/dtd-mirror/secretary_pending.log")
MIN_INTERVAL_SECONDS = 3 * 3600


def load_env(path):
    env = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return env


def log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts} {msg}"
    print(line, flush=True)
    try:
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def http_json(url, headers=None, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode() or "{}")


def fetch_pending_orders(env):
    base = env.get("SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_ANON_KEY", "")
    if not base or not key:
        return []
    url = (
        f"{base}/rest/v1/orders?select=id,customer_name,customer_phone,"
        "customer_email,telegram_username,delivery_details,payment_method,"
        "payment_status,total_usd,created_at"
        "&payment_status=eq.pending&order=created_at.asc&limit=500"
    )
    rows = http_json(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    return rows if isinstance(rows, list) else []


def resolve_chat_id(env, order):
    token = env.get("TELEGRAM_BOT_TOKEN", "")
    phone = str(order.get("customer_phone") or "").strip()
    if re.fullmatch(r"\d{5,}", phone):
        return phone
    dd = str(order.get("delivery_details") or "")
    m = re.search(r"(?:[Ii][Dd][:\s#]*|id\s+)(\d{5,})", dd) or re.search(r"[Tt]elegram[^\d]{0,20}(\d{5,})", dd)
    if m:
        return m.group(1)
    username = str(order.get("telegram_username") or "").lstrip("@").strip()
    if username and token:
        try:
            resp = http_json(
                f"https://api.telegram.org/bot{token}/getChat?chat_id=@{username}"
            )
            if resp.get("ok") and resp.get("result", {}).get("id"):
                return str(resp["result"]["id"])
        except Exception:
            pass
    return None


def send_reminder(env, chat_id, order):
    token = env.get("TELEGRAM_BOT_TOKEN", "")
    if not token:
        return "fail"
    store = (env.get("STORE_URL") or "https://dtdpaymentsbot.pages.dev").rstrip("/")
    owner = (env.get("TELEGRAM_OWNER_USERNAME") or "Glock7money").lstrip("@")
    name = str(order.get("customer_name") or "Customer")
    total = float(order.get("total_usd") or 0)
    method = str(order.get("payment_method") or "")
    order_ref = str(order.get("id") or "")[:12]
    message = (
        "⏰ <b>DTD Store — Payment Reminder</b>\n\n"
        f"Hi <b>{name}</b>, you have an order still waiting for payment:\n\n"
        f"🔖 Order: <code>{order_ref}</code>\n"
        f"💵 Amount: <b>${total:,.2f} USD</b>\n"
        f"💳 Method: {method}\n\n"
        f"🛍 Complete your payment here: <a href=\"{store}\">{store.replace('https://', '')}</a>\n\n"
        "Once paid, your order is delivered instantly.\n"
        f"Need help? <a href=\"https://t.me/{owner}\">@{owner}</a>"
    )
    payload = json.dumps(
        {"chat_id": chat_id, "text": message, "parse_mode": "HTML"}
    ).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
        return "ok" if data.get("ok") else "fail"
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        # Chat has never started the bot, or blocked it -> permanently not contactable.
        if e.code == 400 and "chat not found" in body.lower():
            log(f"permanent -> {chat_id}")
            return "permanent"
        if e.code == 403:
            log(f"permanent -> {chat_id}: HTTP 403")
            return "permanent"
        if e.code == 429:
            log(f"rate-limited -> {chat_id}: HTTP 429")
            time.sleep(3)
            return "fail"
        log(f"send failed -> {chat_id}: HTTP {e.code}")
        return "fail"
    except Exception as e:
        log(f"send failed -> {chat_id}: {e}")
        return "fail"


def main():
    env = load_env(ENV_FILE)
    state = {}
    if STATE_FILE.exists():
        try:
            state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            state = {}
    now = int(time.time())
    orders = fetch_pending_orders(env)
    if not orders:
        log("no pending orders")
        return 0
    sent = 0
    failed = 0
    no_contact = 0
    changed = False
    for order in orders:
        oid = str(order.get("id") or "")
        last = state.get(oid, 0)
        if now - last < MIN_INTERVAL_SECONDS:
            continue
        # Orders previously marked permanently unreachable: skip permanently.
        if state.get(oid + ":perm"):
            continue
        chat_id = resolve_chat_id(env, order)
        if not chat_id:
            no_contact += 1
            continue
        result = send_reminder(env, chat_id, order)
        if result == "ok":
            sent += 1
            state[oid] = now
            changed = True
        elif result == "permanent":
            state[oid] = now
            state[oid + ":perm"] = True
            changed = True
        else:
            failed += 1
    if changed:
        STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    log(f"pending={len(orders)} sent={sent} failed={failed} no_contact={no_contact}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
