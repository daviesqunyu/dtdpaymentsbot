/**
 * Telegram bot command handler — stub for processTelegramUpdate
 * This is a minimal implementation that handles basic bot commands.
 * If you had a more complex bot-commands.js, replace this with your original.
 */

export async function processTelegramUpdate(env, update, helpers) {
  const { getSupabase, sendTelegram } = helpers;

  if (!update.message || !update.message.text) return;

  const chatId = update.message.chat?.id;
  const text = update.message.text || "";
  const username = update.message.from?.username || update.message.from?.first_name || "User";

  // Basic commands
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
      const { data } = await sb.from("orders").select("*").filter({ id: orderId });
      if (data && data.length) {
        const order = data[0];
        await sendTelegram(env, chatId, [
          "<b>Order Status</b>",
          `ID: ${order.id}`,
          `Payment: ${order.payment_method}`,
          `Total: $${order.total_usd}`,
          `Status: ${order.status || "pending"}`
        ].join("\n"));
      } else {
        await sendTelegram(env, chatId, "Order not found. Check your Order ID.");
      }
    }
    return;
  }

  // Default: echo for admin
  const adminChat = env.TELEGRAM_ADMIN_CHAT_ID;
  if (chatId?.toString() === adminChat?.toString()) {
    // Admin messages — could trigger actions
    await sendTelegram(env, chatId, `Received: ${text}`);
  } else {
    await sendTelegram(env, chatId, "Use /help to see available commands.");
  }
}