#!/usr/bin/env python3
"""
Local authenticated mailer for DTD SMTP console.
Listens on 127.0.0.1:8787 and sends via local Postfix.

After enqueue, waits and reads /var/log/mail.log so "ok" means
remote delivery succeeded — not merely accepted into the queue.
Gmail SPF/DKIM rejects will return ok=false with the bounce text.
"""

from __future__ import annotations

import json
import os
import re
import smtplib
import sys
import time
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


SECRET = os.environ.get("VPS_MAILER_SECRET", "").strip()
MAIL_FROM = os.environ.get("MAIL_FROM", "contact@dvtechnologies.xyz").strip()
MAIL_DOMAIN = (
    os.environ.get("MAIL_DOMAIN")
    or (MAIL_FROM.split("@")[-1] if "@" in MAIL_FROM else "dvtechnologies.xyz")
).strip().lower()

# Delivery transport mode:
#   aws_ses  → send directly via AWS SES SMTP (587, STARTTLS) — primary, best deliverability
#   postfix  → relay via local Postfix (25) — fallback
VPS_MAIL_MODE = os.environ.get("VPS_MAIL_MODE", "aws_ses").strip().lower()

# AWS SES SMTP relay credentials (used when VPS_MAIL_MODE=aws_ses)
SES_SMTP_HOST = os.environ.get("SMTP_HOST", os.environ.get("AWS_SES_SMTP_HOST", "")).strip()
SES_SMTP_PORT = int(os.environ.get("SMTP_PORT", "587") or "587")
SES_SMTP_USER = os.environ.get("SMTP_USERNAME", os.environ.get("AWS_SES_SMTP_USERNAME", "")).strip()
SES_SMTP_PASS = os.environ.get("SMTP_PASSWORD", os.environ.get("AWS_SES_SMTP_PASSWORD", "")).strip()

# Local Postfix fallback (used when VPS_MAIL_MODE=postfix)
LOCAL_SMTP_HOST = os.environ.get("LOCAL_SMTP_HOST", "127.0.0.1").strip()
LOCAL_SMTP_PORT = int(os.environ.get("LOCAL_SMTP_PORT", "25") or "25")

BIND_HOST = os.environ.get("BIND_HOST", "127.0.0.1").strip()
BIND_PORT = int(os.environ.get("BIND_PORT", "8787") or "8787")
VERIFY_SECONDS = float(os.environ.get("MAIL_VERIFY_SECONDS", "12") or "12")
MAIL_LOG = Path(os.environ.get("MAIL_LOG", "/var/log/mail.log"))


def _domain_of(addr: str) -> str:
    addr = str(addr or "").strip().lower()
    if "<" in addr and ">" in addr:
        addr = addr[addr.rfind("<") + 1 : addr.rfind(">")].strip()
    if "@" not in addr:
        return ""
    return addr.split("@")[-1]


def _read_log_tail(max_bytes: int = 400_000) -> str:
    chunks: list[str] = []
    try:
        if MAIL_LOG.exists():
            size = MAIL_LOG.stat().st_size
            with MAIL_LOG.open("rb") as fh:
                if size > max_bytes:
                    fh.seek(size - max_bytes)
                chunks.append(fh.read().decode("utf-8", "replace"))
    except OSError:
        pass
    # Also pull recent journal (some hosts log Postfix only there)
    try:
        import subprocess

        raw = subprocess.check_output(
            ["journalctl", "-u", "postfix", "-n", "200", "--no-pager", "-o", "cat"],
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        chunks.append(raw.decode("utf-8", "replace"))
    except Exception:  # noqa: BLE001
        try:
            import subprocess

            raw = subprocess.check_output(
                ["journalctl", "-n", "300", "--no-pager", "-o", "cat", "-t", "postfix/smtp"],
                stderr=subprocess.DEVNULL,
                timeout=5,
            )
            chunks.append(raw.decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001
            pass
    return "\n".join(chunks)


def verify_delivery(queue_id: str, recipients: list[str], message_id: str) -> dict:
    """
    Poll mail.log for final status of this queue id / message-id.
    Returns {ok, sent, failed, errors[]}
    """
    deadline = time.time() + VERIFY_SECONDS
    sent: set[str] = set()
    failed: dict[str, str] = {}
    wanted = {r.lower() for r in recipients}

    while time.time() < deadline:
        log = _read_log_tail()
        if not queue_id and message_id:
            for ln in log.splitlines():
                if message_id in ln and "message-id=" in ln.lower():
                    m = re.search(r":\s([0-9A-F]+):\smessage-id=", ln, re.I)
                    if m:
                        queue_id = m.group(1)
                        break

        lines = log.splitlines()
        # Prefer queue-id lines; also scan recipient lines (Gmail bounce is fast)
        for ln in lines:
            if queue_id and queue_id not in ln:
                # still allow recipient match in recent smtp lines
                if "status=" not in ln or "to=<" not in ln:
                    continue
            m = re.search(
                r"to=<([^>]+)>.*\bstatus=(sent|bounced|deferred)\b(.*)$",
                ln,
                re.IGNORECASE,
            )
            if not m:
                continue
            addr = m.group(1).lower()
            status = m.group(2).lower()
            rest = m.group(3) or ""
            if addr not in wanted:
                continue
            # If we have a queue id, require it on the line when present
            if queue_id and queue_id not in ln and status == "sent":
                # avoid matching older sends to same address
                continue
            if status == "sent":
                sent.add(addr)
                failed.pop(addr, None)
            elif status == "bounced":
                reason = rest.strip()
                if "said:" in reason:
                    reason = reason.split("said:", 1)[-1].strip()
                reason = re.sub(r"\s+", " ", reason)[:240]
                failed[addr] = reason or "bounced"

        if sent.union(failed.keys()) >= wanted:
            break
        time.sleep(0.5)

    errors = [f"{a}: {failed[a]}" for a in sorted(failed)]
    ok_count = len(sent)
    fail_count = len(failed)
    unresolved = sorted(wanted - sent - set(failed.keys()))
    if unresolved:
        # Last-chance: if Gmail auth failure appears anywhere for our domain recently
        log = _read_log_tail()
        if "5.7.26" in log or "SPF" in log and "did not pass" in log:
            for addr in unresolved:
                failed[addr] = (
                    "Likely SPF/DKIM reject (550-5.7.26). "
                    "Add ip4:185.209.229.34 to SPF and publish mail._domainkey DKIM."
                )
                errors.append(f"{addr}: {failed[addr]}")
            fail_count = len(failed)
            unresolved = []
        else:
            errors.append(
                "no final status yet for: "
                + ", ".join(unresolved)
                + " (check SPF/DKIM DNS — Gmail often rejects unauthenticated mail)"
            )
            fail_count += len(unresolved)

    return {
        "ok": ok_count > 0 and fail_count == 0,
        "partial": ok_count > 0 and fail_count > 0,
        "sent": ok_count,
        "failed": fail_count,
        "errors": errors,
        "queue_id": queue_id,
        "message_id": message_id,
    }


def send_via_aws_ses(msg: EmailMessage, recipients: list[str], cfg: dict) -> None:
    """Send via AWS SES SMTP (587, STARTTLS). Raises on failure. cfg is per-request."""
    host = cfg.get("host") or SES_SMTP_HOST
    user = cfg.get("user") or SES_SMTP_USER
    passwd = cfg.get("pass") or SES_SMTP_PASS
    port = int(cfg.get("port") or SES_SMTP_PORT or 587)
    if not host or not user or not passwd:
        raise RuntimeError(
            "AWS SES not configured. Set SMTP_HOST / SMTP_USERNAME / SMTP_PASSWORD in poller.env."
        )
    with smtplib.SMTP(host, port, timeout=60) as smtp:
        smtp.ehlo()
        smtp.starttls(context=_tls_context())
        smtp.ehlo()
        smtp.login(user, passwd)
        smtp.send_message(msg, from_addr=str(msg["From"]), to_addrs=recipients)


def _tls_context():
    import ssl

    return ssl.create_default_context()


def _resolve_ses_config(payload: dict) -> dict:
    """Per-request AWS SES transport config (no shared global mutation across threads)."""
    cfg = {
        "host": (payload.get("smtpHost") or SES_SMTP_HOST or "").strip(),
        "user": (payload.get("smtpUsername") or SES_SMTP_USER or "").strip(),
        "pass": (payload.get("smtpPassword") or SES_SMTP_PASS or "").strip(),
        "port": int(payload.get("smtpPort") or SES_SMTP_PORT or 587),
    }
    return cfg


def send_mail(payload: dict) -> dict:
    from_addr = str(payload.get("from") or MAIL_FROM).strip()
    to_list = [str(x).strip() for x in (payload.get("to") or []) if str(x).strip()]
    cc_list = [str(x).strip() for x in (payload.get("cc") or []) if str(x).strip()]
    bcc_list = [str(x).strip() for x in (payload.get("bcc") or []) if str(x).strip()]
    subject = str(payload.get("subject") or "").strip()
    text = payload.get("text")
    html = payload.get("html")
    headers = dict(payload.get("headers") or {})

    # Per-request transport overrides (sent by the Cloudflare Worker). Resolved
    # into a local config dict so concurrent requests never clobber shared globals.
    mode = str(payload.get("vpsMailMode") or VPS_MAIL_MODE).strip().lower()
    ses_cfg = _resolve_ses_config(payload)

    if not subject:
        raise ValueError("subject required")
    if not to_list and not bcc_list:
        raise ValueError("to or bcc required")
    if not text and not html:
        raise ValueError("text or html required")

    if _domain_of(from_addr) != MAIL_DOMAIN:
        raise ValueError(f"From domain must be {MAIL_DOMAIN} (got {_domain_of(from_addr) or 'empty'})")

    recipients = list(dict.fromkeys([*to_list, *cc_list, *bcc_list]))
    bulk = len(recipients) >= 2

    msg = EmailMessage()
    msg["From"] = from_addr
    msg["Reply-To"] = str(headers.pop("Reply-To", from_addr))
    if to_list:
        msg["To"] = ", ".join(to_list)
    if cc_list:
        msg["Cc"] = ", ".join(cc_list)
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    message_id = make_msgid(domain=MAIL_DOMAIN)
    msg["Message-ID"] = message_id
    msg["MIME-Version"] = "1.0"

    if bulk:
        headers.setdefault(
            "List-Unsubscribe",
            f"<mailto:{MAIL_FROM}?subject=unsubscribe>",
        )
        headers.setdefault("List-Unsubscribe-Post", "List-Unsubscribe=One-Click")
        headers.setdefault("Precedence", "bulk")
        headers.setdefault("X-Auto-Response-Suppress", "OOF, AutoReply")

    blocked = {"from", "to", "cc", "bcc", "subject", "date", "message-id", "mime-version"}
    for key, value in headers.items():
        if key and value and str(key).lower() not in blocked:
            msg[str(key)] = str(value)

    if html and text:
        msg.set_content(str(text))
        msg.add_alternative(str(html), subtype="html")
    elif html:
        msg.set_content("This message requires an HTML-capable client.")
        msg.add_alternative(str(html), subtype="html")
    else:
        msg.set_content(str(text))

    envelope_from = MAIL_FROM
    # Choose transport: AWS SES (primary) or local Postfix (fallback)
    if mode == "aws_ses":
        # AWS SES SMTP handshake is synchronous — success here means accepted by AWS.
        send_via_aws_ses(msg, recipients, ses_cfg)
        return {
            "ok": True,
            "recipients": len(recipients),
            "message_id": message_id,
            "bulk": bulk,
            "verified": True,
            "sent": len(recipients),
            "via": "aws_ses",
        }

    # Local Postfix fallback (verify via mail.log)
    with smtplib.SMTP(LOCAL_SMTP_HOST, LOCAL_SMTP_PORT, timeout=60) as smtp:
        smtp.send_message(msg, from_addr=envelope_from, to_addrs=recipients)

    # Find queue id from cleanup line for this Message-ID
    time.sleep(1.2)
    log = _read_log_tail()
    queue_id = ""
    mid = message_id.strip("<>")
    for ln in reversed(log.splitlines()):
        if mid in ln and "message-id=" in ln.lower():
            m = re.search(r":\s([0-9A-F]+):\smessage-id=", ln, re.I)
            if m:
                queue_id = m.group(1)
                break
            m = re.search(r"\b([0-9A-F]{6,})\b", ln)
            if m:
                queue_id = m.group(1)
                break

    verify = verify_delivery(queue_id, recipients, mid)
    if verify["ok"]:
        return {
            "ok": True,
            "recipients": len(recipients),
            "message_id": message_id,
            "bulk": bulk,
            "verified": True,
            "sent": verify["sent"],
            "via": "postfix",
        }

    # Honest failure — do not pretend sent
    err = "; ".join(verify["errors"][:4]) or "remote delivery failed (SPF/DKIM?)"
    hint = (
        " Fix Cloudflare SPF to include ip4:185.209.229.34 and publish DKIM "
        "mail._domainkey (see /opt/dtd-mailer/DNS_RECORDS.txt)."
    )
    return {
        "ok": False,
        "error": err + hint,
        "partial": verify.get("partial", False),
        "sent": verify["sent"],
        "failed": verify["failed"],
        "message_id": message_id,
        "queue_id": queue_id,
        "recipients": len(recipients),
        "via": "postfix",
    }


class Handler(BaseHTTPRequestHandler):
    def _json(self, code: int, payload: dict) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == "/health":
            self._json(
                200,
                {
                    "ok": True,
                    "service": "dtd-vps-mailer",
                    "domain": MAIL_DOMAIN,
                    "from": MAIL_FROM,
                    "verify_seconds": VERIFY_SECONDS,
                    "ts": int(time.time()),
                },
            )
            return
        self._json(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/send":
            self._json(404, {"ok": False, "error": "not_found"})
            return
        if not SECRET:
            self._json(500, {"ok": False, "error": "VPS_MAILER_SECRET not set"})
            return
        length = int(self.headers.get("Content-Length") or "0")
        if length > 2_000_000:
            self._json(413, {"ok": False, "error": "payload too large"})
            return
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
            if not isinstance(payload, dict):
                payload = {}
            body_secret = str(payload.pop("secret", "") or "").strip()
            provided = (self.headers.get("X-Mailer-Secret") or "").strip()
            if not provided:
                auth = (self.headers.get("Authorization") or "").strip()
                if auth.lower().startswith("bearer "):
                    provided = auth[7:].strip()
            if body_secret:
                provided = body_secret
            if not provided or provided != SECRET:
                self._json(403, {"ok": False, "error": "forbidden"})
                return
            result = send_mail(payload)
            # HTTP 200 with ok:false so poller can mark job failed with error text
            self._json(200, result)
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"ok": False, "error": str(exc)})

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main() -> None:
    if not SECRET:
        print("Set VPS_MAILER_SECRET before starting.", file=sys.stderr)
        sys.exit(1)
    if BIND_HOST not in {"127.0.0.1", "::1", "localhost"}:
        print(
            f"[warn] BIND_HOST={BIND_HOST} is not loopback; ensure firewall + TLS proxy.",
            file=sys.stderr,
        )
    server = ThreadingHTTPServer((BIND_HOST, BIND_PORT), Handler)
    print(f"[ok] dtd-vps-mailer on {BIND_HOST}:{BIND_PORT} domain={MAIL_DOMAIN} verify={VERIFY_SECONDS}s")
    server.serve_forever()


if __name__ == "__main__":
    main()
