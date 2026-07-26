/**
 * SMTP / SMS console helpers — access tokens, recipient parsing, job logging.
 * No spam-filter obfuscation.
 */

import { createClient } from "@supabase/supabase-js";

const MAX_RECIPIENTS = 200;
const EMAIL_LIMIT_PER_HOUR = 50;
/** Soft warm-up cap for paid unlocks (admins get 5x). Raise after IP reputation builds. */
const EMAIL_LIMIT_PER_DAY = 200;
const SMS_LIMIT_PER_HOUR = 100;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12h

export function smtpFromAddress(env) {
  return String(env.SUPPORT_EMAIL || "contact@dvtechnologies.xyz").trim().toLowerCase();
}

/** Business SMS sender phone (same role as From email) — from TELETHON_PHONE / SMS_FROM. */
export function smtpFromPhone(env) {
  let phone = String(env.TELETHON_PHONE || env.SMS_FROM || env.SMS_FROM_PHONE || "").trim();
  if (!phone) return "";
  if (!phone.startsWith("+") && /^\d{8,15}$/.test(phone)) phone = `+${phone}`;
  return phone;
}

/** True when CF Email binding/token or VPS mailer queue is available. */
export function mailerConfigured(env) {
  if (env?.EMAIL && typeof env.EMAIL.send === "function") return true;
  if (String(env.CF_EMAIL_API_TOKEN || env.CLOUDFLARE_API_TOKEN || "").trim()) return true;
  const url = String(env.VPS_MAILER_URL || "").trim();
  const secret = String(env.VPS_MAILER_SECRET || "").trim();
  return Boolean(url && secret);
}

export function getSupabaseAdmin(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function consoleSecret(env) {
  return String(env.SMTP_CONSOLE_SECRET || env.TELEGRAM_BOT_TOKEN || "dtd-smtp-dev").trim();
}

async function hmacSign(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function issueUnlockToken(env, claims) {
  const body = {
    ...claims,
    exp: Date.now() + TOKEN_TTL_MS
  };
  const payload = btoa(JSON.stringify(body));
  const sig = await hmacSign(consoleSecret(env), payload);
  return `${payload}.${sig}`;
}

export async function verifyUnlockToken(env, token) {
  const raw = String(token || "").trim();
  if (!raw || !raw.includes(".")) return null;
  const [payload, sig] = raw.split(".");
  const expected = await hmacSign(consoleSecret(env), payload);
  if (sig !== expected) return null;
  try {
    const claims = JSON.parse(atob(payload));
    if (!claims?.exp || Date.now() > Number(claims.exp)) return null;
    return claims;
  } catch {
    return null;
  }
}

export function normalizePhone(raw, defaultCountry = "254") {
  let value = String(raw || "").trim();
  if (!value) return null;

  const cc = String(defaultCountry || "254").replace(/\D/g, "") || "254";

  // Keep leading + if present, drop every other non-digit
  const hadPlus = value.trim().startsWith("+") || value.trim().startsWith("00");
  let digits = value.replace(/\D/g, "");
  if (!digits) return null;

  // 00international → drop 00
  if (digits.startsWith("00")) digits = digits.slice(2);

  // Already has country code
  if (digits.startsWith(cc) && digits.length >= cc.length + 7) {
    value = `+${digits}`;
  } else if (digits.startsWith("0") && digits.length >= 9) {
    // Local with trunk 0: 07xxxxxxxx → +2547xxxxxxxx
    value = `+${cc}${digits.slice(1)}`;
  } else if (!hadPlus && digits.length >= 7 && digits.length <= 10) {
    // Bare local mobile (7–10 digits) → assume default country
    value = `+${cc}${digits}`;
  } else if (digits.length >= 8 && digits.length <= 15) {
    value = `+${digits}`;
  } else {
    return null;
  }

  // Soft E.164: + then 8–15 digits, first digit 1–9
  if (!/^\+[1-9]\d{7,14}$/.test(value)) return null;
  return value;
}

export function parseAddresses(raw, kind = "email") {
  let parts;
  if (kind === "sms" || kind === "phone") {
    // Do NOT split on spaces (Kenya numbers often written "+254 712 345 678")
    parts = String(raw || "")
      .split(/[\n\r,;|]+/)
      .map((p) => p.trim())
      .filter(Boolean);
  } else {
    parts = String(raw || "")
      .split(/[\n\r,;\s]+/)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  const valid = [];
  const invalid = [];
  const seen = new Set();

  for (const part of parts) {
    if (kind === "email") {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) valid.push(part.toLowerCase());
      else invalid.push(part);
    } else {
      const phone = normalizePhone(part);
      if (!phone) {
        invalid.push(part);
        continue;
      }
      if (seen.has(phone)) continue;
      seen.add(phone);
      valid.push(phone);
    }
  }

  return { valid: valid.slice(0, MAX_RECIPIENTS), invalid, truncated: valid.length > MAX_RECIPIENTS };
}

export async function isAdminBearer(env, request) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const jwt = match[1].trim();
  const url = env.SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY;
  if (!url || !anon || !jwt) return false;

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) return false;

  const admin = getSupabaseAdmin(env);
  if (!admin) return Boolean(userData.user.email);
  const { data } = await admin.from("admin_users").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  // If admin_users empty/missing, allow any authenticated Supabase user (same as store admin practice).
  if (data?.user_id) return true;
  const { count } = await admin.from("admin_users").select("user_id", { count: "exact", head: true });
  if (!count) return true;
  return false;
}

export async function findPaidSmtpOrder(env, orderId, email) {
  const supabase = getSupabaseAdmin(env);
  if (!supabase) return { ok: false, reason: "db_unavailable" };

  const { data: order, error } = await supabase
    .from("orders")
    .select("id,payment_status,customer_email,customer_phone,order_items(product_name,product_id)")
    .eq("id", orderId)
    .maybeSingle();

  if (error) return { ok: false, reason: error.message };
  if (!order) return { ok: false, reason: "order_not_found" };

  const stored = String(order.customer_email || order.customer_phone || "")
    .trim()
    .toLowerCase();
  if (stored !== String(email || "").trim().toLowerCase()) {
    return { ok: false, reason: "email_mismatch" };
  }

  const paid = ["paid", "complete", "completed"].includes(String(order.payment_status || "").toLowerCase());
  if (!paid) return { ok: false, reason: "not_paid" };

  const items = order.order_items || [];
  const hasSmtp = items.some((item) => String(item.product_name || "").trim().toLowerCase() === "smtp");
  if (!hasSmtp) {
    // Fallback: any paid order can unlock if SMTP product was renamed — check products table link
    const productIds = items.map((i) => i.product_id).filter(Boolean);
    if (productIds.length) {
      const { data: products } = await supabase.from("products").select("id,name").in("id", productIds);
      const match = (products || []).some((p) => String(p.name || "").trim().toLowerCase() === "smtp");
      if (!match) return { ok: false, reason: "not_smtp_product" };
    } else {
      return { ok: false, reason: "not_smtp_product" };
    }
  }

  const { error: accessError } = await supabase.from("smtp_access").upsert(
    {
      order_id: order.id,
      email: stored,
      unlocked_at: new Date().toISOString()
    },
    { onConflict: "order_id,email" }
  );
  if (accessError) console.warn("smtp_access upsert skipped:", accessError.message);

  return { ok: true, orderId: order.id, email: stored };
}

export async function resolveAccess(env, request) {
  if (await isAdminBearer(env, request)) {
    return { ok: true, role: "admin", email: "admin", orderId: null };
  }

  const token =
    request.headers.get("X-SMTP-Token") ||
    request.headers.get("x-smtp-token") ||
    "";
  const claims = await verifyUnlockToken(env, token);
  if (!claims?.email) return { ok: false, reason: "unauthorized" };
  return {
    ok: true,
    role: "buyer",
    email: claims.email,
    orderId: claims.orderId || null
  };
}

export async function enforceRateLimit(env, access, channel) {
  const supabase = getSupabaseAdmin(env);
  if (!supabase) return { ok: true };

  const sinceHour = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let hourQuery = supabase
    .from("smtp_jobs")
    .select("id", { count: "exact", head: true })
    .eq("channel", channel)
    .gte("created_at", sinceHour);

  if (access.role !== "admin" && access.email) {
    hourQuery = hourQuery.eq("actor_email", access.email);
  }

  const { count: hourCount, error: hourError } = await hourQuery;
  if (!hourError) {
    const hourLimit =
      channel === "email" ? EMAIL_LIMIT_PER_HOUR : SMS_LIMIT_PER_HOUR;
    if ((hourCount || 0) >= hourLimit) {
      return { ok: false, reason: `Hourly ${channel} limit reached (${hourLimit}).` };
    }
  }

  // Daily warm-up soft cap for email (admins get higher headroom)
  if (channel === "email") {
    const sinceDay = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let dayQuery = supabase
      .from("smtp_jobs")
      .select("id", { count: "exact", head: true })
      .eq("channel", "email")
      .gte("created_at", sinceDay);
    if (access.role !== "admin" && access.email) {
      dayQuery = dayQuery.eq("actor_email", access.email);
    }
    const dayLimit = access.role === "admin" ? EMAIL_LIMIT_PER_DAY * 5 : EMAIL_LIMIT_PER_DAY;
    const { count: dayCount, error: dayError } = await dayQuery;
    if (!dayError && (dayCount || 0) >= dayLimit) {
      return {
        ok: false,
        reason: `Daily email warm-up limit reached (${dayLimit}). Ramp volume slowly for IP reputation.`
      };
    }
  }

  return { ok: true };
}

export async function createJob(env, { channel, access, subject, bodyPreview, recipients, payload, status = "queued" }) {
  const supabase = getSupabaseAdmin(env);
  if (!supabase) return { ok: true, jobId: null, skipped: true };

  const { data: job, error } = await supabase
    .from("smtp_jobs")
    .insert({
      channel,
      actor_email: access.email || null,
      order_id: access.orderId || null,
      subject: subject || null,
      body_preview: String(bodyPreview || "").slice(0, 280),
      recipient_count: recipients.length,
      payload: payload || {},
      status: status || "queued"
    })
    .select("id")
    .single();

  if (error || !job) {
    console.warn("smtp_jobs insert skipped:", error?.message || "unknown");
    return { ok: true, jobId: null, skipped: true };
  }

  if (recipients.length) {
    const { error: recError } = await supabase.from("smtp_job_recipients").insert(
      recipients.map((address) => ({
        job_id: job.id,
        address,
        status: "queued"
      }))
    );
    if (recError) console.warn("smtp_job_recipients insert skipped:", recError.message);
  }

  return { ok: true, jobId: job.id };
}

export async function finishJob(env, jobId, { status, error, recipientResults }) {
  const supabase = getSupabaseAdmin(env);
  if (!supabase || !jobId) return;

  await supabase
    .from("smtp_jobs")
    .update({
      status,
      error: error || null
    })
    .eq("id", jobId);

  if (Array.isArray(recipientResults)) {
    for (const row of recipientResults) {
      await supabase
        .from("smtp_job_recipients")
        .update({ status: row.status, error: row.error || null })
        .eq("job_id", jobId)
        .eq("address", row.address);
    }
  }
}

export async function listJobs(env, access, limit = 30) {
  const supabase = getSupabaseAdmin(env);
  if (!supabase) return [];

  let query = supabase
    .from("smtp_jobs")
    .select("id,channel,subject,recipient_count,status,error,created_at,actor_email")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (access.role !== "admin" && access.email) {
    query = query.eq("actor_email", access.email);
  }

  const { data } = await query;
  return data || [];
}

export async function sendViaVpsMailer(env, message) {
  const base = String(env.VPS_MAILER_URL || "").replace(/\/$/, "").trim();
  const secret = String(env.VPS_MAILER_SECRET || "").trim();
  if (!base || !secret) {
    return { ok: false, reason: "VPS mailer not configured (VPS_MAILER_URL / VPS_MAILER_SECRET)." };
  }

  const response = await fetch(`${base}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Mailer-Secret": secret,
      Authorization: `Bearer ${secret}`
    },
    // Include secret in body — Cloudflare Workers may strip outbound auth headers
    body: JSON.stringify({ ...message, secret })
  });

  const rawText = await response.text();
  let data = {};
  try {
    data = JSON.parse(rawText);
  } catch {
    data = {};
  }
  if (!response.ok || data.ok === false) {
    const snippet = (data.error || rawText || "").toString().slice(0, 180);
    return { ok: false, reason: snippet || `Mailer HTTP ${response.status}` };
  }
  return { ok: true, data };
}

export async function sendViaSmsGateway(env, { to, text }) {
  // SMSGate (capcom6) cloud default, or your private/local gateway URL
  const base = String(env.SMS_GATEWAY_URL || "").replace(/\/$/, "").trim();
  const user = String(env.SMS_GATEWAY_USER || "").trim();
  const pass = String(env.SMS_GATEWAY_PASS || env.SMS_GATEWAY_TOKEN || "").trim();
  if (!base) {
    return {
      ok: false,
      reason:
        "SMS gateway not configured. Install SMSGate on an Android phone, then set SMS_GATEWAY_URL + SMS_GATEWAY_USER + SMS_GATEWAY_PASS."
    };
  }

  const headers = { "Content-Type": "application/json" };
  if (user && pass) {
    headers.Authorization = `Basic ${btoa(`${user}:${pass}`)}`;
  } else if (pass) {
    headers.Authorization = `Bearer ${pass}`;
  }

  // Prefer SMSGate 3rd-party API body
  const payloads = [
    {
      url: /\/messages?$/i.test(base) || /\/3rdparty\//i.test(base) ? base : `${base}/messages`,
      body: { textMessage: { text }, phoneNumbers: [to] }
    },
    {
      url: base,
      body: { textMessage: { text }, phoneNumbers: [to] }
    },
    {
      url: base.endsWith("/message") ? base : `${base}/message`,
      body: { phoneNumbers: [to], message: text, text }
    },
    {
      url: base,
      body: { to, message: text, text, phoneNumbers: [to] }
    }
  ];

  let lastError = "SMS gateway request failed";
  for (const attempt of payloads) {
    try {
      const response = await fetch(attempt.url, {
        method: "POST",
        headers,
        body: JSON.stringify(attempt.body)
      });
      const raw = await response.text();
      let data = {};
      try {
        data = JSON.parse(raw);
      } catch {
        data = {};
      }
      if (response.ok) return { ok: true, data };
      lastError = (data.message || data.error || raw || `HTTP ${response.status}`).toString().slice(0, 200);
      // try next shape on 404/400
      if (response.status !== 404 && response.status !== 400 && response.status !== 405) break;
    } catch (error) {
      lastError = error.message || String(error);
    }
  }
  return { ok: false, reason: lastError };
}

export const SMTP_LIMITS = {
  MAX_RECIPIENTS,
  EMAIL_LIMIT_PER_HOUR,
  EMAIL_LIMIT_PER_DAY,
  SMS_LIMIT_PER_HOUR
};
