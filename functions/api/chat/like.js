import { chatJson, readSession } from "../../lib/chat.js";
import { toggleLike } from "../../lib/chat-store.js";

export async function onRequestPost(context) {
  const { env, request } = context;
  const session = await readSession(env, request);
  if (!session) return chatJson({ error: "Sign in with Telegram to like posts." }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return chatJson({ error: "Invalid JSON" }, 400);
  }

  const messageId = String(body.messageId || body.id || "").trim();
  if (!messageId) return chatJson({ error: "Missing message id" }, 400);

  try {
    const result = await toggleLike(env, { messageId, userId: session.id });
    return chatJson({ ok: true, ...result });
  } catch (err) {
    return chatJson({ error: err.message || "Like failed" }, 500);
  }
}
