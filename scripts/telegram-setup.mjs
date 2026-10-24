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
    "\uD83D\uDC51 DTD MAIN STORE \u2014 powered by DV Technologies.",
    `\uD83D\uDED2 ${storeUrl}`,
    `\u2709\uFE0F ${supportEmail}`,
    `\uD83D\uDC8E Premium vendor \u00B7 @${botUsername} \u00B7 @${owner}`,
    "\uD83D\uDC8E USDT (TRC20) \u00B7 \u20BF BTC \u00B7 \uD83D\uDCB3 Paystack \u00B7 \u2B50 Stars"
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
    await api("setMyName", { name: "\uD83D\uDC8E DTD PAYMENT BOT" });
  } catch (error) {
    console.warn(`[warn] setMyName skipped: ${error.message}`);
  }
  await api("setMyShortDescription", {
    short_description: [
      "\uD83D\uDC8E DTD Store \u00B7 \u2B50 Stars \u00B7 USDT \u00B7 \u20BF BTC \u00B7 Paystack",
      `\uD83D\uDC8E Premium vendor \u00B7 @${owner}`
    ].join("\n").slice(0, 120)
  });
  await api("setMyDescription", {
    description: [
      "\uD83D\uDC51 Official DTD Store bot \u2014 Premium Mini App shop, USDT, Bitcoin, Paystack, Stars.",
      "",
      `\uD83D\uDE80 Mini App: ${miniAppDeepLink(env, "shop")}`,
      `\uD83C\uDF10 Store: ${storeUrl}`,
      `\uD83C\uDFE2 ${companyName}: ${companyUrl}`,
      "",
      "\uD83D\uDC8E DTD PREMIUM \u2014 early access to every flash sale",
      `\u2B50 /premium \u00B7 /deal \u00B7 /earn \u00B7 /tip`,
      "",
      "Commands: /app /buy /products /pay /premium /deal /earn /tip /channel /order /support /help",
      "",
      `\uD83D\uDDA5\uFE0F @${botUsername} \u00B7 \u2709\uFE0F ${supportEmail} \u00B7 \uD83D\uDC64 @${owner}`
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
    "\uD83D\uDC8E <b>DTD Store \u00B7 Stars + Premium live</b>",
    "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
    "Open the Mini App, or pay in-bot with /buy.",
    "\uD83D\uDC8E USDT (TRC20) \u00B7 \u20BF BTC \u00B7 \u2B50 Stars \u00B7 \uD83D\uDCB3 Paystack",
    "\u2B50 Earn: /earn \u00B7 referrals /refer \u00B7 tips /tip",
    "\uD83D\uDC8E /premium \u2014 early access to every flash sale",
    "",
    `\uD83D\uDDA5\uFE0F Payments: @${botUsername}`,
    `\uD83D\uDCE2 Channel: @${channelUser}`,
    `\u2709\uFE0F Email: ${supportEmail}`,
    `\uD83D\uDC64 Support: @${owner}`,
    `\uD83D\uDED2 ${storeUrl}`,
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
    }
  }

  try {
    await api("sendMessage", {
      chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID,
      text: [
      "<b>\uD83D\uDC8E DTD setup complete</b>",
      `Bot: @${botUsername} \uD83D\uDC8E`,
      `Mini App menu: ON`,
      `Store: ${storeUrl}`,
      "Try /app or the Menu button in a private chat.",
      "",
      "BotFather tip: /setdomain \u2192 dtdpaymentsbot.pages.dev",
      "Optional: /newapp to register a Main Mini App short name.",
      "",
      "\uD83D\uDC8E Premium emoji: enabled (Bot API 9.4)",
      "\u2B50 Custom emoji works in private chats + groups"
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[{ text: "\uD83D\uDED2 Open Mini App", web_app: { url: miniAppUrl(env, "products") } }]]
    }
  });
  console.log("[ok] Admin DM sent");
  } catch (e) { console.warn(`[warn] Admin DM: ${e.message}`); }

  // ─── GMONEY STORE group setup ──────────────────────────────────────
  const gmoneyGroupId = process.env.GMONEY_GROUP_ID || "";
  if (gmoneyGroupId) {
    try {
      const gchat = await api("getChat", { chat_id: gmoneyGroupId });
      console.log(`[ok] GMONEY STORE group found: ${gchat.title} (${gmoneyGroupId})`);

      // 1. Rename the group
      try {
        await api("setChatTitle", { chat_id: gmoneyGroupId, title: "GMONEY STORE\uD83D\uDCB5" });
        console.log("[ok] GMONEY STORE group renamed to GMONEY STORE\uD83D\uDCB5");
      } catch (e) {
        console.warn(`[warn] Rename failed: ${e.message}`);
      }

      // 2. Set group description
      const groupDesc = [
        "\uD83D\uDC51 GMONEY STORE \u2014 DTD backend group.",
        `\uD83D\uDE80 Main channel: https://t.me/+ysMSObZyNWpjNTA0`,
        `\uD83D\uDC8E Premium: https://t.me/+ZYBP2Qrr-JgyYTQ0`,
        `\uD83D\uDDA5\uFE0F Bot: @${botUsername}`,
        `\uD83D\uDED2 Store: ${storeUrl}`,
        "",
        "Community \u00B7 Deals \u00B7 Exclusive drops",
        "\u2705 No spam \u00B7 No scam links \u00B7 Respect the community",
        "",
        `\uD83D\uDDA5\uFE0F Powered by DV Technologies \u00B7 ${companyUrl}`
      ].join("\n");
      try {
        await api("setChatDescription", { chat_id: gmoneyGroupId, description: groupDesc.slice(0, 255) });
        console.log("[ok] GMONEY STORE description set");
      } catch (e) {
        console.warn(`[warn] Group description failed: ${e.message}`);
      }

      // 3. Set group photo (use a photo URL or file_id)
      // Note: setChatPhoto requires a file upload. We'll skip if no photo is available.
      // To set a photo, place a 512x512 image at assets/gmoney-store-avatar.jpg
      // and uncomment the block below:
      /*
      const fs = require("fs");
      const photoPath = require("path").join(__dirname, "..", "assets", "gmoney-store-avatar.jpg");
      if (fs.existsSync(photoPath)) {
        const formData = new FormData();
        formData.append("chat_id", gmoneyGroupId);
        formData.append("photo", new Blob([fs.readFileSync(photoPath)]), "avatar.jpg");
        const resp = await fetch(`https://api.telegram.org/bot${token}/setChatPhoto`, { method: "POST", body: formData });
        const result = await resp.json();
        if (result.ok) console.log("[ok] GMONEY STORE avatar updated");
        else console.warn(`[warn] Avatar failed: ${result.description}`);
      }
      */

      // 4. Pin welcome message
      const welcomeMsg = [
        "\uD83D\uDC51 <b>Welcome to GMONEY STORE\uD83D\uDCB5</b>",
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
        "Your personal DTD backend group.",
        "Channels = front-end. This group = real talk + exclusive drops.",
        "",
        `\uD83D\uDE80 <a href="https://t.me/+ysMSObZyNWpjNTA0">Main channel</a>`,
        `\uD83D\uDC8E <a href="https://t.me/+ZYBP2Qrr-JgyYTQ0">DTD PREMIUM</a>`,
        `\uD83D\uDDA5\uFE0F <a href="https://t.me/${botUsername}">Bot: @${botUsername}</a>`,
        `\uD83D\uDED2 <a href="${storeUrl}">Web Store</a>`,
        `\uD83C\uDFE2 <a href="${companyUrl}">DV Technologies</a>`,
        "",
        "\u2705 Rules:",
        "1. No scam links",
        "2. Respect the community",
        "3. Use @DTDSTOREBOT for purchases",
        "4. Have fun + engage",
        "",
        `\uD83D\uDDA5\uFE0F Powered by DV Technologies \u00B7 ${companyUrl}`
      ].join("\n");

      let pinnedMsgId = null;
      try {
        const pinned = await api("sendMessage", {
          chat_id: gmoneyGroupId,
          text: welcomeMsg,
          parse_mode: "HTML",
          disable_web_page_preview: true
        });
        pinnedMsgId = pinned.message_id;
        console.log("[ok] GMONEY STORE welcome message posted");
      } catch (e) {
        console.warn(`[warn] Welcome msg failed: ${e.message}`);
      }

      // 5. Pin the welcome message
      if (pinnedMsgId) {
        try {
          await api("pinChatMessage", { chat_id: gmoneyGroupId, message_id: pinnedMsgId, disable_notification: true });
          console.log("[ok] GMONEY STORE welcome pinned");
        } catch (e) {
          console.warn(`[warn] Pin failed: ${e.message}`);
        }
      }

      // 6. Set group permissions (allow everyone to send text, media)
      try {
        await api("setChatPermissions", {
          chat_id: gmoneyGroupId,
          permissions: {
            can_send_messages: true,
            can_send_audios: true,
            can_send_documents: true,
            can_send_photos: true,
            can_send_videos: true,
            can_send_video_notes: true,
            can_send_voice_notes: true,
            can_send_polls: true,
            can_send_other_messages: true,
            can_add_web_page_previews: true,
            can_change_info: false,
            can_invite_users: true,
            can_pin_messages: false,
            can_manage_topics: false
          }
        });
        console.log("[ok] GMONEY STORE permissions set (open chat, limited admin)");
      } catch (e) {
        console.warn(`[warn] Permissions failed: ${e.message}`);
      }

    } catch (error) {
      console.warn(`[warn] GMONEY STORE group (${gmoneyGroupId}): ${error.message}`);
      console.warn("       Add @DTDSTOREBOT as admin (with all permissions), then re-run.");
    }
  } else {
    console.log("[skip] GMONEY_GROUP_ID not set — skipping group setup");
  }

  // ─── Vendor admins: @B1yteBandit + @Oxy1Monster ───────────────────
  const vendors = [
    { userId: "7663030842", username: "B1yteBandit" },
    { userId: "572441506", username: "Oxy1Monster" },
  ];
  const vendorTargets = [mainChannel, gmoneyGroupId].filter(Boolean);

  for (const vendor of vendors) {
    for (const chatId of vendorTargets) {
      try {
        await api("promoteChatMember", {
          chat_id: chatId,
          user_id: vendor.userId,
          rights: {
            can_change_info: false,
            can_delete_messages: true,
            can_invite_users: true,
            can_pin_messages: true,
            can_promote_members: false,
            can_manage_video_chats: true,
            can_restrict_members: true,
            can_post_messages: true,
            can_edit_messages: true
          }
        });
        console.log(`[ok] @${vendor.username} promoted to admin in ${chatId}`);
      } catch (error) {
        console.warn(`[warn] Could not promote @${vendor.username} in ${chatId}: ${error.message}`);
      }
    }

    // Send vendor welcome DM
    const vendorDm = [
      "<b>\uD83D\uDC8E Welcome to the DTD Ecosystem!</b>",
      "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
      `You've been added as a <b>verified vendor</b> in the DTD ecosystem.`,
      "",
      "\uD83D\uDC51 Your role:",
      "\u2022 Admin in channels + GMONEY STORE group",
      "\u2022 Can post products, manage content, pin messages",
      "\u2022 Your store/products can be promoted through our channels",
      "\u2022 You ARE the ecosystem \u2014 sell, engage, grow",
      "",
      "\uD83D\uDDA5\uFE0F Links:",
      `\u2022 Main channel: https://t.me/+ysMSObZyNWpjNTA0`,
      `\u2022 Premium: https://t.me/+ZYBP2Qrr-JgyYTQ0`,
      `\u2022 Store: ${storeUrl}`,
      `\u2022 Bot: @${botUsername}`,
      "",
      "\u2705 You can now manage the ecosystem. Welcome aboard!",
      "",
      `\uD83D\uDDA5\uFE0F Powered by DV Technologies \u00B7 ${companyUrl}`
    ].join("\n");

    try {
      await api("sendMessage", {
        chat_id: vendor.userId,
        text: vendorDm,
        parse_mode: "HTML",
        disable_web_page_preview: true
      });
      console.log(`[ok] Vendor welcome DM sent to @${vendor.username}`);
    } catch (error) {
      console.warn(`[warn] Could not DM @${vendor.username}: ${error.message}`);
      console.warn("       They must start a chat with @DTDSTOREBOT first.");
    }
  }

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

