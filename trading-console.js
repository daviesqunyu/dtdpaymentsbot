import { MarketStreams, formatPrice } from "./trading/market.js";
import { TradeChart } from "./trading/charts.js";
import {
  loadAccount,
  loadOpenOrders,
  loadMyTrades,
  placeOrder,
  cancelOrder,
  renderBalances,
  renderOpenOrders,
  renderFills,
  freeBalance
} from "./trading/orders.js";
import { appendAiMessage, askAiGuide } from "./trading/ai-guide.js";
import {
  BOT_CATALOG,
  loadBotPrefs,
  saveBotPrefs,
  loadTradeKeys,
  saveTradeKeys,
  detectTelegramChatId,
  sendBotAlert,
  renderBotsPanel
} from "./trading/bots.js";
import { renderWalletPanel } from "./trading/wallet.js";

const DEFAULT_PAIRS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"];
const TRADE_TOKEN_KEY = "dtd_trade_token";
const TRADE_META_KEY = "dtd_trade_meta";

const state = {
  side: "BUY",
  symbol: "BTCUSDT",
  interval: "5m",
  ticker: {},
  account: null,
  keys: loadTradeKeys(),
  botPrefs: loadBotPrefs(),
  chart: null,
  market: null,
  recentTrades: [],
  storeConfig: null,
  booted: false,
  accessToken: localStorage.getItem(TRADE_TOKEN_KEY) || "",
  accessMeta: null,
  deskReady: false
};

try {
  state.accessMeta = JSON.parse(localStorage.getItem(TRADE_META_KEY) || "null");
} catch {
  state.accessMeta = null;
}

function hasTradeAccess() {
  return Boolean(state.accessToken);
}

function setTradeAccess(payload) {
  state.accessToken = payload?.token || "";
  state.accessMeta = payload || null;
  if (state.accessToken) {
    localStorage.setItem(TRADE_TOKEN_KEY, state.accessToken);
    localStorage.setItem(TRADE_META_KEY, JSON.stringify(payload));
  } else {
    localStorage.removeItem(TRADE_TOKEN_KEY);
    localStorage.removeItem(TRADE_META_KEY);
  }
  syncTradeGate();
}

function syncTradeGate() {
  const lock = document.querySelector("#tradeLockPanel");
  const desk = document.querySelector("#tradeDesk");
  const unlocked = hasTradeAccess();
  if (lock) lock.hidden = unlocked;
  if (desk) desk.hidden = !unlocked;
}

async function unlockTradeAsAdmin() {
  const sb = window.supabaseClient || (typeof supabaseClient !== "undefined" ? supabaseClient : null);
  if (!sb) throw new Error("Supabase client missing — refresh the page.");
  const { data } = await sb.auth.getSession();
  let jwt = data?.session?.access_token || "";
  if (!jwt) {
    throw new Error("Sign in on Admin first, then return here.");
  }
  const resp = await fetch("/api/trade/unlock", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`
    },
    body: JSON.stringify({ mode: "admin" })
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
  setTradeAccess(json);
  return json;
}

function bindTradeUnlock() {
  const form = document.querySelector("#tradeUnlockForm");
  const status = document.querySelector("#tradeUnlockStatus");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (status) status.textContent = "Checking paid Trade order…";
    try {
      const resp = await fetch("/api/trade/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "order",
          orderId: form.orderId.value.trim(),
          email: form.email.value.trim()
        })
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
      setTradeAccess(json);
      if (status) status.textContent = json.message || "Trade profile created.";
      ensureTradeDesk();
    } catch (err) {
      if (status) status.textContent = err.message || "Unlock failed.";
    }
  });
  document.querySelector("#tradeAdminUnlock")?.addEventListener("click", async () => {
    if (status) status.textContent = "Admin unlock…";
    try {
      const json = await unlockTradeAsAdmin();
      if (status) status.textContent = json.message || "Admin unlocked.";
      ensureTradeDesk();
    } catch (err) {
      if (status) status.textContent = err.message || "Admin unlock failed.";
    }
  });
}

function saveKeys(next) {
  state.keys = saveTradeKeys({
    apiKey: next.apiKey ?? state.keys.apiKey,
    apiSecret: next.apiSecret ?? state.keys.apiSecret,
    tgChatId: next.tgChatId ?? state.keys.tgChatId
  });
  syncConnBadge();
  syncKeysFormChat();
  refreshBotsPanel();
}

function syncKeysFormChat() {
  const input = $("#tradeTgChatId");
  if (input && state.keys.tgChatId && input.value !== state.keys.tgChatId) {
    input.value = state.keys.tgChatId;
  }
}

function refreshBotsPanel() {
  const root = $("#tradeBotsRoot");
  const count = $("#tradeBotsCount");
  if (count) {
    const live = BOT_CATALOG.filter((b) => b.status === "live").length;
    const armed = state.botPrefs.telegramEnabled && state.keys.tgChatId;
    count.textContent = armed ? `${live} live · armed` : `${live} live · ${BOT_CATALOG.length - live} queued`;
  }
  if (!root) return;
  renderBotsPanel(root, {
    prefs: state.botPrefs,
    keys: state.keys,
    hasKeys: hasKeys(),
    onSelect: (id) => {
      state.botPrefs = saveBotPrefs({ ...state.botPrefs, activeBotId: id });
      refreshBotsPanel();
    },
    onToggle: (patch) => {
      state.botPrefs = saveBotPrefs({ ...state.botPrefs, ...patch });
      refreshBotsPanel();
    },
    onSaveChat: (chatId) => {
      const id = String(chatId || "").trim();
      if (!id) {
        const note = root.querySelector("#botsPanelStatus");
        if (note) note.textContent = "Enter a numeric Telegram chat ID, or Detect inside the Mini App.";
        return;
      }
      saveKeys({ ...state.keys, tgChatId: id });
      const note = root.querySelector("#botsPanelStatus");
      if (note) note.textContent = `Chat ${id} saved. Arm the bot to receive alerts.`;
    },
    onWatchToggle: (pair) => {
      const set = new Set(state.botPrefs.watchPairs || []);
      if (set.has(pair)) set.delete(pair);
      else set.add(pair);
      state.botPrefs = saveBotPrefs({ ...state.botPrefs, watchPairs: [...set] });
      refreshBotsPanel();
    },
    onTest: async () => {
      const note = root.querySelector("#botsPanelStatus");
      const chatId = state.keys.tgChatId;
      try {
        await sendBotAlert({
          chatId,
          text: `<b>DTD Trade</b>\nTest alert from Bot control center.\nWatch: ${(state.botPrefs.watchPairs || []).join(", ") || "—"}\nCommands: /trade · /price BTCUSDT · /ticker`
        });
        state.botPrefs = saveBotPrefs({ ...state.botPrefs, lastTestAt: Date.now() });
        if (note) note.textContent = "Test alert sent — check Telegram.";
      } catch (err) {
        if (note) note.textContent = err.message || "Test alert failed";
      }
    }
  });
}

function creds() {
  return { apiKey: state.keys.apiKey, apiSecret: state.keys.apiSecret };
}

function hasKeys() {
  return Boolean(state.keys.apiKey && state.keys.apiSecret);
}

function $(sel) {
  return document.querySelector(sel);
}

function syncConnBadge() {
  const el = $("#tradeConnBadge");
  if (!el) return;
  if (hasKeys()) {
    el.dataset.state = "on";
    el.textContent = "Keys on";
  } else {
    el.dataset.state = "off";
    el.textContent = "Keys off";
  }
}

function setLiveDot(on) {
  $("#tradeLiveDot")?.classList.toggle("is-live", on);
}

function baseAsset(symbol) {
  const s = String(symbol || "");
  if (s.endsWith("USDT")) return s.slice(0, -4);
  if (s.endsWith("USD")) return s.slice(0, -3);
  return s;
}

function quoteAsset() {
  return "USDT";
}

function updateTickerUi(t) {
  state.ticker = t;
  const priceEl = $("#tradeLastPrice");
  const chgEl = $("#tradePriceChange");
  if (priceEl) priceEl.textContent = formatPrice(t.last);
  if (chgEl) {
    const pct = Number(t.changePct);
    const sign = pct >= 0 ? "+" : "";
    chgEl.textContent = `${sign}${pct.toFixed(2)}%`;
    chgEl.classList.toggle("is-up", pct >= 0);
    chgEl.classList.toggle("is-down", pct < 0);
  }
  const bookMid = $("#tradeBookMid");
  if (bookMid) bookMid.textContent = formatPrice(t.last);
  const heroLast = $("#tradeHeroLast");
  if (heroLast) heroLast.textContent = formatPrice(t.last);
  const heroPair = $("#tradeHeroPair");
  if (heroPair) heroPair.textContent = `${baseAsset(state.symbol)} / ${quoteAsset()}`;
  updateEst();
}

function renderBook(depth) {
  const asksEl = $("#tradeAsks");
  const bidsEl = $("#tradeBids");
  if (!asksEl || !bidsEl) return;
  const asks = (depth.asks || []).slice(0, 10).reverse();
  const bids = (depth.bids || []).slice(0, 10);
  asksEl.innerHTML = asks
    .map(
      ([p, q]) =>
        `<div class="trade-book-row is-ask"><span>${formatPrice(p)}</span><span>${formatPrice(q, 4)}</span></div>`
    )
    .join("");
  bidsEl.innerHTML = bids
    .map(
      ([p, q]) =>
        `<div class="trade-book-row is-bid"><span>${formatPrice(p)}</span><span>${formatPrice(q, 4)}</span></div>`
    )
    .join("");
}

function pushRecentTrade(t) {
  state.recentTrades.unshift(t);
  state.recentTrades = state.recentTrades.slice(0, 30);
  const el = $("#tradeRecent");
  if (!el) return;
  el.innerHTML = state.recentTrades
    .map((r) => {
      const side = r.isBuyerMaker ? "sell" : "buy";
      return `<div class="trade-recent-row is-${side}">
        <span>${formatPrice(r.price)}</span>
        <span>${formatPrice(r.qty, 4)}</span>
        <span>${side.toUpperCase()}</span>
      </div>`;
    })
    .join("");
}

function setSide(side) {
  state.side = side;
  document.querySelectorAll("[data-trade-side]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-trade-side") === side);
  });
  const submit = $("#tradeSubmitBtn");
  if (submit) {
    submit.textContent = side === "BUY" ? "Buy" : "Sell";
    submit.classList.toggle("is-sell", side === "SELL");
  }
  updateEst();
}

function updateEst() {
  const qty = Number($("#tradeQty")?.value || 0);
  const type = $("#tradeOrderType")?.value || "MARKET";
  const limit = Number($("#tradeLimitPrice")?.value || 0);
  const px = type === "LIMIT" && limit > 0 ? limit : Number(state.ticker.last || 0);
  const est = $("#tradeOrderEst");
  if (!est) return;
  if (!qty || !px) {
    est.textContent = "Est. total: —";
    return;
  }
  est.textContent = `Est. total: ${formatPrice(qty * px)} ${quoteAsset()}`;
}

function showTab(name) {
  document.querySelectorAll("[data-trade-tab]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-trade-tab") === name);
  });
  document.querySelectorAll("[data-trade-panel]").forEach((panel) => {
    const match = panel.getAttribute("data-trade-panel") === name;
    panel.hidden = !match;
    panel.classList.toggle("is-active", match);
  });
  const section = $("#trade");
  if (section) {
    section.classList.toggle("is-desktop-split", name !== "chart" && window.innerWidth >= 960);
    if (name !== "chart" && window.innerWidth >= 960) {
      const chartPanel = document.querySelector('[data-trade-panel="chart"]');
      if (chartPanel) {
        chartPanel.hidden = false;
        chartPanel.classList.add("is-active");
      }
    }
  }
  if (name === "chart" || name === "trade") {
    requestAnimationFrame(() => {
      if (state.chart && !state.chart.chart) state.chart.mount();
      state.chart?.resize?.();
      state.chart?.chart?.timeScale().fitContent();
    });
  }
  if (name === "orders" && hasKeys()) refreshAccount();
  if (name === "bots") refreshBotsPanel();
  if (name === "wallet") refreshWalletPanel();
}

async function loadTradeConfig() {
  if (state.storeConfig) return state.storeConfig;
  try {
    const resp = await fetch("/api/config");
    state.storeConfig = await resp.json();
  } catch {
    state.storeConfig = {};
  }
  return state.storeConfig;
}

async function refreshWalletPanel() {
  const root = $("#tradeWalletRoot");
  if (!root) return;
  const cfg = await loadTradeConfig();
  const address = String(cfg.usdtTrc20Address || "").trim();
  const botUrl = cfg.telegramBotUrl || "https://t.me/DTDSTOREBOT";
  renderWalletPanel(root, {
    address,
    botUrl,
    onCopy: async (addr) => {
      const status = $("#tradeWalletStatus");
      try {
        await navigator.clipboard.writeText(addr);
        if (status) status.textContent = "USDT address copied.";
      } catch {
        if (status) status.textContent = "Copy failed — select the address manually.";
      }
    },
    onOpenBot: () => {
      const status = $("#tradeWalletStatus");
      if (status) {
        status.textContent =
          "In @DTDSTOREBOT send /withdraw AMOUNT YOUR_USDT_ADDRESS — then wait for owner Confirm withdrawn.";
      }
      window.open(`${botUrl}?start=trade`, "_blank", "noopener,noreferrer");
    }
  });
}

async function restartStreams() {
  if (!state.market) return;
  state.market.setSymbol(state.symbol);
  state.market.setInterval(state.interval);
  setLiveDot(false);
  const chartStatus = $("#tradeChartStatus");
  try {
    const hist = await state.market.loadHistory(200);
    state.chart?.setHistory(hist);
    if (chartStatus) {
      chartStatus.hidden = true;
      chartStatus.textContent = "";
    }
  } catch (err) {
    console.warn("kline history", err);
    if (chartStatus) {
      chartStatus.hidden = false;
      chartStatus.textContent = "Couldn’t load candles — check connection, then change interval to retry.";
    }
  }
  state.market.start();
}

async function refreshAccount() {
  if (!hasKeys()) {
    renderBalances($("#tradeBalances"), null);
    $("#tradeOpenOrders").innerHTML = `<p class="form-note">Connect API keys first.</p>`;
    $("#tradeFills").innerHTML = "";
    return;
  }
  try {
    const [account, open, fills] = await Promise.all([
      loadAccount(creds()),
      loadOpenOrders(creds(), state.symbol),
      loadMyTrades(creds(), state.symbol, 25)
    ]);
    state.account = account;
    renderBalances($("#tradeBalances"), account);
    renderOpenOrders($("#tradeOpenOrders"), open, {
      onCancel: async (orderId) => {
        try {
          await cancelOrder(creds(), state.symbol, orderId);
          await notifyTg(`Cancelled order <code>${orderId}</code> on ${state.symbol}`);
          await refreshAccount();
        } catch (err) {
          const status = $("#tradeOrderStatus");
          if (status) status.textContent = err.message || "Cancel failed";
          else console.warn(err);
        }
      }
    });
    renderFills($("#tradeFills"), fills);
  } catch (err) {
    $("#tradeBalances").innerHTML = `<p class="form-note">${err.message || "Account load failed"}</p>`;
  }
}

async function notifyTg(text, { force = false } = {}) {
  const chatId = state.keys.tgChatId;
  if (!chatId) return;
  if (!force) {
    if (!state.botPrefs.telegramEnabled) return;
    if (!state.botPrefs.alertOnFill) return;
  }
  try {
    await sendBotAlert({ chatId, text: `<b>DTD Trade</b>\n${text}` });
  } catch {
    /* optional */
  }
}

function bindUi() {
  document.querySelectorAll("[data-trade-tab]").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.getAttribute("data-trade-tab")));
  });

  document.querySelectorAll("[data-trade-side]").forEach((btn) => {
    btn.addEventListener("click", () => setSide(btn.getAttribute("data-trade-side")));
  });

  $("#tradePairSelect")?.addEventListener("change", (e) => {
    state.symbol = e.target.value;
    state.recentTrades = [];
    restartStreams();
    if (hasKeys()) refreshAccount();
  });

  $("#tradeIntervalSelect")?.addEventListener("change", (e) => {
    state.interval = e.target.value;
    restartStreams();
  });

  $("#tradeOrderType")?.addEventListener("change", (e) => {
    const wrap = $("#tradeLimitPriceWrap");
    if (wrap) wrap.hidden = e.target.value !== "LIMIT";
    updateEst();
  });

  $("#tradeQty")?.addEventListener("input", updateEst);
  $("#tradeLimitPrice")?.addEventListener("input", updateEst);

  document.querySelectorAll("[data-qty-pct]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pct = Number(btn.getAttribute("data-qty-pct") || 0) / 100;
      if (!state.account || !pct) return;
      const last = Number(state.ticker.last || 0);
      if (state.side === "BUY") {
        const usdt = freeBalance(state.account, "USDT");
        if (!last) return;
        $("#tradeQty").value = String((usdt * pct) / last);
      } else {
        const base = freeBalance(state.account, baseAsset(state.symbol));
        $("#tradeQty").value = String(base * pct);
      }
      updateEst();
    });
  });

  $("#tradeOrderForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("#tradeOrderStatus");
    if (!hasKeys()) {
      status.textContent = "Connect Binance API keys in the Keys tab first.";
      showTab("keys");
      return;
    }
    const quantity = String($("#tradeQty")?.value || "").trim();
    const orderType = $("#tradeOrderType")?.value || "MARKET";
    const params = {
      symbol: state.symbol,
      side: state.side,
      type: orderType,
      quantity
    };
    if (orderType === "LIMIT") {
      params.timeInForce = "GTC";
      params.price = String($("#tradeLimitPrice")?.value || "");
    }
    status.textContent = "Sending…";
    try {
      const result = await placeOrder(creds(), params);
      status.textContent = `Order ${result.status || "accepted"} · id ${result.orderId || "—"}`;
      await notifyTg(
        `${state.side} ${quantity} ${state.symbol} (${orderType}) → <code>${result.status || "ok"}</code>`
      );
      await refreshAccount();
    } catch (err) {
      status.textContent = err.message || "Order failed";
    }
  });

  $("#tradeKeysForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("#tradeKeysStatus");
    const apiKey = $("#tradeApiKey")?.value.trim() || "";
    const apiSecret = $("#tradeApiSecret")?.value.trim() || "";
    const tgChatId = $("#tradeTgChatId")?.value.trim() || "";
    if (!apiKey || !apiSecret) {
      status.textContent = "API key and secret are required.";
      return;
    }
    status.textContent = "Testing connection…";
    try {
      saveKeys({ apiKey, apiSecret, tgChatId });
      await loadAccount(creds());
      status.textContent = "Connected. Spot account readable.";
      await refreshAccount();
    } catch (err) {
      status.textContent = err.message || "Connection failed";
    }
  });

  $("#tradeDisconnect")?.addEventListener("click", () => {
    saveKeys({ apiKey: "", apiSecret: "", tgChatId: state.keys.tgChatId });
    $("#tradeApiKey").value = "";
    $("#tradeApiSecret").value = "";
    state.account = null;
    $("#tradeKeysStatus").textContent = "Disconnected. Keys cleared from this browser.";
    refreshAccount();
  });

  $("#tradeRefreshAccount")?.addEventListener("click", () => refreshAccount());

  $("#tradeTgChatId")?.addEventListener("change", () => {
    const tgChatId = $("#tradeTgChatId")?.value.trim() || "";
    if (tgChatId !== state.keys.tgChatId) {
      saveKeys({ ...state.keys, tgChatId });
    }
  });

  // Deep-link #trade-bots or [data-trade-open=bots]
  document.querySelectorAll("[data-trade-open]").forEach((el) => {
    el.addEventListener("click", () => {
      setTimeout(() => {
        const tab = el.getAttribute("data-trade-open");
        if (tab) showTab(tab);
      }, 80);
    });
  });

  $("#tradeAiForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#tradeAiInput");
    const status = $("#tradeAiStatus");
    const message = input?.value.trim();
    if (!message) return;
    appendAiMessage($("#tradeAiChat"), "user", message);
    input.value = "";
    status.textContent = "Thinking…";
    try {
      const reply = await askAiGuide({
        message,
        symbol: state.symbol,
        candles: state.chart?.snapshot(40) || [],
        ticker: state.ticker
      });
      appendAiMessage($("#tradeAiChat"), "bot", reply);
      status.textContent = "";
    } catch (err) {
      status.textContent = err.message || "AI failed";
    }
  });
}

function ensureTradeDesk() {
  if (!hasTradeAccess() || state.deskReady) return;
  state.deskReady = true;

  const pairSel = $("#tradePairSelect");
  if (pairSel && !pairSel.options.length) {
    DEFAULT_PAIRS.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = `${p.replace("USDT", " / USDT")}`;
      pairSel.appendChild(opt);
    });
  }

  if (state.keys.apiKey) $("#tradeApiKey").value = state.keys.apiKey;
  if (state.keys.apiSecret) $("#tradeApiSecret").value = state.keys.apiSecret;
  if (!state.keys.tgChatId) {
    const detected = detectTelegramChatId();
    if (detected) saveKeys({ ...state.keys, tgChatId: detected });
  }
  if (state.keys.tgChatId) $("#tradeTgChatId").value = state.keys.tgChatId;

  state.chart = new TradeChart($("#tradeChart"));
  showTab("chart");
  requestAnimationFrame(() => {
    const ok = state.chart.mount();
    if (!ok) setTimeout(() => state.chart?.mount(), 400);
  });

  state.market = new MarketStreams();
  state.market.on("status", (s) => setLiveDot(s === "live"));
  state.market.on("kline", (c) => state.chart?.updateCandle(c));
  state.market.on("ticker", updateTickerUi);
  state.market.on("depth", renderBook);
  state.market.on("trade", pushRecentTrade);

  bindUi();
  document.querySelectorAll("[data-chart-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-chart-mode") || "candles";
      document.querySelectorAll("[data-chart-mode]").forEach((b) => {
        b.classList.toggle("is-active", b === btn);
      });
      state.chart?.setMode(mode);
    });
  });
  syncConnBadge();
  refreshBotsPanel();
  loadTradeConfig().then(() => refreshWalletPanel());
  setSide("BUY");
  restartStreams();
  if (hasKeys()) refreshAccount();
}

function bootTrade() {
  if (state.booted) return;
  const section = $("#trade");
  if (!section) return;
  state.booted = true;
  bindTradeUnlock();
  syncTradeGate();
  // Resume admin if already signed in on Admin
  if (!hasTradeAccess()) {
    const sb = window.supabaseClient || (typeof supabaseClient !== "undefined" ? supabaseClient : null);
    sb?.auth
      ?.getSession?.()
      .then(({ data }) => {
        if (data?.session?.access_token) {
          unlockTradeAsAdmin()
            .then(() => ensureTradeDesk())
            .catch(() => {});
        }
      })
      .catch(() => {});
  } else {
    ensureTradeDesk();
  }
}

function onTradePageVisible() {
  const hash = (location.hash || "").replace(/^#/, "");
  if (hash === "trade" || hash === "trade-bots" || hash === "trade-wallet" || hash.startsWith("trade")) {
    bootTrade();
    requestAnimationFrame(() => {
      if (!hasTradeAccess()) return;
      if (state.chart && !state.chart.chart) state.chart.mount();
      if (hash === "trade-bots") showTab("bots");
      if (hash === "trade-wallet") showTab("wallet");
    });
  }
}

window.addEventListener("hashchange", onTradePageVisible);
document.addEventListener("DOMContentLoaded", () => {
  onTradePageVisible();
  // Also boot lazily when nav clicks trade
  document.querySelectorAll('[data-nav="trade"], a[href="#trade"]').forEach((el) => {
    el.addEventListener("click", () => setTimeout(onTradePageVisible, 50));
  });
});

// If already on #trade at module load
onTradePageVisible();
