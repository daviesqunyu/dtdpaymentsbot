"""DTD Earn Poller — watches TON + USDT(TRC20) addresses and auto-confirms payments.

Confirms `payments` rows in Supabase, marks the linked order paid, credits the
referrer, and notifies buyer + admin via the Telegram bot. Bot-API + REST only
(no Telethon session), so it can run alongside the mirror.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
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
TON_ADDRESS = os.getenv("TON_PAYMENT_ADDRESS") or os.getenv("TON_ADDRESS") or ""
USDT_ADDRESS = os.getenv("USDT_TRC20_ADDRESS", "").strip()
TON_API = os.getenv("TON_API_URL", "https://tonapi.io").rstrip("/")
TRONGRID = os.getenv("TRONGRID_API_URL", "https://api.trongrid.io").rstrip("/")
USDT_CONTRACT = os.getenv("USDT_TRC20_CONTRACT", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")
POLL_SECONDS = int(os.getenv("EARN_POLL_SECONDS", "20") or "20")
TON_CONFIRMS = int(os.getenv("TON_MIN_CONFIRMATIONS", "1") or "1")
TRON_CONFIRMS = int(os.getenv("TRON_MIN_CONFIRMATIONS", "1") or "1")
STATE = ROOT / "telethon_sessions" / "earn_poller_state.json"

USDT_DECIMALS = 10 ** 6


def log(msg: str) -> None:
    print(f"[earn] {datetime.now(timezone.utc).strftime('%H:%M:%S')} {msg}", flush=True)


def http_json(url: str, headers: dict | None = None, timeout: int = 30):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "DTDEarn/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def sb_get(table: str, params: dict):
    qs = urllib.parse.urlencode(params)
    return http_json(f"{SUPABASE_URL}/rest/v1/{table}?{qs}", {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })


def sb_patch(table: str, row_id: str, data: dict, id_col: str = "id"):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{id_col}=eq.{urllib.parse.quote(str(row_id))}"
    req = urllib.request.Request(
        url,
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


def sb_insert(table: str, data: dict):
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
        with urllib.request.urlopen(req, timeout=30) as resp:
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


def fetch_pending() -> list[dict]:
    try:
        rows = sb_get("payments", {
            "select": "*",
            "status": "eq.pending",
            "currency": "in.(TON,USDT)",
            "order": "created_at.asc",
        })
        return rows if isinstance(rows, list) else []
    except Exception as exc:  # noqa: BLE001
        log(f"fetch pending failed: {exc}")
        return []


def ton_incoming(address: str) -> list[dict]:
    """Incoming TON coin transfers from tonapi (amounts in nanoTON)."""
    url = f"{TON_API}/v2/accounts/{address}/events?limit=50&subject_only=true"
    data = http_json(url)
    out = []
    for event in data.get("events", []) or []:
        for action in event.get("actions", []) or []:
            transfer = action.get("ton_transfer") or {}
            if transfer.get("direction") != "in":
                continue
            source = (transfer.get("source") or {}).get("address", "")
            out.append({
                "hash": event.get("event_id", ""),
                "amount": int(transfer.get("amount", 0)),  # nanoTON
                "source": source,
            })
    return out


def trc20_incoming(address: str) -> list[dict]:
    url = (
        f"{TRONGRID}/v1/accounts/{address}/transactions/trc20"
        f"?limit=50&only_confirmed=true&contract_address={USDT_CONTRACT}&order_by=block_timestamp,asc"
    )
    data = http_json(url)
    out = []
    for tx in data.get("data", []) or []:
        if str(tx.get("to", "")).lower() != address.lower():
            continue
        out.append({
            "hash": tx.get("transaction_id", ""),
            "value": int(tx.get("value", 0)),
            "source": tx.get("from", ""),
        })
    return out


def credit_referrer(user_id: str, usd: float, note: str) -> None:
    if not user_id:
        return
    try:
        refs = sb_get("bot_referrals", {"select": "*", "referred_user_id": f"eq.{urllib.parse.quote(str(user_id))}"})
        ref = (refs or [{}])[0] if isinstance(refs, list) and refs else None
        if not ref or not ref.get("referrer_user_id"):
            return
        referrer = str(ref["referrer_user_id"])
        if referrer == str(user_id):
            return
        commission = round(float(usd or 0) * 0.1, 2)
        if commission <= 0:
            return
        creds = sb_get("bot_credits", {"select": "*", "user_id": f"eq.{urllib.parse.quote(referrer)}"})
        row = (creds or [{}])[0] if isinstance(creds, list) and creds else None
        if row:
            sb_patch("bot_credits", referrer, {
                "balance_usd": round(float(row.get("balance_usd") or 0) + commission, 2),
                "lifetime_earned_usd": round(float(row.get("lifetime_earned_usd") or 0) + commission, 2),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, id_col="user_id")
        else:
            sb_insert("bot_credits", {"user_id": referrer, "balance_usd": commission, "lifetime_earned_usd": commission})
        sb_insert("earn_events", {
            "user_id": referrer,
            "kind": "referral_conversion",
            "amount_usd": commission,
            "note": note or None,
        })
        if ref.get("status") != "converted":
            sb_patch("bot_referrals", str(user_id), {"status": "converted", "converted_at": datetime.now(timezone.utc).isoformat()}, id_col="referred_user_id")
        log(f"credited referrer {referrer} +${commission}")
    except Exception as exc:  # noqa: BLE001
        log(f"credit_referrer failed: {exc}")


def confirm_payment(payment: dict, tx_hash: str, confirms: int) -> None:
    pid = str(payment["id"])
    try:
        sb_patch("payments", pid, {
            "status": "confirmed",
            "tx_hash": tx_hash,
            "confirmations": confirms,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:  # noqa: BLE001
        log(f"confirm payment failed: {exc}")
        return
    log(f"PAYMENT CONFIRMED {payment.get('currency')} {payment.get('amount')} tx={tx_hash}")

    order_id = payment.get("order_id")
    buyer_id = payment.get("telegram_user_id")
    usd = float(payment.get("amount_usd") or 0)

    if order_id:
        try:
            sb_patch("orders", order_id, {"payment_status": "paid", "order_status": "confirmed"})
        except Exception as exc:  # noqa: BLE001
            log(f"order update failed: {exc}")

    if buyer_id:
        credit_referrer(buyer_id, usd, f"{payment.get('currency')} payment {tx_hash[:12]}")

    who = payment.get("telegram_username") or buyer_id or "?"
    chat = buyer_id or ADMIN_CHAT
    if ADMIN_CHAT:
        lines = [
            "<b>✅ Crypto payment confirmed (auto)</b>",
            f"🧾 Currency: <b>{payment.get('currency')}</b> · {payment.get('amount')}",
            f"💵 ≈ ${usd:.2f} USD",
            f"🔗 Tx: <code>{tx_hash}</code>",
            order_id and f"🔖 Order: <code>{order_id}</code>",
            f"👤 Customer: {who}",
            "",
            "Deliver the product to the customer.",
        ]
        bot_post("sendMessage", {
            "chat_id": ADMIN_CHAT,
            "text": "\n".join(line for line in lines if line),
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        })
    if chat and chat != ADMIN_CHAT:
        bot_post("sendMessage", {
            "chat_id": chat,
            "text": (
                "✅ <b>Payment confirmed on-chain!</b>\n"
                + (f"Order <code>{order_id}</code> is being processed.\n" if order_id else "")
                + "Our team will deliver your product shortly."
            ),
            "parse_mode": "HTML",
        })


def match_and_confirm(payments: list[dict], currency: str, transfers: list[dict]) -> None:
    state = load_state()
    seen = set(state.get("seen_tx", []))
    targets = [p for p in payments if p.get("currency") == currency]
    for tx in transfers:
        if not tx["hash"] or tx["hash"] in seen:
            continue
        for payment in targets:
            expected = float(payment.get("amount") or 0)
            received = tx["amount"]
            if currency == "TON":
                received_ton = received / 1e9
                if abs(received_ton - expected) / max(expected, 1e-9) <= 0.05:
                    confirm_payment(payment, tx["hash"], TON_CONFIRMS)
                    seen.add(tx["hash"])
                    break
            else:
                received_usdt = received / USDT_DECIMALS
                if abs(received_usdt - expected) / max(expected, 1e-9) <= 0.05:
                    confirm_payment(payment, tx["hash"], TRON_CONFIRMS)
                    seen.add(tx["hash"])
                    break
    state["seen_tx"] = sorted(seen)[-5000:]
    save_state(state)


def one_round() -> None:
    payments = fetch_pending()
    if not payments:
        return
    if TON_ADDRESS:
        try:
            match_and_confirm(payments, "TON", ton_incoming(TON_ADDRESS))
        except Exception as exc:  # noqa: BLE001
            log(f"ton scan failed: {exc}")
    if USDT_ADDRESS:
        try:
            match_and_confirm(payments, "USDT", trc20_incoming(USDT_ADDRESS))
        except Exception as exc:  # noqa: BLE001
            log(f"trc20 scan failed: {exc}")


def main() -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("Missing SUPABASE_URL / SUPABASE_KEY")
        sys.exit(1)
    log(f"poller started (TON={'yes' if TON_ADDRESS else 'no'} USDT={'yes' if USDT_ADDRESS else 'no'}, poll={POLL_SECONDS}s)")
    while True:
        try:
            one_round()
        except Exception as exc:  # noqa: BLE001
            log(f"round failed: {exc}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
