/**
 * Safely update @davistechbot profile, commands, channel description, and webhook.
 * Does NOT delete channel history.
 *
 * Usage: node scripts/telegram-setup.mjs
 */
import "dotenv/config";
import { BOT_COMMANDS } from "../functions/lib/bot-commands.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const storeUrl = (process.env.STORE_URL || "https://dtdpaymentsbot.pages.dev").replace(/\/$/, "");
const mainChannel = process.env.TELEGRAM_CHANNEL_ID || "-1004433496789";
const backupChannel = process.env.TELEGRAM_BACKUP_CHANNEL_ID || "";
const groupId = process.env.TELEGRAM_GROUP_ID || "";
const botUsername = String(process.env.TELEGRAM_BOT_USERNAME || "Dtdpaymentbot").replace(/^@/, "");
const owner = String(process.env.TELEGRAM_OWNER_USERNAME || "Davetheedev").replace(/^@/, "");
const channelUser = String(process.env.TELEGRAM_CHANNEL_USERNAME || "DTDMAINSTORE").replace(/^@/, "");
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";

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

function ensureStoreLink(description) {
  const base = String(description || "").trim();
  const contactLine = `📩 Dm Owner @${owner} for inquiries and complaints`;
  if (base.includes(storeUrl) && base.includes(`@${owner}`)) return base;
  if (!base) {
    return ["WEB$TORE💸💻", storeUrl, contactLine].join("\n");
  }
  let next = base;
  if (!next.includes(storeUrl)) next += `\n\n🛒 Official store:\n${storeUrl}`;
  if (!next.includes(`@${owner}`)) next += `\n${contactLine}`;
  return next;
}

async function updateChannelDescription(chatId, label) {
  if (!chatId) return;
  try {
    const chat = await api("getChat", { chat_id: chatId });
    const next = ensureStoreLink(chat.description || "");
    if (next === (chat.description || "").trim()) {
      console.log(`[skip] ${label} already up to date (${chat.title})`);
      return;
    }
    await api("setChatDescription", { chat_id: chatId, description: next.slice(0, 255) });
    console.log(`[ok] Updated ${label} description (${chat.title}) — history untouched`);
  } catch (error) {
    console.warn(`[warn] Could not update ${label} (${chatId}): ${error.message}`);
    console.warn("       Add @Dtdpaymentbot as admin, then re-run npm run telegram:setup");
  }
}

async function main() {
  const me = await api("getMe");
  console.log(`[ok] Bot online: @${me.username} id=${me.id}`);

  try {
    await api("setMyName", { name: "DTD PAYMEN BOT" });
  } catch (error) {
    console.warn(`[warn] setMyName skipped: ${error.message}`);
  }
  await api("setMyShortDescription", {
    short_description: `DTD Store • ${storeUrl} • Support @${owner}`
  });
  await api("setMyDescription", {
    description: [
      "Official DTD Payments bot — products, Paystack/BTC, and channel tools.",
      "",
      `🛒 Store: ${storeUrl}`,
      `📢 Channel: https://t.me/${channelUser}`,
      "💳 Paystack (card/bank/mobile money) + Bitcoin",
      "",
      "Commands: /store /products /pay /channel /support /help",
      "Admin: /status /orders /post /config",
      "",
      `Owner / support: @${owner}`
    ].join("\n")
  });
  await api("setMyCommands", { commands: BOT_COMMANDS });
  console.log(`[ok] Updated @${botUsername} profile + ${BOT_COMMANDS.length} commands`);

  const webhookUrl = `${storeUrl}/api/telegram/webhook`;
  const webhookBody = {
    url: webhookUrl,
    allowed_updates: ["message", "channel_post", "edited_channel_post", "chat_join_request", "my_chat_member"]
  };
  if (webhookSecret) webhookBody.secret_token = webhookSecret;
  await api("setWebhook", webhookBody);
  console.log(`[ok] Webhook set → ${webhookUrl} (messages + channel posts + join requests)`);

  await updateChannelDescription(mainChannel, "main channel");
  if (backupChannel && backupChannel !== mainChannel) {
    await updateChannelDescription(backupChannel, "backup channel");
  }

  const announce = [
    "<b>DTD Payments bot is online</b>",
    "",
    `🛒 Shop: ${storeUrl}`,
    "💳 Paystack + Bitcoin checkout",
    `🤖 Commands: @${botUsername} → /help`,
    `👤 Support: @${owner}`,
    "",
    "Existing channel posts were not deleted."
  ].join("\n");

  const targets = [mainChannel, backupChannel, groupId].filter((id, i, arr) => id && arr.indexOf(id) === i);
  for (const chatId of targets) {
    try {
      await api("sendMessage", { chat_id: chatId, text: announce, parse_mode: "HTML" });
      console.log(`[ok] Soft notice posted to ${chatId}`);
    } catch (error) {
      console.warn(`[warn] Could not post to ${chatId}: ${error.message}`);
      console.warn("       Add @Dtdpaymentbot as admin (post messages) on that chat, then re-run.");
    }
  }

  // Confirm admin DM works
  await api("sendMessage", {
    chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID,
    text: [
      "<b>DTD setup complete</b>",
      `Bot: @${botUsername}`,
      `Store: ${storeUrl}`,
      "Try /help in this chat.",
      "",
      "If channel posts failed: add this bot as channel/group admin, then re-run npm run telegram:setup"
    ].join("\n"),
    parse_mode: "HTML"
  });
  console.log("[ok] Admin DM sent");

  console.log("\nDone.");
}

main().catch((error) => {
  console.error("\nFailed:", error.message);
  if (String(error.message).includes("Unauthorized")) {
    console.error(
      "\nTELEGRAM_BOT_TOKEN is invalid/revoked.\n" +
        "1) @BotFather → /mybots → davistechbot → API Token → Revoke → copy new token\n" +
        "2) Put it in .env as TELEGRAM_BOT_TOKEN=...\n" +
        "3) Make @davistechbot admin on @DTDMAINSTORE\n" +
        "4) Deploy site, then run: npm run telegram:setup"
    );
  }
  process.exit(1);
});
