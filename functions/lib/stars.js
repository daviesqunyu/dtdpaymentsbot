/**
 * Telegram Stars (XTR) payments for digital goods — Mini App + bot invoices.
 * Earnings: Stars balance → Fragment withdraw (TON) or Telegram Ads (Buy Ads).
 */

import { insertOrder, updateOrderPayment, getSupabase, adminChatIds } from "./store.js";
import { PX, premiumDivider, premiumHeader } from "./tg-premium.js";

async function saveDeliverySession(env, userId, orderId, starsAmount) {
  const supabase = getSupabase(env);
  if (!supabase || !userId || !orderId) return;
  await supabase.from("bot_checkout_sessions").upsert(
    {
      telegram_user_id: String(userId),
      method: "Stars",
      step: "await_delivery_email",
      order_id: orderId,
      price_usd: null,
      product_name: "Stars order",
      pay_key: String(starsAmount || ""),
      updated_at: new Date().toISOString()
    },
    { onConflict: "telegram_user_id" }
  );
}

const ID_RE = /^[a-zA-Z0-9_-]{6,32}$/;

export function starsEnabled(env) {
  const raw = String(env.STARS_ENABLED ?? "true").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  return Boolean(env.TELEGRAM_BOT_TOKEN);
}

/** Approx Stars for a USD amount. Override with STARS_PER_USD (default ~75 ≈ $0.013/★). */
export function usdToStars(env, usd) {
  const rate = Number(env.STARS_PER_USD || 75);
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 75;
  return Math.max(1, Math.ceil(Number(usd || 0) * safeRate));
}

export function starsPerUsd(env) {
  const rate = Number(env.STARS_PER_USD || 75);
  return Number.isFinite(rate) && rate > 0 ? rate : 75;
}

function shortId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

async function telegramApi(env, method, body) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: "missing_token" };
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  return response.json().catch(() => ({ ok: false }));
}

export async function saveStarsInvoice(env, row) {
  const supabase = getSupabase(env);
  if (!supabase) return { ok: false, reason: "no_db" };
  const { error } = await supabase.from("stars_invoices").upsert(row, { onConflict: "id" });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function loadStarsInvoice(env, id) {
  const supabase = getSupabase(env);
  if (!supabase || !id) return null;
  const { data, error } = await supabase.from("stars_invoices").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function markStarsInvoice(env, id, patch) {
  const supabase = getSupabase(env);
  if (!supabase) return { ok: false };
  const { error } = await supabase
    .from("stars_invoices")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  return { ok: !error, error: error?.message };
}

/**
 * Create a Stars invoice link for Mini App openInvoice / bot sendInvoice.
 * payload is short id stored in stars_invoices (Telegram limit 128 bytes).
 */
export async function createStarsCheckout(env, {
  kind = "miniapp",
  telegramUserId,
  customerName,
  customerEmail,
  telegramUsername,
  items = [],
  totalUsd,
  productId,
  productName,
  chatId
} = {}) {
  if (!starsEnabled(env)) return { ok: false, error: "Stars payments are disabled." };

  const total = Number(totalUsd || 0);
  if (!(total > 0) && !items.length) return { ok: false, error: "Cart is empty." };

  const amountUsd =
    total > 0
      ? total
      : items.reduce((sum, item) => sum + Number(item.unit_price_usd || 0) * Number(item.quantity || 1), 0);
  const stars = usdToStars(env, amountUsd);
  const id = shortId();
  const title = productName
    ? String(productName).slice(0, 32)
    : items.length === 1
      ? String(items[0].product_name || "DTD product").slice(0, 32)
      : "DTD Store order";
  const description = `DTD digital delivery · $${amountUsd.toFixed(2)} USD · ${stars} Stars`.slice(0, 255);

  const saved = await saveStarsInvoice(env, {
    id,
    kind,
    status: "pending",
    telegram_user_id: telegramUserId ? String(telegramUserId) : null,
    customer_name: customerName || null,
    customer_email: customerEmail || null,
    telegram_username: telegramUsername || null,
    product_id: productId || null,
    product_name: productName || null,
    items_json: items,
    total_usd: amountUsd,
    stars_amount: stars,
    chat_id: chatId ? String(chatId) : null
  });

  if (!saved.ok) {
    return {
      ok: false,
      error:
        saved.reason === "no_db"
          ? "Database unavailable for Stars checkout. Run supabase-secretary-earn.sql."
          : `Could not save Stars invoice: ${saved.reason}`
    };
  }

  const prices = [{ label: title, amount: stars }];
  const invoiceBody = {
    title,
    description,
    payload: id,
    provider_token: "",
    currency: "XTR",
    prices
  };

  if (kind === "bot" && chatId) {
    const sent = await telegramApi(env, "sendInvoice", {
      chat_id: chatId,
      ...invoiceBody
    });
    if (!sent.ok) {
      await markStarsInvoice(env, id, { status: "failed", error: sent.description || "send_failed" });
      return { ok: false, error: sent.description || "Could not send Stars invoice." };
    }
    return { ok: true, id, stars, amountUsd, message_id: sent.result?.message_id };
  }

  const link = await telegramApi(env, "createInvoiceLink", invoiceBody);
  if (!link.ok || !link.result) {
    await markStarsInvoice(env, id, { status: "failed", error: link.description || "link_failed" });
    return { ok: false, error: link.description || "Could not create Stars invoice link." };
  }

  return { ok: true, id, stars, amountUsd, invoice_url: link.result };
}

export async function answerStarsPreCheckout(env, query) {
  const payload = String(query?.invoice_payload || "").trim();
  if (!ID_RE.test(payload)) {
    await telegramApi(env, "answerPreCheckoutQuery", {
      pre_checkout_query_id: query.id,
      ok: false,
      error_message: "Invalid invoice. Open /buy or the Mini App and try again."
    });
    return { ok: false };
  }

  const row = await loadStarsInvoice(env, payload);
  if (!row || row.status === "paid") {
    await telegramApi(env, "answerPreCheckoutQuery", {
      pre_checkout_query_id: query.id,
      ok: false,
      error_message: row?.status === "paid" ? "This invoice was already paid." : "Invoice expired. Create a new checkout."
    });
    return { ok: false };
  }

  const currency = String(query.currency || "");
  const totalAmount = Number(query.total_amount || 0);
  if (currency !== "XTR" || totalAmount !== Number(row.stars_amount)) {
    await telegramApi(env, "answerPreCheckoutQuery", {
      pre_checkout_query_id: query.id,
      ok: false,
      error_message: "Amount mismatch. Please create a new Stars invoice."
    });
    return { ok: false };
  }

  await telegramApi(env, "answerPreCheckoutQuery", {
    pre_checkout_query_id: query.id,
    ok: true
  });
  return { ok: true, invoice: row };
}

export async function handleStarsSuccessfulPayment(env, message, deps) {
  const payment = message?.successful_payment;
  if (!payment || payment.currency !== "XTR") return { handled: false };

  const id = String(payment.invoice_payload || "").trim();
  const row = await loadStarsInvoice(env, id);
  if (!row) {
    await deps.sendTelegram(
      env,
      message.chat.id,
      `${PX.warn} Payment received but invoice record was missing. Message support with charge id:\n<code>${esc(
        payment.telegram_payment_charge_id
      )}</code>`
    );
    return { handled: true };
  }

  if (row.status === "paid" && row.order_id) {
    await deps.sendTelegram(
      env,
      message.chat.id,
      [
        `${PX.check} <b>Already recorded</b>`,
        `Order: <code>${esc(row.order_id)}</code>`,
        "Send your delivery email if you have not yet."
      ].join("\n")
    );
    return { handled: true, orderId: row.order_id };
  }

  const from = message.from || {};
  const items = Array.isArray(row.items_json) && row.items_json.length
    ? row.items_json
    : [
        {
          product_id: row.product_id || "stars",
          product_name: row.product_name || "DTD Stars purchase",
          quantity: 1,
          unit_price_usd: Number(row.total_usd || 0)
        }
      ];

  let orderId = row.order_id;
  if (!orderId) {
    try {
      const created = await insertOrder(
        env,
        {
          customer_name: row.customer_name || from.first_name || "Telegram buyer",
          customer_email: row.customer_email || `tg${from.id}@stars.dtdpaymentsbot.pages.dev`,
          customer_phone: row.customer_email || null,
          telegram_username: row.telegram_username || from.username || null,
          payment_method: "Stars",
          payment_status: "paid",
          payment_reference: payment.telegram_payment_charge_id,
          total_usd: Number(row.total_usd || 0),
          delivery_details: `Paid with Telegram Stars (${row.stars_amount} ★)\nInvoice: ${id}`
        },
        items
      );
      orderId = typeof created === "string" ? created : created?.id || created?.order?.id || null;
    } catch (error) {
      await deps.sendTelegram(
        env,
        message.chat.id,
        `${PX.warn} Stars payment OK but order save failed: ${esc(error.message)}\nCharge: <code>${esc(
          payment.telegram_payment_charge_id
        )}</code>`
      );
      return { handled: true };
    }
  } else {
    await updateOrderPayment(env, orderId, {
      payment_method: "Stars",
      payment_status: "paid",
      payment_reference: payment.telegram_payment_charge_id
    });
  }

  await markStarsInvoice(env, id, {
    status: "paid",
    order_id: orderId,
    charge_id: payment.telegram_payment_charge_id
  });

  await saveDeliverySession(env, from.id, orderId, payment.total_amount);

  const starsAdminNote = [
    `${PX.star} <b>STARS PAID — deliver now</b>`,
    orderId ? `Order: <code>${esc(orderId)}</code>` : null,
    `User: @${esc(from.username || from.id)}`,
    `Stars: <b>${esc(String(payment.total_amount))}</b>`,
    `Charge: <code>${esc(payment.telegram_payment_charge_id)}</code>`,
    "",
    "Buyer will send delivery email next.",
    orderId ? `Mark done: /paid ${orderId}` : null
  ]
    .filter(Boolean)
    .join("\n");
  for (const adminId of adminChatIds(env)) {
    await deps.sendTelegram(env, adminId, starsAdminNote);
  }

  await deps.sendTelegram(
    env,
    message.chat.id,
    [
      `${PX.star} <b>Stars payment confirmed</b>`,
      premiumDivider(),
      orderId ? `${PX.package} Order: <code>${esc(orderId)}</code>` : null,
      `${PX.money} Paid: <b>${esc(String(payment.total_amount))} Stars</b>`,
      "",
      `${PX.inbox} Reply with your <b>delivery email</b> now (example: <code>you@gmail.com</code>).`
    ]
      .filter(Boolean)
      .join("\n")
  );

  return { handled: true, orderId, invoiceId: id };
}

export function earnHelpMessage(env) {
  const bot = String(env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "");
  const store = String(env.STORE_URL || "https://dtdpaymentsbot.pages.dev").replace(/\/$/, "");
  return [
    premiumHeader("Earn with DTD + Telegram", PX.star),
    premiumDivider(),
    `${PX.gem} <b>1) Sell with Telegram Stars</b>`,
    "Customers pay inside Telegram (Mini App / bot).",
    "Stars land on your bot balance automatically.",
    "",
    `${PX.rocket} <b>2) Convert Stars → ads or cash</b>`,
    "• Open your bot in Telegram → <b>Balance / Monetization</b>",
    "• <b>Buy Ads</b> — promote @DTD + store (often best ROI)",
    "• Or withdraw to <b>TON via Fragment</b> (holding rules apply)",
    "",
    `${PX.fire} <b>3) Referral link</b>`,
    `Share: <code>https://t.me/${bot}?start=ref_YOURID</code>`,
    "Get /refer for your personal link. We track referred buyers.",
    "",
    `${PX.channel} Channel boosts + promo posts drive traffic.`,
    `${PX.cart} Store: ${store}`,
    "",
    "Tip jar: /tip · Pay support: /paysupport · Terms: /terms"
  ].join("\n");
}

function esc(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
