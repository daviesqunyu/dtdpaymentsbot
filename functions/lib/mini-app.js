/**
 * Telegram Mini App helpers — storefront opens inside Telegram.
 * Private chats: web_app buttons. Channels/groups: t.me deep links + HTTPS URLs.
 */

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
      [{ text: "🔵 PRODUCTS · Open catalog", web_app: { url: miniAppUrl(env, "products") } }],
      [{ text: "🔴 PRODUCTS · Buy in this chat", callback_data: "shop:menu" }],
      [
        { text: "🟣 ORDERS · Checkout", web_app: { url: miniAppUrl(env, "checkout") } },
        { text: "🟠 ORDERS · Track", web_app: { url: miniAppUrl(env, "track") } }
      ],
      [
        { text: "🩵 PAY · Crypto", callback_data: "shop:menu" },
        { text: "🩷 PAY · Stars", callback_data: "shop:menu" }
      ],
      [
        { text: "🟢 MORE · Trade", web_app: { url: miniAppUrl(env, "trade") } },
        { text: "🟡 MORE · Chat", web_app: { url: miniAppUrl(env, "chat") } }
      ],
      [
        { text: "📢 MORE · Channel", url: `https://t.me/${channel}` },
        { text: "💬 MORE · Support", url: `https://t.me/${owner}` }
      ],
      [{ text: "🌐 MORE · Website", url: miniAppBaseUrl(env) }]
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
      [{ text: "✨ Open Mini App · Shop", url: miniAppDeepLink(env, "shop") }],
      [
        { text: "🛒 Web catalog", url: `${store}/#products` },
        { text: `🤖 @${bot} · /buy`, url: `https://t.me/${bot}?start=buy` }
      ],
      [
        { text: "₮ USDT · ₿ BTC · 💳 Pay", url: `https://t.me/${bot}?start=pay` },
        { text: `📢 @${channel}`, url: `https://t.me/${channel}` }
      ],
      [{ text: `💬 Support @${owner}`, url: `https://t.me/${owner}` }]
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
