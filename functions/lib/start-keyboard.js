/**
 * /start keyboard — section layout + real blue/green/red button styles (Bot API 9.4+).
 */

import { miniAppUrl, miniAppBaseUrl, ownerUsername, botUsername } from "./mini-app.js";
import { blue, green, red, productStyle, styled } from "./tg-buttons.js";

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
    // PRODUCTS — blue like screenshot top row
    [
      blue({ text: "🛍 Products", web_app: { url: miniAppUrl(env, "products") } }),
      blue({ text: "💳 Buy in chat", callback_data: "shop:menu" })
    ]
  ];

  // Live products — cycle blue / green / red
  list.forEach((p, i) => {
    if (!p?.id) return;
    rows.push([
      styled(
        {
          text: `${truncate(p.name)} · ${money(p.price_usd)}`,
          callback_data: `shop:p:${p.id}`
        },
        productStyle(i)
      )
    ]);
  });

  rows.push(
    // ORDERS — green like screenshot middle row
    [
      green({ text: "🛒 Checkout", web_app: { url: miniAppUrl(env, "checkout") } }),
      green({ text: "📦 Track order", web_app: { url: miniAppUrl(env, "track") } })
    ],
    // PAY — blue + green
    [
      blue({ text: "₮ USDT / ₿ BTC", callback_data: "shop:menu" }),
      green({ text: "⭐ Stars", callback_data: "shop:menu" })
    ],
    // Rules / paystack — red full width like screenshot bottom
    [red({ text: "‼️ Pay · Card / M-Pesa", callback_data: "shop:menu" })],
    // MORE — blue + green
    [
      blue({ text: "📈 Trade", web_app: { url: miniAppUrl(env, "trade") } }),
      green({ text: "💬 Chat", web_app: { url: miniAppUrl(env, "chat") } })
    ],
    [
      green({ text: "📢 Channel", url: `https://t.me/${channel}` }),
      blue({ text: "🎧 Support", url: `https://t.me/${owner}` })
    ],
    [
      blue({ text: "🌐 Website", url: store }),
      red({ text: "⭐ Earn / Ads", url: `https://t.me/${bot}?start=earn` })
    ]
  );

  return { inline_keyboard: rows };
}
