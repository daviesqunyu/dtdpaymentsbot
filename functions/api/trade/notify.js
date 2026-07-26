/**
 * Optional Telegram notify for trade fills / cancels.
 * Body: { chatId, text }
 */
import { json } from "../../lib/store.js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!token) return json({ error: "Telegram bot not configured." }, 503);

    const body = await request.json().catch(() => ({}));
    const chatId = String(body.chatId || "").trim();
    const text = String(body.text || "").trim().slice(0, 3500);
    if (!chatId || !text) return json({ error: "chatId and text required." }, 400);

    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      return json({ error: data.description || "Telegram send failed." }, 400);
    }
    return json({ ok: true });
  } catch (error) {
    return json({ error: error.message || "Notify failed." }, 500);
  }
}
