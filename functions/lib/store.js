import { createClient } from "@supabase/supabase-js";

const PAYMENT_METHODS = new Set([
  "Crypto",
  "USDT",
  "Bitcoin",
  "Stars",
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
  const value = String(method || "USDT").trim();
  if (PAYMENT_METHODS.has(value)) return value;
  const lower = value.toLowerCase();
  if (lower.includes("paystack")) return "Paystack";
  if (lower.includes("star")) return "Stars";
  if (lower.includes("usdt") || lower.includes("trc20") || lower.includes("tron")) return "USDT";
  if (lower.includes("bitcoin") || lower === "btc") return "Bitcoin";
  if (lower.includes("crypto")) return "Crypto";
  return "USDT";
}

export function dbPaymentMethod(method) {
  // Schema currently allows Crypto / Paystack (+ legacy Card / M-Pesa / …).
  // Keep asset detail in delivery_details / payment_reference for admin UI.
  const value = String(method || "").toLowerCase();
  if (value.includes("paystack")) return "Paystack";
  if (value.includes("star") || value === "xtr") return "Crypto";
  if (
    value.includes("crypto") ||
    value.includes("bitcoin") ||
    value === "btc" ||
    value.includes("usdt") ||
    value.includes("trc20") ||
    value.includes("tron")
  ) {
    return "Crypto";
  }
  if (value.includes("m-pesa") || value.includes("momo") || value.includes("mobile")) return "M-Pesa";
  if (value.includes("ussd")) return "USSD";
  if (value.includes("bank")) return "Bank";
  if (value.includes("card")) return "Card";
  return "Paystack";
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
  paymentStatus,
  visitorIp,
  userAgent
}) {
  const itemLines = items.map((item) => `• ${item.product_name} x${item.quantity}`).join("\n");
  const statusView = paymentStatusView(paymentStatus);
  return [
    "✨ <b>New DTD Store Order</b>",
    "━━━━━━━━━━━━━━━━━━━━",
    orderId ? `🏷️ Order ID: <code>${orderId}</code>` : null,
    `👤 Name: ${customerName}`,
    `📧 Email: ${customerEmail}`,
    telegramUsername ? `💬 Telegram: @${String(telegramUsername).replace(/^@/, "")}` : null,
    `💳 Payment: ${normalizedMethod}`,
    `${statusView.icon} Status: ${statusView.label}`,
    paymentReference ? `🔗 Ref: <code>${paymentReference}</code>` : null,
    productAccount ? `🔑 Account: ${productAccount}` : null,
    `💵 Total: $${Number(totalUsd || 0).toFixed(2)} USD`,
    visitorIp ? `🌐 IP: <code>${visitorIp}</code>` : null,
    userAgent ? `💻 Device: ${String(userAgent).substring(0, 80)}` : null,
    "",
    "📦 <b>Items</b>",
    itemLines
  ]
    .filter(Boolean)
    .join("\n");
}

export function adminChatIds(env) {
  return [
    env.TELEGRAM_ADMIN_CHAT_ID,
    env.TELEGRAM_SECOND_ADMIN_CHAT_ID
  ].filter((id, index, arr) => id && arr.indexOf(id) === index);
}

export async function notifyOrderTelegram(env, message) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const bot = String(env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "");
  const owner = String(env.TELEGRAM_OWNER_USERNAME || "Glock7money").replace(/^@/, "");
  const channelUsername = String(env.TELEGRAM_CHANNEL_USERNAME || "").replace(/^@/, "");
  const email = String(env.SUPPORT_EMAIL || "contact@dvtechnologies.xyz").trim().toLowerCase();
  const store = String(env.STORE_URL || "https://dtdpaymentsbot.pages.dev").replace(/\/$/, "");
  const company = String(env.COMPANY_URL || "https://dvtechnologies.xyz").replace(/\/$/, "");
  const linksFooter = [
    "",
    "✨ <b>Official links</b>",
    `🤖 Telegram buy: @${bot}`,
    `🛒 Web store: ${store}`,
    channelUsername ? `📢 Channel: @${channelUsername}` : null,
    `🏢 DV Tech: ${company}`,
    `📧 Email: ${email}`,
    `👤 Support: @${owner}`
  ]
    .filter(Boolean)
    .join("\n");
  const fullMessage = String(message || "").includes("Official links")
    ? message
    : `${message}${linksFooter}`;

  // Order PII (email, IP, refs) goes to admins only — never dump onto public channels.
  const admins = adminChatIds(env);
  for (const adminId of admins) {
    await sendTelegram(env, adminId, fullMessage);
  }

  const publicOrders = ["1", "true", "yes", "on"].includes(
    String(env.TELEGRAM_ORDER_CHANNEL_PUBLIC || "").trim().toLowerCase()
  );
  if (publicOrders) {
    const channelIds = [
      env.TELEGRAM_CHANNEL_ID,
      env.TELEGRAM_BACKUP_CHANNEL_ID,
      env.TELEGRAM_GROUP_ID
    ].filter((id, index, arr) => id && arr.indexOf(id) === index);
    for (const channelId of channelIds) {
      await sendTelegram(env, channelId, fullMessage);
    }
  }
}

// Map a raw Paystack transaction status to a simple, user-facing payment state.
// Returns one of: "complete", "failed", "not_finished", "unknown".
export function paystackStatusToState(status) {
  const value = String(status || "").toLowerCase();
  if (value === "success") return "complete";
  if (value === "failed" || value === "reversed") return "failed";
  if (["abandoned", "ongoing", "pending", "processing", "queued", "send_otp", "open"].includes(value)) {
    return "not_finished";
  }
  return "unknown";
}

// Map a stored orders.payment_status column to a simple state + label + icon.
export function paymentStatusView(paymentStatus) {
  const value = String(paymentStatus || "pending").toLowerCase();
  switch (value) {
    case "paid":
      return { state: "complete", icon: "✅", label: "Complete (paid)" };
    case "failed":
      return { state: "failed", icon: "❌", label: "Failed" };
    case "refunded":
      return { state: "refunded", icon: "↩️", label: "Refunded" };
    case "pending":
    default:
      return { state: "not_finished", icon: "⏳", label: "Awaiting payment confirmation" };
  }
}

// Verify a Paystack transaction by reference. Never throws.
export async function verifyPaystackPayment(env, reference) {
  const secret = env.PAYSTACK_SECRET_KEY;
  if (!secret) return { ok: false, reason: "no_secret" };
  const ref = String(reference || "").trim();
  if (!ref) return { ok: false, reason: "no_reference" };

  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(ref)}`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );
    const payload = await response.json();
    if (!response.ok || !payload.status) {
      return { ok: false, reason: "verify_failed", message: payload.message || "Verification failed." };
    }
    const data = payload.data || {};
    return {
      ok: true,
      state: paystackStatusToState(data.status),
      rawStatus: data.status,
      paid: data.status === "success",
      amount: Number(data.amount || 0) / 100,
      currency: data.currency || "",
      paidAt: data.paid_at || data.paidAt || null,
      channel: data.channel || "",
      reference: data.reference || ref
    };
  } catch (error) {
    return { ok: false, reason: "network", message: String(error?.message || error) };
  }
}

// Update an order's payment / contact fields using the service-role client (bypasses RLS).
export async function updateOrderPayment(env, orderId, fields) {
  const supabase = getSupabase(env);
  if (!supabase) return { ok: false, reason: "no_store" };

  const rich = {};
  if (fields.payment_status) rich.payment_status = fields.payment_status;
  if (fields.payment_reference) rich.payment_reference = fields.payment_reference;
  if (fields.customer_email) {
    rich.customer_email = fields.customer_email;
    rich.customer_phone = fields.customer_email;
  }
  if (fields.customer_phone) rich.customer_phone = fields.customer_phone;
  if (fields.delivery_details) rich.delivery_details = fields.delivery_details;

  if (!Object.keys(rich).length) return { ok: true, updated: 0 };

  let { error } = await supabase.from("orders").update(rich).eq("id", orderId);
  if (!error) return { ok: true, updated: 1 };

  // Older schema fallback (no customer_email / payment_reference columns).
  const legacy = {};
  if (fields.payment_status) legacy.payment_status = fields.payment_status;
  if (fields.customer_email || fields.customer_phone) {
    legacy.customer_phone = fields.customer_email || fields.customer_phone;
  }
  if (fields.delivery_details || fields.payment_reference || fields.customer_email) {
    const { data: existing } = await supabase
      .from("orders")
      .select("delivery_details")
      .eq("id", orderId)
      .maybeSingle();
    const lines = [fields.delivery_details || existing?.delivery_details || ""];
    if (fields.customer_email) lines.push(`Delivery email: ${fields.customer_email}`);
    if (fields.payment_reference) lines.push(`Payment reference: ${fields.payment_reference}`);
    legacy.delivery_details = lines.filter(Boolean).join("\n");
  }

  ({ error } = await supabase.from("orders").update(legacy).eq("id", orderId));
  if (error) return { ok: false, reason: "update_failed", message: error.message };
  return { ok: true, updated: 1 };
}

export function getStoreConfig(env) {
  const botUsername = String(env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "");
  const channelUsername = String(env.TELEGRAM_CHANNEL_USERNAME || "").replace(/^@/, "");
  const ownerUsername = String(env.TELEGRAM_OWNER_USERNAME || "Glock7money").replace(/^@/, "");
  const vendorUsername = String(env.TELEGRAM_VENDOR_USERNAME || ownerUsername).replace(/^@/, "");
  const starsOn =
    Boolean(env.TELEGRAM_BOT_TOKEN) &&
    !["0", "false", "off", "no"].includes(String(env.STARS_ENABLED ?? "true").trim().toLowerCase());
  const telegramReady = Boolean(
    env.TELEGRAM_BOT_TOKEN && (env.TELEGRAM_ADMIN_CHAT_ID || env.TELEGRAM_CHANNEL_ID)
  );

  return {
    paystackPublicKey: env.PAYSTACK_PUBLIC_KEY || "",
    paystackCurrency: env.PAYSTACK_CURRENCY || "KES",
    paystackConversionRate: Number(env.PAYSTACK_CONVERSION_RATE || 129),
    usdtTrc20Address: env.USDT_TRC20_ADDRESS || "",
    usdtNetwork: "TRC20",
    btcAddress: env.BTC_ADDRESS || "",
    btcNetwork: "BTC",
    escrowDepositAddress: String(env.ESCROW_DEPOSIT_ADDRESS || env.USDT_TRC20_ADDRESS || "").trim(),
    storeUrl: env.STORE_URL || "https://dtdpaymentsbot.pages.dev",
    companyUrl: env.COMPANY_URL || "https://dvtechnologies.xyz",
    companyName: env.COMPANY_NAME || "DV Technologies",
    supportEmail: String(env.SUPPORT_EMAIL || "contact@dvtechnologies.xyz").trim().toLowerCase(),
    telegramBotUsername: botUsername,
    telegramBotUrl: botUsername ? `https://t.me/${botUsername}` : "",
    telegramChannelUsername: channelUsername,
    telegramChannelUrl: channelUsername ? `https://t.me/${channelUsername}` : "",
    telegramChannelId: env.TELEGRAM_CHANNEL_ID || "",
    telegramOwnerUsername: ownerUsername,
    telegramOwnerUrl: ownerUsername ? `https://t.me/${ownerUsername}` : "",
    telegramVendorUsername: vendorUsername,
    telegramVendorUrl: vendorUsername ? `https://t.me/${vendorUsername}` : "",
    telegramEnabled: telegramReady,
    whatsappChannelUrl: String(env.WHATSAPP_CHANNEL_URL || "").trim() || null,
    starsEnabled: starsOn,
    starsPerUsd: Number(env.STARS_PER_USD || 75),
    paymentOptions: [
      { id: "USDT", label: "USDT (TRC20)", type: "crypto", asset: "USDT", network: "TRC20" },
      { id: "Bitcoin", label: "Bitcoin (BTC)", type: "crypto", asset: "BTC", network: "BTC" },
      ...(starsOn ? [{ id: "Stars", label: "Telegram Stars ⭐", type: "stars", asset: "XTR" }] : []),
      { id: "Paystack", label: "Card / Bank / Local (USSD · M-Pesa)", type: "paystack" }
    ]
  };
}

export async function sendTelegram(env, chatId, message, options = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return { ok: false, reason: "not_configured" };

  const text = typeof message === "string" ? message : String(message?.text || "");
  if (!text.trim()) return { ok: false, reason: "empty_text" };

  const markup = options.reply_markup || (typeof message === "object" && message?.reply_markup);
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  if (markup) body.reply_markup = markup;

  const post = async (payload) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok && data.ok !== false, status: response.status, data };
  };

  let result = await post(body);
  // If inline keyboard is invalid (e.g. mailto), still deliver the text reply.
  if (!result.ok && body.reply_markup) {
    console.error("Telegram markup rejected, retrying text-only:", result.data?.description || result.status);
    const { reply_markup: _drop, ...plain } = body;
    result = await post(plain);
  }

  if (!result.ok) {
    console.error("Telegram error:", result.data?.description || result.status);
    return { ok: false, reason: "send_failed", detail: result.data?.description };
  }

  return { ok: true, result: result.data?.result || null };
}

export async function insertOrder(env, orderPayload, items) {
  const supabaseAdmin = getSupabase(env);
  if (!supabaseAdmin) {
    throw new Error("Supabase is not configured.");
  }

  const preferredMethod = dbPaymentMethod(orderPayload.payment_method);
  const email = orderPayload.customer_email || orderPayload.customer_phone || null;
  const deliveryDetails = [
    orderPayload.delivery_details || "",
    email ? `Email: ${email}` : null,
    orderPayload.payment_reference ? `Payment reference: ${orderPayload.payment_reference}` : null,
    orderPayload.product_account ? `Product account: ${orderPayload.product_account}` : null
  ]
    .filter(Boolean)
    .join("\n");

  const rpcItems = items.map((item) => ({
    product_id: item.product_id || "",
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price_usd: item.unit_price_usd
  }));

  const { data: rpcOrderId, error: rpcError } = await supabaseAdmin.rpc("create_store_order", {
    p_customer_name: orderPayload.customer_name,
    p_customer_phone: email,
    p_telegram_username: orderPayload.telegram_username || null,
    p_delivery_details: deliveryDetails || "Ordered via store",
    p_payment_method: preferredMethod,
    p_total_usd: Number(orderPayload.total_usd || 0),
    p_items: rpcItems
  });

  if (!rpcError && rpcOrderId) {
    // Best-effort attach reference / email columns when migration is applied.
    await updateOrderPayment(env, rpcOrderId, {
      payment_reference: orderPayload.payment_reference || null,
      payment_status: orderPayload.payment_status || "pending",
      customer_email: email
    });
    return rpcOrderId;
  }

  // Direct insert with progressive payloads for older/newer schemas.
  const methodFallbacks = [...new Set([preferredMethod, "Card", "M-Pesa", "Crypto"])];
  const payloadVariants = [];
  for (const payment_method of methodFallbacks) {
    payloadVariants.push({
      customer_name: orderPayload.customer_name,
      customer_phone: email,
      customer_email: email,
      telegram_username: orderPayload.telegram_username || null,
      delivery_details: deliveryDetails || "Ordered via store",
      payment_method,
      payment_status: orderPayload.payment_status || "pending",
      payment_reference: orderPayload.payment_reference || null,
      product_account: orderPayload.product_account || null,
      total_usd: Number(orderPayload.total_usd || 0)
    });
    payloadVariants.push({
      customer_name: orderPayload.customer_name,
      customer_phone: email,
      telegram_username: orderPayload.telegram_username || null,
      delivery_details: deliveryDetails || "Ordered via store",
      payment_method,
      payment_status: orderPayload.payment_status || "pending",
      total_usd: Number(orderPayload.total_usd || 0)
    });
  }

  let order = null;
  let lastError = rpcError;

  for (const payload of payloadVariants) {
    const { data, error } = await supabaseAdmin.from("orders").insert(payload).select("id").single();
    if (!error && data) {
      order = data;
      break;
    }
    lastError = error;
  }

  if (!order) {
    const message = lastError?.message || "Order insert failed";
    console.error("Order insert failed:", message, { rpcError, lastError });
    throw new Error(message);
  }

  const cleanedItems = items.map((item) => ({
    order_id: order.id,
    product_id:
      item.product_id && String(item.product_id).match(/^[0-9a-f-]{36}$/i) ? item.product_id : null,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price_usd: item.unit_price_usd
  }));

  const { error: itemsError } = await supabaseAdmin.from("order_items").insert(cleanedItems);
  if (itemsError) console.error("order_items insert failed:", itemsError.message);

  return order.id;
}
