/**
 * Mini App helper functions — recreated for local `server.js` + `telegram-setup.mjs`
 * after the Pages Functions → _worker.js refactor.
 */

function storeUrl(env) {
  return (env.STORE_URL || "https://dtdpaymentsbot.pages.dev").replace(/\/$/, "");
}

export function miniAppUrl(env, route = "shop") {
  return `${storeUrl(env)}?tgWebAppStartParam=${encodeURIComponent(route)}&tgWebAppPlatform=telegram`;
}

export function miniAppDeepLink(env, route = "shop") {
  const botUsername = String(env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "");
  const url = miniAppUrl(env, route);
  return `https://t.me/${botUsername}?startapp=${encodeURIComponent(route)}`;
}

export function miniAppMenuButton(env) {
  return {
    type: "web_app",
    text: "Open Store",
    web_app: { url: miniAppUrl(env, "home") }
  };
}

export function miniAppChannelKeyboard(env) {
  const botUsername = String(env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "");
  return {
    inline_keyboard: [
      [
        { text: "Open Mini App", web_app: { url: miniAppUrl(env, "products") } },
        { text: "Bot Menu", url: `https://t.me/${botUsername}` }
      ]
    ]
  };
}
