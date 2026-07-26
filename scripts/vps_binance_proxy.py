#!/usr/bin/env python3
"""Binance Spot HMAC proxy for DTD Trading Console (VPS side)."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = (
    os.environ.get("VPS_PROXY_SECRET")
    or os.environ.get("VPS_MAILER_SECRET")
    or ""
).strip()
BIND = os.environ.get("BINANCE_PROXY_BIND", "127.0.0.1")
PORT = int(os.environ.get("BINANCE_PROXY_PORT", "8788") or "8788")
HOSTS = [
    "https://api1.binance.com",
    "https://api2.binance.com",
    "https://api3.binance.com",
    "https://api.binance.com",
]

ALLOWED = {
    ("GET", "/api/v3/account"),
    ("GET", "/api/v3/openOrders"),
    ("GET", "/api/v3/myTrades"),
    ("GET", "/api/v3/exchangeInfo"),
    ("GET", "/api/v3/ticker/price"),
    ("GET", "/api/v3/ticker/24hr"),
    ("GET", "/api/v3/klines"),
    ("GET", "/api/v3/depth"),
    ("POST", "/api/v3/order"),
    ("DELETE", "/api/v3/order"),
}
PUBLIC = {
    ("GET", "/api/v3/exchangeInfo"),
    ("GET", "/api/v3/ticker/price"),
    ("GET", "/api/v3/ticker/24hr"),
    ("GET", "/api/v3/klines"),
    ("GET", "/api/v3/depth"),
}


def sign(secret: str, query: str) -> str:
    return hmac.new(secret.encode(), query.encode(), hashlib.sha256).hexdigest()


def call_binance(method: str, path: str, params: dict, api_key: str, api_secret: str):
    is_public = (method, path) in PUBLIC
    q = dict(params or {})
    if not is_public:
        q["timestamp"] = int(time.time() * 1000)
        q.setdefault("recvWindow", 5000)
    query = urllib.parse.urlencode({k: v for k, v in q.items() if v is not None and v != ""})
    headers = {"User-Agent": "DTD-VPS-BinanceProxy/1.0", "Accept": "application/json"}
    if not is_public:
        query = f"{query}&signature={sign(api_secret, query)}" if query else f"signature={sign(api_secret, '')}"
        headers["X-MBX-APIKEY"] = api_key
    elif api_key:
        headers["X-MBX-APIKEY"] = api_key

    last = None
    for host in HOSTS:
        url = f"{host}{path}?{query}" if method in ("GET", "DELETE") else f"{host}{path}"
        data = None if method in ("GET", "DELETE") else query.encode()
        if method == "POST":
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode()), 200
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            try:
                parsed = json.loads(body)
            except Exception:
                parsed = {"raw": body[:400]}
            last = (parsed, e.code)
            if e.code in (403, 451):
                continue
            return parsed, e.code
        except Exception as e:  # noqa: BLE001
            last = ({"error": str(e)}, 502)
    return last or ({"error": "unreachable"}, 502)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # noqa: N802
        return

    def _auth(self, body: dict) -> bool:
        got = (
            self.headers.get("X-Mailer-Secret")
            or self.headers.get("X-Proxy-Secret")
            or self.headers.get("Authorization", "").replace("Bearer ", "")
            or body.get("secret")
            or ""
        )
        return bool(SECRET) and got == SECRET

    def do_GET(self):  # noqa: N802
        if self.path.rstrip("/") in ("/health", "/"):
            self._json({"ok": True, "service": "dtd-binance-proxy"})
            return
        self._json({"error": "not found"}, 404)

    def do_POST(self):  # noqa: N802
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            body = json.loads(raw.decode() or "{}")
        except Exception:
            body = {}
        if self.path.rstrip("/") != "/binance":
            self.send_response(404)
            self.end_headers()
            return
        if not self._auth(body):
            self._json({"error": "forbidden"}, 403)
            return
        method = str(body.get("method") or "GET").upper()
        path = str(body.get("path") or "").strip()
        if (method, path) not in ALLOWED:
            self._json({"error": "Endpoint not allowed."}, 400)
            return
        data, status = call_binance(
            method,
            path,
            body.get("params") or {},
            str(body.get("apiKey") or ""),
            str(body.get("apiSecret") or ""),
        )
        if status >= 400:
            self._json({"error": data.get("msg") or data.get("error") or data, "binance": data, "status": status}, 400 if status < 500 else 502)
            return
        self._json({"ok": True, "data": data})

    def _json(self, obj, code=200):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def main():
    if not SECRET:
        print("VPS_PROXY_SECRET or VPS_MAILER_SECRET required", file=sys.stderr)
        raise SystemExit(1)
    httpd = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f"[ok] binance proxy {BIND}:{PORT}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
