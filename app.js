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
  btcAddress: "",
  btcNetwork: "BTC",
  paymentOptions: [
    { id: "Crypto", label: "Bitcoin (BTC)", type: "crypto" },
    { id: "Paystack", label: "Card / Bank / Mobile Money", type: "paystack" }
  ]
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
const copyCryptoAddressButton = document.querySelector("#copyCryptoAddress");
const paymentMethodInput = document.querySelector("#paymentMethodInput");
const paymentMethodsGrid = document.querySelector("#paymentMethodsGrid");
const paystackButton = document.querySelector("#paystackButton");
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
    { id: "Crypto", type: "crypto", channels: [] }
  );
}

function isCryptoPayment() {
  return selectedPaymentOption().type === "crypto";
}

function renderPaymentMethodsGrid() {
  if (!paymentMethodsGrid) return;
  
  const options = storeConfig.paymentOptions || [];
  paymentMethodsGrid.innerHTML = options.map((opt) => {
    const isSelected = opt.id === paymentMethodInput.value;
    
    // Choose icon
    let icon = "💳";
    if (opt.type === "crypto") icon = "₿";
    else if (opt.id.includes("Card")) icon = "💳";
    else if (opt.id.includes("Bank")) icon = "🏛️";
    else if (opt.id.includes("USSD")) icon = "📱";
    else if (opt.id.includes("Mobile Money")) icon = "💸";
    else if (opt.id.includes("QR")) icon = "🔍";

    let sub = "Instant";
    if (opt.type === "crypto") sub = "Requires confirmation";
    else if (opt.id.includes("Bank")) sub = "Manual verify option";

    return `
      <button type="button" class="payment-method-btn ${isSelected ? 'selected' : ''}" data-id="${opt.id}">
        <span class="method-icon">${icon}</span>
        <span class="method-label">${opt.label}</span>
        <span class="method-sub">${sub}</span>
        <span class="select-check">✓</span>
      </button>
    `;
  }).join("");

  // Add click listeners
  paymentMethodsGrid.querySelectorAll(".payment-method-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      paymentMethodInput.value = btn.dataset.id;
      updatePaymentHint();
      renderPaymentMethodsGrid();
    });
  });
}

async function loadStoreConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("Config unavailable");
    storeConfig = await response.json();
    // #region agent log
    fetch('http://127.0.0.1:7413/ingest/3855ecfa-f160-49a6-b4f2-efca4f443e59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8491be'},body:JSON.stringify({sessionId:'8491be',runId:'pre-fix',hypothesisId:'B',location:'app.js:loadStoreConfig',message:'Store config loaded',data:{hasPublicKey:Boolean(storeConfig.paystackPublicKey),publicKeyPrefix:String(storeConfig.paystackPublicKey||'').slice(0,8),currency:storeConfig.paystackCurrency,conversionRate:storeConfig.paystackConversionRate,optionCount:(storeConfig.paymentOptions||[]).length,telegramEnabled:storeConfig.telegramEnabled},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  } catch (error) {
    console.warn("Using fallback store config", error);
    // #region agent log
    fetch('http://127.0.0.1:7413/ingest/3855ecfa-f160-49a6-b4f2-efca4f443e59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8491be'},body:JSON.stringify({sessionId:'8491be',runId:'pre-fix',hypothesisId:'B',location:'app.js:loadStoreConfig',message:'Config load failed',data:{error:String(error&&error.message||error)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
  const botUrl = storeConfig.telegramBotUrl || "https://t.me/Dtdpaymentbot";
  const channelUrl = storeConfig.telegramChannelUrl || "https://t.me/DTDMAINSTORE";
  const ownerUrl = storeConfig.telegramOwnerUrl || "https://t.me/Davetheedev";
  const companyUrl = storeConfig.companyUrl || "https://dvtechnologies.xyz";

  [
    ["#hubBotLink", botUrl],
    ["#hubChannelLink", channelUrl],
    ["#hubOwnerLink", ownerUrl],
    ["#hubCompanyLink", companyUrl],
    ["#heroOpenBot", botUrl],
    ["#heroOpenChannel", channelUrl],
    ["#heroOpenOwner", ownerUrl]
  ].forEach(([sel, href]) => {
    const el = document.querySelector(sel);
    if (el) el.href = href;
  });

  const heroRow = document.querySelector("#heroTelegramLinks");
  if (heroRow) heroRow.hidden = false;
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
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    state.products = fallbackProducts;
    showToast("Using sample products. Check Supabase setup.");
  } else {
    state.products = data.filter(isAllowedProduct);
    if (data.length !== state.products.length) {
      showToast("Removed restricted products from this storefront view.");
    }
    if (!state.products.length) {
      state.products = fallbackProducts;
      showToast("Showing clean software products.");
    }
  }

  renderProducts();
  renderCart();
  updateLiveStats();
}

function updateLiveStats() {
  if (!liveStats) return;
  const totalProducts = state.products.length;
  const totalValue = state.products.reduce((sum, product) => sum + productPrice(product), 0);
  liveStats.innerHTML = `
    <span class="live-pill"><span class="pulse-dot"></span>${totalProducts} live products</span>
    <span class="live-pill">From ${formatMoney(Math.min(...state.products.map(productPrice), totalValue))}</span>
    <span class="live-pill">BTC + Paystack checkout</span>
  `;
}

function renderProducts(items = state.products) {
  const count = items.length;
  productCount.textContent = count === 1 ? "Showing 1 product" : `Showing ${count} products`;

  if (!items.length) {
    productsGrid.innerHTML = `<div class="empty-cart wide-empty">No products are available yet.</div>`;
    return;
  }

  productsGrid.innerHTML = items
    .map(
      (product, index) => `
        <article class="product-card reveal" style="--delay:${index * 70}ms">
          <div class="product-image" style="background:${product.color || "#0f766e"}">
            ${product.image_url ? `<img src="${product.image_url}" alt="${product.name}" loading="lazy" />` : product.name.charAt(0)}
          </div>
          <h3>${product.name}</h3>
          <p>${product.description}</p>
          <div class="product-meta">
            <span class="price">${formatMoney(productPrice(product))}</span>
            <button class="primary-button" type="button" data-add="${product.id}">
              Add to cart
            </button>
          </div>
        </article>
      `
    )
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

  if (!entries.length) {
    cartItems.innerHTML = `<div class="empty-cart">Your cart is empty. Add a product to continue.</div>`;
    return;
  }

  cartItems.innerHTML = entries
    .map(
      (product) => `
        <div class="cart-item">
          <div>
            <strong>${product.name}</strong>
            <span>${formatMoney(productPrice(product))} each</span>
          </div>
          <div class="quantity-controls" aria-label="${product.name} quantity controls">
            <button type="button" data-decrease="${product.id}" aria-label="Decrease ${product.name}">-</button>
            <span>${product.quantity}</span>
            <button type="button" data-increase="${product.id}" aria-label="Increase ${product.name}">+</button>
          </div>
        </div>
      `
    )
    .join("");
}

function addToCart(productId) {
  state.cart.set(productId, (state.cart.get(productId) || 0) + 1);
  renderCart();
  showToast("Added to cart");
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
  const paymentMethod = formData.get("payment") || "Crypto";
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
  const isTelegram = option.type === "telegram" || option.id === "Telegram";

  const address = storeConfig.btcAddress || "";
  const total = currentTotal();

  cryptoPanel.hidden = !isCrypto;
  paystackPanel.hidden = !isPaystack;
  telegramPaymentPanel.hidden = !isTelegram;

  const submitBtn = document.querySelector("#submitButton");

  if (isPaystack) {
    paystackButton.style.display = "flex";
    paystackButton.innerHTML = `Pay with Card / Mobile Money`;
    if (submitBtn) submitBtn.style.display = "none";
  } else {
    paystackButton.style.display = "none";
    if (submitBtn) {
      submitBtn.style.display = "block";
      submitBtn.textContent = isCrypto ? "Confirm BTC Payment" : "Complete & Place Order";
    }
  }

  if (isCrypto) {
    cryptoAddress.textContent = address || "BTC address not configured";
    if (copyCryptoAddressButton) {
      copyCryptoAddressButton.disabled = !address;
    }

    const rate = state.btcUsdPrice > 0 ? state.btcUsdPrice : 65000;
    const btcEstimate = total > 0 ? (total / rate).toFixed(6) : "0.000000";
    if (btcAmountLabel) {
      btcAmountLabel.textContent =
        total > 0
          ? `$${total.toFixed(2)} USD (~${btcEstimate} BTC @ $${Math.round(rate).toLocaleString()})`
          : "Add items to see amount";
    }

    if (btcQrCode && address && total > 0) {
      btcQrCode.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=bitcoin:${address}?amount=${btcEstimate}`;
    }
  }

  updateTelegramPaymentPanel();
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
    // #region agent log
    fetch('http://127.0.0.1:7413/ingest/3855ecfa-f160-49a6-b4f2-efca4f443e59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8491be'},body:JSON.stringify({sessionId:'8491be',runId:'post-fix',hypothesisId:'A',location:'app.js:startPaystackPayment',message:'Initialize result',data:{ok:initResponse.ok,error:initPayload.error,currency:initPayload.currency,amount:initPayload.amount,reference:initPayload.reference,hasUrl:Boolean(initPayload.authorization_url)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

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
    // #region agent log
    fetch('http://127.0.0.1:7413/ingest/3855ecfa-f160-49a6-b4f2-efca4f443e59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8491be'},body:JSON.stringify({sessionId:'8491be',runId:'post-fix',hypothesisId:'A',location:'app.js:startPaystackPayment:catch',message:'Paystack start failed',data:{error:String(error&&error.message||error)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    showToast(error.message || "Paystack failed to open.");
    if (paystackButton) {
      paystackButton.disabled = false;
      paystackButton.textContent = "Pay with Card / Mobile Money";
    }
  }
}

async function resumePaystackReturn() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get("reference") || params.get("trxref");
  if (!reference) return;

  const pendingRaw = sessionStorage.getItem("dtd_pending_paystack");
  // #region agent log
  fetch('http://127.0.0.1:7413/ingest/3855ecfa-f160-49a6-b4f2-efca4f443e59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8491be'},body:JSON.stringify({sessionId:'8491be',runId:'post-fix',hypothesisId:'A',location:'app.js:resumePaystackReturn',message:'Paystack return',data:{reference,hasPending:Boolean(pendingRaw)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

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
    const cleanUrl = window.location.pathname + (window.location.hash || "");
    window.history.replaceState({}, "", cleanUrl || "/");
  }
}

// Paystack verification handled server side or directly via submitOrderDirectly callback.

productsGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]");
  if (!button) return;
  addToCart(button.dataset.add);
});

cartItems.addEventListener("click", (event) => {
  const decreaseButton = event.target.closest("[data-decrease]");
  const increaseButton = event.target.closest("[data-increase]");

  if (decreaseButton) changeQuantity(decreaseButton.dataset.decrease, -1);
  if (increaseButton) changeQuantity(increaseButton.dataset.increase, 1);
});

document.querySelector(".cart-toggle").addEventListener("click", () => {
  document.querySelector("#checkout").scrollIntoView({ behavior: "smooth" });
});

productSearch.addEventListener("input", (event) => {
  const searchTerm = event.target.value.trim().toLowerCase();
  const filteredProducts = state.products.filter((product) =>
    `${product.name} ${product.description}`.toLowerCase().includes(searchTerm)
  );
  renderProducts(filteredProducts);
});

refreshProductsButton.addEventListener("click", loadProducts);

copyStoreLinkButton.addEventListener("click", () => {
  copyText(storeConfig.storeUrl || window.location.origin || "https://dtdpaymentsbot.pages.dev", "Store link copied");
});

copyCryptoAddressButton.addEventListener("click", () => {
  if (!storeConfig.btcAddress) {
    showToast("Add BTC_ADDRESS to your .env file.");
    return;
  }
  copyText(storeConfig.btcAddress, "BTC address copied");
});

paystackButton.addEventListener("click", startPaystackPayment);

paymentMethodInput.addEventListener("change", updatePaymentHint);

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
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
    document.querySelector("#products").scrollIntoView({ behavior: "smooth" });
  });
}

function initHeroMotion() {
  const chatRows = document.querySelectorAll(".chat-row");
  chatRows.forEach((row, index) => {
    row.style.animationDelay = `${index * 0.45}s`;
  });
}

async function boot() {
  initHeroMotion();
  await Promise.all([loadStoreConfig(), fetchBtcUsdPrice()]);
  await loadProducts();
  await resumePaystackReturn();
  bindTrackOrderForm();
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
      result.innerHTML = `Order <strong>${order.id}</strong> — status <strong>${order.status}</strong> · $${Number(
        order.totalUsd || 0
      ).toFixed(2)} · ${order.paymentMethod || "n/a"}`;
    } catch {
      result.textContent = "Could not reach order tracker. Try again or message support.";
    }
  });
}

boot();
