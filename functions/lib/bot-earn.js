/**
 * Referral tracking + tip jar helpers for Telegram monetization.
 */

import { getSupabase } from "./store.js";
import { createStarsCheckout, starsEnabled, usdToStars } from "./stars.js";
import { PX, premiumDivider, premiumHeader } from "./tg-premium.js";

function esc(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function trackReferralStart(env, { userId, username, referrerId }) {
  const uid = String(userId || "").trim();
  const rid = String(referrerId || "").trim();
  if (!uid || !rid || uid === rid) return { ok: false };

  const supabase = getSupabase(env);
  if (!supabase) return { ok: false, reason: "no_db" };

  const { error } = await supabase.from("bot_referrals").upsert(
    {
      referred_user_id: uid,
      referrer_user_id: rid,
      referred_username: username || null,
      status: "joined"
    },
    { onConflict: "referred_user_id" }
  );

  if (error) return { ok: false, reason: error.message };

  if (env.TELEGRAM_ADMIN_CHAT_ID) {
    // best-effort admin ping
    try {
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_ADMIN_CHAT_ID,
          text: `🔗 Referral: @${username || uid} came from user ${rid}`,
          parse_mode: "HTML"
        })
      });
    } catch {
      /* ignore */
    }
  }

  return { ok: true };
}

export function referralLink(env, userId) {
  const bot = String(env.TELEGRAM_BOT_USERNAME || "Dtdpaymentbot").replace(/^@/, "");
  return `https://t.me/${bot}?start=ref_${userId}`;
}

export function referMessage(env, userId) {
  const link = referralLink(env, userId);
  return [
    premiumHeader("Your referral link", PX.fire),
    premiumDivider(),
    "Share this link. When someone starts the bot from it, we track the referral.",
    "",
    `<code>${esc(link)}</code>`,
    "",
    `${PX.star} Pair with Stars checkout (/buy → ⭐ Stars) to earn on digital sales.`,
    `${PX.rocket} Reinvest Stars into Telegram Ads from your bot Balance page.`,
    "",
    "See /earn for the full playbook."
  ].join("\n");
}

export async function referralStats(env, userId) {
  const supabase = getSupabase(env);
  if (!supabase) return { count: 0, converted: 0 };
  const { data } = await supabase
    .from("bot_referrals")
    .select("status")
    .eq("referrer_user_id", String(userId));
  const rows = Array.isArray(data) ? data : [];
  return {
    count: rows.length,
    converted: rows.filter((r) => r.status === "converted").length
  };
}

/** Small tip invoice in Stars (defaults to ~$1). */
export async function createTipInvoice(env, { chatId, userId, usd = 1 } = {}) {
  if (!starsEnabled(env)) {
    return { ok: false, error: "Stars not enabled on this bot yet." };
  }
  const amount = Math.max(0.5, Number(usd) || 1);
  return createStarsCheckout(env, {
    kind: "bot",
    chatId,
    telegramUserId: userId,
    customerName: "Tip",
    customerEmail: `tip${userId}@stars.dtdpaymentsbot.pages.dev`,
    productId: "tip",
    productName: "DTD tip / support",
    totalUsd: amount,
    items: [
      {
        product_id: "tip",
        product_name: "DTD tip / support",
        quantity: 1,
        unit_price_usd: amount
      }
    ]
  });
}

export function tipPrompt(env) {
  const stars = usdToStars(env, 1);
  return [
    premiumHeader("Tip DTD with Stars", PX.star),
    premiumDivider(),
    `Send a quick ~$1 tip (~${stars} ★) to support the store.`,
    "Usage: <code>/tip</code> or <code>/tip 2</code> (USD)",
    "",
    "Tips use Telegram Stars — they go to your bot Stars balance for ads / Fragment."
  ].join("\n");
}
