import { json, sendTelegram } from "../../lib/store.js";

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const body = await request.json();
    const message = String(body.message || "").trim();
    const name = String(body.name || "Store visitor").trim();
    const contact = String(body.contact || "").trim();

    if (!message) return json({ error: "Message is required." }, 400);

    const result = await sendTelegram(
      env,
      env.TELEGRAM_ADMIN_CHAT_ID,
      [
        "<b>DTD Store chat</b>",
        `From: ${name}`,
        contact ? `Contact: ${contact}` : null,
        "",
        message
      ]
        .filter(Boolean)
        .join("\n")
    );

    if (!result.ok) {
      return json(
        {
          error:
            "Telegram bot is not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID as Pages secrets."
        },
        503
      );
    }

    return json({ ok: true });
  } catch (error) {
    console.error("Telegram message error:", error);
    return json({ error: "Could not send message." }, 500);
  }
}
