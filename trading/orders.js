import { binanceProxy, formatPrice } from "./market.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function loadAccount(creds) {
  return binanceProxy({
    ...creds,
    method: "GET",
    path: "/api/v3/account",
    params: {}
  });
}

export async function loadOpenOrders(creds, symbol) {
  return binanceProxy({
    ...creds,
    method: "GET",
    path: "/api/v3/openOrders",
    params: { symbol }
  });
}

export async function loadMyTrades(creds, symbol, limit = 20) {
  return binanceProxy({
    ...creds,
    method: "GET",
    path: "/api/v3/myTrades",
    params: { symbol, limit }
  });
}

export async function placeOrder(creds, params) {
  return binanceProxy({
    ...creds,
    method: "POST",
    path: "/api/v3/order",
    params
  });
}

export async function cancelOrder(creds, symbol, orderId) {
  return binanceProxy({
    ...creds,
    method: "DELETE",
    path: "/api/v3/order",
    params: { symbol, orderId }
  });
}

export function renderBalances(el, account) {
  if (!el) return;
  const bals = (account?.balances || [])
    .map((b) => ({
      asset: b.asset,
      free: Number(b.free),
      locked: Number(b.locked)
    }))
    .filter((b) => b.free + b.locked > 0)
    .sort((a, b) => b.free + b.locked - (a.free + a.locked))
    .slice(0, 24);

  if (!bals.length) {
    el.innerHTML = `<p class="form-note">No balances (or keys not connected).</p>`;
    return;
  }

  el.innerHTML = `<div class="trade-bal-grid">${bals
    .map(
      (b) => `<div class="trade-bal-card">
      <span>${esc(b.asset)}</span>
      <strong>${formatPrice(b.free, 6)}</strong>
      <span>locked ${formatPrice(b.locked, 6)}</span>
    </div>`
    )
    .join("")}</div>`;
}

export function renderOpenOrders(el, orders, { onCancel } = {}) {
  if (!el) return;
  if (!orders?.length) {
    el.innerHTML = `<p class="form-note">No open orders.</p>`;
    return;
  }
  el.innerHTML = `<table class="trade-table"><thead><tr>
    <th>Side</th><th>Type</th><th>Qty</th><th>Price</th><th></th>
  </tr></thead><tbody>${orders
    .map(
      (o) => `<tr data-oid="${esc(o.orderId)}">
      <td>${esc(o.side)}</td>
      <td>${esc(o.type)}</td>
      <td>${esc(o.origQty)}</td>
      <td>${esc(o.price)}</td>
      <td><button type="button" class="trade-cancel-btn" data-cancel="${esc(o.orderId)}">Cancel</button></td>
    </tr>`
    )
    .join("")}</tbody></table>`;

  el.querySelectorAll("[data-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => onCancel?.(btn.getAttribute("data-cancel")));
  });
}

export function renderFills(el, fills) {
  if (!el) return;
  if (!fills?.length) {
    el.innerHTML = `<p class="form-note">No recent fills.</p>`;
    return;
  }
  el.innerHTML = `<table class="trade-table"><thead><tr>
    <th>Side</th><th>Qty</th><th>Price</th><th>Time</th>
  </tr></thead><tbody>${fills
    .slice()
    .reverse()
    .map((f) => {
      const side = f.isBuyer ? "BUY" : "SELL";
      const t = new Date(f.time).toLocaleString();
      return `<tr>
        <td>${side}</td>
        <td>${esc(f.qty)}</td>
        <td>${esc(f.price)}</td>
        <td>${esc(t)}</td>
      </tr>`;
    })
    .join("")}</tbody></table>`;
}

export function freeBalance(account, asset) {
  const row = (account?.balances || []).find((b) => b.asset === asset);
  return row ? Number(row.free) : 0;
}
