/**
 * Trading bots registry + preferences (local).
 * Telegram bot is the live co-pilot; others are reserved slots.
 */

export const BOTS_LS = "dtd_trade_bots_v1";
export const KEYS_LS = "dtd_trade_binance_keys_v1";

export const BOT_CATALOG = [
  {
    id: "telegram",
    name: "Telegram Trading Bot",
    handle: "@DTDSTOREBOT",
    kind: "relay",
    status: "live",
    blurb: "Mobile co-pilot for quotes, watchlist, and fill alerts on your desk.",
    commands: ["/trade", "/price BTCUSDT", "/ticker"],
    deepLink: "https://t.me/DTDSTOREBOT?start=trade"
  },
  {
    id: "ai-scalper",
    name: "AI Scalper",
    handle: "Signal desk",
    kind: "signal",
    status: "soon",
    blurb: "Short-horizon AI levels from the Guide — entries stay on your Binance keys.",
    commands: [],
    deepLink: null
  },
  {
    id: "grid",
    name: "Grid Desk",
    handle: "Range grid",
    kind: "grid",
    status: "soon",
    blurb: "Place grid ladders on the selected pair once the engine ships.",
    commands: [],
    deepLink: null
  },
  {
    id: "dca",
    name: "DCA Ladder",
    handle: "Accumulate",
    kind: "dca",
    status: "soon",
    blurb: "Scheduled buys into dips — planned bot slot.",
    commands: [],
    deepLink: null
  }
];

const DEFAULT_PREFS = {
  activeBotId: "telegram",
  telegramEnabled: true,
  alertOnFill: true,
  alertOnConnect: true,
  watchPairs: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
  lastTestAt: null
};

export function loadBotPrefs() {
  try {
    const raw = localStorage.getItem(BOTS_LS);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveBotPrefs(prefs) {
  localStorage.setItem(BOTS_LS, JSON.stringify(prefs));
  return prefs;
}

/** Persist keys without wiping Telegram chat when Binance keys are empty. */
export function loadTradeKeys() {
  try {
    const raw = localStorage.getItem(KEYS_LS);
    if (!raw) return { apiKey: "", apiSecret: "", tgChatId: "" };
    const parsed = JSON.parse(raw);
    return {
      apiKey: String(parsed.apiKey || ""),
      apiSecret: String(parsed.apiSecret || ""),
      tgChatId: String(parsed.tgChatId || "")
    };
  } catch {
    return { apiKey: "", apiSecret: "", tgChatId: "" };
  }
}

export function saveTradeKeys(next) {
  const payload = {
    apiKey: String(next.apiKey || ""),
    apiSecret: String(next.apiSecret || ""),
    tgChatId: String(next.tgChatId || "")
  };
  localStorage.setItem(KEYS_LS, JSON.stringify(payload));
  return payload;
}

export function botById(id) {
  return BOT_CATALOG.find((b) => b.id === id) || BOT_CATALOG[0];
}

export function detectTelegramChatId() {
  try {
    const tg = window.Telegram?.WebApp;
    const id = tg?.initDataUnsafe?.user?.id;
    if (id) return String(id);
  } catch {
    /* ignore */
  }
  return "";
}

export async function sendBotAlert({ chatId, text }) {
  if (!chatId) throw new Error("Link a Telegram chat ID first.");
  const resp = await fetch("/api/trade/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, text })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

export function renderBotsPanel(root, ctx) {
  if (!root) return;
  const { prefs, keys, hasKeys, onSelect, onToggle, onSaveChat, onTest, onWatchToggle } = ctx;
  const active = botById(prefs.activeBotId);
  const tgLinked = Boolean(keys.tgChatId);
  const tgOn = Boolean(prefs.telegramEnabled && tgLinked);

  const statusChips = [
    { ok: hasKeys, label: hasKeys ? "Binance keys on" : "Binance keys off" },
    { ok: tgLinked, label: tgLinked ? `Chat ${keys.tgChatId}` : "Chat not linked" },
    { ok: tgOn, label: tgOn ? "TG bot armed" : "TG bot idle" }
  ];

  root.innerHTML = `
    <div class="bots-rail">
      <div class="bots-status-strip" role="status">
        ${statusChips
          .map(
            (c) =>
              `<span class="bots-chip ${c.ok ? "is-ok" : "is-off"}">${escapeHtml(c.label)}</span>`
          )
          .join("")}
        <span class="bots-chip is-meta">${BOT_CATALOG.filter((b) => b.status === "live").length} live · ${
    BOT_CATALOG.filter((b) => b.status === "soon").length
  } queued</span>
      </div>

      <div class="bots-layout">
        <aside class="bots-roster" aria-label="Bot roster">
          ${BOT_CATALOG.map((bot) => {
            const selected = bot.id === prefs.activeBotId;
            const live = bot.status === "live";
            const armed = bot.id === "telegram" ? tgOn : false;
            return `<button type="button" class="bots-roster-item ${selected ? "is-selected" : ""} ${
              live ? "is-live" : "is-soon"
            }" data-bot-select="${bot.id}">
              <span class="bots-roster-icon" data-kind="${bot.kind}" aria-hidden="true"></span>
              <span class="bots-roster-copy">
                <strong>${escapeHtml(bot.name)}</strong>
                <small>${escapeHtml(bot.handle)}</small>
              </span>
              <span class="bots-roster-flag">${live ? (armed ? "Armed" : "Live") : "Soon"}</span>
            </button>`;
          }).join("")}
        </aside>

        <div class="bots-detail" data-bot-detail="${active.id}">
          <header class="bots-detail-head">
            <div class="bots-detail-icon" data-kind="${active.kind}" aria-hidden="true"></div>
            <div>
              <p class="bots-kicker">${active.status === "live" ? "Active bot" : "Coming soon"}</p>
              <h3>${escapeHtml(active.name)}</h3>
              <p class="bots-detail-blurb">${escapeHtml(active.blurb)}</p>
            </div>
          </header>

          ${
            active.id === "telegram"
              ? telegramDetailHtml({ prefs, keys, tgLinked, tgOn })
              : soonDetailHtml(active)
          }
        </div>
      </div>
    </div>
  `;

  root.querySelectorAll("[data-bot-select]").forEach((btn) => {
    btn.addEventListener("click", () => onSelect?.(btn.getAttribute("data-bot-select")));
  });

  root.querySelector("#botsTgEnable")?.addEventListener("change", (e) => {
    onToggle?.({ telegramEnabled: e.target.checked });
  });
  root.querySelector("#botsAlertFill")?.addEventListener("change", (e) => {
    onToggle?.({ alertOnFill: e.target.checked });
  });
  root.querySelector("#botsSaveChat")?.addEventListener("click", () => {
    const val = root.querySelector("#botsChatInput")?.value?.trim() || "";
    onSaveChat?.(val);
  });
  root.querySelector("#botsDetectChat")?.addEventListener("click", () => {
    const detected = detectTelegramChatId();
    const input = root.querySelector("#botsChatInput");
    if (detected && input) input.value = detected;
    onSaveChat?.(detected || input?.value?.trim() || "");
  });
  root.querySelector("#botsTestAlert")?.addEventListener("click", () => onTest?.());
  root.querySelectorAll("[data-watch-pair]").forEach((btn) => {
    btn.addEventListener("click", () => onWatchToggle?.(btn.getAttribute("data-watch-pair")));
  });
}

function telegramDetailHtml({ prefs, keys, tgLinked, tgOn }) {
  const pairs = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"];
  return `
    <div class="bots-logic">
      <div class="bots-logic-step"><span>1</span><p>Link Telegram chat ID (or auto-detect in Mini App).</p></div>
      <div class="bots-logic-step"><span>2</span><p>Arm the bot — alerts use this chat only.</p></div>
      <div class="bots-logic-step"><span>3</span><p>Trade on the desk; bot relays fills + quotes via /price · /ticker.</p></div>
    </div>

    <div class="bots-controls">
      <label class="bots-field">
        Telegram chat ID
        <div class="bots-field-row">
          <input id="botsChatInput" type="text" inputmode="numeric" placeholder="e.g. 1802948414" value="${escapeAttr(
            keys.tgChatId || ""
          )}" />
          <button type="button" class="ghost-btn" id="botsDetectChat">Detect</button>
          <button type="button" class="smtp-primary-btn" id="botsSaveChat">Save</button>
        </div>
      </label>

      <div class="bots-toggles">
        <label class="bots-switch">
          <input type="checkbox" id="botsTgEnable" ${prefs.telegramEnabled ? "checked" : ""} />
          <span>Arm Telegram trading bot</span>
        </label>
        <label class="bots-switch">
          <input type="checkbox" id="botsAlertFill" ${prefs.alertOnFill ? "checked" : ""} />
          <span>Notify on fills / cancels</span>
        </label>
      </div>

      <div class="bots-watch">
        <p class="bots-watch-label">Watchlist bias (for /ticker context)</p>
        <div class="bots-watch-grid">
          ${pairs
            .map((p) => {
              const on = (prefs.watchPairs || []).includes(p);
              return `<button type="button" class="bots-watch-chip ${on ? "is-on" : ""}" data-watch-pair="${p}">${p.replace(
                "USDT",
                ""
              )}</button>`;
            })
            .join("")}
        </div>
      </div>

      <div class="bots-detail-actions">
        <a class="smtp-primary-btn" href="https://t.me/DTDSTOREBOT?start=trade" target="_blank" rel="noopener noreferrer">Open @DTDSTOREBOT</a>
        <button type="button" class="ghost-btn" id="botsTestAlert" ${tgLinked ? "" : "disabled"}>Send test alert</button>
      </div>
      <p class="form-note" id="botsPanelStatus">${
        tgOn
          ? "Bot armed — fills will ping Telegram when you trade."
          : tgLinked
            ? "Chat linked — toggle Arm to enable alerts."
            : "Link a chat ID to activate the Telegram trading bot."
      }</p>
    </div>
  `;
}

function soonDetailHtml(bot) {
  const logic = {
    signal: [
      "Guide reads candle context for the active pair.",
      "Surfaces short-horizon levels — you still click buy/sell.",
      "Optional ping through the Telegram alert rail."
    ],
    grid: [
      "Set high/low band on the selected symbol.",
      "Engine posts laddered limits with your spot keys.",
      "Fills report back to Telegram when armed."
    ],
    dca: [
      "Pick size, interval, and dip threshold.",
      "Scheduled market buys on your Binance account.",
      "Progress summaries land in Telegram."
    ]
  };
  const steps = logic[bot.kind] || [
    "Plugs into the same Binance keys as the desk.",
    "Shares the Telegram alert rail when live.",
    "Never custodial — orders stay on your account."
  ];
  return `
    <div class="bots-logic">
      ${steps
        .map((t, i) => `<div class="bots-logic-step"><span>${i + 1}</span><p>${escapeHtml(t)}</p></div>`)
        .join("")}
    </div>
    <div class="bots-soon-panel">
      <p>Reserved slot on the DTD Trade Platform — same keys, same alert rail as Telegram.</p>
      <ul>
        <li>Spot-only · never custodial</li>
        <li>Kind: <code>${escapeHtml(bot.kind)}</code></li>
      </ul>
      <p class="form-note">Select <strong>Telegram Trading Bot</strong> for live controls today.</p>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
