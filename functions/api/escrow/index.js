import { json, getSupabase } from "../../lib/store.js";

export async function onRequestGet(context) {
  try {
    const { env, request } = context;
    const url = new URL(request.url);
    const handle = String(url.searchParams.get("handle") || "")
      .trim()
      .replace(/^@/, "");
    if (!handle) return json({ error: "Provide a Telegram handle." }, 400);

    const supabase = getSupabase(env);
    if (!supabase) return json({ error: "Escrow storage unavailable." }, 503);

    const { data, error } = await supabase
      .from("escrow_sessions")
      .select("code,title,amount_usd,status,created_at,buyer_telegram,seller_telegram")
      .or(`buyer_telegram.eq.@${handle},seller_telegram.eq.@${handle}`)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) return json({ error: error.message || "Lookup failed." }, 500);

    return json({
      ok: true,
      handle,
      escrows: (data || []).map((s) => ({
        code: s.code,
        title: s.title,
        amountUsd: Number(s.amount_usd || 0),
        status: s.status,
        createdAt: s.created_at,
        buyerTelegram: s.buyer_telegram,
        sellerTelegram: s.seller_telegram
      }))
    });
  } catch (error) {
    return json({ error: error.message || "Escrow lookup failed." }, 500);
  }
}
