import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

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
    return { ok: false, reason: "send_failed" };
  }

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
  orderId
}) {
  const itemLines = items.map((item) => `• ${item.product_name} x${item.quantity}`).join("\n");
  return [
    "<b>New DTD Store order</b>",
    orderId ? `Order ID: ${orderId}` : null,
    `Name: ${customerName}`,
    `Email: ${customerEmail}`,
    telegramUsername ? `Telegram: @${String(telegramUsername).replace(/^@/, "")}` : null,
    `Payment: ${normalizedMethod}`,
    paymentReference ? `Ref: ${paymentReference}` : null,
    productAccount ? `Account: ${productAccount}` : null,
    `Total: $${Number(totalUsd || 0).toFixed(2)}`,
    "",
    itemLines
  ]
    .filter(Boolean)
    .join("\n");
}

async function notifyOrderTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const adminId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (channelId) {
    await sendTelegram(channelId, message);
  }

  if (adminId) {
    const adminNote = channelId
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
    btcAddress: process.env.BTC_ADDRESS || "",
    btcNetwork: "BTC",
    telegramBotUsername: botUsername,
    telegramBotUrl: botUsername ? `https://t.me/${botUsername}` : "",
    telegramEnabled: telegramReady,
    paymentOptions: [
      { id: "Crypto", label: "Bitcoin (BTC)", type: "crypto" },
      { id: "Paystack Card", label: "Card (Visa / Mastercard)", type: "paystack", channels: ["card"] },
      { id: "Paystack Bank", label: "Bank transfer", type: "paystack", channels: ["bank", "bank_transfer"] },
      { id: "Paystack USSD", label: "USSD", type: "paystack", channels: ["ussd"] },
      { id: "Paystack Mobile Money", label: "Mobile money", type: "paystack", channels: ["mobile_money"] },
      { id: "Paystack QR", label: "QR code", type: "paystack", channels: ["qr"] }
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
      totalUsd
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

    const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID;
    const telegramMessage = buildOrderTelegramMessage({
      customerName,
      customerEmail,
      telegramUsername,
      normalizedMethod,
      paymentReference,
      productAccount,
      totalUsd,
      items,
      orderId
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
      return res.status(503).json({
        error: "Telegram bot is not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID to .env."
      });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("Telegram message error:", error);
    res.status(500).json({ error: "Could not send message." });
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
