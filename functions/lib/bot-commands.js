/**
 * Telegram bot command handler — processTelegramUpdate + BOT_COMMANDS.
 * Recreated for local `server.js` after the Pages Functions → _worker.js refactor.
 */

export const BOT_COMMANDS = [
  { command: "app", description: "🛒 Open the DTD Mini App shop" },
  { command: "buy", description: "🛒 Buy products" },
  { command: "products", description: "🛍 Browse store products" },
  { command: "pay", description: "💳 Make a payment" },
  { command: "premium", description: "💎 Join DTD PREMIUM" },
  { command: "deal", description: "🔥 Today's Stars deal" },
  { command: "earn", description: "💰 Earn with DTD" },
  { command: "tip", description: "⭐ Send a Star tip" },
  { command: "channel", description: "📢 DTD MAIN STORE channel" },
  { command: "order", description: "📋 Check order status" },
  { command: "refer", description: "🤝 Refer friends and earn" },
  { command: "market", description: "📊 Flash/surge/bundle status" },
  { command: "finance", description: "💰 Revenue dashboard" },
  { command: "support", description: "📩 Contact support" },
  { command: "help", description: "❓ Show help" }
];

export async function processTelegramUpdate(env, update, helpers) {
  const { getSupabase, sendTelegram } = helpers;

  if (!update.message || !update.message.text) return;

  const chatId = update.message.chat?.id;
  const text = update.message.text || "";
  const username = update.message.from?.username || update.message.from?.first_name || "User";

  if (text.startsWith("/start")) {
    await sendTelegram(env, chatId, [
      "<b>Welcome to DTD Store Bot</b>",
      "",
      "Commands:",
      "/start — Show this message",
      "/help — Get help",
      "/order — Check order status",
      "/support — Contact support"
    ].join("\n"));
    return;
  }

  if (text.startsWith("/help")) {
    await sendTelegram(env, chatId, [
      "<b>DTD Store Help</b>",
      "",
      "• Use the store at https://dtdpaymentsbot.pages.dev",
      "• For support, use /support",
      "• For order status, use /order ORDER_ID"
    ].join("\n"));
    return;
  }

  if (text.startsWith("/support")) {
    const supportEmail = env.SUPPORT_EMAIL || "contact@dvtechnologies.xyz";
    await sendTelegram(env, chatId, [
      "<b>DTD Store Support</b>",
      "",
      `Email: ${supportEmail}`,
      "We'll respond within 24 hours."
    ].join("\n"));
    return;
  }

  if (text.startsWith("/order")) {
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      await sendTelegram(env, chatId, "Usage: /order ORDER_ID");
      return;
    }
    const orderId = parts[1];
    const sb = getSupabase();
    if (sb) {
      const { data } = await sb.from("orders").select("*").eq("id", orderId);
      if (data && data.length) {
        const order = data[0];
        const status = String(order.order_status || order.status || "new").toLowerCase();
        const statusLabel = { new: "New", confirmed: "Confirmed", delivered: "Delivered", cancelled: "Cancelled" }[status] || status;
        await sendTelegram(env, chatId, [
          "<tg-emoji emoji-id=\"5206607081334906820\">✅</tg-emoji> <b>Order Status</b>",
          `📋 ID: <code>${order.id}</code>`,
          `🛒 Status: <b>${statusLabel}</b>`,
          `💳 Payment: ${order.payment_method || "n/a"}`,
          `💰 Total: $${Number(order.total_usd || 0).toFixed(2)}`
        ].join("\n"));
      } else {
        await sendTelegram(env, chatId, "<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Order not found. Check your Order ID and email.");
      }
    }
    return;
  }

  if (text.startsWith("/premium")) {
    const botUsername = env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT";
    await sendTelegram(env, chatId, [
      "<tg-emoji emoji-id=\"5438496463044752972\">⭐</tg-emoji> <b>DTD PREMIUM — 20 Stars / 30 days</b>",
      "",
      "💎 Early access to every flash sale",
      "🏷️ Premium-only deals before the main store",
      "📢 Private members' channel access",
      "⭐ Stars support boosts DTD PREMIUM",
      "",
      `👉 <a href="https://t.me/${botUsername}?start=premium">Join DTD PREMIUM →</a>`,
    ].join("\n"), { parse_mode: "HTML", disable_web_page_preview: true });
    return;
  }

  if (text.startsWith("/earn")) {
    const botUsername = env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT";
    await sendTelegram(env, chatId, [
      "<tg-emoji emoji-id=\"5409048419211682843\">💲</tg-emoji> <b>EARN WITH DTD</b>",
      "",
      "🤝 <b>Refer friends</b> — 10% commission on their first purchase",
      `👉 <a href="https://t.me/${botUsername}?start=refer">Get your referral link →</a>`,
      "",
      "⭐ <b>Send Stars</b> — tips and donations welcome",
      `👉 /tip`,
      "",
      "🔥 <b>Daily deals</b> — buy at flash-sale prices",
      `👉 /deal`,
      "",
      "💎 <b>/DTD PREMIUM</b> — exclusive early-access deals",
      `👉 /premium`,
    ].join("\n"), { parse_mode: "HTML", disable_web_page_preview: true });
    return;
  }

  if (text.startsWith("/tip")) {
    const botUsername = env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT";
    await sendTelegram(env, chatId, [
      "<tg-emoji emoji-id=\"5438496463044752972\">⭐</tg-emoji> <b>Send a Star tip</b>",
      "",
      "Love what we do? Send a Star tip to support DTD!",
      `👉 <a href="https://t.me/${botUsername}?start=tip">Open tip menu →</a>`,
    ].join("\n"), { parse_mode: "HTML", disable_web_page_preview: true });
    return;
  }

  if (text.startsWith("/deal")) {
    const botUsername = env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT";
    await sendTelegram(env, chatId, [
      "<tg-emoji emoji-id=\"5424972470023104089\">🔥</tg-emoji> <b>DTD DEAL OF THE HOUR</b>",
      "",
      "A fresh product deal drops every few hours.",
      "Pay with ⭐ Stars for 5% off.",
      "",
      `👉 <a href="https://t.me/${botUsername}?start=deal">Check today's deal →</a>`,
    ].join("\n"), { parse_mode: "HTML", disable_web_page_preview: true });
    return;
  }

  if (text.startsWith("/market")) {
    const storeUrl = env.STORE_URL || "https://dtdpaymentsbot.pages.dev";
    await sendTelegram(env, chatId, [
      "<tg-emoji emoji-id=\"5422439311196834318\">💡</tg-emoji> <b>DTD MARKET STATUS</b>",
      "",
      "⚡ Flash deals · 🤝 Referral surges · 🎁 Bundles",
      "",
      `🌐 <a href="${storeUrl}">Open store →</a>`,
      "📊 /finance — revenue dashboard",
    ].join("\n"), { parse_mode: "HTML", disable_web_page_preview: true });
    return;
  }

  if (text.startsWith("/finance")) {
    const storeUrl = env.STORE_URL || "https://dtdpaymentsbot.pages.dev";
    await sendTelegram(env, chatId, [
      "<tg-emoji emoji-id=\"5409048419211682843\">💲</tg-emoji> <b>DTD FINANCE</b>",
      "",
      "💰 Revenue, Stars, referrals — all in one place.",
      `🌐 <a href="${storeUrl}/#admin">Open dashboard →</a>`,
    ].join("\n"), { parse_mode: "HTML", disable_web_page_preview: true });
    return;
  }

  const adminChat = env.TELEGRAM_ADMIN_CHAT_ID;
  if (chatId?.toString() === adminChat?.toString()) {
    await sendTelegram(env, chatId, `Received: ${text}`);
  } else {
    await sendTelegram(env, chatId, "Use /help to see available commands.");
  }
}
