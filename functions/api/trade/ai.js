/**
 * AI trading guide — Gemini with candle context. Educational only.
 */
import { json } from "../../lib/store.js";

const rate = new Map();

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function allowRate(ip, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const row = rate.get(ip) || { n: 0, t: now };
  if (now - row.t > windowMs) {
    row.n = 0;
    row.t = now;
  }
  row.n += 1;
  rate.set(ip, row);
  return row.n <= limit;
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!allowRate(clientIp(request))) {
      return json({ error: "Too many requests — wait a moment and try again." }, 429);
    }

    const body = await request.json().catch(() => ({}));
    const message = String(body.message || "").trim().slice(0, 500);
    const symbol = String(body.symbol || "BTCUSDT").trim().toUpperCase();
    const candles = Array.isArray(body.candles) ? body.candles.slice(-40) : [];
    const ticker = body.ticker || {};

    if (!message) return json({ error: "Message required." }, 400);

    const apiKey = String(env.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
      return json({
        ok: true,
        reply:
          "AI guide needs GEMINI_API_KEY on Pages secrets. Meanwhile: check support/resistance on the chart, size risk small, and never enable withdrawals on API keys."
      });
    }

    const compact = candles
      .map((c) => `${c.t}:${c.o}/${c.h}/${c.l}/${c.c}/${c.v || 0}`)
      .join(" | ");

    const systemPrompt = `You are DTD Trading Guide for crypto spot on Binance.
Be concise (under 180 words). Educational market framing only — NOT financial advice, NOT guaranteed signals.
Never tell the user to go all-in. Prefer risk management, invalidation levels, and uncertainty.
Symbol: ${symbol}
Last price: ${ticker.last ?? "n/a"} Change24h%: ${ticker.changePct ?? "n/a"}
Recent OHLCV (t:o/h/l/c/v): ${compact || "none"}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: message }] }],
          generationConfig: { maxOutputTokens: 320, temperature: 0.55 }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return json({ error: `Gemini error: ${errText.slice(0, 200)}` }, 502);
    }

    const payload = await response.json();
    const reply =
      payload.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No reply generated. Try again.";

    return json({ ok: true, reply });
  } catch (error) {
    return json({ error: error.message || "AI guide failed." }, 500);
  }
}
