import { getSupabase, json } from "../lib/store.js";

export async function onRequestGet(context) {
  const { env } = context;
  const envKeys = Object.keys(env || {})
    .filter((key) => !/SECRET|TOKEN|KEY|PASSWORD/i.test(key) || /PUBLIC|CURRENCY|RATE|URL|USERNAME|CHANNEL|GROUP|ADDRESS|OWNER/i.test(key))
    .sort();

  return json({
    ok: true,
    supabase: Boolean(getSupabase(env)),
    paystack: Boolean(env.PAYSTACK_PUBLIC_KEY),
    telegram: Boolean(
      env.TELEGRAM_BOT_TOKEN && (env.TELEGRAM_ADMIN_CHAT_ID || env.TELEGRAM_CHANNEL_ID)
    ),
    telegramAdmin: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_CHAT_ID),
    telegramChannel: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHANNEL_ID),
    btc: Boolean(env.BTC_ADDRESS),
    hasSecretKey: Boolean(env.PAYSTACK_SECRET_KEY),
    hasBotToken: Boolean(env.TELEGRAM_BOT_TOKEN),
    envKeyCount: Object.keys(env || {}).length,
    publicEnvKeys: envKeys
  });
}
