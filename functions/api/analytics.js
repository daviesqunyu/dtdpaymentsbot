import { getSupabase, json } from "../lib/store.js";

const MAX_EVENTS = 50;

function clampStr(value, max) {
  return String(value == null ? "" : value).slice(0, max);
}

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.events) || !body.events.length) {
      return json({ ok: true, skipped: true });
    }

    const supabase = getSupabase(env);
    if (!supabase) {
      // Storefront still works without analytics storage configured.
      return json({ ok: true, stored: 0, reason: "no_store" });
    }

    const country =
      (request.cf && request.cf.country) || request.headers.get("CF-IPCountry") || "";
    const ua = clampStr(body.userAgent || request.headers.get("user-agent"), 300);
    const now = Date.now();

    const rows = body.events.slice(0, MAX_EVENTS).map((event) => ({
      client_id: clampStr(body.clientId || "anon", 64),
      session_id: clampStr(body.sessionId, 64),
      event_type: clampStr(event.type || "event", 40),
      path: clampStr(event.path, 200),
      referrer: clampStr(body.referrer, 300),
      country: clampStr(country, 8),
      user_agent: ua,
      data: event.data && typeof event.data === "object" ? event.data : {},
      created_at: new Date(Number(event.ts) || now).toISOString()
    }));

    const { error } = await supabase.from("analytics_events").insert(rows);
    if (error) {
      // Never fail the client for analytics; surface as a soft warning.
      return json({ ok: true, stored: 0, warn: error.message });
    }

    return json({ ok: true, stored: rows.length });
  } catch (error) {
    return json({ ok: true, error: String(error?.message || error) });
  }
}
