/**
 * In-bot shop: browse active products and pay via USDT (TRC20), BTC, or Paystack.
 */

import {
  buildOrderTelegramMessage,
  insertOrder,
  notifyOrderTelegram,
  updateOrderPayment,
  verifyPaystackPayment
} from "./store.js";
import {
  PX,
  colorDot,
  colorPaletteLine,
  numberEmoji,
  premiumBanner,
  premiumDivider,
  premiumHeader,
  premiumSteps,
  reactToMessage
} from "./tg-premium.js";
import { createStarsCheckout, starsEnabled, usdToStars } from "./stars.js";
import { blue, green, red, productStyle, styled } from "./tg-buttons.js";

const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const EMAIL_RE = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i;
const TX_RE = /^[a-fA-F0-9]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const memorySessions = new Map();

function productIdOrEmpty(id) {
  return UUID_RE.test(String(id || "")) ? String(id) : "";
}

/** Accept Gmail and any normal provider. Fix common typos. */
function normalizeEmail(raw) {
  let value = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^email\s*[:=]?\s*/i, "")
    .replace(/^mailto:/i, "")
    .replace(/[<>\s]/g, "");

  // user typed "name@gmail" without .com
  if (/^[a-z0-9._%+\-]+@gmail$/i.test(value)) value = `${value}.com`;
  if (/^[a-z0-9._%+\-]+@yahoo$/i.test(value)) value = `${value}.com`;
  if (/^[a-z0-9._%+\-]+@outlook$/i.test(value)) value = `${value}.com`;
  if (/^[a-z0-9._%+\-]+@hotmail$/i.test(value)) value = `${value}.com`;

  return value;
}

function isValidEmail(value) {
  return EMAIL_RE.test(String(value || ""));
}

function checkoutEmailForUser(user) {
  // Placeholder for Paystack initialize only — real delivery email collected after pay.
  return `tg${user.id}@buy.dtdpaymentsbot.pages.dev`;
}

function deliveryEmailPrompt(orderId) {
  return [
    premiumDivider(),
    `${PX.inbox} <b>Final step — delivery email</b>`,
    "Reply with the inbox where we should send your product.",
    `Example: <code>you@gmail.com</code>`,
    "Gmail, Yahoo, Outlook, and other providers are fine.",
    orderId ? `${PX.package} Order: <code>${esc(orderId)}</code>` : null,
    premiumDivider()
  ]
    .filter(Boolean)
    .join("\n");
}

function esc(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function storeUrl(env) {
  return String(env.STORE_URL || "https://dtdpaymentsbot.pages.dev").replace(/\/$/, "");
}

function companyUrl(env) {
  return String(env.COMPANY_URL || "https://dvtechnologies.xyz").replace(/\/$/, "");
}

function ownerHandle(env) {
  return String(env.TELEGRAM_OWNER_USERNAME || "Davetheedev").replace(/^@/, "");
}

function supportEmail(env) {
  return String(env.SUPPORT_EMAIL || "contact@dvtechnologies.xyz").trim().toLowerCase();
}

function botHandle(env) {
  return String(env.TELEGRAM_BOT_USERNAME || "Dtdpaymentbot").replace(/^@/, "");
}

/** Title-case ALL CAPS names for cleaner menus (display only). */
function displayName(name) {
  const raw = String(name || "Product").trim().replace(/\s+/g, " ");
  if (!raw) return "Product";
  const letters = raw.replace(/[^A-Za-z]/g, "");
  const mostlyUpper = letters.length >= 3 && letters === letters.toUpperCase();
  if (!mostlyUpper) return raw;
  return raw
    .toLowerCase()
    .split(" ")
    .map((word) => {
      if (!word) return word;
      if (/^(gpt|btc|sms|api|ussd|vpn|seo|ai|att)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function displayDescription(description, max = 110) {
  let value = String(description || "")
    .replace(/\r/g, "")
    .replace(/[💵💸💰]+/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "Digital product from DTD Store.";
  if (value.length > max) value = `${value.slice(0, max - 1).trim()}…`;
  return value;
}

function section(title, lines) {
  return [`<b>${title}</b>`, ...lines].join("\n");
}

function money(usd) {
  return `$${Number(usd || 0).toFixed(2)}`;
}

function truncateLabel(name, max = 26) {
  const value = displayName(name);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function footerLinksKeyboard(env) {
  return officialLinksKeyboardRows(env);
}

function officialLinksBlock(env) {
  const bot = botHandle(env);
  const owner = ownerHandle(env);
  const email = supportEmail(env);
  const store = storeUrl(env);
  const company = companyUrl(env);
  const channel = String(env.TELEGRAM_CHANNEL_USERNAME || "DTDMAINSTORE").replace(/^@/, "");
  return [
    `${PX.bot} Pay / Mini App: @${bot}`,
    `${PX.cart} Web: ${store}`,
    `${PX.channel} Channel: @${channel}`,
    `${PX.company} DV Tech: ${company}`,
    `${PX.mail} Email: ${email}`,
    `${PX.support} Support: @${owner}`
  ].join("\n");
}

function officialLinksKeyboardRows(env) {
  const bot = botHandle(env);
  const owner = ownerHandle(env);
  const store = storeUrl(env);
  const company = companyUrl(env);
  // Telegram inline URL buttons only accept http/https/tg:// — never mailto:
  return [
    [
      blue({ text: "🌐 Website", url: store }),
      blue({ text: "🎧 Support", url: `https://t.me/${owner}` })
    ],
    [
      green({ text: "🏢 DV Tech", url: company }),
      green({ text: `🤖 @${bot}`, url: `https://t.me/${bot}?start=buy` })
    ]
  ];
}

function btcAddress(env) {
  return String(env.BTC_ADDRESS || "").trim();
}

function usdtAddress(env) {
  return String(env.USDT_TRC20_ADDRESS || "").trim();
}

async function telegramApi(env, method, body) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: "missing_token" };
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  return response.json();
}

export async function loadShopProducts(env, getSupabase) {
  const fallback = [
    {
      id: "fallback-1",
      name: "Automation Bot Builder",
      price_usd: 49,
      description: "Custom Telegram workflow bots with order alerts and admin handoff."
    },
    {
      id: "fallback-2",
      name: "Customer Support Bot",
      price_usd: 79,
      description: "FAQ replies, ticket intake, and seamless handoff to a human agent."
    },
    {
      id: "fallback-3",
      name: "Analytics Dashboard Kit",
      price_usd: 129,
      description: "Sales, traffic, and order tracking dashboard for your store ops."
    }
  ];

  try {
    const supabase = getSupabase(env);
    if (!supabase) return fallback;
    const { data, error } = await supabase
      .from("products")
      .select("id,name,description,price_usd,active")
      .eq("active", true)
      .order("price_usd", { ascending: true })
      .limit(20);
    if (error || !data?.length) return fallback;
    return data;
  } catch {
    return fallback;
  }
}

async function getProduct(env, getSupabase, productId) {
  const products = await loadShopProducts(env, getSupabase);
  return products.find((p) => String(p.id) === String(productId)) || null;
}

async function saveSession(env, getSupabase, userId, session) {
  const key = String(userId);
  const payload = { ...session, updated_at: Date.now() };
  memorySessions.set(key, payload);

  const supabase = getSupabase(env);
  if (!supabase) return;
  try {
    await supabase.from("bot_checkout_sessions").upsert({
      telegram_user_id: key,
      product_id: session.product_id || null,
      product_name: session.product_name || null,
      price_usd: session.price_usd || null,
      method: session.method || null,
      step: session.step || null,
      email: session.email || null,
      order_id: session.order_id || null,
      pay_key: session.pay_key || null,
      updated_at: new Date().toISOString()
    });
  } catch {
    /* table may not exist yet — memory still works on warm isolates */
  }
}

async function loadSession(env, getSupabase, userId) {
  const key = String(userId);
  if (memorySessions.has(key)) return memorySessions.get(key);

  const supabase = getSupabase(env);
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from("bot_checkout_sessions")
      .select("*")
      .eq("telegram_user_id", key)
      .maybeSingle();
    if (!data) return null;
    const session = {
      product_id: data.product_id,
      product_name: data.product_name,
      price_usd: Number(data.price_usd || 0),
      method: data.method,
      step: data.step,
      email: data.email,
      order_id: data.order_id,
      pay_key: data.pay_key,
      updated_at: Date.parse(data.updated_at) || Date.now()
    };
    memorySessions.set(key, session);
    return session;
  } catch {
    return null;
  }
}

async function clearSession(env, getSupabase, userId) {
  const key = String(userId);
  memorySessions.delete(key);
  const supabase = getSupabase(env);
  if (!supabase) return;
  try {
    await supabase.from("bot_checkout_sessions").delete().eq("telegram_user_id", key);
  } catch {
    /* ignore */
  }
}

async function fetchBtcAmount(usd) {
  let rate = 65000;
  try {
    const response = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
    if (response.ok) {
      const payload = await response.json();
      const price = Number(payload?.data?.amount);
      if (price > 0) rate = price;
    }
  } catch {
    /* keep fallback */
  }
  const amount = Number(usd) / rate;
  return { rate, amount: amount.toFixed(8) };
}

async function verifyUsdtTrc20Payment({ hash, address, minAmount }) {
  const cleanHash = String(hash || "").trim();
  const to = String(address || "").trim();
  const need = Number(minAmount || 0);
  if (!cleanHash || !to) return { ok: false, reason: "missing" };

  try {
    const response = await fetch(
      `https://api.trongrid.io/v1/accounts/${encodeURIComponent(to)}/transactions/trc20?limit=80&only_to=true`,
      { headers: { Accept: "application/json" } }
    );
    if (!response.ok) return { ok: false, reason: "network" };
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const tx = rows.find((row) => String(row.transaction_id || "").toLowerCase() === cleanHash.toLowerCase());
    if (!tx) return { ok: false, reason: "not_found" };

    const contract = String(tx.token_info?.address || tx.token_info?.tokenId || "");
    if (contract && contract !== USDT_TRC20_CONTRACT) {
      return { ok: false, reason: "wrong_token" };
    }

    const decimals = Number(tx.token_info?.decimals ?? 6);
    const amount = Number(tx.value || 0) / 10 ** decimals;
    if (!(amount + 0.01 >= need)) {
      return { ok: false, reason: "amount_low", amount };
    }
    return { ok: true, amount, asset: "USDT" };
  } catch (error) {
    return { ok: false, reason: "network", message: String(error?.message || error) };
  }
}

async function verifyBtcOnChainPayment({ hash, address, minAmount }) {
  const cleanHash = String(hash || "").trim();
  const to = String(address || "").trim();
  const need = Number(minAmount || 0);
  if (!cleanHash || !to) return { ok: false, reason: "missing" };

  try {
    const response = await fetch(`https://blockstream.info/api/tx/${encodeURIComponent(cleanHash)}`);
    if (response.status === 404) return { ok: false, reason: "not_found" };
    if (!response.ok) return { ok: false, reason: "network" };
    const tx = await response.json();
    const paidSats = (tx.vout || [])
      .filter((out) => out.scriptpubkey_address === to)
      .reduce((sum, out) => sum + Number(out.value || 0), 0);
    const amount = paidSats / 1e8;
    if (!(amount + 1e-8 >= need * 0.98)) {
      return { ok: false, reason: "amount_low", amount };
    }
    return {
      ok: true,
      amount,
      asset: "BTC",
      confirmed: Boolean(tx.status?.confirmed)
    };
  } catch (error) {
    return { ok: false, reason: "network", message: String(error?.message || error) };
  }
}

async function confirmPaystackOrder(env, { orderId, reference }) {
  const check = await verifyPaystackPayment(env, reference);
  if (!check.ok) {
    return { ok: false, reason: check.reason || "verify_failed", message: check.message };
  }
  if (check.state === "complete" || check.paid) {
    if (orderId) {
      await updateOrderPayment(env, orderId, {
        payment_reference: reference,
        payment_status: "paid"
      });
    }
    return { ok: true, paid: true, check };
  }
  if (check.state === "failed") {
    if (orderId) {
      await updateOrderPayment(env, orderId, {
        payment_reference: reference,
        payment_status: "failed"
      });
    }
    return { ok: false, reason: "failed", check };
  }
  return { ok: false, reason: "not_finished", check };
}

function shopMenuKeyboard(products, env) {
  const rows = [
    [
      blue({
        text: "🛍 Products",
        web_app: { url: `${storeUrl(env)}/?utm_source=telegram_miniapp#products` }
      }),
      blue({ text: "🔄 Refresh", callback_data: "shop:menu" })
    ]
  ];
  products.forEach((product, i) => {
    const price = `$${Number(product.price_usd || 0).toFixed(0)}`;
    rows.push([
      styled(
        {
          text: `${truncateLabel(product.name, 22)} · ${price}`,
          callback_data: `shop:p:${product.id}`
        },
        productStyle(i)
      )
    ]);
  });
  rows.push(
    [
      green({
        text: "🛒 Checkout",
        web_app: { url: `${storeUrl(env)}/?utm_source=telegram_miniapp#checkout` }
      }),
      green({
        text: "📦 Track",
        web_app: { url: `${storeUrl(env)}/?utm_source=telegram_miniapp#track` }
      })
    ],
    [red({ text: "‼️ Home /start", callback_data: "shop:home" })]
  );
  rows.push(...footerLinksKeyboard(env));
  return { inline_keyboard: rows };
}

function productPayKeyboard(productId, env) {
  const rows = [
    [blue({ text: "₮ USDT (TRC20) · Preferred", callback_data: `shop:pay:${productId}:usdt` })],
    [green({ text: "₿ Bitcoin", callback_data: `shop:pay:${productId}:btc` })]
  ];
  if (starsEnabled(env)) {
    rows.push([blue({ text: "⭐ Telegram Stars", callback_data: `shop:pay:${productId}:stars` })]);
  }
  rows.push(
    [
      green({ text: "💳 Card", callback_data: `shop:pay:${productId}:card` }),
      green({ text: "📱 M-Pesa", callback_data: `shop:pay:${productId}:momo` })
    ],
    [
      blue({ text: "🔢 USSD", callback_data: `shop:pay:${productId}:ussd` }),
      blue({ text: "🏦 Bank", callback_data: `shop:pay:${productId}:bank` })
    ],
    [red({ text: "‼️ Back to catalog", callback_data: "shop:menu" })]
  );
  return { inline_keyboard: rows };
}

function paymentSummary(env) {
  const currency = env.PAYSTACK_CURRENCY || "KES";
  const usdt = usdtAddress(env);
  const btc = btcAddress(env);
  return [
    section("Payments", [
      usdt
        ? "₮ USDT (TRC20) → DTD wallet + QR at checkout (preferred)"
        : "₮ USDT (TRC20) → not configured yet",
      btc ? "₿ Bitcoin → DTD BTC wallet + QR at checkout" : "₿ Bitcoin → not configured yet",
      starsEnabled(env)
        ? `⭐ Telegram Stars → ~${usdToStars(env, 1)} ★ per $1 (instant in-app)`
        : null,
      `Card · M-Pesa · USSD · Bank → Paystack (${currency})`
    ].filter(Boolean))
  ].join("\n");
}

function productDetailMessage(product, env) {
  const kesRate = Number(env.PAYSTACK_CONVERSION_RATE || 129);
  const kes = Math.round(Number(product.price_usd || 0) * kesRate);
  const title = displayName(product.name);
  const desc = displayDescription(product.description, 180);
  return {
    text: [
      premiumHeader("Checkout", PX.cart),
      premiumDivider(),
      `<b>${esc(title)}</b>`,
      esc(desc),
      "",
      section("Price", [
        `${money(product.price_usd)} USD`,
        `≈ ${kes.toLocaleString()} ${esc(env.PAYSTACK_CURRENCY || "KES")} via Paystack`
      ]),
      "",
      paymentSummary(env),
      "",
      `${PX.gem} <b>Choose a payment method</b>`
    ].join("\n"),
    reply_markup: productPayKeyboard(product.id, env)
  };
}

function paystackPromptKeyboard(productId) {
  return {
    inline_keyboard: [
      [{ text: `${PX.bolt} Change payment method`, callback_data: `shop:p:${productId}` }],
      [{ text: `${PX.bag} Back to catalog`, callback_data: "shop:menu" }]
    ]
  };
}

function backToProductKeyboard(productId) {
  return paystackPromptKeyboard(productId);
}

export function buildShopCatalogMessage(products, env) {
  const catalogLines = products.length
    ? products.map((p, i) => {
        const title = displayName(p.name);
        const desc = displayDescription(p.description, 90);
        const price = money(p.price_usd);
        return [
          `${colorDot(i)} <b>${esc(title)}</b>`,
          `   ${PX.money} <code>${price}</code> USD`,
          desc ? `   <i>${esc(desc)}</i>` : null,
          "   ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄"
        ]
          .filter(Boolean)
          .join("\n");
      })
    : [`${PX.warn} No active products right now. Try again soon.`];

  return {
    text: [
      `${PX.crown} <b>DTD · PRODUCTS</b>`,
      premiumDivider(),
      `<blockquote>Blue / green / red buttons — tap a product row to checkout</blockquote>`,
      "",
      `${PX.live} <b>${products.length}</b> live · USD`,
      "",
      ...catalogLines,
      "",
      `🛍 Open catalog = Mini App · or tap a product button below`
    ].join("\n"),
    reply_markup: shopMenuKeyboard(products, env)
  };
}

const PAYSTACK_METHOD_MAP = {
  card: {
    channels: ["card"],
    label: "Card",
    emoji: "💳",
    promptTitle: "Card payment",
    how: [
      "Open the secure Paystack page.",
      "Pay by debit or credit card.",
      "Price is shown in USD; you are charged the KES equivalent.",
      "After payment, send your delivery email here."
    ]
  },
  momo: {
    channels: ["mobile_money"],
    label: "M-Pesa",
    emoji: "📱",
    promptTitle: "M-Pesa / mobile money",
    how: [
      "Open the secure Paystack page.",
      "Choose M-Pesa or another mobile-money option.",
      "Approve the prompt on your phone.",
      "After payment, send your delivery email here."
    ]
  },
  ussd: {
    channels: ["ussd"],
    label: "USSD",
    emoji: "🔢",
    promptTitle: "USSD payment",
    how: [
      "Open the secure Paystack page.",
      "Dial the USSD code shown for your bank.",
      "Complete the local KES payment.",
      "After payment, send your delivery email here."
    ]
  },
  bank: {
    channels: ["bank", "bank_transfer"],
    label: "Bank transfer",
    emoji: "🏦",
    promptTitle: "Bank transfer",
    how: [
      "Open the secure Paystack page.",
      "Choose bank / bank transfer.",
      "Complete the local KES transfer.",
      "After payment, send your delivery email here."
    ]
  },
  ps: {
    channels: ["card", "bank", "ussd", "mobile_money"],
    label: "Paystack",
    emoji: "💳",
    promptTitle: "Paystack checkout",
    how: [
      "Open Paystack and pick Card, Bank, USSD, or M-Pesa.",
      "Complete payment on the secure page.",
      "After payment, send your delivery email here."
    ]
  }
};

function buildPaystackMethodPrompt(env, product, payMethod) {
  const kesRate = Number(env.PAYSTACK_CONVERSION_RATE || 129);
  const kes = Math.round(Number(product.price_usd) * kesRate);
  const title = displayName(product.name);
  return [
    `${payMethod.emoji} <b>${esc(payMethod.promptTitle)}</b>`,
    "────────────────",
    `Product: <b>${esc(title)}</b>`,
    `Total: <b>${money(product.price_usd)} USD</b>`,
    `You pay ≈ <b>${kes.toLocaleString()} ${esc(env.PAYSTACK_CURRENCY || "KES")}</b>`,
    "",
    section("Steps", payMethod.how.map((line, i) => `${i + 1}. ${line}`)),
    "",
    "Tap <b>Pay now</b> below. Delivery email comes after payment."
  ].join("\n");
}

async function startPaystackCheckout(env, getSupabase, { product, user, email, channels, methodLabel }) {
  const secret = env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    return { error: "Paystack is not configured on the server." };
  }

  const currency = env.PAYSTACK_CURRENCY || "KES";
  const rate = Number(env.PAYSTACK_CONVERSION_RATE || 129);
  const amount = Math.round(Number(product.price_usd) * rate * 100);
  const reference = `DTD-BOT-${Date.now()}-${String(user.id).slice(-6)}`;
  const store = storeUrl(env);
  const username = user.username ? String(user.username).replace(/^@/, "") : "";
  const channelList = Array.isArray(channels) && channels.length ? channels : undefined;

  const initBody = {
    email,
    amount,
    currency,
    reference,
    callback_url: `${store}/?paid=1&reference=${encodeURIComponent(reference)}`,
    metadata: {
      source: "telegram_bot",
      customer_name: [user.first_name, user.last_name].filter(Boolean).join(" ") || username || "Telegram buyer",
      telegram_user_id: String(user.id),
      telegram_username: username,
      product_id: product.id,
      product_name: product.name,
      amount_usd: product.price_usd,
      pay_method: methodLabel || "Paystack"
    }
  };
  if (channelList) initBody.channels = channelList;

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(initBody)
  });

  const payload = await response.json();
  if (!response.ok || !payload.status) {
    return { error: payload.message || "Could not start Paystack payment." };
  }

  const customerName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || username || "Telegram buyer";

  let orderId = null;
  try {
    orderId = await insertOrder(
      env,
      {
        customer_name: customerName,
        customer_phone: email,
        customer_email: email,
        telegram_username: username || null,
        delivery_details: `Ordered via Telegram bot\nEmail: ${email}\nPayment: ${methodLabel || "Paystack"}`,
        payment_method: "Paystack",
        payment_reference: reference,
        payment_status: "pending",
        total_usd: Number(product.price_usd)
      },
      [
        {
          product_id: productIdOrEmpty(product.id),
          product_name: product.name,
          quantity: 1,
          unit_price_usd: Number(product.price_usd)
        }
      ]
    );
    await updateOrderPayment(env, orderId, {
      payment_reference: reference,
      payment_status: "pending"
    });
  } catch (error) {
    return { error: error.message || "Could not create order." };
  }

  const msg = buildOrderTelegramMessage({
    customerName,
    customerEmail: email,
    telegramUsername: username,
    normalizedMethod: methodLabel || "Paystack",
    paymentReference: reference,
    totalUsd: product.price_usd,
    items: [{ product_name: product.name, quantity: 1 }],
    orderId,
    paymentStatus: "pending"
  });
  await notifyOrderTelegram(env, `${msg}\n\n<i>Started from Telegram bot shop</i>`);

  return {
    orderId,
    reference,
    authorization_url: payload.data.authorization_url,
    currency,
    amountLocal: (amount / 100).toFixed(2),
    methodLabel: methodLabel || "Paystack"
  };
}

async function startUsdtCheckout(env, getSupabase, { product, user }) {
  const address = usdtAddress(env);
  if (!address) return { error: "USDT TRC20 address is not configured." };

  const amount = Number(product.price_usd).toFixed(2);
  const username = user.username ? String(user.username).replace(/^@/, "") : "";
  const customerName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || username || "Telegram buyer";
  const email = username ? `${username}@telegram.user` : `tg${user.id}@telegram.user`;

  let orderId = null;
  try {
    orderId = await insertOrder(
      env,
      {
        customer_name: customerName,
        customer_phone: email,
        customer_email: email,
        telegram_username: username || String(user.id),
        delivery_details: `Ordered via Telegram bot\nPayment: USDT TRC20\nSend ${amount} USDT to ${address}`,
        payment_method: "Crypto",
        payment_status: "pending",
        total_usd: Number(product.price_usd)
      },
      [
        {
          product_id: productIdOrEmpty(product.id),
          product_name: product.name,
          quantity: 1,
          unit_price_usd: Number(product.price_usd)
        }
      ]
    );
  } catch (error) {
    return { error: error.message || "Could not create order." };
  }

  const msg = buildOrderTelegramMessage({
    customerName,
    customerEmail: email,
    telegramUsername: username || String(user.id),
    normalizedMethod: "USDT",
    totalUsd: product.price_usd,
    items: [{ product_name: product.name, quantity: 1 }],
    orderId,
    paymentStatus: "pending"
  });
  await notifyOrderTelegram(env, `${msg}\n\n<i>USDT TRC20 checkout from Telegram bot shop</i>`);

  return { orderId, address, amount };
}

async function startBtcCheckout(env, getSupabase, { product, user }) {
  const address = btcAddress(env);
  if (!address) return { error: "BTC address is not configured." };

  const { rate, amount } = await fetchBtcAmount(product.price_usd);
  const username = user.username ? String(user.username).replace(/^@/, "") : "";
  const customerName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || username || "Telegram buyer";
  const email = username ? `${username}@telegram.user` : `tg${user.id}@telegram.user`;

  let orderId = null;
  try {
    orderId = await insertOrder(
      env,
      {
        customer_name: customerName,
        customer_phone: email,
        customer_email: email,
        telegram_username: username || String(user.id),
        delivery_details: `Ordered via Telegram bot\nPayment: Bitcoin\nSend ${amount} BTC to ${address}`,
        payment_method: "Crypto",
        payment_status: "pending",
        total_usd: Number(product.price_usd)
      },
      [
        {
          product_id: productIdOrEmpty(product.id),
          product_name: product.name,
          quantity: 1,
          unit_price_usd: Number(product.price_usd)
        }
      ]
    );
  } catch (error) {
    return { error: error.message || "Could not create order." };
  }

  const msg = buildOrderTelegramMessage({
    customerName,
    customerEmail: email,
    telegramUsername: username || String(user.id),
    normalizedMethod: "Bitcoin",
    totalUsd: product.price_usd,
    items: [{ product_name: product.name, quantity: 1 }],
    orderId,
    paymentStatus: "pending"
  });
  await notifyOrderTelegram(env, `${msg}\n\n<i>BTC checkout from Telegram bot shop</i>`);

  return { orderId, address, amount, rate };
}

export async function handleShopCallback(env, query, deps) {
  const data = String(query.data || "");
  if (!data.startsWith("shop:")) return { handled: false };

  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const user = query.from;
  if (!chatId || !user) return { handled: true };

  try {
    await telegramApi(env, "answerCallbackQuery", {
      callback_query_id: query.id,
      text: "Opening…",
      show_alert: false
    });

    const editOrSend = async (text, reply_markup) => {
      if (messageId) {
        const edited = await telegramApi(env, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup
        });
        if (edited.ok) return;
        // If edit fails (e.g. caption message), send a fresh message.
      }
      await deps.sendTelegram(env, chatId, text, { reply_markup });
    };

    if (data === "shop:menu" || data === "shop:home") {
      const products = await loadShopProducts(env, deps.getSupabase);
      if (data === "shop:home") {
        const { premiumWelcomeMessage } = await import("./tg-premium.js");
        const { buildPremiumStartKeyboard } = await import("./start-keyboard.js");
        const bot = botHandle(env);
        const owner = ownerHandle(env);
        const email = supportEmail(env);
        const store = storeUrl(env);
        const company = String(env.COMPANY_NAME || "DV Technologies");
        await editOrSend(
          premiumWelcomeMessage({
            env,
            companyLabel: company,
            bot,
            owner,
            email,
            store,
            products
          }),
          buildPremiumStartKeyboard(env, products)
        );
        return { handled: true };
      }
      const catalog = buildShopCatalogMessage(products, env);
      await editOrSend(catalog.text, catalog.reply_markup);
      return { handled: true };
    }

    if (data.startsWith("shop:p:")) {
      const productId = data.slice("shop:p:".length);
      const product = await getProduct(env, deps.getSupabase, productId);
      if (!product) {
        await editOrSend("Product not found. Open /buy again.", {
          inline_keyboard: [[{ text: "🛍️ Back to catalog", callback_data: "shop:menu" }]]
        });
        return { handled: true };
      }
      const detail = productDetailMessage(product, env);
      await editOrSend(detail.text, detail.reply_markup);
      return { handled: true };
    }

    if (data.startsWith("shop:pay:")) {
      const rest = data.slice("shop:pay:".length);
      const suffixes = ["card", "momo", "ussd", "bank", "usdt", "btc", "stars", "ps"];
      let method = "";
      let productId = "";
      for (const suffix of suffixes) {
        if (rest.endsWith(`:${suffix}`)) {
          method = suffix;
          productId = rest.slice(0, -(suffix.length + 1));
          break;
        }
      }

      const product = await getProduct(env, deps.getSupabase, productId);
      if (!product || !method) {
        await editOrSend("Checkout expired. Open /buy again.", {
          inline_keyboard: [[{ text: "🛍️ Back to catalog", callback_data: "shop:menu" }]]
        });
        return { handled: true };
      }

      if (method === "stars") {
        const stars = usdToStars(env, product.price_usd);
        const started = await createStarsCheckout(env, {
          kind: "bot",
          chatId,
          telegramUserId: user.id,
          customerName: user.first_name || "Telegram buyer",
          customerEmail: checkoutEmailForUser(user),
          telegramUsername: user.username || null,
          productId: product.id,
          productName: displayName(product.name),
          totalUsd: Number(product.price_usd),
          items: [
            {
              product_id: product.id,
              product_name: product.name,
              quantity: 1,
              unit_price_usd: Number(product.price_usd)
            }
          ]
        });
        if (!started.ok) {
          await editOrSend(
            `⚠️ ${esc(started.error || "Stars invoice failed")}\n\nRun <code>supabase-secretary-earn.sql</code> in Supabase if tables are missing.`,
            backToProductKeyboard(product.id)
          );
          return { handled: true };
        }
        await saveSession(env, deps.getSupabase, user.id, {
          product_id: product.id,
          product_name: product.name,
          price_usd: Number(product.price_usd),
          method: "Stars",
          step: "await_stars_pay",
          order_id: null,
          pay_key: started.id
        });
        await editOrSend(
          [
            `${PX.star} <b>Telegram Stars checkout</b>`,
            premiumDivider(),
            `Product: <b>${esc(displayName(product.name))}</b>`,
            `USD: <b>${money(product.price_usd)}</b>`,
            `Pay: <b>${stars} Stars</b>`,
            "",
            "Tap <b>Pay</b> on the invoice below.",
            "After payment, send your delivery email here.",
            "",
            `${PX.gem} Stars you receive can fund Telegram Ads or withdraw via Fragment.`
          ].join("\n"),
          {
            inline_keyboard: [
              [{ text: "⚡ Change payment method", callback_data: `shop:p:${product.id}` }],
              ...footerLinksKeyboard(env)
            ]
          }
        );
        return { handled: true };
      }

      if (method === "usdt") {
        const started = await startUsdtCheckout(env, deps.getSupabase, { product, user });
        if (started.error) {
          await editOrSend(`⚠️ ${esc(started.error)}`, backToProductKeyboard(product.id));
          return { handled: true };
        }

        await saveSession(env, deps.getSupabase, user.id, {
          product_id: product.id,
          product_name: product.name,
          price_usd: Number(product.price_usd),
          method: "USDT",
          step: "await_crypto_tx",
          asset: "USDT",
          order_id: started.orderId
        });

        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=1&data=${encodeURIComponent(
          started.address
        )}`;

        await editOrSend(
          [
            "<b>₮ USDT (TRC20) checkout</b>",
            "────────────────",
            `Product: <b>${esc(displayName(product.name))}</b>`,
            `Total: <b>${started.amount} USDT</b> (= $${started.amount} USD)`,
            "Network: <b>Tron (TRC20)</b> only",
            "",
            section("Send to DTD wallet", [`<code>${esc(started.address)}</code>`]),
            "",
            `Order: <code>${esc(started.orderId)}</code>`,
            "",
            "A QR code follows — scan with any Tron / USDT wallet.",
            "",
            section("How it works", [
              "1. Copy address or scan QR",
              "2. Send exact USDT on TRC20 (not ERC20 / BEP20)",
              "3. Paste your tx hash here (or /tx HASH)",
              "4. Send your delivery email"
            ]),
            "",
            "<i>Don’t send NFTs. Wrong network = lost funds.</i>"
          ].join("\n"),
          {
            inline_keyboard: [
              [{ text: "⚡ Change payment method", callback_data: `shop:p:${product.id}` }],
              ...footerLinksKeyboard(env)
            ]
          }
        );

        await telegramApi(env, "sendPhoto", {
          chat_id: chatId,
          photo: qrUrl,
          caption: [
            `${PX.qr} <b>Scan to pay · USDT TRC20</b>`,
            `${PX.money} Amount: <b>${started.amount} USDT</b>`,
            `${PX.bolt} Network: <b>Tron (TRC20)</b> only`,
            `${PX.key} <code>${esc(started.address)}</code>`
          ].join("\n"),
          parse_mode: "HTML"
        });
        return { handled: true };
      }

      if (method === "btc") {
        const started = await startBtcCheckout(env, deps.getSupabase, { product, user });
        if (started.error) {
          await editOrSend(`⚠️ ${esc(started.error)}`, backToProductKeyboard(product.id));
          return { handled: true };
        }

        await saveSession(env, deps.getSupabase, user.id, {
          product_id: product.id,
          product_name: product.name,
          price_usd: Number(product.price_usd),
          method: "Bitcoin",
          step: "await_crypto_tx",
          asset: "BTC",
          order_id: started.orderId
        });

        const bip21 = `bitcoin:${started.address}?amount=${started.amount}`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=1&data=${encodeURIComponent(
          bip21
        )}`;

        await editOrSend(
          [
            "<b>₿ Bitcoin checkout</b>",
            "────────────────",
            `Product: <b>${esc(displayName(product.name))}</b>`,
            `Total: <b>${money(product.price_usd)} USD</b>`,
            `Send exactly: <b>${started.amount} BTC</b>`,
            `Rate ≈ $${Math.round(started.rate).toLocaleString()} / BTC`,
            "",
            section("Send to DTD wallet", [`<code>${esc(started.address)}</code>`]),
            "",
            `Order: <code>${esc(started.orderId)}</code>`,
            "",
            "A QR code follows — scan with any Bitcoin wallet.",
            "",
            section("How it works", [
              "1. Copy address or scan QR",
              "2. Send the exact BTC amount",
              "3. Paste your txid here (or /tx HASH)",
              "4. Send your delivery email"
            ])
          ].join("\n"),
          {
            inline_keyboard: [
              [{ text: "⚡ Change payment method", callback_data: `shop:p:${product.id}` }],
              ...footerLinksKeyboard(env)
            ]
          }
        );

        await telegramApi(env, "sendPhoto", {
          chat_id: chatId,
          photo: qrUrl,
          caption: [
            `${PX.qr} <b>Scan to pay · Bitcoin</b>`,
            `${PX.btc} Amount: <b>${started.amount} BTC</b>`,
            `${PX.key} <code>${esc(started.address)}</code>`
          ].join("\n"),
          parse_mode: "HTML"
        });
        return { handled: true };
      }

      const payMethod = PAYSTACK_METHOD_MAP[method] || PAYSTACK_METHOD_MAP.ps;
      const placeholderEmail = checkoutEmailForUser(user);

      const started = await startPaystackCheckout(env, deps.getSupabase, {
        product,
        user,
        email: placeholderEmail,
        channels: payMethod.channels,
        methodLabel: payMethod.label
      });
      if (started.error) {
        await editOrSend(`⚠️ ${esc(started.error)}`, backToProductKeyboard(product.id));
        return { handled: true };
      }

      await saveSession(env, deps.getSupabase, user.id, {
        product_id: product.id,
        product_name: product.name,
        price_usd: Number(product.price_usd),
        method: payMethod.label,
        pay_key: method,
        step: "await_paystack_confirm",
        order_id: started.orderId,
        reference: started.reference
      });

      await editOrSend(
        [
          buildPaystackMethodPrompt(env, product, payMethod),
          "",
          section("Order details", [
            `Order: <code>${esc(started.orderId)}</code>`,
            `Ref: <code>${esc(started.reference)}</code>`,
            `Amount: <b>${started.amountLocal} ${esc(started.currency)}</b>`
          ]),
          "",
          "1. Tap <b>Pay now</b> and complete payment",
          "2. Tap <b>I’ve paid · verify</b>",
          "3. Send your delivery email for instant delivery"
        ].join("\n"),
        {
          inline_keyboard: [
            [{ text: `${payMethod.emoji} Pay now · Paystack`, url: started.authorization_url }],
            [
              {
                text: "✅ I’ve paid · verify",
                callback_data: `shop:verify:${started.orderId}`
              }
            ],
            [{ text: "⚡ Change payment method", callback_data: `shop:p:${product.id}` }],
            ...footerLinksKeyboard(env)
          ]
        }
      );
      return { handled: true };
    }

    if (data.startsWith("shop:verify:") || data.startsWith("shop:deliver:")) {
      const orderId = data.includes("shop:verify:")
        ? data.slice("shop:verify:".length)
        : data.slice("shop:deliver:".length);
      const session = await loadSession(env, deps.getSupabase, user.id);
      const reference = session?.reference || session?.payment_reference || "";

      if (!reference) {
        await editOrSend(
          "No Paystack reference found for this order. Open /buy and start checkout again.",
          {
            inline_keyboard: [[{ text: "🛍️ Back to catalog", callback_data: "shop:menu" }]]
          }
        );
        return { handled: true };
      }

      const confirmed = await confirmPaystackOrder(env, { orderId, reference });
      if (!confirmed.ok || !confirmed.paid) {
        const hint =
          confirmed.reason === "failed"
            ? "Paystack marked this payment as failed. Start again with /buy."
            : "Payment not confirmed yet. Finish Paystack (M-Pesa / card / bank), wait a few seconds, then tap verify again.";
        await editOrSend(
          [
            "<b>⏳ Payment still pending</b>",
            "────────────────",
            `Order: <code>${esc(orderId)}</code>`,
            `Ref: <code>${esc(reference)}</code>`,
            "",
            hint
          ].join("\n"),
          {
            inline_keyboard: [
              [{ text: "🔄 Check again", callback_data: `shop:verify:${orderId}` }],
              [{ text: "🛍️ Back to catalog", callback_data: "shop:menu" }],
              ...footerLinksKeyboard(env)
            ]
          }
        );
        return { handled: true };
      }

      await saveSession(env, deps.getSupabase, user.id, {
        ...(session || {}),
        step: "await_delivery_email",
        order_id: orderId,
        reference,
        method: session?.method || "Paystack",
        paid: true
      });

      await reactToMessage(env, chatId, query?.message?.message_id, "✅");
      await editOrSend(
        [
          `${PX.check} <b>Payment confirmed</b>`,
          premiumDivider(),
          `${PX.package} Order: <code>${esc(orderId)}</code>`,
          `${PX.spark} Paystack verified successfully.`,
          "",
          "Last step — send the email where we should deliver the product:",
          "",
          deliveryEmailPrompt(orderId)
        ].join("\n"),
        {
          inline_keyboard: [
            [{ text: "🛍️ Back to catalog", callback_data: "shop:menu" }],
            ...footerLinksKeyboard(env)
          ]
        }
      );
      return { handled: true };
    }

    return { handled: true };
  } catch (error) {
    console.error("Shop callback error:", error);
    await telegramApi(env, "answerCallbackQuery", {
      callback_query_id: query.id,
      text: "Something went wrong. Try /buy again.",
      show_alert: true
    }).catch(() => {});
    if (chatId) {
      await deps.sendTelegram(
        env,
        chatId,
        "⚠️ Checkout failed. Send /buy and try again."
      );
    }
    return { handled: true };
  }
}

export async function handleShopText(env, { text, chatId, from }, deps) {
  const raw = String(text || "").trim();
  if (!raw || !from?.id) return null;

  const session = await loadSession(env, deps.getSupabase, from.id);

  // Explicit helpers
  if (raw.toLowerCase().startsWith("/tx ")) {
    const hash = raw.slice(4).trim();
    const asset = String(session?.asset || (session?.method === "USDT" ? "USDT" : "BTC")).toUpperCase();
    return finalizeCryptoTx(env, deps, {
      chatId,
      from,
      hash,
      orderId: session?.order_id,
      asset
    });
  }

  if (!session || !session.step) return null;

  // Stale sessions older than 2 hours
  if (session.updated_at && Date.now() - session.updated_at > 2 * 3600 * 1000) {
    await clearSession(env, deps.getSupabase, from.id);
    return null;
  }

  if (session.step === "await_paystack_confirm") {
    const orderId = session.order_id;
    const reference = session.reference || "";
    if (!orderId || !reference) {
      return { text: "Checkout expired. Send /buy and pay again." };
    }
    const confirmed = await confirmPaystackOrder(env, { orderId, reference });
    if (!confirmed.ok || !confirmed.paid) {
      return {
        text: [
          "<b>⏳ Payment still pending</b>",
          "Finish Paystack first, then tap <b>I’ve paid · verify</b> in the checkout message,",
          "or send <code>paid</code> again after M-Pesa/card completes."
        ].join("\n")
      };
    }
    await saveSession(env, deps.getSupabase, from.id, {
      ...session,
      step: "await_delivery_email",
      paid: true
    });
    return {
      text: [
        `${PX.check} <b>Payment confirmed</b>`,
        premiumDivider(),
        `${PX.inbox} Send your delivery email now (example: <code>you@gmail.com</code>).`
      ].join("\n")
    };
  }

  if (session.step === "await_email" || session.step === "await_delivery_email") {
    const email = normalizeEmail(raw);
    if (!isValidEmail(email)) {
      return {
        text: [
          `${PX.warn} <b>Send a real email</b> for product delivery.`,
          "Gmail works: <code>you@gmail.com</code>",
          "Also OK: Yahoo, Outlook, iCloud, company emails.",
          "",
          "Examples:",
          "<code>davie@gmail.com</code>",
          "<code>name.surname@gmail.com</code>"
        ].join("\n")
      };
    }

    const orderId = session.order_id;
    if (!orderId) {
      await clearSession(env, deps.getSupabase, from.id);
      return {
        text: "No open order found. Pay first with /buy, then send your delivery email."
      };
    }

    // Re-verify Paystack before accepting delivery email so status is never stuck pending.
    const isPaystackSession = Boolean(
      session.reference &&
        (session.pay_key || /paystack|card|m-?pesa|momo|ussd|bank/i.test(String(session.method || "")))
    );
    if (isPaystackSession) {
      const confirmed = await confirmPaystackOrder(env, {
        orderId,
        reference: session.reference
      });
      if (!confirmed.ok || !confirmed.paid) {
        await saveSession(env, deps.getSupabase, from.id, {
          ...session,
          step: "await_paystack_confirm"
        });
        return {
          text: [
            "<b>⏳ Payment not verified yet</b>",
            "Complete Paystack payment first, then tap <b>I’ve paid · verify</b>.",
            "After confirmation, send this delivery email again."
          ].join("\n"),
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔄 Verify payment", callback_data: `shop:verify:${orderId}` }],
              ...footerLinksKeyboard(env)
            ]
          }
        };
      }
    }

    const update = await updateOrderPayment(env, orderId, {
      customer_email: email,
      customer_phone: email,
      delivery_details: `Delivery email (after payment): ${email}`
    });
    if (!update.ok) {
      return { text: `⚠️ Could not save email: ${esc(update.message || update.reason)}` };
    }

    await clearSession(env, deps.getSupabase, from.id);

    if (env.TELEGRAM_ADMIN_CHAT_ID) {
      await deps.sendTelegram(
        env,
        env.TELEGRAM_ADMIN_CHAT_ID,
        [
          `${PX.package} <b>READY TO DELIVER</b>`,
          `Order: <code>${esc(orderId)}</code>`,
          `Email: <code>${esc(email)}</code>`,
          `User: @${esc(from.username || from.id)}`,
          `Method: ${esc(session.method || "Paystack")}`,
          "",
          "Payment verified. Deliver the product to this email now.",
          `Mark done: /paid ${orderId}`
        ].join("\n")
      );
    }

    return {
      text: [
        `${PX.check} <b>Payment verified · delivery queued</b>`,
        premiumDivider(),
        `${PX.package} Order: <code>${esc(orderId)}</code>`,
        `${PX.mail} Delivery email: <code>${esc(email)}</code>`,
        "",
        `${PX.rocket} Your product is being delivered to that inbox now.`,
        `${PX.pin} Track anytime: <code>/order ${orderId} ${email}</code>`
      ].join("\n"),
      reply_markup: {
        inline_keyboard: [
          [{ text: `${PX.bag} Buy another product`, callback_data: "shop:menu" }],
          ...footerLinksKeyboard(env)
        ]
      }
    };
  }

  if (session.step === "await_crypto_tx" || session.step === "await_btc_tx") {
    const asset = String(session.asset || (session.method === "USDT" ? "USDT" : "BTC")).toUpperCase();
    const hash = raw.replace(/^(tx|txid|hash)\s+/i, "").trim();
    if (!TX_RE.test(hash) && hash.length < 20) {
      return {
        text: [
          asset === "USDT" ? "<b>USDT TRC20 tx hash needed</b>" : "<b>Bitcoin txid needed</b>",
          "Paste the full transaction hash, or send:",
          "<code>/tx YOUR_TX_HASH</code>"
        ].join("\n")
      };
    }
    return finalizeCryptoTx(env, deps, {
      chatId,
      from,
      hash,
      orderId: session.order_id,
      asset
    });
  }

  return null;
}

async function finalizeCryptoTx(env, deps, { from, hash, orderId, asset = "BTC" }) {
  const clean = String(hash || "").trim();
  const label = asset === "USDT" ? "USDT TRC20" : "Bitcoin";
  if (!clean || clean.length < 20) {
    return { text: `Invalid transaction hash. Paste the full ${label} tx hash.` };
  }

  const session = await loadSession(env, deps.getSupabase, from.id);
  let targetOrderId = orderId || session?.order_id;
  const priceUsd = Number(session?.price_usd || 0);

  let paid = false;
  let verifyNote = "Could not auto-verify yet — admin will confirm shortly.";
  let receivedAmount = null;

  if (asset === "USDT") {
    const check = await verifyUsdtTrc20Payment({
      hash: clean,
      address: usdtAddress(env),
      minAmount: priceUsd || 0
    });
    if (check.ok) {
      paid = true;
      receivedAmount = check.amount;
      verifyNote = `On-chain USDT TRC20 verified (${check.amount} USDT).`;
    } else if (check.reason === "not_found") {
      verifyNote = "Tx not seen on Tron yet. If you just sent it, wait ~30s and resend the hash.";
    } else if (check.reason === "amount_low") {
      verifyNote = `Tx found but amount looks low (${check.amount ?? "?"} USDT).`;
    } else if (check.reason === "wrong_token") {
      verifyNote = "Tx is not USDT TRC20. Send USDT on Tron only.";
    }
  } else {
    const { amount: needBtc } = priceUsd ? await fetchBtcAmount(priceUsd) : { amount: "0" };
    const check = await verifyBtcOnChainPayment({
      hash: clean,
      address: btcAddress(env),
      minAmount: Number(needBtc || 0)
    });
    if (check.ok) {
      paid = true;
      receivedAmount = check.amount;
      verifyNote = check.confirmed
        ? `On-chain BTC verified (${check.amount} BTC).`
        : `BTC tx found in mempool (${check.amount} BTC) — accepted for delivery.`;
    } else if (check.reason === "not_found") {
      verifyNote = "Tx not found on Bitcoin network yet. Wait a minute and resend the hash.";
    } else if (check.reason === "amount_low") {
      verifyNote = `Tx found but amount looks low (${check.amount ?? "?"} BTC).`;
    }
  }

  if (targetOrderId) {
    await updateOrderPayment(env, targetOrderId, {
      payment_reference: clean,
      payment_status: paid ? "paid" : "pending"
    });
  }

  await saveSession(env, deps.getSupabase, from.id, {
    step: paid ? "await_delivery_email" : "await_crypto_tx",
    order_id: targetOrderId,
    method: asset === "USDT" ? "USDT" : "Bitcoin",
    asset,
    price_usd: priceUsd,
    paid
  });

  if (!paid) {
    return {
      text: [
        `<b>⏳ ${label} not confirmed yet</b>`,
        "────────────────",
        `Tx: <code>${esc(clean)}</code>`,
        targetOrderId ? `Order: <code>${esc(targetOrderId)}</code>` : null,
        "",
        verifyNote,
        "",
        "After the network confirms, paste the same tx hash again."
      ]
        .filter(Boolean)
        .join("\n")
    };
  }

  if (env.TELEGRAM_ADMIN_CHAT_ID) {
    await deps.sendTelegram(
      env,
      env.TELEGRAM_ADMIN_CHAT_ID,
      [
        asset === "USDT"
          ? "<b>✅ USDT TRC20 PAID — deliver now</b>"
          : "<b>✅ BTC PAID — deliver now</b>",
        targetOrderId ? `Order: <code>${esc(targetOrderId)}</code>` : null,
        `User: @${esc(from.username || from.id)}`,
        `Tx: <code>${esc(clean)}</code>`,
        receivedAmount != null ? `Amount: <code>${esc(String(receivedAmount))}</code>` : null,
        verifyNote,
        "",
        "Buyer will send delivery email next."
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return {
    text: [
      `${PX.check} <b>${label} payment confirmed</b>`,
      premiumDivider(),
      `${PX.link} Tx: <code>${esc(clean)}</code>`,
      targetOrderId ? `${PX.package} Order: <code>${esc(targetOrderId)}</code>` : null,
      receivedAmount != null ? `${PX.money} Received: <b>${esc(String(receivedAmount))}</b>` : null,
      verifyNote,
      "",
      `${PX.inbox} Send your delivery email now for instant product delivery:`,
      "",
      deliveryEmailPrompt(targetOrderId)
    ]
      .filter(Boolean)
      .join("\n"),
    reply_markup: {
      inline_keyboard: [
        [{ text: `${PX.bag} Back to catalog`, callback_data: "shop:menu" }],
        ...footerLinksKeyboard(env)
      ]
    }
  };
}
