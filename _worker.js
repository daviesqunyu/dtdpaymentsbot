/**
 * DTD Store — Pages Advanced Mode Worker
 * Handles all /api/* routes, serves static assets for everything else
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
    async from(table) {
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
        }
      };
    }
  };
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

// ─── API Handlers ───────────────────────────────────────

async function handleHealth(env) {
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
    btc: Boolean(env.BTC_ADDRESS)
  });
}

async function handleVisitor(request) {
  return json({
    ip: getClientIp(request),
    userAgent: request.headers.get("user-agent") || ""
  });
}

async function handleConfig(env) {
  const botUsername = String(env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");
  const telegramReady = Boolean(
    env.TELEGRAM_BOT_TOKEN &&
    (env.TELEGRAM_ADMIN_CHAT_ID || env.TELEGRAM_CHANNEL_ID)
  );
  return json({
    paystackPublicKey: env.PAYSTACK_PUBLIC_KEY || "",
    paystackCurrency: env.PAYSTACK_CURRENCY || "KES",
    paystackConversionRate: Number(env.PAYSTACK_CONVERSION_RATE || 129),
    usdtTrc20Address: env.USDT_TRC20_ADDRESS || "",
    usdtNetwork: "TRC20",
    btcAddress: env.BTC_ADDRESS || "",
    btcNetwork: "BTC",
    storeUrl: env.STORE_URL || "https://dtdpaymentsbot.pages.dev",
    companyUrl: env.COMPANY_URL || "https://dvtechnologies.xyz",
    companyName: env.COMPANY_NAME || "DV Technologies",
    supportEmail: String(env.SUPPORT_EMAIL || "contact@dvtechnologies.xyz").trim().toLowerCase(),
    telegramBotUsername: botUsername,
    telegramBotUrl: botUsername ? `https://t.me/${botUsername}` : "",
    telegramEnabled: telegramReady,
    paymentOptions: [
      { id: "USDT", label: "USDT (TRC20)", type: "crypto", asset: "USDT", network: "TRC20" },
      { id: "Bitcoin", label: "Bitcoin (BTC)", type: "crypto", asset: "BTC", network: "BTC" },
      { id: "Paystack", label: "Card / Bank · Global", type: "paystack" }
    ]
  });
}

async function handleOrders(request, env) {
  const body = await request.json();
  const {
    customerName, customerEmail, telegramUsername, paymentMethod,
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

  return json({ ok: true, orderId });
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

async function handleTelegramWebhook(request, env) {
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const header = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (header !== secret) return json({ error: "Forbidden" }, 403);
  }

  const body = await request.json();
  if (!body.message || !body.message.text) return json({ ok: true });

  const chatId = body.message.chat?.id;
  const text = body.message.text || "";

  if (text.startsWith("/start")) {
    await sendTelegram(env, chatId, [
      "<b>Welcome to DTD Store Bot</b>", "", "Commands:",
      "/start — Show this message", "/help — Get help",
      "/order — Check order status", "/support — Contact support"
    ].join("\n"));
  } else if (text.startsWith("/help")) {
    await sendTelegram(env, chatId, [
      "<b>DTD Store Help</b>", "",
      "• Use the store at https://dtdpaymentsbot.pages.dev",
      "• For support, use /support", "• For order status, use /order ORDER_ID"
    ].join("\n"));
  } else if (text.startsWith("/support")) {
    const supportEmail = env.SUPPORT_EMAIL || "contact@dvtechnologies.xyz";
    await sendTelegram(env, chatId, [
      "<b>DTD Store Support</b>", "", `Email: ${supportEmail}`, "We'll respond within 24 hours."
    ].join("\n"));
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
        queueConfigured: true, smsGatewayConfigured: false,
        smsConfigured: false, awsSesPrimary: true,
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
    const result = await callVpsMailer(env, "/send-email", { from, to: recipients, subject, text, hostname });
    if (sb) {
      await sb.from("smtp_jobs").insert({
        channel: "email", recipients: recipients.join(", "),
        recipient_count: recipients.length, subject,
        body_preview: text.substring(0, 200),
        status: result.delivered ? "sent" : "queued",
        error: result.error || null
      });
    }
    return json({
      delivered: result.delivered || false, sent: recipients.length,
      jobId: result.jobId || null, invalid,
      message: result.message || `Queued ${recipients.length} email(s) for VPS delivery.`
    });
  } catch (err) {
    if (env.CF_EMAIL_API_TOKEN) {
      try {
        for (const recipient of recipients) {
          await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID}/email/routing/addresses`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${env.CF_EMAIL_API_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from, to: recipient, subject, text })
          });
        }
        if (sb) {
          await sb.from("smtp_jobs").insert({
            channel: "email", recipients: recipients.join(", "),
            recipient_count: recipients.length, subject,
            body_preview: text.substring(0, 200), status: "sent"
          });
        }
        return json({ delivered: true, sent: recipients.length, invalid, message: "Sent via Cloudflare Email." });
      } catch {}
    }
    if (sb) {
      await sb.from("smtp_jobs").insert({
        channel: "email", recipients: recipients.join(", "),
        recipient_count: recipients.length, subject,
        body_preview: text.substring(0, 200), status: "failed", error: err.message
      });
    }
    return json({ delivered: false, sent: 0, invalid, message: `Email send failed: ${err.message}` });
  }
}

async function handleSmtpSendSms(request, env) {
  const token = request.headers.get("X-SMTP-Token");
  if (!verifyToken(env, token)) return json({ error: "Unauthorized." }, 401);

  const body = await request.json();
  const to = String(body.to || "").trim();
  const text = String(body.text || "").trim();
  const gwUser = body.gwUser || "";
  const gwPass = body.gwPass || "";
  const gwUrl = body.gwUrl || "";

  if (!to || !text) return json({ error: "Phone numbers and text are required." }, 400);
  if (!gwUser || !gwPass) return json({ error: "SMSGate username + password required." }, 400);

  const phones = to.split(/[\n\r,;|]+/).map(p => p.trim()).filter(Boolean);
  const sb = getSupabase(env);

  try {
    const result = await callVpsMailer(env, "/send-sms", { phones, text, gwUser, gwPass, gwUrl });
    if (sb) {
      await sb.from("smtp_jobs").insert({
        channel: "sms", recipients: phones.join(", "),
        recipient_count: phones.length, subject: text.substring(0, 80),
        body_preview: text.substring(0, 200),
        status: result.delivered ? "sent" : "queued", error: result.error || null
      });
    }
    return json({
      sent: phones.length, jobId: result.jobId || null, invalid: [],
      message: result.message || `Queued ${phones.length} SMS for VPS delivery.`
    });
  } catch (err) {
    if (sb) {
      await sb.from("smtp_jobs").insert({
        channel: "sms", recipients: phones.join(", "),
        recipient_count: phones.length, subject: text.substring(0, 80),
        body_preview: text.substring(0, 200), status: "failed", error: err.message
      });
    }
    return json({ sent: 0, invalid: [], message: `SMS send failed: ${err.message}` });
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

// ─── Router ─────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (!path.startsWith("/api/")) {
      // Let Pages serve static assets
      return env.ASSETS.fetch(request);
    }

    try {
      if (path === "/api/health" && method === "GET") return await handleHealth(env);
      if (path === "/api/visitor" && method === "GET") return await handleVisitor(request);
      if (path === "/api/config" && method === "GET") return await handleConfig(env);
      if (path === "/api/orders" && method === "POST") return await handleOrders(request, env);
      if (path === "/api/paystack/initialize" && method === "POST") return await handlePaystackInit(request, env);
      if (path === "/api/paystack/verify" && method === "POST") return await handlePaystackVerify(request, env);
      if (path === "/api/paystack/probe" && method === "POST") return await handlePaystackInit(request, env);
      if (path === "/api/telegram/message" && method === "POST") return await handleTelegramMessage(request, env);
      if (path === "/api/telegram/webhook" && method === "POST") return await handleTelegramWebhook(request, env);
      if (path === "/api/analytics" && method === "POST") return await handleAnalytics(request, env);

      if (path === "/api/smtp/unlock" && method === "POST") return await handleSmtpUnlock(request, env);
      if (path === "/api/smtp/send-email" && method === "POST") return await handleSmtpSendEmail(request, env);
      if (path === "/api/smtp/send-sms" && method === "POST") return await handleSmtpSendSms(request, env);
      if (path === "/api/smtp/jobs" && method === "GET") return await handleSmtpJobs(request, env);
      if (path === "/api/smtp/otp" && (method === "GET" || method === "POST")) return await handleSmtpOtp(request, env);

      return json({ error: "Not found." }, 404);
    } catch (error) {
      return json({ error: error.message || "Internal server error." }, 500);
    }
  }
};