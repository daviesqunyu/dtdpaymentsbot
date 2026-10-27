// DTD Store — Telegram bot commands stub (minimal)
// Keeps the Express server bootable when the full bot module is not present.
export async function processTelegramUpdate(env, update, { getSupabase, sendTelegram }) {
  // No-op stub: the full Telegram bot is wired separately.
  // Return a resolved update acknowledgement so the webhook stays healthy.
  return { ok: true, handled: false, reason: 'bot_commands_stub' };
}
