/**
 * Safely update @DTDSTOREBOT profile, Mini App menu, commands, channel, webhook.
 * Does NOT delete channel history.
 *
 * Usage: node scripts/telegram-setup.mjs
 */
import "dotenv/config";
import { BOT_COMMANDS } from "../functions/lib/bot-commands.js";
import {
  miniAppChannelKeyboard,
  miniAppMenuButton,
  miniAppDeepLink,
  miniAppUrl
} from "../functions/lib/mini-app.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const storeUrl = (process.env.STORE_URL || "https://dtdpaymentsbot.pages.dev").replace(/\/$/, "");
const companyUrl = (process.env.COMPANY_URL || "https://dvtechnologies.xyz").replace(/\/$/, "");
const companyName = process.env.COMPANY_NAME || "DV Technologies";
const mainChannel = process.env.TELEGRAM_CHANNEL_ID || "-1004311503458";
const backupChannel = process.env.TELEGRAM_BACKUP_CHANNEL_ID || "";
const groupId = process.env.TELEGRAM_GROUP_ID || "";
const botUsername = String(process.env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "");
const owner = String(process.env.TELEGRAM_OWNER_USERNAME || "Glock7money").replace(/^@/, "");
const supportEmail = String(process.env.SUPPORT_EMAIL || "contact@dvtechnologies.xyz").trim().toLowerCase();
const channelUser = String(process.env.TELEGRAM_CHANNEL_USERNAME || "").replace(/^@/, "");
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const env = process.env;

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}

async function api(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`${method}: ${payload.description || response.status}`);
  }
  return payload.result;
}

function ensureStoreLink() {
  const about = [
    "👑 DTD MAIN STORE — powered by DV Technologies.",
    `🛒 ${storeUrl}`,
    `📧 ${supportEmail}`,
    `🤖 @${botUsername} · 👤 @${owner}`,
    "💎 USDT (TRC20) · ₿ BTC · 💳 Paystack"
  ].join("\n");
  return about.slice(0, 255);
}

async function updateChannelDescription(chatId, label) {
  if (!chatId) return;
  try {
    const chat = await api("getChat", { chat_id: chatId });
    const next = ensureStoreLink();
    if (next === (chat.description || "").trim()) {
      console.log(`[skip] ${label} already up to date (${chat.title})`);
      return;
    }
    await api("setChatDescription", { chat_id: chatId, description: next.slice(0, 255) });
    console.log(`[ok] Updated ${label} description (${chat.title}) — history untouched`);
  } catch (error) {
    console.warn(`[warn] Could not update ${label} (${chatId}): ${error.message}`);
    console.warn("       Add @DTDSTOREBOT as admin, then re-run npm run telegram:setup");
  }
}

async function main() {
  const me = await api("getMe");
  console.log(`[ok] Bot online: @${me.username} id=${me.id}`);

  try {
    await api("setMyName", { name: "DTD PAYMENT BOT" });
  } catch (error) {
    console.warn(`[warn] setMyName skipped: ${error.message}`);
  }
  await api("setMyShortDescription", {
    short_description: `✨ DTD Store · ₮ USDT · ₿ BTC · Paystack · @${owner}`.slice(0, 120)
  });
  await api("setMyDescription", {
    description: [
      "👑 Official DTD Store bot — Premium Mini App shop, USDT (TRC20), Bitcoin, Paystack, order tracking.",
      "",
      `✨ Mini App: ${miniAppDeepLink(env, "shop")}`,
      `🌐 Store: ${storeUrl}`,
      `🏢 ${companyName}: ${companyUrl}`,
      `📢 Channel: https://t.me/${channelUser}`,
      "",
      "Commands: /app /buy /products /pay /channel /order /support /help",
      "",
      `🤖 Payments: @${botUsername}`,
      `📧 Email: ${supportEmail}`,
      `👤 Support: @${owner}`
    ].join("\n")
  });
  await api("setMyCommands", { commands: BOT_COMMANDS });
  console.log(`[ok] Updated @${botUsername} profile + ${BOT_COMMANDS.length} commands`);

  try {
    await api("setChatMenuButton", { menu_button: miniAppMenuButton(env) });
    console.log(`[ok] Mini App menu button → ${miniAppUrl(env, "home")}`);
  } catch (error) {
    console.warn(`[warn] setChatMenuButton failed: ${error.message}`);
    console.warn("       In @BotFather also run /setdomain for dtdpaymentsbot.pages.dev");
  }

  const webhookUrl = `${storeUrl}/api/telegram/webhook`;
  const webhookBody = {
    url: webhookUrl,
    allowed_updates: [
      "message",
      "edited_message",
      "callback_query",
      "channel_post",
      "edited_channel_post",
      "chat_join_request",
      "my_chat_member",
      "pre_checkout_query"
    ],
    drop_pending_updates: false
  };
  if (webhookSecret) webhookBody.secret_token = webhookSecret;
  await api("setWebhook", webhookBody);
  console.log(`[ok] Webhook set → ${webhookUrl}`);

  await updateChannelDescription(mainChannel, "main channel");
  if (backupChannel && backupChannel !== mainChannel) {
    await updateChannelDescription(backupChannel, "backup channel");
  }

  const announce = [
    "👑 <b>DTD Store · Stars + Secretary live</b>",
    "━━━━━━━━━━━━━━━━━━━━",
    "Open the Mini App, or pay in-bot with /buy.",
    "💎 USDT (TRC20) · ₿ BTC · ⭐ Stars · 💳 Paystack",
    "⭐ Earn: /earn · referrals /refer · tips /tip",
    "",
    `🤖 Payments: @${botUsername}`,
    `📢 Channel: @${channelUser}`,
    `📧 Email: ${supportEmail}`,
    `👤 Support: @${owner}`,
    `🛒 ${storeUrl}`,
    "",
    "Existing channel posts were not deleted."
  ].join("\n");

  const keyboard = miniAppChannelKeyboard(env);
  const targets = [mainChannel, backupChannel, groupId].filter((id, i, arr) => id && arr.indexOf(id) === i);
  for (const chatId of targets) {
    try {
      await api("sendMessage", {
        chat_id: chatId,
        text: announce,
        parse_mode: "HTML",
        reply_markup: keyboard,
        disable_web_page_preview: true
      });
      console.log(`[ok] Mini App notice posted to ${chatId}`);
    } catch (error) {
      console.warn(`[warn] Could not post to ${chatId}: ${error.message}`);
      console.warn("       Add @DTDSTOREBOT as admin (post messages) on that chat, then re-run.");
    }
  }

  await api("sendMessage", {
    chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID,
    text: [
      "<b>DTD setup complete</b>",
      `Bot: @${botUsername}`,
      `Mini App menu: ON`,
      `Store: ${storeUrl}`,
      "Try /app or the Menu button in a private chat.",
      "",
      "BotFather tip: /setdomain → dtdpaymentsbot.pages.dev",
      "Optional: /newapp to register a Main Mini App short name."
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[{ text: "🛒 Open Mini App", web_app: { url: miniAppUrl(env, "products") } }]]
    }
  });
  console.log("[ok] Admin DM sent");

  console.log("\nDone.");
}

main().catch((error) => {
  console.error("\nFailed:", error.message);
  if (String(error.message).includes("Unauthorized")) {
    console.error(
      "\nTELEGRAM_BOT_TOKEN is invalid/revoked.\n" +
        "1) @BotFather → API Token → Revoke → copy new token\n" +
        "2) Put it in .env as TELEGRAM_BOT_TOKEN=...\n" +
        "3) Make @DTDSTOREBOT admin on your channel\n" +
        "4) Deploy site, then run: npm run telegram:setup"
    );
  }
  process.exit(1);
});

