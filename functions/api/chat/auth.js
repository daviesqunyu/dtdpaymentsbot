import {
  chatJson,
  validateTelegramInitData,
  issueSession,
  createLinkCode,
  completeLinkCode
} from "../../lib/chat.js";

export async function onRequestPost(context) {
  const { env, request } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return chatJson({ error: "Invalid JSON" }, 400);
  }

  const action = String(body.action || "miniapp").toLowerCase();

  try {
    if (action === "miniapp" || action === "init") {
      const identity = await validateTelegramInitData(env, body.initData || "");
      if (!identity) {
        return chatJson(
          { error: "Open Chat inside Telegram Mini App, or use Link Telegram on the web." },
          401
        );
      }
      if (!identity.username) {
        return chatJson(
          {
            error: "Your Telegram account needs a public @username to post on DTD Chat.",
            needUsername: true
          },
          400
        );
      }
      const session = await issueSession(env, identity);
      return chatJson({ ok: true, ...session });
    }

    if (action === "start_claim") {
      const claim = await createLinkCode(env);
      return chatJson({ ok: true, ...claim });
    }

    if (action === "complete_claim") {
      const session = await completeLinkCode(env, body.code || "");
      return chatJson({ ok: true, ...session });
    }

    return chatJson({ error: "Unknown action" }, 400);
  } catch (err) {
    const msg = err?.message || String(err);
    const missing = /relation|does not exist|chat_/i.test(msg);
    return chatJson(
      {
        error: missing
          ? "Chat tables are missing. Run supabase-chat.sql in the Supabase SQL Editor."
          : msg
      },
      missing ? 503 : 400
    );
  }
}
