import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { processTelegramUpdate } from "./functions/lib/bot-commands.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseAdmin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

const PAYMENT_METHODS = new Set([
  "Crypto",
  "Paystack",
  "Paystack Card",
  "Paystack Bank",
  "Paystack USSD",
  "Paystack Mobile Money",
  "Paystack QR"
]);

function normalizePaymentMethod(method) {
  const value = String(method || "Crypto").trim();
  if (PAYMENT_METHODS.has(value)) return value;
  if (value.toLowerCase().includes("paystack")) return "Paystack";
  return "Crypto";
}

function dbPaymentMethod(method) {
  const normalized = normalizePaymentMethod(method);
  return normalized === "Crypto" ? "Crypto" : "Paystack";
}

async function sendTelegram(chatId, message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return { ok: false, reason: "not_configured" };

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "HTML"
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Telegram error:", error);
    // #region agent log
    try {
      const fs = await import("node:fs");
      fs.appendFileSync(
        "debug-8491be.log",
        `${JSON.stringify({
          sessionId: "8491be",
          runId: "post-fix",
          hypothesisId: "E",
          location: "server.js:sendTelegram",
          message: "Telegram send failed",
          data: { chatId: String(chatId), status: response.status, error: String(error).slice(0, 300) },
          timestamp: Date.now()
        })}\n`
      );
    } catch (_) {}
    // #endregion
    return { ok: false, reason: response.status === 401 ? "unauthorized" : "send_failed" };
  }

  // #region agent log
  try {
    const fs = await import("node:fs");
    fs.appendFileSync(
      "debug-8491be.log",
      `${JSON.stringify({
        sessionId: "8491be",
        runId: "pre-fix",
        hypothesisId: "E",
        location: "server.js:sendTelegram",
        message: "Telegram send ok",
        data: { chatId: String(chatId) },
        timestamp: Date.now()
      })}\n`
    );
  } catch (_) {}
  // #endregion
  return { ok: true };
}

function buildOrderTelegramMessage({
  customerName,
  customerEmail,
  telegramUsername,
  normalizedMethod,
  paymentReference,
  productAccount,
  totalUsd,
  items,
  orderId,
  visitorIp,
  userAgent
}) {
  const itemLines = items.map((item) => `• ${item.product_name} x${item.quantity}`).join("\n");
  return [
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
  ]
    .filter(Boolean)
    .join("\n");
}

async function notifyOrderTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const channelIds = [
    process.env.TELEGRAM_CHANNEL_ID,
    process.env.TELEGRAM_BACKUP_CHANNEL_ID,
    process.env.TELEGRAM_GROUP_ID
  ].filter((id, index, arr) => id && arr.indexOf(id) === index);

  const adminId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  for (const channelId of channelIds) {
    await sendTelegram(channelId, message);
  }

  if (adminId) {
    const adminNote = channelIds.length
      ? `<b>Order alert (copy)</b>\n${message.replace("<b>New DTD Store order</b>\n", "")}`
      : message;
    await sendTelegram(adminId, adminNote);
  }
}

async function insertOrder(orderPayload, items) {
  if (!supabaseAdmin) {
    throw new Error("Supabase is not configured on the server.");
  }

  const rpcItems = items.map((item) => ({
    product_id: item.product_id || "",
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price_usd: item.unit_price_usd
  }));

  const { data: rpcOrderId, error: rpcError } = await supabaseAdmin.rpc("create_store_order", {
    p_customer_name: orderPayload.customer_name,
    p_customer_phone: orderPayload.customer_phone,
    p_telegram_username: orderPayload.telegram_username,
    p_delivery_details: orderPayload.delivery_details,
    p_payment_method: orderPayload.payment_method,
    p_total_usd: orderPayload.total_usd,
    p_items: rpcItems
  });

  if (!rpcError && rpcOrderId) return rpcOrderId;

  const attempts = [
    orderPayload,
    {
      customer_name: orderPayload.customer_name,
      customer_phone: orderPayload.customer_phone,
      telegram_username: orderPayload.telegram_username,
      delivery_details: orderPayload.delivery_details,
      payment_method: orderPayload.payment_method,
      total_usd: orderPayload.total_usd
    }
  ];

  let order = null;
  let lastError = rpcError;

  for (const payload of attempts) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .insert(payload)
      .select("id")
      .single();

    if (!error) {
      order = data;
      break;
    }

    lastError = error;
    if (!String(error.message || "").includes("column")) break;
  }

  if (!order) {
    const message = lastError?.message || "Order insert failed";
    if (message.includes("row-level security") || message.includes("create_store_order")) {
      throw new Error(
        "Order save blocked. Add SUPABASE_SERVICE_ROLE_KEY to .env and run supabase-migration.sql in Supabase."
      );
    }
    throw lastError || new Error(message);
  }

  const orderItems = items.map((item) => ({
    order_id: order.id,
    product_id: item.product_id || null,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price_usd: item.unit_price_usd
  }));

  const { error: itemsError } = await supabaseAdmin.from("order_items").insert(orderItems);
  if (itemsError) throw itemsError;

  return order.id;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/visitor", (req, res) => {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.headers["cf-connecting-ip"] ||
    req.socket?.remoteAddress ||
    "unknown";
  res.json({ ip, userAgent: req.headers["user-agent"] || "" });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    supabase: Boolean(supabaseAdmin),
    paystack: Boolean(process.env.PAYSTACK_PUBLIC_KEY),
    telegram: Boolean(
      process.env.TELEGRAM_BOT_TOKEN &&
        (process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHANNEL_ID)
    ),
    telegramAdmin: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ADMIN_CHAT_ID),
    telegramChannel: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID),
    btc: Boolean(process.env.BTC_ADDRESS)
  });
});

app.get("/api/config", (_req, res) => {
  const botUsername = String(process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");
  const telegramReady = Boolean(
    process.env.TELEGRAM_BOT_TOKEN &&
      (process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHANNEL_ID)
  );

  res.json({
    paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || "",
    paystackCurrency: process.env.PAYSTACK_CURRENCY || "KES",
    paystackConversionRate: Number(process.env.PAYSTACK_CONVERSION_RATE || 129),
    btcAddress: process.env.BTC_ADDRESS || "",
    btcNetwork: "BTC",
    storeUrl: process.env.STORE_URL || "https://dtdpaymentsbot.pages.dev",
    telegramBotUsername: botUsername,
    telegramBotUrl: botUsername ? `https://t.me/${botUsername}` : "",
    telegramEnabled: telegramReady,
    paymentOptions: [
      { id: "Crypto", label: "Bitcoin (BTC)", type: "crypto" },
      { id: "Paystack", label: "Card / Bank / Mobile Money", type: "paystack" }
    ]
  });
});

app.post("/api/orders", async (req, res) => {
  try {
    const {
      customerName,
      customerEmail,
      telegramUsername,
      paymentMethod,
      paymentReference,
      productAccount,
      deliveryDetails,
      items,
      totalUsd,
      visitorIp,
      userAgent
    } = req.body;

    if (!customerName || !customerEmail || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Missing required order fields." });
    }

    const normalizedMethod = normalizePaymentMethod(paymentMethod);
    const deliveryBlock = [
      `Email: ${customerEmail}`,
      `Payment option: ${normalizedMethod}`,
      paymentReference ? `Payment reference: ${paymentReference}` : null,
      productAccount ? `Product account: ${productAccount}` : null,
      deliveryDetails || null
    ]
      .filter(Boolean)
      .join("\n");

    const orderId = await insertOrder(
      {
        customer_name: customerName,
        customer_phone: customerEmail,
        customer_email: customerEmail,
        telegram_username: telegramUsername || null,
        delivery_details: deliveryBlock,
        payment_method: dbPaymentMethod(normalizedMethod),
        payment_reference: paymentReference || null,
        product_account: productAccount || null,
        total_usd: Number(totalUsd || 0)
      },
      items
    );

    const resolvedIp =
      visitorIp ||
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["cf-connecting-ip"] ||
      req.socket?.remoteAddress ||
      "unknown";
    const resolvedAgent = userAgent || req.headers["user-agent"] || "";

    const telegramMessage = buildOrderTelegramMessage({
      customerName,
      customerEmail,
      telegramUsername,
      normalizedMethod,
      paymentReference,
      productAccount,
      totalUsd,
      items,
      orderId,
      visitorIp: resolvedIp,
      userAgent: resolvedAgent
    });

    await notifyOrderTelegram(telegramMessage);

    res.json({ ok: true, orderId });
  } catch (error) {
    console.error("Order error:", error);
    res.status(500).json({
      error: error.message || "Could not save order. Check Supabase service role key in .env."
    });
  }
});

app.post("/api/paystack/initialize", async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.status(500).json({ error: "Paystack secret key not configured." });

    const email = String(req.body.email || "").trim();
    const name = String(req.body.name || "").trim();
    const amountUsd = Number(req.body.amountUsd || 0);
    if (!email || !(amountUsd > 0)) {
      return res.status(400).json({ error: "Email and amount are required." });
    }

    const currency = process.env.PAYSTACK_CURRENCY || "KES";
    const rate = Number(process.env.PAYSTACK_CONVERSION_RATE || 129);
    const amount = Math.round(amountUsd * rate * 100);
    const reference = String(req.body.reference || `DTD-${Date.now()}`);

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        amount,
        currency,
        reference,
        callback_url: `${req.protocol}://${req.get("host")}/?paid=1&reference=${encodeURIComponent(reference)}`,
        metadata: {
          customer_name: name,
          amount_usd: amountUsd,
          cart_items: req.body.cartItems || ""
        }
      })
    });

    const payload = await response.json();
    // #region agent log
    try {
      const fs = await import("node:fs");
      fs.appendFileSync(
        "debug-8491be.log",
        `${JSON.stringify({
          sessionId: "8491be",
          runId: "post-fix",
          hypothesisId: "A",
          location: "server.js:paystack/initialize",
          message: "Initialize payment",
          data: {
            currency,
            rate,
            amountUsd,
            amount,
            httpStatus: response.status,
            ok: payload.status,
            message: payload.message,
            hasAuthUrl: Boolean(payload.data && payload.data.authorization_url)
          },
          timestamp: Date.now()
        })}\n`
      );
    } catch (_) {}
    // #endregion

    if (!response.ok || !payload.status) {
      return res.status(400).json({
        error: payload.message || "Could not start Paystack payment.",
        code: payload.code
      });
    }

    res.json({
      ok: true,
      reference: payload.data.reference,
      access_code: payload.data.access_code,
      authorization_url: payload.data.authorization_url,
      currency,
      amount
    });
  } catch (error) {
    console.error("Paystack initialize error:", error);
    res.status(500).json({ error: "Paystack initialize failed." });
  }
});

app.post("/api/paystack/verify", async (req, res) => {
  try {
    const reference = String(req.body.reference || "").trim();
    if (!reference) return res.status(400).json({ error: "Missing reference." });

    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.status(500).json({ error: "Paystack secret key not configured." });

    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret}` }
    });

    const payload = await response.json();
    // #region agent log
    try {
      const fs = await import("node:fs");
      fs.appendFileSync(
        "debug-8491be.log",
        `${JSON.stringify({
          sessionId: "8491be",
          runId: "post-fix",
          hypothesisId: "A",
          location: "server.js:paystack/verify",
          message: "Verify response",
          data: {
            reference,
            httpOk: response.ok,
            status: payload.status,
            msg: payload.message,
            paid: payload.data && payload.data.status,
            currency: payload.data && payload.data.currency
          },
          timestamp: Date.now()
        })}\n`
      );
    } catch (_) {}
    // #endregion
    if (!response.ok || !payload.status) {
      return res.status(400).json({ error: payload.message || "Verification failed." });
    }

    res.json({
      ok: true,
      paid: payload.data.status === "success",
      amount: payload.data.amount,
      currency: payload.data.currency,
      reference: payload.data.reference
    });
  } catch (error) {
    console.error("Paystack verify error:", error);
    res.status(500).json({ error: "Paystack verification failed." });
  }
});

// Debug probe: confirms merchant currency works with current .env
app.post("/api/paystack/probe", async (_req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const currency = process.env.PAYSTACK_CURRENCY || "KES";
    const rate = Number(process.env.PAYSTACK_CONVERSION_RATE || 129);
    if (!secret) return res.status(500).json({ error: "Missing secret" });

    const amount = Math.round(49 * rate * 100);
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: "debug-probe@example.com",
        amount,
        currency,
        reference: `DTD-PROBE-${Date.now()}`
      })
    });
    const payload = await response.json();
    // #region agent log
    try {
      const fs = await import("node:fs");
      fs.appendFileSync(
        "debug-8491be.log",
        `${JSON.stringify({
          sessionId: "8491be",
          runId: "post-fix",
          hypothesisId: "A",
          location: "server.js:paystack/probe",
          message: "Initialize probe",
          data: {
            currency,
            rate,
            amount,
            httpStatus: response.status,
            ok: payload.status,
            message: payload.message,
            code: payload.code || (payload.meta && payload.meta.nextStep)
          },
          timestamp: Date.now()
        })}\n`
      );
    } catch (_) {}
    // #endregion
    res.status(response.ok ? 200 : 400).json({
      ok: Boolean(payload.status),
      currency,
      rate,
      amount,
      message: payload.message,
      code: payload.code
    });
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  }
});

app.post("/api/telegram/message", async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();
    const name = String(req.body.name || "Store visitor").trim();
    const contact = String(req.body.contact || "").trim();

    if (!message) return res.status(400).json({ error: "Message is required." });

    const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID;
    const result = await sendTelegram(
      adminChat,
      [
        "<b>DTD Store chat</b>",
        `From: ${name}`,
        contact ? `Contact: ${contact}` : null,
        "",
        message
      ]
        .filter(Boolean)
        .join("\n")
    );

    if (!result.ok) {
      const detail =
        result.reason === "not_configured"
          ? "Telegram bot is not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID to .env."
          : result.reason === "unauthorized"
            ? "Telegram bot token is invalid or revoked (401). Create a new token in @BotFather and update TELEGRAM_BOT_TOKEN in .env."
            : "Could not reach Telegram. Check TELEGRAM_BOT_TOKEN, admin chat ID, and that the bot can message you.";
      return res.status(503).json({ error: detail });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("Telegram message error:", error);
    res.status(500).json({ error: "Could not send message." });
  }
});

app.post("/api/telegram/webhook", async (req, res) => {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret) {
      const header = req.get("X-Telegram-Bot-Api-Secret-Token");
      if (header !== secret) return res.status(403).json({ error: "Forbidden" });
    }

    await processTelegramUpdate(process.env, req.body, {
      getSupabase: () => supabaseAdmin,
      sendTelegram: async (_env, chatId, message) => sendTelegram(chatId, message)
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    res.json({ ok: true });
  }
});

app.use(express.static(__dirname));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`DTD Store running at http://localhost:${PORT}`);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("Warning: SUPABASE_SERVICE_ROLE_KEY is missing. Order saves may fail due to RLS.");
  }
  if (
    !process.env.TELEGRAM_BOT_TOKEN ||
    (!process.env.TELEGRAM_ADMIN_CHAT_ID && !process.env.TELEGRAM_CHANNEL_ID)
  ) {
    console.warn("Warning: Telegram bot not fully configured in .env.");
  }
});
