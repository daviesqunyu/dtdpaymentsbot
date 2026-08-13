/**
 * One-shot: list pending orders and send USDT payment reminders (secretary demo).
 * Usage: node scripts/secretary-remind-pending.mjs
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  parseTelegramUserIdFromDelivery,
  sendUsdtPaymentInstructions
} from "../functions/lib/crypto-checkout-msg.js";
import { scheduleUsdtPaymentReminder } from "../functions/lib/bot-secretary.js";
import { sendTelegram, paymentStatusView } from "../functions/lib/store.js";
import { PX, premiumDivider, premiumHeader, numberEmoji } from "../functions/lib/tg-premium.js";

const env = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID,
  USDT_TRC20_ADDRESS: process.env.USDT_TRC20_ADDRESS,
  STORE_URL: process.env.STORE_URL || "https://dtdpaymentsbot.pages.dev"
};

function esc(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function resolveByUsername(username) {
  const raw = String(username || "").replace(/^@/, "").trim();
  if (!raw || !env.TELEGRAM_BOT_TOKEN) return null;
  if (/^\d+$/.test(raw)) return raw;
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: `@${raw}` })
    });
    const data = await response.json();
    if (data.ok && data.result?.id) return String(data.result.id);
  } catch {
    /* ignore */
  }
  return null;
}

async function main() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  if (!env.USDT_TRC20_ADDRESS) throw new Error("Missing USDT_TRC20_ADDRESS");

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      "id,customer_name,customer_email,payment_method,payment_status,total_usd,telegram_username,delivery_details,created_at"
    )
    .in("payment_status", ["pending", "processing", "unpaid", "awaiting"])
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) throw new Error(error.message);

  const list = Array.isArray(orders) ? orders : [];
  console.log(`Found ${list.length} pending order(s).`);

  const results = [];
  for (const order of list) {
    const buyerId =
      parseTelegramUserIdFromDelivery(order.delivery_details) ||
      (await resolveByUsername(order.telegram_username));

    const amount = Number(order.total_usd || 0).toFixed(2);
    const view = paymentStatusView(order.payment_status);
    const row = {
      id: order.id,
      name: order.customer_name,
      status: view.label,
      method: order.payment_method,
      amount,
      username: order.telegram_username || null,
      buyerId: buyerId || null,
      sent: false,
      detail: ""
    };

    if (!buyerId) {
      row.detail = "no Telegram chat id (buyer must /start the bot)";
      results.push(row);
      console.log(`SKIP ${order.id} — no buyer chat id`);
      continue;
    }

    const sent = await sendUsdtPaymentInstructions(env, buyerId, {
      orderId: order.id,
      amount,
      address: env.USDT_TRC20_ADDRESS,
      isReminder: true
    });

    await scheduleUsdtPaymentReminder(env, {
      buyerChatId: buyerId,
      orderId: order.id,
      amount,
      address: env.USDT_TRC20_ADDRESS,
      minutes: 60
    }).catch(() => null);

    row.sent = Boolean(sent?.ok);
    row.detail = sent?.ok ? "reminder + QR sent" : "send failed (blocked / never started bot?)";
    results.push(row);
    console.log(`${row.sent ? "SENT" : "FAIL"} ${order.id} → ${buyerId} (${row.detail})`);
  }

  // Secretary inbox report to admin
  const admin = env.TELEGRAM_ADMIN_CHAT_ID;
  if (admin) {
    const lines = results.length
      ? results.map((r, i) => {
          return [
            `${numberEmoji(i + 1)} <code>${esc(r.id)}</code>`,
            `   ${esc(r.name || "—")} · $${esc(r.amount)} · ${esc(r.status)}`,
            r.username ? `   @${esc(String(r.username).replace(/^@/, ""))}` : null,
            r.buyerId ? `   chat <code>${esc(r.buyerId)}</code>` : `   ${PX.warn} no chat id`,
            `   ${r.sent ? PX.check : PX.warn} ${esc(r.detail)}`
          ]
            .filter(Boolean)
            .join("\n");
        })
      : [`${PX.check} No pending payment orders right now.`];

    await sendTelegram(
      env,
      admin,
      [
        premiumHeader("Secretary · pending reminders", PX.inbox),
        premiumDivider(),
        `Ran a live pass over <b>${results.length}</b> pending order(s).`,
        "",
        ...lines,
        "",
        "Tip: /inbox · /sec pay ORDER_ID send · /secretary"
      ].join("\n")
    );
    console.log(`Admin report sent to ${admin}`);
  }

  console.log(JSON.stringify({ pending: results.length, results }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
