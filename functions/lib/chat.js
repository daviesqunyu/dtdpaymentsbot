/**
 * Community chat auth + helpers.
 * Identity = Telegram @username (Mini App initData or /chatsign link code).
 */

import { getSupabase, json, sendTelegram } from "./store.js";
import { createClaim, getClaim, updateClaim } from "./chat-store.js";

const SESSION_TTL_SEC = 60 * 60 * 24 * 14; // 14 days
const CLAIM_TTL_MS = 10 * 60 * 1000;
const MAX_BODY = 500;

export function chatJson(data, status = 200) {
  return json(data, status);
}

function enc() {
  return new TextEncoder();
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(bytes) {
  let s = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(obj) {
  return b64url(enc().encode(JSON.stringify(obj)));
}

function fromB64url(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSha256(keyBytes, message) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign"
  ]);
  return crypto.subtle.sign("HMAC", key, typeof message === "string" ? enc().encode(message) : message);
}

async function sessionSecret(env) {
  const raw = String(env.CHAT_SESSION_SECRET || env.TELEGRAM_BOT_TOKEN || "dtd-chat");
  return enc().encode(raw);
}

/** Validate Telegram WebApp initData; returns user or null. */
export async function validateTelegramInitData(env, initData) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !initData) return null;

  const params = new URLSearchParams(String(initData));
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const checkString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = await hmacSha256(enc().encode("WebAppData"), token);
  const calc = toHex(await hmacSha256(new Uint8Array(secretKey), checkString));
  if (calc !== hash) return null;

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  let user;
  try {
    user = JSON.parse(params.get("user") || "{}");
  } catch {
    return null;
  }
  if (!user?.id) return null;
  return {
    id: Number(user.id),
    username: String(user.username || "")
      .replace(/^@/, "")
      .trim(),
    displayName: [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "Trader",
    photoUrl: user.photo_url || ""
  };
}

export async function issueSession(env, identity) {
  const username = String(identity.username || "")
    .replace(/^@/, "")
    .trim();
  if (!username) {
    throw new Error("Set a public Telegram @username in Telegram Settings, then try again.");
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = {
    uid: Number(identity.id),
    username,
    name: String(identity.displayName || username).slice(0, 80),
    exp
  };
  const body = b64urlJson(payload);
  const sig = toHex(await hmacSha256(await sessionSecret(env), body));
  return {
    token: `${body}.${sig}`,
    user: {
      id: payload.uid,
      username: payload.username,
      displayName: payload.name
    },
    expiresAt: exp * 1000
  };
}

export async function readSession(env, request) {
  const header = request.headers.get("authorization") || "";
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const token = bearer || "";
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = toHex(await hmacSha256(await sessionSecret(env), body));
  if (expect !== sig) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  } catch {
    return null;
  }
  if (!payload?.uid || !payload?.username || !payload?.exp) return null;
  if (payload.exp * 1000 < Date.now()) return null;
  return {
    id: Number(payload.uid),
    username: String(payload.username).replace(/^@/, ""),
    displayName: String(payload.name || payload.username)
  };
}

export function randomCode(len = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export async function createLinkCode(env) {
  const code = randomCode(6);
  const expires = new Date(Date.now() + CLAIM_TTL_MS).toISOString();
  await createClaim(env, code, expires);
  const bot = String(env.TELEGRAM_BOT_USERNAME || "Dtdpaymentbot").replace(/^@/, "");
  return {
    code,
    expiresAt: expires,
    deepLink: `https://t.me/${bot}?start=chatsign_${code}`,
    instruction: `Open @${bot} and send /chatsign ${code}`
  };
}

export async function claimLinkCode(env, code, from) {
  const clean = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!clean) return { ok: false, error: "Missing code." };

  const username = String(from?.username || "")
    .replace(/^@/, "")
    .trim();
  if (!username) {
    return {
      ok: false,
      error: "Set a public @username in Telegram → Settings → Username, then retry /chatsign."
    };
  }

  let data;
  try {
    data = await getClaim(env, clean);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  if (!data) return { ok: false, error: "Code not found. Generate a new one on the site Chat page." };
  if (data.status === "claimed") return { ok: true, already: true, username: data.telegram_username };
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await updateClaim(env, clean, { status: "expired" });
    return { ok: false, error: "Code expired. Generate a new one on the site." };
  }

  const displayName = [from.first_name, from.last_name].filter(Boolean).join(" ").trim() || username;
  try {
    await updateClaim(env, clean, {
      status: "claimed",
      telegram_user_id: Number(from.id),
      telegram_username: username,
      display_name: displayName,
      claimed_at: new Date().toISOString()
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return { ok: true, username, displayName };
}

export async function completeLinkCode(env, code) {
  const clean = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const data = await getClaim(env, clean);
  if (!data || data.status !== "claimed" || !data.telegram_user_id || !data.telegram_username) {
    throw new Error("Not linked yet. Open Telegram, send the /chatsign code, then try again.");
  }
  return issueSession(env, {
    id: data.telegram_user_id,
    username: data.telegram_username,
    displayName: data.display_name || data.telegram_username
  });
}

export function sanitizeBody(raw) {
  const body = String(raw || "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, MAX_BODY);
  if (!body) throw new Error("Write something first.");
  if (body.length < 2) throw new Error("Message is too short.");
  return body;
}

export function whatsappChannelUrl(env) {
  return String(env.WHATSAPP_CHANNEL_URL || "").trim();
}

export function whatsappShareUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export async function mirrorChatToChannels(env, { username, body, messageId }) {
  const store = String(env.STORE_URL || "https://dtdpaymentsbot.pages.dev").replace(/\/$/, "");
  const chatUrl = `${store}/#chat`;
  const wa = whatsappChannelUrl(env);
  const lines = [
    "<b>DTD Chat</b>",
    `@${username}`,
    "",
    escapeHtml(body),
    "",
    `<a href="${chatUrl}">Open site chat</a>`
  ];
  if (wa) lines.push(`WhatsApp channel: ${wa}`);

  const text = lines.join("\n");
  const channelId = env.TELEGRAM_CHANNEL_ID;
  const mirrorOn = String(env.TELEGRAM_CHANNEL_MIRROR || "true").toLowerCase() !== "false";
  if (mirrorOn && channelId) {
    await sendTelegram(env, channelId, text);
  }
  const admin = env.TELEGRAM_ADMIN_CHAT_ID;
  if (admin && String(admin) !== String(channelId)) {
    await sendTelegram(env, admin, text);
  }
  return {
    telegramChannelUrl: env.TELEGRAM_CHANNEL_USERNAME
      ? `https://t.me/${String(env.TELEGRAM_CHANNEL_USERNAME).replace(/^@/, "")}`
      : "",
    whatsappChannelUrl: wa || "",
    whatsappShareUrl: whatsappShareUrl(`@${username} on DTD Chat:\n${body}\n${chatUrl}`),
    messageId
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export { MAX_BODY, getSupabase };
