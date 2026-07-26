/**
 * Binance Spot HMAC proxy.
 * Prefers VPS relay (Binance blocks many Cloudflare egress IPs).
 * Body: { apiKey, apiSecret?, method, path, params? }
 */
import { json } from "../../lib/store.js";

const BINANCE_HOSTS = [
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
  "https://api.binance.com",
  "https://data-api.binance.vision"
];

const ALLOWED = new Set([
  "GET /api/v3/account",
  "GET /api/v3/openOrders",
  "GET /api/v3/myTrades",
  "GET /api/v3/exchangeInfo",
  "GET /api/v3/ticker/price",
  "GET /api/v3/ticker/24hr",
  "GET /api/v3/klines",
  "GET /api/v3/depth",
  "POST /api/v3/order",
  "DELETE /api/v3/order"
]);

const PUBLIC = new Set([
  "GET /api/v3/exchangeInfo",
  "GET /api/v3/ticker/price",
  "GET /api/v3/ticker/24hr",
  "GET /api/v3/klines",
  "GET /api/v3/depth"
]);

const rate = new Map();

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function allowRate(ip, limit = 60, windowMs = 60_000) {
  const now = Date.now();
  const row = rate.get(ip) || { n: 0, t: now };
  if (now - row.t > windowMs) {
    row.n = 0;
    row.t = now;
  }
  row.n += 1;
  rate.set(ip, row);
  return row.n <= limit;
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

async function viaVps(env, { apiKey, apiSecret, method, path, params, isPublic }) {
  const vpsUrl = String(env.VPS_BINANCE_PROXY_URL || "")
    .replace(/\/$/, "")
    .trim();
  const vpsSecret = String(env.VPS_MAILER_SECRET || "").trim();
  if (!vpsUrl || !vpsSecret) {
    return { ok: false, error: "VPS proxy not configured" };
  }

  const resp = await fetch(`${vpsUrl}/binance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Mailer-Secret": vpsSecret
    },
    body: JSON.stringify({
      secret: vpsSecret,
      apiKey,
      apiSecret: isPublic ? undefined : apiSecret,
      method,
      path,
      params: params || {}
    })
  });

  const payload = await resp.json().catch(() => ({}));
  if (resp.ok && payload.ok) {
    return { ok: true, data: payload.data };
  }
  return {
    ok: false,
    error: payload.error || `VPS HTTP ${resp.status}`,
    binance: payload.binance || payload,
    status: payload.status || resp.status
  };
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!allowRate(clientIp(request))) {
      return json({ error: "Too many requests — wait a moment and try again." }, 429);
    }

    const body = await request.json().catch(() => ({}));
    const method = String(body.method || "GET").toUpperCase();
    const path = String(body.path || "").trim();
    const key = `${method} ${path}`;
    if (!ALLOWED.has(key)) {
      return json({ error: "Endpoint not allowed." }, 400);
    }

    const params = { ...(body.params || {}) };
    const isPublic = PUBLIC.has(key);
    const apiKey = String(body.apiKey || "").trim();
    const apiSecret = String(body.apiSecret || "").trim();

    if (!isPublic && (!apiKey || !apiSecret)) {
      return json({ error: "apiKey and apiSecret required for private endpoints." }, 400);
    }

    // 1) VPS first
    try {
      const vps = await viaVps(env, {
        apiKey,
        apiSecret,
        method,
        path,
        params,
        isPublic
      });
      if (vps.ok) return json({ ok: true, data: vps.data, via: "vps" });
      // Auth / order errors from Binance via VPS — return immediately
      if (vps.status && vps.status !== 403 && vps.status !== 502) {
        return json(
          {
            error: String(vps.error || "Binance error").slice(0, 300),
            binance: vps.binance,
            status: vps.status,
            via: "vps"
          },
          vps.status >= 500 ? 502 : 400
        );
      }
    } catch {
      /* try direct */
    }

    // 2) Direct Binance (may be blocked from CF)
    if (!isPublic) {
      params.timestamp = Date.now();
      params.recvWindow = Number(params.recvWindow) || 5000;
    }

    let query = toQuery(params);
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "DTDTradingConsole/1.0",
      Accept: "application/json"
    };

    if (!isPublic) {
      const signature = await hmacSha256Hex(apiSecret, query);
      query = query ? `${query}&signature=${signature}` : `signature=${signature}`;
      headers["X-MBX-APIKEY"] = apiKey;
    } else if (apiKey) {
      headers["X-MBX-APIKEY"] = apiKey;
    }

    const hosts = isPublic
      ? BINANCE_HOSTS
      : BINANCE_HOSTS.filter((h) => !h.includes("data-api"));

    let lastErr = "Binance unreachable";
    let data = null;
    let status = 502;

    for (const host of hosts) {
      const url =
        method === "GET" || method === "DELETE"
          ? `${host}${path}?${query}`
          : `${host}${path}`;
      const init = { method, headers: { ...headers } };
      if (method === "POST") init.body = query;
      try {
        const resp = await fetch(url, init);
        const text = await resp.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text.slice(0, 400) };
        }
        status = resp.status;
        if (resp.ok) return json({ ok: true, data, via: "direct" });
        if (resp.status === 403 || resp.status === 451) {
          lastErr = data?.msg || data?.raw || `HTTP ${resp.status}`;
          continue;
        }
        lastErr = data?.msg || data?.error || data?.raw || `Binance HTTP ${resp.status}`;
        break;
      } catch (err) {
        lastErr = err.message || "fetch failed";
      }
    }

    return json(
      {
        error: String(lastErr).slice(0, 300),
        binance: data,
        status,
        hint: "Ensure dtd-binance-proxy is running on VPS :8788"
      },
      status >= 500 ? 502 : 400
    );
  } catch (error) {
    return json({ error: error.message || "Trade proxy failed." }, 500);
  }
}
