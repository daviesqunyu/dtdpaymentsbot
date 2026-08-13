/* DTD Payment — simple live checkout. Card/Bank via Paystack, or USDT (TRC20) deposit. */

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
          name: String(item?.name || "DTD product"),
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

const itemsRoot = document.querySelector("#checkoutItems");
const totalNodes = [
  document.querySelector("#checkoutTotal"),
  document.querySelector("#checkoutSubtotal"),
  document.querySelector("#checkoutDue"),
  document.querySelector("#mobileTotal")
];
const form = document.querySelector("#payForm");
const emailInput = document.querySelector("#customerEmail");
const formNotice = document.querySelector("#formNotice");
const payButton = document.querySelector("#payButton");
const payButtonLabel = document.querySelector("#payButtonLabel");
const successBox = document.querySelector("#successBox");
const successOrderId = document.querySelector("#successOrderId");
const successEmail = document.querySelector("#successEmail");
const usdtPanel = document.querySelector("#usdtPanel");
const paystackPanel = document.querySelector("#paystackPanel");
const usdtAddress = document.querySelector("#usdtAddress");
const copyAddress = document.querySelector("#copyAddress");
const txHashInput = document.querySelector("#txHash");

let storeConfig = {
  paystackPublicKey: "",
  usdtTrc20Address: "",
  paystackCurrency: "KES",
  paystackConversionRate: 129
};
let usdtTrc20Address = "";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """);
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

function showNotice(message) {
  formNotice.textContent = message;
  formNotice.hidden = false;
}

function hideNotice() {
  formNotice.hidden = true;
}

function currentMethod() {
  return document.querySelector(".method-tab.is-active")?.dataset.method || "paystack";
}

function setMethod(method) {
  document.querySelectorAll(".method-tab").forEach((tab) => {
    const active = tab.dataset.method === method;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  const usdt = method === "usdt";
  usdtPanel.hidden = !usdt;
  paystackPanel.hidden = usdt;
  payButtonLabel.textContent = usdt ? "Place order after deposit" : "Continue to Card / Bank";
  hideNotice();
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    if (response.ok) {
      const data = await response.json();
      storeConfig = { ...storeConfig, ...data };
    }

  async function startPaystack() {
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

    payBtn.disabled = true;
    payBtnLabel.textContent = "Opening Paystack…";
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
        PENDING_KEY,
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
      payBtn.disabled = false;
      payBtnLabel.textContent = "Deposit & Place Order";
    }
  }

  async function submitCrypto() {
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

    payBtn.disabled = true;
    payBtnLabel.textContent = "Placing order…";
    try {
      const orderId = await saveOrder({ paymentMethod: "USDT", paymentReference: txHash, email });
      showSuccess(orderId, email);
    } catch (error) {
      showNotice(error.message || "Could not place order.", true);
      payBtn.disabled = false;
      payBtnLabel.textContent = "Confirm USDT deposit";
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
    const orderId = await saveOrder({
      paymentMethod: "Paystack",
      paymentReference: reference,
      email: pending.email
    });
    return orderId;
  }

  function showSuccess(orderId, email) {
    const card = successCard;
    if (card) card.hidden = false;
    if (successOrderId) successOrderId.textContent = `#${orderId}`;
    const payCard = $(".pay-card");
    const summaryCard = $(".summary-card");
    if (payCard) payCard.hidden = true;
    if (summaryCard) summaryCard.hidden = true;
    sessionStorage.removeItem(PENDING_KEY);
    sessionStorage.removeItem(CHECKOUT_KEY);
  }

  async function handlePaystackReturn() {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    if (!reference) return false;

    let pending = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
    } catch {
      pending = null;
    }
    if (!pending) {
      showNotice("Payment reference found, but order details are missing.", true);
      return true;
    }

    payBtn.disabled = true;
    payBtnLabel.textContent = "Verifying payment…";
    try {
      const orderId = await verifyAndPlaceOrder(reference, pending);
      showSuccess(orderId, pending.email);
      return true;
    } catch (error) {
      showNotice(error.message || "Payment not confirmed yet.", true);
      payBtn.disabled = false;
      payBtnLabel.textContent = "Deposit & Place Order";
      return true;
    }
  }

  function bind() {
    checkout = readCheckout();
    if (emailInput) emailInput.value = checkout?.email || "";
    renderOrder();
    loadConfig();

    paystackBtn?.addEventListener("click", () => setMethod("paystack"));
    cryptoBtn?.addEventListener("click", () => setMethod("usdt"));
    payBtn?.addEventListener("click", () => {
      if (method === "usdt") submitCrypto();
      else startPaystack();
    });
    copyAddressBtn?.addEventListener("click", async () => {
      const addr = config?.usdtTrc20Address || "";
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

    handlePaystackReturn();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
