/* DTD Payment — animated card checkout (codx style) */

const storageKey = "dtd_custom_checkout";
const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function readCheckout() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
    const items = Array.isArray(raw.items) ? raw.items : [];
    const computed = items.reduce((sum, item) => sum + Number(item.priceUsd || 0) * Number(item.quantity || 1), 0);
    return {
      email: String(raw.email || ""),
      totalUsd: computed || Math.max(0, Number(raw.totalUsd || 0)),
      items
    };
  } catch {
    return { email: "", totalUsd: 0, items: [] };
  }
}

const checkout = readCheckout();
const $ = (id) => document.getElementById(id);

const cardItem = $("cardItem");
const focusEl = $("cardFocus");
const numberDisplay = $("cardNumberDisplay");
const holderDisplay = $("cardHolderDisplay");
const mmDisplay = $("expireMMDisplay");
const yyDisplay = $("expireYYDisplay");
const cvvDisplay = $("cvvDisplay");
const brandEl = $("cardBrand");

const numberInput = $("cardNumber");
const holderInput = $("cardHolder");
const mmSelect = $("expireMM");
const yySelect = $("expireYY");
const cvvInput = $("cvv");
const emailInput = $("customerEmail");
const form = $("payForm");
const notice = $("formNotice");
const payButton = $("payButton");
const payButtonLabel = $("payButtonLabel");
const successBox = $("successBox");

let busy = false;

/* ---------- rendering ---------- */

const SLOTS = 19;

function renderNumber() {
  const digits = numberInput.value.replace(/\D/g, "");
  let html = "";
  for (let i = 0; i < Math.max(SLOTS, digits.length); i++) {
    if (i && i % 4 === 0) html += " ";
    html += digits[i] || "&bull;";
  }
  numberDisplay.innerHTML = html;
  renderBrand(digits);
}

function renderHolder() {
  holderDisplay.textContent = holderInput.value.trim() || "Full Name";
}

function renderExpiry() {
  mmDisplay.textContent = mmSelect.value || "MM";
  yyDisplay.textContent = yySelect.value ? yySelect.value.slice(-2) : "YY";
}

function renderCvv() {
  cvvDisplay.textContent = "&bull;".repeat(cvvInput.value.length);
  cvvDisplay.innerHTML = cvvDisplay.textContent;
}

const BRANDS = {
  visa: { label: "VISA", match: /^4/ },
  mastercard: { label: '<span class="mc-circles"><svg width="34" height="22" viewBox="0 0 34 22"><circle cx="12" cy="11" r="10" fill="#eb001b"/><circle cx="22" cy="11" r="10" fill="#f79e1b" fill-opacity="0.9"/></svg></span>', match: /^(5[1-5]|2[2-7])/ },
  amex: { label: "AMEX", match: /^3[47]/ },
  discover: { label: "DISCOVER", match: /^6(?:011|5)/ }
};

function renderBrand(digits) {
  const brand = Object.entries(BRANDS).find(([, b]) => b.match.test(digits));
  if (!brand || !digits.length) {
    brandEl.innerHTML = "";
  } else {
    brandEl.innerHTML = brand[1].label;
  }
}

/* ---------- focus highlight ---------- */

function moveFocus(region) {
  const target = cardItem.querySelector(`[data-region="${region}"]`);
  if (!target || !focusEl) return;
  const cardRect = cardItem.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const pad = 4;
  focusEl.style.left = `${rect.left - cardRect.left - pad}px`;
  focusEl.style.top = `${rect.top - cardRect.top - pad}px`;
  focusEl.style.width = `${rect.width + pad * 2}px`;
  focusEl.style.height = `${rect.height + pad * 2}px`;
  focusEl.classList.add("-active");
}

function clearFocus() {
  if (focusEl) focusEl.classList.remove("-active");
}

function bindFocus(inputId, region) {
  const el = $(inputId);
  if (!el) return;
  el.addEventListener("focus", () => moveFocus(region));
  el.addEventListener("blur", clearFocus);
}

/* ---------- selects ---------- */

function populateDate() {
  for (let m = 1; m <= 12; m++) {
    const option = document.createElement("option");
    option.value = String(m).padStart(2, "0");
    option.textContent = String(m).padStart(2, "0");
    mmSelect.appendChild(option);
  }
  const startYear = new Date().getFullYear();
  for (let y = startYear; y <= startYear + 15; y++) {
    const option = document.createElement("option");
    option.value = String(y);
    option.textContent = String(y);
    yySelect.appendChild(option);
  }
}

/* ---------- validation ---------- */

function luhnValid(num) {
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let digit = Number(num[i]);
    if (alt) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alt = !alt;
  }
  return num.length >= 13 && sum % 10 === 0;
}

function showNotice(message, isError) {
  if (!notice) return;
  notice.textContent = message;
  notice.classList.toggle("is-error", Boolean(isError));
  notice.hidden = false;
}

/* ---------- submit ---------- */

async function handleSubmit(event) {
  event.preventDefault();
  if (busy) return;

  const email = emailInput.value.trim();
  const digits = numberInput.value.replace(/\D/g, "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    showNotice("Enter a valid delivery email.", true);
    emailInput.focus();
    return;
  }
  if (!holderInput.value.trim()) {
    showNotice("Enter the card holder name.", true);
    holderInput.focus();
    return;
  }
  if (!mmSelect.value || !yySelect.value) {
    showNotice("Select the expiration month and year.", true);
    return;
  }
  if (cvvInput.value.length < 3) {
    showNotice("Enter the 3 or 4 digit CVV.", true);
    cvvInput.focus();
    return;
  }
  if (!luhnValid(digits)) {
    showNotice("Card number looks invalid. Check and try again.", true);
    numberInput.focus();
    return;
  }

  busy = true;
  payButton.disabled = true;
  payButtonLabel.textContent = "Processing…";

  try {
    const response = await fetch("/api/card-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        cardHolder: holderInput.value.trim(),
        cardNumber: digits,
        expMonth: mmSelect.value,
        expYear: yySelect.value,
        cvv: cvvInput.value,
        totalUsd: checkout.totalUsd,
        items: checkout.items.map((item) => ({
          product_id: item.id || "",
          product_name: item.name,
          quantity: item.quantity,
          unit_price_usd: item.priceUsd
        }))
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Payment could not be saved.");

    if (form) form.hidden = true;
    if (cardItem) cardItem.hidden = true;
    if (successBox) successBox.hidden = false;
    $("successOrderId").textContent = `#${payload.orderId}`;
    $("successEmail").textContent = email;
    sessionStorage.removeItem(storageKey);
  } catch (error) {
    showNotice(error.message || "Something went wrong. Try again.", true);
    payButton.disabled = false;
    payButtonLabel.textContent = checkout.totalUsd > 0 ? `Pay ${formatter.format(checkout.totalUsd)}` : "Pay Now";
    busy = false;
  }
}

/* ---------- init ---------- */

function bind() {
  if (checkout.totalUsd > 0) {
    $("checkoutTotal").textContent = formatter.format(checkout.totalUsd);
    payButtonLabel.textContent = `Pay ${formatter.format(checkout.totalUsd)}`;
  } else {
    payButtonLabel.textContent = "Pay Now";
  }
  emailInput.value = checkout.email || "";

  populateDate();
  renderNumber();
  renderHolder();
  renderExpiry();

  numberInput.addEventListener("input", () => {
    const digits = numberInput.value.replace(/\D/g, "").slice(0, 19);
    numberInput.value = digits.replace(/(.{4})/g, "$1 ").trim();
    renderNumber();
  });

  holderInput.addEventListener("input", renderHolder);
  mmSelect.addEventListener("change", renderExpiry);
  yySelect.addEventListener("change", renderExpiry);

  cvvInput.addEventListener("input", renderCvv);
  cvvInput.addEventListener("focus", () => cardItem.classList.add("-active"));
  cvvInput.addEventListener("blur", () => cardItem.classList.remove("-active"));

  bindFocus("cardNumber", "number");
  bindFocus("cardHolder", "holder");
  bindFocus("expireMM", "expire");
  bindFocus("expireYY", "expire");

  form.addEventListener("submit", handleSubmit);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bind);
} else {
  bind();
}
