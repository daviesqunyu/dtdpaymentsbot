const toggleButton = document.querySelector("#telegramBotToggle");
const panel = document.querySelector("#telegramBotPanel");
const closeButton = document.querySelector("#telegramBotClose");
const form = document.querySelector("#telegramBotForm");
const messages = document.querySelector("#telegramBotMessages");
const openTelegramLink = document.querySelector("#openTelegramLink");
const sendButton = form?.querySelector('button[type="submit"]');

let botConfig = { telegramEnabled: false, telegramBotUsername: "", telegramBotUrl: "" };
let sending = false;

function addBotMessage(text, type = "bot") {
  const bubble = document.createElement("div");
  bubble.className = `bot-message ${type}`;
  bubble.textContent = text;
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
}

function setPanelOpen(isOpen) {
  panel.hidden = !isOpen;
  toggleButton.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) {
    panel.querySelector("textarea, input")?.focus();
  }
}

function syncCheckoutTelegram(contact) {
  const value = String(contact || "").trim();
  if (!value) return;

  const telegramInput = document.querySelector('#checkoutForm input[name="telegram"]');
  if (!telegramInput || telegramInput.value.trim()) return;

  const handle = value.startsWith("@") ? value : value.includes("@") ? value : `@${value.replace(/^@/, "")}`;
  if (handle.includes("@")) {
    telegramInput.value = handle.startsWith("@") ? handle : `@${handle.split("@").pop()}`;
  }
}

function initTelegramBot(config) {
  botConfig = { ...botConfig, ...(config || {}) };

  const botUrl = botConfig.telegramBotUrl || "";
  if (botUrl) {
    openTelegramLink.href = botUrl;
    openTelegramLink.hidden = false;
  } else if (botConfig.telegramBotUsername) {
    openTelegramLink.href = `https://t.me/${String(botConfig.telegramBotUsername).replace(/^@/, "")}`;
    openTelegramLink.hidden = false;
  } else {
    openTelegramLink.hidden = true;
  }

  if (!messages.dataset.booted) {
    messages.dataset.booted = "1";
    addBotMessage("Hi — I'm the DTD Store assistant. Ask about products, payments, or your order.");
    if (botConfig.telegramEnabled) {
      addBotMessage("Your message goes straight to our team on Telegram.");
    } else {
      addBotMessage("Live Telegram relay is being set up. You can still leave a message here.");
    }
  }
}

toggleButton.addEventListener("click", () => {
  setPanelOpen(panel.hidden);
});

closeButton.addEventListener("click", () => setPanelOpen(false));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !panel.hidden) setPanelOpen(false);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sending) return;

  const formData = new FormData(form);
  const message = String(formData.get("message") || "").trim();
  const name = String(formData.get("name") || "Visitor").trim();
  const contact = String(formData.get("contact") || "").trim();

  if (!message) return;

  addBotMessage(message, "user");
  form.reset();
  syncCheckoutTelegram(contact);

  sending = true;
  if (sendButton) {
    sendButton.disabled = true;
    sendButton.textContent = "Sending...";
  }

  try {
    const response = await fetch("/api/telegram/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, contact, message })
    });

    const payload = await response.json();
    if (!response.ok) {
      const detail = payload.error || "Send failed";
      if (response.status === 503) {
        throw new Error("Telegram is not configured on the server yet. Try again later or use the checkout form.");
      }
      throw new Error(detail);
    }

    addBotMessage("Sent — we'll reply on Telegram as soon as we can.");
  } catch (error) {
    addBotMessage(error.message || "Could not send right now. Try again shortly.");
  } finally {
    sending = false;
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.textContent = "Send";
    }
  }
});

window.initTelegramBot = initTelegramBot;
window.addBotMessage = addBotMessage;
