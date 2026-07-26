/**
 * Rich /start inline keyboard — Mini App products + live product buttons + pay shortcuts.
 */

import { miniAppUrl, miniAppBaseUrl, ownerUsername, botUsername } from "./mini-app.js";
import { COLORS, PX } from "./tg-premium.js";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function truncate(text, max = 28) {
  const s = String(text || "").trim();
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
  const list = Array.isArray(products) ? products.slice(0, 6) : [];

  const rows = [
    [{ text: "🔵✨ Mini App · Products", web_app: { url: miniAppUrl(env, "products") } }],
    [
      { text: "🔴 Checkout", web_app: { url: miniAppUrl(env, "checkout") } },
      { text: "🟢 Track", web_app: { url: miniAppUrl(env, "track") } }
    ],
    [
      { text: "🛍️ /buy in chat", callback_data: "shop:menu" },
      { text: "📋 Full catalog", callback_data: "shop:menu" }
    ]
  ];

  if (list.length) {
    rows.push([{ text: "──────── live products ────────", callback_data: "shop:menu" }]);
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      const dot = COLORS[i % COLORS.length];
      if (!p?.id) continue;
      rows.push([
        {
          text: `${dot} ${truncate(p.name)} · ${money(p.price_usd)}`,
          callback_data: `shop:p:${p.id}`
        }
      ]);
    }
  }

  rows.push(
    [
      { text: "💎 ₮ USDT / ₿ BTC", callback_data: "shop:menu" },
      { text: "⭐ Stars pay", callback_data: "shop:menu" }
    ],
    [
      { text: "💳 Paystack", callback_data: "shop:menu" },
      { text: "📈 Trade", web_app: { url: miniAppUrl(env, "trade") } }
    ],
    [
      { text: `📢 @${channel}`, url: `https://t.me/${channel}` },
      { text: `💬 @${owner}`, url: `https://t.me/${owner}` }
    ],
    [
      { text: "🌐 Web store", url: store },
      { text: `🤖 @${bot}`, url: `https://t.me/${bot}` }
    ],
    [
      { text: `${PX.star} Earn / Ads`, url: `https://t.me/${bot}?start=earn` },
      { text: `${PX.chat} Chat`, web_app: { url: miniAppUrl(env, "chat") } }
    ]
  );

  return { inline_keyboard: rows };
}
