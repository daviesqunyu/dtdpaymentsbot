/**
 * DTD Community Chat — Twitter-style feed using Telegram @usernames.
 * Bridges: Telegram bot/channel + WhatsApp channel/share.
 */

const SESSION_KEY = "dtd_chat_session_v1";
const POLL_MS = 25_000;

const state = {
  token: "",
  user: null,
  messages: [],
  rails: null,
  claimCode: null,
  timer: null,
  booted: false
};

function $(sel) {
  return document.querySelector(sel);
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user) return;
    if (parsed.expiresAt && parsed.expiresAt < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    state.token = parsed.token;
    state.user = parsed.user;
  } catch {
    /* ignore */
  }
}

function saveSession(session) {
  state.token = session.token;
  state.user = session.user;
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      token: session.token,
      user: session.user,
      expiresAt: session.expiresAt || Date.now() + 14 * 864e5
    })
  );
}

function clearSession() {
  state.token = "";
  state.user = null;
  localStorage.removeItem(SESSION_KEY);
}

function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function telegramInitData() {
  try {
    return String(window.Telegram?.WebApp?.initData || "").trim();
  } catch {
    return "";
  }
}

function syncComposer() {
  const who = $("#chatWho");
  const form = $("#chatComposer");
  const gate = $("#chatAuthGate");
  if (who) {
    who.textContent = state.user ? `@${state.user.username}` : "Guest";
  }
  if (form) form.hidden = !state.user;
  if (gate) gate.hidden = Boolean(state.user);
  const signOut = $("#chatSignOut");
  if (signOut) signOut.hidden = !state.user;
}

function renderRails() {
  const el = $("#chatRails");
  if (!el || !state.rails) return;
  const r = state.rails;
  const wa = r.whatsappChannelUrl
    ? `<a class="chat-rail-btn is-wa" href="${escapeHtml(r.whatsappChannelUrl)}" target="_blank" rel="noopener noreferrer">WhatsApp channel</a>`
    : `<span class="chat-rail-hint">Set WHATSAPP_CHANNEL_URL to link your WhatsApp channel</span>`;
  el.innerHTML = `
    <a class="chat-rail-btn is-tg" href="${escapeHtml(r.telegramBotUrl || "https://t.me/DTDSTOREBOT")}" target="_blank" rel="noopener noreferrer">@${escapeHtml(r.telegramBotUsername || "DTDSTOREBOT")}</a>
    <a class="chat-rail-btn is-tg" href="${escapeHtml(r.telegramChannelUrl || "https://t.me/DTDMAINSTORE")}" target="_blank" rel="noopener noreferrer">TG @${escapeHtml(r.telegramChannelUsername || "DTDMAINSTORE")}</a>
    ${wa}
  `;
}

function renderFeed() {
  const feed = $("#chatFeed");
  if (!feed) return;
  if (!state.messages.length) {
    feed.innerHTML = `<article class="chat-empty">No posts yet — be the first @username on the feed.</article>`;
    return;
  }
  feed.innerHTML = state.messages
    .map((m) => {
      const shareTg = `https://t.me/share/url?url=${encodeURIComponent(location.origin + "/#chat")}&text=${encodeURIComponent(`@${m.username}: ${m.body}`)}`;
      const shareWa = `https://wa.me/?text=${encodeURIComponent(`@${m.username} on DTD Chat:\n${m.body}\n${location.origin}/#chat`)}`;
      return `<article class="chat-post" data-id="${escapeHtml(m.id)}">
        <header class="chat-post-head">
          <a class="chat-avatar" href="${escapeHtml(m.profileUrl)}" target="_blank" rel="noopener noreferrer" aria-hidden="true">${escapeHtml((m.username || "?").slice(0, 1).toUpperCase())}</a>
          <div class="chat-post-meta">
            <a class="chat-handle" href="${escapeHtml(m.profileUrl)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(m.username)}</a>
            <span class="chat-name">${escapeHtml(m.displayName)}</span>
            <time datetime="${escapeHtml(m.createdAt)}">${timeAgo(m.createdAt)}</time>
          </div>
        </header>
        <p class="chat-post-body">${escapeHtml(m.body)}</p>
        <footer class="chat-post-actions">
          <button type="button" class="chat-action ${m.liked ? "is-on" : ""}" data-like="${escapeHtml(m.id)}" ${state.user ? "" : "disabled"} aria-label="Like">♥ <span>${m.likes || 0}</span></button>
          <a class="chat-action" href="${shareTg}" target="_blank" rel="noopener noreferrer">TG</a>
          <a class="chat-action" href="${shareWa}" target="_blank" rel="noopener noreferrer">WA</a>
        </footer>
      </article>`;
    })
    .join("");

  feed.querySelectorAll("[data-like]").forEach((btn) => {
    btn.addEventListener("click", () => toggleLike(btn.getAttribute("data-like")));
  });
}

async function fetchFeed() {
  const status = $("#chatStatus");
  const feed = $("#chatFeed");
  const refresh = $("#chatRefresh");
  if (feed && !state.messages.length) {
    feed.innerHTML = `<article class="chat-empty chat-loading" aria-busy="true">Loading feed…</article>`;
  }
  if (refresh) {
    refresh.disabled = true;
    refresh.textContent = "Refreshing…";
  }
  try {
    const resp = await fetch("/api/chat/messages?limit=50", {
      headers: { ...authHeaders() }
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    state.messages = data.messages || [];
    state.rails = data.rails || state.rails;
    renderRails();
    renderFeed();
    if (status && !status.dataset.sticky) status.textContent = "";
  } catch (err) {
    if (status) {
      status.textContent = err.message || "Could not load chat";
      status.dataset.sticky = "1";
    }
    if (feed && !state.messages.length) {
      feed.innerHTML = `<article class="chat-empty">Couldn’t load the feed. Tap Refresh to try again.</article>`;
    }
  } finally {
    if (refresh) {
      refresh.disabled = false;
      refresh.textContent = "Refresh";
    }
  }
}

async function signInMiniApp() {
  const status = $("#chatStatus");
  const initData = telegramInitData();
  if (!initData) {
    if (status) {
      status.textContent = "Open this page from @DTDSTOREBOT Mini App, or use Link Telegram below.";
      status.dataset.sticky = "1";
    }
    return;
  }
  if (status) {
    status.textContent = "Signing in…";
    delete status.dataset.sticky;
  }
  const resp = await fetch("/api/chat/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "miniapp", initData })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "Sign-in failed");
  saveSession(data);
  syncComposer();
  if (status) status.textContent = `Signed in as @${data.user.username}`;
  await fetchFeed();
}

async function startClaim() {
  const status = $("#chatStatus");
  const box = $("#chatClaimBox");
  const resp = await fetch("/api/chat/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start_claim" })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "Could not start link");
  state.claimCode = data.code;
  if (box) {
    box.hidden = false;
    box.innerHTML = `
      <p>Send this in <a href="${escapeHtml(data.deepLink)}" target="_blank" rel="noopener noreferrer">@DTDSTOREBOT</a>:</p>
      <p class="chat-code"><code>/chatsign ${escapeHtml(data.code)}</code></p>
      <button type="button" class="primary-button" id="chatClaimDone">I've sent it — finish</button>
    `;
    box.querySelector("#chatClaimDone")?.addEventListener("click", () => finishClaim().catch(showErr));
  }
  if (status) {
    status.textContent = data.instruction || "Complete the code in Telegram.";
    status.dataset.sticky = "1";
  }
}

async function finishClaim() {
  const status = $("#chatStatus");
  if (!state.claimCode) throw new Error("Generate a link code first.");
  const resp = await fetch("/api/chat/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete_claim", code: state.claimCode })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "Link not ready yet");
  saveSession(data);
  syncComposer();
  const box = $("#chatClaimBox");
  if (box) box.hidden = true;
  if (status) {
    status.textContent = `Linked @${data.user.username}`;
    delete status.dataset.sticky;
  }
  await fetchFeed();
}

async function postMessage(text) {
  const status = $("#chatStatus");
  const resp = await fetch("/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ body: text })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "Post failed");
  state.messages = [data.message, ...state.messages];
  renderFeed();
  if (status) {
    status.textContent = "Posted — mirrored to Telegram when channel mirror is on.";
    delete status.dataset.sticky;
  }
}

async function toggleLike(id) {
  if (!state.user) return;
  const resp = await fetch("/api/chat/like", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ messageId: id })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) return;
  const msg = state.messages.find((m) => m.id === id);
  if (msg) {
    msg.liked = data.liked;
    msg.likes = data.likes;
    renderFeed();
  }
}

function showErr(err) {
  const status = $("#chatStatus");
  if (status) {
    status.textContent = err?.message || String(err);
    status.dataset.sticky = "1";
  }
}

function bindUi() {
  $("#chatSignMini")?.addEventListener("click", () => signInMiniApp().catch(showErr));
  $("#chatLinkTg")?.addEventListener("click", () => startClaim().catch(showErr));
  $("#chatSignOut")?.addEventListener("click", () => {
    clearSession();
    syncComposer();
    fetchFeed();
  });
  $("#chatComposer")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#chatInput");
    const text = input?.value?.trim() || "";
    if (!text) return;
    try {
      await postMessage(text);
      if (input) input.value = "";
      updateCount();
    } catch (err) {
      showErr(err);
    }
  });
  $("#chatInput")?.addEventListener("input", updateCount);
  $("#chatRefresh")?.addEventListener("click", () => fetchFeed().catch(showErr));
}

function updateCount() {
  const input = $("#chatInput");
  const count = $("#chatCharCount");
  if (!input || !count) return;
  count.textContent = `${input.value.length}/500`;
}

function startPolling() {
  stopPolling();
  state.timer = setInterval(() => {
    if ((location.hash || "").replace(/^#/, "") === "chat") fetchFeed().catch(() => {});
  }, POLL_MS);
}

function stopPolling() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

export function bootChat() {
  if (state.booted) {
    fetchFeed().catch(showErr);
    return;
  }
  const root = $("#chat");
  if (!root) return;
  state.booted = true;
  loadSession();
  bindUi();
  syncComposer();
  updateCount();
  fetchFeed()
    .then(() => {
      if (!state.user && telegramInitData()) {
        return signInMiniApp().catch(() => {});
      }
    })
    .catch(showErr);
  startPolling();
}

export function onChatVisible() {
  const hash = (location.hash || "").replace(/^#/, "");
  if (hash === "chat") bootChat();
}

window.bootDtdChat = bootChat;
window.addEventListener("hashchange", onChatVisible);
document.addEventListener("DOMContentLoaded", onChatVisible);
onChatVisible();
