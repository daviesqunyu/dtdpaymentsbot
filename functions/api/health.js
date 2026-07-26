import { getSupabase, json } from "../lib/store.js";
import { mailerConfigured, smtpFromPhone } from "../lib/smtp.js";

export async function onRequestGet(context) {
  const { env } = context;
  return json({
    ok: true,
    supabase: Boolean(getSupabase(env)),
    paystack: Boolean(env.PAYSTACK_PUBLIC_KEY),
    telegram: Boolean(
      env.TELEGRAM_BOT_TOKEN && (env.TELEGRAM_ADMIN_CHAT_ID || env.TELEGRAM_CHANNEL_ID)
    ),
    telegramAdmin: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_CHAT_ID),
    telegramChannel: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHANNEL_ID),
    usdt: Boolean(env.USDT_TRC20_ADDRESS),
    btc: Boolean(env.BTC_ADDRESS),
    mailer: mailerConfigured(env),
    sms: Boolean(smtpFromPhone(env)),
    chat: Boolean(env.SUPABASE_URL && (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY)),
    tradeProxy: Boolean(env.VPS_BINANCE_PROXY_URL)
  });
}
