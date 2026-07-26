/**
 * Legitimate DTD Store bot commands only.
 * Products, payments, store links, channels, admin status — no carding/OTP tooling.
 */

import {
  paymentStatusView,
  updateOrderPayment,
  verifyPaystackPayment
} from "./store.js";
import {
  buildShopCatalogMessage,
  handleShopCallback,
  handleShopText,
  loadShopProducts
} from "./bot-shop.js";
import {
  miniAppChannelKeyboard,
  miniAppDeepLink,
  miniAppPrivateKeyboard,
  miniAppUrl
} from "./mini-app.js";
import {
  PX,
  premiumDivider,
  premiumHeader,
  premiumPayMessage,
  premiumWelcomeMessage,
  reactToMessage
} from "./tg-premium.js";
import {
  answerStarsPreCheckout,
  earnHelpMessage,
  handleStarsSuccessfulPayment
} from "./stars.js";
import {
  createTipInvoice,
  referMessage,
  referralStats,
  tipPrompt,
  trackReferralStart
} from "./bot-earn.js";
import {
  handleSecretaryCallback,
  handleSecretaryCommand,
  processDueReminders
} from "./bot-secretary.js";
import { buildPremiumStartKeyboard } from "./start-keyboard.js";
import { blue, green, red } from "./tg-buttons.js";

const OWNER = "davetheedev";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_STORE = "https://dtdpaymentsbot.pages.dev";

export function storeUrl(env) {
  return String(env.STORE_URL || DEFAULT_STORE).replace(/\/$/, "");
}

export function companyUrl(env) {
  return String(env.COMPANY_URL || "https://dvtechnologies.xyz").replace(/\/$/, "");
}

export function companyName(env) {
  return String(env.COMPANY_NAME || "DV Technologies").trim() || "DV Technologies";
}

export function ownerHandle(env) {
  return String(env.TELEGRAM_OWNER_USERNAME || OWNER).replace(/^@/, "");
}

export function supportEmail(env) {
  return String(env.SUPPORT_EMAIL || "contact@dvtechnologies.xyz").trim().toLowerCase();
}

export function channelUsername(env) {
  return String(env.TELEGRAM_CHANNEL_USERNAME || "DTDMAINSTORE").replace(/^@/, "");
}

export function botUsername(env) {
  return String(env.TELEGRAM_BOT_USERNAME || "Dtdpaymentbot").replace(/^@/, "");
}

/** Strict official links used in payment editors + forwarded channel footers. */
export function officialLinks(env) {
  const store = storeUrl(env);
  const company = companyUrl(env);
  const bot = botUsername(env);
  const owner = ownerHandle(env);
  const email = supportEmail(env);
  return {
    bot,
    owner,
    email,
    store,
    company,
    botUrl: `https://t.me/${bot}`,
    ownerUrl: `https://t.me/${owner}`,
    lines: [
      `${PX.bot} Pay / Mini App: @${bot}`,
      `${PX.cart} Web store: ${store}`,
      `${PX.channel} Channel: @${channelUsername(env)}`,
      `${PX.company} DV Tech: ${company}`,
      `${PX.mail} Email: ${email}`,
      `${PX.support} Support: @${owner}`
    ]
  };
}

export function officialLinksText(env) {
  return officialLinks(env).lines.join("\n");
}

export function officialLinksKeyboard(env, extraRows = []) {
  const links = officialLinks(env);
  // Telegram rejects mailto: on inline buttons (BUTTON_URL_INVALID) — keep email in text only.
  return {
    inline_keyboard: [
      [
        blue({ text: "🛍 Products", web_app: { url: `${links.store}/?utm_source=telegram_miniapp#products` } }),
        blue({ text: "💳 Buy in chat", url: `${links.botUrl}?start=buy` })
      ],
      [
        green({ text: "🌐 Website", url: links.store }),
        green({ text: "🎧 Support", url: links.ownerUrl })
      ],
      [red({ text: "‼️ DV Technologies", url: links.company })],
      ...extraRows
    ]
  };
}

export function isAdmin(env, chatId) {
  return String(chatId) === String(env.TELEGRAM_ADMIN_CHAT_ID || "");
}

export function autoApproveJoinsEnabled(env) {
  const raw = String(env.TELEGRAM_AUTO_APPROVE_JOINS ?? "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

export function channelMirrorEnabled(env) {
  const raw = String(env.TELEGRAM_CHANNEL_MIRROR ?? "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

export function mirrorSourceIds(env) {
  // Prefer explicit source list; do not treat destination channel as a source.
  const explicit = [
    env.TELEGRAM_MIRROR_FROM_CHANNEL_ID,
    ...(String(env.MIRROR_SOURCE_CHANNELS || "").split(/[\s,]+/))
  ]
    .map((id) => String(id || "").trim())
    .filter(Boolean);

  const sources = explicit.length
    ? explicit
    : [env.TELEGRAM_CHANNEL_ID, env.TELEGRAM_BACKUP_CHANNEL_ID].filter(Boolean);

  const target = mirrorTargetId(env);
  return [...new Set(sources.map(String).filter((id) => id && id !== target))];
}

export function mirrorTargetId(env) {
  return String(
    env.TELEGRAM_MIRROR_TO_CHAT_ID || env.MIRROR_DEST_CHANNEL || env.TELEGRAM_GROUP_ID || ""
  ).trim();
}

export const BOT_COMMANDS = [
  { command: "start", description: "✨ Premium welcome & main menu" },
  { command: "help", description: "📖 All commands" },
  { command: "buy", description: "🛍️ Shop & pay in Telegram" },
  { command: "shop", description: "🛒 Open the product catalog" },
  { command: "app", description: "✨ Open DTD Store Mini App" },
  { command: "mini", description: "✨ Same as /app — Mini App shop" },
  { command: "products", description: "🔴 Browse live products" },
  { command: "pay", description: "💎 USDT · BTC · Stars · Paystack" },
  { command: "order", description: "📦 Track an order by ID + email" },
  { command: "earn", description: "⭐ Earn with Stars, ads & referrals" },
  { command: "refer", description: "🔗 Your referral / invite link" },
  { command: "tip", description: "⭐ Tip DTD with Telegram Stars" },
  { command: "paysupport", description: "🛟 Payment / Stars support" },
  { command: "terms", description: "📜 Store & Stars terms" },
  { command: "trade", description: "📈 DTD Trade Platform + trading bot" },
  { command: "price", description: "📊 Live spot price e.g. /price BTCUSDT" },
  { command: "ticker", description: "📉 Watchlist snapshot (trading bot)" },
  { command: "chat", description: "💬 Open DTD Chat (@username feed)" },
  { command: "chatsign", description: "🔑 Link Telegram to site Chat" },
  { command: "store", description: "🌐 Open the web store" },
  { command: "channel", description: "📢 Main Telegram channel" },
  { command: "support", description: "📧 Email + Telegram support" },
  { command: "secretary", description: "🗂️ Admin secretary mode" },
  { command: "inbox", description: "📥 Admin: pending payments inbox" },
  { command: "remind", description: "⏰ Admin: set a reminder" },
  { command: "reminders", description: "🗓️ Admin: list reminders" },
  { command: "status", description: "Admin: system health" },
  { command: "stats", description: "Admin: analytics overview" },
  { command: "orders", description: "Admin: recent orders" },
  { command: "payments", description: "Admin: payment monitor" },
  { command: "verify", description: "Admin: verify a payment" },
  { command: "paid", description: "Admin: mark order paid" },
  { command: "fail", description: "Admin: mark order failed" },
  { command: "post", description: "Admin: post to channels" },
  { command: "config", description: "Admin: config summary" },
  { command: "autojoin", description: "Admin: auto-approve joins" },
  { command: "mods", description: "Admin: bot permissions" },
  { command: "mirror", description: "Admin: mirror status" }
];

function tradePlatformUrl(env) {
  return `${storeUrl(env)}/#trade`;
}

function tradeKeyboard(env) {
  const store = storeUrl(env);
  return {
    inline_keyboard: [
      [
        {
          text: "Open Trade Platform",
          web_app: { url: `${store}/?utm_source=telegram_trade#trade` }
        }
      ],
      [
        {
          text: "Trading Bots",
          web_app: { url: `${store}/?utm_source=telegram_trade#trade-bots` }
        },
        { text: "Price BTC", callback_data: "trade:price:BTCUSDT" }
      ],
      [
        { text: "Price ETH", callback_data: "trade:price:ETHUSDT" },
        { text: "Ticker", callback_data: "trade:ticker" }
      ]
    ]
  };
}

async function fetchSpotTicker(symbol) {
  const sym = String(symbol || "BTCUSDT")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const safe = sym || "BTCUSDT";
  const url = `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${encodeURIComponent(safe)}`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`Ticker HTTP ${resp.status}`);
  const data = await resp.json();
  return {
    symbol: data.symbol || safe,
    last: Number(data.lastPrice),
    changePct: Number(data.priceChangePercent),
    high: Number(data.highPrice),
    low: Number(data.lowPrice)
  };
}

async function formatPriceReply(symbol) {
  const t = await fetchSpotTicker(symbol);
  const sign = t.changePct >= 0 ? "+" : "";
  return [
    `<b>${esc(t.symbol)}</b> · DTD Trading Bot`,
    `Last: <code>${t.last}</code>`,
    `24h: <code>${sign}${t.changePct.toFixed(2)}%</code>`,
    `High / Low: <code>${t.high}</code> / <code>${t.low}</code>`,
    "",
    "Desk: /trade · Watchlist: /ticker"
  ].join("\n");
}

async function formatTickerWatchlist() {
  const pairs = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"];
  const rows = await Promise.all(
    pairs.map(async (p) => {
      try {
        const t = await fetchSpotTicker(p);
        const sign = t.changePct >= 0 ? "+" : "";
        return `• <b>${esc(t.symbol)}</b> <code>${t.last}</code> (${sign}${t.changePct.toFixed(2)}%)`;
      } catch {
        return `• <b>${esc(p)}</b> —`;
      }
    })
  );
  return ["<b>DTD Trading Bot · Watchlist</b>", "────────────────", ...rows, "", "Quote: /price ETHUSDT"].join(
    "\n"
  );
}

function storeKeyboard(env) {
  return miniAppPrivateKeyboard(env);
}

function esc(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function listProducts(env, getSupabase) {
  const fallback = [
    {
      name: "Automation Bot Builder",
      price_usd: 49,
      description: "Custom Telegram workflow bots with order alerts and admin handoff."
    },
    {
      name: "Customer Support Bot",
      price_usd: 79,
      description: "FAQ replies, ticket intake, and seamless handoff to a human agent."
    },
    {
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
      .select("name,description,price_usd,active")
      .eq("active", true)
      .order("price_usd", { ascending: true })
      .limit(20);
    if (error || !data?.length) return fallback;
    return data;
  } catch {
    return fallback;
  }
}

async function listOrders(env, getSupabase) {
  const supabase = getSupabase(env);
  if (!supabase) return { error: "Supabase not configured." };
  const { data, error } = await supabase
    .from("orders")
    .select("id,customer_name,payment_method,payment_status,total_usd,created_at")
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) return { error: error.message };
  return { orders: data || [] };
}

async function analyticsSummary(env, getSupabase) {
  const supabase = getSupabase(env);
  if (!supabase) return { error: "Supabase not configured." };

  const now = Date.now();
  const since7 = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
  const since24 = now - 24 * 3600 * 1000;

  const { data: events, error } = await supabase
    .from("analytics_events")
    .select("event_type,client_id,data,referrer,created_at")
    .gte("created_at", since7)
    .order("created_at", { ascending: false })
    .limit(8000);
  if (error) return { error: error.message };

  const rows = events || [];
  const blank = () => ({
    views: 0,
    visitors: new Set(),
    addToCart: 0,
    checkouts: 0,
    purchases: 0
  });
  const d1 = blank();
  const d7 = blank();
  const productCounts = new Map();
  const referrerCounts = new Map();

  for (const row of rows) {
    const ts = Date.parse(row.created_at || "") || 0;
    const buckets = ts >= since24 ? [d7, d1] : [d7];
    for (const bucket of buckets) {
      if (row.client_id) bucket.visitors.add(row.client_id);
      switch (row.event_type) {
        case "page_view":
          bucket.views += 1;
          break;
        case "add_to_cart":
          bucket.addToCart += 1;
          break;
        case "begin_checkout":
          bucket.checkouts += 1;
          break;
        case "purchase":
          bucket.purchases += 1;
          break;
        default:
          break;
      }
    }

    if (row.event_type === "add_to_cart") {
      const name = String(row.data?.name || row.data?.productId || "Unknown");
      productCounts.set(name, (productCounts.get(name) || 0) + 1);
    }
    if (row.event_type === "page_view") {
      let ref = String(row.referrer || "").trim();
      if (!ref) ref = "Direct / none";
      else {
        try {
          ref = new URL(ref).hostname || ref;
        } catch {
          /* keep raw */
        }
      }
      referrerCounts.set(ref, (referrerCounts.get(ref) || 0) + 1);
    }
  }

  const { data: orders7 } = await supabase
    .from("orders")
    .select("total_usd,created_at")
    .gte("created_at", since7);
  const orders = orders7 || [];
  let revenue24 = 0;
  let revenue7 = 0;
  let orders24 = 0;
  for (const order of orders) {
    const amount = Number(order.total_usd || 0);
    revenue7 += amount;
    if ((Date.parse(order.created_at || "") || 0) >= since24) {
      revenue24 += amount;
      orders24 += 1;
    }
  }

  const topProducts = [...productCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topReferrers = [...referrerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return {
    d1: { ...d1, visitors: d1.visitors.size },
    d7: { ...d7, visitors: d7.visitors.size },
    orders24,
    orders7: orders.length,
    revenue24,
    revenue7,
    topProducts,
    topReferrers
  };
}

function conversionPct(purchases, visitors) {
  if (!visitors) return "0%";
  return `${((purchases / visitors) * 100).toFixed(1)}%`;
}

// Recent orders with a live re-verify of pending Paystack payments.
async function paymentsMonitor(env, getSupabase) {
  const supabase = getSupabase(env);
  if (!supabase) return { error: "Supabase not configured." };

  const { data, error } = await supabase
    .from("orders")
    .select("id,customer_name,payment_method,payment_status,payment_reference,total_usd,created_at")
    .order("created_at", { ascending: false })
    .limit(15);
  if (error) return { error: error.message };

  const orders = data || [];
  let rechecked = 0;
  for (const order of orders) {
    if (rechecked >= 6) break;
    const stored = String(order.payment_status || "pending").toLowerCase();
    if (order.payment_method === "Paystack" && stored === "pending" && order.payment_reference) {
      const result = await verifyPaystackPayment(env, order.payment_reference);
      rechecked += 1;
      if (result.ok && result.state === "complete") {
        await updateOrderPayment(env, order.id, { payment_status: "paid" });
        order.payment_status = "paid";
      } else if (result.ok && result.state === "failed") {
        await updateOrderPayment(env, order.id, { payment_status: "failed" });
        order.payment_status = "failed";
      }
    }
  }
  return { orders, rechecked };
}

// Verify a single payment by Paystack reference or order UUID (admin).
async function verifyPaymentByToken(env, getSupabase, token) {
  const supabase = getSupabase(env);
  if (!supabase) return { error: "Supabase not configured." };
  const value = String(token || "").trim();
  if (!value) return { error: "Provide a payment reference or order id." };

  let order = null;
  let reference = value;

  if (UUID_RE.test(value)) {
    const { data, error } = await supabase
      .from("orders")
      .select("id,customer_name,payment_method,payment_status,payment_reference,total_usd,created_at")
      .eq("id", value)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "Order not found for that id." };
    order = data;
    reference = data.payment_reference || "";

    if (data.payment_method !== "Paystack") {
      // Bitcoin / manual — no gateway to query; report stored state.
      return {
        order,
        method: data.payment_method,
        live: false,
        view: paymentStatusView(data.payment_status),
        note: "Crypto order (USDT TRC20 / BTC) — confirm on-chain, then mark with /paid or /fail."
      };
    }
    if (!reference) {
      return {
        order,
        method: data.payment_method,
        live: false,
        view: paymentStatusView(data.payment_status),
        note: "No Paystack reference stored for this order."
      };
    }
  }

  const result = await verifyPaystackPayment(env, reference);
  if (!result.ok) {
    return { error: result.message || `Could not verify (${result.reason || "error"}).`, reference };
  }

  // If we can locate the order by reference, keep its stored status in sync.
  if (!order) {
    const { data } = await supabase
      .from("orders")
      .select("id,customer_name,payment_method,payment_status,payment_reference,total_usd,created_at")
      .eq("payment_reference", reference)
      .maybeSingle();
    order = data || null;
  }
  if (order) {
    const next = result.state === "complete" ? "paid" : result.state === "failed" ? "failed" : null;
    if (next && String(order.payment_status || "").toLowerCase() !== next) {
      await updateOrderPayment(env, order.id, { payment_status: next });
      order.payment_status = next;
    }
  }

  return { order, method: "Paystack", live: true, result, reference };
}

// Admin override to set an order's payment status (used for BTC confirmations).
async function setOrderStatus(env, getSupabase, orderId, status) {
  const supabase = getSupabase(env);
  if (!supabase) return { error: "Supabase not configured." };
  const id = String(orderId || "").trim();
  if (!UUID_RE.test(id)) return { error: "Provide a valid order id (UUID)." };

  const { data, error } = await supabase
    .from("orders")
    .select("id,customer_name,total_usd,payment_method,payment_status")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Order not found." };

  const update = await updateOrderPayment(env, id, { payment_status: status });
  if (!update.ok) return { error: update.message || "Update failed." };
  return { order: { ...data, payment_status: status } };
}

function helpText(admin) {
  const lines = [
    premiumHeader("DTD Store · Help", PX.spark),
    premiumDivider(),
    "",
    `${PX.bag} <b>Shopping</b>`,
    "/app — open DTD Store Mini App",
    "/buy — pay inside this bot (USDT / BTC / Stars / Paystack)",
    "/products — browse live products",
    "/pay — premium payment guide",
    "/order &lt;id&gt; &lt;email&gt; — track an order",
    "",
    `${PX.star} <b>Earn</b>`,
    "/earn — Stars balance → Ads / Fragment + referrals",
    "/refer — your invite link",
    "/tip — tip with Stars",
    "/paysupport · /terms — Stars purchase support",
    "",
    `${PX.chart} <b>Trading bot</b>`,
    "/trade — DTD Trade Platform menu",
    "/price BTCUSDT — live spot quote",
    "/ticker — multi-pair snapshot",
    "",
    `${PX.chat} <b>Community</b>`,
    "/chat — open DTD Chat (Twitter-style feed)",
    "/chatsign CODE — link your @username to the site",
    "",
    `${PX.link} <b>Links</b>`,
    "/store — web store",
    "/channel — main channel",
    "/support — email + Telegram contact",
    "/start — premium main menu",
    "/help — this list"
  ];
  if (admin) {
    lines.push(
      "",
      `${PX.key} <b>Admin</b>`,
      "/secretary · /inbox · /remind · /reminders",
      "/status · /stats · /orders · /payments",
      "/verify · /paid · /fail · /post",
      "/config · /autojoin · /mods · /mirror"
    );
  }
  return lines.join("\n");
}

export async function handleBotCommand(env, { text, chatId, from }, deps) {
  const { getSupabase, sendTelegram } = deps;
  const raw = String(text || "").trim();
  if (!raw.startsWith("/")) return null;

  const [cmdPart, ...rest] = raw.split(/\s+/);
  const command = cmdPart.split("@")[0].slice(1).toLowerCase();
  const arg = rest.join(" ").trim();
  const admin = isAdmin(env, chatId);
  const store = storeUrl(env);
  const company = companyUrl(env);
  const companyLabel = companyName(env);
  const owner = ownerHandle(env);
  const email = supportEmail(env);
  const channel = channelUsername(env);
  const bot = botUsername(env);

  let reply = "";
  let replyMarkup = null;

  switch (command) {
    case "start": {
      const startArg = arg.toLowerCase();
      if (startArg === "trade" || startArg === "trading" || startArg === "bots") {
        const desk = tradePlatformUrl(env);
        reply = [
          "<b>DTD Trade Platform</b>",
          "Telegram Trading Bot is ready.",
          "",
          `Open desk: ${desk}`,
          "Commands: /trade · /price BTCUSDT · /ticker"
        ].join("\n");
        replyMarkup = tradeKeyboard(env);
        break;
      }
      if (startArg === "chat" || startArg === "community") {
        reply = [
          "<b>DTD Chat</b>",
          "Twitter-style feed on the store — your Telegram @username is your handle.",
          "",
          `Open: ${store}/#chat`,
          "Link from web: generate a code on the Chat page, then /chatsign CODE here."
        ].join("\n");
        replyMarkup = {
          inline_keyboard: [
            [{ text: "Open DTD Chat", web_app: { url: `${store}/?utm_source=telegram_chat#chat` } }],
            [{ text: "Web Chat", url: `${store}/#chat` }]
          ]
        };
        break;
      }
      if (startArg.startsWith("chatsign_")) {
        const code = startArg.slice("chatsign_".length);
        const { claimLinkCode } = await import("./chat.js");
        const result = await claimLinkCode(env, code, from);
        if (!result.ok) {
          reply = `Link failed: ${esc(result.error || "unknown")}`;
        } else {
          reply = [
            "<b>DTD Chat linked</b>",
            `Signed as @${esc(result.username)}`,
            "",
            "Return to the site Chat page and tap <b>I've sent it — finish</b> (or refresh if already signed in via Mini App)."
          ].join("\n");
        }
        replyMarkup = {
          inline_keyboard: [[{ text: "Open Chat", web_app: { url: `${store}/?utm_source=telegram_chat#chat` } }]]
        };
        break;
      }
      if (startArg === "pay") {
        reply = premiumPayMessage({ bot, owner, email, store });
        replyMarkup = storeKeyboard(env);
        break;
      }
      if (startArg === "earn") {
        reply = earnHelpMessage(env);
        replyMarkup = storeKeyboard(env);
        break;
      }
      if (startArg === "refer" || startArg === "invite") {
        const stats = await referralStats(env, from?.id);
        reply = [
          referMessage(env, from?.id || chatId),
          "",
          `${PX.chart} Referred: <b>${stats.count}</b> · Converted: <b>${stats.converted}</b>`
        ].join("\n");
        break;
      }
      if (startArg.startsWith("ref_")) {
        const referrerId = startArg.slice(4).replace(/\D/g, "");
        if (referrerId && from?.id) {
          await trackReferralStart(env, {
            userId: from.id,
            username: from.username,
            referrerId
          });
        }
        {
          const products = await loadShopProducts(env, getSupabase);
          reply = [
            premiumWelcomeMessage({
              env,
              companyLabel: esc(companyLabel),
              bot,
              owner,
              email,
              store,
              products
            }),
            "",
            `${PX.fire} Thanks for joining via a referral link.`
          ].join("\n");
          replyMarkup = buildPremiumStartKeyboard(env, products);
        }
        break;
      }
      if (startArg === "buy" || startArg === "shop" || startArg === "help") {
        if (startArg === "help") {
          reply = helpText(admin);
          replyMarkup = storeKeyboard(env);
          break;
        }
        const products = await loadShopProducts(env, getSupabase);
        const catalog = buildShopCatalogMessage(products, env);
        reply = catalog.text;
        replyMarkup = catalog.reply_markup;
        break;
      }
      {
        const products = await loadShopProducts(env, getSupabase);
        reply = premiumWelcomeMessage({
          env,
          companyLabel: esc(companyLabel),
          bot,
          owner,
          email,
          store,
          products
        });
        replyMarkup = buildPremiumStartKeyboard(env, products);
      }
      break;
    }

    case "help":
      reply = helpText(admin);
      replyMarkup = storeKeyboard(env);
      break;

    case "store":
      reply = [
        "<b>Official DTD website</b>",
        store,
        "",
        officialLinksText(env)
      ].join("\n");
      replyMarkup = storeKeyboard(env);
      break;

    case "channel":
      reply = [
        premiumHeader("DTD MAIN STORE channel", PX.channel),
        premiumDivider(),
        `${PX.live} Live drops · promos · store updates`,
        `https://t.me/${channel}`,
        "",
        `${PX.spark} Shop from the channel buttons or open @${bot}`,
        "",
        "Official purchase / support links:",
        officialLinksText(env)
      ].join("\n");
      replyMarkup = miniAppChannelKeyboard(env);
      break;

    case "trade":
    case "tradebot":
    case "trading": {
      const desk = tradePlatformUrl(env);
      reply = [
        "<b>DTD Trade Platform · Telegram Trading Bot</b>",
        "────────────────",
        "I'm your mobile trading co-pilot on this platform.",
        "",
        "• Live spot quotes",
        "• Watchlist ticker",
        "• Fill alerts (link chat ID on the desk Keys tab)",
        "• Open charts / bots / AI guide in the Mini App",
        "",
        `Platform: ${desk}`,
        "",
        "<b>Commands</b>",
        "/price BTCUSDT",
        "/ticker",
        "/trade — this menu"
      ].join("\n");
      replyMarkup = tradeKeyboard(env);
      break;
    }

    case "price":
    case "quote": {
      const symbol = (arg || "BTCUSDT").split(/\s+/)[0];
      try {
        reply = await formatPriceReply(symbol);
        replyMarkup = tradeKeyboard(env);
      } catch (err) {
        reply = `Could not fetch ${esc(symbol)}: ${esc(err.message || "error")}`;
      }
      break;
    }

    case "ticker":
    case "watchlist": {
      try {
        reply = await formatTickerWatchlist();
        replyMarkup = tradeKeyboard(env);
      } catch (err) {
        reply = `Watchlist failed: ${esc(err.message || "error")}`;
      }
      break;
    }

    case "chat":
    case "community": {
      reply = [
        "<b>DTD Chat</b>",
        "────────────────",
        "Interactive feed on the website — identities are Telegram @usernames.",
        "Works with this bot + the main channel; share posts to WhatsApp.",
        "",
        `Open: ${store}/#chat`,
        "",
        "Web visitors: Chat → Link Telegram → send /chatsign CODE here."
      ].join("\n");
      replyMarkup = {
        inline_keyboard: [
          [{ text: "Open DTD Chat", web_app: { url: `${store}/?utm_source=telegram_chat#chat` } }],
          [
            { text: "Web Chat", url: `${store}/#chat` },
            { text: "Channel", url: `https://t.me/${channel}` }
          ]
        ]
      };
      break;
    }

    case "chatsign":
    case "chatlink": {
      const { claimLinkCode } = await import("./chat.js");
      const result = await claimLinkCode(env, arg, from);
      if (!result.ok) {
        reply = [
          "<b>Chat link</b>",
          esc(result.error || "Failed"),
          "",
          "On the site: Connect → Chat → Link Telegram to get a fresh code."
        ].join("\n");
      } else if (result.already) {
        reply = `Already linked as @${esc(result.username)}. Open ${store}/#chat and finish sign-in.`;
      } else {
        reply = [
          "<b>DTD Chat linked</b>",
          `You're @${esc(result.username)} on the site feed.`,
          "",
          "Go back to Chat and tap <b>I've sent it — finish</b>."
        ].join("\n");
      }
      replyMarkup = {
        inline_keyboard: [[{ text: "Open Chat", web_app: { url: `${store}/?utm_source=telegram_chat#chat` } }]]
      };
      break;
    }

    case "support":
      reply = [
        "<b>Support</b>",
        "Track orders, payments, and channel questions here:",
        `📧 <code>${esc(email)}</code>`,
        `👤 Telegram: @${owner}`,
        `🤖 Payments bot: @${bot}`,
        "",
        officialLinksText(env)
      ].join("\n");
      replyMarkup = officialLinksKeyboard(env);
      break;

    case "pay":
      reply = premiumPayMessage({ bot, owner, email, store });
      replyMarkup = storeKeyboard(env);
      break;

    case "earn":
      reply = earnHelpMessage(env);
      replyMarkup = {
        inline_keyboard: [
          [{ text: "⭐ Shop with Stars", callback_data: "shop:menu" }],
          [{ text: "🔗 My referral link", url: `https://t.me/${bot}?start=ref_${from?.id || ""}` }],
          [{ text: "✨ Open Mini App", web_app: { url: miniAppUrl(env, "products") } }]
        ]
      };
      break;

    case "refer":
    case "invite": {
      const stats = await referralStats(env, from?.id);
      reply = [
        referMessage(env, from?.id || chatId),
        "",
        `${PX.chart} Referred: <b>${stats.count}</b> · Converted: <b>${stats.converted}</b>`
      ].join("\n");
      break;
    }

    case "tip": {
      if (!arg) {
        reply = tipPrompt(env);
        replyMarkup = {
          inline_keyboard: [[{ text: "⭐ Tip ~$1", callback_data: "earn:tip:1" }]]
        };
        break;
      }
      const tipUsd = Math.min(50, Math.max(0.5, Number(arg) || 1));
      const tipped = await createTipInvoice(env, {
        chatId,
        userId: from?.id,
        usd: tipUsd
      });
      reply = tipped.ok
        ? `${PX.star} Tip invoice sent (~$${tipUsd.toFixed(2)} · ${tipped.stars} ★). Tap Pay on the invoice.`
        : `${PX.warn} ${esc(tipped.error || "Tip failed")}`;
      break;
    }

    case "paysupport":
      reply = [
        premiumHeader("Payment support", PX.chat),
        premiumDivider(),
        "For USDT, Bitcoin, Paystack, or Telegram Stars purchases:",
        "",
        `${PX.mail} <code>${esc(email)}</code>`,
        `${PX.support} @${owner}`,
        `${PX.bot} @${bot}`,
        "",
        "Include your Order ID, payment method, and tx / charge id.",
        "<i>Telegram Support cannot refund bot purchases — contact us directly.</i>"
      ].join("\n");
      replyMarkup = officialLinksKeyboard(env);
      break;

    case "terms":
      reply = [
        premiumHeader("DTD Store terms", PX.lock),
        premiumDivider(),
        "Digital products are delivered after payment confirmation.",
        "Crypto: send only on the stated network (USDT = TRC20).",
        "Telegram Stars: digital goods sold in XTR per Telegram rules.",
        "No chargebacks on completed digital delivery except where required by law.",
        "By paying you agree to these terms and our support process (/paysupport).",
        "",
        `Company: ${esc(companyLabel)} · ${company}`,
        `Email: ${esc(email)} · Support: @${owner}`
      ].join("\n");
      break;

    case "secretary":
    case "sec":
    case "remind":
    case "reminders":
    case "inbox": {
      const sec = await handleSecretaryCommand(
        env,
        { cmd: command, arg, chatId, from },
        deps
      );
      if (sec) {
        reply = sec.text;
        replyMarkup = sec.reply_markup || null;
      }
      break;
    }

    case "app":
    case "mini": {
      reply = [
        premiumHeader("DTD Store Mini App", PX.spark),
        premiumDivider(),
        "Open the full storefront inside Telegram.",
        "",
        `${PX.bag} Browse products`,
        `${PX.gem} Checkout (USDT · BTC · Stars · Paystack)`,
        `${PX.package} Track orders`,
        "",
        `${PX.bot} Bot payments: @${bot}`,
        `${PX.mail} Email: ${email}`,
        `${PX.support} Support: @${owner}`,
        "",
        `${PX.link} Deep link: ${miniAppDeepLink(env, "shop")}`
      ].join("\n");
      replyMarkup = storeKeyboard(env);
      break;
    }

    case "order": {
      const parts = rest.filter(Boolean);
      const orderId = parts[0] || "";
      const email = parts[1] || "";
      if (!orderId || !email) {
        reply = [
          "<b>Track an order</b>",
          "Usage: <code>/order ORDER_ID email@example.com</code>",
          "",
          `Or website tracker: ${store}/#track`
        ].join("\n");
        break;
      }
      try {
        const supabase = getSupabase(env);
        if (!supabase) {
          reply = `Order lookup unavailable. Message @${owner}`;
          break;
        }
        const { data, error } = await supabase
          .from("orders")
          .select("id,payment_method,payment_status,payment_reference,total_usd,created_at,customer_email,customer_phone")
          .eq("id", orderId)
          .maybeSingle();
        if (error || !data) {
          reply = "Order not found. Check the ID and try again.";
          break;
        }
        const emailOk =
          String(data.customer_email || data.customer_phone || "")
            .trim()
            .toLowerCase() === email.trim().toLowerCase();
        if (!emailOk) {
          reply = "Email does not match this order.";
          break;
        }

        // Live re-verify pending Paystack payments so the tracker is accurate.
        if (
          data.payment_method === "Paystack" &&
          String(data.payment_status || "pending").toLowerCase() === "pending" &&
          data.payment_reference
        ) {
          const check = await verifyPaystackPayment(env, data.payment_reference);
          if (check.ok && check.state === "complete") {
            await updateOrderPayment(env, data.id, { payment_status: "paid" });
            data.payment_status = "paid";
          } else if (check.ok && check.state === "failed") {
            await updateOrderPayment(env, data.id, { payment_status: "failed" });
            data.payment_status = "failed";
          }
        }

        const view = paymentStatusView(data.payment_status);
        reply = [
          "<b>Order status</b>",
          `ID: <code>${esc(data.id)}</code>`,
          `Payment: ${view.icon} <b>${esc(view.label)}</b>`,
          `Method: ${esc(data.payment_method || "n/a")}`,
          `Total: $${Number(data.total_usd || 0).toFixed(2)}`,
          `Created: ${esc(data.created_at || "")}`,
          view.state === "not_finished"
            ? "\nPayment not completed yet. Finish checkout or contact support."
            : view.state === "failed"
              ? "\nPayment failed. Please retry checkout or contact support."
              : "\nPayment complete — delivery is being processed.",
          `Support: ${email} · @${owner}`
        ].join("\n");
      } catch {
        reply = `Could not look up order. Contact ${email} or @${owner}`;
      }
      break;
    }

    case "products":
    case "buy":
    case "shop": {
      const products = await loadShopProducts(env, getSupabase);
      const catalog = buildShopCatalogMessage(products, env);
      reply = catalog.text;
      replyMarkup = catalog.reply_markup;
      break;
    }

    case "status":
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      reply = [
        "<b>System status</b>",
        `Store: ${store}`,
        `Paystack key: ${env.PAYSTACK_PUBLIC_KEY ? "yes" : "missing"}`,
        `Paystack currency: ${env.PAYSTACK_CURRENCY || "KES"}`,
        `Supabase: ${env.SUPABASE_URL ? "yes" : "missing"}`,
        `Main channel: ${env.TELEGRAM_CHANNEL_ID || "missing"}`,
        `Backup channel: ${env.TELEGRAM_BACKUP_CHANNEL_ID || "none"}`,
        `Group: ${env.TELEGRAM_GROUP_ID || "none"}`,
        `Auto-approve joins: ${autoApproveJoinsEnabled(env) ? "ON" : "OFF"}`,
        `Owner: @${owner}`
      ].join("\n");
      break;

    case "stats":
    case "analytics": {
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      const summary = await analyticsSummary(env, getSupabase);
      if (summary.error) {
        reply = [
          "<b>📊 Store analytics</b>",
          `Could not load: ${esc(summary.error)}`,
          "",
          "If this is the first run, apply <code>supabase-analytics.sql</code> in Supabase,",
          "and set SUPABASE_SERVICE_ROLE_KEY in Cloudflare Pages."
        ].join("\n");
        break;
      }
      const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
      const topProducts = summary.topProducts.length
        ? summary.topProducts.map(([name, n], i) => `  ${i + 1}. ${esc(name)} — ${n} add(s)`).join("\n")
        : "  (no add-to-cart events yet)";
      const topReferrers = summary.topReferrers.length
        ? summary.topReferrers.map(([ref, n]) => `  • ${esc(ref)} — ${n}`).join("\n")
        : "  • (no referrers yet)";
      reply = [
        "<b>📊 DTD Store analytics</b>",
        "",
        "<b>Last 24h</b>",
        `👀 Views: ${summary.d1.views}`,
        `🧑 Visitors: ${summary.d1.visitors}`,
        `🛒 Add to cart: ${summary.d1.addToCart}`,
        `🧾 Checkouts started: ${summary.d1.checkouts}`,
        `✅ Purchases: ${summary.d1.purchases}`,
        `📦 Orders saved: ${summary.orders24}`,
        `💵 Revenue: ${fmt(summary.revenue24)}`,
        `📈 Conversion: ${conversionPct(summary.d1.purchases, summary.d1.visitors)}`,
        "",
        "<b>Last 7 days</b>",
        `👀 Views: ${summary.d7.views}`,
        `🧑 Visitors: ${summary.d7.visitors}`,
        `🛒 Add to cart: ${summary.d7.addToCart}`,
        `✅ Purchases: ${summary.d7.purchases}`,
        `📦 Orders saved: ${summary.orders7}`,
        `💵 Revenue: ${fmt(summary.revenue7)}`,
        `📈 Conversion: ${conversionPct(summary.d7.purchases, summary.d7.visitors)}`,
        "",
        "<b>Top products (7d)</b>",
        topProducts,
        "",
        "<b>Top traffic sources (7d)</b>",
        topReferrers,
        "",
        `Store: ${store}`
      ].join("\n");
      break;
    }

    case "config":
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      reply = [
        "<b>Public config</b>",
        `STORE_URL=${store}`,
        `COMPANY_URL=${company}`,
        `BOT=@${bot}`,
        `OWNER=@${owner}`,
        `CHANNEL=@${channel} (${env.TELEGRAM_CHANNEL_ID || "?"})`,
        `BACKUP=${env.TELEGRAM_BACKUP_CHANNEL_ID || "none"}`,
        `ADMIN_CHAT=${env.TELEGRAM_ADMIN_CHAT_ID || "?"}`,
        "",
        "<b>Official rewrite links</b>",
        officialLinksText(env)
      ].join("\n");
      break;

    case "orders": {
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      const result = await listOrders(env, getSupabase);
      if (result.error) {
        reply = `Could not load orders: ${esc(result.error)}`;
        break;
      }
      if (!result.orders.length) {
        reply = "No orders yet.";
        break;
      }
      reply = [
        "<b>Recent orders</b>",
        ...result.orders.map((o) => {
          const view = paymentStatusView(o.payment_status);
          return `${view.icon} <code>${String(o.id).slice(0, 8)}</code> ${esc(o.customer_name)} — $${Number(
            o.total_usd || 0
          ).toFixed(2)} — ${esc(o.payment_method)}`;
        }),
        "",
        "Details: /payments · verify one: /verify &lt;id&gt;"
      ].join("\n");
      break;
    }

    case "payments": {
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      const monitor = await paymentsMonitor(env, getSupabase);
      if (monitor.error) {
        reply = `Could not load payments: ${esc(monitor.error)}`;
        break;
      }
      if (!monitor.orders.length) {
        reply = "No orders yet.";
        break;
      }
      const counts = { complete: 0, failed: 0, not_finished: 0, refunded: 0 };
      const lines = monitor.orders.map((o) => {
        const view = paymentStatusView(o.payment_status);
        counts[view.state] = (counts[view.state] || 0) + 1;
        const shortId = String(o.id).slice(0, 8);
        return `${view.icon} <code>${shortId}</code> ${esc(o.customer_name || "")} — $${Number(
          o.total_usd || 0
        ).toFixed(2)} · ${esc(o.payment_method)}`;
      });
      reply = [
        "<b>💳 Payment monitor</b>",
        `✅ Complete: ${counts.complete}  ❌ Failed: ${counts.failed}  ⏳ Pending: ${counts.not_finished}` +
          (counts.refunded ? `  ↩️ Refunded: ${counts.refunded}` : ""),
        monitor.rechecked ? `🔄 Re-verified ${monitor.rechecked} pending Paystack payment(s)` : null,
        "",
        ...lines,
        "",
        "Verify one: /verify &lt;order id&gt;",
        "Mark manually: /paid &lt;id&gt; · /fail &lt;id&gt;"
      ]
        .filter((line) => line !== null)
        .join("\n");
      break;
    }

    case "verify": {
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      if (!arg) {
        reply = [
          "<b>Verify a payment</b>",
          "Usage: <code>/verify PAYSTACK_REF</code>",
          "or <code>/verify ORDER_ID</code>",
          "",
          "Paystack payments are checked live. Crypto (USDT / BTC) orders show their stored status."
        ].join("\n");
        break;
      }
      const outcome = await verifyPaymentByToken(env, getSupabase, arg.split(/\s+/)[0]);
      if (outcome.error) {
        reply = `⚠️ ${esc(outcome.error)}`;
        break;
      }
      const orderLine = outcome.order
        ? `Order: <code>${esc(outcome.order.id)}</code> — $${Number(outcome.order.total_usd || 0).toFixed(2)}`
        : null;
      if (outcome.live && outcome.result) {
        const stateIcon =
          outcome.result.state === "complete" ? "✅" : outcome.result.state === "failed" ? "❌" : "⏳";
        const stateLabel =
          outcome.result.state === "complete"
            ? "COMPLETE (paid)"
            : outcome.result.state === "failed"
              ? "FAILED"
              : "NOT FINISHED";
        reply = [
          "<b>💳 Payment verification</b>",
          `${stateIcon} <b>${stateLabel}</b>`,
          orderLine,
          `Gateway: Paystack (${esc(outcome.result.rawStatus || "?")})`,
          outcome.result.amount
            ? `Amount: ${Number(outcome.result.amount).toFixed(2)} ${esc(outcome.result.currency || "")}`
            : null,
          outcome.result.channel ? `Channel: ${esc(outcome.result.channel)}` : null,
          outcome.result.paidAt ? `Paid at: ${esc(outcome.result.paidAt)}` : null,
          `Ref: <code>${esc(outcome.reference)}</code>`,
          outcome.order ? "Order status synced." : "No matching order found for this ref."
        ]
          .filter(Boolean)
          .join("\n");
      } else {
        reply = [
          "<b>💳 Payment status</b>",
          `${outcome.view.icon} <b>${esc(outcome.view.label)}</b>`,
          orderLine,
          `Method: ${esc(outcome.method || "n/a")}`,
          outcome.note ? esc(outcome.note) : null
        ]
          .filter(Boolean)
          .join("\n");
      }
      break;
    }

    case "paid":
    case "fail": {
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      const targetId = arg.split(/\s+/)[0];
      if (!targetId) {
        reply = `Usage: /${command} ORDER_ID`;
        break;
      }
      const status = command === "paid" ? "paid" : "failed";
      const outcome = await setOrderStatus(env, getSupabase, targetId, status);
      if (outcome.error) {
        reply = `⚠️ ${esc(outcome.error)}`;
        break;
      }
      const view = paymentStatusView(outcome.order.payment_status);
      reply = [
        "<b>Payment status updated</b>",
        `${view.icon} <b>${esc(view.label)}</b>`,
        `Order: <code>${esc(outcome.order.id)}</code>`,
        `Customer: ${esc(outcome.order.customer_name || "")}`,
        `Amount: $${Number(outcome.order.total_usd || 0).toFixed(2)}`,
        `Method: ${esc(outcome.order.payment_method || "n/a")}`
      ].join("\n");
      break;
    }

    case "post": {
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      if (!arg) {
        reply = "Usage: /post Your announcement text";
        break;
      }
      const message = [
        `${PX.crown} <b>DTD MAIN STORE</b>`,
        premiumDivider(),
        arg,
        "",
        `${PX.bot} Pay / Mini App: @${bot}`,
        `${PX.cart} ${store}`,
        `${PX.channel} Channel: @${channel}`,
        `${PX.gem} Pay: USDT (TRC20) · BTC · Paystack`,
        `${PX.mail} ${email}`,
        `${PX.support} Support: @${owner}`
      ].join("\n");
      const targets = [
        env.TELEGRAM_CHANNEL_ID,
        env.TELEGRAM_BACKUP_CHANNEL_ID,
        env.TELEGRAM_GROUP_ID
      ].filter((id, i, arr) => id && arr.indexOf(id) === i);
      let sent = 0;
      const keyboard = miniAppChannelKeyboard(env);
      for (const target of targets) {
        const result = await sendTelegram(env, target, message, { reply_markup: keyboard });
        if (result.ok) {
          sent += 1;
          const mid = result.result?.message_id;
          if (mid) await reactToMessage(env, target, mid, "🔥");
        }
      }
      reply = sent
        ? `${PX.check} Posted to ${sent} channel(s) with Mini App buttons + reaction.`
        : "Post failed. Check bot admin rights on the channel(s).";
      break;
    }

    case "autojoin": {
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      const mode = arg.toLowerCase();
      if (mode === "on" || mode === "off") {
        reply = [
          `<b>Auto-approve joins</b>`,
          `Requested: <b>${mode.toUpperCase()}</b>`,
          "",
          "To persist this, set in Cloudflare / .env:",
          `<code>TELEGRAM_AUTO_APPROVE_JOINS=${mode === "on" ? "true" : "false"}</code>`,
          "Then redeploy.",
          "",
          `Current runtime value: <b>${autoApproveJoinsEnabled(env) ? "ON" : "OFF"}</b>`
        ].join("\n");
      } else {
        reply = [
          `<b>Auto-approve joins:</b> ${autoApproveJoinsEnabled(env) ? "ON" : "OFF"}`,
          "",
          "Usage: /autojoin on   or   /autojoin off",
          "Bot must be channel/group admin with <b>Invite Users</b> permission.",
          "Enable “Approve new members” / join requests on the channel or group."
        ].join("\n");
      }
      break;
    }

    case "mods": {
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      reply = [
        "<b>Channel / group bot setup</b>",
        "",
        `1. Add <b>@${bot}</b> as admin`,
        "2. Enable permissions:",
        "   • Post messages",
        "   • Invite users via link (needed to auto-accept joins)",
        "   • Manage invite links (optional)",
        "3. Turn on join requests / Approve new members",
        "4. Optional co-admin: @davistechbot (manual human backup)",
        "",
        `Owner contact: @${owner}`,
        `Store: ${store}`,
        `Auto-approve: ${autoApproveJoinsEnabled(env) ? "ON" : "OFF"}`,
        `Channel→group mirror: ${channelMirrorEnabled(env) ? "ON" : "OFF"}`
      ].join("\n");
      break;
    }

    case "mirror": {
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      const sources = mirrorSourceIds(env);
      const target = mirrorTargetId(env);
      reply = [
        "<b>Channel → group mirror</b>",
        `Status: <b>${channelMirrorEnabled(env) ? "ON" : "OFF"}</b>`,
        `From channel(s): ${sources.map((id) => `<code>${esc(id)}</code>`).join(", ") || "none"}`,
        `To group: <code>${esc(target) || "missing TELEGRAM_GROUP_ID"}</code>`,
        `Bot: @${bot}`,
        "",
        "Requirements:",
        `1. @${bot} admin in the SOURCE channel (so it receives posts)`,
        `2. @${bot} can post in the TARGET group`,
        "3. Env TELEGRAM_CHANNEL_MIRROR=true",
        "",
        "Note: @Realdialer / 7402702663 is a <b>user</b> ID, not a channel.",
        "If mirroring a different channel, send its -100… ID."
      ].join("\n");
      break;
    }

    default:
      reply = `Unknown command. Try /help\nStore: ${store}\nEmail: ${email}\nSupport: @${owner}`;
  }

  if (!reply) return null;
  if (replyMarkup) return { text: reply, reply_markup: replyMarkup };
  return reply;
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

async function handleJoinRequest(env, request, deps) {
  if (!autoApproveJoinsEnabled(env)) {
    return { handled: true, approved: false, reason: "disabled" };
  }

  const chatId = request.chat?.id;
  const userId = request.from?.id;
  if (!chatId || !userId) return { handled: false };

  const result = await telegramApi(env, "approveChatJoinRequest", {
    chat_id: chatId,
    user_id: userId
  });

  const store = storeUrl(env);
  const owner = ownerHandle(env);
  const email = supportEmail(env);
  const name = [request.from?.first_name, request.from?.last_name].filter(Boolean).join(" ") || "there";

  if (result.ok) {
    // Soft welcome DM (ignore failure if user hasn't started the bot)
    await telegramApi(env, "sendMessage", {
      chat_id: userId,
      text: [
        `<b>Welcome to DTD, ${esc(name)}!</b>`,
        "",
        "You're in. Shop digital products here:",
        store,
        "",
        `Email: ${email}`,
        `Support: @${owner}`,
        "Bot help: /start"
      ].join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true
    }).catch(() => {});

    if (env.TELEGRAM_ADMIN_CHAT_ID) {
      await deps.sendTelegram(
        env,
        env.TELEGRAM_ADMIN_CHAT_ID,
        [
          "<b>Join approved</b>",
          `User: ${esc(name)} (@${esc(request.from?.username || "n/a")})`,
          `Chat: <code>${chatId}</code>`
        ].join("\n")
      );
    }
  }

  return { handled: true, approved: Boolean(result.ok), error: result.description };
}

async function handleChannelPost(env, post) {
  if (!channelMirrorEnabled(env) || !post?.chat?.id || !post.message_id) {
    return { handled: false };
  }

  const sourceId = String(post.chat.id);
  const sources = mirrorSourceIds(env);
  if (!sources.includes(sourceId)) {
    return { handled: false, reason: "source_not_configured" };
  }

  const target = mirrorTargetId(env);
  if (!target) return { handled: false, reason: "missing_target" };
  if (String(target) === sourceId) return { handled: false, reason: "same_chat" };

  // Prefer copy so the group gets a clean post; fall back to forward.
  let result = await telegramApi(env, "copyMessage", {
    chat_id: target,
    from_chat_id: sourceId,
    message_id: post.message_id
  });

  if (!result.ok) {
    result = await telegramApi(env, "forwardMessage", {
      chat_id: target,
      from_chat_id: sourceId,
      message_id: post.message_id
    });
  }

  return {
    handled: true,
    mirrored: Boolean(result.ok),
    error: result.ok ? undefined : result.description
  };
}

async function handleNewMembers(env, message, deps) {
  const members = message.new_chat_members || [];
  if (!members.length) return { handled: false };

  const store = storeUrl(env);
  const owner = ownerHandle(env);
  const email = supportEmail(env);
  const bot = botUsername(env);
  const names = members
    .filter((m) => !m.is_bot)
    .map((m) => m.username ? `@${m.username}` : m.first_name)
    .filter(Boolean);

  if (!names.length) return { handled: true };

  await deps.sendTelegram(
    env,
    message.chat.id,
    [
      `<b>Welcome ${esc(names.join(", "))}!</b>`,
      "",
      `🛒 Store: ${store}`,
      `🤖 Help: @${bot} → /start`,
      `📧 Email: ${email}`,
      `👤 Support: @${owner}`
    ].join("\n")
  );

  return { handled: true };
}

async function handleTradeCallback(env, query, deps) {
  const data = String(query.data || "");
  if (!data.startsWith("trade:")) return { handled: false };

  const chatId = query.message?.chat?.id || query.from?.id;
  await telegramApi(env, "answerCallbackQuery", { callback_query_id: query.id });

  if (!chatId) return { handled: true };

  try {
    if (data === "trade:ticker") {
      const text = await formatTickerWatchlist();
      await deps.sendTelegram(env, chatId, text, { reply_markup: tradeKeyboard(env) });
      return { handled: true };
    }
    if (data.startsWith("trade:price:")) {
      const symbol = data.split(":")[2] || "BTCUSDT";
      const text = await formatPriceReply(symbol);
      await deps.sendTelegram(env, chatId, text, { reply_markup: tradeKeyboard(env) });
      return { handled: true };
    }
  } catch (err) {
    await deps.sendTelegram(env, chatId, `Trading bot error: ${esc(err.message || "failed")}`);
  }
  return { handled: true };
}

export async function processTelegramUpdate(env, update, deps) {
  // Lazy reminder scheduler — fires due secretary reminders on traffic.
  try {
    await processDueReminders(env, deps);
  } catch {
    /* non-fatal */
  }

  if (update.pre_checkout_query) {
    return answerStarsPreCheckout(env, update.pre_checkout_query);
  }

  if (update.chat_join_request) {
    return handleJoinRequest(env, update.chat_join_request, deps);
  }

  if (update.channel_post || update.edited_channel_post) {
    return handleChannelPost(env, update.channel_post || update.edited_channel_post);
  }

  if (update.callback_query) {
    const data = String(update.callback_query.data || "");
    if (data.startsWith("sec:")) {
      return handleSecretaryCallback(env, update.callback_query, deps);
    }
    if (data.startsWith("earn:tip:")) {
      const usd = Number(data.split(":")[2] || 1) || 1;
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: update.callback_query.id })
      }).catch(() => null);
      const tip = await createTipInvoice(env, {
        chatId: update.callback_query.message?.chat?.id,
        userId: update.callback_query.from?.id,
        usd
      });
      if (!tip.ok) {
        await deps.sendTelegram(
          env,
          update.callback_query.message?.chat?.id,
          `${PX.warn} ${tip.error || "Tip failed"}`
        );
      }
      return { handled: true };
    }
    const tradeCb = await handleTradeCallback(env, update.callback_query, deps);
    if (tradeCb?.handled) return tradeCb;
    const shop = await handleShopCallback(env, update.callback_query, deps);
    if (shop?.handled) return shop;
    return { handled: false };
  }

  const message = update.message || update.edited_message;
  if (!message?.chat?.id) return { handled: false };

  if (message.successful_payment) {
    return handleStarsSuccessfulPayment(env, message, deps);
  }

  if (message.new_chat_members?.length) {
    await handleNewMembers(env, message, deps);
  }

  if (!message.text) return { handled: Boolean(message.new_chat_members?.length) };

  // In-bot checkout replies (email / BTC tx) before slash commands.
  if (!message.text.trim().startsWith("/") || message.text.trim().toLowerCase().startsWith("/tx ")) {
    const shopReply = await handleShopText(
      env,
      {
        text: message.text,
        chatId: message.chat.id,
        from: message.from
      },
      deps
    );
    if (shopReply) {
      if (typeof shopReply === "object" && shopReply.text) {
        await deps.sendTelegram(env, message.chat.id, shopReply.text, {
          reply_markup: shopReply.reply_markup
        });
      } else {
        await deps.sendTelegram(env, message.chat.id, shopReply);
      }
      return { handled: true };
    }
  }

  const reply = await handleBotCommand(
    env,
    {
      text: message.text,
      chatId: message.chat.id,
      from: message.from
    },
    deps
  );

  if (!reply) return { handled: false };

  if (typeof reply === "object" && reply.text) {
    await deps.sendTelegram(env, message.chat.id, reply.text, {
      reply_markup: reply.reply_markup
    });
  } else {
    await deps.sendTelegram(env, message.chat.id, reply);
  }
  return { handled: true };
}
