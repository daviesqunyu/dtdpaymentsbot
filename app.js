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
  btcAddress: "",
  btcNetwork: "BTC",
  paymentOptions: [
    { id: "Crypto", label: "Bitcoin (BTC)", type: "crypto" },
    { id: "Paystack Card", label: "Card (Visa / Mastercard)", type: "paystack", channels: ["card"] }
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
  products: []
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
const paymentMethodInput = document.querySelector("#paymentMethod");
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

async function loadStoreConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("Config unavailable");
    storeConfig = await response.json();
  } catch (error) {
    console.warn("Using fallback store config", error);
  }

  paymentMethodInput.innerHTML = storeConfig.paymentOptions
    .map((option) => `<option value="${option.id}">${option.label}</option>`)
    .join("");

  if (window.initTelegramBot) {
    window.initTelegramBot(storeConfig);
  }

  updatePaymentHint();
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
  const address = storeConfig.btcAddress || "";

  cryptoNetworkLabel.textContent = storeConfig.btcNetwork || "BTC";
  cryptoAddress.textContent = address || "BTC address not configured in .env";
  copyCryptoAddressButton.disabled = !address || !isCrypto;

  cryptoPanel.hidden = !isCrypto;
  paystackPanel.hidden = isCrypto;
  cryptoAddress.hidden = !isCrypto;

  if (isCrypto) {
    paymentHint.textContent =
      "Send the exact BTC total to this address, then paste the transaction hash before submitting.";
    paystackButton.textContent = "Pay with Paystack";
  } else {
    paymentHint.textContent = `Pay with ${option.label}. Complete checkout, then submit your order for delivery.`;
    paystackButton.textContent = `Pay with ${option.label}`;
  }

  updateTelegramPaymentPanel();
}

function startPaystackPayment() {
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

  if (!window.PaystackPop) {
    showToast("Paystack is still loading. Try again in a moment.");
    return;
  }

  if (!storeConfig.paystackPublicKey) {
    showToast("Paystack public key missing in .env.");
    return;
  }

  const option = selectedPaymentOption();
  const amountCents = Math.round(currentTotal() * 100);
  const reference = `DTD-${Date.now()}`;
  const handler = window.PaystackPop.setup({
    key: storeConfig.paystackPublicKey,
    email,
    amount: amountCents,
    currency: "USD",
    ref: reference,
    channels: option.channels || ["card", "bank", "ussd", "qr", "mobile_money", "bank_transfer"],
    metadata: {
      customer_name: name,
      payment_option: option.id,
      cart_items: cartEntries().map((product) => `${product.name} x${product.quantity}`).join(", ")
    },
    callback(response) {
      paymentMethodInput.value = option.id;
      checkoutForm.elements.paymentReference.value = response.reference || reference;
      updatePaymentHint();
      verifyPaystackReference(response.reference || reference);
    },
    onClose() {
      showToast("Paystack checkout closed.");
    }
  });

  handler.openIframe();
}

async function verifyPaystackReference(reference) {
  if (!reference) {
    showToast("Payment reference saved. Submit your order.");
    return;
  }

  try {
    const response = await fetch("/api/paystack/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference })
    });
    const payload = await response.json();

    if (response.ok && payload.paid) {
      showToast("Payment verified. Submit your order for delivery.");
      return;
    }

    if (response.ok) {
      showToast("Payment reference saved. Submit your order.");
      return;
    }
  } catch {
    // Soft verify — do not block checkout if verify endpoint is unavailable.
  }

  showToast("Payment reference saved. Submit your order.");
}

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
  copyText(window.location.origin, "Store link copied");
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

  if (!state.cart.size) {
    showToast("Add at least one product before checkout.");
    return;
  }

  const formData = new FormData(checkoutForm);
  const submitButton = checkoutForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Saving order...";

  try {
    await saveOrder(formData);
    showToast("Order saved — admin will confirm and deliver.");
    if (window.addBotMessage) {
      window.addBotMessage("Your order was submitted. We'll update you on Telegram.");
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || "Order not saved. Check server and .env.");
    submitButton.disabled = false;
    submitButton.textContent = "Submit order for review";
    return;
  }

  checkoutForm.reset();
  state.cart.clear();
  renderCart();
  updatePaymentHint();
  submitButton.disabled = false;
  submitButton.textContent = "Submit order for review";
});

function initHeroMotion() {
  const chatRows = document.querySelectorAll(".chat-row");
  chatRows.forEach((row, index) => {
    row.style.animationDelay = `${index * 0.45}s`;
  });
}

async function boot() {
  initHeroMotion();
  await loadStoreConfig();
  await loadProducts();
}

boot();
