export function appendAiMessage(el, role, text) {
  if (!el) return;
  const div = document.createElement("div");
  div.className = `trade-ai-msg is-${role === "user" ? "user" : "bot"}`;
  div.textContent = text;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

export async function askAiGuide({ message, symbol, candles, ticker }) {
  const resp = await fetch("/api/trade/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, symbol, candles, ticker })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);
  return data.reply;
}
