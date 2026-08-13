#!/usr/bin/env python3
"""
Poll Supabase smtp_jobs and deliver on the VPS.

  email → local Postfix mailer (127.0.0.1:8787)
  sms   → vps_sms_send (SMSGate and/or Telethon by phone)

Telegram Bot API is used only for admin status notifications (control plane).
Cloudflare Workers never fetch the VPS IP (error 1003).
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

SECRET = os.environ.get("VPS_MAILER_SECRET", "").strip()
MAILER = os.environ.get("LOCAL_MAILER_URL", "http://127.0.0.1:8787").rstrip("/")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
POLL_SECONDS = float(os.environ.get("SMTP_POLL_SECONDS", "2") or "2")
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
ADMIN_CHAT = os.environ.get("TELEGRAM_ADMIN_CHAT_ID", "").strip()

# Ensure sibling module import
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from vps_sms_send import send_bulk
except ImportError:
    send_bulk = None  # type: ignore


def sb(path: str, method: str = "GET", body: dict | None = None, prefer: str = ""):
    if not SUPABASE_URL or not SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required")
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}", data=data, headers=headers, method=method
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else None


def tg_notify(text: str) -> None:
    if not BOT_TOKEN or not ADMIN_CHAT:
        return
    payload = json.dumps(
        {"chat_id": ADMIN_CHAT, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}
    ).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=20).read()
    except Exception:  # noqa: BLE001
        pass


def _ts() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def send_local_mail(payload: dict) -> dict:
    body = dict(payload)
    body["secret"] = SECRET
    raw = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{MAILER}/send",
        data=raw,
        headers={"Content-Type": "application/json", "X-Mailer-Secret": SECRET},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise RuntimeError(detail or f"HTTP {exc.code}") from exc


def claim_jobs(channel: str, limit: int = 5):
    jobs = (
        sb(
            f"smtp_jobs?channel=eq.{channel}&status=eq.queued&order=created_at.asc&limit={limit}",
            prefer="return=representation",
        )
        or []
    )
    # Reclaim stale "sending" jobs stuck after a Worker crash (older than 5 minutes)
    stale_before = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 300)
    )
    stale = (
        sb(
            f"smtp_jobs?channel=eq.{channel}&status=eq.sending&updated_at=lt.{stale_before}&order=created_at.asc&limit={limit}",
            prefer="return=representation",
        )
        or []
    )
    if not stale:
        # Fallback if updated_at missing — use created_at
        stale = (
            sb(
                f"smtp_jobs?channel=eq.{channel}&status=eq.sending&created_at=lt.{stale_before}&order=created_at.asc&limit={limit}",
                prefer="return=representation",
            )
            or []
        )
    for job in stale:
        sb(
            f"smtp_jobs?id=eq.{job['id']}&status=eq.sending",
            method="PATCH",
            body={"status": "queued", "error": "requeued after stale sending"},
            prefer="return=minimal",
        )
        print(f"[{_ts()}] reclaim stale {job['id']}", flush=True)
        jobs.append(job)

    claimed = []
    for job in jobs:
        updated = (
            sb(
                f"smtp_jobs?id=eq.{job['id']}&status=eq.queued",
                method="PATCH",
                body={"status": "sending"},
                prefer="return=representation",
            )
            or []
        )
        if updated:
            claimed.append(updated[0] if isinstance(updated, list) else updated)
    return claimed


def finish(job_id: str, status: str, error: str | None = None):
    sb(
        f"smtp_jobs?id=eq.{job_id}",
        method="PATCH",
        body={"status": status, "error": error},
        prefer="return=minimal",
    )
    # Keep recipient rows in sync with job outcome
    rec_status = "sent" if status in ("sent", "partial") else ("failed" if status == "failed" else status)
    try:
        sb(
            f"smtp_job_recipients?job_id=eq.{job_id}",
            method="PATCH",
            body={"status": rec_status, "error": error},
            prefer="return=minimal",
        )
    except Exception:  # noqa: BLE001
        pass


def process_email(job: dict) -> None:
    payload = job.get("payload") or {}
    if isinstance(payload, str):
        payload = json.loads(payload)
    message = {
        "from": payload.get("from") or os.environ.get("MAIL_FROM", "contact@dvtechnologies.xyz"),
        "to": payload.get("to") or [],
        "cc": payload.get("cc") or [],
        "bcc": payload.get("bcc") or [],
        "subject": payload.get("subject") or job.get("subject") or "",
        "text": payload.get("text"),
        "html": payload.get("html"),
        "headers": payload.get("headers") or {},
    }
    # Forward AWS SES transport settings (stored by the Worker) so the mailer
    # uses SES SMTP (587/STARTTLS) as primary instead of local Postfix.
    for key in (
        "vpsMailMode",
        "smtpHost",
        "smtpUsername",
        "smtpPassword",
    ):
        if payload.get(key):
            message[key] = payload[key]
    result = send_local_mail(message)
    n = len(message["to"]) + len(message.get("cc") or []) + len(message.get("bcc") or [])
    if result.get("ok"):
        finish(job["id"], "sent")
        tg_notify(f"<b>Email delivered</b>\nJob <code>{job['id']}</code>\nRecipients: {n}")
        return
    err = result.get("error") or "remote delivery failed"
    if result.get("partial") or int(result.get("sent") or 0) > 0:
        finish(job["id"], "partial", err[:500])
        tg_notify(f"<b>Email partial</b>\n<code>{job['id']}</code>\n{err[:300]}")
        return
    raise RuntimeError(err)


def process_sms(job: dict) -> None:
    if send_bulk is None:
        raise RuntimeError("SMS worker module not installed on VPS (vps_sms_send.py)")
    payload = job.get("payload") or {}
    if isinstance(payload, str):
        payload = json.loads(payload)
    phones = payload.get("phones") or payload.get("to") or []
    text = payload.get("text") or job.get("body_preview") or ""
    backend = payload.get("backend") or os.environ.get("SMS_BACKEND", "multi")
    gateway = payload.get("gateway") or None
    if not phones or not text:
        raise RuntimeError("SMS job missing phones or text")
    result = send_bulk(
        [str(p) for p in phones],
        str(text),
        backend=str(backend),
        gateway=gateway if isinstance(gateway, dict) else None,
    )
    finish(job["id"], result["status"], result.get("error"))
    tg_notify(
        f"<b>SMS {result['status']}</b>\n"
        f"Job <code>{job['id']}</code>\n"
        f"Sent {result['sent']} · failed {result['failed']}"
        + (f"\n{result['error']}" if result.get("error") else "")
    )
    if result["status"] == "failed":
        raise RuntimeError(result.get("error") or "all SMS failed")


def main() -> None:
    if not SECRET:
        print("VPS_MAILER_SECRET required", file=sys.stderr)
        sys.exit(1)
    if not SUPABASE_URL or not SERVICE_KEY:
        print("Supabase env required", file=sys.stderr)
        sys.exit(1)
    print(f"[{_ts()}] [ok] poller mailer={MAILER} poll={POLL_SECONDS}s sms_module={'yes' if send_bulk else 'no'}")
    while True:
        try:
            for channel, handler in (("email", process_email), ("sms", process_sms)):
                for job in claim_jobs(channel):
                    try:
                        print(f"[{_ts()}] {channel} {job['id']}")
                        handler(job)
                        print(f"[{_ts()}] done {job['id']}")
                    except Exception as exc:  # noqa: BLE001
                        print(f"[{_ts()}] fail {job['id']}: {exc}", file=sys.stderr)
                        finish(job["id"], "failed", str(exc)[:500])
                        tg_notify(f"<b>{channel} failed</b>\n<code>{job['id']}</code>\n{exc}")
        except Exception as exc:  # noqa: BLE001
            print(f"[{_ts()}] poll error: {exc}", file=sys.stderr)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
