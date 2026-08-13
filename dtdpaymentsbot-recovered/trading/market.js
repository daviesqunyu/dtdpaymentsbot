const WS_BASE = "wss://stream.binance.com:9443/stream";
const REST = "/api/trade/binance";

export async function binanceProxy({ apiKey, apiSecret, method, path, params }) {
  const resp = await fetch(REST, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, apiSecret, method, path, params })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) {
    throw new Error(data.error || `HTTP ${resp.status}`);
  }
  return data.data;
}

export function formatPrice(n, digits = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  if (Math.abs(x) >= 1000) return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(x) >= 1) return x.toLocaleString(undefined, { maximumFractionDigits: Math.max(2, digits) });
  return x.toLocaleString(undefined, { maximumSignificantDigits: 6 });
}

export class MarketStreams {
  constructor() {
    this.ws = null;
    this.symbol = "btcusdt";
    this.interval = "5m";
    this.handlers = {
      kline: null,
      ticker: null,
      depth: null,
      trade: null,
      status: null
    };
  }

  on(event, fn) {
    this.handlers[event] = fn;
  }

  setSymbol(symbol) {
    this.symbol = String(symbol || "BTCUSDT").toLowerCase();
  }

  setInterval(interval) {
    this.interval = String(interval || "5m");
  }

  stop() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  start() {
    this.stop();
    const s = this.symbol;
    const streams = [
      `${s}@kline_${this.interval}`,
      `${s}@ticker`,
      `${s}@depth10@100ms`,
      `${s}@trade`
    ].join("/");
    const url = `${WS_BASE}?streams=${streams}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.handlers.status?.("connecting");

    ws.onopen = () => this.handlers.status?.("live");
    ws.onclose = () => this.handlers.status?.("off");
    ws.onerror = () => this.handlers.status?.("error");
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      const payload = msg.data || msg;
      const stream = String(msg.stream || "");
      if (stream.includes("@kline_") && payload.k) {
        const k = payload.k;
        this.handlers.kline?.({
          time: Math.floor(k.t / 1000),
          open: Number(k.o),
          high: Number(k.h),
          low: Number(k.l),
          close: Number(k.c),
          volume: Number(k.v),
          closed: Boolean(k.x)
        });
      } else if (stream.includes("@ticker")) {
        this.handlers.ticker?.({
          last: Number(payload.c),
          changePct: Number(payload.P),
          high: Number(payload.h),
          low: Number(payload.l),
          volume: Number(payload.v)
        });
      } else if (stream.includes("@depth")) {
        this.handlers.depth?.({
          bids: (payload.bids || []).slice(0, 12),
          asks: (payload.asks || []).slice(0, 12)
        });
      } else if (stream.includes("@trade")) {
        this.handlers.trade?.({
          price: Number(payload.p),
          qty: Number(payload.q),
          isBuyerMaker: Boolean(payload.m),
          time: payload.T
        });
      }
    };
  }

  async loadHistory(limit = 200) {
    // Prefer browser→Binance public REST (CORS) so charts work even if CF→Binance is blocked.
    const symbol = this.symbol.toUpperCase();
    const interval = this.interval;
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const raw = await resp.json();
        return (raw || []).map((row) => ({
          time: Math.floor(Number(row[0]) / 1000),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5])
        }));
      }
    } catch {
      /* fall through */
    }
    const raw = await binanceProxy({
      method: "GET",
      path: "/api/v3/klines",
      params: { symbol, interval, limit }
    });
    return (raw || []).map((row) => ({
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5])
    }));
  }
}
