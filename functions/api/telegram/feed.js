import { json } from "../../lib/store.js";

const CHANNEL_USERNAME = "DTDMAINSTORE";
const CHANNEL_URL = `https://t.me/${CHANNEL_USERNAME}`;
const PUBLIC_FEED_URL = `https://t.me/s/${CHANNEL_USERNAME}`;

function stripHtml(value = "") {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function latestPublicPost(html) {
  const postMatch = html.match(
    new RegExp(
      `data-post="${CHANNEL_USERNAME}\\/(\\d+)"[\\s\\S]*?tgme_widget_message_text[^>]*>([\\s\\S]*?)<\\/div>`,
      "i"
    )
  );
  if (!postMatch) return null;

  const [, messageId, rawText] = postMatch;
  const beforeText = html.slice(Math.max(0, postMatch.index - 500), postMatch.index + postMatch[0].length);
  const date = beforeText.match(/datetime="([^"]+)"/i)?.[1] || null;
  const text = stripHtml(rawText).slice(0, 500);
  if (!text) return null;

  return {
    text,
    date,
    url: `${CHANNEL_URL}/${messageId}`
  };
}

export async function onRequestGet() {
  try {
    const response = await fetch(PUBLIC_FEED_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DTDStore/1.0)",
        Accept: "text/html"
      },
      cf: { cacheTtl: 300, cacheEverything: true }
    });
    if (!response.ok) throw new Error(`Telegram returned ${response.status}`);

    const post = latestPublicPost(await response.text());
    if (!post) throw new Error("No readable public Telegram post");

    return json({ channelUrl: CHANNEL_URL, post, fallback: false });
  } catch {
    return json({
      channelUrl: CHANNEL_URL,
      post: null,
      fallback: true
    });
  }
}
