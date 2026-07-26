/**
 * /start keyboard — section-named buttons with strong color markers.
 * Note: Telegram cannot color button backgrounds; colors = leading emoji only.
 */

import { miniAppUrl, miniAppBaseUrl, ownerUsername, botUsername } from "./mini-app.js";
import { COLORS } from "./tg-premium.js";

function money(n) {
  return `$${Number(n || 0).toFixed(0)}`;
}

function truncate(text, max = 22) {
  const s = String(text || "").trim().replace(/\s+/g, " ");
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * @param {object} env
 * @param {Array<{id:string,name:string,price_usd:number}>} products
 */
export function buildPremiumStartKeyboard(env, products = []) {
  const owner = ownerUsername(env);
  const bot = botUsername(env);
  const store = miniAppBaseUrl(env);
  const channel = String(env.TELEGRAM_CHANNEL_USERNAME || "DTDMAINSTORE").replace(/^@/, "");
  const list = Array.isArray(products) ? products.slice(0, 8) : [];

  const rows = [
    // —— PRODUCTS section ——
    [{ text: "🔵 PRODUCTS · Open catalog", web_app: { url: miniAppUrl(env, "products") } }],
    [{ text: "🔴 PRODUCTS · Buy in this chat", callback_data: "shop:menu" }]
  ];

  list.forEach((p, i) => {
    if (!p?.id) return;
    const dot = COLORS[i % COLORS.length];
    rows.push([
      {
        text: `${dot} PRODUCTS · ${truncate(p.name)} · ${money(p.price_usd)}`,
        callback_data: `shop:p:${p.id}`
      }
    ]);
  });

  rows.push(
    // —— ORDERS section ——
    [
      { text: "🟣 ORDERS · Checkout", web_app: { url: miniAppUrl(env, "checkout") } },
      { text: "🟠 ORDERS · Track", web_app: { url: miniAppUrl(env, "track") } }
    ],
    // —— PAY section ——
    [
      { text: "🩵 PAY · USDT / BTC", callback_data: "shop:menu" },
      { text: "🩷 PAY · Stars", callback_data: "shop:menu" }
    ],
    [{ text: "🟤 PAY · Card / M-Pesa", callback_data: "shop:menu" }],
    // —— MORE section ——
    [
      { text: "🟢 MORE · Trade", web_app: { url: miniAppUrl(env, "trade") } },
      { text: "🟡 MORE · Chat", web_app: { url: miniAppUrl(env, "chat") } }
    ],
    [
      { text: `📢 MORE · Channel`, url: `https://t.me/${channel}` },
      { text: `💬 MORE · Support`, url: `https://t.me/${owner}` }
    ],
    [
      { text: "🌐 MORE · Website", url: store },
      { text: "⭐ MORE · Earn", url: `https://t.me/${bot}?start=earn` }
    ]
  );

  return { inline_keyboard: rows };
}
