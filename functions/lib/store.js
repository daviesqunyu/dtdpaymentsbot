import { createClient } from "@supabase/supabase-js";

const PAYMENT_METHODS = new Set([
  "Crypto",
  "Paystack",
  "Paystack Card",
  "Paystack Bank",
  "Paystack USSD",
  "Paystack Mobile Money",
  "Paystack QR"
]);

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export function getSupabase(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export function normalizePaymentMethod(method) {
  const value = String(method || "Crypto").trim();
  if (PAYMENT_METHODS.has(value)) return value;
  if (value.toLowerCase().includes("paystack")) return "Paystack";
  return "Crypto";
}

export function dbPaymentMethod(method) {
  const normalized = normalizePaymentMethod(method);
  return normalized === "Crypto" ? "Crypto" : "Paystack";
}

export function buildOrderTelegramMessage({
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
    orderId ? `🏷️ Order ID: <code>${orderId}</code>` : null,
    `👤 Name: ${customerName}`,
    `📧 Email: ${customerEmail}`,
    telegramUsername ? `💬 Telegram: @${String(telegramUsername).replace(/^@/, "")}` : null,
    `💳 Payment: ${normalizedMethod}`,
    paymentReference ? `🔗 Ref: <code>${paymentReference}</code>` : null,
    productAccount ? `🔑 Account: ${productAccount}` : null,
    `💵 Total: $${Number(totalUsd || 0).toFixed(2)} USD`,
    visitorIp ? `🌐 IP: <code>${visitorIp}</code>` : null,
    userAgent ? `💻 Device: ${String(userAgent).substring(0, 80)}` : null,
    "",
    "<b>Items:</b>",
    itemLines
  ]
    .filter(Boolean)
    .join("\n");
}

export async function notifyOrderTelegram(env, message) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const channelIds = [
    env.TELEGRAM_CHANNEL_ID,
    env.TELEGRAM_BACKUP_CHANNEL_ID,
    env.TELEGRAM_GROUP_ID
  ].filter((id, index, arr) => id && arr.indexOf(id) === index);

  const adminId = env.TELEGRAM_ADMIN_CHAT_ID;

  for (const channelId of channelIds) {
    await sendTelegram(env, channelId, message);
  }

  if (adminId) {
    const adminNote = channelIds.length
      ? `<b>Order alert (copy)</b>\n${message.replace("<b>New DTD Store order</b>\n", "")}`
      : message;
    await sendTelegram(env, adminId, adminNote);
  }
}

export function getStoreConfig(env) {
  const botUsername = String(env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");
  const telegramReady = Boolean(
    env.TELEGRAM_BOT_TOKEN && (env.TELEGRAM_ADMIN_CHAT_ID || env.TELEGRAM_CHANNEL_ID)
  );

  return {
    paystackPublicKey: env.PAYSTACK_PUBLIC_KEY || "",
    paystackCurrency: env.PAYSTACK_CURRENCY || "KES",
    paystackConversionRate: Number(env.PAYSTACK_CONVERSION_RATE || 129),
    btcAddress: env.BTC_ADDRESS || "",
    btcNetwork: "BTC",
    storeUrl: env.STORE_URL || "https://dtdpaymentsbot.pages.dev",
    telegramBotUsername: botUsername,
    telegramBotUrl: botUsername ? `https://t.me/${botUsername}` : "",
    telegramEnabled: telegramReady,
    paymentOptions: [
      { id: "Crypto", label: "Bitcoin (BTC)", type: "crypto" },
      { id: "Paystack", label: "Card / Bank / Mobile Money", type: "paystack" }
    ]
  };
}

export async function sendTelegram(env, chatId, message) {
  const token = env.TELEGRAM_BOT_TOKEN;
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
    const errText = await response.text();
    console.error("Telegram error:", errText);
    // #region agent log
    fetch("http://127.0.0.1:7413/ingest/3855ecfa-f160-49a6-b4f2-efca4f443e59", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8491be" },
      body: JSON.stringify({
        sessionId: "8491be",
        runId: "pre-fix",
        hypothesisId: "E",
        location: "functions/lib/store.js:sendTelegram",
        message: "Telegram send failed",
        data: { chatId: String(chatId), status: response.status, error: String(errText).slice(0, 300) },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
    return { ok: false, reason: "send_failed" };
  }

  return { ok: true };
}

export async function insertOrder(env, orderPayload, items) {
  const supabaseAdmin = getSupabase(env);
  if (!supabaseAdmin) {
    throw new Error("Supabase is not configured.");
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
        "Order save blocked. Set SUPABASE_SERVICE_ROLE_KEY in Cloudflare Pages secrets and run supabase-migration.sql."
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
