const toggleButton = document.querySelector("#telegramBotToggle");
const panel = document.querySelector("#telegramBotPanel");
const closeButton = document.querySelector("#telegramBotClose");
const form = document.querySelector("#telegramBotForm");
const messages = document.querySelector("#telegramBotMessages");
const openTelegramLink = document.querySelector("#openTelegramLink");
const sendButton = form?.querySelector('button[type="submit"]');

let botConfig = { telegramEnabled: false, telegramBotUsername: "", telegramBotUrl: "" };
let sending = false;
let conversationHistory = [];
let visitorMeta = { ip: "", userAgent: navigator.userAgent, pageUrl: window.location.href };

// Silently capture visitor IP on page load
(async () => {
  try {
    const res = await fetch("/api/visitor");
    if (res.ok) {
      const data = await res.json();
      visitorMeta.ip = data.ip || "";
    }
  } catch {}
})();

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

function formatMessageText(text) {
  const escaped = escapeHTML(text);
  // Convert **bold** to <strong>bold</strong>
  const boldConverted = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Convert * bullet to bullet
  const bulletConverted = boldConverted.replace(/^\s*\*\s+(.*?)$/gm, '• $1');
  // Convert newlines to <br>
  return bulletConverted.replace(/\n/g, '<br>');
}

function addBotMessage(text, type = "bot") {
  const bubble = document.createElement("div");
  bubble.className = `bot-message ${type}`;
  bubble.innerHTML = formatMessageText(text);
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

  const username = botConfig.telegramBotUsername
    ? `@${String(botConfig.telegramBotUsername).replace(/^@/, "")}`
    : "@DTDSTOREBOT";

  const botUrl = botConfig.telegramBotUrl || `https://t.me/DTDSTOREBOT`;
  if (botUrl) {
    openTelegramLink.href = botUrl;
    openTelegramLink.hidden = false;
    openTelegramLink.textContent = `Message ${username}`;
  } else {
    openTelegramLink.hidden = true;
  }

  // Update header bot name
  const headerStrong = document.querySelector(".telegram-bot-header strong");
  if (headerStrong) headerStrong.textContent = "DTD Assistant";
  const headerSpan = document.querySelector(".telegram-bot-header span");
  if (headerSpan) headerSpan.textContent = `Powered by ${username}`;

  if (!messages.dataset.booted) {
    messages.dataset.booted = "1";
    addBotMessage("Hi — I'm the DTD Store assistant. Ask about products, payments, or your order.");
    if (botConfig.telegramEnabled) {
      addBotMessage(`Your messages go straight to our team on Telegram (${username}).`);
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
  conversationHistory.push({ role: "user", text: message });
  if (conversationHistory.length > 10) {
    conversationHistory.shift();
  }

  // Reset only the message field
  form.querySelector('textarea[name="message"]').value = "";
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
      body: JSON.stringify({
        name,
        contact,
        message,
        history: conversationHistory,
        visitorIp: visitorMeta.ip,
        userAgent: visitorMeta.userAgent,
        pageUrl: visitorMeta.pageUrl
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      const detail = payload.error || "Send failed";
      if (response.status === 503) {
        throw new Error("Telegram is not configured on the server yet. Try again later or use the checkout form.");
      }
      throw new Error(detail);
    }

    const reply = payload.reply || "Sent — we'll reply on Telegram as soon as we can.";
    addBotMessage(reply, "bot");
    
    conversationHistory.push({ role: "model", text: reply });
    if (conversationHistory.length > 10) {
      conversationHistory.shift();
    }
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

// Called by app.js after a successful order to push data into the bot panel
window.notifyBotOrderSuccess = function(orderId, email, total, items) {
  const itemList = Array.isArray(items) ? items.map(i => `• ${i.product_name} ×${i.quantity}`).join("\n") : "";
  addBotMessage(
    `✅ **Order #${orderId} placed!**\n` +
    `💵 Total: $${Number(total || 0).toFixed(2)} USD\n` +
    (itemList ? itemList + "\n" : "") +
    `📧 Confirmation sent to: ${email}\n` +
    `🌐 Your IP: ${visitorMeta.ip || "unavailable"}\n` +
    `Our team has been notified and will reach out via Telegram or Email shortly.`,
    "bot"
  );
};

// Expose visitorMeta so app.js can include it in order POST body
window.getVisitorMeta = function() { return visitorMeta; };
