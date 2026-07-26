/**
 * Premium Telegram presentation helpers for @Dtdpaymentbot + channel copy.
 * Uses rich HTML + curated emoji. Optional custom emoji IDs via env
 * (TG_EMOJI_*) if set in Pages secrets later — never required.
 */

export const PX = {
  spark: "✨",
  fire: "🔥",
  rocket: "🚀",
  crown: "👑",
  gem: "💎",
  bolt: "⚡",
  star: "🌟",
  check: "✅",
  warn: "⚠️",
  clock: "⏳",
  usdt: "₮",
  btc: "₿",
  card: "💳",
  phone: "📱",
  bank: "🏦",
  cart: "🛒",
  bag: "🛍️",
  package: "📦",
  bot: "🤖",
  chat: "💬",
  mail: "📧",
  support: "👤",
  web: "🌐",
  company: "🏢",
  channel: "📢",
  lock: "🔐",
  qr: "📲",
  money: "💵",
  chart: "📈",
  link: "🔗",
  pin: "📌",
  wave: "👋",
  party: "🎉",
  target: "🎯",
  key: "🔑",
  inbox: "📥",
  outbox: "📤",
  live: "🔴"
};

/** Visual “color shades” via Telegram-safe emoji (no CSS in bot messages). */
export const COLORS = ["🔵", "🔴", "🟢", "🟡", "🟣", "🟠", "🩵", "🩷"];

export function colorDot(index = 0) {
  return COLORS[Math.abs(Number(index) || 0) % COLORS.length];
}

export function colorPaletteLine() {
  return "🔵 🔴 🟢 🟡 🟣 🟠";
}

export function premiumBanner(title, subtitle = "") {
  return [
    `${PX.crown} <b>${title}</b> ${PX.spark}`,
    colorPaletteLine(),
    premiumDivider(),
    subtitle ? `<blockquote>${subtitle}</blockquote>` : null
  ]
    .filter(Boolean)
    .join("\n");
}

/** Optional Bot API custom emoji: <tg-emoji emoji-id="…">fallback</tg-emoji> */
export function premiumEmoji(env, key, fallback) {
  const id = String(env?.[`TG_EMOJI_${String(key || "").toUpperCase()}`] || "").trim();
  const fb = fallback || PX.spark;
  if (!id || !/^\d+$/.test(id)) return fb;
  return `<tg-emoji emoji-id="${id}">${fb}</tg-emoji>`;
}

export function premiumDivider() {
  return "━━━━━━━━━━━━━━━━━━━━";
}

export function premiumRule() {
  return "────────────────";
}

export function premiumHeader(title, emoji = PX.spark) {
  return `${emoji} <b><u>${title}</u></b>`;
}

/** Bold + underlined section title (Telegram can’t do real text colors). */
export function premiumTitle(title, emoji = "") {
  const e = emoji ? `${emoji} ` : "";
  return `${e}<b><u>${title}</u></b>`;
}

/** Highlighted subtitle / description paragraph. */
export function premiumSubtitle(text) {
  const clean = String(text || "").trim();
  if (!clean) return "";
  return `<blockquote><i>${clean}</i></blockquote>`;
}

/** Label (bold) + value on one line. */
export function premiumField(label, value) {
  return `<b>${label}</b>\n${value}`;
}

/** Compact product “card” for checkout / pay screens. */
export function premiumProductCard({ title, subtitle = "", priceUsd = null, extra = [] }) {
  const lines = [
    premiumTitle(title, PX.bag),
    subtitle ? premiumSubtitle(subtitle) : null,
    priceUsd != null ? `${PX.money} <b>Price:</b> <code>$${Number(priceUsd).toFixed(2)} USD</code>` : null,
    ...(Array.isArray(extra) ? extra.filter(Boolean) : [])
  ].filter(Boolean);
  return lines.join("\n");
}

export function premiumSection(title, lines = [], emoji = PX.pin) {
  const body = (Array.isArray(lines) ? lines : [lines])
    .filter((line) => line != null && String(line).trim() !== "")
    .map((line) => `• ${line}`)
    .join("\n");
  return [premiumTitle(title, emoji), body].filter(Boolean).join("\n");
}

export function premiumSteps(title, steps = [], emoji = PX.target) {
  const body = steps
    .filter(Boolean)
    .map((step, i) => `${numberEmoji(i + 1)} ${step}`)
    .join("\n");
  return [`${emoji} <b>${title}</b>`, body].filter(Boolean).join("\n");
}

export function numberEmoji(n) {
  const map = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  return map[n] || `${n}.`;
}

export function premiumQuote(text) {
  const clean = String(text || "").trim();
  if (!clean) return "";
  return `<blockquote>${clean}</blockquote>`;
}

export function premiumFooterLines(env) {
  const bot = String(env.TELEGRAM_BOT_USERNAME || "Dtdpaymentbot").replace(/^@/, "");
  const owner = String(env.TELEGRAM_OWNER_USERNAME || "Davetheedev").replace(/^@/, "");
  const email = String(env.SUPPORT_EMAIL || "contact@dvtechnologies.xyz").trim().toLowerCase();
  const store = String(env.STORE_URL || "https://dtdpaymentsbot.pages.dev").replace(/\/$/, "");
  const company = String(env.COMPANY_URL || "https://dvtechnologies.xyz").replace(/\/$/, "");
  const channel = String(env.TELEGRAM_CHANNEL_USERNAME || "DTDMAINSTORE").replace(/^@/, "");
  return [
    `${PX.bot} Pay / Mini App: @${bot}`,
    `${PX.cart} Web store: ${store}`,
    `${PX.channel} Channel: @${channel}`,
    `${PX.company} DV Tech: ${company}`,
    `${PX.mail} Email: ${email}`,
    `${PX.support} Support: @${owner}`
  ];
}

export function premiumWelcomeMessage({
  env,
  companyLabel,
  bot,
  owner,
  email,
  store,
  products = []
}) {
  const list = Array.isArray(products) ? products.slice(0, 8) : [];
  const productBlock = list.length
    ? list.map((p, i) => {
        const name = String(p.name || "Product").slice(0, 36);
        const price = Number(p.price_usd || 0).toFixed(0);
        return `${colorDot(i)}  <b>${name}</b>   <code>$${price}</code>`;
      })
    : [`${PX.warn} No products loaded — tap <b>🔴 PRODUCTS · Buy in this chat</b>`];

  return [
    `${PX.crown} <b>DTD MAIN STORE</b> ${PX.spark}`,
    premiumDivider(),
    `<blockquote>Blue · Green · Red buttons (Telegram styled) — tap Products or a product row</blockquote>`,
    "",
    `🏢 <b>${companyLabel}</b>`,
    `${PX.usdt} USDT  ·  ${PX.btc} BTC  ·  ${PX.star} Stars  ·  ${PX.card} Paystack`,
    "",
    `<b>Live products</b>`,
    ...productBlock,
    "",
    `🛍 <b>Products</b> — open catalog / buy in chat`,
    `🛒 <b>Orders</b> — checkout · track`,
    `💳 <b>Pay</b> — USDT · BTC · Stars · Card · Local USSD`,
    "",
    `${PX.bot} @${bot}  ·  ${PX.support} @${owner}`,
    `${PX.mail} ${email}`,
    `${PX.web} ${store}`
  ].join("\n");
}

export function premiumPayMessage({ bot, owner, email, store }) {
  return [
    premiumHeader("Payment methods", PX.money),
    premiumDivider(),
    "",
    premiumSteps("How crypto works with the bot", [
      "/buy → tap a product",
      `Choose ${PX.usdt} USDT (TRC20) or ${PX.btc} Bitcoin`,
      `${PX.qr} Scan QR or copy the address`,
      "Send the exact amount on the correct network",
      "Paste your tx hash → send delivery email"
    ]),
    "",
    `${PX.usdt} <b>USDT (TRC20)</b> — preferred`,
    "• Send USDT only on Tron (TRC20)",
    "• Wallet + QR shown at checkout",
    "",
    `${PX.btc} <b>Bitcoin</b>`,
    "• Send BTC to the DTD wallet at checkout",
    "",
    `${PX.star} <b>Telegram Stars</b>`,
    "• Pay inside Telegram — instant digital checkout",
    "• Stars go to your bot balance → Ads or Fragment",
    "",
    `${PX.card} <b>Paystack</b> — USD priced`,
    "• Card / Bank = global",
    "• Local · USSD / M-Pesa under Local menu",
    "",
    `${PX.rocket} Start: <b>/app</b> (Mini App) or <b>/buy</b> (in-bot)`,
    `${PX.bot} @${bot}`,
    `${PX.web} ${store}/#checkout`,
    `${PX.package} Track: /order &lt;id&gt; &lt;email&gt;`,
    `${PX.mail} ${email}`,
    `${PX.support} @${owner}`
  ].join("\n");
}

export function premiumChannelPromoVariants(linksBlock) {
  const block = String(linksBlock || "").trim();
  return [
    `${PX.crown} <b>DTD MAIN STORE</b> ${PX.spark}\n${premiumDivider()}\nDigital products with fast delivery.\nPay ${PX.usdt} USDT (TRC20) · ${PX.btc} BTC · ${PX.card} Paystack\n\n${block}`,
    `${PX.fire} Fresh drop energy — shop DTD today.\nBrowse → pay → get delivery.\nPreferred crypto: <b>USDT on Tron (TRC20)</b>.\n\n${block}`,
    `${PX.bot} Prefer Telegram checkout?\nOpen the bot → /buy → scan QR → paste tx hash → send delivery email.\n\n${block}`,
    `${PX.gem} Why people stay with DTD:\nclear pricing · USDT/BTC/Paystack · tracked delivery · real support.\n\n${block}`,
    `${PX.rocket} Mini App + in-chat shop.\nOne brand. One payments bot. Smooth from cart to inbox.\n\n${block}`,
    `${PX.live} LIVE store updates on this channel.\nSave the links — shop anytime:\n\n${block}`,
    `${PX.party} Thanks for being in the DTD community.\nShare with a friend who needs digital products + proper delivery.\n\n${block}`,
    `${PX.bolt} Short version of DTD 👇\n${block}\n\n${PX.pin} Save this message.`
  ];
}

/** Standard emoji reactions (Bot API) — no custom Premium pack required. */
export async function reactToMessage(env, chatId, messageId, emoji = "🔥") {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !messageId) return { ok: false };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/setMessageReaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: "emoji", emoji: String(emoji || "🔥") }]
      })
    });
    return response.json();
  } catch (error) {
    return { ok: false, description: String(error?.message || error) };
  }
}
