import {
  chatJson,
  readSession,
  sanitizeBody,
  mirrorChatToChannels,
  whatsappChannelUrl,
  whatsappShareUrl
} from "../../lib/chat.js";
import { listMessages, insertMessage } from "../../lib/chat-store.js";

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 80;

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get("limit") || DEFAULT_LIMIT)));
  const before = url.searchParams.get("before");
  const session = await readSession(env, request);

  try {
    const { messages } = await listMessages(env, {
      limit,
      before,
      userId: session?.id || null
    });

    const bot = String(env.TELEGRAM_BOT_USERNAME || "DTDSTOREBOT").replace(/^@/, "");
    const channel = String(env.TELEGRAM_CHANNEL_USERNAME || "DTDMAINSTORE").replace(/^@/, "");
    const wa = whatsappChannelUrl(env);

    return chatJson({
      messages,
      me: session
        ? { id: session.id, username: session.username, displayName: session.displayName }
        : null,
      rails: {
        telegramBotUrl: `https://t.me/${bot}`,
        telegramBotUsername: bot,
        telegramChannelUrl: `https://t.me/${channel}`,
        telegramChannelUsername: channel,
        whatsappChannelUrl: wa || null,
        chatDeepLink: `https://t.me/${bot}?start=chat`
      }
    });
  } catch (err) {
    return chatJson({ error: err.message || "Failed to load chat" }, 500);
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const session = await readSession(env, request);
  if (!session) {
    return chatJson({ error: "Sign in with your Telegram @username to post." }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return chatJson({ error: "Invalid JSON" }, 400);
  }

  let text;
  try {
    text = sanitizeBody(body.body || body.text);
  } catch (err) {
    return chatJson({ error: err.message }, 400);
  }

  try {
    const { message } = await insertMessage(env, {
      userId: session.id,
      username: session.username,
      displayName: session.displayName,
      body: text
    });

    const mirror = await mirrorChatToChannels(env, {
      username: session.username,
      body: text,
      messageId: message.id
    });

    const store = String(env.STORE_URL || "https://dtdpaymentsbot.pages.dev").replace(/\/$/, "");
    return chatJson({
      ok: true,
      message,
      share: {
        whatsapp:
          mirror.whatsappShareUrl ||
          whatsappShareUrl(`@${session.username}: ${text}\n${store}/#chat`),
        telegram: `https://t.me/share/url?url=${encodeURIComponent(`${store}/#chat`)}&text=${encodeURIComponent(`@${session.username}: ${text}`)}`
      }
    });
  } catch (err) {
    return chatJson({ error: err.message || "Post failed" }, err.status || 500);
  }
}
