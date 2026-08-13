const blockedProductTerms = [
  "fullz",
  "dump",
  "dumps",
  "cc ",
  "cc live",
  "checker",
  "bin x",
  "carding",
  "cvv"
];

  let storeConfig = {
  paystackPublicKey: "",
  paystackCurrency: "KES",
  paystackConversionRate: 129,
  usdtTrc20Address: "",
  usdtNetwork: "TRC20",
  btcAddress: "",
  btcNetwork: "BTC",
  starsEnabled: true,
  starsPerUsd: 75,
  paymentOptions: [
    { id: "Paystack", label: "Card / Bank · Global", type: "paystack" },
    { id: "USDT", label: "USDT (TRC20)", type: "crypto", asset: "USDT", network: "TRC20" },
    { id: "Bitcoin", label: "Bitcoin (BTC)", type: "crypto", asset: "BTC", network: "BTC" },
    { id: "Stars", label: "Telegram Stars ⭐", type: "stars", asset: "XTR" }
  ]
};

/* Payment funnel: track views → method → checkout → purchase / abandon */
const paymentFunnel = {
  enteredAt: 0,
  completed: false,
  lastMethod: ""
};

function inlineProductImage(title, subtitle, background, accent) {
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 620">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="${background}"/>
          <stop offset="1" stop-color="#111827"/>
        </linearGradient>
      </defs>
      <rect width="900" height="620" rx="34" fill="url(#bg)"/>
      <circle cx="734" cy="120" r="92" fill="${accent}" opacity=".24"/>
      <circle cx="118" cy="505" r="135" fill="#fff" opacity=".09"/>
      <rect x="96" y="92" width="708" height="436" rx="28" fill="#fff" opacity=".1"/>
      <rect x="140" y="142" width="220" height="28" rx="14" fill="#fff" opacity=".52"/>
      <rect x="140" y="204" width="620" height="8" rx="4" fill="${accent}"/>
      <rect x="140" y="252" width="288" height="154" rx="22" fill="#fff" opacity=".14"/>
      <rect x="460" y="252" width="300" height="154" rx="22" fill="#fff" opacity=".14"/>
      <path d="M234 334h96m-48-48v96" stroke="#fff" stroke-width="22" stroke-linecap="round"/>
      <path d="M560 338l48 48 82-108" fill="none" stroke="${accent}" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="140" y="472" fill="#fff" font-family="Sora,Arial,sans-serif" font-size="50" font-weight="800">${title}</text>
      <text x="140" y="515" fill="#d1d5db" font-family="Sora,Arial,sans-serif" font-size="28" font-weight="600">${subtitle}</text>
    </svg>
  `)}`;
}

const fallbackProducts = [
  {
    id: "starter",
    name: "Automation Bot Builder",
    description: "A ready setup package for simple workflow bots, auto replies, and order notifications.",
    price_usd: 49,
    color: "#0f766e",
    image_url: inlineProductImage("Bot Builder", "Automation setup", "#0f766e", "#f59e0b"),
    active: true
  },
  {
    id: "standard",
    name: "Customer Support Bot",
    description: "A support bot package for FAQs, customer intake, and clean handoff to your team.",
    price_usd: 79,
    color: "#2563eb",
    image_url: inlineProductImage("Support Bot", "FAQ and intake", "#2563eb", "#22c55e"),
    active: true
  },
  {
    id: "premium",
    name: "Analytics Dashboard Kit",
    description: "A lightweight dashboard product for tracking sales, orders, and customer activity.",
    price_usd: 129,
    color: "#7c2d12",
    image_url: inlineProductImage("Dashboard Kit", "Sales analytics", "#7c2d12", "#38bdf8"),
    active: true
  }
];

const state = {
  cart: new Map(),
  products: [],
  btcUsdPrice: 65000
};

const CART_STORAGE_KEY = "dtd_cart_v1";

function persistCart() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([...state.cart.entries()]));
  } catch {
    /* ignore quota / private mode */
  }
}

function restoreCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    state.cart = new Map(
      parsed
        .filter((entry) => Array.isArray(entry) && entry[0] && Number(entry[1]) > 0)
        .map(([id, qty]) => [String(id), Number(qty)])
    );
  } catch {
    state.cart = new Map();
  }
}

/* ---------- Lightweight usage analytics ---------- */
const analytics = {
  clientId: (() => {
    try {
      let id = localStorage.getItem("dtd_cid");
      if (!id) {
        id = (crypto.randomUUID && crypto.randomUUID()) || `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        localStorage.setItem("dtd_cid", id);
      }
      return id;
    } catch {
      return "anon";
    }
  })(),
  sessionId: (crypto.randomUUID && crypto.randomUUID()) || `s_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  queue: [],
  timer: null
};

function trackEvent(type, data = {}) {
  try {
    analytics.queue.push({
      type: String(type || "event"),
      data: data && typeof data === "object" ? data : {},
      path: `${location.pathname}${location.hash || ""}`,
      ts: Date.now()
    });
    if (!analytics.timer) {
      analytics.timer = setTimeout(() => flushAnalytics(false), 1500);
    }
    if (analytics.queue.length >= 12) flushAnalytics(false);
  } catch {
    /* analytics must never break the store */
  }
}

function flushAnalytics(useBeacon) {
  if (analytics.timer) {
    clearTimeout(analytics.timer);
    analytics.timer = null;
  }
  if (!analytics.queue.length) return;

  const events = analytics.queue.splice(0, analytics.queue.length);
  const body = JSON.stringify({
    clientId: analytics.clientId,
    sessionId: analytics.sessionId,
    referrer: document.referrer || "",
    userAgent: navigator.userAgent,
    events
  });

  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/analytics", new Blob([body], { type: "application/json" }));
      return;
    }
    fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

window.dtdTrack = trackEvent;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    trackPaymentAbandon("hidden");
    flushAnalytics(true);
  }
});
window.addEventListener("pagehide", () => {
  trackPaymentAbandon("pagehide");
  flushAnalytics(true);
});

const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const productsGrid = document.querySelector("#productsGrid");
const productSearch = document.querySelector("#productSearch");
const productCount = document.querySelector("#productCount");
const cartItems = document.querySelector("#cartItems");
const cartTotal = document.querySelector("#cartTotal");
const cartCount = document.querySelector("#cartCount");
const checkoutForm = document.querySelector("#checkoutForm");
const paymentHint = document.querySelector("#paymentHint");
const cryptoAddress = document.querySelector("#cryptoAddress");
const cryptoNetworkLabel = document.querySelector("#cryptoNetworkLabel");
const cryptoAssetBadge = document.querySelector("#cryptoAssetBadge");
const cryptoAssetTitle = document.querySelector("#cryptoAssetTitle");
const cryptoNetworkHint = document.querySelector("#cryptoNetworkHint");
const cryptoHowSteps = document.querySelector("#cryptoHowSteps");
const cryptoWarning = document.querySelector("#cryptoWarning");
const paymentReferenceInput = document.querySelector("#paymentReferenceInput");
const copyCryptoAddressButton = document.querySelector("#copyCryptoAddress");
const paymentMethodInput = document.querySelector("#paymentMethodInput");
const paymentMethodsGrid = document.querySelector("#paymentMethodsGrid");
const paystackButton = document.querySelector("#paystackButton");
const dtdPaymentPageButton = document.querySelector("#dtdPaymentPageButton");
const switchToCardPaymentButton = document.querySelector("#switchToCardPayment");
const starsPayButton = document.querySelector("#starsPayButton");
const starsPanelPanel = document.querySelector("#starsPaymentPanel");
const starsAmountHint = document.querySelector("#starsAmountHint");
const refreshProductsButton = document.querySelector("#refreshProducts");
const copyStoreLinkButton = document.querySelector("#copyStoreLink");
const toast = document.querySelector("#toast");
const cryptoPanel = document.querySelector("#cryptoPaymentPanel");
const paystackPanel = document.querySelector("#paystackPaymentPanel");
const telegramPaymentPanel = document.querySelector("#telegramPaymentPanel");
const telegramPaymentLink = document.querySelector("#telegramPaymentLink");
const telegramPaymentNote = document.querySelector("#telegramPaymentNote");
const liveStats = document.querySelector("#liveStats");
const btcQrCode = document.querySelector("#btcQrCode");
const btcAmountLabel = document.querySelector("#btcAmountLabel");
const checkoutSuccess = document.querySelector("#checkoutSuccess");
const successOrderId = document.querySelector("#successOrderId");
const successUserContact = document.querySelector("#successUserContact");
const successCloseButton = document.querySelector("#successCloseButton");

function formatMoney(value) {
  return formatter.format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function productPrice(product) {
  return Number(product.price_usd ?? product.price ?? 0);
}

function isAllowedProduct(product) {
  const searchable = `${product.name || ""} ${product.description || ""}`.toLowerCase();
  return !blockedProductTerms.some((term) => searchable.includes(term));
}

function currentTotal() {
  return cartEntries().reduce((sum, product) => sum + productPrice(product) * product.quantity, 0);
}

function selectedPaymentOption() {
  return (
    storeConfig.paymentOptions.find((option) => option.id === paymentMethodInput.value) ||
    storeConfig.paymentOptions[0] ||
    { id: "Paystack", type: "paystack", channels: [] }
  );
}

function isCryptoPayment() {
  return selectedPaymentOption().type === "crypto";
}

function isUsdtPayment(option = selectedPaymentOption()) {
  return option.type === "crypto" && (option.asset === "USDT" || option.id === "USDT");
}

function activeCryptoAddress(option = selectedPaymentOption()) {
  if (isUsdtPayment(option)) return storeConfig.usdtTrc20Address || "";
  return storeConfig.btcAddress || "";
}

function renderPaymentMethodsGrid() {
  if (!paymentMethodsGrid) return;

  const options = storeConfig.paymentOptions || [];
  paymentMethodsGrid.innerHTML = options.map((opt) => {
    const isSelected = opt.id === paymentMethodInput.value;

    let icon = "💳";
    if (opt.id === "USDT" || opt.asset === "USDT") icon = "₮";
    else if (opt.type === "stars" || opt.id === "Stars") icon = "⭐";
    else if (opt.type === "crypto") icon = "₿";
    else if (opt.id.includes("Card")) icon = "💳";
    else if (opt.id.includes("Bank")) icon = "🏛️";
    else if (opt.id.includes("QR")) icon = "🔍";

    let sub = "Secure checkout";
    let badge = "";
    if (opt.type === "paystack" || opt.id === "Paystack") {
      icon = "💳";
      sub = "Recommended · Global Card / Bank";
      badge = `<span class="method-rec">Recommended</span>`;
    } else if (opt.id === "USDT" || opt.asset === "USDT") {
      sub = "Optional · TRC20 crypto";
    } else if (opt.type === "stars") sub = "In-Telegram";
    else if (opt.type === "crypto") sub = "On-chain confirm";
    else if (opt.id.includes("Bank")) sub = "Bank transfer";

    return `
      <button type="button" class="payment-method-btn ${isSelected ? "selected" : ""} ${opt.type === "paystack" ? "is-recommended" : ""}" data-id="${opt.id}">
        ${badge}
        <span class="method-icon">${icon}</span>
        <span class="method-label">${opt.label}</span>
        <span class="method-sub">${sub}</span>
        <span class="select-check">✓</span>
      </button>
    `;
  }).join("");

  paymentMethodsGrid.querySelectorAll(".payment-method-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      paymentMethodInput.value = btn.dataset.id;
      paymentFunnel.lastMethod = btn.dataset.id;
      updatePaymentHint();
      renderPaymentMethodsGrid();
      syncTelegramMainButton();
      haptic("selection");
      trackEvent("select_payment", {
        method: btn.dataset.id,
        page: "payment",
        cart_total: currentTotal(),
        cart_items: state.cart.size
      });
    });
  });
}

function markPaymentCompleted() {
  paymentFunnel.completed = true;
}

function trackPaymentAbandon(reason = "leave") {
  if (paymentFunnel.completed || !paymentFunnel.enteredAt) return;
  const dwell = Date.now() - paymentFunnel.enteredAt;
  if (dwell < 2500) return;
  trackEvent("payment_abandon", {
    reason,
    method: paymentFunnel.lastMethod || paymentMethodInput?.value || "",
    dwell_ms: dwell,
    cart_total: currentTotal(),
    cart_items: state.cart.size
  });
  paymentFunnel.enteredAt = 0;
}

function enterPaymentFunnel() {
  paymentFunnel.enteredAt = Date.now();
  paymentFunnel.completed = false;
  paymentFunnel.lastMethod = paymentMethodInput?.value || "Paystack";
  trackEvent("payment_view", {
    method: paymentFunnel.lastMethod,
    cart_total: currentTotal(),
    cart_items: state.cart.size,
    source: new URLSearchParams(location.search).get("utm_source") || "direct"
  });
}

function usdToStarsClient(usd) {
  const rate = Number(storeConfig.starsPerUsd || 75);
  return Math.max(1, Math.ceil(Number(usd || 0) * (rate > 0 ? rate : 75)));
}

function haptic(type = "light") {
  try {
    const h = window.Telegram?.WebApp?.HapticFeedback;
    if (!h) return;
    if (type === "success") h.notificationOccurred?.("success");
    else if (type === "error") h.notificationOccurred?.("error");
    else if (type === "selection") h.selectionChanged?.();
    else h.impactOccurred?.(type);
  } catch {
    /* older clients */
  }
}

function syncTelegramMainButton() {
  const tg = window.Telegram?.WebApp;
  if (!isInsideTelegramMiniApp() || !tg?.MainButton) return;

  const page = (location.hash || "#home").replace(/^#/, "").split("?")[0] || "home";
  const total = currentTotal();
  const items = state.cart.size;

  try {
    tg.MainButton.offClick?.(onTelegramMainButton);
  } catch {
    /* ignore */
  }

  const onPayment = page === "payment" || page === "checkout";

  if (page === "products" && items > 0) {
    tg.MainButton.setText(`Pay · ${formatter.format(total)}`);
    tg.MainButton.show();
    tg.MainButton.onClick(onTelegramMainButton);
    return;
  }

  if (onPayment && items > 0) {
    tg.MainButton.setParams?.({ is_active: true, is_visible: true });
    const option = selectedPaymentOption();
    if (option.type === "stars") {
      tg.MainButton.setText(`⭐ Pay ${usdToStarsClient(total)} Stars`);
    } else if (option.type === "paystack") {
      tg.MainButton.setText("Pay securely · Card");
    } else if (isUsdtPayment(option)) {
      tg.MainButton.setText("Confirm USDT payment");
    } else if (option.type === "crypto") {
      tg.MainButton.setText("Confirm BTC payment");
    } else {
      tg.MainButton.setText("Place order");
    }
    tg.MainButton.show();
    tg.MainButton.onClick(onTelegramMainButton);
    return;
  }

  tg.MainButton.hide();
}

function onTelegramMainButton() {
  const page = (location.hash || "#home").replace(/^#/, "").split("?")[0] || "home";
  haptic("medium");
  if (page === "products") {
    navigateToPage("payment");
    return;
  }
  if (page === "payment" || page === "checkout") {
    if (!state.cart.size) {
      navigateToPage("products");
      return;
    }
    const option = selectedPaymentOption();
    if (option.type === "stars") {
      startStarsPayment();
      return;
    }
    if (option.type === "paystack") {
      startPaystackPayment();
      return;
    }
    checkoutForm?.requestSubmit?.();
  }
}

function prefillCheckoutFromTelegram() {
  if (!checkoutForm || !isInsideTelegramMiniApp()) return;
  const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (!user) return;
  const nameEl = checkoutForm.elements.name;
  const tgEl = checkoutForm.elements.telegram;
  if (nameEl && !nameEl.value) {
    const full = [user.first_name, user.last_name].filter(Boolean).join(" ");
    if (full) nameEl.value = full;
  }
  if (tgEl && !tgEl.value && user.username) {
    tgEl.value = `@${user.username}`;
  }
}

async function loadStoreConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("Config unavailable");
    storeConfig = await response.json();
  } catch (error) {
    console.warn("Using fallback store config", error);
  }

  // Set default option value
  if (storeConfig.paymentOptions && storeConfig.paymentOptions.length > 0) {
    paymentMethodInput.value = storeConfig.paymentOptions[0].id;
  }

  renderPaymentMethodsGrid();
  wireTelegramHubLinks();

  if (window.initTelegramBot) {
    window.initTelegramBot(storeConfig);
  }

  updatePaymentHint();
}

function wireTelegramHubLinks() {
  const botUrl = storeConfig.telegramBotUrl || "https://t.me/DTDSTOREBOT";
  const channelUrl = storeConfig.telegramBotUrl || "https://t.me/DTDSTOREBOT";
  const ownerUrl = storeConfig.telegramOwnerUrl || "https://t.me/Glock7money";
  const ownerName = storeConfig.telegramOwnerUsername || "Glock7money";
  const vendorUrl = storeConfig.telegramVendorUrl || "https://t.me/Glock7money";
  const vendorName = storeConfig.telegramVendorUsername || "Glock7money";
  const companyUrl = storeConfig.companyUrl || "https://dvtechnologies.xyz";
  const supportEmail = storeConfig.supportEmail || "contact@dvtechnologies.xyz";
  const mailUrl = `mailto:${supportEmail}`;

  [
    ["#hubBotLink", botUrl],
    ["#hubChannelLink", channelUrl],
    ["#hubOwnerLink", ownerUrl],
    ["#hubVendorLink", vendorUrl],
    ["#hubCompanyLink", companyUrl],
    ["#hubEmailLink", mailUrl],
    ["#faqSupportEmail", mailUrl],
    ["#faqOwnerLink", ownerUrl],
    ["#faqVendorLink", vendorUrl],
    ["#trackOwnerLink", ownerUrl],
    ["#trackVendorLink", vendorUrl],
    ["#telegramFeedFallback", channelUrl]
  ].forEach(([sel, href]) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.href = href;
    if (sel === "#hubEmailLink" || sel === "#faqSupportEmail") {
      el.textContent = supportEmail;
    } else if (sel === "#hubOwnerLink") {
      el.textContent = `Message @${ownerName}`;
    } else if (sel === "#hubVendorLink") {
      el.textContent = `Message @${vendorName}`;
    } else if (sel === "#faqOwnerLink" || sel === "#trackOwnerLink") {
      el.textContent = `@${ownerName}`;
    } else if (sel === "#faqVendorLink" || sel === "#trackVendorLink") {
      el.textContent = `@${vendorName}`;
    }
  });
}

const PAGE_META = {
  home: { title: "Home", eyebrow: "DTD Store" },
  products: { title: "Products", eyebrow: "Shop" },
  dtdshopcc: { title: "DTDSHOP.CC", eyebrow: "Deposit first" },
  mmshop: { title: "DTDSHOP.CC", eyebrow: "Deposit first" },
  payment: { title: "Payment", eyebrow: "Secure pay" },
  checkout: { title: "Payment", eyebrow: "Secure pay" },
  track: { title: "Track order", eyebrow: "Orders" },
  trade: { title: "DTD Trade Platform", eyebrow: "Trading" },
  smtp: { title: "SMTP + SMS", eyebrow: "Tools" },
  chat: { title: "DTD Chat", eyebrow: "Connect" },
  profile: { title: "Profile", eyebrow: "Connect" },
  telegram: { title: "Telegram", eyebrow: "Connect" },
  faq: { title: "Help / FAQ", eyebrow: "Connect" }
};

function profileUsernameFromHash() {
  const raw = String(location.hash || "")
    .replace(/^#/, "")
    .split("?")[0]
    .trim();
  const m = raw.match(/^profile\/(@?[A-Za-z0-9_]{3,32})$/i);
  if (m) return m[1].replace(/^@/, "");
  try {
    const q = new URLSearchParams(String(location.hash || "").split("?")[1] || "");
    return String(q.get("u") || "").replace(/^@/, "");
  } catch {
    return "";
  }
}

function navigateToPage(pageId, { push = true, username = "" } = {}) {
  let id = pageId;
  let profileUser = username;
  if (String(pageId || "").startsWith("profile/")) {
    profileUser = String(pageId).slice("profile/".length).replace(/^@/, "");
    id = "profile";
  }
  if (id === "checkout") id = "payment";
  id = PAGE_META[id] ? id : "home";
  if (id === "profile" && !profileUser) profileUser = profileUsernameFromHash();

  const leavingPayment =
    document.querySelector('.page[data-page="payment"].is-active') && id !== "payment";
  if (leavingPayment) trackPaymentAbandon("navigate_away");

  document.querySelectorAll(".page[data-page]").forEach((page) => {
    const active = page.dataset.page === id;
    page.hidden = !active;
    page.classList.toggle("is-active", active);
  });

  document.querySelectorAll("[data-nav]").forEach((link) => {
    const nav = link.getAttribute("data-nav");
    const navNorm = nav === "checkout" ? "payment" : nav;
    link.classList.toggle("is-active", navNorm === id || (id === "profile" && nav === "chat"));
  });

  const meta = PAGE_META[id];
  const titleEl = document.querySelector("#shellPageTitle");
  const eyebrowEl = document.querySelector("#pageEyebrow");
  if (titleEl) titleEl.textContent = id === "profile" && profileUser ? `@${profileUser}` : meta.title;
  if (eyebrowEl) eyebrowEl.textContent = meta.eyebrow;

  if (push) {
    const nextHash =
      id === "profile" && profileUser ? `#profile/${encodeURIComponent(profileUser)}` : `#${id}`;
    if (location.hash !== nextHash) {
      history.pushState({ page: id, username: profileUser || undefined }, "", nextHash);
    }
  }

  setNavOpen(false);

  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  trackEvent("page_view", { page: id, title: meta.title, username: profileUser || undefined });

  if (id === "chat" && typeof window.bootDtdChat === "function") {
    window.bootDtdChat();
  }
  if (id === "profile" && typeof window.bootDtdProfile === "function") {
    window.bootDtdProfile(profileUser);
  }
  if (id === "payment") {
    prefillCheckoutFromTelegram();
    enterPaymentFunnel();
  }
  syncTelegramMainButton();
}

window.navigateToPage = navigateToPage;
window.profileUsernameFromHash = profileUsernameFromHash;

function currentPageFromHash() {
  const raw = String(location.hash || "#home").replace(/^#/, "").split("?")[0].trim();
  if (raw === "trade-bots" || raw === "trade-wallet" || raw.startsWith("trade-")) return "trade";
  if (raw === "profile" || raw.startsWith("profile/")) return "profile";
  if (raw === "checkout") return "payment";
  if (raw === "mmshop") return "dtdshopcc";
  return PAGE_META[raw] ? raw : "home";
}

function setNavOpen(open) {
  document.body.classList.toggle("nav-open", open);
  const backdrop = document.querySelector("#navBackdrop");
  const toggle = document.querySelector("#navToggle");
  const label = toggle?.querySelector(".nav-toggle-text");
  if (backdrop) backdrop.hidden = !open;
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }
  if (label) label.textContent = open ? "Close" : "Menu";
}

function bindShellNavigation() {
  document.querySelectorAll("[data-nav], a[href^='#']").forEach((el) => {
    el.addEventListener("click", (event) => {
      const href = el.getAttribute("href") || "";
      const nav = el.getAttribute("data-nav");
      const page = nav || href.replace(/^#/, "").split("?")[0];
      if (page === "profile" || page.startsWith("profile/")) {
        event.preventDefault();
        if (page === "profile") {
          let me = "";
          try {
            const raw = localStorage.getItem("dtd_chat_session_v1");
            me = raw ? JSON.parse(raw)?.user?.username || "" : "";
          } catch {
            me = "";
          }
          if (me) navigateToPage(`profile/${me}`);
          else navigateToPage("profile");
        } else {
          navigateToPage(page);
        }
        return;
      }
      if (!PAGE_META[page]) return;
      event.preventDefault();
      navigateToPage(page);
    });
  });

  window.addEventListener("hashchange", () => navigateToPage(currentPageFromHash(), { push: false }));
  window.addEventListener("popstate", () => navigateToPage(currentPageFromHash(), { push: false }));

  const toggle = document.querySelector("#navToggle");
  const backdrop = document.querySelector("#navBackdrop");
  if (toggle) {
    toggle.addEventListener("click", () => setNavOpen(!document.body.classList.contains("nav-open")));
  }
  if (backdrop) {
    backdrop.addEventListener("click", () => setNavOpen(false));
  }
  document.querySelectorAll("[data-nav-close]").forEach((btn) => {
    btn.addEventListener("click", () => setNavOpen(false));
  });

  navigateToPage(currentPageFromHash(), { push: false });
}

function formatChannelDate(value) {
  if (!value) return "Latest channel update";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Latest channel update"
    : `Posted ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}`;
}

async function loadTelegramFeed() {
  const feed = document.querySelector("#telegramFeed");
  const status = document.querySelector("#telegramFeedStatus");
  if (!feed || !status) return;

  const fallbackUrl = storeConfig.telegramBotUrl || "https://t.me/DTDSTOREBOT";
  const fallback = () => {
    status.textContent = "See store announcements, fresh drops, and delivery updates in the main channel.";
    feed.innerHTML = `<a class="secondary-button" href="${fallbackUrl}" target="_blank" rel="noopener noreferrer">Open @DTDSTOREBOT</a>`;
  };

  try {
    const response = await fetch("/api/telegram/feed", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Telegram feed unavailable");
    const payload = await response.json();
    if (!payload?.post?.url || !payload.post.text) throw new Error("No public post available");

    status.textContent = formatChannelDate(payload.post.date);
    feed.innerHTML = `
      <p class="telegram-feed-text">${escapeHtml(payload.post.text)}</p>
      <a class="text-link" href="${payload.post.url}" target="_blank" rel="noopener noreferrer">Read on Telegram <span aria-hidden="true">↗</span></a>
    `;
  } catch {
    fallback();
  } finally {
    feed.setAttribute("aria-busy", "false");
  }
}

async function fetchBtcUsdPrice() {
  try {
    const response = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
    if (!response.ok) return;
    const payload = await response.json();
    const price = Number(payload?.data?.amount);
    if (price > 0) state.btcUsdPrice = price;
  } catch {
    /* keep fallback */
  }
}

async function loadProducts() {
  productsGrid.innerHTML = `<div class="empty-cart wide-empty shimmer">Loading products...</div>`;

  const { data, error } = await supabaseClient
    .from("products")
    .select("id,name,description,price_usd,color,image_url,active")
    .eq("active", true)
    .order("price_usd", { ascending: true });

  if (error) {
    console.error(error);
    state.products = fallbackProducts;
    showToast("Using sample products. Check Supabase setup.");
  } else {
    state.products = data.filter(isAllowedProduct);
    if (!state.products.length) {
      state.products = fallbackProducts;
    }
  }

  renderProducts();
  renderCart();
  updateLiveStats();
}

function applyPaymentDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const productId = String(params.get("product") || "").trim();
  const requestedMethod = String(params.get("method") || "").trim().toLowerCase();

  if (productId) {
    const product = state.products.find((item) => String(item.id) === productId);
    if (product && !state.cart.has(product.id)) {
      state.cart.set(product.id, 1);
      persistCart();
      renderCart();
      trackEvent("add_to_cart", {
        productId: product.id,
        name: product.name,
        price_usd: productPrice(product),
        source: "payment_deep_link"
      });
    }
  }

  const option =
    requestedMethod === "usdt"
      ? storeConfig.paymentOptions.find((item) => item.id === "USDT")
      : requestedMethod === "bitcoin" || requestedMethod === "btc"
        ? storeConfig.paymentOptions.find((item) => item.id === "Bitcoin")
        : storeConfig.paymentOptions.find((item) => item.id === "Paystack");

  if (option && paymentMethodInput) {
    paymentMethodInput.value = option.id;
    renderPaymentMethodsGrid();
    updatePaymentHint();
  }

  if (productId || location.hash === "#payment") {
    navigateToPage("payment", { push: false });
  }
}

function updateLiveStats() {
  if (!liveStats) return;
  const totalProducts = state.products.length;
  const prices = state.products.map(productPrice);
  const fromPrice = prices.length ? Math.min(...prices) : 0;
  liveStats.innerHTML = `
    <span class="live-pill live-pill--hot">
      <span class="pulse-dot pulse-dot--live" aria-hidden="true"></span>
      ${totalProducts} live products
    </span>
    <span class="live-pill">From ${formatMoney(fromPrice)}</span>
    <span class="live-pill">USDT · BTC · Paystack</span>
  `;
}

function renderProducts(items = state.products, { emptyMessage } = {}) {
  const count = items.length;
  if (productCount) {
    productCount.textContent = count === 1 ? "Showing 1 product" : `Showing ${count} products`;
  }
  if (!productsGrid) return;
  if (!count) {
    productsGrid.innerHTML = `<div class="empty-cart wide-empty">${emptyMessage || "No products are available yet."}</div>`;
    return;
  }

  productsGrid.innerHTML = items
    .map((product, index) => {
      const name = escapeHtml(product.name || "Product");
      const description = escapeHtml(product.description || "");
      const color = escapeHtml(product.color || "#0f766e");
      const image = product.image_url
        ? `<img src="${escapeHtml(product.image_url)}" alt="${name}" loading="lazy" />`
        : `<img src="assets/store-feature-shop.png" alt="${name}" loading="lazy" />`;
      return `
        <article class="product-card reveal" style="--delay:${index * 70}ms">
          <div class="product-image" style="background:${color}">
            ${image}
          </div>
          <h3>${name}</h3>
          <p>${description}</p>
          <div class="product-meta">
            <span class="price">${formatMoney(productPrice(product))}</span>
            <div class="product-actions">
              <button class="secondary-button" type="button" data-add="${escapeHtml(product.id)}">
                Add to cart
              </button>
              <button class="primary-button" type="button" data-buy="${escapeHtml(product.id)}">
                Buy now
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  requestAnimationFrame(() => {
    document.querySelectorAll(".product-card.reveal").forEach((card) => card.classList.add("visible"));
  });
}

function cartEntries() {
  return [...state.cart.entries()]
    .map(([id, quantity]) => ({
      ...state.products.find((product) => product.id === id),
      quantity
    }))
    .filter((product) => product.id);
}

function renderCart() {
  const entries = cartEntries();
  const totalItems = entries.reduce((sum, product) => sum + product.quantity, 0);
  const totalPrice = currentTotal();

  cartCount.textContent = totalItems;
  cartTotal.textContent = formatMoney(totalPrice);
  document.querySelector(".cart-toggle")?.classList.toggle("has-items", totalItems > 0);
  persistCart();

  if (!entries.length) {
    cartItems.innerHTML = `
      <div class="empty-cart">
        Your cart is empty.
        <div class="checkout-empty-actions">
          <button type="button" class="primary-button" data-go-products>Browse products</button>
        </div>
      </div>
    `;
    updatePaymentHint();
    syncTelegramMainButton();
    return;
  }

  cartItems.innerHTML = entries
    .map(
      (product) => `
        <div class="cart-item">
          <div>
            <strong>${escapeHtml(product.name)}</strong>
            <span>${formatMoney(productPrice(product))} each</span>
          </div>
          <div class="quantity-controls" aria-label="${escapeHtml(product.name)} quantity controls">
            <button type="button" data-decrease="${escapeHtml(product.id)}" aria-label="Decrease ${escapeHtml(product.name)}">-</button>
            <span>${product.quantity}</span>
            <button type="button" data-increase="${escapeHtml(product.id)}" aria-label="Increase ${escapeHtml(product.name)}">+</button>
          </div>
        </div>
      `
    )
    .join("");

  updatePaymentHint();
  syncTelegramMainButton();
}

function addToCart(productId, { goCheckout = false } = {}) {
  state.cart.set(productId, (state.cart.get(productId) || 0) + 1);
  renderCart();
  const product = state.products.find((p) => p.id === productId);
  trackEvent("add_to_cart", {
    productId,
    name: product?.name || productId,
    price_usd: product ? productPrice(product) : 0
  });
  if (goCheckout) {
    showToast("Added — opening secure Payment");
    navigateToPage("payment");
    return;
  }
  showToast("Added to cart — open Payment when ready");
}

function changeQuantity(productId, amount) {
  const nextQuantity = (state.cart.get(productId) || 0) + amount;

  if (nextQuantity <= 0) {
    state.cart.delete(productId);
  } else {
    state.cart.set(productId, nextQuantity);
  }

  renderCart();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast("Copy failed. Select the text manually.");
  }
}

async function saveOrder(formData) {
  const entries = cartEntries();
  const total = currentTotal();
  const paymentMethod = formData.get("payment") || "USDT";
  const meta = window.getVisitorMeta ? window.getVisitorMeta() : {};

  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: formData.get("name"),
      customerEmail: formData.get("email"),
      telegramUsername: formData.get("telegram") || null,
      paymentMethod,
      paymentReference: formData.get("paymentReference") || null,
      productAccount: formData.get("productAccount") || null,
      deliveryDetails: formData.get("orderNote") || null,
      totalUsd: total,
      visitorIp: meta.ip || "",
      userAgent: meta.userAgent || navigator.userAgent,
      pageUrl: meta.pageUrl || window.location.href,
      items: entries.map((product) => ({
        product_id: product.id,
        product_name: product.name,
        quantity: product.quantity,
        unit_price_usd: productPrice(product)
      }))
    })
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Order not saved");

  return payload.orderId;
}

function updateTelegramPaymentPanel() {
  const botUrl = storeConfig.telegramBotUrl || "";
  const username = storeConfig.telegramBotUsername || "";

  if (botUrl && telegramPaymentLink) {
    telegramPaymentLink.href = botUrl;
    telegramPaymentLink.hidden = false;
    telegramPaymentLink.textContent = username ? `Message @${username.replace(/^@/, "")}` : "Contact on Telegram";
  } else if (telegramPaymentLink) {
    telegramPaymentLink.hidden = true;
  }

  if (telegramPaymentNote) {
    if (storeConfig.telegramEnabled && username) {
      telegramPaymentNote.textContent =
        "Payment questions? Message us on Telegram. Add your @username above for delivery updates.";
    } else if (storeConfig.telegramEnabled) {
      telegramPaymentNote.textContent = "Add your Telegram username above for order updates.";
    } else {
      telegramPaymentNote.textContent = "Telegram support is being configured. Use email for updates.";
    }
  }
}

function updatePaymentHint() {
  const option = selectedPaymentOption();
  const isCrypto = option.type === "crypto";
  const isPaystack = option.type === "paystack";
  const isStars = option.type === "stars" || option.id === "Stars";
  const isTelegram = option.type === "telegram" || option.id === "Telegram";
  const usdt = isUsdtPayment(option);
  const address = activeCryptoAddress(option);
  const total = currentTotal();

  if (cryptoPanel) cryptoPanel.hidden = !isCrypto;
  if (paystackPanel) paystackPanel.hidden = !isPaystack;
  if (starsPaymentPanel) starsPaymentPanel.hidden = !isStars;
  if (telegramPaymentPanel) telegramPaymentPanel.hidden = !isTelegram;

  const submitBtn = document.querySelector("#submitButton");

  if (paystackButton) paystackButton.style.display = isPaystack ? "flex" : "none";
  if (dtdPaymentPageButton) dtdPaymentPageButton.style.display = isPaystack ? "flex" : "none";
  if (starsPayButton) starsPayButton.style.display = isStars ? "flex" : "none";

  if (isStars) {
    const stars = usdToStarsClient(total);
    if (starsAmountHint) {
      starsAmountHint.textContent =
        total > 0
          ? `Pay about ${stars} Stars for ${formatMoney(total)} (rate ~${storeConfig.starsPerUsd || 75} ★ / $1).`
          : "Add items to see Stars amount.";
    }
    if (starsPayButton) {
      starsPayButton.textContent = total > 0 ? `⭐ Pay ${stars} Stars` : "⭐ Pay with Telegram Stars";
    }
    if (submitBtn) submitBtn.style.display = "none";
  } else if (isPaystack) {
    if (paystackButton) {
      paystackButton.innerHTML = `<span class="pay-cta-lock" aria-hidden="true">🔒</span> Continue to secure Card / Bank payment`;
    }
    if (submitBtn) submitBtn.style.display = "none";
  } else {
    if (submitBtn) {
      submitBtn.style.display = "block";
      if (usdt) submitBtn.textContent = "Confirm USDT Payment";
      else if (isCrypto) submitBtn.textContent = "Confirm BTC Payment";
      else submitBtn.textContent = "Complete & Place Order";
    }
  }

  syncTelegramMainButton();

  if (isCrypto) {
    if (cryptoPanel) {
      cryptoPanel.classList.toggle("is-usdt", usdt);
      cryptoPanel.classList.toggle("is-btc", !usdt);
    }

    if (cryptoAssetBadge) {
      cryptoAssetBadge.textContent = usdt ? "USDT" : "BTC";
      cryptoAssetBadge.classList.toggle("usdt", usdt);
      cryptoAssetBadge.classList.toggle("btc", !usdt);
    }
    if (cryptoAssetTitle) {
      cryptoAssetTitle.textContent = usdt ? "USDT · Tron (TRC20)" : "Bitcoin · BTC network";
    }
    if (cryptoNetworkHint) {
      cryptoNetworkHint.textContent = usdt
        ? "Send only USDT on the Tron TRC20 network to this address."
        : "Send only Bitcoin (BTC) to this address — no other coins or networks.";
    }
    if (cryptoHowSteps) {
      cryptoHowSteps.innerHTML = usdt
        ? `
          <li>Scan the QR or copy the wallet address</li>
          <li>Send the exact amount on <strong>Tron (TRC20)</strong> only</li>
          <li>Paste your transaction hash below to place the order</li>
        `
        : `
          <li>Scan the QR or copy the BTC wallet address</li>
          <li>Send the exact BTC amount shown above</li>
          <li>Paste your Bitcoin txid below to place the order</li>
        `;
    }
    if (cryptoNetworkLabel) {
      cryptoNetworkLabel.textContent = usdt ? "Tron (TRC20)" : "Bitcoin (BTC)";
    }
    if (cryptoWarning) {
      cryptoWarning.textContent = usdt
        ? "Don’t send NFTs to this address. Only USDT on Tron (TRC20) — other networks will lose funds."
        : "Send BTC only. Wrong asset or network cannot be recovered.";
    }
    if (paymentReferenceInput) {
      paymentReferenceInput.placeholder = usdt
        ? "Paste TRC20 transaction hash"
        : "Paste BTC txid";
    }

    cryptoAddress.textContent =
      address || (usdt ? "USDT TRC20 address not configured" : "BTC address not configured");
    if (copyCryptoAddressButton) {
      copyCryptoAddressButton.disabled = !address;
    }

    if (usdt) {
      if (btcAmountLabel) {
        btcAmountLabel.textContent =
          total > 0 ? `${total.toFixed(2)} USDT (= $${total.toFixed(2)} USD)` : "Add items to see amount";
      }
      renderCryptoQr(address, { asset: "USDT" });
    } else {
      const rate = state.btcUsdPrice > 0 ? state.btcUsdPrice : 65000;
      const btcEstimate = total > 0 ? (total / rate).toFixed(8) : "";
      if (btcAmountLabel) {
        btcAmountLabel.textContent =
          total > 0
            ? `$${total.toFixed(2)} USD (~${btcEstimate} BTC @ $${Math.round(rate).toLocaleString()})`
            : "Add items to see amount";
      }
      renderCryptoQr(address, { asset: "BTC", btcAmount: btcEstimate });
    }
  }

  updateTelegramPaymentPanel();
}

async function startStarsPayment() {
  if (!state.cart.size) {
    showToast("Add at least one product before payment.");
    return;
  }
  const name = checkoutForm.elements.name.value.trim();
  const email = checkoutForm.elements.email.value.trim();
  if (!name || !email) {
    showToast("Enter your name and email before Stars checkout.");
    haptic("error");
    return;
  }
  if (!isInsideTelegramMiniApp() || !window.Telegram?.WebApp?.openInvoice) {
    showToast("Open the Mini App from @DTDSTOREBOT to pay with Stars.");
    const bot = storeConfig.telegramBotUrl || "https://t.me/DTDSTOREBOT";
    window.open(`${bot}?start=buy`, "_blank", "noopener,noreferrer");
    return;
  }

  const totalUsd = currentTotal();
  paymentMethodInput.value = "Stars";
  if (starsPayButton) {
    starsPayButton.disabled = true;
    starsPayButton.textContent = "Creating Stars invoice…";
  }
  try {
    const tgUser = window.Telegram.WebApp.initDataUnsafe?.user;
    const response = await fetch("/api/stars/invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        telegram: checkoutForm.elements.telegram?.value || (tgUser?.username ? `@${tgUser.username}` : ""),
        telegramUserId: tgUser?.id || null,
        totalUsd,
        items: cartEntries().map((product) => ({
          product_id: product.id,
          product_name: product.name,
          quantity: product.quantity,
          unit_price_usd: productPrice(product)
        }))
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok || !payload.invoice_url) {
      throw new Error(payload.error || "Could not create Stars invoice.");
    }

    window.Telegram.WebApp.openInvoice(payload.invoice_url, async (status) => {
      if (status === "paid") {
        haptic("success");
        showToast("Stars paid — confirming with bot…");
        // Webhook creates the order; poll so we don't double-insert.
        let orderId = payload.id;
        for (let i = 0; i < 8; i += 1) {
          await new Promise((r) => setTimeout(r, 700));
          try {
            const check = await fetch(`/api/stars/invoice?id=${encodeURIComponent(payload.id)}`);
            const row = await check.json();
            if (row.ok && row.orderId) {
              orderId = row.orderId;
              break;
            }
          } catch {
            /* retry */
          }
        }
        showCheckoutSuccess(orderId, email);
        showToast("Stars payment confirmed. Check @DTDSTOREBOT for delivery email prompt.");
      } else if (status === "cancelled") {
        showToast("Stars payment cancelled.");
      } else if (status === "failed") {
        haptic("error");
        showToast("Stars payment failed. Try again or use USDT.");
      }
    });
  } catch (error) {
    haptic("error");
    showToast(error.message || "Stars checkout failed.");
  } finally {
    if (starsPayButton) {
      starsPayButton.disabled = false;
      starsPayButton.textContent = `⭐ Pay ${usdToStarsClient(currentTotal())} Stars`;
    }
  }
}

function buildBip21Uri(address, btcAmount) {
  if (!address) return "";
  const base = `bitcoin:${address}`;
  return btcAmount && Number(btcAmount) > 0 ? `${base}?amount=${btcAmount}` : base;
}

function renderCryptoQr(address, { asset = "USDT", btcAmount = "" } = {}) {
  if (!btcQrCode) return;
  if (!address) {
    btcQrCode.removeAttribute("src");
    btcQrCode.alt = asset === "USDT" ? "USDT address not configured" : "BTC address not configured";
    return;
  }

  const payload = asset === "BTC" ? buildBip21Uri(address, btcAmount) : address;
  const fallback = asset === "BTC" ? `bitcoin:${address}` : address;
  const primary = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=1&ecc=M&data=${encodeURIComponent(
    payload
  )}`;
  const addressOnly = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=1&data=${encodeURIComponent(
    fallback
  )}`;

  btcQrCode.alt = asset === "USDT" ? `USDT TRC20 payment QR for ${address}` : `Bitcoin payment QR for ${address}`;
  btcQrCode.dataset.payload = payload;
  btcQrCode.onerror = () => {
    btcQrCode.onerror = null;
    btcQrCode.src = addressOnly;
  };
  btcQrCode.src = primary;
}

async function submitOrderDirectly(paymentReference) {
  if (!state.cart.size) {
    showToast("Add at least one product before payment.");
    return;
  }

  const name = checkoutForm.elements.name.value.trim();
  const email = checkoutForm.elements.email.value.trim();
  if (!name || !email) {
    showToast("Please enter your name and email to save your order.");
    return;
  }

  const submitBtn = document.querySelector("#submitButton");
  if (paystackButton) {
    paystackButton.disabled = true;
    paystackButton.textContent = "Processing Order...";
  }
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Processing Order...";
  }

  try {
    const formData = new FormData(checkoutForm);
    if (paymentReference) {
      formData.set("paymentReference", paymentReference);
    }
    const orderId = await saveOrder(formData);
    showCheckoutSuccess(orderId, email);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Failed to submit order. Please contact support.");
  } finally {
    if (paystackButton) {
      paystackButton.disabled = false;
      paystackButton.innerHTML = `<span class="apple-icon"></span> Pay with Card / Bank`;
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Complete & Place Order";
    }
  }
}

function showCheckoutSuccess(orderId, email) {
  checkoutForm.style.display = "none";
  const cartSummary = document.querySelector(".checkout-summary");
  if (cartSummary) cartSummary.style.display = "none";

  if (checkoutSuccess) {
    checkoutSuccess.style.display = "flex";
  }

  if (successOrderId) {
    successOrderId.textContent = `#${orderId}`;
  }

  if (successUserContact) {
    const telegram = checkoutForm.elements.telegram?.value.trim();
    successUserContact.textContent = telegram ? `${email} & ${telegram}` : email;
  }

  const entries = cartEntries();
  const total = currentTotal();
  trackEvent("purchase", {
    orderId: String(orderId || ""),
    total_usd: total,
    items: entries.reduce((sum, p) => sum + p.quantity, 0),
    method: paymentMethodInput?.value || ""
  });
  markPaymentCompleted();
  if (window.notifyBotOrderSuccess) {
    window.notifyBotOrderSuccess(
      orderId,
      email,
      total,
      entries.map((p) => ({ product_name: p.name, quantity: p.quantity }))
    );
  } else if (window.addBotMessage) {
    window.addBotMessage(
      `Your order #${orderId} has been placed! Our team has been notified and will verify the transaction.`
    );
  }

  const boughtSmtp = entries.some((p) => String(p.name || "").trim().toLowerCase() === "smtp");
  if (boughtSmtp && checkoutSuccess) {
    let link = checkoutSuccess.querySelector("#smtpUnlockDeepLink");
    if (!link) {
      link = document.createElement("a");
      link.id = "smtpUnlockDeepLink";
      link.className = "primary-button";
      link.style.marginTop = "12px";
      checkoutSuccess.appendChild(link);
    }
    link.href = `#smtp`;
    link.textContent = "Open SMTP console";
    link.onclick = (event) => {
      event.preventDefault();
      const unlock = document.querySelector("#smtpUnlockForm");
      if (unlock) {
        if (unlock.orderId) unlock.orderId.value = orderId;
        if (unlock.email) unlock.email.value = email;
      }
      navigateToPage("smtp");
    };
  }

  state.cart.clear();
  renderCart();
  showToast("Order placed successfully!");
}

async function verifyPaystackReference(reference) {
  const response = await fetch("/api/paystack/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference })
  });
  const payload = await response.json();
  if (!response.ok || !payload.paid) {
    throw new Error(payload.error || "Payment not confirmed yet.");
  }
  return payload;
}

async function startPaystackPayment() {
  if (!state.cart.size) {
    showToast("Add at least one product before payment.");
    return;
  }

  const email = checkoutForm.elements.email.value.trim();
  const name = checkoutForm.elements.name.value.trim();

  if (!email || !name) {
    showToast("Enter your name and email before Paystack checkout.");
    return;
  }

  const totalUsd = currentTotal();
  paymentMethodInput.value = "Paystack";
  trackEvent("begin_checkout", { method: "Paystack", total_usd: totalUsd, page: "payment" });

  if (paystackButton) {
    paystackButton.disabled = true;
    paystackButton.textContent = "Starting Paystack...";
  }

  try {
    const initResponse = await fetch("/api/paystack/initialize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        name,
        amountUsd: totalUsd,
        cartItems: cartEntries().map((product) => `${product.name} x${product.quantity}`).join(", ")
      })
    });
    const initPayload = await initResponse.json();

    if (!initResponse.ok || !initPayload.ok || !initPayload.authorization_url) {
      throw new Error(initPayload.error || "Could not start Paystack payment.");
    }

    // Hosted checkout — uses only channels enabled on the merchant (avoids "No active channel")
    sessionStorage.setItem(
      "dtd_pending_paystack",
      JSON.stringify({
        reference: initPayload.reference,
        email,
        name,
        telegram: checkoutForm.elements.telegram?.value || "",
        productAccount: checkoutForm.elements.productAccount?.value || "",
        orderNote: checkoutForm.elements.orderNote?.value || "",
        totalUsd,
        items: cartEntries().map((product) => ({
          product_id: product.id,
          product_name: product.name,
          quantity: product.quantity,
          unit_price_usd: productPrice(product)
        }))
      })
    );
    window.location.href = initPayload.authorization_url;
  } catch (error) {
    showToast(error.message || "Paystack failed to open.");
    if (paystackButton) {
      paystackButton.disabled = false;
      paystackButton.textContent = "Continue to secure Card / Bank payment";
    }
  }
}

async function resumePaystackReturn() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get("reference") || params.get("trxref");
  if (!reference) return;

  navigateToPage("payment", { push: false });
  const pendingRaw = sessionStorage.getItem("dtd_pending_paystack");

  try {
    await verifyPaystackReference(reference);

    let pending = null;
    if (pendingRaw) {
      try {
        pending = JSON.parse(pendingRaw);
      } catch (_) {}
    }

    if (pending?.name && checkoutForm.elements.name) checkoutForm.elements.name.value = pending.name;
    if (pending?.email && checkoutForm.elements.email) checkoutForm.elements.email.value = pending.email;
    if (pending?.telegram && checkoutForm.elements.telegram) checkoutForm.elements.telegram.value = pending.telegram;
    if (pending?.productAccount && checkoutForm.elements.productAccount) {
      checkoutForm.elements.productAccount.value = pending.productAccount;
    }
    if (pending?.orderNote && checkoutForm.elements.orderNote) {
      checkoutForm.elements.orderNote.value = pending.orderNote;
    }

    paymentMethodInput.value = "Paystack";

    if (pending?.items?.length && !state.cart.size) {
      for (const item of pending.items) {
        const id = String(item.product_id || "");
        if (!id) continue;
        state.cart.set(id, Number(item.quantity) || 1);
      }
      renderCart();
    }

    await submitOrderDirectly(reference);
    sessionStorage.removeItem("dtd_pending_paystack");
    showToast("Payment confirmed.");
  } catch (error) {
    showToast(error.message || "Payment not confirmed yet.");
  } finally {
    window.history.replaceState({}, "", `${window.location.pathname}#payment`);
  }
}

// Paystack verification handled server side or directly via submitOrderDirectly callback.

productsGrid.addEventListener("click", (event) => {
  const buyButton = event.target.closest("[data-buy]");
  if (buyButton) {
    addToCart(buyButton.dataset.buy, { goCheckout: true });
    return;
  }
  const button = event.target.closest("[data-add]");
  if (!button) return;
  addToCart(button.dataset.add);
});

cartItems.addEventListener("click", (event) => {
  if (event.target.closest("[data-go-products]")) {
    navigateToPage("products");
    return;
  }
  const decreaseButton = event.target.closest("[data-decrease]");
  const increaseButton = event.target.closest("[data-increase]");

  if (decreaseButton) changeQuantity(decreaseButton.dataset.decrease, -1);
  if (increaseButton) changeQuantity(increaseButton.dataset.increase, 1);
});

document.querySelector(".cart-toggle").addEventListener("click", () => {
  navigateToPage("payment");
});

productSearch.addEventListener("input", (event) => {
  const searchTerm = event.target.value.trim().toLowerCase();
  const filteredProducts = state.products.filter((product) =>
    `${product.name} ${product.description}`.toLowerCase().includes(searchTerm)
  );
  renderProducts(filteredProducts, {
    emptyMessage: searchTerm
      ? `No matches for “${event.target.value.trim()}”. Clear search to see all products.`
      : undefined
  });
});

refreshProductsButton.addEventListener("click", loadProducts);

if (copyStoreLinkButton) {
  copyStoreLinkButton.addEventListener("click", () => {
    copyText(storeConfig.storeUrl || window.location.origin || "https://dtdpaymentsbot.pages.dev", "Store link copied");
  });
}

copyCryptoAddressButton.addEventListener("click", () => {
  const option = selectedPaymentOption();
  const address = activeCryptoAddress(option);
  if (!address) {
    showToast(
      isUsdtPayment(option)
        ? "Add USDT_TRC20_ADDRESS to your .env file."
        : "Add BTC_ADDRESS to your .env file."
    );
    return;
  }
  copyText(address, isUsdtPayment(option) ? "USDT TRC20 address copied" : "BTC address copied");
});

paystackButton?.addEventListener("click", startPaystackPayment);
dtdPaymentPageButton?.addEventListener("click", () => {
  const checkout = {
    name: checkoutForm?.elements?.name?.value?.trim() || "",
    email: checkoutForm?.elements?.email?.value?.trim() || "",
    telegram: checkoutForm?.elements?.telegram?.value?.trim() || "",
    note: checkoutForm?.elements?.orderNote?.value?.trim() || "",
    totalUsd: currentTotal(),
    items: cartEntries().map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description || "",
      quantity: product.quantity,
      priceUsd: productPrice(product)
    }))
  };
  sessionStorage.setItem("dtd_custom_checkout", JSON.stringify(checkout));
  trackEvent("begin_checkout", {
    method: "DTD Payment Page",
    total_usd: checkout.totalUsd,
    items: checkout.items.length
  });
  window.location.href = "/dtd-payment.html";
});
switchToCardPaymentButton?.addEventListener("click", () => {
  paymentMethodInput.value = "Paystack";
  paymentFunnel.lastMethod = "Paystack";
  renderPaymentMethodsGrid();
  updatePaymentHint();
  switchToCardPaymentButton.closest(".sheet-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  trackEvent("select_payment", { method: "Paystack", source: "crypto_trust_switch" });
});
starsPayButton?.addEventListener("click", () => {
  haptic("medium");
  startStarsPayment();
});

paymentMethodInput.addEventListener("change", () => {
  updatePaymentHint();
  trackEvent("select_payment", { method: paymentMethodInput.value });
});

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  trackEvent("begin_checkout", {
    method: paymentMethodInput?.value || "USDT",
    total_usd: currentTotal()
  });
  submitOrderDirectly();
});

if (successCloseButton) {
  successCloseButton.addEventListener("click", () => {
    checkoutForm.reset();
    checkoutForm.style.display = "grid";
    const cartSummary = document.querySelector(".checkout-summary");
    if (cartSummary) cartSummary.style.display = "block";
    if (checkoutSuccess) checkoutSuccess.style.display = "none";
    updatePaymentHint();
    navigateToPage("products");
  });
}

const MMSHOP_STORAGE_KEY = "dtd_mmshop_deposit_verified_v1";

function getMmshopDepositState() {
  try {
    return localStorage.getItem(MMSHOP_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function setMmshopDepositState(value) {
  try {
    localStorage.setItem(MMSHOP_STORAGE_KEY, String(Boolean(value)));
  } catch {
    /* ignored */
  }
}

function renderMmshopWalletAddresses() {
  const usdtAddressEl = document.querySelector("#mmshopUsdtAddress");
  const btcAddressEl = document.querySelector("#mmshopBtcAddress");
  if (!usdtAddressEl || !btcAddressEl) return;

  const usdtAddress = (storeConfig.usdtTrc20Address || "TQaxQxtzQhLZQ5P6d8nN2nx7mZ9J3mwLHZ").trim();
  const btcAddress = (storeConfig.btcAddress || "bc1qexampleplaceholderaddress0000000000000000").trim();

  usdtAddressEl.textContent = usdtAddress || "USDT TRC20 address not configured";
  btcAddressEl.textContent = btcAddress || "BTC address not configured";
}

function getMmshopCatalogRows() {
  try {
    const raw = localStorage.getItem("dtd_mmshop_catalog_v1");
    if (!raw) {
      return [
        { id: "default-1", cc: "1", name: "", details: "", product: "" },
        { id: "default-2", cc: "2", name: "", details: "", product: "" },
        { id: "default-3", cc: "3", name: "", details: "", product: "" },
        { id: "default-4", cc: "4", name: "", details: "", product: "" }
      ];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) {
      return [
        { id: "default-1", cc: "1", name: "", details: "", product: "" },
        { id: "default-2", cc: "2", name: "", details: "", product: "" },
        { id: "default-3", cc: "3", name: "", details: "", product: "" },
        { id: "default-4", cc: "4", name: "", details: "", product: "" }
      ];
    }
    return parsed;
  } catch {
    return [
      { id: "default-1", cc: "1", name: "", details: "", product: "" },
      { id: "default-2", cc: "2", name: "", details: "", product: "" },
      { id: "default-3", cc: "3", name: "", details: "", product: "" },
      { id: "default-4", cc: "4", name: "", details: "", product: "" }
    ];
  }
}

function renderMmshopProducts() {
  const grid = document.querySelector("#mmshopProductsGrid");
  const list = document.querySelector("#mmshopProductsList");
  if (!grid || !list) return;

  const rows = getMmshopCatalogRows();
  const verified = getMmshopDepositState();
  const blurClass = verified ? "" : "mmshop-table--locked";

  grid.innerHTML = `
    <div class="mmshop-table-wrap ${blurClass}">
      <table class="mmshop-table">
        <thead>
          <tr>
            <th>CC</th>
            <th>NAME</th>
            <th>DETAILS</th>
            <th>PRODUCT</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(String(row.cc || ""))}</td>
              <td>${escapeHtml(String(row.name || ""))}</td>
              <td>${escapeHtml(String(row.details || ""))}</td>
              <td>${escapeHtml(String(row.product || ""))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${verified ? "" : `
        <div class="mmshop-lock-overlay" aria-hidden="true">
          <button type="button" class="primary-button" data-mmshop-unlock>Deposit First</button>
        </div>
      `}
    </div>
  `;

  const unlockButton = document.querySelector("[data-mmshop-unlock]");
  unlockButton?.addEventListener("click", () => {
    document.querySelector("#mmshopGate")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelector("#mmshopVerifyDeposit")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function updateMmshopGateState() {
  const gate = document.querySelector("#mmshopGate");
  const list = document.querySelector("#mmshopProductsList");
  const verified = getMmshopDepositState();

  if (!gate || !list) return;

  gate.hidden = verified;
  list.hidden = false;
  list.classList.toggle("is-locked", !verified);

  renderMmshopProducts();
}

async function verifyMmshopDeposit() {
  const verified = getMmshopDepositState();
  if (verified) {
    updateMmshopGateState();
    showToast("DTDSHOP.CC is already unlocked.");
    return;
  }

  setMmshopDepositState(true);
  updateMmshopGateState();
  showToast("Deposit confirmed — DTDSHOP.CC catalog unlocked.");
}

function initMmshopPage() {
  renderMmshopWalletAddresses();
  updateMmshopGateState();

  document.querySelector("#mmshopVerifyDeposit")?.addEventListener("click", verifyMmshopDeposit);

  document.querySelector('[data-copy-mmshop-usdt]')?.addEventListener("click", () => {
    const value = (storeConfig.usdtTrc20Address || "TQaxQxtzQhLZQ5P6d8nN2nx7mZ9J3mwLHZ").trim();
    copyText(value, "USDT TRC20 address copied");
  });

  document.querySelector('[data-copy-mmshop-btc]')?.addEventListener("click", () => {
    const value = (storeConfig.btcAddress || "bc1qexampleplaceholderaddress0000000000000000").trim();
    copyText(value, "BTC address copied");
  });

  document.querySelector("#mmshopProductsGrid")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mmshop-product]");
    if (!button) return;
    showToast("Product details can be added later. The catalog is ready for your items.");
  });
}

function initHeroMotion() {
  const chatRows = document.querySelectorAll(".chat-row");
  chatRows.forEach((row, index) => {
    row.style.animationDelay = `${index * 0.45}s`;
  });
}

async function boot() {
  restoreCart();
  bindShellNavigation();
  initTelegramMiniApp();
  initHeroMotion();
  trackEvent("page_view", { title: document.title });
  await Promise.all([loadStoreConfig(), fetchBtcUsdPrice()]);
  const yearEl = document.querySelector("#footerYear");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
  await Promise.all([loadProducts(), loadTelegramFeed()]);
  initMmshopPage();
  applyPaymentDeepLink();
  renderCart();
  await resumePaystackReturn();
  bindTrackOrderForm();
}

function isInsideTelegramMiniApp() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return false;

  const params = new URLSearchParams(window.location.search);
  // Mini App deep links always include one of these.
  if (params.get("utm_source") === "telegram_miniapp") return true;
  if (params.has("tgWebAppStartParam") || params.has("tgWebAppData") || params.has("tgWebAppVersion")) {
    return true;
  }

  // Real Mini App sessions have initData; plain browsers loading telegram-web-app.js do not.
  if (String(tg.initData || "").trim()) return true;
  if (tg.initDataUnsafe && Object.keys(tg.initDataUnsafe).length > 0) return true;

  const platform = String(tg.platform || "").toLowerCase();
  return Boolean(platform && platform !== "unknown");
}

function initTelegramMiniApp() {
  const tg = window.Telegram?.WebApp;
  document.documentElement.classList.add("tg-premium-skin");
  document.body?.classList.add("tg-premium-skin");

  if (!isInsideTelegramMiniApp()) {
    document.documentElement.classList.remove("tg-mini-app");
    document.body?.classList.remove("tg-mini-app");
    return;
  }

  try {
    tg.ready?.();
    tg.expand?.();
    document.documentElement.classList.add("tg-mini-app");
    document.body?.classList.add("tg-mini-app");
    document.documentElement.style.setProperty("--app-height", `${window.innerHeight}px`);

    const user = tg.initDataUnsafe?.user;
    if (user?.is_premium) {
      document.documentElement.classList.add("tg-premium");
      document.body?.classList.add("tg-premium");
      window.__dtdTelegramPremium = true;
      window.__dtdTelegramUser = {
        id: user.id,
        username: user.username || "",
        isPremium: true
      };
    } else {
      document.documentElement.classList.remove("tg-premium");
      document.body?.classList.remove("tg-premium");
      window.__dtdTelegramPremium = false;
      window.__dtdTelegramUser = user
        ? { id: user.id, username: user.username || "", isPremium: false }
        : null;
    }

    // Keep layout phone-first even if WebView reports a wide CSS viewport.
    const vp = document.querySelector('meta[name="viewport"]');
    if (vp) {
      vp.setAttribute(
        "content",
        "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"
      );
    }

    if (tg.colorScheme === "dark" || tg.colorScheme === "light") {
      document.documentElement.setAttribute("data-theme", tg.colorScheme);
    }
    if (tg.themeParams?.bg_color) {
      document.documentElement.style.setProperty("--tg-bg", tg.themeParams.bg_color);
    }
    if (tg.setHeaderColor && tg.themeParams?.bg_color) {
      try {
        tg.setHeaderColor(tg.themeParams.bg_color);
      } catch {
        /* older clients */
      }
    }

    const startParam =
      tg.initDataUnsafe?.start_param ||
      new URLSearchParams(window.location.search).get("tgWebAppStartParam") ||
      "";
    const map = {
      shop: "products",
      products: "products",
      dtdshopcc: "dtdshopcc",
      mmshop: "dtdshopcc",
      buy: "products",
      checkout: "payment",
      pay: "payment",
      payment: "payment",
      track: "track",
      order: "track",
      smtp: "smtp",
      mail: "smtp",
      sms: "smtp",
      trade: "trade",
      trading: "trade",
      bots: "trade",
      chat: "chat",
      community: "chat",
      telegram: "telegram",
      faq: "faq",
      help: "faq",
      home: "home"
    };
    const page = map[String(startParam).toLowerCase()];
    if (page && typeof navigateToPage === "function") {
      navigateToPage(page, { push: true });
    }

    if (startParam && String(startParam).toLowerCase() === "mmshop" && typeof navigateToPage === "function") {
      navigateToPage("dtdshopcc", { push: true });
    }

    if (tg.BackButton) {
      const syncBack = () => {
        const hash = (location.hash || "#home").replace("#", "");
        if (hash && hash !== "home") tg.BackButton.show();
        else tg.BackButton.hide();
      };
      tg.BackButton.onClick(() => navigateToPage("home"));
      window.addEventListener("hashchange", syncBack);
      syncBack();
    }

    try {
      tg.disableVerticalSwipes?.();
    } catch {
      /* optional */
    }
    if (tg.themeParams?.secondary_bg_color) {
      document.documentElement.style.setProperty("--tg-secondary", tg.themeParams.secondary_bg_color);
    }
    try {
      tg.setBackgroundColor?.(tg.themeParams?.bg_color || "#0b1220");
    } catch {
      /* optional */
    }

    prefillCheckoutFromTelegram();
    syncTelegramMainButton();
    window.addEventListener("hashchange", () => {
      prefillCheckoutFromTelegram();
      syncTelegramMainButton();
    });

    trackEvent("mini_app_open", { start_param: startParam || "none" });
  } catch (error) {
    console.warn("Telegram Mini App init skipped", error);
  }
}

function bindTrackOrderForm() {
  const form = document.querySelector("#trackOrderForm");
  const result = document.querySelector("#trackOrderResult");
  if (!form || !result) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const orderId = form.elements.orderId.value.trim();
    const email = form.elements.email.value.trim();
    result.textContent = "Checking...";
    try {
      const response = await fetch(
        `/api/orders/status?orderId=${encodeURIComponent(orderId)}&email=${encodeURIComponent(email)}`
      );
      const payload = await response.json();
      if (!response.ok) {
        result.textContent = payload.error || "Order not found.";
        return;
      }
      const order = payload.order;
      result.innerHTML = `Order <strong>${order.id}</strong> — <strong>${escapeHtml(order.statusLabel || order.status)}</strong> · ${escapeHtml(order.paymentStatusLabel || "")} · $${Number(
        order.totalUsd || 0
      ).toFixed(2)} · ${escapeHtml(order.paymentMethod || "n/a")}`;
    } catch {
      result.textContent = "Could not reach order tracker. Try again or message support.";
    }
  });
}

boot();


