/**
 * DTD Store — Pages Advanced Mode Worker
 * Handles all /api/* routes, serves static assets for everything else
 * Multi-provider email/SMS fallback system — VPS mailer primary, free providers as backup
 */

// ─── Helpers ───────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function getClientIp(request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

// ─── Redis (Upstash REST — Workers-compatible) ──────────
class UpstashRedis {
  constructor(url, token) {
    this.url = url.replace(/\/$/, "");
    this.token = token;
  }
  async _req(method, path, body) {
    const resp = await fetch(`${this.url}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return resp.json();
  }
  async get(key) { const d = await this._req("GET", `get/${key}`); return d.result; }
  async set(key, value, ...opts) {
    let ex = null, nx = false;
    for (let i = 0; i < opts.length; i++) {
      if (opts[i] === "NX") nx = true;
      if (opts[i] === "EX") ex = Number(opts[i + 1]);
    }
    const payload = nx ? { key, value, ex, nx: true } : { key, value, ex };
    await this._req("POST", "set", payload);
    return "OK";
  }
  async del(key) { await this._req("POST", "del", { keys: [key] }); return 1; }
  async incr(key) { const d = await this._req("POST", "incr", { key }); return d.result; }
  async expire(key, seconds) { await this._req("POST", "expire", { key, seconds }); return 1; }
  async xadd(stream, ...fields) {
    const body = { stream, id: "*" };
    for (let i = 0; i < fields.length; i += 2) body[fields[i]] = fields[i + 1];
    const d = await this._req("POST", "xadd", body);
    return d.result;
  }
  async xreadgroup(group, consumer, streams, count = 10, block = 5000) {
    const body = { group, consumer, streams, count, block };
    const d = await this._req("POST", "xreadgroup", body);
    return d.result || [];
  }
  async xack(stream, group, ...ids) { await this._req("POST", "xack", { stream, group, ids }); }
}

let redisClient = null;
function getRedis(env) {
  if (redisClient) return redisClient;
  const url = env.UPSTASH_REDIS_REST_URL || env.REDIS_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    redisClient = new UpstashRedis(url, token);
    return redisClient;
  }
  return null; // Redis optional; rate limiting degrades gracefully
}

// ─── JWT (Web Crypto HMAC-SHA256 — no npm dependency) ───
const JWT_SECRET = env => env.JWT_SECRET || env.SMTP_JWT_SECRET || "dev-secret-change-me";

async function signJwt(payload, secret, expiresInSec = 28800) {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadB64 = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + expiresInSec }));
  const signingInput = `${header}.${payloadB64}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${signingInput}.${sigB64}`;
}

async function verifyJwt(token, secret) {
  try {
    const [headerB64, payloadB64, sigB64] = token.split(".");
    if (!headerB64 || !payloadB64 || !sigB64) return null;
    const signingInput = `${headerB64}.${payloadB64}`;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const sig = new Uint8Array(atob(sigB64).split("").map(c => c.charCodeAt(0)));
    const ok = await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(signingInput));
    if (!ok) return null;
    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function extractJwt(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function requireAdminJwt(request, env) {
  const token = extractJwt(request);
  if (!token) return { ok: false, status: 401, error: "Admin authentication required." };
  const payload = await verifyJwt(token, JWT_SECRET(env));
  if (!payload) return { ok: false, status: 401, error: "Invalid or expired session." };
  if (payload.role !== "admin") return { ok: false, status: 403, error: "Admin role required." };
  return { ok: true, payload };
}

async function rateLimitCheck(env, prefix, ident, max = 60, windowSec = 60) {
  const redis = getRedis(env);
  if (!redis) return { ok: true, remaining: max };
  const key = `rate_limit:${prefix}:${ident}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    return { ok: count <= max, remaining: Math.max(0, max - count) };
  } catch { return { ok: true, remaining: max }; }
}

async function idempotencyCheck(env, key, ttlSec = 86400) {
  const redis = getRedis(env);
  if (!redis) return { ok: true, duplicate: false };
  const lockKey = `idem:${key}`;
  const existing = await redis.get(lockKey);
  if (existing) return { ok: true, duplicate: true, status: existing };
  await redis.set(lockKey, "1", "NX", "EX", String(ttlSec));
  return { ok: true, duplicate: false };
}

async function setIdempotencyStatus(env, key, status, ttlSec = 86400) {
  const redis = getRedis(env);
  if (!redis) return;
  await redis.set(`idem:${key}`, status, "EX", String(ttlSec));
}

// ─── Supabase ───────────────────────────────────────────

function getSupabase(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  return {
    url,
    key,
    async rpc(fn, params) {
      const resp = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify(params)
      });
      return resp.json();
    },
    from(table) {
      return {
        async insert(rows) {
          const resp = await fetch(`${url}/rest/v1/${table}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: key,
              Authorization: `Bearer ${key}`,
              Prefer: "return=representation"
            },
            body: JSON.stringify(rows)
          });
          const data = await resp.json();
          return { data, error: resp.ok ? null : data };
        },
        async select(columns = "*", filter = {}) {
          let query = `${url}/rest/v1/${table}?select=${columns}`;
          for (const [k, v] of Object.entries(filter)) {
            query += `&${k}=eq.${encodeURIComponent(v)}`;
          }
          const resp = await fetch(query, {
            headers: { apikey: key, Authorization: `Bearer ${key}` }
          });
          const data = await resp.json();
          return { data, error: resp.ok ? null : data };
        },
        async update(values, filter = {}) {
          const filterParams = Object.entries(filter)
            .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
            .join("&");
          const resp = await fetch(`${url}/rest/v1/${table}?${filterParams}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              apikey: key,
              Authorization: `Bearer ${key}`,
              Prefer: "return=representation"
            },
            body: JSON.stringify(values)
          });
          const data = await resp.json();
          return { data, error: resp.ok ? null : data };
        },
        async delete(filter = {}) {
          const filterParams = Object.entries(filter)
            .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
            .join("&");
          const resp = await fetch(`${url}/rest/v1/${table}?${filterParams}`, {
            method: "DELETE",
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              Prefer: "return=representation"
            }
          });
          const data = await resp.json();
          return { data, error: resp.ok ? null : data };
        }
      };
    }
  };
}

// ─── Bot analytics, AI chat & admin monitoring ──────────

async function logBotEvent(sb, event) {
  if (!sb) return;
  try {
    await sb.from("bot_events").insert(event);
  } catch {}
}

function isAdmin(chatId, env) {
  const id = String(chatId);
  const list = [
    env.TELEGRAM_ADMIN_CHAT_ID,
    env.TELEGRAM_SECOND_ADMIN_CHAT_ID,
    ...String(env.TELEGRAM_ADMIN_CHAT_IDS || "").split(",")
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  return list.includes(id);
}

function aiModelOf(env) {
  return String(env.GEMINI_MODEL || env.AI_MODEL || "gemini-2.0-flash").trim();
}

function aiSystemPrompt(env) {
  const owner = ownerOf(env);
  return [
    "You are the DTD Store assistant — official AI support for the DTD digital products store.",
    "Keep replies short, friendly and helpful. Plain text only (no markdown fences, no raw HTML).",
    "Reliable facts you can use:",
    `- Store: ${storeUrlOf(env)}`,
    "- Payments: USDT (TRC20), Bitcoin, and Card/Bank via Paystack.",
    "- Delivery is by email after payment is confirmed.",
    `- Support: @${owner} · ${env.SUPPORT_EMAIL || "contact@dvtechnologies.xyz"}`,
    "- Bot commands: /products, /buy, /pay, /order, /refer, /help.",
    "If unsure, say you'll forward to support. Never invent prices, addresses or order statuses."
  ].join("\n");
}

async function askAi(env, userText) {
  const key = env.GEMINI_API_KEY || env.AI_API_KEY;
  if (!key) return askAiFree(userText, aiSystemPrompt(env));
  const model = aiModelOf(env);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: aiSystemPrompt(env) }] },
          contents: [{ role: "user", parts: [{ text: String(userText).slice(0, 2000) }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 800 }
        })
      }
    );
    const data = await response.json().catch(() => ({}));
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (!text) return { ok: false, reason: (data && data.error && data.error.message) || "empty" };
    return { ok: true, text: text.trim() };
  } catch (error) {
    return { ok: false, reason: error.message || "network" };
  }
}

// Free fallback: Pollinations text API (no key). Used by /ai and the agent when
// no Gemini/AI key is configured.
async function askAiFree(userText, systemPrompt) {
  try {
    const prompt = `${systemPrompt || ""}\n\nUser: ${String(userText).slice(0, 1500)}`;
    const response = await fetch(
      `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=openai`,
      { headers: { "User-Agent": "DTDStore/1.0" } }
    );
    if (!response.ok) return { ok: false, reason: "free_ai_failed" };
    const text = await response.text();
    if (!text || text.length < 2) return { ok: false, reason: "empty" };
    return { ok: true, text: text.trim().slice(0, 4000) };
  } catch (error) {
    return { ok: false, reason: error.message || "network" };
  }
}

async function pgQuery(env, table, params) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  const qs = new URLSearchParams(params).toString();
  try {
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const data = await resp.json().catch(() => []);
    return { data: Array.isArray(data) ? data : [], ok: resp.ok };
  } catch {
    return { data: [], ok: false };
  }
}

async function adminCommand(env, chatId, command, arg) {
  const since24 = new Date(Date.now() - 86400000).toISOString();

  if (command === "/admin") {
    return sendTelegram(env, chatId, [
      "👑 <u>DTD Admin Panel</u>",
      "",
      "/stats — <i>dashboard totals</i>",
      "/traffic — <i>recent web + bot activity</i>",
      "/users — <i>top active users</i>",
      "/logs 20 — <i>last N bot events</i>",
      "/activity — <i>events by type (24h)</i>",
      "/secretary — <i>pending orders + remind</i>",
      "",
      "All monitoring data is captured automatically."
    ].join("\n"));
  }

  if (command === "/stats") {
    const [events, ev24, web24, orders, products] = await Promise.all([
      pgQuery(env, "bot_events", { select: "user_id" }),
      pgQuery(env, "bot_events", { select: "id", created_at: `gte.${since24}` }),
      pgQuery(env, "analytics_events", { select: "id", created_at: `gte.${since24}` }),
      pgQuery(env, "orders", { select: "total_usd,payment_status" }),
      pgQuery(env, "products", { select: "id", active: "eq.true" })
    ]);
    const users = new Set((events.data || []).map((e) => e.user_id).filter(Boolean));
    const paid = (orders.data || []).filter((o) => /paid|confirmed|delivered/i.test(String(o.payment_status || "")));
    const revenue = paid.reduce((s, o) => s + Number(o.total_usd || 0), 0);
    return sendTelegram(env, chatId, [
      "📊 <u>DTD Admin — Dashboard</u>",
      "━━━━━━━━━━━━━━━━━━",
      `👥 Users seen: <b>${users.size}</b>`,
      `💬 Bot messages: <b>${(events.data || []).length}</b> · last 24h <b>${(ev24.data || []).length}</b>`,
      `🌐 Web events (24h): <b>${(web24.data || []).length}</b>`,
      `🧾 Orders: <b>${(orders.data || []).length}</b>`,
      `💰 Paid revenue: <b>$${fmtMoney(revenue)}</b>`,
      `🛍 Active products: <b>${(products.data || []).length}</b>`
    ].join("\n"));
  }

  if (command === "/traffic") {
    const [botLog, webLog] = await Promise.all([
      pgQuery(env, "bot_events", { select: "*", order: "created_at.desc", limit: "8" }),
      pgQuery(env, "analytics_events", { select: "*", order: "created_at.desc", limit: "6" })
    ]);
    const lines = ["🚦 <u>DTD Admin — Traffic</u>", "━━━━━━━━━━━━━━━━━━"];
    for (const e of botLog.data || []) {
      const who = e.username ? `@${e.username}` : String(e.user_id || "?").slice(0, 10);
      lines.push(`🤖 <b>${escHtml(who)}</b> · ${escHtml(String(e.command || e.event_type || ""))}`);
    }
    for (const e of webLog.data || []) {
      lines.push(`🌐 ${escHtml(String(e.event_type || ""))} · ${escHtml(String(e.path || ""))} · ${escHtml(String(e.country || ""))}`);
    }
    return sendTelegram(env, chatId, lines.join("\n"));
  }

  if (command === "/users") {
    const ev = await pgQuery(env, "bot_events", { select: "user_id,username,first_name" });
    const counts = {};
    for (const e of ev.data || []) {
      const k = e.user_id || e.username || "?";
      counts[k] = counts[k] || { n: 0, username: e.username, first_name: e.first_name, id: e.user_id };
      counts[k].n += 1;
    }
    const top = Object.values(counts).sort((a, b) => b.n - a.n).slice(0, 10);
    return sendTelegram(env, chatId, [
      "👥 <u>DTD Admin — Top Users</u>",
      ...top.map((u, i) => `${i + 1}. ${escHtml(u.username ? `@${u.username}` : u.first_name || u.id)} — <b>${u.n}</b>`)
    ].join("\n"));
  }

  if (command === "/logs") {
    const n = Math.max(1, Math.min(Number(arg) || 15, 50));
    const rows = await pgQuery(env, "bot_events", { select: "*", order: "created_at.desc", limit: String(n) });
    return sendTelegram(env, chatId, [
      `📄 <u>DTD Admin — Last ${n} Events</u>`,
      "━━━━━━━━━━━━━━━━━━",
      ...(rows.data || []).map((e) => {
        const who = e.username ? `@${e.username}` : String(e.user_id || "?").slice(0, 10);
        const what = escHtml(String(e.command || e.event_type || "")) || "—";
        const time = String(e.created_at || "").replace("T", " ").slice(5, 19);
        return `${time} · <b>${escHtml(who)}</b> · ${what}`;
      })
    ].join("\n"));
  }

  if (command === "/activity") {
    const [bot, web] = await Promise.all([
      pgQuery(env, "bot_events", { select: "event_type,command", created_at: `gte.${since24}` }),
      pgQuery(env, "analytics_events", { select: "event_type", created_at: `gte.${since24}` })
    ]);
    const tally = (rows, keyFn) => {
      const m = {};
      for (const r of rows || []) {
        const k = keyFn(r) || "other";
        m[k] = (m[k] || 0) + 1;
      }
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };
    const botT = tally(bot.data || [], (r) => (r.event_type === "command" ? r.command : r.event_type));
    const webT = tally(web.data || [], (r) => r.event_type);
    return sendTelegram(env, chatId, [
      "⏱ <u>DTD Admin — Activity (24h)</u>",
      "━━━━━━━━━━━━━━━━━━",
      "<b>Bot</b>",
      ...(botT.slice(0, 8).map(([k, n]) => `${escHtml(k)} — <b>${n}</b>`) || ["(none)"]),
      "",
      "<b>Web</b>",
      ...(webT.slice(0, 8).map(([k, n]) => `${escHtml(k)} — <b>${n}</b>`) || ["(none)"])
    ].join("\n"));
  }

  return sendTelegram(env, chatId, "Unknown admin command. Use /admin");
}

// ─── Channel control: owner drives promos on the channels ──

function channelsOf(env) {
  const explicit = String(env.TELEGRAM_ANNOUNCE_CHANNELS || "")
    .split(",")
    .map((s) => String(s || "").trim())
    .filter((s) => /^-?\d+$/.test(s));
  return explicit.length ? [...new Set(explicit)] : ["-1004317499796", "-1004435691493"];
}

async function queueChannelCommand(env, sb, chatId, command, args, ack) {
  if (!sb) return sendTelegram(env, chatId, "Supabase not configured — cannot queue command.");
  const { data, error } = await sb.from("agent_commands").insert({
    command,
    args: String(args || "").slice(0, 200),
    created_by: "admin"
  });
  if (error) {
    return sendTelegram(env, chatId, `Failed to queue ${command}: ${String(error.message || error)}`);
  }
  return sendTelegram(env, chatId, ack);
}

async function channelControl(env, sb, chatId, user, command, arg, text) {
  if (command === "/controls") {
    return sendTelegram(env, chatId, [
      "🎛 <u>DTD Channel Controls</u>",
      "Drive promos & announcements on both channels (admin only):",
      "",
      "/promo — <i>post the next product promo card now</i>",
      "/story — <i>post a daily-drop story now</i>",
      "/dealnow — <i>post a Stars deal message now</i>",
      "/flash — <i>start a timed flash sale now</i>",
      "/surge 2 12 — <i>2x referral credit for 12h</i>",
      "/pin PRODUCT — <i>post + pin a product promo</i>",
      "/announce TEXT — <i>send a message to both channels</i>",
      "/schedule promos 3 — <i>promo every 3h</i>",
      "/schedule deals 6 — <i>deal every 6h</i>",
      "/schedule story 9 — <i>daily story at 09:00 UTC</i>",
      "/schedule pnl 23 — <i>daily report hour</i>",
      "/market — <i>flash/surge/bundle status</i>",
      "/finance — <i>payments, Stars, credits, members</i>",
      "",
      "Promo/story/deal/flash commands run on the VPS within ~30s."
    ].join("\n"));
  }

  if (command === "/promo") return queueChannelCommand(env, sb, chatId, "promo", "", "🎯 <b>Promo queued</b> — next product card posts to both channels within ~30s.");
  if (command === "/story") return queueChannelCommand(env, sb, chatId, "story", "", "📖 <b>Story queued</b> — daily-drop story posts within ~30s.");
  if (command === "/dealnow") return queueChannelCommand(env, sb, chatId, "deal", "", "🔥 <b>Deal queued</b> — Stars deal message posts within ~30s.");
  if (command === "/flash") return queueChannelCommand(env, sb, chatId, "flash", "", "⚡ <b>Flash sale queued</b> — starts within ~30s and runs for the configured window.");
  if (command === "/pin") {
    const q = String(arg || "").trim();
    if (!q) return sendTelegram(env, chatId, "Usage: /pin PRODUCT — e.g. <code>/pin smtp</code>");
    return queueChannelCommand(env, sb, chatId, "pin", q, `📌 <b>Pin queued</b> — posting & pinning <b>${escHtml(q)}</b> within ~30s.`);
  }

  if (command === "/announce") {
    const msg = String(text || "").replace(/^\/announce\s*/i, "").trim();
    if (!msg) return sendTelegram(env, chatId, "Usage: /announce TEXT — e.g. <code>/announce Big new drop this week 🔥</code>");
    const channels = channelsOf(env);
    const results = [];
    for (const cid of channels) {
      const r = await botApi(env, "sendMessage", {
        chat_id: cid,
        text: msg,
        parse_mode: "HTML",
        disable_web_page_preview: true
      });
      results.push(`${cid}: ${r?.ok ? "✅" : "❌"}`);
    }
    return sendTelegram(env, chatId, `📢 <b>Announcement sent</b>\n${results.join("\n")}`);
  }

  if (command === "/schedule") {
    const [group, value] = String(arg || "").trim().split(/\s+/);
    const map = {
      promos: "promo_interval_hours",
      promo: "promo_interval_hours",
      deals: "deal_interval_hours",
      deal: "deal_interval_hours",
      story: "story_hour",
      pnl: "pnl_hour"
    };
    const key = map[String(group || "").toLowerCase()];
    const num = Number(value);
    if (!key || !Number.isFinite(num) || num <= 0) {
      return sendTelegram(env, chatId, "Usage: /schedule <promos|deals|story|pnl> VALUE — e.g. <code>/schedule promos 3</code>");
    }
    if (!sb) return sendTelegram(env, chatId, "Supabase not configured.");
    const setValue = String(Math.round(num * 10) / 10);
    const { data: updated } = await sb.from("app_settings").update({ value: setValue }, { key });
    if (!Array.isArray(updated) || !updated.length) {
      await sb.from("app_settings").insert({ key, value: setValue });
    }
    return sendTelegram(env, chatId, `⚙️ <b>Schedule updated</b>\n<code>${key}</code> = <b>${setValue}</b> (applies within ~1 min)`);
  }

  if (command === "/surge") {
    if (!sb) return sendTelegram(env, chatId, "Supabase not configured.");
    const [multRaw, hoursRaw] = String(arg || "").trim().split(/\s+/);
    const mult = Number(multRaw);
    const hours = Number(hoursRaw);
    if (!Number.isFinite(mult) || mult <= 1 || !Number.isFinite(hours) || hours <= 0) {
      return sendTelegram(env, chatId, "Usage: /surge MULTIPLIER HOURS — e.g. <code>/surge 2 12</code> for 2x referral credit for 12h");
    }
    const nowIso = new Date().toISOString();
    const keys = ["referral_multiplier", "referral_surge_hours", "referral_surge_started_at"];
    const vals = [String(Math.round(mult * 10) / 10), String(hours), nowIso];
    for (let i = 0; i < keys.length; i++) {
      const { data: updated } = await sb.from("app_settings").update({ value: vals[i] }, { key: keys[i] });
      if (!Array.isArray(updated) || !updated.length) {
        await sb.from("app_settings").insert({ key: keys[i], value: vals[i] });
      }
    }
    await queueChannelCommand(env, sb, chatId, "surge", "", "");
    return sendTelegram(env, chatId, `🤝 <b>Referral surge armed</b>\n${Math.round(mult * 10) / 10}x credit for ${hours}h — promo posts to channels within ~1 min.`);
  }

  if (command === "/market") {
    if (!sb) return sendTelegram(env, chatId, "Supabase not configured.");
    const market = await marketStatusOf(env, sb);
    const flash = market.flash;
    const lines = [
      "📡 <u>DTD Market status</u>",
      "━━━━━━━━━━━━━━━━━━",
      flash
        ? `⚡ Flash sale: <b>${escHtml(flash.product_name || "")}</b> — ${flash.discount_pct}% off · ends ${new Date(String(flash.expires_at).replace("Z", "+00:00")).toLocaleString()}`
        : "⚡ Flash sale: <i>none active</i>",
      `🤝 Referral credit: <b>${market.referralMultiplier}x</b>${market.surgeActive ? ` (surge ends ${new Date(String(market.surgeEndsAt).replace("Z", "+00:00")).toLocaleString()})` : ""}`,
      `📦 Active bundles: <b>${market.bundles.length}</b>`
    ];
    const today = new Date().toISOString().slice(0, 10);
    const [pays, stars] = await Promise.all([
      pgQuery(env, "payments", { select: "amount_usd", status: "eq.confirmed" }),
      pgQuery(env, "stars_invoices", { select: "total_usd", status: "eq.paid" })
    ]);
    const payToday = (pays.data || []).filter((p) => String(p.created_at || "").startsWith(today)).reduce((s, p) => s + Number(p.amount_usd || 0), 0);
    const starsToday = (stars.data || []).filter((i) => String(i.created_at || i.updated_at || "").startsWith(today)).reduce((s, i) => s + Number(i.total_usd || 0), 0);
    lines.push("━━━━━━━━━━━━━━━━━━", `💰 Today: <b>$${fmtMoney(payToday + starsToday)}</b> (${fmtMoney(payToday)} crypto + ${fmtMoney(starsToday)} Stars)`);
    return sendTelegram(env, chatId, lines.join("\n"));
  }

  if (command === "/finance") {
    const since = new Date(Date.now() - 86400000).toISOString();
    const sinceDay = new Date(Date.now()).toISOString().slice(0, 10);
    const [payments, stars, orders, credits, pending] = await Promise.all([
      pgQuery(env, "payments", { select: "*", status: "eq.confirmed" }),
      pgQuery(env, "stars_invoices", { select: "*", status: "eq.paid" }),
      pgQuery(env, "orders", { select: "total_usd,payment_status", created_at: `gte.${since}` }),
      pgQuery(env, "bot_credits", { select: "balance_usd", user_id: `eq.${String(user.id)}` }),
      pgQuery(env, "agent_commands", { select: "id", status: "eq.pending" })
    ]);
    const payAll = (payments.data || []).filter((p) => String(p.created_at || "").startsWith(sinceDay));
    const cryptoUsd = payAll.reduce((s, p) => s + Number(p.amount_usd || 0), 0);
    const starsPaid = (stars.data || []).filter((i) => String(i.updated_at || i.created_at || "").startsWith(sinceDay));
    const starsUsd = starsPaid.reduce((s, i) => s + Number(i.total_usd || 0), 0);
    const ordersToday = (orders.data || []).filter((o) => /paid|confirmed|delivered/i.test(String(o.payment_status || "")));
    const creditRow = (credits.data || [])[0];
    const memberCounts = [];
    for (const cid of channelsOf(env)) {
      const r = await botApi(env, "getChatMemberCount", { chat_id: cid }).catch(() => null);
      memberCounts.push(`${cid}: ${r?.result ?? "?"}`);
    }
    return sendTelegram(env, chatId, [
      "💰 <u>DTD Finance — today</u>",
      "━━━━━━━━━━━━━━━━━━",
      `⛓ Crypto confirmed: <b>${payAll.length}</b> · <b>$${fmtMoney(cryptoUsd)}</b>`,
      `⭐ Stars paid: <b>${starsPaid.length}</b> · <b>$${fmtMoney(starsUsd)}</b> (${starsPaid.reduce((s, i) => s + Number(i.stars_amount || 0), 0)} ⭐)`,
      `🧾 Orders paid (24h): <b>${ordersToday.length}</b>`,
      `🤝 Your credit: <b>$${fmtMoney(Number(creditRow?.balance_usd || 0))}</b>`,
      `⏳ Pending commands: <b>${(pending.data || []).length}</b>`,
      "",
      `📢 Channel members:\n${memberCounts.join("\n")}`
    ].join("\n"));
  }

  return sendTelegram(env, chatId, "Unknown control command. Use /controls");
}

// ─── Secretary: pending-order reminders ─────────────────

async function resolveBuyerChatId(env, sb, order) {
  const phone = String(order.customer_phone || "").trim();
  if (/^\d{5,}$/.test(phone)) return phone;

  const dd = String(order.delivery_details || "");
  let m = dd.match(/[Ii][Dd][:\s#]*(\d{5,})/) || dd.match(/[Tt]elegram[^\d]{0,20}(\d{5,})/);
  if (m) return m[1];

  const username = String(order.telegram_username || "").replace(/^@/, "").trim();
  const token = env.TELEGRAM_BOT_TOKEN;
  if (username && /^[A-Za-z0-9_]{4,}$/.test(username) && token) {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=@${username}`);
      const data = await resp.json();
      if (data.ok && data.result?.id) return String(data.result.id);
    } catch {}
  }
  return null;
}

async function sendPendingOrderReminder(env, chatId, order) {
  const total = Number(order.total_usd || 0);
  const name = String(order.customer_name || "Customer");
  const method = String(order.payment_method || "");
  const store = storeUrlOf(env);
  const owner = ownerOf(env);
  const message = [
    "⏰ <u>DTD Store — Payment Reminder</u>",
    "",
    `Hi <b>${escHtml(name)}</b>, you have an order still waiting for payment:`,
    "",
    `🔖 Order: <code>${escHtml(String(order.id || "").slice(0, 12))}</code>`,
    `💵 Amount: <b>$${fmtMoney(total)} USD</b>`,
    `💳 Method: ${escHtml(method || "—")}`,
    "",
    `🛍 Complete your payment here: <a href="${store}">${store.replace("https://", "")}</a>`,
    "",
    "Once paid, your order is delivered by email instantly.",
    `Need help? <a href="https://t.me/${owner}">@${owner}</a>`
  ].join("\n");
  return sendTelegram(env, chatId, message);
}

async function fetchPendingOrders(sb, limit = 200) {
  if (!sb) return [];
  const { data } = await sb.from("orders").select("*", { payment_status: "pending" });
  return (Array.isArray(data) ? data : [])
    .filter((o) => String(o.payment_status || "").toLowerCase() === "pending")
    .slice(0, limit);
}

async function handleSecretary(env, sb, chatId, action = "list") {
  if (!isAdmin(chatId, env)) {
    return sendTelegram(env, chatId, "🔒 Admin only.");
  }
  if (!sb) return sendTelegram(env, chatId, "Database not configured.");

  const pending = await fetchPendingOrders(sb);

  if (action === "remind") {
    let sent = 0;
    let failed = 0;
    let noContact = 0;
    for (const order of pending) {
      const buyerId = await resolveBuyerChatId(env, sb, order);
      if (!buyerId) {
        noContact += 1;
        continue;
      }
      const res = await sendPendingOrderReminder(env, buyerId, order);
      if (res.ok) sent += 1;
      else failed += 1;
    }
    return sendTelegram(env, chatId, [
      "👔 <u>Secretary — Reminders sent</u>",
      `📬 Sent: <b>${sent}</b>`,
      `❌ Failed: <b>${failed}</b>`,
      `📭 No contact: <b>${noContact}</b>`,
      "",
      "Automatic reminders run on the VPS every 30 minutes."
    ].join("\n"));
  }

  const recent = pending.slice(0, 8).map((o, i) => {
    const when = new Date(o.created_at || Date.now());
    const age = Math.max(0, Math.round((Date.now() - when.getTime()) / 60000));
    const ageTxt = age < 60 ? `${age}min` : `${Math.round(age / 60)}h`;
    return `${i + 1}. <code>${escHtml(String(o.id || "").slice(0, 8))}</code> · $${fmtMoney(o.total_usd)} · ${escHtml(String(o.payment_method || "").slice(0, 8))} · ${ageTxt}`;
  });

  const keyboard = {
    inline_keyboard: [
      [{ text: "📤 Remind all now", callback_data: "sec|remind" }],
      [{ text: "🔄 Refresh", callback_data: "sec|list" }],
      [{ text: "⬅️ Back", callback_data: "noop" }]
    ]
  };

  return sendTelegram(
    env,
    chatId,
    [
      "👔 <u>DTD Secretary — Pending Orders</u>",
      "━━━━━━━━━━━━━━━━━━",
      `⏳ Pending: <b>${pending.length}</b>`,
      "",
      ...(recent.length ? recent : ["(no pending orders)"]),
      "",
      "⚠️ Auto-reminders every 30 min are handled by the VPS."
    ].join("\n"),
    { reply_markup: keyboard }
  );
}

// ─── Telegram ───────────────────────────────────────────

async function sendTelegram(env, chatId, message, options = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return { ok: false, reason: "not_configured" };

  const text = typeof message === "string" ? message : String(message?.text || "");
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  const markup = options.reply_markup || (typeof message === "object" && message?.reply_markup);
  if (markup) body.reply_markup = markup;

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    return { ok: false, reason: response.status === 401 ? "unauthorized" : "send_failed" };
  }
  return { ok: true };
}

// ─── Payment helpers ────────────────────────────────────

const PAYMENT_METHODS = new Set([
  "Crypto", "USDT", "Bitcoin", "Paystack",
  "Paystack Card", "Paystack Bank", "Paystack QR"
]);

function normalizePaymentMethod(method) {
  const value = String(method || "USDT").trim();
  if (PAYMENT_METHODS.has(value)) return value;
  const lower = value.toLowerCase();
  if (lower.includes("paystack")) return "Paystack";
  if (lower.includes("usdt") || lower.includes("trc20") || lower.includes("tron")) return "USDT";
  if (lower.includes("bitcoin") || lower === "btc") return "Bitcoin";
  if (lower.includes("crypto")) return "Crypto";
  return "USDT";
}

function dbPaymentMethod(method) {
  const value = String(method || "").toLowerCase();
  if (
    value.includes("crypto") || value.includes("bitcoin") || value === "btc" ||
    value.includes("usdt") || value.includes("trc20") || value.includes("tron")
  ) return "Crypto";
  return "Paystack";
}

// ─── SMTP token ─────────────────────────────────────────

function generateToken() {
  return crypto.randomUUID() + "-" + Date.now().toString(36);
}

function verifyToken(env, token) {
  if (!token) return false;
  const secret = env.SMTP_CONSOLE_SECRET;
  if (!secret) return true;
  return token.length > 10;
}

// ─── VPS Mailer ─────────────────────────────────────────

async function callVpsMailer(env, endpoint, body) {
  const baseUrl = env.VPS_MAILER_URL;
  const secret = env.VPS_MAILER_SECRET;
  if (!baseUrl) throw new Error("VPS mailer URL not configured (VPS_MAILER_URL).");

  const url = `${baseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;
  const headers = { "Content-Type": "application/json" };
  if (secret) headers["Authorization"] = `Bearer ${secret}`;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `VPS mailer error (${resp.status})`);
  return data;
}

// ─── Multi-Provider Email Fallback System ────────────────
// Priority: VPS Mailer (AWS SES) → Resend (free) → Brevo (free) → Mailgun → Cloudflare Email

async function sendEmailFallback(env, { from, to, subject, text, hostname }) {
  const providers = [];
  const errors = [];

  // Provider 1: VPS Mailer (AWS SES) — PRIMARY (when tunnel is up)
  if (env.VPS_MAILER_URL) {
    providers.push({
      name: "vps_mailer",
      label: "AWS SES via VPS",
      send: async () => {
        const result = await callVpsMailer(env, "/send-email", { from, to, subject, text, hostname });
        if (!result.delivered && result.error) throw new Error(result.error);
        return { provider: "vps_mailer", delivered: result.delivered || true, message: result.message || `Sent via AWS SES (VPS)` };
      }
    });
  }

  // Provider 2: Resend API — FREE fallback (3,000 emails/month free)
  if (env.RESEND_API_KEY) {
    providers.push({
      name: "resend",
      label: "Resend (Free)",
      send: async () => {
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from,
            to: Array.isArray(to) ? to : [to],
            subject,
            text,
            html: text.replace(/\n/g, "<br>")
          })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.message || `Resend error (${resp.status})`);
        return { provider: "resend", delivered: true, message: `Sent via Resend (free fallback)` };
      }
    });
  }

  // Provider 3: Brevo/Sendinblue — FREE fallback (300 emails/day free)
  if (env.BREVO_API_KEY) {
    providers.push({
      name: "brevo",
      label: "Brevo (Free)",
      send: async () => {
        const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": env.BREVO_API_KEY,
            "Content-Type": "application/json",
            "accept": "application/json"
          },
          body: JSON.stringify({
            sender: { email: from },
            to: (Array.isArray(to) ? to : [to]).map(email => ({ email })),
            subject,
            htmlContent: text.replace(/\n/g, "<br>"),
            textContent: text
          })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.message || `Brevo error (${resp.status})`);
        return { provider: "brevo", delivered: true, message: `Sent via Brevo (free fallback)` };
      }
    });
  }

  // Provider 4: Mailgun — paid fallback
  if (env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN) {
    providers.push({
      name: "mailgun",
      label: "Mailgun",
      send: async () => {
        const recipients = Array.isArray(to) ? to : [to];
        const resp = await fetch(`https://api.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${btoa(`api:${env.MAILGUN_API_KEY}`)}`,
          },
          body: new URLSearchParams({
            from,
            to: recipients.join(","),
            subject,
            text
          })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.message || `Mailgun error (${resp.status})`);
        return { provider: "mailgun", delivered: true, message: `Sent via Mailgun` };
      }
    });
  }

  // Provider 5: Cloudflare Email API — if configured
  if (env.CF_EMAIL_API_TOKEN) {
    providers.push({
      name: "cloudflare_email",
      label: "Cloudflare Email",
      send: async () => {
        const accountId = env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
        const recipients = Array.isArray(to) ? to : [to];
        for (const recipient of recipients) {
          const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/routing/addresses`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.CF_EMAIL_API_TOKEN}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ from, to: recipient, subject, text })
          });
          if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.message || `Cloudflare Email error (${resp.status})`);
          }
        }
        return { provider: "cloudflare_email", delivered: true, message: `Sent via Cloudflare Email` };
      }
    });
  }

  if (!providers.length) {
    throw new Error("No email providers configured. Set VPS_MAILER_URL or get a free Resend API key at resend.com.");
  }

  for (const provider of providers) {
    try {
      const result = await provider.send();
      return { ...result, attempted: providers.map(p => p.name), errors };
    } catch (err) {
      errors.push({ provider: provider.name, error: err.message });
      console.error(`Email provider ${provider.name} failed:`, err.message);
    }
  }

  throw new Error(`All email providers failed: ${errors.map(e => `${e.provider}: ${e.error}`).join("; ")}`);
}

// ─── Multi-Provider SMS Fallback System ──────────────────
// Priority: VPS Mailer / SMSGate (primary) → Telegram Bot (free fallback) → Twilio (trial) → Vonage

async function sendSmsFallback(env, { phones, text, gwUser, gwPass, gwUrl }) {
  const providers = [];
  const errors = [];

  // Provider 1: VPS Mailer (SMSGate) — PRIMARY
  if (env.VPS_MAILER_URL) {
    providers.push({
      name: "vps_mailer",
      label: "SMSGate via VPS",
      send: async () => {
        const result = await callVpsMailer(env, "/send-sms", { phones, text, gwUser, gwPass, gwUrl });
        if (!result.delivered && result.error) throw new Error(result.error);
        return { provider: "vps_mailer", delivered: result.delivered || true, message: result.message || `Sent via SMSGate (VPS)`, jobId: result.jobId };
      }
    });
  }

  // Provider 2: Telegram Bot — FREE fallback (sends to admin chat with SMS details)
  if (env.TELEGRAM_BOT_TOKEN) {
    providers.push({
      name: "telegram",
      label: "Telegram Bot (Free)",
      send: async () => {
        const adminChat = env.TELEGRAM_ADMIN_CHAT_ID;
        if (!adminChat) throw new Error("Telegram: no admin chat ID configured");
        const phoneList = phones.join(", ");
        const message = [
          "<b>📱 SMS Dispatch</b>",
          `<b>To:</b> <code>${phoneList}</code>`,
          `<b>Message:</b>`,
          text
        ].join("\n");
        const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: adminChat,
            text: message,
            parse_mode: "HTML"
          })
        });
        if (!resp.ok) throw new Error("Telegram: could not send to admin chat");
        return { provider: "telegram", delivered: true, message: `SMS delivered to admin Telegram chat (${phones.length} recipient(s))` };
      }
    });
  }

  // Provider 3: Twilio — free trial ($15 credit)
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER) {
    providers.push({
      name: "twilio",
      label: "Twilio (Trial)",
      send: async () => {
        let sent = 0;
        for (const phone of phones) {
          const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
            method: "POST",
            headers: {
              "Authorization": `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
            },
            body: new URLSearchParams({
              From: env.TWILIO_FROM_NUMBER,
              To: phone,
              Body: text
            })
          });
          if (resp.ok) sent++;
        }
        if (sent === 0) throw new Error("Twilio: all SMS failed");
        return { provider: "twilio", delivered: true, message: `Sent ${sent}/${phones.length} via Twilio` };
      }
    });
  }

  // Provider 4: Vonage/Nexmo — paid fallback
  if (env.VONAGE_API_KEY && env.VONAGE_API_SECRET && env.VONAGE_FROM) {
    providers.push({
      name: "vonage",
      label: "Vonage",
      send: async () => {
        let sent = 0;
        for (const phone of phones) {
          const resp = await fetch(`https://rest.nexmo.com/sms/json?api_key=${env.VONAGE_API_KEY}&api_secret=${env.VONAGE_API_SECRET}&from=${encodeURIComponent(env.VONAGE_FROM)}&to=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}`, {
            method: "POST"
          });
          const data = await resp.json().catch(() => ({}));
          if (data.messages?.[0]?.status === "0") sent++;
        }
        if (sent === 0) throw new Error("Vonage: all SMS failed");
        return { provider: "vonage", delivered: true, message: `Sent ${sent}/${phones.length} via Vonage` };
      }
    });
  }

  if (!providers.length) {
    throw new Error("No SMS providers configured. Set VPS_MAILER_URL or TWILIO_ACCOUNT_SID or VONAGE_API_KEY.");
  }

  for (const provider of providers) {
    try {
      const result = await provider.send();
      return { ...result, attempted: providers.map(p => p.name), errors };
    } catch (err) {
      errors.push({ provider: provider.name, error: err.message });
      console.error(`SMS provider ${provider.name} failed:`, err.message);
    }
  }

  throw new Error(`All SMS providers failed: ${errors.map(e => `${e.provider}: ${e.error}`).join("; ")}`);
}

// ─── API Handlers ───────────────────────────────────────

async function handleHealth(env) {
  const emailProviders = [
    env.VPS_MAILER_URL ? "vps_mailer (aws ses)" : null,
    env.RESEND_API_KEY ? "resend (free)" : null,
    env.BREVO_API_KEY ? "brevo (free)" : null,
    env.MAILGUN_API_KEY ? "mailgun" : null,
    env.CF_EMAIL_API_TOKEN ? "cloudflare_email" : null
  ].filter(Boolean);

  const smsProviders = [
    env.VPS_MAILER_URL ? "vps_mailer (smsgate)" : null,
    env.TELEGRAM_BOT_TOKEN ? "telegram (free)" : null,
    env.TWILIO_ACCOUNT_SID ? "twilio (trial)" : null,
    env.VONAGE_API_KEY ? "vonage" : null
  ].filter(Boolean);

  return json({
    ok: true,
    supabase: Boolean(env.SUPABASE_URL),
    paystack: Boolean(env.PAYSTACK_PUBLIC_KEY),
    telegram: Boolean(
      env.TELEGRAM_BOT_TOKEN &&
      (env.TELEGRAM_ADMIN_CHAT_ID || env.TELEGRAM_CHANNEL_ID)
    ),
    telegramAdmin: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_CHAT_ID),
    telegramChannel: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHANNEL_ID),
    usdt: Boolean(env.USDT_TRC20_ADDRESS),
    btc: Boolean(env.BTC_ADDRESS),
    email: {
      configured: emailProviders.length > 0,
      primary: emailProviders[0] || "none — get free key at resend.com",
      fallbacks: emailProviders.slice(1),
      allProviders: emailProviders
    },
    sms: {
      configured: smsProviders.length > 0,
      primary: smsProviders[0] || "none",
      fallbacks: smsProviders.slice(1),
      allProviders: smsProviders
    }
  });
}

async function handleVisitor(request) {
  return json({
    ip: getClientIp(request),
    userAgent: request.headers.get("user-agent") || ""
  });
}

async function handleConfig(env) {
  const sb = getSupabase(env);
  const botUsername = String(env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");
  const telegramReady = Boolean(
    env.TELEGRAM_BOT_TOKEN &&
    (env.TELEGRAM_ADMIN_CHAT_ID || env.TELEGRAM_CHANNEL_ID)
  );
  const market = sb ? await marketStatusOf(env, sb) : { flash: null, bundles: [], referralMultiplier: 1, surgeActive: false, surgeEndsAt: null };
  const flash = market.flash;
  return json({
    paystackPublicKey: env.PAYSTACK_PUBLIC_KEY || "",
    paystackCurrency: env.PAYSTACK_CURRENCY || "KES",
    paystackConversionRate: Number(env.PAYSTACK_CONVERSION_RATE || 129),
    usdtTrc20Address: env.USDT_TRC20_ADDRESS || "",
    usdtNetwork: "TRC20",
    tonAddress: env.TON_PAYMENT_ADDRESS || env.TON_ADDRESS || "",
    btcAddress: env.BTC_ADDRESS || "",
    btcNetwork: "BTC",
    starsPerUsd: starsPerUsdOf(env),
    starsEnabled: Boolean(env.TELEGRAM_BOT_TOKEN),
    storeUrl: env.STORE_URL || "https://dtdpaymentsbot.pages.dev",
    companyUrl: env.COMPANY_URL || "https://dvtechnologies.xyz",
    companyName: env.COMPANY_NAME || "DV Technologies",
    supportEmail: String(env.SUPPORT_EMAIL || "contact@dvtechnologies.xyz").trim().toLowerCase(),
    telegramBotUsername: botUsername,
    telegramBotUrl: botUsername ? `https://t.me/${botUsername}` : "",
    ownerUsername: String(env.TELEGRAM_OWNER_USERNAME || env.TELEGRAM_VENDOR_USERNAME || "Glock7money").replace(/^@/, ""),
    channelMainUrl: env.TELEGRAM_CHANNEL_LINK || "https://t.me/+ysMSObZyNWpjNTA0",
    channelPremiumUrl: env.TELEGRAM_PREMIUM_LINK || "https://t.me/+ZYBP2Qrr-JgyYTQ0",
    telegramEnabled: telegramReady,
    flash: flash ? {
      productId: flash.product_id || null,
      productName: flash.product_name || "",
      imageUrl: flash.image_url || "",
      originalPriceUsd: Number(flash.original_price_usd || 0),
      flashPriceUsd: Number(flash.flash_price_usd || 0),
      discountPct: Number(flash.discount_pct || 0),
      expiresAt: flash.expires_at || null
    } : null,
    referralMultiplier: market.referralMultiplier,
    referralSurgeActive: Boolean(market.surgeActive),
    referralSurgeEndsAt: market.surgeEndsAt,
    bundles: market.bundles.map((b) => ({
      id: b.id,
      name: b.name,
      productIds: Array.isArray(b.product_ids) ? b.product_ids : [],
      discountPct: Number(b.discount_pct || 0)
    })),
    paymentOptions: [
      { id: "USDT", label: "USDT (TRC20)", type: "crypto", asset: "USDT", network: "TRC20" },
      { id: "TON", label: "TON", type: "crypto", asset: "TON", network: "TON" },
      { id: "Bitcoin", label: "Bitcoin (BTC)", type: "crypto", asset: "BTC", network: "BTC" },
      { id: "Paystack", label: "Card / Bank · Global", type: "paystack" }
    ]
  });
}

const ORDER_STATUS_LABELS = {
  new: "New",
  confirmed: "Confirmed",
  delivered: "Delivered",
  cancelled: "Cancelled"
};

const PAYMENT_STATUS_LABELS = {
  pending: "Payment pending",
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded"
};

function orderStatusPayload(order) {
  const orderStatus = String(order.order_status || order.orderStatus || "new").toLowerCase();
  const paymentStatus = String(order.payment_status || order.paymentStatus || order.status || "pending").toLowerCase();
  return {
    id: order.id,
    status: orderStatus,
    statusLabel: ORDER_STATUS_LABELS[orderStatus] || orderStatus,
    paymentStatus,
    paymentStatusLabel: PAYMENT_STATUS_LABELS[paymentStatus] || paymentStatus,
    paymentMethod: order.payment_method || "n/a",
    totalUsd: Number(order.total_usd || 0),
    createdAt: order.created_at || null
  };
}

function matchesOrderEmail(order, email) {
  const norm = (value) => String(value || "").trim().toLowerCase();
  return norm(order.customer_email) === email || norm(order.customer_phone) === email;
}

async function handleOrderStatus(request, env) {
  const url = new URL(request.url);
  const orderId = String(url.searchParams.get("orderId") || "").trim();
  const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
  if (!orderId || !email) return json({ error: "Order ID and email are required." }, 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    return json({ error: "Order not found. Check your Order ID and email." }, 404);
  }

  const sb = getSupabase(env);
  if (!sb) return json({ error: "Order tracking is temporarily unavailable." }, 500);

  const { data, error } = await sb
    .from("orders")
    .select("id,customer_email,customer_phone,payment_method,payment_status,order_status,total_usd,created_at", { id: orderId });
  if (error) return json({ error: "Could not look up the order. Try again." }, 500);

  const order = (Array.isArray(data) ? data : []).find((row) => matchesOrderEmail(row, email));
  if (!order) return json({ error: "Order not found. Check your Order ID and email." }, 404);

  return json({ ok: true, order: orderStatusPayload(order) });
}

async function handleOrders(request, env) {
  const body = await request.json();
  const {
    customerName, customerEmail, telegramUsername, telegramUserId, paymentMethod,
    paymentReference, productAccount, deliveryDetails, items, totalUsd,
    visitorIp, userAgent
  } = body;

  if (!customerName || !customerEmail || !Array.isArray(items) || !items.length) {
    return json({ error: "Missing required order fields." }, 400);
  }

  const sb = getSupabase(env);
  if (!sb) return json({ error: "Supabase is not configured." }, 500);

  const normalizedMethod = normalizePaymentMethod(paymentMethod);
  const deliveryBlock = [
    `Email: ${customerEmail}`,
    `Payment option: ${normalizedMethod}`,
    telegramUserId ? `Telegram user id: ${telegramUserId}` : null,
    paymentReference ? `Payment reference: ${paymentReference}` : null,
    productAccount ? `Product account: ${productAccount}` : null,
    deliveryDetails || null
  ].filter(Boolean).join("\n");

  const rpcItems = items.map(item => ({
    product_id: item.product_id || "",
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price_usd: item.unit_price_usd
  }));

  let orderId = null;
  try {
    const rpcResult = await sb.rpc("create_store_order", {
      p_customer_name: customerName,
      p_customer_phone: customerEmail,
      p_telegram_username: telegramUsername || null,
      p_delivery_details: deliveryBlock,
      p_payment_method: dbPaymentMethod(normalizedMethod),
      p_total_usd: Number(totalUsd || 0),
      p_items: rpcItems
    });
    if (rpcResult && !rpcResult.error) orderId = rpcResult;
  } catch {}

  if (!orderId) {
    const { data, error } = await sb.from("orders").insert({
      customer_name: customerName,
      customer_phone: customerEmail,
      customer_email: customerEmail,
      telegram_username: telegramUsername || null,
      delivery_details: deliveryBlock,
      payment_method: dbPaymentMethod(normalizedMethod),
      payment_reference: paymentReference || null,
      product_account: productAccount || null,
      total_usd: Number(totalUsd || 0)
    });
    if (error) return json({ error: error.message || "Order insert failed." }, 500);
    orderId = data?.[0]?.id || data?.id;

    if (orderId) {
      const orderItems = items.map(item => ({
        order_id: orderId,
        product_id: item.product_id || null,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price_usd: item.unit_price_usd
      }));
      await sb.from("order_items").insert(orderItems);
    }
  }

  const itemLines = items.map(item => `• ${item.product_name} x${item.quantity}`).join("\n");
  const telegramMessage = [
    "<b>🛒 New DTD Store Order</b>",
    orderId ? `🔖 Order ID: <code>${orderId}</code>` : null,
    `👤 Name: ${customerName}`,
    `📧 Email: ${customerEmail}`,
    telegramUsername ? `💬 Telegram: @${String(telegramUsername).replace(/^@/, "")}` : null,
    `💳 Payment: ${normalizedMethod}`,
    paymentReference ? `🔗 Ref: <code>${paymentReference}</code>` : null,
    productAccount ? `🔑 Account: ${productAccount}` : null,
    `💵 Total: $${Number(totalUsd || 0).toFixed(2)} USD`,
    visitorIp ? `🌐 IP: <code>${visitorIp}</code>` : null,
    userAgent ? `🖥 Device: ${userAgent.substring(0, 80)}` : null,
    "",
    "<b>Items:</b>",
    itemLines
  ].filter(Boolean).join("\n");

  const channelIds = [
    env.TELEGRAM_CHANNEL_ID,
    env.TELEGRAM_BACKUP_CHANNEL_ID,
    env.TELEGRAM_GROUP_ID
  ].filter((id, i, arr) => id && arr.indexOf(id) === i);

  for (const channelId of channelIds) {
    await sendTelegram(env, channelId, telegramMessage);
  }
  if (env.TELEGRAM_ADMIN_CHAT_ID) {
    await sendTelegram(env, env.TELEGRAM_ADMIN_CHAT_ID, telegramMessage);
  }

  if (sb) {
    try {
      await sb.from("bot_events").insert({
        event_type: "web_order",
        chat_id: telegramUserId ? String(telegramUserId) : null,
        username: telegramUsername ? String(telegramUsername).replace(/^@/, "") : null,
        first_name: null,
        payload: `web order #${String(orderId || "").slice(0, 12)} · ${items.length} item(s) · $${Number(totalUsd || 0).toFixed(2)} USD · ${normalizedMethod}`,
        source: "web"
      });
    } catch {}
  }

  // For crypto methods, open an on-chain payment record the poller can auto-verify.
  let paymentId = null;
  if (orderId && /usdt|ton|bitcoin|btc|crypto/i.test(normalizedMethod)) {
    paymentId = await createPaymentForOrder(env, sb, orderId, normalizedMethod, Number(totalUsd || 0), telegramUserId, telegramUsername);
  }

  return json({ ok: true, orderId, paymentId });
}

// ─── Crypto Payment Verification ────────────────────────

async function handleCryptoVerify(request, env) {
  try {
    const body = await request.json();
    const { tx_hash, order_id, network, wallet_address, amount_paid } = body || {};
    if (!tx_hash || !order_id || !network || !wallet_address) {
      return json({ error: "tx_hash, order_id, network, wallet_address are required." }, 400);
    }
    if (!/^[0-9a-fA-F]{64}$/.test(tx_hash)) {
      return json({ error: "Invalid transaction hash format." }, 400);
    }
    const net = String(network).toLowerCase();
    if (!["trc20", "btc"].includes(net)) {
      return json({ error: "Unsupported network." }, 400);
    }

    const idem = await idempotencyCheck(env, `crypto:verify:${tx_hash}`);
    if (idem.duplicate) {
      return json({ ok: true, already_processed: true, status: idem.status }, 200);
    }

    const sb = getSupabase(env);
    if (!sb) return json({ error: "Database unavailable." }, 500);

    const { data: order, error: orderErr } = await sb.from("orders").select("*, order_items(*)").eq("id", order_id).single();
    if (orderErr || !order) return json({ error: "Order not found." }, 404);

    const { data: user } = await sb.from("users").select("id, crypto_wallet, telegram_id, email").eq("id", order.user_id).single();
    if (!user || String(user.crypto_wallet || "").toLowerCase() !== String(wallet_address).toLowerCase()) {
      return json({ error: "Wallet address does not match order owner." }, 403);
    }

    const CONFIRMATIONS = { trc20: 20, btc: 3 };
    let transactions = [];
    if (net === "trc20") {
      const usdtContract = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
      const url = `https://api.trongrid.io/v1/accounts/${encodeURIComponent(wallet_address)}/transactions/trc20?contract_address=${usdtContract}&limit=100`;
      const resp = await fetch(url);
      const data = await resp.json();
      transactions = (Array.isArray(data.data) ? data.data : []).map(t => ({
        txHash: t.transaction_id,
        amount: Number(t.amount) / 1e6,
        confirmations: Number(t.confirmations || 0),
        to: String(t.to || ""),
        from: String(t.from || ""),
        block: Number(t.block || 0)
      }));
    } else {
      const url = `https://blockstream.info/api/address/${encodeURIComponent(wallet_address)}/tx`;
      const resp = await fetch(url);
      const data = await resp.json();
      transactions = (Array.isArray(data) ? data : []).slice(0, 50).map(t => ({
        txHash: t.txid,
        amount: 0,
        confirmations: Number(t.status?.confirmations || 0),
        to: wallet_address,
        from: "unknown",
        block: Number(t.status?.block_height || 0)
      }));
    }

    const match = transactions.find(t =>
      String(t.txHash || "").toLowerCase() === tx_hash.toLowerCase() &&
      String(t.to || "").toLowerCase() === wallet_address.toLowerCase() &&
      t.confirmations >= CONFIRMATIONS[net]
    );
    if (!match) {
      await setIdempotencyStatus(env, `crypto:verify:${tx_hash}`, "not_found_or_unconfirmed");
      return json({ error: "Transaction not found or insufficient confirmations.", required_confirmations: CONFIRMATIONS[net] }, 400);
    }

    const receivedUsd = net === "trc20" ? match.amount : Number(order.total_usd || 0);
    const expectedUsd = Number(order.total_usd || 0);
    if (net === "trc20" && receivedUsd < expectedUsd * 0.98) {
      await setIdempotencyStatus(env, `crypto:verify:${tx_hash}`, "insufficient_amount");
      return json({ error: "Insufficient amount received.", expected_usd: expectedUsd, received_usd: receivedUsd }, 400);
    }

    await sb.from("crypto_deposits").insert({
      user_id: user.id, order_id, network: net, tx_hash, wallet_address,
      amount_expected: expectedUsd, amount_received: receivedUsd,
      confirmations: match.confirmations, status: "verified",
      verified_at: new Date().toISOString()
    }).catch(() => {});

    await sb.from("orders").update({
      payment_status: "paid", order_status: "confirmed", tx_hash,
      amount_paid: receivedUsd || expectedUsd
    }).eq("id", order_id);

    await setIdempotencyStatus(env, `crypto:verify:${tx_hash}`, "verified");

    const redis = getRedis(env);
    if (redis) {
      await redis.xadd("delivery:queue", "*", "order_id", order_id, "user_id", user.id,
        "telegram_id", user.telegram_id || "", "email", user.email || "");
    }

    return json({ ok: true, verified: true, order_id, tx_hash, network: net,
      amount_received: receivedUsd || expectedUsd, confirmations: match.confirmations,
      message: "Payment verified. Order is being fulfilled." });
  } catch (err) {
    return json({ error: err.message || "Internal verification error." }, 500);
  }
}

// ─── Gated DTDSHOP.CC Catalog ───────────────────────────

async function handleGatedProducts(request, env) {
  try {
    const token = extractJwt(request);
    if (!token) return json({ error: "Authentication required." }, 401);
    const payload = await verifyJwt(token, JWT_SECRET(env));
    if (!payload) return json({ error: "Invalid or expired session." }, 401);

    const sb = getSupabase(env);
    if (!sb) return json({ error: "Database unavailable." }, 500);

    const { data: user } = await sb.from("users").select("id, crypto_wallet, verified_deposit_status").eq("id", payload.sub).single();
    if (!user || !user.verified_deposit_status) {
      return json({ error: "Gated catalog requires a verified $5+ crypto deposit." }, 403);
    }

    const { data: deposits } = await sb.from("crypto_deposits").select("amount_received, status").eq("user_id", user.id).eq("status", "verified");
    const totalDeposited = (deposits || []).reduce((s, d) => s + Number(d.amount_received || 0), 0);
    if (totalDeposited < 5) {
      return json({ error: "Minimum $5 USDT/BTC verified deposit required to unlock DTDSHOP.CC." }, 403);
    }

    const { data: products, error } = await sb.from("products").select("*").eq("is_gated", true).eq("is_active", true);
    if (error) return json({ error: "Catalog lookup failed." }, 500);

    return json({ ok: true, unlocked: true, products: products || [] });
  } catch (err) {
    return json({ error: err.message || "Could not load gated catalog." }, 500);
  }
}

// ─── Paystack Webhook (Idempotent) ──────────────────────

async function handlePaystackWebhook(request, env) {
  try {
    const body = await request.json();
    const { event, data } = body || {};
    const reference = data?.reference || "";
    const idem = await idempotencyCheck(env, `webhook:paystack:${reference}`);
    if (idem.duplicate) return json({ ok: true, duplicate: true }, 200);

    if (event === "charge.success" && data?.status === "success") {
      await setIdempotencyStatus(env, `webhook:paystack:${reference}`, "fulfilled");
      const sb = getSupabase(env);
      const orderRef = data.metadata?.order_id;
      if (orderRef && sb) {
        await sb.from("orders").update({ payment_status: "paid", order_status: "confirmed" }).eq("id", orderRef);
        const { data: order } = await sb.from("orders").select("*, order_items(*)").eq("id", orderRef).single();
        if (order) {
          const redis = getRedis(env);
          if (redis) {
            await redis.xadd("delivery:queue", "*", "order_id", orderRef,
              "user_id", order.user_id || "", "telegram_id", "", "email", order.customer_email || "");
          }
        }
      }
    }
    return json({ ok: true }, 200);
  } catch (err) {
    return json({ ok: true }, 200);
  }
}

async function createPaymentForOrder(env, sb, orderId, normalizedMethod, totalUsd, telegramUserId, telegramUsername) {
    try {
    let currency = "BTC";
    if (method.includes("usdt")) currency = "USDT";
    else if (method.includes("ton")) currency = "TON";
    const address = currency === "TON"
      ? (env.TON_PAYMENT_ADDRESS || env.TON_ADDRESS || "")
      : currency === "USDT"
        ? (env.USDT_TRC20_ADDRESS || "")
        : (env.BTC_ADDRESS || "");
    if (!address) return null;
    let amount = totalUsd;
    if (currency === "TON") {
      const rate = await fetchTonPriceUsd(env);
      amount = rate > 0 ? Number((totalUsd / rate).toFixed(2)) : Number((totalUsd / 5).toFixed(2));
    }
    const id = crypto.randomUUID();
    const { error } = await sb.from("payments").insert({
      id,
      order_id: String(orderId),
      kind: "product",
      currency,
      amount,
      amount_usd: totalUsd,
      address,
      network: currency === "USDT" ? "TRC20" : currency,
      telegram_user_id: telegramUserId ? String(telegramUserId) : null,
      telegram_username: telegramUsername ? String(telegramUsername).replace(/^@/, "").trim() : null,
      status: "pending"
    });
    if (error) return null;
    return id;
  } catch {
    return null;
  }
}

async function handlePaystackInit(request, env) {
  const secret = env.PAYSTACK_SECRET_KEY;
  if (!secret) return json({ error: "Paystack secret key not configured." }, 500);

  const body = await request.json();
  const email = String(body.email || "").trim();
  const amountUsd = Number(body.amountUsd || 0);
  if (!email || !(amountUsd > 0)) return json({ error: "Email and amount are required." }, 400);

  const currency = env.PAYSTACK_CURRENCY || "KES";
  const rate = Number(env.PAYSTACK_CONVERSION_RATE || 129);
  const amount = Math.round(amountUsd * rate * 100);
  const reference = String(body.reference || `DTD-${Date.now()}`);
  const url = new URL(request.url);

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email, amount, currency, reference,
      callback_url: `${url.protocol}//${url.host}/?paid=1&reference=${encodeURIComponent(reference)}`,
      metadata: {
        customer_name: body.name || "",
        amount_usd: amountUsd,
        cart_items: body.cartItems || ""
      }
    })
  });

  const payload = await response.json();
  if (!response.ok || !payload.status) {
    return json({ error: payload.message || "Could not start Paystack payment." }, 400);
  }

  return json({
    ok: true,
    reference: payload.data.reference,
    access_code: payload.data.access_code,
    authorization_url: payload.data.authorization_url,
    currency, amount
  });
}

async function handlePaystackVerify(request, env) {
  const body = await request.json();
  const reference = String(body.reference || "").trim();
  if (!reference) return json({ error: "Missing reference." }, 400);

  const secret = env.PAYSTACK_SECRET_KEY;
  if (!secret) return json({ error: "Paystack secret key not configured." }, 500);

  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${secret}` } }
  );

  const payload = await response.json();
  if (!response.ok || !payload.status) {
    return json({ error: payload.message || "Verification failed." }, 400);
  }

  return json({
    ok: true,
    paid: payload.data.status === "success",
    amount: payload.data.amount,
    currency: payload.data.currency,
    reference: payload.data.reference
  });
}

async function handleTelegramMessage(request, env) {
  const body = await request.json();
  const message = String(body.message || "").trim();
  const name = String(body.name || "Store visitor").trim();
  const contact = String(body.contact || "").trim();

  if (!message) return json({ error: "Message is required." }, 400);

  const adminChat = env.TELEGRAM_ADMIN_CHAT_ID;
  const result = await sendTelegram(
    env, adminChat,
    ["<b>DTD Store chat</b>", `From: ${name}`, contact ? `Contact: ${contact}` : null, "", message]
      .filter(Boolean).join("\n")
  );

  if (!result.ok) {
    const detail = result.reason === "not_configured"
      ? "Telegram bot is not configured."
      : result.reason === "unauthorized"
        ? "Telegram bot token is invalid or revoked."
        : "Could not reach Telegram.";
    return json({ error: detail }, 503);
  }

  return json({ ok: true });
}

// ─── Telegram Bot Storefront ────────────────────────────

function escHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function telegramApi(env, method, body) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, reason: "not_configured" };
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, reason: payload.description || "send_failed" };
  return { ok: true, result: payload.result };
}

async function answerCallback(env, callbackQueryId, text = "") {
  return telegramApi(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false
  });
}

async function sendTelegramPhoto(env, chatId, photoUrl, caption, options = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !photoUrl) return { ok: false, reason: "missing" };
  const body = {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  if (options.reply_markup) body.reply_markup = options.reply_markup;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, reason: payload.description || "photo_failed" };
    return { ok: true, result: payload.result };
  } catch {
    return { ok: false, reason: "photo_failed" };
  }
}

async function reactToMessage(env, chatId, messageId, emoji) {
  if (!messageId) return { ok: false };
  return telegramApi(env, "setMessageReaction", {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: "emoji", emoji }]
  });
}

function productImageUrl(env, product) {
  const raw = String(product.image_url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:") || raw.startsWith("blob:")) return "";
  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `${env.SUPABASE_URL || ""}${raw}`;
  return raw;
}

function qrImageUrl(data, size = 480) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=10&qzone=2&data=${encodeURIComponent(data)}`;
}

function miniAppUrlOf(env, route = "shop") {
  const store = storeUrlOf(env);
  const base = `${store}?tgWebAppStartParam=${encodeURIComponent(route)}&tgWebAppPlatform=telegram`;
  return base;
}

async function fetchProducts(sb) {
  if (!sb) return [];
  const { data } = await sb.from("products").select("*", { active: true });
  return (Array.isArray(data) ? data : [])
    .filter((p) => p.active === true || p.active == null)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

// ─── Market brain: flash deals, bundles, surges, social proof ──────

async function activeFlash(sb) {
  if (!sb) return null;
  const { data } = await sb.from("flash_deals").select("*", { status: "in.(active,last_chance)", order: "created_at.desc", limit: "1" });
  const row = (Array.isArray(data) ? data : [])[0];
  if (!row) return null;
  const expires = new Date(String(row.expires_at || "").replace("Z", "+00:00"));
  if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) return null;
  return row;
}

async function activeBundles(sb) {
  if (!sb) return [];
  const { data } = await sb.from("bundles").select("*", { active: true });
  return Array.isArray(data) ? data.filter((b) => b.active === true) : [];
}

async function marketSetting(sb, key, fallback) {
  if (!sb) return fallback;
  const { data } = await sb.from("app_settings").select("value", { key });
  const row = (Array.isArray(data) ? data : [])[0];
  if (!row) return fallback;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : fallback;
}

async function marketStatusOf(env, sb) {
  const [flash, bundles, multiplier, surgeHours, surgeStart] = await Promise.all([
    activeFlash(sb),
    activeBundles(sb),
    marketSetting(sb, "referral_multiplier", 1),
    marketSetting(sb, "referral_surge_hours", 0),
    marketSetting(sb, "referral_surge_started_at", "")
  ]);
  let surgeActive = false;
  if (Number(multiplier) > 1 && Number(surgeHours) > 0 && surgeStart) {
    const start = new Date(String(surgeStart).replace("Z", "+00:00"));
    if (!Number.isNaN(start.getTime())) {
      surgeActive = (Date.now() - start.getTime()) < Number(surgeHours) * 3600000;
    }
  }
  return { flash, bundles, referralMultiplier: Number(multiplier), surgeActive, surgeEndsAt: surgeActive ? new Date(new Date(String(surgeStart).replace("Z", "+00:00")).getTime() + Number(surgeHours) * 3600000).toISOString() : null };
}

// Server-side flash-aware total: uses DB product prices + active flash discount.
async function flashTotal(sb, items) {
  if (!sb || !Array.isArray(items) || !items.length) return null;
  const products = await fetchProducts(sb);
  const byId = new Map(products.map((p) => [String(p.id), p]));
  const byName = new Map(products.map((p) => [String(p.name || "").toLowerCase(), p]));
  const flash = await activeFlash(sb);
  const flashBy = new Set();
  if (flash) {
    if (flash.product_id) flashBy.add(String(flash.product_id));
    if (flash.product_name) flashBy.add(String(flash.product_name).toLowerCase());
  }
  let total = 0;
  let adjusted = false;
  for (const item of items) {
    const qty = Math.max(1, Number(item.quantity || 1));
    let p = byId.get(String(item.product_id || "")) || byName.get(String(item.product_name || "").toLowerCase());
    if (!p) p = byName.get(String(item.name || "").toLowerCase());
    let price = p ? Number(p.price_usd || 0) : Number(item.unit_price_usd || item.price_usd || 0);
    if (flash && p && (flashBy.has(String(p.id)) || flashBy.has(String(p.name || "").toLowerCase()))) {
      price = Number(flash.flash_price_usd || 0) || price;
      adjusted = true;
    }
    total += price * qty;
  }
  return { totalUsd: Math.round(total * 100) / 100, adjusted };
}

async function insertProofRow(sb, row) {
  if (!sb) return;
  await sb.from("social_proof_posts").insert(row).catch(() => {});
}

function storeUrlOf(env) {
  return (env.STORE_URL || "https://dtdpaymentsbot.pages.dev").replace(/\/$/, "");
}

function ownerOf(env) {
  return String(env.TELEGRAM_OWNER_USERNAME || "Glock7money").replace(/^@/, "");
}

async function sendProductsPage(env, chatId, products, page = 0) {
  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(products.length / pageSize));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const chunk = products.slice(safePage * pageSize, (safePage + 1) * pageSize);

  if (!chunk.length) {
    return sendTelegram(env, chatId, "🛒 <b>No products available right now.</b>");
  }

  const start = safePage * pageSize;
  const shades = ["success", "primary", "danger"];
  const rows = chunk.map((p, i) => [
    {
      text: `${start + i + 1}. ${p.name} — 💲$${fmtMoney(p.price_usd)}`,
      callback_data: `view|${p.id}`,
      style: shades[(start + i) % shades.length]
    }
  ]);

  const nav = [];
  if (safePage > 0) nav.push({ text: "⬅️ Prev", callback_data: `prod|${safePage - 1}` });
  nav.push({ text: `📄 ${safePage + 1}/${totalPages}`, callback_data: "noop" });
  if (safePage + 1 < totalPages) nav.push({ text: "Next ➡️", callback_data: `prod|${safePage + 1}` });
  rows.push(nav);
  rows.push([
    { text: "🛍 Open Store", url: storeUrlOf(env) },
    { text: "🚀 Mini App", web_app: { url: miniAppUrlOf(env, "products") } }
  ]);

  const header = [
    "🛒 <b>DTD STORE — Products</b>",
    "━━━━━━━━━━━━━━━━━━",
    "💎 USDT (TRC20) · ₿ BTC · 💳 Card",
    "",
    "👇 Tap a product to view details & buy"
  ].join("\n");

  return sendTelegram(env, chatId, header, { reply_markup: { inline_keyboard: rows } });
}

async function sendProductView(env, chatId, product) {
  const description = escHtml(product.description || "No description.").slice(0, 600);
  const caption = [
    `🛒 <b>${escHtml(product.name)}</b>`,
    "━━━━━━━━━━━━━━━━━━",
    description,
    "",
    `💰 <b>Price: $${fmtMoney(product.price_usd)} USD</b>`,
    "━━━━━━━━━━━━━━━━━━",
    "💎 <b>USDT (TRC20)</b> · ₿ <b>Bitcoin</b> · 💳 <b>Card</b>",
    `<a href="${storeUrlOf(env)}">🔗 Buy on the web store</a>`
  ].join("\n");

  const keyboard = {
    inline_keyboard: [
      [
        { text: "💎 USDT (TRC20)", callback_data: `pay|${product.id}|USDT`, style: "success" },
        { text: "₿ BTC", callback_data: `pay|${product.id}|Bitcoin`, style: "primary" }
      ],
      [{ text: "💳 Card / Bank", callback_data: `pay|${product.id}|Paystack`, style: "danger" }],
      [
        { text: "🛍 Open Store", url: storeUrlOf(env) },
        { text: "🚀 Mini App", web_app: { url: miniAppUrlOf(env, "products") } }
      ],
      [
        { text: "🔥", callback_data: `react|${product.id}|🔥` },
        { text: "❤️", callback_data: `react|${product.id}|❤️` },
        { text: "🤝 Support", url: `https://t.me/${ownerOf(env)}` },
        { text: "⬅️ Back", callback_data: "prod|0" }
      ]
    ]
  };

  const imageUrl = productImageUrl(env, product);
  const sent = imageUrl
    ? await sendTelegramPhoto(env, chatId, imageUrl, caption, { reply_markup: keyboard })
    : { ok: false };
  if (!sent.ok) {
    return sendTelegram(env, chatId, caption, { reply_markup: keyboard });
  }
  return sent;
}

async function createBotOrder(env, sb, product, user, method) {
  const normalized = normalizePaymentMethod(method);
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Telegram customer";
  const tg = user.username ? `@${String(user.username).replace(/^@/, "")}` : `id ${user.id}`;
  const deliveryBlock = `Telegram bot order.\nCustomer: ${tg}\nContact via Telegram DM.`;
  const items = [
    { product_id: product.id, product_name: product.name, quantity: 1, unit_price_usd: Number(product.price_usd) }
  ];

  let orderId = null;
  try {
    const rpcResult = await sb.rpc("create_store_order", {
      p_customer_name: name,
      p_customer_phone: String(user.id),
      p_telegram_username: user.username || null,
      p_delivery_details: deliveryBlock,
      p_payment_method: dbPaymentMethod(normalized),
      p_total_usd: Number(product.price_usd),
      p_items: items
    });
    if (rpcResult && !rpcResult.error) orderId = rpcResult;
  } catch {}

  if (!orderId) {
    const { data, error } = await sb.from("orders").insert({
      customer_name: name,
      customer_phone: String(user.id),
      customer_email: `${user.id}@telegram`,
      telegram_username: user.username || null,
      delivery_details: deliveryBlock,
      payment_method: dbPaymentMethod(normalized),
      total_usd: Number(product.price_usd)
    });
    if (error) throw new Error(error.message || "Order insert failed.");
    orderId = data?.[0]?.id || data?.id;
    if (orderId) {
      await sb.from("order_items").insert(
        items.map((item) => ({ order_id: orderId, ...item }))
      );
    }
  }

  return { orderId, normalized };
}

function paymentInstructions(env, normalized, totalUsd) {
  if (normalized === "Bitcoin") {
    const address = env.BTC_ADDRESS || "";
    return `₿ <b>Bitcoin payment</b>\n\nSend exactly <b>$${fmtMoney(totalUsd)} USD worth of BTC</b> to:\n<code>${address || "(not configured)"}</code>\n\nNetwork: <b>Bitcoin</b>\nAfter sending, tap "I've sent payment".`;
  }
  if (normalized === "Paystack") {
    return `💳 <b>Card / Bank payment</b>\n\nComplete payment on the store page:\n${storeUrlOf(env)}\n\nAfter paying, tap "I've sent payment" and our team will confirm.`;
  }
  const address = env.USDT_TRC20_ADDRESS || "";
  return `💎 <b>USDT (TRC20) payment</b>\n\nSend exactly <b>${fmtMoney(totalUsd)} USDT</b> to:\n<code>${address || "(not configured)"}</code>\n\nNetwork: <b>TRON (TRC20)</b>\nAfter sending, tap "I've sent payment".`;
}

async function handleBotPay(env, sb, chatId, user, productId, method) {
  const { data } = await sb.from("products").select("*", { id: productId });
  const product = (Array.isArray(data) ? data : [])[0];
  if (!product) return sendTelegram(env, chatId, "Product not found.");

  let created;
  try {
    created = await createBotOrder(env, sb, product, user, method);
  } catch (error) {
    return sendTelegram(env, chatId, `Could not create the order: ${escHtml(error.message)}`);
  }
  if (!created.orderId) return sendTelegram(env, chatId, "Could not create the order. Please try again.");

  const total = Number(product.price_usd);
  const normalized = created.normalized;

  const keyboard = {
    inline_keyboard: [
      [{ text: "✅ I've sent payment", callback_data: `paid|${created.orderId}` }],
      [
        { text: "🛍 Open Store", url: storeUrlOf(env) },
        { text: "🚀 Mini App", web_app: { url: miniAppUrlOf(env, "products") } }
      ],
      [{ text: "⬅️ Back to products", callback_data: "prod|0" }]
    ]
  };

  const header = [
    `🧾 <u>Order #${escHtml(created.orderId)}</u>`,
    `🛒 ${escHtml(product.name)}`,
    `💰 <b>Total: $${fmtMoney(total)} USD</b>`
  ].join("\n");

  const remind = sb
    ? await sb.from("bot_reminders").insert({
        chat_id: String(chatId),
        created_by: String(user.id || ""),
        message: `Payment still pending for order <code>${escHtml(created.orderId)}</code> — ${escHtml(product.name)} ($${fmtMoney(total)}).`,
        due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      })
    : null;
  void remind;

  if (normalized === "Bitcoin") {
    const address = env.BTC_ADDRESS || "";
    const caption = [
      header,
      "",
      "₿ <u>Bitcoin Payment</u>",
      `📤 Send <b>$${fmtMoney(total)} USD worth of BTC</b> to the address below:`,
      `<code>${address || "(not configured)"}</code>`,
      "",
      "📷 <i>Scan the QR with any BTC wallet</i>",
      "✅ Tap <b>“I've sent payment”</b> once sent"
    ].join("\n");
    const sent = address ? await sendTelegramPhoto(env, chatId, qrImageUrl(address), caption, { reply_markup: keyboard }) : { ok: false };
    if (!sent.ok) return sendTelegram(env, chatId, caption, { reply_markup: keyboard });
    return sent;
  }

  if (normalized === "Paystack") {
    const caption = [
      header,
      "",
      "💳 <u>Card / Bank Payment</u>",
      "Complete your payment securely via Paystack on the store:",
      `<a href="${storeUrlOf(env)}">🛍 Open the store →</a>`,
      "",
      "After paying, tap <b>“I've sent payment”</b> so we can confirm instantly."
    ].join("\n");
    return sendTelegram(env, chatId, caption, { reply_markup: keyboard });
  }

  const address = env.USDT_TRC20_ADDRESS || "";
  const caption = [
    header,
    "",
    "💎 <u>USDT (TRC20) Payment</u>",
    `📤 Send <b>${fmtMoney(total)} USDT</b> on <b>TRON (TRC20)</b> to:`,
    `<code>${address || "(not configured)"}</code>`,
    "",
    "📷 <i>Scan the QR with any TRC20 wallet</i>",
    "✅ Tap <b>“I've sent payment”</b> once sent"
  ].join("\n");
  const sent = address ? await sendTelegramPhoto(env, chatId, qrImageUrl(address), caption, { reply_markup: keyboard }) : { ok: false };
  if (!sent.ok) return sendTelegram(env, chatId, caption, { reply_markup: keyboard });
  return sent;
}

async function handleBotPaid(env, sb, chatId, user, orderId) {
  const { data } = await sb.from("orders").select("*", { id: orderId });
  const order = (Array.isArray(data) ? data : [])[0];
  if (!order) return sendTelegram(env, chatId, "Order not found.");

  if (order.payment_status !== "paid" && order.order_status !== "confirmed") {
    await sb.from("orders").update({ payment_status: "paid", order_status: "confirmed" }, { id: orderId });
  }

  const tg = user.username ? `@${String(user.username).replace(/^@/, "")}` : `id ${user.id}`;
  const adminChat = env.TELEGRAM_ADMIN_CHAT_ID;
  if (adminChat) {
    await sendTelegram(env, adminChat, [
      "<b>✅ Payment reported</b>",
      `🔖 Order: <code>${escHtml(orderId)}</code>`,
      `👤 Customer: ${tg}`,
      `💳 Method: ${escHtml(order.payment_method || "")}`,
      `💵 Total: $${fmtMoney(order.total_usd)}`,
      "",
      "Verify payment, then deliver to the customer."
    ].join("\n"));
  }

  return sendTelegram(env, chatId, [
    "✅ <b>Payment recorded!</b>",
    "",
    `Order <code>${escHtml(orderId)}</code> is marked as paid.`,
    "Our team will confirm and deliver shortly.",
    "",
    `Support: @${ownerOf(env)}`
  ].join("\n"));
}

// ─── Earning engine: Stars, crypto (TON/USDT), referrals ──

async function botApi(env, method, body = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, reason: "no_token" };
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  return data;
}

function starsPerUsdOf(env) {
  return Math.max(1, Number(env.STARS_PER_USD || 75) || 75);
}

function randHex(len = 12) {
  const s = crypto.randomUUID().replace(/-/g, "");
  return s.slice(0, len);
}

async function fetchTonPriceUsd(env) {
  try {
    const resp = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd", {
      headers: { "User-Agent": "DTDStore/1.0" }
    });
    const data = await resp.json().catch(() => ({}));
    const price = Number(data?.["the-open-network"]?.usd || 0);
    if (price > 0) return price;
  } catch {}
  return Number(env.TON_PRICE_USD || 5) || 5;
}

async function creditReferrerFor(sb, payerUserId, usd, kind, note) {
  if (!sb || !payerUserId) return null;
  try {
    const { data: refs } = await sb.from("bot_referrals").select("*", { referred_user_id: String(payerUserId) });
    const ref = (Array.isArray(refs) ? refs : [])[0];
    if (!ref || !ref.referrer_user_id) return null;
    const referrer = String(ref.referrer_user_id);
    if (referrer === String(payerUserId)) return null;
    const rate = 0.1; // 10% commission on confirmed purchases
    const commission = Number(usd || 0) * rate;
    if (commission <= 0) return null;
    const { data: existing } = await sb.from("bot_credits").select("*", { user_id: referrer });
    const row = (Array.isArray(existing) ? existing : [])[0];
    if (row) {
      await sb.from("bot_credits").update({
        balance_usd: Number(row.balance_usd || 0) + commission,
        lifetime_earned_usd: Number(row.lifetime_earned_usd || 0) + commission,
        updated_at: new Date().toISOString()
      }, { user_id: referrer });
    } else {
      await sb.from("bot_credits").insert({
        user_id: referrer,
        balance_usd: commission,
        lifetime_earned_usd: commission
      });
    }
    await sb.from("earn_events").insert({
      user_id: referrer,
      kind: kind || "referral_conversion",
      amount_usd: commission,
      note: note || null
    }).catch(() => {});
    if (ref.status !== "converted") {
      await sb.from("bot_referrals").update(
        { status: "converted", converted_at: new Date().toISOString() },
        { referred_user_id: String(payerUserId) }
      ).catch(() => {});
    }
    return commission;
  } catch {
    return null;
  }
}

async function createOrderFromPayment(env, sb, opts) {
  const name = opts.customerName || "Telegram customer";
  const email = opts.customerEmail || `${opts.telegramUserId || "tg"}@telegram`;
  const deliveryBlock = opts.deliveryDetails || `Payment confirmed automatically.\nContact via Telegram DM.`;
  let orderId = null;
  try {
    const rpcResult = await sb.rpc("create_store_order", {
      p_customer_name: name,
      p_customer_phone: email,
      p_telegram_username: opts.telegramUsername || null,
      p_delivery_details: deliveryBlock,
      p_payment_method: dbPaymentMethod(opts.method),
      p_total_usd: Number(opts.totalUsd || 0),
      p_items: (opts.items || []).map((item) => ({
        product_id: item.product_id || "",
        product_name: item.product_name,
        quantity: item.quantity || 1,
        unit_price_usd: item.unit_price_usd
      }))
    });
    if (rpcResult && !rpcResult.error) orderId = rpcResult;
  } catch {}
  if (!orderId) {
    const { data, error } = await sb.from("orders").insert({
      customer_name: name,
      customer_phone: email,
      customer_email: email,
      telegram_username: opts.telegramUsername || null,
      delivery_details: deliveryBlock,
      payment_method: dbPaymentMethod(opts.method),
      payment_reference: opts.paymentReference || null,
      total_usd: Number(opts.totalUsd || 0)
    });
    if (error) return null;
    orderId = data?.[0]?.id || data?.id;
    if (orderId && (opts.items || []).length) {
      await sb.from("order_items").insert(
        (opts.items || []).map((item) => ({
          order_id: orderId,
          product_id: item.product_id || null,
          product_name: item.product_name,
          quantity: item.quantity || 1,
          unit_price_usd: item.unit_price_usd
        }))
      ).catch(() => {});
    }
  }
  if (orderId) {
    await sb.from("orders").update(
      { payment_status: "paid", order_status: "confirmed" },
      { id: orderId }
    ).catch(() => {});
  }
  return orderId;
}

async function fulfillStarsInvoice(env, sb, invoice) {
  const id = String(invoice.id || "");
  if (sb) {
    await sb.from("stars_invoices").update({ status: "paid", updated_at: new Date().toISOString() }, { id }).catch(() => {});
  }
  const kind = invoice.kind === "tip" || invoice.kind === "donation" ? "tip" : "product";
  const adminChat = env.TELEGRAM_ADMIN_CHAT_ID;
  const who = `${escHtml(invoice.customer_name || "anon")}` + (invoice.telegram_username ? ` (@${escHtml(String(invoice.telegram_username).replace(/^@/, ""))})` : "");

  if (kind === "tip") {
    if (adminChat) {
      await sendTelegram(env, adminChat, [
        "⭐ <b>Stars tip received</b>",
        `👤 ${who}`,
        `💫 ${Number(invoice.stars_amount || 0)} ⭐ ≈ $${fmtMoney(Number(invoice.total_usd || 0))}`,
        `🔖 Invoice: <code>${escHtml(id)}</code>`
      ].join("\n"));
    }
    return { orderId: null, kind };
  }

  const items = Array.isArray(invoice.items_json) && invoice.items_json.length
    ? invoice.items_json
    : (invoice.product_id
        ? [{ product_id: invoice.product_id, product_name: invoice.product_name, quantity: 1, unit_price_usd: Number(invoice.total_usd || 0) }]
        : []);
  const orderId = await createOrderFromPayment(env, sb, {
    customerName: invoice.customer_name,
    customerEmail: invoice.customer_email,
    telegramUserId: invoice.telegram_user_id,
    telegramUsername: invoice.telegram_username,
    deliveryDetails: `Telegram Stars (XTR) payment.\nInvoice: ${id}\nContact via Telegram DM.`,
    method: "Paystack",
    totalUsd: Number(invoice.total_usd || 0),
    items
  });
  if (invoice.telegram_user_id) {
    await creditReferrerFor(sb, invoice.telegram_user_id, Number(invoice.total_usd || 0), "referral_conversion", `Stars order ${id}`);
  }
  if (orderId && sb) {
    await sb.from("stars_invoices").update({ order_id: orderId }, { id }).catch(() => {});
    await sb.from("abandoned_nudges").update({ status: "paid" }, { source: "stars", source_id: id }).catch(() => {});
    const firstItem = (Array.isArray(items) ? items : [])[0];
    await insertProofRow(sb, {
      payment_id: id,
      kind: "order",
      buyer_name: String(invoice.customer_name || "A customer").slice(0, 60),
      buyer_username: String(invoice.telegram_username || "").replace(/^@/, "").slice(0, 60) || null,
      product_name: String(firstItem?.product_name || invoice.product_name || "an order").slice(0, 80),
      amount_usd: Number(invoice.total_usd || 0)
    });
  }
  const chatId = invoice.chat_id || invoice.telegram_user_id;
  if (orderId && chatId) {
    await sendTelegram(env, chatId, [
      "✅ <b>Payment confirmed!</b>",
      `Order <code>${escHtml(orderId)}</code> created.`,
      "Our team will deliver your product shortly.",
      "",
      `Support: @${ownerOf(env)}`
    ].join("\n"));
  }
  if (adminChat) {
    await sendTelegram(env, adminChat, [
      "⭐ <b>Stars order paid (auto)</b>",
      `🔖 Order: <code>${escHtml(orderId || "?")}</code>`,
      `👤 ${who}`,
      `💫 ${Number(invoice.stars_amount || 0)} ⭐ · $${fmtMoney(Number(invoice.total_usd || 0))}`,
      "",
      "Deliver the product to the customer."
    ].join("\n"));
  }
  return { orderId, kind };
}

async function handleStarsInvoice(request, env) {
  const sb = getSupabase(env);
  const url = new URL(request.url);

  if (request.method === "GET") {
    const id = String(url.searchParams.get("id") || "");
    if (!id || !sb) return json({ ok: false, error: "Missing id." }, 400);
    const { data } = await sb.from("stars_invoices").select("*", { id });
    const row = (Array.isArray(data) ? data : [])[0];
    if (!row) return json({ ok: false, error: "Invoice not found." }, 404);
    return json({ ok: true, id: row.id, status: row.status || "pending", orderId: row.order_id || null });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!sb) return json({ ok: false, error: "Supabase is not configured." }, 500);
  if (!env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: "Telegram bot not configured." }, 500);

  const body = await request.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items.filter((item) => item && item.product_name) : [];
  let totalUsd = Number(body.totalUsd || 0);
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  if (!name || !email || !items.length || !(totalUsd > 0)) {
    return json({ ok: false, error: "Missing required fields." }, 400);
  }
  const serverTotal = await flashTotal(sb, items);
  if (serverTotal && serverTotal.adjusted) totalUsd = serverTotal.totalUsd;
  const stars = Math.max(1, Math.round(totalUsd * starsPerUsdOf(env)));
  const id = `st-${randHex(10)}`;
  const { error: insertError } = await sb.from("stars_invoices").insert({
    id,
    kind: "product",
    status: "pending",
    telegram_user_id: body.telegramUserId ? String(body.telegramUserId) : null,
    telegram_username: String(body.telegram || "").replace(/^@/, "").trim() || null,
    customer_name: name,
    customer_email: email,
    items_json: items,
    total_usd: totalUsd,
    stars_amount: stars
  });
  if (insertError) return json({ ok: false, error: insertError.message || "Could not create invoice." }, 500);

  const result = await botApi(env, "createInvoiceLink", {
    provider_token: "",
    title: "DTD Store order",
    description: `${items.length} item(s) · $${fmtMoney(totalUsd)} USD`,
    payload: id,
    currency: "XTR",
    prices: [{ label: "DTD Store products", amount: stars }]
  });
  if (!result?.ok || !result?.result) {
    await sb.from("stars_invoices").update({ status: "failed", error: "link_failed" }, { id }).catch(() => {});
    return json({ ok: false, error: "Could not create the Stars payment link." }, 502);
  }
  return json({ ok: true, id, invoice_url: result.result, stars, totalUsd });
}

async function handlePayments(request, env) {
  const sb = getSupabase(env);
  const url = new URL(request.url);

  if (request.method === "GET") {
    const id = String(url.searchParams.get("id") || "");
    if (!id || !sb) return json({ ok: false, error: "Missing id." }, 400);
    const { data } = await sb.from("payments").select("*", { id });
    const row = (Array.isArray(data) ? data : [])[0];
    if (!row) return json({ ok: false, error: "Payment not found." }, 404);
    return json({
      ok: true,
      id: row.id,
      status: row.status || "pending",
      tx_hash: row.tx_hash || null,
      confirmations: Number(row.confirmations || 0),
      orderId: row.order_id || null
    });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!sb) return json({ ok: false, error: "Supabase is not configured." }, 500);

  const body = await request.json().catch(() => ({}));
  const currency = String(body.currency || "").toUpperCase();
  let amountUsd = Number(body.amountUsd || 0);
  const kind = String(body.kind || "product");
  if (!["TON", "USDT"].includes(currency) || !(amountUsd > 0)) {
    return json({ ok: false, error: "Currency (TON|USDT) and amountUsd are required." }, 400);
  }
  if (Array.isArray(body.items) && body.items.length) {
    const serverTotal = await flashTotal(sb, body.items);
    if (serverTotal && serverTotal.adjusted) amountUsd = serverTotal.totalUsd;
  }
  const address = currency === "TON" ? (env.TON_PAYMENT_ADDRESS || env.TON_ADDRESS || "") : (env.USDT_TRC20_ADDRESS || "");
  if (!address) return json({ ok: false, error: `${currency} receiving address not configured.` }, 500);

  let amount = amountUsd;
  if (currency === "TON") {
    const rate = await fetchTonPriceUsd(env);
    amount = rate > 0 ? Number((amountUsd / rate).toFixed(2)) : Number((amountUsd / 5).toFixed(2));
  }
  const id = crypto.randomUUID();
  const { error: insertError } = await sb.from("payments").insert({
    id,
    kind,
    currency,
    amount,
    amount_usd: amountUsd,
    address,
    network: currency === "TON" ? "TON" : "TRC20",
    telegram_user_id: body.telegramUserId ? String(body.telegramUserId) : null,
    telegram_username: String(body.telegramUsername || "").replace(/^@/, "").trim() || null,
    status: "pending",
    meta: { ref: body.reference || null }
  });
  if (insertError) return json({ ok: false, error: insertError.message || "Could not create payment." }, 500);
  return json({ ok: true, id, currency, amount, amount_usd: amountUsd, address, network: currency === "TON" ? "TON" : "TRC20" });
}

async function sendDealInvoice(env, sb, chatId, user, productArg) {
  if (!sb) return sendTelegram(env, chatId, "Store is not configured yet.");
  const products = await fetchProducts(sb);
  let product = null;
  if (productArg) {
    product =
      products.find((p) => String(p.id) === String(productArg)) ||
      products.find((p) => String(p.name || "").toLowerCase().includes(String(productArg).toLowerCase()));
  }
  if (!product) {
    const list = products.slice(0, 6).map((p, i) => `· /deal ${String(p.id).slice(0, 8)} — ${escHtml(p.name)} ($${fmtMoney(p.price_usd)})`).join("\n");
    return sendTelegram(env, chatId, [
      "🔥 <u>Daily Deal</u>",
      "Pick a product for an instant Stars checkout:",
      "",
      list || "No products yet."
    ].join("\n"));
  }
  const dealStars = Math.max(1, Math.round(Number(product.price_usd) * 0.95 * starsPerUsdOf(env)));
  const id = `st-deal-${randHex(8)}`;
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Telegram customer";
  await sb.from("stars_invoices").insert({
    id,
    kind: "product",
    status: "pending",
    telegram_user_id: String(user.id || ""),
    telegram_username: user.username || null,
    customer_name: name,
    customer_email: `${user.id || "tg"}@telegram`,
    product_id: String(product.id),
    product_name: product.name,
    items_json: [{ product_id: String(product.id), product_name: product.name, quantity: 1, unit_price_usd: Number(product.price_usd) }],
    total_usd: Number(product.price_usd),
    stars_amount: dealStars,
    chat_id: String(chatId || "")
  }).catch(() => {});
  const result = await botApi(env, "sendInvoice", {
    chat_id: chatId,
    provider_token: "",
    title: `${product.name} · Deal`,
    description: `5% off with Stars · ${fmtMoney(product.price_usd)} USD`,
    payload: id,
    currency: "XTR",
    prices: [{ label: product.name, amount: dealStars }]
  });
  if (!result?.ok) {
    await sendTelegram(env, chatId, "Couldn't create the deal invoice. Try again later.");
    return;
  }
  await sendTelegram(env, chatId, [
    "🔥 <u>Deal created!</u>",
    `${escHtml(product.name)} — pay above with ⭐ Stars (${dealStars} ⭐ ≈ $${fmtMoney(product.price_usd)}).`,
    "Payment is confirmed automatically."
  ].join("\n"));
}

async function premiumInvoice(env, sb, chatId, user) {
  if (!chatId) return;
  const payload = `prem-${randHex(8)}`;
  const result = await botApi(env, "sendInvoice", {
    chat_id: chatId,
    provider_token: "",
    title: "DTD PREMIUM Membership",
    description:
      "30-day premium access: early flash sales, premium-only deals & members' channel. Paying Stars helps boost DTD PREMIUM.",
    payload,
    currency: "XTR",
    prices: [{ label: "DTD PREMIUM · 30 days", amount: 20 }]
  });
  if (result?.ok) {
    await sendTelegram(env, chatId, [
      "💎 <b>DTD PREMIUM invoice sent!</b>",
      "Tap the invoice above and pay <b>20⭐</b> to unlock 30 days of premium:",
      "",
      "· Early access to every flash sale",
      "· Premium-only deals before the main store",
      "· Invite to the members' channel",
      "· Your Stars help boost DTD PREMIUM"
    ].join("\n"));
  } else {
    await sendTelegram(env, chatId, "Couldn't create the premium invoice. Try again later.");
  }
}

async function handleWebhookPreCheckout(env, sb, query) {
  const id = String(query.id || "");
  await botApi(env, "answerPreCheckoutQuery", { pre_checkout_query_id: id, ok: true });
  const payload = String(query.invoice_payload || "");
  if (payload && sb) {
    await sb.from("stars_invoices").update({ status: "pending", chat_id: String(query.from?.id || "") }, { id: payload }).catch(() => {});
  }
  return json({ ok: true });
}

function premiumInviteLink(env) {
  const explicit = env.TELEGRAM_PREMIUM_INVITE;
  if (explicit) return explicit;
  const username = String(env.TELEGRAM_CHANNEL_USERNAME || "dtdpremium").replace(/^@/, "");
  return `https://t.me/${username}`;
}

function premiumWelcomeText(invite) {
  return [
    "💎 <b>DTD PREMIUM — unlocked!</b>",
    "",
    "Your <b>20⭐</b> premium membership is active for 30 days.",
    "",
    "✅ <b>Premium perks</b>",
    "· Early access to every flash sale",
    "· Premium-only deals before the main store",
    "· Private members' channel access",
    "· Your Stars help boost DTD PREMIUM",
    "",
    `🔗 <a href="${invite}">Join the members' channel →</a>`,
    "⭐ Members see deals before anyone else."
  ].join("\n");
}

async function handlePremiumPayment(env, sb, msg, payload) {
  const payment = msg.successful_payment || {};
  const chatId = msg.chat?.id || msg.from?.id;
  const user = msg.from || {};
  const stars = Number(payment.total_amount || 0);
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Telegram customer";
  const usd = stars / starsPerUsdOf(env);
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

  if (sb) {
    await sb.from("stars_invoices").insert({
      id: payload,
      kind: "premium",
      status: "paid",
      telegram_user_id: String(user.id || ""),
      telegram_username: user.username || null,
      customer_name: name,
      customer_email: `${user.id || "tg"}@telegram`,
      product_name: "DTD PREMIUM membership",
      stars_amount: stars,
      total_usd: usd,
      chat_id: String(chatId || ""),
      updated_at: nowIso
    }).catch(() => {});
    await sb.from("premium_members").upsert({
      telegram_user_id: String(user.id),
      telegram_username: user.username || null,
      first_name: user.first_name || null,
      last_name: user.last_name || null,
      paid_at: nowIso,
      stars_amount: stars,
      expires_at: expiresIso,
      status: "active"
    }, { onConflict: "telegram_user_id" }).catch(() => {});
    await sb.from("channel_members").update({ status: "premium" }, { telegram_user_id: String(user.id) }).catch(() => {});
    await sb.from("social_proof_posts").insert({
      kind: "premium",
      buyer_name: name,
      buyer_username: user.username || null,
      amount_usd: usd,
      channel: "premium",
      status: "pending"
    }).catch(() => {});
  }

  await sendTelegram(env, chatId, premiumWelcomeText(premiumInviteLink(env)));

  const adminChat = env.TELEGRAM_ADMIN_CHAT_ID;
  if (adminChat) {
    await sendTelegram(env, adminChat, [
      "👑 <b>DTD PREMIUM membership sold</b>",
      `👤 ${user.username ? `@${user.username}` : escHtml(name)}`,
      `💫 ${stars} ⭐ · 30 days`,
      `🔗 <a href="https://t.me/${String(env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "")}">bot</a>`
    ].join("\n"));
  }
  await logBotEvent(sb, {
    chat_id: String(chatId || ""),
    user_id: String(user.id || ""),
    username: user.username || null,
    first_name: user.first_name || null,
    event_type: "premium_paid",
    command: payload,
    payload: `${stars} stars`,
    source: "bot"
  });
  return json({ ok: true });
}

async function handleWebhookSuccessfulPayment(env, sb, msg) {
  const payment = msg.successful_payment || {};
  const payload = String(payment.invoice_payload || "");
  const chatId = msg.chat?.id || msg.from?.id;
  const user = msg.from || {};

  if (payload.startsWith("prem-")) {
    return await handlePremiumPayment(env, sb, msg, payload);
  }

  if (payload && sb) {
    const { data } = await sb.from("stars_invoices").select("*", { id: payload });
    const invoice = (Array.isArray(data) ? data : [])[0];
    if (invoice) {
      await sb.from("stars_invoices").update({ chat_id: String(chatId || ""), updated_at: new Date().toISOString() }, { id: payload }).catch(() => {});
      await fulfillStarsInvoice(env, sb, invoice);
      return json({ ok: true });
    }
  }

  // No matching invoice (e.g. /tip donations) — record as a Stars donation.
  const stars = Number(payment.total_amount || 0);
  if (user.id && stars > 0 && sb) {
    const id = `st-${randHex(10)}`;
    await sb.from("stars_invoices").insert({
      id,
      kind: "donation",
      status: "paid",
      telegram_user_id: String(user.id),
      telegram_username: user.username || null,
      customer_name: [user.first_name, user.last_name].filter(Boolean).join(" ") || "anon",
      stars_amount: stars,
      total_usd: stars / starsPerUsdOf(env),
      chat_id: String(chatId || "")
    }).catch(() => {});
    const adminChat = env.TELEGRAM_ADMIN_CHAT_ID;
    if (adminChat) {
      await sendTelegram(env, adminChat, [
        "⭐ <b>Stars received (no product)</b>",
        `👤 @${String(user.username || user.first_name || user.id)}`,
        `💫 ${stars} ⭐`
      ].join("\n"));
    }
    await sendTelegram(env, chatId, "⭐ <b>Thank you for your support!</b>");
  }
  return json({ ok: true });
}

async function fireDueReminders(env, sb, chatId) {
  if (!sb || !chatId) return;
  try {
    const { data } = await sb.from("bot_reminders").select("*", { chat_id: String(chatId) });
    const now = Date.now();
    const due = (Array.isArray(data) ? data : []).filter(
      (r) => r.status === "pending" && r.due_at && new Date(r.due_at).getTime() <= now
    );
    for (const reminder of due) {
      await sendTelegram(env, chatId, [
        "⏰ <u>Reminder</u>",
        String(reminder.message || "").slice(0, 1024)
      ].join("\n"));
      await sb.from("bot_reminders").update(
        { status: "fired", fired_at: new Date().toISOString() },
        { id: reminder.id }
      );
    }
  } catch {}
}

async function handleBotCallback(env, sb, callback) {
  const chatId = callback.message?.chat?.id || callback.from?.id;
  const user = callback.from || {};
  const data = String(callback.data || "");
  await answerCallback(env, callback.id, "");
  await fireDueReminders(env, sb, chatId);

  if (data === "noop") return json({ ok: true });

  if (data.startsWith("sec|")) {
    await handleSecretary(env, sb, chatId, data.split("|")[1] || "list");
    return json({ ok: true });
  }

  if (data.startsWith("prod|")) {
    await sendProductsPage(env, chatId, await fetchProducts(sb), Number(data.split("|")[1]) || 0);
  } else if (data.startsWith("view|")) {
    const id = data.split("|")[1];
    const { data: rows } = await sb.from("products").select("*", { id });
    const product = (Array.isArray(rows) ? rows : [])[0];
    if (product) await sendProductView(env, chatId, product);
    else await sendTelegram(env, chatId, "Product not found.");
  } else if (data.startsWith("react|")) {
    const emoji = data.split("|")[2] || "🔥";
    await reactToMessage(env, chatId, callback.message?.message_id, emoji);
  } else if (data.startsWith("pay|")) {
    const parts = data.split("|");
    await handleBotPay(env, sb, chatId, user, parts[1], parts[2] || "USDT");
  } else if (data.startsWith("paid|")) {
    await handleBotPaid(env, sb, chatId, user, data.split("|")[1]);
  }

  return json({ ok: true });
}

async function handleTelegramWebhook(request, env) {
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const header = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (header !== secret) return json({ error: "Forbidden" }, 403);
  }

  const body = await request.json();
  const sb = getSupabase(env);

  if (body.pre_checkout_query) {
    return await handleWebhookPreCheckout(env, sb, body.pre_checkout_query);
  }
  if (body.message && body.message.successful_payment) {
    return await handleWebhookSuccessfulPayment(env, sb, body.message);
  }
  if (body.callback_query) {
    const cb = body.callback_query;
    await logBotEvent(sb, {
      chat_id: String(cb.message?.chat?.id || ""),
      user_id: String(cb.from?.id || ""),
      username: cb.from?.username || null,
      first_name: cb.from?.first_name || null,
      event_type: "callback",
      command: String(cb.data || "").slice(0, 200),
      payload: String(cb.message?.text || "").slice(0, 200),
      path: null,
      source: "bot"
    });
    return handleBotCallback(env, sb, cb);
  }
  if (!body.message || !body.message.text) return json({ ok: true });

  const chatId = body.message.chat?.id;
  const user = body.message.from || {};
  const text = body.message.text || "";
  const storeUrl = storeUrlOf(env);
  const owner = ownerOf(env);
  await fireDueReminders(env, sb, chatId);

  const [command, arg] = text.split(/\s+/, 2);

  await logBotEvent(sb, {
    chat_id: String(chatId || ""),
    user_id: String(user.id || ""),
    username: user.username || null,
    first_name: user.first_name || null,
    event_type: "command",
    command: command || "",
    payload: String(text || "").slice(0, 500),
    path: null,
    source: "bot"
  });

  // Premium emoji reaction — acknowledge user messages with a fire/star emoji
  try {
    const botToken = env.TELEGRAM_BOT_TOKEN;
    if (botToken && chatId && body.message?.message_id) {
      const reactionEmoji = text.startsWith("/premium") || text.startsWith("/deal") || text.startsWith("/earn") || text.startsWith("/tip") ? "\u2B50" : "\uD83D\uDD25";
      await fetch(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: body.message.message_id,
          reaction: [{ type: "emoji", emoji: reactionEmoji }]
        })
      });
    }
  } catch {}

  if (command === "/start") {
    if (String(arg || "").toLowerCase().startsWith("premium")) {
      await premiumInvoice(env, sb, chatId, user);
      return json({ ok: true });
    }
    const chatsignMatch = String(arg || "").match(/^chatsign_([A-Z0-9]{6})$/i);
    if (chatsignMatch) {
      await doClaimChatCode(env, sb, chatId, user, chatsignMatch[1]);
    }
    const dealMatch = String(arg || "").match(/^deal_([^_]+)/i);
    if (dealMatch) {
      await sendDealInvoice(env, sb, chatId, user, dealMatch[1]);
    }
    const startRef = (arg || "").match(/ref_(\d+)/);
    if (startRef && sb && String(startRef[1]) !== String(user.id)) {
      try {
        await sb.from("bot_referrals").insert({
          referred_user_id: String(user.id),
          referrer_user_id: startRef[1],
          referred_username: user.username || null
        });
      } catch {}
    }
    const botUsername = String(env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "");
    const premiumUsername = String(env.TELEGRAM_CHANNEL_USERNAME || "dtdpremium").replace(/^@/, "");
    const companyUrl = env.COMPANY_URL || "https://dvtechnologies.xyz";
    const supportEmail = env.SUPPORT_EMAIL || "contact@dvtechnologies.xyz";
    const channelLink = env.TELEGRAM_CHANNEL_LINK || `https://t.me/${botUsername}`;
    const premiumLink = env.TELEGRAM_PREMIUM_LINK || `https://t.me/${premiumUsername}`;
    await sendTelegram(env, chatId, [
      `<tg-emoji emoji-id="5438496463044752972">⭐</tg-emoji> <u>Welcome to DTD Store</u>`,
      `👋 Hi <b>${escHtml(user.first_name || "there")}</b> — your one-stop shop for digital services.`,
      "",
      `<a href="${storeUrl}"><tg-emoji emoji-id="5424972470023104089">🔥</tg-emoji> Open the store</a>`,
      "",
      "<tg-emoji emoji-id=\"5409048419211682843\">💲</tg-emoji> <b>Commands</b>",
      "/products — <i>browse & buy</i>",
      "/buy — <i>start a checkout</i>",
      "/pay — <i>payment addresses + QR</i>",
      "/order ID — <i>track an order</i>",
      "/ai — <i>ask our AI assistant</i>",
      "/profile — <i>your details & links</i>",
      "/refer — <i>earn rewards</i> · /tip — <i>send Stars</i>",
      "/premium — <i/DTD PREMIUM membership</i>",
      "/deal — <i>today's Stars deal</i>",
      "/earn — <i>full earning playbook</i>",
      "/support — <i>contact us</i>",
      "",
      "<tg-emoji emoji-id=\"5438496463044752972\">⭐</tg-emoji> USDT (TRC20) · ₿ BTC · 💳 Card — all supported.",
      "",
      "🔗 <b>Links</b>",
      `🛍 Store: ${storeUrl}`,
      `<tg-emoji emoji-id="5438496463044752972">⭐</tg-emoji> Premium: https://t.me/${premiumUsername}`,
      `🤖 Bot: https://t.me/${botUsername}`,
      `🏢 Company: ${companyUrl}`,
      `📧 Email: ${supportEmail}`,
      `👤 Support: https://t.me/${owner}`
    ].join("\n"), {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🛍 DTD MAIN STORE", url: channelLink },
            { text: "💎 DTD PREMIUM", url: premiumLink }
          ],
          [
            { text: "🛒 Browse Products", callback_data: "prod|0" },
            { text: "🚀 Mini App", web_app: { url: miniAppUrlOf(env, "products") } }
          ]
        ]
      }
    });
  } else if (command === "/chatsign") {
    await doClaimChatCode(env, sb, chatId, user, arg || "");
  } else if (command === "/chat") {
    const chatUrl = `${storeUrlOf(env)}/#chat`;
    const bot = String(env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "");
    await sendTelegram(env, chatId, [
      "💬 <u>DTD Store Chat</u>",
      "",
      "Open feed, post text, links, photos, or video — sign in with Telegram.",
      "",
      `<a href="${chatUrl}">Open the chat</a>`,
      "",
      `🚀 Mini App: <a href="${miniAppUrlOf(env, "chat")}">Launch</a>`,
      `🤖 Bot: <a href="https://t.me/${bot}">@${bot}</a>`
    ].join("\n"));
  } else if (command === "/profile") {
    const botUsername = String(env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "");
    const premiumUsername = String(env.TELEGRAM_CHANNEL_USERNAME || "dtdpremium").replace(/^@/, "");
    const companyUrl = env.COMPANY_URL || "https://dvtechnologies.xyz";
    const supportEmail = env.SUPPORT_EMAIL || "contact@dvtechnologies.xyz";
    let orderCount = 0;
    if (sb) {
      try {
        const { data: orders } = await sb
          .from("orders")
          .select("id", { telegram_username: user.username || "__none__" });
        orderCount = Array.isArray(orders) ? orders.length : 0;
      } catch {}
    }
    await sendTelegram(env, chatId, [
      "👤 <u>Your Profile</u>",
      "━━━━━━━━━━━━━━━━━━",
      `Name: <b>${escHtml(user.first_name || "—")} ${escHtml(user.last_name || "")}</b>`,
      `Username: ${user.username ? `<b>@${escHtml(user.username)}</b>` : "<i>(none)</i>"}`,
      `Telegram ID: <code>${escHtml(String(user.id || "—"))}</code>`,
      `Orders: <b>${orderCount}</b>`,
      "",
      "🔗 <b>Links</b>",
      `🛍 Store: <a href="${storeUrl}">${storeUrl.replace("https://", "")}</a>`,
      `⭐ Premium: <a href="https://t.me/${premiumUsername}">@${premiumUsername}</a>`,
      `🤖 Bot: <a href="https://t.me/${botUsername}">@${botUsername}</a>`,
      `🏢 Company: <a href="${companyUrl}">${companyUrl.replace("https://", "")}</a>`,
      `📧 Email: <a href="mailto:${supportEmail}">${supportEmail}</a>`,
      `👤 Support: <a href="https://t.me/${owner}">@${owner}</a>`,
      "",
      "💎 USDT (TRC20) · ₿ BTC · 💳 Card"
    ].join("\n"));
  } else if (command === "/help") {
    await sendTelegram(env, chatId, [
      "<tg-emoji emoji-id=\"5206607081334906820\">✅</tg-emoji> <u>DTD Store Help</u>",
      "",
      "<b>Shop</b>",
      "/products — <i>list products & buy</i>",
      "/buy — <i>choose a product & checkout</i>",
      "/pay — <i>payment addresses + QR codes</i>",
      "<b>Orders</b>",
      "/order ORDER_ID — <i>check status</i>",
      "/profile — <i>your details & links</i>",
      "<b>Premium & Earn</b>",
      "/premium — <i/DTD PREMIUM membership</i>",
      "/deal — <i>today's Stars deal</i>",
      "/earn — <i>full earning playbook</i>",
      "/refer — <i>share & earn rewards</i>",
      "/tip — <i>send Telegram Stars</i>",
      "<b>AI Assistant</b>",
      "/ai — <i>ask our AI anything</i>",
      "<b>Market</b>",
      "/market — <i>flash/surge/bundle status</i>",
      "/finance — <i>revenue dashboard</i>",
      "<b>Reach us</b>",
      `/support — <i>email/Telegram</i>`,
      "",
      `<a href="${storeUrl}">🛍 Open the store</a>`
    ].join("\n"));
  } else if (command === "/support") {
    const supportEmail = env.SUPPORT_EMAIL || "contact@dvtechnologies.xyz";
    await sendTelegram(env, chatId, [
      "🆘 <u>DTD Store Support</u>",
      "",
      `📧 <a href="mailto:${supportEmail}">${supportEmail}</a>`,
      `👤 Telegram: <a href="https://t.me/${owner}">@${owner}</a>`,
      "💬 Order questions? Use /order with your Order ID first.",
      "",
      "We'll respond within 24 hours."
    ].join("\n"));
  } else if (command === "/order") {
    if (!arg) {
      await sendTelegram(env, chatId, "Usage: /order ORDER_ID");
    } else {
      const orderId = arg;
      const { data } = await sb.from("orders").select("*", { id: orderId });
      const order = (Array.isArray(data) ? data : [])[0];
      if (order) {
        const paymentStatus = order.payment_status || order.paymentStatus || order.status || "pending";
        const orderStatus = order.order_status || order.orderStatus || "new";
        await sendTelegram(env, chatId, [
          "<b>📦 Order Status</b>",
          `ID: <code>${escHtml(order.id)}</code>`,
          `Payment: ${escHtml(order.payment_method || "")}`,
          `Total: <b>$${fmtMoney(order.total_usd)}</b>`,
          `Status: <u>${escHtml(paymentStatus)}</u>`,
          `Delivery: <u>${escHtml(orderStatus)}</u>`,
          "",
          `Questions? <a href="https://t.me/${owner}">Contact @${owner}</a>`
        ].join("\n"));
      } else {
        await sendTelegram(env, chatId, "Order not found. Check your Order ID.");
      }
    }
  } else if (command === "/products" || command === "/store" || command === "/shop") {
    await sendProductsPage(env, chatId, await fetchProducts(sb), 0);
  } else if (command === "/buy") {
    const products = await fetchProducts(sb);
    if (arg) {
      const match =
        products.find((p) => p.id === arg) ||
        products.find((p) => String(p.name || "").toLowerCase().includes(arg.toLowerCase())) ||
        (Number.isInteger(Number(arg)) ? products[Number(arg) - 1] : null);
      if (match) {
        await sendProductView(env, chatId, match);
        return json({ ok: true });
      }
    }
    await sendProductsPage(env, chatId, products, 0);
  } else if (command === "/pay" || command === "/payments") {
    const usdtAddress = env.USDT_TRC20_ADDRESS || "(not configured)";
    const btcAddress = env.BTC_ADDRESS || "(not configured)";
    const tonAddress = env.TON_PAYMENT_ADDRESS || env.TON_ADDRESS || "(not configured)";
    await sendTelegram(env, chatId, [
      "💳 <u>Payment Methods</u>",
      "",
      `💎 <b>USDT (TRC20)</b>`,
      `<code>${escHtml(usdtAddress)}</code>`,
      "",
      `🛡 <b>TON</b>`,
      `<code>${escHtml(tonAddress)}</code>`,
      "",
      `₿ <b>Bitcoin (BTC)</b>`,
      `<code>${escHtml(btcAddress)}</code>`,
      "",
      "💳 <b>Card / Bank (Paystack)</b>",
      `<a href="${storeUrl}">Pay securely on the store →</a>`,
      "",
      "⭐ <b>Telegram Stars</b> — instant in-Telegram checkout: /buy or /tip",
      "",
      "QR codes are generated automatically at checkout. Tap <b>/buy</b> to start."
    ].join("\n"));
  } else if (command === "/channel" || command === "/channels") {
    const premium = env.TELEGRAM_CHANNEL_USERNAME ? `@${String(env.TELEGRAM_CHANNEL_USERNAME).replace(/^@/, "")}` : "@dtdpremium";
    const bot = String(env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "");
    await sendTelegram(env, chatId, [
      "📢 <u>DTD Channels</u>",
      "",
      `👑 <b>Main Store</b>`,
      `<a href="${storeUrl}">🛍 Web store</a>`,
      `⭐ <b>Premium</b>`,
      `<a href="https://t.me/${String(premium).replace(/^@/, "")}">${premium}</a>`,
      `🤖 <b>Bot</b>`,
      `<a href="https://t.me/${bot}">@${bot}</a>`
    ].join("\n"));
  } else if (command === "/app" || command === "/mini" || command === "/miniapp") {
    await sendTelegram(env, chatId, [
      "🚀 <u>DTD Mini App</u>",
      "",
      "The full storefront — products, cart & checkout:",
      `<a href="${storeUrl}">🛍 Open the store</a>`,
      "",
      "Works right inside Telegram."
    ].join("\n"));
  } else if (command === "/refer") {
    const bot = String(env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "");
    const link = `https://t.me/${bot}?start=ref_${user.id}`;
    let count = 0;
    let balance = 0;
    if (sb) {
      const { data: refs } = await sb.from("bot_referrals").select("referred_user_id", { referrer_user_id: String(user.id) });
      count = Array.isArray(refs) ? refs.length : 0;
      const { data: credits } = await sb.from("bot_credits").select("balance_usd", { user_id: String(user.id) });
      balance = Number((Array.isArray(credits) ? credits : [])[0]?.balance_usd || 0);
    }
    await sendTelegram(env, chatId, [
      "🤝 <u>Refer & Earn</u>",
      "Share your link — earn <b>10% commission</b> when friends join & buy:",
      `<a href="${link}">🔗 ${link}</a>`,
      "",
      `👥 Referrals: <b>${count}</b>`,
      `💰 Credit balance: <b>$${fmtMoney(balance)}</b>`,
      "",
      "Playbook & payouts: /earn"
    ].join("\n"));
  } else if (command === "/earn") {
    const bot = String(env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "");
    await sendTelegram(env, chatId, [
      "💰 <u>Earn with DTD</u>",
      "",
      "1️⃣ <b>Referrals</b> — share your link from /refer; earn 10% of every friend's first purchase.",
      `2️⃣ <b>Telegram Stars</b> — buy products instantly with Stars: /buy · or send a tip: /tip`,
      "3️⃣ <b>Daily deals</b> — grab limited offers: /deal",
      "4️⃣ <b>Shop & earn</b> — track rewards directly from the Mini App.",
      "",
      `<a href="${storeUrl}">🚀 Open the store</a>`,
      "",
      `Questions? <a href="https://t.me/${owner}">@${owner}</a>`
    ].join("\n"));
  } else if (command === "/deal") {
    await sendDealInvoice(env, sb, chatId, user, arg || "");
  } else if (command === "/tip") {
    const result = await botApi(env, "sendInvoice", {
      chat_id: chatId,
      provider_token: "",
      title: "Support DTD Store",
      description: "Send a tip with Telegram Stars to support the store.",
      payload: `tip-${randHex(8)}`,
      currency: "XTR",
      prices: [{ label: "Support DTD Store", amount: 5 }],
      max_tip_amount: 100,
      suggested_tip_amounts: [5, 10, 25]
    });
    if (result?.ok) {
      await sendTelegram(env, chatId, "⭐ <b>Tip invoice sent!</b> Open it above to send Stars. Thank you for supporting DTD!");
    } else {
      await sendTelegram(env, chatId, "Couldn't create the tip invoice. Try again later.");
    }
  } else if (command === "/premium") {
    await premiumInvoice(env, sb, chatId, user);
  } else if (command === "/remind") {
    const m = text.match(/^\/remind\s+(\d+)\s+(.+)$/s);
    if (!m) {
      await sendTelegram(env, chatId, "Usage: /remind MINUTES TEXT — e.g. <code>/remind 30 Pay for my order</code>");
    } else {
      const minutes = Math.max(1, Math.min(Number(m[1]), 10080));
      const note = String(m[2]).trim().slice(0, 300);
      await sb.from("bot_reminders").insert({
        chat_id: String(chatId),
        created_by: String(user.id || ""),
        message: note,
        due_at: new Date(Date.now() + minutes * 60000).toISOString()
      });
      await sendTelegram(env, chatId, `⏰ <b>Reminder set</b> — I'll nudge you in <u>${minutes} min</u>.`);
    }
  } else if (command === "/note") {
    const noteText = text.replace(/^\/note\s*/, "").trim();
    if (!noteText) {
      await sendTelegram(env, chatId, "Usage: /note TEXT — saves a quick secretary note.");
    } else {
      await sb.from("bot_secretary_notes").insert({
        created_by: String(user.id || ""),
        note: noteText.slice(0, 1000)
      });
      await sendTelegram(env, chatId, "📝 <b>Note saved.</b>");
    }
  } else if (command === "/ai" || command === "/ask" || command === "/assistant") {
    const question = text.replace(/^\/\w+\s*/, "").trim();
    if (!question) {
      await sendTelegram(env, chatId, "🤖 <b>DTD AI Assistant</b>\n\nAsk me anything: <code>/ai Your question</code>\n\nExample: <code>/ai how do I pay with USDT?</code>");
    } else {
      await sendTelegram(env, chatId, "🤖 <i>Thinking…</i>");
      const answer = await askAi(env, question);
      await sendTelegram(env, chatId, answer.ok ? `🤖 <b>DTD Assistant</b>\n${escHtml(answer.text)}` : `🤖 I couldn't reach my brain right now. Message @${owner} for help.`);
    }
  } else if (isAdmin(chatId, env) && (command === "/admin" || command === "/stats" || command === "/traffic" || command === "/logs" || command === "/users" || command === "/activity")) {
    await adminCommand(env, chatId, command, arg);
  } else if (isAdmin(chatId, env) && (command === "/controls" || command === "/promo" || command === "/story" || command === "/dealnow" || command === "/pin" || command === "/announce" || command === "/schedule" || command === "/finance" || command === "/flash" || command === "/surge" || command === "/market")) {
    await channelControl(env, sb, chatId, user, command, arg, text);
  } else if (command === "/secretary" || command === "/sec") {
    const action = text.replace(/^\/\w+\s*/, "").trim();
    await handleSecretary(env, sb, chatId, action === "remind" ? "remind" : "list");
  } else if (env.GEMINI_API_KEY || env.AI_API_KEY) {
    await sendTelegram(env, chatId, "🤖 <i>Thinking…</i>");
    const answer = await askAi(env, text);
    await sendTelegram(env, chatId, answer.ok ? `🤖 <b>DTD Assistant</b>\n${escHtml(answer.text)}` : "🤖 I couldn't reach my brain right now. Use /help for commands.");
  } else {
    await sendTelegram(env, chatId, "Use /help to see available commands.");
  }

  return json({ ok: true });
}

async function handleAnalytics(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.events) || !body.events.length) return json({ ok: true, skipped: true });

  const sb = getSupabase(env);
  if (!sb) return json({ ok: true, stored: 0, reason: "no_store" });

  const clamp = (value, max) => String(value == null ? "" : value).slice(0, max);
  const now = Date.now();
  const rows = body.events.slice(0, 50).map(event => ({
    client_id: clamp(body.clientId || "anon", 64),
    session_id: clamp(body.sessionId, 64),
    event_type: clamp(event.type || "event", 40),
    path: clamp(event.path, 200),
    referrer: clamp(body.referrer, 300),
    country: "",
    user_agent: clamp(body.userAgent || request.headers.get("user-agent"), 300),
    data: event.data && typeof event.data === "object" ? event.data : {},
    created_at: new Date(Number(event.ts) || now).toISOString()
  }));

  const { error } = await sb.from("analytics_events").insert(rows);
  if (error) return json({ ok: true, stored: 0, warn: error.message });
  return json({ ok: true, stored: rows.length });
}

// ─── SMTP Console Handlers ──────────────────────────────

async function handleSmtpUnlock(request, env) {
  const body = await request.json();
  const sb = getSupabase(env);
  const from = env.MAIL_FROM || `contact@${env.MAIL_DOMAIN || "dvtechnologies.xyz"}`;
  const fromPhone = "SIM via SMSGate app";
  const ownerTelegram = String(env.TELEGRAM_OWNER_USERNAME || "Glock7money").replace(/^@/, "");

  if (body.mode === "admin") {
    const authHeader = request.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Admin sign-in required." }, 401);

    if (sb) {
      const verifyResp = await fetch(`${sb.url}/auth/v1/user`, {
        headers: { apikey: sb.key, Authorization: `Bearer ${jwt}` }
      });
      if (!verifyResp.ok) return json({ error: "Invalid admin session." }, 401);
      const user = await verifyResp.json();

      const token = generateToken();
      return json({
        token, from, fromPhone, role: "admin", ownerTelegram,
        email: user.email,
        dnsHint: "SPF ✓ + DKIM ✓ + DMARC ✓ on dvtechnologies.xyz",
        mailerConfigured: Boolean(env.VPS_MAILER_URL),
        emailProviders: [
          env.VPS_MAILER_URL ? "vps_mailer (aws ses)" : null,
          env.RESEND_API_KEY ? "resend (free)" : null,
          env.BREVO_API_KEY ? "brevo (free)" : null,
          env.MAILGUN_API_KEY ? "mailgun" : null,
          env.CF_EMAIL_API_TOKEN ? "cloudflare_email" : null
        ].filter(Boolean),
        smsProviders: [
          env.VPS_MAILER_URL ? "vps_mailer (smsgate)" : null,
          env.TELEGRAM_BOT_TOKEN ? "telegram (free)" : null,
          env.TWILIO_ACCOUNT_SID ? "twilio (trial)" : null,
          env.VONAGE_API_KEY ? "vonage" : null
        ].filter(Boolean),
        queueConfigured: true, smsGatewayConfigured: Boolean(env.SMS_GATEWAY_USER || env.TWILIO_ACCOUNT_SID),
        smsConfigured: Boolean(env.VPS_MAILER_URL || env.TELEGRAM_BOT_TOKEN || env.TWILIO_ACCOUNT_SID || env.VONAGE_API_KEY),
        awsSesPrimary: true,
        queue: { queued: 0, sending: 0 }
      });
    }
    return json({ error: "Supabase not configured." }, 500);
  }

  if (body.mode === "order") {
    if (!sb) return json({ error: "Supabase not configured." }, 500);
    const { data, error } = await sb.from("orders").select("id,customer_email,payment_method,total_usd", {
      id: body.orderId, customer_email: body.email
    });
    if (error || !data || !data.length) {
      return json({ error: "Order not found. Check your Order ID and email." }, 404);
    }
    const token = generateToken();
    return json({
      token, from, fromPhone, role: "buyer", email: body.email,
      dnsHint: "SPF ✓ + DKIM ✓ + DMARC ✓ on dvtechnologies.xyz",
      mailerConfigured: Boolean(env.VPS_MAILER_URL),
      queueConfigured: true, smsGatewayConfigured: false,
      smsConfigured: false, queue: { queued: 0, sending: 0 }
    });
  }

  return json({ error: "Invalid unlock mode." }, 400);
}

async function handleSmtpSendEmail(request, env) {
  const token = request.headers.get("X-SMTP-Token");
  if (!verifyToken(env, token)) return json({ error: "Unauthorized." }, 401);

  const body = await request.json();
  const to = String(body.to || "").trim();
  const subject = String(body.subject || "").trim();
  const text = String(body.text || "").trim();
  const from = env.MAIL_FROM || `contact@${env.MAIL_DOMAIN || "dvtechnologies.xyz"}`;
  const hostname = env.MAIL_HOSTNAME || env.SMTP_HOST || "";

  if (!to || !subject || !text) return json({ error: "To, subject, and text are required." }, 400);

  const sb = getSupabase(env);
  const recipients = to.split(/[\n\r,;\s]+/).map(e => e.trim()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const invalid = to.split(/[\n\r,;\s]+/).map(e => e.trim()).filter(e => e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  if (!recipients.length) return json({ error: "No valid email recipients." }, 400);

  try {
    const result = await sendEmailFallback(env, { from, to: recipients, subject, text, hostname });

    if (sb) {
      await sb.from("smtp_jobs").insert({
        channel: "email", recipients: recipients.join(", "),
        recipient_count: recipients.length, subject,
        body_preview: text.substring(0, 200),
        status: "sent", error: null
      });
    }

    return json({
      delivered: true, sent: recipients.length,
      provider: result.provider,
      attempted: result.attempted,
      invalid,
      message: result.message
    });
  } catch (err) {
    if (sb) {
      await sb.from("smtp_jobs").insert({
        channel: "email", recipients: recipients.join(", "),
        recipient_count: recipients.length, subject,
        body_preview: text.substring(0, 200),
        status: "failed", error: err.message
      });
    }

    return json({
      delivered: false, sent: 0, invalid,
      message: `Email send failed: ${err.message}`
    });
  }
}

async function handleSmtpSendSms(request, env) {
  const token = request.headers.get("X-SMTP-Token");
  if (!verifyToken(env, token)) return json({ error: "Unauthorized." }, 401);

  const body = await request.json();
  const to = String(body.to || "").trim();
  const text = String(body.text || "").trim();
  const gwUser = body.gwUser || env.SMS_GATEWAY_USER || "";
  const gwPass = body.gwPass || env.SMS_GATEWAY_PASS || "";
  const gwUrl = body.gwUrl || env.SMS_GATEWAY_URL || "";

  if (!to || !text) return json({ error: "Phone numbers and text are required." }, 400);

  const phones = to.split(/[\n\r,;|]+/).map(p => p.trim()).filter(Boolean);
  const sb = getSupabase(env);

  try {
    const result = await sendSmsFallback(env, { phones, text, gwUser, gwPass, gwUrl });

    if (sb) {
      await sb.from("smtp_jobs").insert({
        channel: "sms", recipients: phones.join(", "),
        recipient_count: phones.length, subject: text.substring(0, 80),
        body_preview: text.substring(0, 200),
        status: "sent", error: null
      });
    }

    return json({
      sent: phones.length,
      provider: result.provider,
      attempted: result.attempted,
      jobId: result.jobId || null, invalid: [],
      message: result.message
    });
  } catch (err) {
    if (sb) {
      await sb.from("smtp_jobs").insert({
        channel: "sms", recipients: phones.join(", "),
        recipient_count: phones.length, subject: text.substring(0, 80),
        body_preview: text.substring(0, 200),
        status: "failed", error: err.message
      });
    }

    return json({
      sent: 0, invalid: [],
      message: `SMS send failed: ${err.message}`
    });
  }
}

async function handleSmtpJobs(request, env) {
  const token = request.headers.get("X-SMTP-Token");
  if (!verifyToken(env, token)) return json({ error: "Unauthorized." }, 401);

  const sb = getSupabase(env);
  const from = env.MAIL_FROM || `contact@${env.MAIL_DOMAIN || "dvtechnologies.xyz"}`;
  const fromPhone = "SIM via SMSGate app";
  const ownerTelegram = String(env.TELEGRAM_OWNER_USERNAME || "Glock7money").replace(/^@/, "");

  let jobs = [];
  let queue = { queued: 0, sending: 0 };

  if (sb) {
    const { data } = await sb.from("smtp_jobs").select("*");
    jobs = (data || []).slice(0, 50).map(j => ({
      id: j.id, channel: j.channel, status: j.status,
      subject: j.subject, body_preview: j.body_preview,
      recipient_count: j.recipient_count, created_at: j.created_at, error: j.error
    }));
    queue.queued = jobs.filter(j => j.status === "queued").length;
    queue.sending = jobs.filter(j => j.status === "sending").length;
  }

  return json({
    jobs, from, fromPhone, queue, role: "admin", ownerTelegram,
    dnsHint: "SPF ✓ + DKIM ✓ + DMARC ✓ on dvtechnologies.xyz",
    mailerConfigured: Boolean(env.VPS_MAILER_URL),
    queueConfigured: true, smsGatewayConfigured: false,
    smsConfigured: false, awsSesPrimary: true,
    limits: { emailsPerDay: 200, smsPerDay: 100 }
  });
}

async function handleSmtpOtp(request, env) {
  const token = request.headers.get("X-SMTP-Token");
  if (!verifyToken(env, token)) return json({ error: "Unauthorized." }, 401);

  const url = new URL(request.url);
  const method = request.method;

  if (method === "GET") {
    const limit = Number(url.searchParams.get("limit") || 40);
    const sb = getSupabase(env);
    let items = [];
    if (sb) {
      const { data } = await sb.from("otp_messages").select("*");
      items = (data || []).slice(0, limit).map(m => ({
        id: m.id, sender: m.sender, recipient: m.recipient,
        message: m.message, otp: m.otp,
        receivedAt: m.received_at || m.created_at
      }));
    }
    return json({ items });
  }

  if (method === "POST") {
    const body = await request.json();
    const action = body.action || "listen";
    try {
      const result = await callVpsMailer(env, "/otp", {
        action, gwUser: body.gwUser, gwPass: body.gwPass, gwUrl: body.gwUrl,
        phones: body.phones, label: body.label, pull: body.pull, hours: body.hours || 6
      });
      return json({
        items: result.items || [],
        message: result.message || (action === "listen" ? "Listener started." : "OTP pulled.")
      });
    } catch (err) {
      return json({ items: [], message: `OTP error: ${err.message}` });
    }
  }

  return json({ error: "Method not allowed." }, 405);
}

// ─── Escrow (Binance-powered two-party escrow) ──────────

function binanceBase(env) {
  return env.BINANCE_API_BASE_URL || "https://api.binance.com";
}

function binanceConfigured(env) {
  return Boolean(env.BINANCE_API_KEY && env.BINANCE_API_SECRET);
}

async function hmacSha256(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function binanceSignedRequest(env, path, params = {}) {
  if (!binanceConfigured(env)) {
    throw new Error("Binance API keys are not configured.");
  }
  const paramsWithTimestamp = { ...params, timestamp: Date.now() };
  const query = new URLSearchParams(paramsWithTimestamp).toString();
  const signature = await hmacSha256(env.BINANCE_API_SECRET, query);
  const url = `${binanceBase(env)}${path}?${query}&signature=${signature}`;
  const response = await fetch(url, {
    headers: { "X-MBX-APIKEY": env.BINANCE_API_KEY }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.msg || `Binance API error (${response.status}).`);
  }
  return data;
}

function binanceNetwork(asset, network) {
  if (asset === "USDT") return network === "BEP20" ? "BSC" : network === "ERC20" ? "ETH" : "TRX";
  if (asset === "BTC") return "BTC";
  if (asset === "ETH") return "ETH";
  if (asset === "BNB") return "BSC";
  return "TRX";
}

async function binanceDepositAddress(env, asset, network) {
  return binanceSignedRequest(env, "/sapi/v1/capital/deposit/address", {
    coin: asset,
    network: binanceNetwork(asset, network)
  });
}

async function escrowDepositAddress(env, asset, network) {
  if (binanceConfigured(env)) {
    try {
      const deposit = await binanceDepositAddress(env, asset, network);
      if (deposit.address) return deposit.address;
    } catch {
      /* fall back to the admin wallet below */
    }
  }
  if (asset === "USDT" && env.USDT_TRC20_ADDRESS) return env.USDT_TRC20_ADDRESS;
  if (env.BTC_ADDRESS) return env.BTC_ADDRESS;
  return `PENDING-${asset}-${network}`;
}

function escrowCode() {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ESR-${suffix}`;
}

async function escrowInsert(sb, session, transactions) {
  const { data, error } = await sb.from("escrow_sessions").insert(session);
  if (error) throw new Error(error.message || "Could not save escrow session.");
  const row = data?.[0] || session;
  if (transactions?.length) {
    const txRows = transactions.map((tx) => ({
      session_id: row.id,
      ...tx
    }));
    await sb.from("escrow_transactions").insert(txRows);
  }
  return row;
}

async function escrowList(sb) {
  const { data, error } = await sb.from("escrow_sessions").select("*");
  if (error) return [];
  const sessions = data || [];
  const out = [];
  for (const session of sessions) {
    const { data: txs } = await sb.from("escrow_transactions").select("*", { session_id: session.id });
    out.push({ ...session, transactions: txs || [] });
  }
  return out;
}

async function handleEscrowList(env) {
  const sb = getSupabase(env);
  if (!sb) return json({ error: "Supabase is not configured." }, 500);
  const escrows = await escrowList(sb);
  return json({ escrows });
}

async function handleEscrowCreate(request, env) {
  const sb = getSupabase(env);
  if (!sb) return json({ error: "Supabase is not configured." }, 500);

  const body = await request.json();
  const title = String(body.title || "").trim();
  const amountUsd = Number(body.amountUsd || 0);
  const buyerTelegram = String(body.buyerTelegram || "").trim();
  const sellerTelegram = String(body.sellerTelegram || "").trim();
  const asset = String(body.asset || "USDT").trim();
  const network = String(body.network || "TRC20").trim();
  const feePercent = Number(body.feePercent || 0);

  if (!title) return json({ error: "Deal title is required." }, 400);
  if (!(amountUsd > 0)) return json({ error: "Amount must be greater than zero." }, 400);
  if (!buyerTelegram || !sellerTelegram) return json({ error: "Both buyer and seller handles are required." }, 400);

  const depositAddress = await escrowDepositAddress(env, asset, network);
  const code = escrowCode();

  let session;
  try {
    session = await escrowInsert(
      sb,
      {
        code,
        title,
        description: String(body.description || "").trim(),
        amount_usd: amountUsd,
        currency: asset,
        asset,
        network,
        buyer_telegram: buyerTelegram.replace(/^@/, ""),
        seller_telegram: sellerTelegram.replace(/^@/, ""),
        buyer_payout_address: String(body.buyerPayoutAddress || "").trim(),
        seller_payout_address: String(body.sellerPayoutAddress || "").trim(),
        deposit_address: depositAddress,
        escrow_fee: feePercent,
        status: "open"
      },
      [{ kind: "created", actor: "admin", amount_usd: amountUsd, message: "Escrow deal created." }]
    );
  } catch (error) {
    return json({ error: error.message }, 500);
  }

  const escrowMessage = [
    "<b>🛡 New Escrow Deal</b>",
    `🔖 Code: <code>${code}</code>`,
    `📌 Title: ${title}`,
    `💵 Amount: $${amountUsd.toFixed(2)} ${asset} (${network})`,
    feePercent ? `💸 Fee: ${feePercent}%` : null,
    `👤 Buyer: @${buyerTelegram.replace(/^@/, "")}`,
    `👤 Seller: @${sellerTelegram.replace(/^@/, "")}`,
    `🏦 Deposit address: <code>${depositAddress}</code>`,
    "",
    "Wait for the buyer to fund the deposit wallet, then mark the deal as funded."
  ].filter(Boolean).join("\n");
  if (env.TELEGRAM_ADMIN_CHAT_ID) await sendTelegram(env, env.TELEGRAM_ADMIN_CHAT_ID, escrowMessage);

  return json({ ok: true, escrow: session, message: "Escrow deal created." }, 201);
}

async function handleEscrowByCode(request, env, code) {
  const sb = getSupabase(env);
  if (!sb) return json({ error: "Supabase is not configured." }, 500);

  const normalized = String(code || "").trim().toUpperCase();
  const { data, error } = await sb.from("escrow_sessions").select("*", { code: normalized });
  if (error) return json({ error: "Could not look up the deal." }, 500);
  const session = (data || [])[0];
  if (!session) return json({ error: "Escrow deal not found." }, 404);

  const { data: txs } = await sb.from("escrow_transactions").select("*", { session_id: session.id });
  return json({ ...session, transactions: txs || [] });
}

async function handleEscrowStatus(request, env, id) {
  const sb = getSupabase(env);
  if (!sb) return json({ error: "Supabase is not configured." }, 500);

  const body = await request.json();
  const nextStatus = String(body.status || "").trim();
  const allowed = ["open", "active", "funded", "disputed", "released", "cancelled"];
  if (!allowed.includes(nextStatus)) return json({ error: "Invalid status." }, 400);

  const { data, error } = await sb.from("escrow_sessions").select("*", { id });
  if (error) return json({ error: "Could not load the deal." }, 500);
  const session = (data || [])[0];
  if (!session) return json({ error: "Escrow deal not found." }, 404);

  const updates = { status: nextStatus };
  let releaseNote = "";

  if (nextStatus === "funded") {
    updates.funded_at = new Date().toISOString();
    updates.deposit_tx_hash = String(body.txHash || session.deposit_tx_hash || "").trim() || session.deposit_tx_hash;
  }
  if (nextStatus === "released") {
    updates.released_at = new Date().toISOString();
    if (session.seller_payout_address && binanceConfigured(env)) {
      try {
        const amount = Number(session.amount_usd || 0);
        const feePercent = Number(session.escrow_fee || 0);
        const net = Math.max(0, amount - (amount * feePercent) / 100);
        const withdraw = await binanceSignedRequest(env, "/sapi/v1/capital/withdraw/apply", {
          coin: session.asset || "USDT",
          network: binanceNetwork(session.asset || "USDT", session.network || "TRC20"),
          address: session.seller_payout_address,
          amount: net.toString(),
          name: `Escrow ${session.code}`
        });
        releaseNote = withdraw.id ? `Withdrawal ID ${withdraw.id}.` : "Withdrawal submitted.";
      } catch (err) {
        releaseNote = `Auto-withdraw failed (${err.message}). Release marked manually.`;
      }
    } else {
      releaseNote = "Released manually (no Binance payout address on file).";
    }
  }

  const { error: updateError } = await sb.from("escrow_sessions").update(updates, { id });
  if (updateError) return json({ error: updateError.message || "Update failed." }, 500);

  await sb.from("escrow_transactions").insert({
    session_id: id,
    kind: nextStatus,
    actor: "admin",
    amount_usd: session.amount_usd,
    tx_hash: updates.deposit_tx_hash || null,
    message: releaseNote || `Status changed to ${nextStatus}.`
  });

  const statusMessage = [
    `<b>🛡 Escrow Update</b>`,
    `🔖 Code: <code>${session.code}</code>`,
    `📌 ${session.title}`,
    `🔄 Status: ${nextStatus.toUpperCase()}`,
    releaseNote || "No message."
  ].join("\n");
  if (env.TELEGRAM_ADMIN_CHAT_ID) await sendTelegram(env, env.TELEGRAM_ADMIN_CHAT_ID, statusMessage);

  return json({ ok: true, message: `Deal marked ${nextStatus}.`, note: releaseNote });
}

async function handleEscrowTxHash(request, env, id) {
  const sb = getSupabase(env);
  if (!sb) return json({ error: "Supabase is not configured." }, 500);

  const body = await request.json();
  const txHash = String(body.txHash || "").trim();
  if (!txHash) return json({ error: "Transaction hash is required." }, 400);

  const { data, error } = await sb.from("escrow_sessions").select("*", { id });
  if (error) return json({ error: "Could not load the deal." }, 500);
  const session = (data || [])[0];
  if (!session) return json({ error: "Escrow deal not found." }, 404);

  const { error: updateError } = await sb.from("escrow_sessions").update(
    { deposit_tx_hash: txHash },
    { id }
  );
  if (updateError) return json({ error: updateError.message || "Update failed." }, 500);

  await sb.from("escrow_transactions").insert({
    session_id: id,
    kind: "funded",
    actor: "admin",
    amount_usd: session.amount_usd,
    tx_hash: txHash,
    message: "Deposit transaction hash recorded."
  });

  return json({ ok: true, message: "Transaction hash saved." });
}

// ─── Community Chat ──────────────────────────────────────

const CHAT_BUCKET = "chat-media";
const CHAT_CODE_RE = /^[A-Z0-9]{6}$/;

function chatNow() {
  return new Date().toISOString();
}

function randomToken(n = 24) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function chatCode(n = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function chatHmacBytes(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

async function validTelegramInitData(initData, botToken) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash") || "";
    params.delete("hash");
    const checkString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    const secret = await chatHmacBytes(new TextEncoder().encode("WebAppData"), botToken);
    const sig = await chatHmacBytes(secret, checkString);
    const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
    if (hex !== hash) return null;
    const userRaw = params.get("user");
    if (!userRaw) return null;
    return JSON.parse(userRaw);
  } catch {
    return null;
  }
}

async function resolveTelegramAvatar(env, userId) {
  if (!env.TELEGRAM_BOT_TOKEN || !userId) return { fileId: null, path: null };
  try {
    const photos = await telegramApi(env, "getUserProfilePhotos", { user_id: userId, limit: 1 });
    const fileId = photos.ok ? photos.result?.photos?.[0]?.[0]?.file_id : null;
    if (!fileId) return { fileId: null, path: null };
    const file = await telegramApi(env, "getFile", { file_id: fileId });
    return { fileId, path: file.ok ? file.result.file_path : null };
  } catch {
    return { fileId: null, path: null };
  }
}

function chatRailsOf(env) {
  const bot = String(env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "");
  const channelUsername = String(env.TELEGRAM_CHANNEL_USERNAME || "").replace(/^@/, "").trim();
  return {
    telegramBotUrl: `https://t.me/${bot}`,
    telegramBotUsername: bot,
    telegramChannelUrl:
      env.TELEGRAM_CHANNEL_LINK || (channelUsername ? `https://t.me/${channelUsername}` : ""),
    telegramChannelUsername: channelUsername,
    whatsappChannelUrl: env.WHATSAPP_CHANNEL_URL || ""
  };
}

function chatMessageShape(row, liked = false) {
  return {
    id: row.id,
    username: row.telegram_username || "",
    displayName: row.display_name || row.telegram_username || "",
    body: row.body || "",
    mediaUrl: row.media_url || null,
    mediaType: row.media_type || null,
    likes: Number(row.likes_count || 0),
    comments: Number(row.comments_count || 0),
    premium: Boolean(row.is_premium),
    source: row.source || "user",
    createdAt: row.created_at || null,
    liked
  };
}

function chatCommentShape(row) {
  return {
    id: row.id,
    username: row.telegram_username || "",
    displayName: row.display_name || row.telegram_username || "",
    body: row.body || "",
    createdAt: row.created_at || null
  };
}

async function chatUserByToken(env, sb, request) {
  if (!sb) return null;
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const { data } = await sb.from("chat_sessions").select("*", { token });
    const row = (Array.isArray(data) ? data : [])[0];
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
    return {
      token,
      id: row.telegram_user_id,
      username: row.telegram_username,
      displayName: row.display_name,
      photoFileId: row.photo_file_id || null,
      photoPath: row.photo_path || null,
      isPremium: Boolean(row.is_premium)
    };
  } catch {
    return null;
  }
}

async function upsertChatUser(sb, u) {
  if (!sb || !u?.id) return;
  const values = {
    telegram_username: u.username || "",
    display_name: u.displayName || u.username || "",
    photo_file_id: u.photoFileId || null,
    photo_path: u.photoPath || null,
    is_premium: Boolean(u.isPremium),
    last_seen: chatNow()
  };
  try {
    const { data: updated } = await sb.from("chat_users").update(values, { telegram_user_id: u.id });
    if (!(Array.isArray(updated) && updated.length)) {
      await sb.from("chat_users").insert({ telegram_user_id: u.id, ...values });
    }
  } catch {}
}

async function createChatSession(sb, u) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 30 * 864e5).toISOString();
  await sb.from("chat_sessions").insert({
    token,
    telegram_user_id: u.id,
    telegram_username: u.username || "",
    display_name: u.displayName || u.username || "",
    photo_file_id: u.photoFileId || null,
    photo_path: u.photoPath || null,
    is_premium: Boolean(u.isPremium),
    expires_at: expiresAt
  });
  return {
    token,
    user: {
      id: u.id,
      username: u.username || "",
      displayName: u.displayName || u.username || "",
      isPremium: Boolean(u.isPremium),
      photoUrl: u.photoPath ? `/api/chat/avatar?id=${u.id}` : ""
    },
    expiresAt
  };
}

async function handleChatAuth(request, env) {
  const sb = getSupabase(env);
  if (!sb) return json({ error: "Chat is not configured." }, 500);
  const payload = await request.json().catch(() => ({}));
  const action = String(payload.action || "");

  if (action === "miniapp") {
    const tgUser = await validTelegramInitData(
      String(payload.initData || ""),
      env.TELEGRAM_BOT_TOKEN || ""
    );
    if (!tgUser) return json({ error: "Telegram sign-in could not be verified." }, 401);
    const avatar = await resolveTelegramAvatar(env, tgUser.id);
    const u = {
      id: tgUser.id,
      username: tgUser.username || "",
      displayName: tgUser.first_name || "",
      isPremium: Boolean(tgUser.is_premium),
      ...avatar
    };
    await upsertChatUser(sb, u);
    return json(await createChatSession(sb, u));
  }

  if (action === "start_claim") {
    const code = chatCode(6);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await sb.from("chat_link_codes").insert({ code, status: "pending", expires_at: expiresAt });
    const bot = String(env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "");
    return json({
      code,
      deepLink: `https://t.me/${bot}?start=chatsign_${code}`,
      instruction: `Send /chatsign ${code} in @${bot} (or tap the link), then tap "I've sent it — finish".`
    });
  }

  if (action === "complete_claim") {
    const code = String(payload.code || "").trim().toUpperCase();
    if (!CHAT_CODE_RE.test(code)) return json({ error: "Missing code." }, 400);
    const { data } = await sb.from("chat_link_codes").select("*", { code });
    const row = (Array.isArray(data) ? data : [])[0];
    if (!row) return json({ error: "Code not found." }, 404);
    if (row.status !== "claimed") {
      return json({ error: "Not linked yet — send the code to @DTDSTOREBOT first." }, 409);
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return json({ error: "Code expired — generate a new one." }, 410);
    }
    const avatar = await resolveTelegramAvatar(env, row.telegram_user_id);
    const u = {
      id: row.telegram_user_id,
      username: row.telegram_username || "",
      displayName: row.display_name || "",
      isPremium: Boolean(row.is_premium),
      ...avatar
    };
    await upsertChatUser(sb, u);
    return json(await createChatSession(sb, u));
  }

  return json({ error: "Unknown auth action." }, 400);
}

async function handleChatMessages(request, env) {
  const sb = getSupabase(env);
  if (!sb) return json({ error: "Chat is not configured." }, 500);
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 50);
  const premiumOnly = url.searchParams.get("premium") === "true";
  const topFirst = url.searchParams.get("sort") === "top";
  const channelsOnly = url.searchParams.get("source") === "channel";
  const me = await chatUserByToken(env, sb, request);

  let rows = [];
  try {
    const order = topFirst ? "likes_count.desc" : "created_at.desc";
    const filter =
      (premiumOnly ? "&is_premium=eq.true" : "") +
      (channelsOnly ? "&source=eq.channel" : "");
    const resp = await fetch(
      `${sb.url}/rest/v1/chat_messages?select=*&order=${order}&limit=${limit}${filter}`,
      { headers: { apikey: sb.key, Authorization: `Bearer ${sb.key}` } }
    );
    const data = await resp.json();
    rows = Array.isArray(data) ? data : [];
  } catch {}

  let likedIds = new Set();
  if (me && rows.length) {
    try {
      const ids = rows.map((r) => r.id);
      const resp = await fetch(
        `${sb.url}/rest/v1/chat_likes?select=message_id&telegram_user_id=eq.${encodeURIComponent(
          me.id
        )}&message_id=in.(${ids.map((i) => encodeURIComponent(i)).join(",")})`,
        { headers: { apikey: sb.key, Authorization: `Bearer ${sb.key}` } }
      );
      const data = await resp.json();
      likedIds = new Set((Array.isArray(data) ? data : []).map((l) => l.message_id));
    } catch {}
  }

  return json({
    messages: rows.map((r) => chatMessageShape(r, likedIds.has(r.id))),
    rails: chatRailsOf(env)
  });
}

async function handleChatPostMessage(request, env) {
  const sb = getSupabase(env);
  if (!sb) return json({ error: "Chat is not configured." }, 500);
  const me = await chatUserByToken(env, sb, request);
  if (!me) return json({ error: "Sign in with Telegram to post." }, 401);
  const payload = await request.json().catch(() => ({}));
  const body = String(payload.body || "").trim().slice(0, 12000);
  const mediaUrl = String(payload.mediaUrl || "").trim() || null;
  const mediaType = mediaUrl ? (payload.mediaType === "video" ? "video" : "image") : null;
  if (!body && !mediaUrl) return json({ error: "Post needs text or media." }, 400);

  const { data, error } = await sb.from("chat_messages").insert({
    telegram_user_id: me.id,
    telegram_username: me.username,
    display_name: me.displayName,
    body,
    media_url: mediaUrl,
    media_type: mediaType,
    is_premium: Boolean(me.isPremium),
    source: "user"
  });
  const row = (Array.isArray(data) ? data : [])[0];
  if (error || !row) return json({ error: "Could not save post." }, 500);
  await upsertChatUser(sb, me);

  const channel = env.TELEGRAM_CHANNEL_ID;
  if (channel) {
    try {
      const caption = [body ? `📣 ${body}` : "", `— via @${me.username || "DTD Store Chat"}`]
        .filter(Boolean)
        .join("\n");
      if (mediaUrl && mediaType === "image") {
        await sendTelegramPhoto(env, channel, mediaUrl, caption);
      } else {
        await sendTelegram(env, channel, caption);
      }
    } catch {}
  }

  return json({ message: chatMessageShape(row) });
}

async function handleCallRequests(request, env) {
  const payload = await request.json().catch(() => ({}));
  const name = String(payload.name || "").trim().slice(0, 120);
  const phone = String(payload.phone || "").trim().slice(0, 60);
  const telegram = String(payload.telegram || "").trim().replace(/^@/, "").slice(0, 60);
  const topic = String(payload.topic || "").trim().slice(0, 120);
  const message = String(payload.message || "").trim().slice(0, 2000);
  const preferredTime = String(payload.preferredTime || "").trim().slice(0, 120);

  if (!name && !phone) return json({ error: "Tell us who to call — name or phone is required." }, 400);
  if (!message) return json({ error: "Add a short note about what you need help with." }, 400);

  const sb = getSupabase(env);
  const me = sb ? await chatUserByToken(env, sb, request) : null;

  const entry = {
    name,
    phone,
    telegram,
    topic,
    message,
    preferred_time: preferredTime,
    telegram_user_id: me?.id || null,
    telegram_username: me?.username || ""
  };

  let stored = false;
  if (sb) {
    try {
      const { data, error } = await sb.from("call_requests").insert(entry);
      stored = !error && Array.isArray(data) && data.length > 0;
    } catch {
      stored = false;
    }
  }

  const admin = String(env.TELEGRAM_ADMIN_CHAT_ID || env.TELEGRAM_CHANNEL_ID || "");
  if (admin) {
    try {
      const topicLabel = topic ? ` — <b>${escHtml(topic)}</b>` : "";
      await sendTelegram(
        env,
        admin,
        [
          "📞 <u>New call request</u>" + topicLabel,
          `<b>Name:</b> ${escHtml(name) || "—"}`,
          `<b>Phone:</b> ${escHtml(phone) || "—"}`,
          telegram ? `<b>TG:</b> @${escHtml(telegram)}` : "",
          preferredTime ? `<b>When:</b> ${escHtml(preferredTime)}` : "",
          "",
          escHtml(message),
          me?.username ? `<i>from @${escHtml(me.username)} in the store chat</i>` : ""
        ]
          .filter((l) => l !== "")
          .join("\n")
      );
    } catch {}
  }

  return json({
    ok: true,
    stored,
    note: stored
      ? "Request saved — we'll call you back shortly."
      : "Request sent — we'll call you back shortly."
  });
}

async function handleChatComments(request, env) {
  const sb = getSupabase(env);
  if (!sb) return json({ error: "Chat is not configured." }, 500);
  const url = new URL(request.url);

  if (request.method === "GET") {
    const messageId = String(url.searchParams.get("messageId") || "");
    if (!messageId) return json({ error: "Missing messageId." }, 400);
    const { data } = await sb.from("chat_comments").select("*", { message_id: messageId });
    const comments = (Array.isArray(data) ? data : []).map(chatCommentShape);
    return json({ comments });
  }

  const me = await chatUserByToken(env, sb, request);
  if (!me) return json({ error: "Sign in with Telegram to comment." }, 401);
  const payload = await request.json().catch(() => ({}));
  const messageId = String(payload.messageId || "");
  const body = String(payload.body || "").trim().slice(0, 2000);
  if (!messageId || !body) return json({ error: "Comment needs a message and text." }, 400);

  const { data: saved, error } = await sb.from("chat_comments").insert({
    message_id: messageId,
    telegram_user_id: me.id,
    telegram_username: me.username,
    display_name: me.displayName,
    body
  });
  if (error || !(Array.isArray(saved) && saved.length)) {
    return json({ error: "Could not save comment." }, 500);
  }
  const { data: current } = await sb.from("chat_messages").select("comments_count", { id: messageId });
  const count = Number((Array.isArray(current) ? current : [])[0]?.comments_count || 0) + 1;
  await sb.from("chat_messages").update({ comments_count: count }, { id: messageId });
  await upsertChatUser(sb, me);
  return json({ comments: count });
}

async function handleChatLike(request, env) {
  const sb = getSupabase(env);
  if (!sb) return json({ error: "Chat is not configured." }, 500);
  const me = await chatUserByToken(env, sb, request);
  if (!me) return json({ error: "Sign in with Telegram to like." }, 401);
  const payload = await request.json().catch(() => ({}));
  const messageId = String(payload.messageId || "");
  if (!messageId) return json({ error: "Missing messageId." }, 400);

  const { data: existing } = await sb.from("chat_likes").select("message_id", { telegram_user_id: me.id });
  const likedRow = (Array.isArray(existing) ? existing : []).find((l) => l.message_id === messageId);
  let liked;
  if (likedRow) {
    await sb.from("chat_likes").delete({ message_id: messageId, telegram_user_id: me.id });
    liked = false;
  } else {
    await sb.from("chat_likes").insert({ message_id: messageId, telegram_user_id: me.id });
    liked = true;
  }
  const { data: msg } = await sb.from("chat_messages").select("likes_count", { id: messageId });
  const base = Number((Array.isArray(msg) ? msg : [])[0]?.likes_count || 0);
  const likes = Math.max(0, base + (liked ? 1 : -1));
  await sb.from("chat_messages").update({ likes_count: likes }, { id: messageId });
  return json({ liked, likes });
}

async function ensureChatBucket(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  try {
    await fetch(`${url}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: CHAT_BUCKET,
        name: CHAT_BUCKET,
        public: true,
        file_size_limit: 8 * 1024 * 1024,
        allowed_mime_types: [
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
          "image/bmp",
          "video/mp4",
          "video/webm",
          "video/quicktime"
        ]
      })
    });
  } catch {}
  return true;
}

async function handleChatUpload(request, env) {
  const sb = getSupabase(env);
  if (!sb) return json({ error: "Chat is not configured." }, 500);
  const me = await chatUserByToken(env, sb, request);
  if (!me) return json({ error: "Sign in with Telegram to post media." }, 401);
  const ct = String(request.headers.get("Content-Type") || "");

  let bytes, contentType, filename;
  if (ct.startsWith("multipart/")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") {
      return json({ error: "Missing file." }, 400);
    }
    bytes = new Uint8Array(await file.arrayBuffer());
    contentType = file.type || "application/octet-stream";
    filename = file.name || "media";
  } else {
    const payload = await request.json().catch(() => ({}));
    const dataUrl = String(payload.dataUrl || "");
    const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (!m) return json({ error: "Invalid media payload." }, 400);
    contentType = m[1];
    bytes = base64ToBytes(m[2]);
    filename = "media";
  }

  const isVideo = String(contentType).startsWith("video/");
  const mediaType = isVideo ? "video" : "image";
  const ext = (filename.match(/\.([a-z0-9]{1,6})$/i)?.[1] || (isVideo ? "mp4" : "jpg")).toLowerCase();
  const key = `chat/${me.id}/${Date.now()}-${randomToken(6)}.${ext}`;

  await ensureChatBucket(env);
  const authKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  const up = await fetch(`${sb.url}/storage/v1/object/${CHAT_BUCKET}/${key}`, {
    method: "POST",
    headers: {
      apikey: authKey,
      Authorization: `Bearer ${authKey}`,
      "Content-Type": contentType,
      "x-upsert": "false"
    },
    body: bytes
  });
  const upData = await up.json().catch(() => ({}));
  if (!up.ok) return json({ error: `Upload failed: ${upData.message || up.status}` }, 500);
  return json({
    url: `${sb.url}/storage/v1/object/public/${CHAT_BUCKET}/${key}`,
    mediaType
  });
}

async function handleChatProfile(request, env) {
  const sb = getSupabase(env);
  if (!sb) return json({ error: "Chat is not configured." }, 500);
  const url = new URL(request.url);
  const uname = String(url.searchParams.get("u") || "").replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{3,32}$/.test(uname)) return json({ error: "Invalid username." }, 400);
  const headers = { apikey: sb.key, Authorization: `Bearer ${sb.key}` };
  const ilike = encodeURIComponent(uname);

  const [msgRes, cmtRes, userRes] = await Promise.all([
    fetch(
      `${sb.url}/rest/v1/chat_messages?select=*&telegram_username=ilike.${ilike}&order=created_at.desc&limit=50`,
      { headers }
    ),
    fetch(
      `${sb.url}/rest/v1/chat_comments?select=*&telegram_username=ilike.${ilike}&order=created_at.desc&limit=20`,
      { headers }
    ),
    fetch(`${sb.url}/rest/v1/chat_users?select=*&telegram_username=ilike.${ilike}&limit=1`, { headers })
  ]);
  const messages = await msgRes.json().catch(() => []);
  const comments = await cmtRes.json().catch(() => []);
  const users = await userRes.json().catch(() => []);
  const u = (Array.isArray(users) ? users : [])[0];
  const posts = Array.isArray(messages) ? messages : [];
  const cmtList = Array.isArray(comments) ? comments : [];
  const likesReceived = posts.reduce((s, m) => s + Number(m.likes_count || 0), 0);

  return json({
    profile: {
      username: uname,
      displayName: u?.display_name || posts[0]?.display_name || uname,
      avatarUrl: u?.photo_path ? `/api/chat/avatar?id=${u.telegram_user_id}` : "",
      telegramUrl: `https://t.me/${uname}`,
      stats: { posts: posts.length, likesReceived, comments: cmtList.length }
    },
    messages: posts.map((m) => chatMessageShape(m)),
    comments: cmtList.map(chatCommentShape)
  });
}

function avatarFallback(seed) {
  const letter = String(seed || "?").slice(0, 1).toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">` +
    `<rect width="96" height="96" rx="24" fill="#14b8a6"/>` +
    `<text x="48" y="58" font-family="Segoe UI,Arial" font-size="40" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400"
    }
  });
}

async function handleChatAvatar(request, env) {
  const sb = getSupabase(env);
  const url = new URL(request.url);
  const userId = String(url.searchParams.get("id") || "");
  if (userId) {
    try {
      const { data } = await sb.from("chat_users").select("photo_path", { telegram_user_id: userId });
      const path = (Array.isArray(data) ? data : [])[0]?.photo_path;
      if (path && env.TELEGRAM_BOT_TOKEN) {
        return Response.redirect(
          `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`,
          302
        );
      }
    } catch {}
  }
  return avatarFallback(userId);
}

async function doClaimChatCode(env, sb, chatId, user, codeRaw) {
  if (!sb) return sendTelegram(env, chatId, "Chat linking is not configured yet.");
  const code = String(codeRaw || "").replace(/^chatsign_/i, "").trim().toUpperCase();
  if (!CHAT_CODE_RE.test(code)) {
    return sendTelegram(env, chatId, "That link code looks invalid. Use /chat to get a fresh one.");
  }
  const { data } = await sb.from("chat_link_codes").select("*", { code });
  const row = (Array.isArray(data) ? data : [])[0];
  if (!row || row.status === "expired" || new Date(row.expires_at).getTime() < Date.now()) {
    return sendTelegram(env, chatId, "That code has expired. Tap Link Telegram on the chat page for a fresh code.");
  }
  if (row.status === "claimed" && String(row.telegram_user_id) !== String(user.id)) {
    return sendTelegram(env, chatId, "That code was already used by another account.");
  }
  if (row.status !== "claimed") {
    await sb.from("chat_link_codes").update(
      {
        status: "claimed",
        telegram_user_id: user.id,
        telegram_username: user.username || "",
        display_name: user.first_name || "",
        is_premium: Boolean(user.premium),
        claimed_at: chatNow()
      },
      { code }
    );
  }
  const avatar = await resolveTelegramAvatar(env, user.id);
  await upsertChatUser(sb, {
    id: user.id,
    username: user.username || "",
    displayName: user.first_name || "",
    ...avatar
  });
  return sendTelegram(env, chatId, [
    "✅ <u>Account linked to DTD Chat</u>",
    `Welcome <b>${escHtml(user.first_name || "there")}</b>${user.username ? ` (@${escHtml(user.username)})` : ""}!`,
    "",
    `<a href="${storeUrlOf(env)}/#chat">Open the store chat</a>`
  ].join("\n"));
}

// ─── Tools: free / pro download gating ─────────────────────

// Mirror of tools-data.cjs (id → metadata) so the worker can validate
// a download request without a bundler. Keep IDs in sync with tools-data.cjs.
const TOOL_FILES = {
  "smtp-checker":      { name: "SMTP Checker Pro V4", kind: "free", price: null, file: "assets/tools/smtp-checker-pro-v4.zip" },
  "website-grabber":   { name: "Website Grabber V3", kind: "free", price: null, file: "assets/tools/website-grabber-v3.zip" },
  "cms-filter":        { name: "CMS Filter V3", kind: "free", price: null, file: "assets/tools/cms-filter-v3.zip" },
  "scrapex-lite":      { name: "ScrapeX Lite V4", kind: "free", price: null, file: "assets/tools/scrapex-lite-v4.zip" },
  "smtp-cracker":      { name: "SMTP Cracker Pro V6", kind: "pro", price: 80, file: "assets/tools/smtp-cracker-pro-v6.zip" },
  "dtd-sender":        { name: "DTD Sender Suite V2", kind: "pro", price: 199, file: "assets/tools/dtd-sender-suite-v2.zip" },
  "smtp-digger":       { name: "SMTP Digger Pro V5", kind: "pro", price: 70, file: "assets/tools/smtp-digger-pro-v5.zip" },
  "scrapex-premium":   { name: "ScrapeX Premium V4", kind: "pro", price: 40, file: "assets/tools/scrapex-premium-v4.zip" }
};

async function handleToolDownload(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const toolId = String(body.tool || "").trim().toLowerCase();
  const toolMeta = TOOL_FILES[toolId];
  if (!toolMeta) return json({ error: "Tool not found." }, 404);

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  if (!name || !email) return json({ error: "Name and email are required." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Enter a valid email address." }, 400);
  }

  const clamp = (value, max) => String(value == null ? "" : value).slice(0, max);
  const ip = getClientIp(request);

  const record = {
    name: clamp(name, 120),
    email,
    phone: clamp(phone, 60),
    tool: toolId,
    tool_name: clamp(toolMeta.name, 160),
    kind: toolMeta.kind,
    price_usd: toolMeta.price ?? null,
    file: toolMeta.file,
    source: "web",
    ip,
    user_agent: clamp(request.headers.get("user-agent") || "", 300)
  };

  const sb = getSupabase(env);
  let saved = false;
  let saveNote = "";
  if (sb) {
    try {
      const { error } = await sb.from("tool_downloads").insert(record);
      if (!error) {
        saved = true;
        saveNote = "saved to Supabase tool_downloads";
      } else if (String(error?.message || "").includes("does not exist")) {
        saveNote = "SUPABASE TABLE MISSING — run supabase-tool-downloads.sql";
      } else {
        saveNote = "Supabase save failed";
      }
    } catch (e) {
      saveNote = "Supabase save failed";
    }
  }

  const priceLine = toolMeta.kind === "pro"
    ? `PRO · $${Number(toolMeta.price || 0).toFixed(2)}`
    : "FREE";
  const telegramMessage = [
    `<b>🤖 New Tool Download</b>`,
    `🧰 Tool: ${record.tool_name} (${priceLine})`,
    `👤 Name: ${record.name}`,
    `📧 Email: <code>${record.email}</code>`,
    phone ? `📞 Phone: <code>${record.phone}</code>` : null,
    `📦 File: <code>${record.file}</code>`,
    `🌐 IP: <code>${ip}</code>`,
    saveNote ? `🗄 ${saveNote}` : null
  ].filter(Boolean).join("\n");

  const notifyIds = [
    env.TELEGRAM_CHANNEL_ID,
    env.TELEGRAM_BACKUP_CHANNEL_ID,
    env.TELEGRAM_GROUP_ID,
    env.TELEGRAM_ADMIN_CHAT_ID
  ].filter((id, i, arr) => id && arr.indexOf(id) === i);
  for (const chatId of notifyIds) {
    await sendTelegram(env, chatId, telegramMessage);
  }

  if (sb && saved) {
    try {
      await sb.from("bot_events").insert({
        event_type: "tool_download",
        chat_id: null,
        username: null,
        first_name: record.name,
        payload: `tool:${toolId} kind:${record.kind} email:${record.email}`,
        source: "web"
      });
    } catch {}
  }

  return json({
    ok: true,
    saved: { supabase: saved, mysql: false },
    tool: { id: toolId, name: toolMeta.name, kind: toolMeta.kind, price: toolMeta.price },
    downloadUrl: `/${toolMeta.file.replace(/^\//, "")}`
  });
}

// ─── Router ─────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (!path.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      if (path === "/api/health" && method === "GET") return await handleHealth(env);
      if (path === "/api/visitor" && method === "GET") return await handleVisitor(request);
      if (path === "/api/config" && method === "GET") return await handleConfig(env);
      if (path === "/api/bundles" && method === "GET") {
        const sb = getSupabase(env);
        const bundles = await activeBundles(sb);
        const products = await fetchProducts(sb);
        const byId = new Map(products.map((p) => [String(p.id), p]));
        return json({ ok: true, bundles: bundles.map((b) => ({
          id: b.id,
          name: b.name,
          discountPct: Number(b.discount_pct || 0),
          products: (Array.isArray(b.product_ids) ? b.product_ids : []).map((pid) => byId.get(String(pid))).filter(Boolean)
        })) });
      }
      if (path === "/api/social-proof" && method === "GET") {
        const sb = getSupabase(env);
        const { data, error } = await sb
          .from("social_proof_posts")
          .select("buyer_name, product_name, amount_usd, posted_at")
          .eq("status", "posted")
          .order("posted_at", { ascending: false })
          .limit(6);
        if (error) return json({ ok: true, posts: [] });
        return json({ ok: true, posts: (data || []).map((p) => ({
          buyer_name: p.buyer_name || "Customer",
          product_name: p.product_name || "",
          amount_usd: Number(p.amount_usd || 0),
          posted_at: p.posted_at || null
        })) });
      }
      if (path === "/api/market/status" && method === "GET") {
        const sb = getSupabase(env);
        const market = await marketStatusOf(env, sb);
        const today = new Date().toISOString().slice(0, 10);
        const [pays, stars] = await Promise.all([
          pgQuery(env, "payments", { select: "amount_usd,created_at", status: "eq.confirmed" }),
          pgQuery(env, "stars_invoices", { select: "total_usd,created_at", status: "eq.paid" })
        ]);
        const cryptoToday = (pays.data || []).filter((p) => String(p.created_at || "").startsWith(today)).reduce((s, p) => s + Number(p.amount_usd || 0), 0);
        const starsToday = (stars.data || []).filter((i) => String(i.created_at || "").startsWith(today)).reduce((s, i) => s + Number(i.total_usd || 0), 0);
        return json({ ok: true, ...market, cryptoToday, starsToday, totalToday: cryptoToday + starsToday });
      }
      if (path === "/api/orders" && method === "POST") return await handleOrders(request, env);
      if (path === "/api/orders/status" && method === "GET") return await handleOrderStatus(request, env);
      if (path === "/api/tool-download" && method === "POST") return await handleToolDownload(request, env);
      if (path === "/api/paystack/initialize" && method === "POST") return await handlePaystackInit(request, env);
      if (path === "/api/paystack/verify" && method === "POST") return await handlePaystackVerify(request, env);
      if (path === "/api/paystack/probe" && method === "POST") return await handlePaystackInit(request, env);
      if (path === "/api/telegram/message" && method === "POST") return await handleTelegramMessage(request, env);
      if (path === "/api/telegram/webhook" && method === "POST") return await handleTelegramWebhook(request, env);
      if (path === "/api/stars/invoice" && (method === "POST" || method === "GET")) return await handleStarsInvoice(request, env);
      if (path === "/api/payments" && (method === "POST" || method === "GET")) return await handlePayments(request, env);
      if (path === "/api/analytics" && method === "POST") return await handleAnalytics(request, env);

      if (path === "/api/smtp/unlock" && method === "POST") return await handleSmtpUnlock(request, env);
      if (path === "/api/smtp/send-email" && method === "POST") return await handleSmtpSendEmail(request, env);
      if (path === "/api/smtp/send-sms" && method === "POST") return await handleSmtpSendSms(request, env);
      if (path === "/api/smtp/jobs" && method === "GET") return await handleSmtpJobs(request, env);
      if (path === "/api/smtp/otp" && (method === "GET" || method === "POST")) return await handleSmtpOtp(request, env);

      if (path === "/api/payments/crypto/verify" && method === "POST") return await handleCryptoVerify(request, env);
      if (path === "/api/products/gated" && method === "GET") return await handleGatedProducts(request, env);
      if (path === "/api/paystack/webhook" && method === "POST") return await handlePaystackWebhook(request, env);

      if (path === "/api/escrow" && method === "GET") return await handleEscrowList(env);
      if (path === "/api/escrow" && method === "POST") return await handleEscrowCreate(request, env);

      if (path === "/api/chat/messages" && method === "GET") return await handleChatMessages(request, env);
      if (path === "/api/chat/messages" && method === "POST") return await handleChatPostMessage(request, env);
      if (path === "/api/chat/auth" && method === "POST") return await handleChatAuth(request, env);
      if (path === "/api/chat/comments" && (method === "GET" || method === "POST")) return await handleChatComments(request, env);
      if (path === "/api/chat/like" && method === "POST") return await handleChatLike(request, env);
      if (path === "/api/chat/upload" && method === "POST") return await handleChatUpload(request, env);
      if (path === "/api/chat/profile" && method === "GET") return await handleChatProfile(request, env);
      if (path === "/api/chat/avatar" && method === "GET") return await handleChatAvatar(request, env);
      if (path === "/api/call-requests" && method === "POST") return await handleCallRequests(request, env);

      const escrowByCodeMatch = path.match(/^\/api\/escrow\/code\/([^/]+)$/);
      if (escrowByCodeMatch && method === "GET") {
        return await handleEscrowByCode(request, env, decodeURIComponent(escrowByCodeMatch[1]));
      }

      const escrowStatusMatch = path.match(/^\/api\/escrow\/([^/]+)\/status$/);
      if (escrowStatusMatch && method === "POST") {
        return await handleEscrowStatus(request, env, escrowStatusMatch[1]);
      }

      const escrowTxMatch = path.match(/^\/api\/escrow\/([^/]+)\/txhash$/);
      if (escrowTxMatch && method === "POST") {
        return await handleEscrowTxHash(request, env, escrowTxMatch[1]);
      }

      return json({ error: "Not found." }, 404);
    } catch (error) {
      return json({ error: error.message || "Internal server error." }, 500);
    }
  }
};