import { readFileSync } from "fs";
import { spawnSync } from "child_process";

const project = process.env.CF_PAGES_PROJECT || "dtdpaymentsbot";
const envPath = new URL("../.env", import.meta.url);
const raw = readFileSync(envPath, "utf8");

const secretKeys = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PAYSTACK_PUBLIC_KEY",
  "PAYSTACK_SECRET_KEY",
  "PAYSTACK_CURRENCY",
  "PAYSTACK_CONVERSION_RATE",
"USDT_TRC20_ADDRESS",
  "BTC_ADDRESS",
  "ESCROW_DEPOSIT_ADDRESS",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ADMIN_CHAT_ID",
  "TELEGRAM_SECOND_ADMIN_CHAT_ID",
  "TELEGRAM_ADMIN_CHAT_IDS",
  "TELEGRAM_CHANNEL_ID",
  "TELEGRAM_BACKUP_CHANNEL_ID",
  "TELEGRAM_GROUP_ID",
  "TELEGRAM_AUTO_APPROVE_JOINS",
  "TELEGRAM_CHANNEL_MIRROR",
  "TELEGRAM_MIRROR_FROM_CHANNEL_ID",
  "TELEGRAM_MIRROR_TO_CHAT_ID",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_OWNER_USERNAME",
  "TELEGRAM_VENDOR_USERNAME",
  "TELEGRAM_CHANNEL_USERNAME",
  "TELEGRAM_WEBHOOK_SECRET",
  "STORE_URL",
  "COMPANY_URL",
  "COMPANY_NAME",
  "SUPPORT_EMAIL",
  "MAIL_FROM",
  "MAIL_DOMAIN",
  "MAIL_HOSTNAME",
  "VPS_MAIL_MODE",
  "SMTP_HOST",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "TELETHON_PHONE",
  "SMS_FROM",
  "SMTP_CONSOLE_SECRET",
  "SMTP_ALLOW_CF_EMAIL",
  "VPS_MAILER_URL",
  "VPS_MAILER_SECRET",
  "VPS_HOST",
  "VPS_BINANCE_PROXY_URL",
  "CF_ACCOUNT_ID",
  "CLOUDFLARE_ACCOUNT_ID",
  "CF_EMAIL_API_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "SMS_GATEWAY_URL",
  "SMS_GATEWAY_TOKEN",
  "SMS_GATEWAY_USER",
  "SMS_GATEWAY_PASS",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "ANTHROPIC_API_KEY",
  "CLAUDE_API_KEY",
  "ANTHROPIC_MODEL"
];

const values = {};
for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  values[key] = value;
}

const bulk = secretKeys
  .filter((key) => values[key])
  .map((key) => `${key}=${values[key]}`)
  .join("\n");

if (!bulk) {
  console.error("No secrets found in .env to upload.");
  process.exit(1);
}

const result = spawnSync(
  "npx",
  ["wrangler", "pages", "secret", "bulk", "-", "--project-name", project],
  { input: bulk, stdio: ["pipe", "inherit", "inherit"], shell: true }
);

process.exit(result.status ?? 1);
