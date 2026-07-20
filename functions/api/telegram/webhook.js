import { getSupabase, json, sendTelegram } from "../../lib/store.js";
import { processTelegramUpdate } from "../../lib/bot-commands.js";

export async function onRequestGet() {
  return json({
    ok: true,
    service: "telegram-webhook",
    hint: "Telegram sends POST updates here. Open the store at / instead."
  });
}

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const update = await request.json();

    const secret = env.TELEGRAM_WEBHOOK_SECRET;
    if (secret) {
      const header = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (header !== secret) return json({ error: "Forbidden" }, 403);
    }

    await processTelegramUpdate(env, update, {
      getSupabase,
      sendTelegram
    });

    return json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return json({ ok: true });
  }
}
