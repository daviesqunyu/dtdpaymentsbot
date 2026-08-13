#!/usr/bin/env python3
"""
VPS multi-channel messenger (Telethon + SMSGate + WhatsApp).

SMSGate (free Android app + your SIM) is the primary real-SMS path.
Gateway credentials can come from:
  - job payload (pasted in console free inputs), or
  - VPS env SMS_GATEWAY_*
"""

from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from typing import Any


def _gateway_send(
    phone: str,
    text: str,
    gateway: dict[str, str] | None = None,
) -> dict[str, Any]:
    gw = gateway or {}
    base = (
        gw.get("url")
        or os.environ.get("SMS_GATEWAY_URL", "")
    ).rstrip("/")
    user = (gw.get("user") or os.environ.get("SMS_GATEWAY_USER", "")).strip()
    password = (
        gw.get("pass")
        or os.environ.get("SMS_GATEWAY_PASS")
        or os.environ.get("SMS_GATEWAY_TOKEN")
        or ""
    ).strip()
    if not base:
        return {
            "ok": False,
            "error": "SMS gateway unset — paste SMSGate user/pass in the console",
            "via": "sms",
        }
    if not user or not password:
        return {
            "ok": False,
            "error": "SMSGate username/password required",
            "via": "sms",
        }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Basic {base64.b64encode(f'{user}:{password}'.encode()).decode()}",
    }

    urls = []
    if "/messages" in base or "/3rdparty/" in base:
        urls.append(base)
    else:
        urls.extend(
            [
                f"{base}/messages",
                f"{base}/3rdparty/v1/messages",
                base,
            ]
        )

    bodies = [
        {"textMessage": {"text": text}, "phoneNumbers": [phone]},
        {"phoneNumbers": [phone], "message": text, "text": text},
    ]

    last = "gateway request failed"
    for url in urls:
        for body in bodies:
            req = urllib.request.Request(
                url,
                data=json.dumps(body).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    raw = resp.read().decode("utf-8", "replace")
                    try:
                        data = json.loads(raw) if raw else {}
                    except json.JSONDecodeError:
                        data = {"raw": raw}
                    return {"ok": True, "data": data, "via": "sms"}
            except urllib.error.HTTPError as exc:
                last = exc.read().decode("utf-8", "replace")[:200] or f"HTTP {exc.code}"
                if exc.code not in (400, 404, 405):
                    return {"ok": False, "error": last, "via": "sms"}
            except Exception as exc:  # noqa: BLE001
                last = str(exc)[:200]
    return {"ok": False, "error": last, "via": "sms"}


def _whatsapp_send(phone: str, text: str) -> dict[str, Any]:
    token = (
        os.environ.get("WHATSAPP_TOKEN") or os.environ.get("WHATSAPP_ACCESS_TOKEN") or ""
    ).strip()
    phone_id = (
        os.environ.get("WHATSAPP_PHONE_NUMBER_ID") or os.environ.get("WHATSAPP_PHONE_ID") or ""
    ).strip()
    if not token or not phone_id:
        return {"ok": False, "error": "WhatsApp unset", "via": "whatsapp"}

    to = phone.lstrip("+")
    url = f"https://graph.facebook.com/v19.0/{phone_id}/messages"
    body = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"preview_url": False, "body": text[:4096]},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace") or "{}")
            return {"ok": True, "data": data, "via": "whatsapp"}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:240]
        return {"ok": False, "error": detail or f"HTTP {exc.code}", "via": "whatsapp"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)[:240], "via": "whatsapp"}


def _telethon_send_many(phones: list[str], text: str) -> list[dict[str, Any]]:
    """Send to many phones on one Telethon connection. Returns per-phone results."""
    try:
        from telethon import TelegramClient
        from telethon.sessions import StringSession
        from telethon.tl.functions.contacts import ImportContactsRequest
        from telethon.tl.types import InputPhoneContact
    except ImportError:
        return [{"ok": False, "error": "telethon not installed", "via": "telegram", "phone": p} for p in phones]

    api_id = os.environ.get("TELEGRAM_API_ID") or os.environ.get("TELETHON_API_ID")
    api_hash = os.environ.get("TELEGRAM_API_HASH") or os.environ.get("TELETHON_API_HASH")
    session = os.environ.get("TELETHON_SESSION") or "/opt/dtd-mailer/telethon.session"
    string_path = "/opt/dtd-mailer/telethon.string"
    if not api_id or not api_hash:
        return [{"ok": False, "error": "TELEGRAM_API_ID / HASH missing", "via": "telegram", "phone": p} for p in phones]

    import asyncio
    import random

    async def _run() -> list[dict[str, Any]]:
        session_obj: Any = session
        if os.path.isfile(string_path):
            raw = open(string_path, encoding="utf-8").read().strip()
            if raw:
                session_obj = StringSession(raw)
        client = TelegramClient(session_obj, int(api_id), api_hash)
        await client.connect()
        out: list[dict[str, Any]] = []
        if not await client.is_user_authorized():
            await client.disconnect()
            return [
                {"ok": False, "error": "Telethon not authorized", "via": "telegram", "phone": p}
                for p in phones
            ]

        me = await client.get_me()
        my_id = getattr(me, "id", None)

        for phone in phones:
            try:
                client_id = random.randint(1, 2_000_000_000)
                contact = InputPhoneContact(
                    client_id=client_id,
                    phone=phone.lstrip("+"),
                    first_name="DTD",
                    last_name=phone[-4:],
                )
                result = await client(ImportContactsRequest([contact]))
                user = result.users[0] if result.users else None
                if not user:
                    try:
                        user = await client.get_entity(phone)
                    except Exception:  # noqa: BLE001
                        user = None
                if not user:
                    out.append(
                        {
                            "ok": False,
                            "error": f"{phone} not on Telegram (or privacy hides phone)",
                            "via": "telegram",
                            "phone": phone,
                        }
                    )
                    continue

                uid = getattr(user, "id", None)
                uname = getattr(user, "username", None) or ""
                # Sending to yourself is easy to miss — still deliver + label
                note = f"@{uname}" if uname else f"id:{uid}"
                if uid == my_id:
                    note = f"SELF ({note})"

                await client.send_message(user, text)
                out.append(
                    {
                        "ok": True,
                        "via": "telegram",
                        "phone": phone,
                        "user_id": uid,
                        "to": note,
                    }
                )
            except Exception as exc:  # noqa: BLE001
                out.append(
                    {
                        "ok": False,
                        "error": str(exc)[:300],
                        "via": "telegram",
                        "phone": phone,
                    }
                )

        await client.disconnect()
        return out

    try:
        return asyncio.get_event_loop().run_until_complete(_run())
    except RuntimeError:
        return asyncio.run(_run())
    except Exception as exc:  # noqa: BLE001
        return [{"ok": False, "error": str(exc)[:300], "via": "telegram", "phone": p} for p in phones]


def _telethon_send(phone: str, text: str) -> dict[str, Any]:
    rows = _telethon_send_many([phone], text)
    return rows[0] if rows else {"ok": False, "error": "telethon failed", "via": "telegram"}


def send_sms(
    phone: str,
    text: str,
    backend: str = "multi",
    gateway: dict[str, str] | None = None,
) -> dict[str, Any]:
    backend = (backend or os.environ.get("SMS_BACKEND", "multi") or "multi").strip().lower()
    if backend == "auto":
        backend = "multi"

    has_gw = bool(
        (gateway and gateway.get("url") and gateway.get("user") and gateway.get("pass"))
        or (
            os.environ.get("SMS_GATEWAY_URL", "").strip()
            and os.environ.get("SMS_GATEWAY_USER", "").strip()
        )
    )

    # SMS-first when user provided gateway (what they asked for)
    if backend in ("sms", "smsgate"):
        channels = ["sms"]
    elif backend in ("telegram", "telethon"):
        channels = ["telegram"]
    elif backend == "whatsapp":
        channels = ["whatsapp"]
    else:
        channels = []
        if has_gw:
            channels.append("sms")
        channels.append("telegram")
        if (
            os.environ.get("WHATSAPP_TOKEN") or os.environ.get("WHATSAPP_ACCESS_TOKEN", "")
        ).strip() and (
            os.environ.get("WHATSAPP_PHONE_NUMBER_ID") or os.environ.get("WHATSAPP_PHONE_ID", "")
        ).strip():
            channels.append("whatsapp")

    results: list[dict[str, Any]] = []
    for ch in channels:
        if ch == "sms":
            results.append(_gateway_send(phone, text, gateway=gateway))
        elif ch == "telegram":
            results.append(_telethon_send(phone, text))
        elif ch == "whatsapp":
            results.append(_whatsapp_send(phone, text))

    ok_via = [r["via"] for r in results if r.get("ok")]
    fail_parts = [
        f"{r.get('via')}: {r.get('error')}" for r in results if not r.get("ok") and r.get("error")
    ]
    if ok_via:
        return {
            "ok": True,
            "via": "+".join(ok_via),
            "channels": results,
            "failed_channels": fail_parts,
        }
    return {
        "ok": False,
        "error": "; ".join(fail_parts) or "all channels failed",
        "channels": results,
    }


def send_bulk(
    phones: list[str],
    text: str,
    backend: str = "multi",
    gateway: dict[str, str] | None = None,
) -> dict[str, Any]:
    backend = (backend or os.environ.get("SMS_BACKEND", "multi") or "multi").strip().lower()
    if backend == "auto":
        backend = "multi"

    sent = 0
    failed = 0
    errors: list[str] = []
    details: list[str] = []

    # Fast path: Telethon-only — one connection for all phones
    if backend in ("telegram", "telethon"):
        rows = _telethon_send_many([str(p) for p in phones], text)
        for r in rows:
            phone = r.get("phone") or "?"
            if r.get("ok"):
                sent += 1
                details.append(f"{phone}→{r.get('to') or 'telegram'}")
            else:
                failed += 1
                errors.append(f"{phone}: {r.get('error') or 'failed'}")
        status = "sent" if failed == 0 else ("failed" if sent == 0 else "partial")
        return {
            "ok": sent > 0,
            "status": status,
            "sent": sent,
            "failed": failed,
            "error": "; ".join(errors[:6] + ([f"delivered: {', '.join(details[:6])}"] if details else []))
            or None,
        }

    for phone in phones:
        result = send_sms(phone, text, backend=backend, gateway=gateway)
        if result.get("ok"):
            sent += 1
            details.append(f"{phone} via {result.get('via')}")
        else:
            failed += 1
            errors.append(f"{phone}: {result.get('error') or 'failed'}")
    status = "sent" if failed == 0 else ("failed" if sent == 0 else "partial")
    return {
        "ok": sent > 0,
        "status": status,
        "sent": sent,
        "failed": failed,
        "error": "; ".join(errors[:5]) if errors else None,
    }


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        print("Usage: vps_sms_send.py +2547… 'message'")
        sys.exit(2)
    out = send_sms(sys.argv[1], " ".join(sys.argv[2:]), backend="multi")
    print(json.dumps(out, indent=2))
    sys.exit(0 if out.get("ok") else 1)
