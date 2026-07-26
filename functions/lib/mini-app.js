/**
 * Telegram Mini App helpers — storefront opens inside Telegram.
 * Private chats: web_app buttons. Channels/groups: t.me deep links + HTTPS URLs.
 */

import { blue, green, red } from "./tg-buttons.js";

export function miniAppBaseUrl(env) {
  return String(env.STORE_URL || "https://dtdpaymentsbot.pages.dev").replace(/\/$/, "");
}

export function botUsername(env) {
  return String(env.TELEGRAM_BOT_USERNAME || "Dtdpaymentbot").replace(/^@/, "");
}

export function ownerUsername(env) {
  return String(env.TELEGRAM_OWNER_USERNAME || "Davetheedev").replace(/^@/, "");
}

/** HTTPS path inside the Mini App (hash pages on the storefront). */
export function miniAppUrl(env, page = "home") {
  const base = miniAppBaseUrl(env);
  const safe = String(page || "home").replace(/[^a-z0-9_-]/gi, "") || "home";
  if (safe === "home") return `${base}/?utm_source=telegram_miniapp`;
  return `${base}/?utm_source=telegram_miniapp#${safe}`;
}

/** Deep link that launches the bot Mini App with a start param (channels/groups). */
export function miniAppDeepLink(env, startParam = "shop") {
  const bot = botUsername(env);
  const param = encodeURIComponent(String(startParam || "shop").slice(0, 64));
  return `https://t.me/${bot}?startapp=${param}`;
}

export function miniAppMenuButton(env) {
  return {
    type: "web_app",
    text: "✨ DTD Store",
    web_app: { url: miniAppUrl(env, "home") }
  };
}

/**
 * Inline keyboard for private bot chats (supports web_app).
 * Falls back gracefully if Telegram client is old.
 */
export function miniAppPrivateKeyboard(env) {
  const owner = ownerUsername(env);
  const channel = String(env.TELEGRAM_CHANNEL_USERNAME || "DTDMAINSTORE").replace(/^@/, "");
  return {
    inline_keyboard: [
      [
        blue({ text: "🛍 Products", web_app: { url: miniAppUrl(env, "products") } }),
        blue({ text: "💳 Buy in chat", callback_data: "shop:menu" })
      ],
      [
        green({ text: "🛒 Checkout", web_app: { url: miniAppUrl(env, "checkout") } }),
        green({ text: "📦 Track order", web_app: { url: miniAppUrl(env, "track") } })
      ],
      [
        blue({ text: "₮ USDT / ₿ BTC", callback_data: "shop:menu" }),
        green({ text: "⭐ Stars", callback_data: "shop:menu" })
      ],
      [red({ text: "‼️ Pay · Card / M-Pesa", callback_data: "shop:menu" })],
      [
        blue({ text: "📈 Trade", web_app: { url: miniAppUrl(env, "trade") } }),
        green({ text: "💬 Chat", web_app: { url: miniAppUrl(env, "chat") } })
      ],
      [
        green({ text: "📢 Channel", url: `https://t.me/${channel}` }),
        blue({ text: "🎧 Support", url: `https://t.me/${owner}` })
      ],
      [blue({ text: "🌐 Website", url: miniAppBaseUrl(env) })]
    ]
  };
}

/** Inline keyboard safe for channels / groups (url buttons only). */
export function miniAppChannelKeyboard(env) {
  const bot = botUsername(env);
  const owner = ownerUsername(env);
  const store = miniAppBaseUrl(env);
  const channel = String(env.TELEGRAM_CHANNEL_USERNAME || "DTDMAINSTORE").replace(/^@/, "");
  return {
    inline_keyboard: [
      [blue({ text: "🛍 Open shop", url: miniAppDeepLink(env, "shop") })],
      [
        green({ text: "🛒 Catalog", url: `${store}/#products` }),
        blue({ text: `🤖 @${bot}`, url: `https://t.me/${bot}?start=buy` })
      ],
      [
        green({ text: "📢 Channel", url: `https://t.me/${channel}` }),
        blue({ text: "🎧 Support", url: `https://t.me/${owner}` })
      ],
      [red({ text: "‼️ Pay guide", url: `https://t.me/${bot}?start=pay` })]
    ]
  };
}

export function mergeKeyboards(...boards) {
  const rows = [];
  for (const board of boards) {
    if (board?.inline_keyboard?.length) rows.push(...board.inline_keyboard);
  }
  return { inline_keyboard: rows };
}
