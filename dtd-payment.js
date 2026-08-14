/* DTD Payment — rigid, fast checkout. Card/Bank via Paystack, or USDT (TRC20) deposit. */

const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const storageKey = "dtd_custom_checkout";
const pendingKey = "dtd_pending_paystack";

function readJson(storage, key, fallback) {
  try {
    return JSON.parse(storage.getItem(key) || "") || fallback;
  } catch {
    return fallback;
  }
}

function normalizeCheckout(value) {
  const items = Array.isArray(value?.items)
    ? value.items
        .map((item) => ({
          id: String(item?.id || ""),
          name: String(item?.name || ""),
          description: String(item?.description || ""),
          quantity: Math.max(1, Number(item?.quantity || 1)),
          priceUsd: Math.max(0, Number(item?.priceUsd || 0))
        }))
        .filter((item) => item.name)
    : [];
  const computed = items.reduce((sum, item) => sum + item.priceUsd * item.quantity, 0);
  return {
    name: String(value?.name || ""),
    email: String(value?.email || ""),
    telegram: String(value?.telegram || ""),
    note: String(value?.note || ""),
    totalUsd: computed || Math.max(0, Number(value?.totalUsd || 0)),
    items
  };
}

const checkout = normalizeCheckout(readJson(sessionStorage, storageKey, {}));

const $ = (selector) => document.querySelector(selector);
const itemsRoot = $("#checkoutItems");
const totalNodes = [$("#checkoutTotal"), $("#checkoutSubtotal"), $("#checkoutDue"), $("#mobileTotal")];
const form = $("#payForm");
const emailInput = $("#customerEmail");
const formNotice = $("#formNotice");
const payButton = $("#payButton");
const payButtonLabel = $("#payButtonLabel");
const successBox = $("#successBox");
const successOrderId = $("#successOrderId");
const successEmail = $("#successEmail");
const usdtPanel = $("#usdtPanel");
const paystackPanel = $("#paystackPanel");
const usdtAddress = $("#usdtAddress");
const copyAddress = $("#copyAddress");
const txHashInput = $("#txHash");
const methodTabs = document.querySelectorAll(".method-tab");

let storeConfig = {
  paystackPublicKey: "",
  usdtTrc20Address: "",
  paystackCurrency: "KES",
  paystackConversionRate: 129
};
let usdtTrc20Address = "";
let busy = false;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderOrder() {
  const formatted = formatter.format(checkout.totalUsd);
  totalNodes.forEach((node) => {
    if (!node) return;
    node.textContent = node.id === "mobileTotal" ? `${formatted} USD` : formatted;
  });

  if (!checkout.items.length) {
    itemsRoot.innerHTML = `
      <div class="empty-order">
        No product was transferred from your cart.
        <a href="/#products">Return to products</a>
      </div>`;
    return;
  }

  itemsRoot.innerHTML = checkout.items
    .map(
      (item) => `
        <article class="checkout-item">
          <div class="item-art" aria-hidden="true">DTD</div>
          <div class="item-copy">
            <strong>${escapeHtml(item.name)}</strong>
            <span>Qty ${item.quantity}${item.description ? ` · ${escapeHtml(item.description.slice(0, 48))}` : ""}</span>
          </div>
          <span class="item-price">${formatter.format(item.priceUsd * item.quantity)}</span>
        </article>`
    )
    .join("");
}

function showNotice(message, isError) {
  if (!formNotice) return;
  formNotice.textContent = message;
  formNotice.classList.toggle("is-error", Boolean(isError));
  formNotice.hidden = false;
}

function hideNotice() {
  if (formNotice) formNotice.hidden = true;
}

function currentMethod() {
  return document.querySelector(".method-tab.is-active")?.dataset.method || "paystack";
}

function setMethod(method) {
  methodTabs.forEach((tab) => {
    const active = tab.dataset.method === method;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  const usdt = method === "usdt";
  if (usdtPanel) usdtPanel.hidden = !usdt;
  if (paystackPanel) paystackPanel.hidden = usdt;
  if (payButtonLabel) {
    payButtonLabel.textContent = usdt ? "Place order after deposit" : "Continue to Card / Bank";
  }
  hideNotice();
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    if (response.ok) {
      const data = await response.json();
      storeConfig = { ...storeConfig, ...data };
      usdtTrc20Address = data.usdtTrc20Address || "";
      if (usdtAddress) usdtAddress.textContent = usdtTrc20Address || "Not configured";
    }
  } catch {
    /* offline-safe: fall back to defaults */
  }
}

async function startPaystack() {
  if (busy) return;
  if (!checkout?.items?.length || checkout.totalUsd <= 0) {
    showNotice("Return to DTD Store and add a product before checking out.", true);
    return;
  }
  const email = emailInput.value.trim();
  if (!email) {
    showNotice("Enter your delivery email to continue.", true);
    emailInput.focus();
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    showNotice("Enter a valid email address.", true);
    emailInput.focus();
    return;
  }

  busy = true;
  payButton.disabled = true;
  payButtonLabel.textContent = "Opening Paystack…";
  try {
    const response = await fetch("/api/paystack/initialize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        name: checkout.name || "DTD Customer",
        amountUsd: checkout.totalUsd,
        cartItems: checkout.items.map((item) => `${item.name} x${item.quantity}`).join(", ")
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok || !payload.authorization_url) {
      throw new Error(payload.error || "Could not start Paystack payment.");
    }

    sessionStorage.setItem(
      pendingKey,
      JSON.stringify({
        reference: payload.reference,
        email,
        name: checkout.name || "",
        telegram: checkout.telegram || "",
        productAccount: "",
        orderNote: checkout.note || "",
        totalUsd: checkout.totalUsd,
        items: checkout.items.map((item) => ({
          product_id: item.id,
          product_name: item.name,
          quantity: item.quantity,
          unit_price_usd: item.priceUsd
        }))
      })
    );
    window.location.href = payload.authorization_url;
  } catch (error) {
    showNotice(error.message || "Paystack failed to open.", true);
    payButton.disabled = false;
    payButtonLabel.textContent = "Continue to Card / Bank";
    busy = false;
  }
}

async function submitCrypto() {
  if (busy) return;
  const email = emailInput.value.trim();
  if (!email) {
    showNotice("Enter your delivery email to continue.", true);
    emailInput.focus();
    return;
  }
  const txHash = txHashInput.value.trim();
  if (!txHash) {
    showNotice("Paste your USDT transaction hash.", true);
    txHashInput.focus();
    return;
  }

  busy = true;
  payButton.disabled = true;
  payButtonLabel.textContent = "Placing order…";
  try {
    const orderId = await saveOrder({ paymentMethod: "USDT", paymentReference: txHash, email });
    showSuccess(orderId, email);
  } catch (error) {
    showNotice(error.message || "Could not place order.", true);
    payButton.disabled = false;
    payButtonLabel.textContent = "Place order after deposit";
    busy = false;
  }
}

async function saveOrder({ paymentMethod, paymentReference, email }) {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: checkout.name || "DTD Customer",
      customerEmail: email,
      telegramUsername: checkout.telegram || null,
      paymentMethod,
      paymentReference,
      productAccount: null,
      deliveryDetails: checkout.note || null,
      totalUsd: checkout.totalUsd,
      items: checkout.items.map((item) => ({
        product_id: item.id,
        product_name: item.name,
        quantity: item.quantity,
        unit_price_usd: item.priceUsd
      }))
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Order not saved");
  return payload.orderId;
}

async function verifyAndPlaceOrder(reference, pending) {
  const verifyResponse = await fetch("/api/paystack/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference })
  });
  const verifyPayload = await verifyResponse.json();
  if (!verifyResponse.ok || !verifyPayload.paid) {
    throw new Error(verifyPayload.error || "Payment not confirmed yet.");
  }
  return saveOrder({
    paymentMethod: "Paystack",
    paymentReference: reference,
    email: pending.email
  });
}

function showSuccess(orderId, email) {
  if (successBox) successBox.hidden = false;
  if (successOrderId) successOrderId.textContent = `#${orderId}`;
  if (successEmail) successEmail.textContent = email || "—";
  if (form) form.hidden = true;
  sessionStorage.removeItem(pendingKey);
  sessionStorage.removeItem(storageKey);
}

async function handlePaystackReturn() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get("reference") || params.get("trxref");
  if (!reference) return false;

  let pending = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(pendingKey) || "null");
  } catch {
    pending = null;
  }
  if (!pending) {
    showNotice("Payment reference found, but order details are missing.", true);
    return true;
  }

  busy = true;
  payButton.disabled = true;
  payButtonLabel.textContent = "Verifying payment…";
  try {
    const orderId = await verifyAndPlaceOrder(reference, pending);
    showSuccess(orderId, pending.email);
    return true;
  } catch (error) {
    showNotice(error.message || "Payment not confirmed yet.", true);
    payButton.disabled = false;
    payButtonLabel.textContent = "Continue to Card / Bank";
    busy = false;
    return true;
  }
}

function bind() {
  if (emailInput) emailInput.value = checkout.email || "";
  renderOrder();
  loadConfig();

  methodTabs.forEach((tab) => {
    tab.addEventListener("click", () => setMethod(tab.dataset.method));
  });

  if (payButton) {
    payButton.addEventListener("click", (event) => {
      event.preventDefault();
      if (currentMethod() === "usdt") submitCrypto();
      else startPaystack();
    });
  }

  if (copyAddress) {
    copyAddress.addEventListener("click", async () => {
      const addr = usdtTrc20Address || storeConfig.usdtTrc20Address || "";
      if (!addr) {
        showNotice("USDT address not configured.", true);
        return;
      }
      try {
        await navigator.clipboard.writeText(addr);
        showNotice("USDT address copied.");
      } catch {
        showNotice("Copy failed — select the address manually.");
      }
    });
  }

  handlePaystackReturn();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bind);
} else {
  bind();
}
