import { json } from "../lib/store.js";

/** Public visitor meta for the assistant widget (IP only). */
export async function onRequestGet(context) {
  const { request } = context;
  const forwarded = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
  const ip = String(forwarded).split(",")[0].trim() || "unknown";
  return json({
    ip,
    userAgent: request.headers.get("User-Agent") || ""
  });
}
