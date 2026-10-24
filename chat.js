/**
 * DTD Community Chat — Twitter-style feed using Telegram @usernames.
 * Bridges: Telegram bot/channel + WhatsApp channel/share.
 */

const SESSION_KEY = "dtd_chat_session_v1";
const POLL_MS = 25_000;

const TAB_QUERY = {
  latest: "",
  premium: "&premium=true",
  top: "&sort=top",
  channels: "&source=channel",
  calls: ""
};

const EMOJIS = [
  "😀","😂","😅","😍","🥰","😎","🤔","🤩","🙃","😇",
  "😭","😤","🥳","🤯","🫡","👍","👎","👏","🙏","💪",
  "🔥","✨","💯","🎉","🤑","💎","🚀","📈","💰","🏆",
  "💚","❤️","💙","💛","💜","⚡","☕","🍀","🌙","⭐",
  "🤝","🧠","🎯","✅","❌","🔒","🔑","📦","🛒","📞",
  "🫠","🫣","🥹","🤗","🤭","🫢","😶‍🌫️","🥶","🤧","🤡",
  "👾","🤖","🦾","🦿","🫀","🫁","🧿","🪄","💫","🌠",
  "🪙","🧧","🥇","🥈","🥉","🛡️","🧲","🔮","🪬","🧬",
  "🫰","🫱","🫲","🤟","🤙","👌","🤌","💅","🫳","🫴",
  "🖤","🤍","🤎","🧡","💝","💖","🫧","🌊","🧊","🫶"
];

/** Render emoji as high-quality Twemoji images (consistent premium look). */
const EMOJI_SEG_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{20E3}|\u{200D}|\u{1F3FB}-\u{1F3FF}/u;

function twemojiImg(emoji) {
  const codepoints = [...emoji]
    .map((cp) => cp.codePointAt(0).toString(16))
    .join("-");
  return `<img class="twemoji" src="https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${codepoints}.png" alt="${escapeHtml(emoji)}" loading="lazy" decoding="async" />`;
}

function maskEmoji(raw) {
  const map = [];
  let text;
  try {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    let masked = "";
    for (const { segment } of segmenter.segment(String(raw || ""))) {
      if (EMOJI_SEG_RE.test(segment)) {
        const token = `\uE000\uE001${map.length}\uE000\uE001`;
        map.push({ token, emoji: segment });
        masked += token;
      } else {
        masked += segment;
      }
    }
    text = masked;
  } catch {
    text = String(raw || "");
  }
  return { text, map };
}

function restoreEmoji(html, map) {
  let out = html;
  for (const { token, emoji } of map) {
    out = out.split(token).join(twemojiImg(emoji));
  }
  return out;
}

const state = {
  token: "",
  user: null,
  messages: [],
  rails: null,
  claimCode: null,
  timer: null,
  booted: false,
  pendingMedia: null, // { file, previewUrl, mediaType, contentType, name }
  tab: "latest",
  search: "",
  peer: null,
  peerReady: false,
  activeCall: null, // { call, mediaStream, target }
  videoModalActive: false
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
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STORE_PAGES = new Set([
  "home",
  "products",
  "chat",
  "trade",
  "track",
  "smtp",
  "checkout",
  "telegram",
  "wallet",
  "admin"
]);

function isInternalHref(href) {
  try {
    const u = new URL(href, location.origin);
    if (u.origin === location.origin) return true;
    return /dtdpaymentsbot\.pages\.dev$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Turn plain text into safe HTML with @mentions, #pages, http(s) links, [text](url), **bold**, *italic* and premium emoji. */
function formatChatBody(raw) {
  const { text: maskedText, map } = maskEmoji(raw);
  const mdLinks = [];
  let text = maskedText.replace(
    /\[([^\]]{1,120})\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, t, u) => {
      mdLinks.push({ t, u });
      return `\u0001${mdLinks.length - 1}\u0001`;
    }
  );
  const re =
    /((?:https?:\/\/|www\.)[^\s<]+)|(\/#([\w-]+))|(#([\w-]+))|(@([A-Za-z0-9_]{3,32}))/gi;
  let out = "";
  let last = 0;
  let match;
  while ((match = re.exec(text))) {
    out += escapeHtml(text.slice(last, match.index)).replace(/\n/g, "<br>");
    if (match[1]) {
      let href = match[1];
      let shown = match[1];
      let trail = "";
      const trimmed = shown.replace(/[),.!?;:'"]+$/g, (t) => {
        trail = t;
        return "";
      });
      shown = trimmed;
      href = trimmed.startsWith("www.") ? `https://${trimmed}` : trimmed;
      const internal = isInternalHref(href);
      out += `<a class="chat-link ${internal ? "is-internal" : "is-external"}" href="${escapeHtml(href)}"${
        internal ? "" : ' target="_blank" rel="noopener noreferrer"'
      }>${escapeHtml(shown)}</a>${escapeHtml(trail)}`;
    } else if (match[3] || match[5]) {
      const page = String(match[3] || match[5] || "").toLowerCase();
      if (STORE_PAGES.has(page)) {
        out += `<a class="chat-link is-internal" href="#${escapeHtml(page)}" data-nav="${escapeHtml(page)}">#${escapeHtml(page)}</a>`;
      } else {
        out += escapeHtml(match[0]);
      }
    } else if (match[7]) {
      const user = match[7];
      out += `<a class="chat-mention" href="#profile/${encodeURIComponent(user)}" data-profile="${escapeHtml(user)}">@${escapeHtml(user)}</a>`;
    } else {
      out += escapeHtml(match[0]);
    }
    last = match.index + match[0].length;
  }
  out += escapeHtml(text.slice(last)).replace(/\n/g, "<br>");

  out = out.replace(/\u0001(\d+)\u0001/g, (_m, i) => {
    const l = mdLinks[Number(i)];
    if (!l) return "";
    const internal = isInternalHref(l.u);
    return `<a class="chat-link ${internal ? "is-internal" : "is-external"}" href="${escapeHtml(l.u)}"${
      internal ? "" : ' target="_blank" rel="noopener noreferrer"'
    }>${escapeHtml(l.t)}</a>`;
  });

  return restoreEmoji(inlineFormat(out), map);
}

/** Convert **bold** and *italic* only outside of already-rendered tags. */
function inlineFormat(html) {
  return html
    .split(/(<[^>]+>)/)
    .map((seg) => {
      if (/^<[^>]+>$/.test(seg)) return seg;
      return seg
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    })
    .join("");
}

function avatarMarkup({ username, profileUrl, avatarUrl, userId }) {
  const letter = escapeHtml((username || "?").slice(0, 1).toUpperCase());
  const color = avatarColor(username);
  const href = escapeHtml(profileUrl || (username ? `#profile/${username}` : "#chat"));
  const src = avatarUrl || (userId ? `/api/chat/avatar?id=${userId}` : "");
  const internal = href.startsWith("#");
  if (src) {
    return `<a class="chat-avatar has-photo" href="${href}"${internal ? "" : ' target="_blank" rel="noopener noreferrer"'} data-letter="${letter}" style="--dtd-avatar:${color}"><img src="${escapeHtml(src)}" alt="" width="42" height="42" loading="lazy" decoding="async" /></a>`;
  }
  return `<a class="chat-avatar" href="${href}"${internal ? "" : ' target="_blank" rel="noopener noreferrer"'} style="--dtd-avatar:${color}">${letter}</a>`;
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
  const premium = Boolean(state.user?.isPremium ?? window.__dtdTelegramPremium);
  if (who) {
    who.innerHTML = state.user
      ? `@${state.user.username}${premium ? ' <span class="premium-badge">Premium</span>' : ""}`
      : premium
        ? `Guest <span class="premium-badge">Premium</span>`
        : "Guest";
  }
  if (form) form.hidden = !state.user;
  if (gate) {
    gate.hidden = Boolean(state.user);
    const tip = gate.querySelector("[data-premium-tip]");
    if (tip) {
      tip.hidden = !premium;
      tip.textContent = premium
        ? "Telegram Premium detected — you get a Premium badge on posts and priority desk tools."
        : "";
    }
  }
  const signOut = $("#chatSignOut");
  if (signOut) signOut.hidden = !state.user;
  const composeAvatar = $("#chatComposeAvatar");
  if (composeAvatar) {
    const letter = (state.user?.username || "?").slice(0, 1).toUpperCase();
    const photo = state.user?.photoUrl || (state.user?.id ? `/api/chat/avatar?id=${state.user.id}` : "");
    composeAvatar.style.setProperty("--dtd-avatar", avatarColor(state.user?.username || "?"));
    composeAvatar.dataset.letter = letter;
    if (photo) {
      composeAvatar.classList.add("has-photo");
      composeAvatar.innerHTML = `<img src="${escapeHtml(photo)}" alt="" width="42" height="42" />`;
      const img = composeAvatar.querySelector("img");
      img?.addEventListener("error", () => {
        composeAvatar.classList.remove("has-photo");
        composeAvatar.textContent = letter;
      });
    } else {
      composeAvatar.classList.remove("has-photo");
      composeAvatar.textContent = letter;
    }
  }
  if (state.user) ensurePeerListen().catch(() => {});
  else destroyPeer();
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
    <a class="chat-rail-btn is-tg" href="${escapeHtml(r.telegramChannelUrl || "")}" target="_blank" rel="noopener noreferrer">TG @${escapeHtml(r.telegramChannelUsername || "")}</a>
    ${wa}
  `;
}

function avatarColor(name) {
  const palette = ["#0f766e", "#14b8a6", "#0d9488", "#d97706", "#0891b2", "#334155"];
  const s = String(name || "?");
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

function isPlaceholderCaption(text) {
  return /^(shared a photo|shared a video|\u200b|\.)$/i.test(String(text || "").trim()) || !String(text || "").trim();
}

function hasRealCaption(m) {
  if (!m) return false;
  if (m.mediaUrl && isPlaceholderCaption(m.body)) return false;
  return Boolean(String(m.body || "").trim());
}

function mediaBlock(m) {
  if (!m.mediaUrl) return "";
  if (m.mediaType === "video") {
    return `<div class="chat-post-media is-video"><video src="${escapeHtml(m.mediaUrl)}" controls playsinline preload="metadata"></video></div>`;
  }
  return `<div class="chat-post-media is-image"><button type="button" class="chat-media-open" data-lightbox="${escapeHtml(m.mediaUrl)}" aria-label="Open image"><img src="${escapeHtml(m.mediaUrl)}" alt="" loading="lazy" decoding="async" /></button></div>`;
}

function renderFeed(targetSel = "#chatFeed", messages = null) {
  const feed = $(targetSel);
  const all = messages || state.messages;
  if (!feed) return;
  const q = state.search.trim().toLowerCase();
  const list = q
    ? all.filter(
        (m) =>
          String(m.body || "").toLowerCase().includes(q) ||
          String(m.displayName || "").toLowerCase().includes(q) ||
          String(m.username || "").toLowerCase().includes(q)
      )
    : all;
  if (!list.length) {
    feed.innerHTML = q
      ? `<article class="chat-empty"><strong>No matches</strong><span>Nothing found for “${escapeHtml(q)}” — try another keyword or clear the search.</span></article>`
      : `<article class="chat-empty">
      <strong>Quiet for now</strong>
      <span>Be the first to post text, a link, or a photo — anyone with Telegram sign-in can drop in.</span>
    </article>`;
    return;
  }
  feed.innerHTML = list
    .map((m) => {
      const caption = hasRealCaption(m) ? m.body : "";
      const shareLine = caption || (m.mediaUrl ? "New media on DTD Chat" : "");
      const shareTg = `https://t.me/share/url?url=${encodeURIComponent(location.origin + "/#chat")}&text=${encodeURIComponent(`@${m.username}: ${shareLine}`)}`;
      const shareWa = `https://wa.me/?text=${encodeURIComponent(`@${m.username} on DTD Store Chat:\n${shareLine}\n${location.origin}/#chat`)}`;
      const fullWhen = m.createdAt ? new Date(m.createdAt).toLocaleString() : "";
      const profileHref = escapeHtml(m.profileUrl || `#profile/${m.username}`);
      const isChannel = m.source === "channel";
      const canCall = state.user && m.username && String(m.username) !== String(state.user.username);
      return `<article class="chat-post dtd-post ${isChannel ? "is-channel" : ""}" data-id="${escapeHtml(m.id)}">
        ${avatarMarkup(m)}
        <div class="dtd-post-main">
          <header class="chat-post-head">
            <div class="chat-post-meta">
              <a class="chat-name" href="${profileHref}">${escapeHtml(m.displayName || m.username)}</a>
              ${m.premium ? `<span class="premium-badge" title="Telegram Premium">💎</span>` : ""}
              ${isChannel ? `<span class="channel-badge" title="Mirrored from the Telegram channel">📢</span>` : ""}
              <a class="chat-handle chat-mention" href="${profileHref}">@${escapeHtml(m.username)}</a>
              <span class="dtd-dot" aria-hidden="true">·</span>
              <time datetime="${escapeHtml(m.createdAt || "")}" title="${escapeHtml(fullWhen)}">${timeAgo(m.createdAt)}</time>
            </div>
          </header>
          ${caption ? `<p class="chat-post-body">${formatChatBody(caption)}</p>` : ""}
          ${mediaBlock(m)}
          <footer class="chat-post-actions">
            <button type="button" class="chat-action dtd-comments" data-comments="${escapeHtml(m.id)}" aria-expanded="false">Comment <span>${m.comments || 0}</span></button>
            ${canCall ? `<button type="button" class="chat-action dtd-call" data-call="${escapeHtml(m.username)}" title="Start a video call">📹 Call</button>` : ""}
            <a class="chat-action" href="${shareTg}" target="_blank" rel="noopener noreferrer">Share TG</a>
            <a class="chat-action" href="${shareWa}" target="_blank" rel="noopener noreferrer">Share WA</a>
            <button type="button" class="chat-action dtd-like ${m.liked ? "is-on" : ""}" data-like="${escapeHtml(m.id)}" ${state.user ? "" : "disabled"} aria-label="Like"><span class="dtd-heart" aria-hidden="true">♥</span> <span>${m.likes || 0}</span></button>
          </footer>
          <section class="chat-comments-section" data-comments-panel="${escapeHtml(m.id)}" hidden>
            <header class="chat-comments-head">
              <h3>Comments</h3>
              <p class="chat-comments-hint">Its own thread under this post — sign in with Telegram to reply.</p>
            </header>
            <div class="chat-comments-list" data-comments-list="${escapeHtml(m.id)}"><p class="chat-comments-loading">Loading…</p></div>
            <form class="chat-comment-form" data-comment-form="${escapeHtml(m.id)}" ${state.user ? "" : "hidden"}>
              <label class="sr-only" for="cmt-${escapeHtml(m.id)}">Write a comment</label>
              <textarea id="cmt-${escapeHtml(m.id)}" maxlength="2000" rows="2" placeholder="Write a comment…" required></textarea>
              <button type="submit" class="primary-button">Reply</button>
            </form>
            ${state.user ? "" : `<p class="chat-comments-gate">Sign in on Chat to comment.</p>`}
          </section>
        </div>
      </article>`;
    })
    .join("");

  feed.querySelectorAll("[data-like]").forEach((btn) => {
    btn.addEventListener("click", () => toggleLike(btn.getAttribute("data-like")));
  });
  feed.querySelectorAll("[data-call]").forEach((btn) => {
    btn.addEventListener("click", () => startVideoCall(btn.getAttribute("data-call")).catch(showErr));
  });
  feed.querySelectorAll("[data-comments]").forEach((btn) => {
    btn.addEventListener("click", () => toggleCommentsPanel(btn.getAttribute("data-comments")));
  });
  feed.querySelectorAll("[data-comment-form]").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const mid = form.getAttribute("data-comment-form");
      const input = form.querySelector("textarea");
      const text = input?.value?.trim() || "";
      if (!text) return;
      try {
        await postComment(mid, text);
        if (input) input.value = "";
      } catch (err) {
        showErr(err);
      }
    });
  });
  feed.querySelectorAll(".chat-avatar img").forEach((img) => {
    img.addEventListener("error", () => {
      const a = img.closest(".chat-avatar");
      img.remove();
      if (a) {
        a.classList.remove("has-photo");
        a.textContent = a.dataset.letter || "?";
      }
    });
  });
  feed.querySelectorAll("a.chat-link.is-internal[data-nav]").forEach((a) => {
    a.addEventListener("click", () => {
      const page = a.getAttribute("data-nav");
      if (page) document.querySelector(`[data-nav="${page}"]`)?.click?.();
    });
  });
  feed.querySelectorAll("[data-lightbox]").forEach((btn) => {
    btn.addEventListener("click", () => openLightbox(btn.getAttribute("data-lightbox")));
  });
  feed.querySelectorAll('a[href^="#profile/"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const href = (a.getAttribute("href") || "").replace(/^#/, "");
      if (typeof window.navigateToPage === "function") window.navigateToPage(href);
      else location.hash = href;
    });
  });
}

async function toggleCommentsPanel(messageId) {
  const panel = document.querySelector(`[data-comments-panel="${CSS.escape(messageId)}"]`);
  const btn = document.querySelector(`[data-comments="${CSS.escape(messageId)}"]`);
  if (!panel) return;
  const open = panel.hidden;
  panel.hidden = !open;
  if (btn) btn.setAttribute("aria-expanded", String(open));
  if (open) await loadComments(messageId);
}

async function loadComments(messageId) {
  const list = document.querySelector(`[data-comments-list="${CSS.escape(messageId)}"]`);
  if (!list) return;
  list.innerHTML = `<p class="chat-comments-loading">Loading…</p>`;
  try {
    const resp = await fetch(`/api/chat/comments?messageId=${encodeURIComponent(messageId)}`);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "Could not load comments");
    const comments = data.comments || [];
    if (!comments.length) {
      list.innerHTML = `<p class="chat-comments-empty">No comments yet — start the thread.</p>`;
      return;
    }
    list.innerHTML = comments
      .map(
        (c) => `<article class="chat-comment">
          ${avatarMarkup(c)}
          <div class="chat-comment-main">
            <header class="chat-comment-meta">
              <a class="chat-name" href="${escapeHtml(c.profileUrl || `#profile/${c.username}`)}">${escapeHtml(c.displayName || c.username)}</a>
              <a class="chat-handle" href="${escapeHtml(c.profileUrl || `#profile/${c.username}`)}">@${escapeHtml(c.username)}</a>
              <time>${timeAgo(c.createdAt)}</time>
            </header>
            <p class="chat-comment-body">${formatChatBody(c.body)}</p>
          </div>
        </article>`
      )
      .join("");
    list.querySelectorAll('a[href^="#profile/"]').forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const href = (a.getAttribute("href") || "").replace(/^#/, "");
        if (typeof window.navigateToPage === "function") window.navigateToPage(href);
        else location.hash = href;
      });
    });
  } catch (err) {
    list.innerHTML = `<p class="chat-comments-empty">${escapeHtml(err.message || "Failed")}</p>`;
  }
}

async function postComment(messageId, text) {
  if (!state.user) throw new Error("Sign in with Telegram to comment.");
  const resp = await fetch("/api/chat/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ messageId, body: text })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "Comment failed");
  const msg = state.messages.find((m) => m.id === messageId);
  if (msg) msg.comments = data.comments ?? Number(msg.comments || 0) + 1;
  const countEl = document.querySelector(`[data-comments="${CSS.escape(messageId)}"] span`);
  if (countEl) countEl.textContent = String(msg?.comments || data.comments || 0);
  await loadComments(messageId);
}

function openLightbox(src) {
  if (!src) return;
  let box = $("#chatLightbox");
  if (!box) {
    box = document.createElement("div");
    box.id = "chatLightbox";
    box.className = "chat-lightbox";
    box.hidden = true;
    box.innerHTML = `<button type="button" class="chat-lightbox-close" aria-label="Close">×</button><img alt="" />`;
    document.body.appendChild(box);
    box.addEventListener("click", (e) => {
      if (e.target === box || e.target.classList.contains("chat-lightbox-close")) closeLightbox();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeLightbox();
    });
  }
  const img = box.querySelector("img");
  if (img) img.src = src;
  box.hidden = false;
  document.body.classList.add("chat-lightbox-open");
}

function closeLightbox() {
  const box = $("#chatLightbox");
  if (box) box.hidden = true;
  document.body.classList.remove("chat-lightbox-open");
}

async function fetchFeed() {
  const status = $("#chatStatus");
  const feed = $("#chatFeed");
  const refresh = $("#chatRefresh");
  const tab = state.tab;
  if (tab === "calls") return;
  if (feed && !state.messages.length) {
    feed.innerHTML = `<article class="chat-empty chat-loading" aria-busy="true">Loading feed…</article>`;
  }
  if (refresh) {
    refresh.disabled = true;
    refresh.textContent = "Refreshing…";
  }
  try {
    const resp = await fetch(`/api/chat/messages?limit=50${TAB_QUERY[tab] || ""}`, {
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

async function uploadPendingMedia() {
  if (!state.pendingMedia?.file && !state.pendingMedia?.dataUrl) return null;

  // Prefer multipart FormData (works better for Telegram / large files)
  if (state.pendingMedia.file) {
    const form = new FormData();
    form.append("file", state.pendingMedia.file, state.pendingMedia.name || "media");
    const resp = await fetch("/api/chat/upload", {
      method: "POST",
      headers: { ...authHeaders() },
      body: form
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "Media upload failed");
    return { url: data.url, mediaType: data.mediaType || state.pendingMedia.mediaType };
  }

  const resp = await fetch("/api/chat/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      dataUrl: state.pendingMedia.dataUrl,
      contentType: state.pendingMedia.contentType
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "Media upload failed");
  return { url: data.url, mediaType: data.mediaType || state.pendingMedia.mediaType };
}

async function postMessage(text) {
  const status = $("#chatStatus");
  const postBtn = $("#chatPostBtn");
  let media = null;
  if (postBtn) postBtn.disabled = true;
  try {
    if (state.pendingMedia) {
      if (status) status.textContent = "Uploading media…";
      media = await uploadPendingMedia();
    }
    if (status) status.textContent = "Posting…";
    const resp = await fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        body: text,
        mediaUrl: media?.url || null,
        mediaType: media?.mediaType || null
      })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "Post failed");
    clearPendingMedia();
    state.messages = [data.message, ...state.messages];
    renderFeed();
    const first = $("#chatFeed .chat-post");
    first?.classList.add("is-fresh");
    if (status) {
      status.textContent = media
        ? "Posted — caption + media together, mirrored to Telegram."
        : "Posted — live on the feed and Telegram channel.";
      delete status.dataset.sticky;
    }
  } finally {
    if (postBtn) postBtn.disabled = false;
  }
}

function clearPendingMedia() {
  if (state.pendingMedia?.previewUrl) {
    try {
      URL.revokeObjectURL(state.pendingMedia.previewUrl);
    } catch {
      /* ignore */
    }
  }
  state.pendingMedia = null;
  const input = $("#chatMediaInput");
  if (input) input.value = "";
  const preview = $("#chatMediaPreview");
  if (preview) {
    preview.hidden = true;
    preview.innerHTML = "";
  }
}

function renderMediaPreview() {
  const preview = $("#chatMediaPreview");
  if (!preview) return;
  if (!state.pendingMedia) {
    preview.hidden = true;
    preview.innerHTML = "";
    return;
  }
  preview.hidden = false;
  const isVideo = state.pendingMedia.mediaType === "video";
  const src = state.pendingMedia.previewUrl || state.pendingMedia.dataUrl || "";
  preview.innerHTML = `
    <div class="chat-media-preview-inner">
      ${
        isVideo
          ? `<video src="${escapeHtml(src)}" muted playsinline controls></video>`
          : `<img src="${escapeHtml(src)}" alt="" />`
      }
      <button type="button" class="ghost-btn" id="chatMediaClear">Remove</button>
    </div>
  `;
  preview.querySelector("#chatMediaClear")?.addEventListener("click", () => clearPendingMedia());
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

async function onMediaPicked(file) {
  if (!file) return;
  const type = String(file.type || "");
  const name = String(file.name || "").toLowerCase();
  const looksImage = type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(name);
  const looksVideo = type.startsWith("video/") || /\.(mp4|webm|mov|m4v|avi)$/i.test(name);
  if (!looksImage && !looksVideo) {
    throw new Error("Only images or videos are allowed.");
  }
  if (file.size > 8_000_000) throw new Error("File too large (max ~8MB).");

  if (state.pendingMedia?.previewUrl) {
    try {
      URL.revokeObjectURL(state.pendingMedia.previewUrl);
    } catch {
      /* ignore */
    }
  }

  const mediaType = looksVideo && !looksImage ? "video" : type.startsWith("video/") ? "video" : "image";
  const previewUrl = URL.createObjectURL(file);
  state.pendingMedia = {
    file,
    previewUrl,
    contentType: type || (mediaType === "video" ? "video/mp4" : "image/jpeg"),
    mediaType,
    name: file.name || (mediaType === "video" ? "video.mp4" : "image.jpg")
  };
  renderMediaPreview();
  const status = $("#chatStatus");
  if (status) {
    status.textContent = `${mediaType === "video" ? "Video" : "Photo"} ready — add a caption (optional) and tap Post.`;
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

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll("#chatTabs .chat-tab").forEach((b) => {
    b.classList.toggle("is-on", b.getAttribute("data-chat-tab") === tab);
  });
  const feed = $("#chatFeed");
  const calls = $("#chatCallsPanel");
  const searchbar = $(".chat-searchbar");
  if (tab === "calls") {
    if (feed) feed.hidden = true;
    if (calls) calls.hidden = false;
    if (searchbar) searchbar.hidden = true;
    return;
  }
  if (feed) feed.hidden = false;
  if (calls) calls.hidden = true;
  if (searchbar) searchbar.hidden = false;
  state.messages = [];
  fetchFeed().catch(showErr);
}

function buildEmojiBar() {
  const bar = $("#chatEmojiBar");
  if (!bar || bar.dataset.built) return;
  bar.dataset.built = "1";
  bar.innerHTML = EMOJIS.map((e) => `<button type="button" class="chat-emoji" data-emoji="${escapeHtml(e)}" title="${escapeHtml(e)}">${twemojiImg(e)}</button>`).join("");
  bar.querySelectorAll("[data-emoji]").forEach((btn) => {
    btn.addEventListener("click", () => {
      insertAtCursor(btn.getAttribute("data-emoji"));
    });
  });
}

function insertAtCursor(text) {
  const input = $("#chatInput");
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const pos = start + text.length;
  input.selectionStart = pos;
  input.selectionEnd = pos;
  input.focus();
  updateCount();
}

function wrapSelection(before, after) {
  const input = $("#chatInput");
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const sel = input.value.slice(start, end) || "text";
  input.value = input.value.slice(0, start) + before + sel + after + input.value.slice(end);
  const pos = start + before.length;
  input.selectionStart = pos;
  input.selectionEnd = sel === "text" ? pos : pos + sel.length;
  input.focus();
  updateCount();
}

function toggleEmojiBar() {
  const bar = $("#chatEmojiBar");
  if (!bar) return;
  buildEmojiBar();
  bar.hidden = !bar.hidden;
}

function fmtAction(fmt) {
  if (fmt === "bold") wrapSelection("**", "**");
  else if (fmt === "italic") wrapSelection("*", "*");
  else if (fmt === "link") {
    const url = window.prompt("Paste a link (https://…):", "https://");
    if (!url) return;
    insertAtCursor(`[${"link"}](...)`.replace("link", url.replace(/^https?:\/\//, "")));
    const input = $("#chatInput");
    if (input) {
      const idx = input.value.lastIndexOf("(...)");
      if (idx >= 0) {
        input.selectionStart = idx + 1;
        input.selectionEnd = idx + 4;
        input.focus();
      }
    }
  } else if (fmt === "emoji") toggleEmojiBar();
}

async function submitCallRequest(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  const status = $("#callFormStatus");
  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());
  payload.telegram = String(payload.telegram || "").replace(/^@/, "").trim();
  if (btn) btn.disabled = true;
  if (status) status.textContent = "Sending…";
  try {
    const resp = await fetch("/api/call-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "Could not send request");
    if (status) {
      status.textContent = data.note || "Request sent — we’ll call you back shortly.";
      status.classList.add("is-ok");
    }
    form.reset();
  } catch (err) {
    if (status) {
      status.textContent = err.message || "Could not send request";
      status.classList.remove("is-ok");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Video chat (WebRTC via PeerJS, one-to-one by @username) ──────────────

function loadPeerJS() {
  return new Promise((resolve, reject) => {
    if (window.Peer) return resolve(window.Peer);
    const s = document.createElement("script");
    s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
    s.async = true;
    s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error("PeerJS failed to load.")));
    s.onerror = () => reject(new Error("Could not load video chat service. Check your connection."));
    document.head.appendChild(s);
  });
}

async function ensurePeerListen() {
  if (!state.user?.username) return;
  if (state.peer && state.peerReady) return;
  const Peer = await loadPeerJS();
  if (state.peer) return;
  const id = `dtd-vc-${String(state.user.username).toLowerCase()}`;
  const peer = new Peer(id);
  peer.on("open", () => {
    state.peerReady = true;
  });
  peer.on("call", (call) => {
    if (state.activeCall) {
      call.close();
      return;
    }
    const peerLabel = String(call.peer || "").replace(/^dtd-vc-/, "");
    openVideoModal(`Incoming call`, `@${peerLabel} wants to talk`);
    setVideoCallStatus(`@${peerLabel} is calling…`);
    const acceptBtn = $("#videoCallAccept");
    if (acceptBtn) acceptBtn.hidden = false;
    state.activeCall = { call, mediaStream: null, target: peerLabel, incoming: true };
    state.pendingIncoming = call;
  });
  peer.on("error", () => {});
  state.peer = peer;
}

function destroyPeer() {
  try {
    state.activeCall?.call?.close();
    state.activeCall?.mediaStream?.getTracks?.().forEach((t) => t.stop());
  } catch {}
  try {
    state.peer?.destroy();
  } catch {}
  state.peer = null;
  state.peerReady = false;
  state.activeCall = null;
  state.pendingIncoming = null;
}

function peerIdFor(username) {
  return `dtd-vc-${String(username).replace(/^@/, "").toLowerCase()}`;
}

function openVideoModal(title, sub) {
  const modal = $("#videoCallModal");
  if (!modal) return;
  modal.hidden = false;
  state.videoModalActive = true;
  document.body.classList.add("video-call-open");
  if (title) $("#videoCallTitle").textContent = title;
  if (sub) $("#videoCallSub").textContent = sub;
  setVideoCallStatus("");
}

function closeVideoModal() {
  const modal = $("#videoCallModal");
  if (modal) modal.hidden = true;
  state.videoModalActive = false;
  document.body.classList.remove("video-call-open");
  $("#videoCallRemote").srcObject = null;
  $("#videoCallLocal").srcObject = null;
  $("#videoCallRemote").classList.add("is-away");
  $("#videoCallLocal").classList.add("is-away");
  $("#videoCallMute").classList.remove("is-on");
  $("#videoCallCam").classList.remove("is-on");
}

function setVideoCallStatus(text) {
  const el = $("#videoCallStatus");
  if (el) el.textContent = text || "";
}

function hangUpVideo() {
  try {
    state.activeCall?.call?.close();
    state.activeCall?.mediaStream?.getTracks?.().forEach((t) => t.stop());
  } catch {}
  state.activeCall = null;
  state.pendingIncoming = null;
  const acceptBtn = $("#videoCallAccept");
  if (acceptBtn) acceptBtn.hidden = true;
  setVideoCallStatus("Call ended");
  setTimeout(closeVideoModal, 900);
}

async function startVideoCall(targetUsername) {
  if (!state.user) throw new Error("Sign in with Telegram to start a video call.");
  const target = String(targetUsername).replace(/^@/, "").toLowerCase();
  if (target === String(state.user.username).toLowerCase()) throw new Error("That’s you!");
  await ensurePeerListen();
  if (!state.peerReady) throw new Error("Video chat is still connecting — try again in a second.");
  const media = await navigator.mediaDevices
    .getUserMedia({ video: true, audio: true })
    .catch(() => { throw new Error("Camera/mic permission needed for video calls."); });
  openVideoModal(`Calling @${target}`, "Ringing…");
  const acceptBtn = $("#videoCallAccept");
  if (acceptBtn) acceptBtn.hidden = true;
  $("#videoCallLocal").srcObject = media;
  $("#videoCallLocal").classList.remove("is-away");
  const call = state.peer.call(peerIdFor(target), media);
  state.activeCall = { call, mediaStream: media, target, incoming: false };
  call.on("stream", (remote) => {
    const v = $("#videoCallRemote");
    v.srcObject = remote;
    v.classList.remove("is-away");
    $("#videoCallSub").textContent = `Connected to @${target}`;
    setVideoCallStatus("");
  });
  call.on("close", () => hangUpVideo());
  call.on("error", (err) => {
    const msg = String(err?.type || "");
    if (msg === "peer-unavailable") {
      setVideoCallStatus(`@${target} isn’t online right now.`);
      $("#videoCallSub").textContent = "No answer";
    } else {
      setVideoCallStatus("Call failed — check your connection.");
    }
    setTimeout(hangUpVideo, 2600);
  });
}

async function acceptIncomingCall() {
  const pending = state.pendingIncoming;
  if (!pending) return;
  const acceptBtn = $("#videoCallAccept");
  if (acceptBtn) acceptBtn.hidden = true;
  const media = await navigator.mediaDevices
    .getUserMedia({ video: true, audio: true })
    .catch(() => {
      setVideoCallStatus("Camera/mic permission needed.");
      return null;
    });
  if (!media) return;
  state.pendingIncoming = null;
  if (state.activeCall) state.activeCall.mediaStream = media;
  $("#videoCallLocal").srcObject = media;
  $("#videoCallLocal").classList.remove("is-away");
  pending.answer(media);
  pending.on("stream", (remote) => {
    const v = $("#videoCallRemote");
    v.srcObject = remote;
    v.classList.remove("is-away");
    $("#videoCallSub").textContent = `Connected to @${state.activeCall?.target || "peer"}`;
    setVideoCallStatus("");
  });
  pending.on("close", () => hangUpVideo());
  pending.on("error", () => hangUpVideo());
}

function bindUi() {
  $("#chatSignMini")?.addEventListener("click", () => signInMiniApp().catch(showErr));
  $("#chatLinkTg")?.addEventListener("click", () => startClaim().catch(showErr));
  $("#chatSignOut")?.addEventListener("click", () => {
    clearSession();
    syncComposer();
    fetchFeed();
  });

  document.querySelectorAll("#chatTabs .chat-tab").forEach((b) => {
    b.addEventListener("click", () => switchTab(b.getAttribute("data-chat-tab")));
  });
  const search = $("#chatSearch");
  if (search) {
    search.addEventListener("input", () => {
      state.search = search.value;
      renderFeed();
    });
  }

  document.querySelectorAll(".chat-fmt-btn").forEach((b) => {
    b.addEventListener("click", () => fmtAction(b.getAttribute("data-fmt")));
  });

  $("#chatCtaCall")?.addEventListener("click", () => switchTab("calls"));
  $("#callRequestForm")?.addEventListener("submit", submitCallRequest);

  $("#videoCallEnd")?.addEventListener("click", () => hangUpVideo());
  $("#videoCallAccept")?.addEventListener("click", () => acceptIncomingCall().catch(showErr));
  $("#videoCallMute")?.addEventListener("click", () => {
    const track = state.activeCall?.mediaStream?.getAudioTracks?.()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    $("#videoCallMute").classList.toggle("is-on", !track.enabled);
  });
  $("#videoCallCam")?.addEventListener("click", () => {
    const track = state.activeCall?.mediaStream?.getVideoTracks?.()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    $("#videoCallCam").classList.toggle("is-on", !track.enabled);
  });
  $("#videoCallModal")?.addEventListener("click", (e) => {
    if (e.target.id === "videoCallModal") hangUpVideo();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.videoModalActive) hangUpVideo();
  });

  $("#chatComposer")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#chatInput");
    const text = input?.value?.trim() || "";
    if (!text && !state.pendingMedia) {
      showErr(new Error("Write something or tap Photo / Video to attach media."));
      return;
    }
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

  const openPicker = () => {
    const input = $("#chatMediaInput");
    if (!input) {
      showErr(new Error("Media picker missing — refresh the page."));
      return;
    }
    input.value = "";
    input.click();
  };
  $("#chatAttachBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    openPicker();
  });
  $("#chatMediaInput")?.addEventListener("change", (e) => {
    const file = e.target?.files?.[0];
    onMediaPicked(file).catch(showErr);
  });

  // Paste image from clipboard into composer
  $("#chatInput")?.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file" && (item.type.startsWith("image/") || item.type.startsWith("video/"))) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          onMediaPicked(file).catch(showErr);
          break;
        }
      }
    }
  });
}

function updateCount() {
  const input = $("#chatInput");
  const count = $("#chatCharCount");
  if (!input || !count) return;
  const max = Number(input.getAttribute("maxlength") || 12000);
  const n = input.value.length;
  count.textContent = `${n}/${max}`;
  count.classList.toggle("is-warn", n >= max * 0.84);
  count.classList.toggle("is-hot", n >= max * 0.96);
  // auto-grow like a modern composer
  input.style.height = "auto";
  input.style.height = `${Math.min(280, Math.max(52, input.scrollHeight))}px`;
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

async function bootProfile(username) {
  loadSession();
  const uname = String(username || state.user?.username || "")
    .replace(/^@/, "")
    .trim();
  const status = $("#profileStatus");
  const feed = $("#profileFeed");
  const commentsEl = $("#profileComments");
  const title = $("#profileTitle");
  const sub = $("#profileSub");
  const avatar = $("#profileAvatar");
  const stats = $("#profileStats");
  const tgLink = $("#profileTgLink");

  if (!uname) {
    if (title) title.textContent = "Profiles";
    if (sub) sub.textContent = "Open any @username from Chat, or sign in then open Profiles again to see yours.";
    if (feed) {
      feed.innerHTML = `<article class="chat-empty"><strong>Pick a profile</strong><span>Tap an avatar or @handle in Chat, or sign in to view your own activity.</span></article>`;
    }
    if (commentsEl) commentsEl.innerHTML = "";
    if (stats) stats.innerHTML = "";
    return;
  }

  if (status) status.textContent = "Loading profile…";
  if (feed) feed.innerHTML = `<article class="chat-empty chat-loading">Loading…</article>`;

  try {
    const resp = await fetch(`/api/chat/profile?u=${encodeURIComponent(uname)}`, {
      headers: { ...authHeaders() }
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "Profile failed");
    const p = data.profile || {};
    if (title) title.textContent = p.displayName || `@${p.username}`;
    if (sub) sub.textContent = `@${p.username} · activity on DTD Store Chat`;
    if (tgLink) {
      tgLink.href = p.telegramUrl || `https://t.me/${p.username}`;
      tgLink.textContent = `Open @${p.username} on Telegram`;
    }
    if (avatar) {
      const letter = (p.username || "?").slice(0, 1).toUpperCase();
      avatar.style.setProperty("--dtd-avatar", avatarColor(p.username));
      avatar.dataset.letter = letter;
      if (p.avatarUrl) {
        avatar.classList.add("has-photo");
        avatar.innerHTML = `<img src="${escapeHtml(p.avatarUrl)}" alt="" width="88" height="88" />`;
        avatar.querySelector("img")?.addEventListener("error", () => {
          avatar.classList.remove("has-photo");
          avatar.textContent = letter;
        });
      } else {
        avatar.classList.remove("has-photo");
        avatar.textContent = letter;
      }
    }
    if (stats) {
      stats.innerHTML = `
        <div class="dtd-stat"><strong>${Number(p.stats?.posts || 0)}</strong><span>Posts</span></div>
        <div class="dtd-stat"><strong>${Number(p.stats?.likesReceived || 0)}</strong><span>Likes</span></div>
        <div class="dtd-stat"><strong>${Number(p.stats?.comments || 0)}</strong><span>Comments</span></div>
      `;
    }
    renderFeed("#profileFeed", data.messages || []);
    if (commentsEl) {
      const comments = data.comments || [];
      commentsEl.innerHTML = comments.length
        ? comments
            .map(
              (c) => `<article class="profile-comment-card">
                <p>${formatChatBody(c.body)}</p>
                <time>${timeAgo(c.createdAt)}</time>
              </article>`
            )
            .join("")
        : `<p class="chat-rail-hint">No comments yet from @${escapeHtml(p.username)}.</p>`;
    }
    if (status) status.textContent = "";
  } catch (err) {
    if (status) status.textContent = err.message || "Could not load profile";
    if (feed) feed.innerHTML = `<article class="chat-empty">Couldn’t load this profile.</article>`;
  }
}

export function onChatVisible() {
  const hash = (location.hash || "").replace(/^#/, "");
  if (hash === "chat") bootChat();
  if (hash === "profile" || hash.startsWith("profile/")) {
    const m = hash.match(/^profile\/(@?[A-Za-z0-9_]{3,32})$/i);
    bootProfile(m ? m[1] : state.user?.username || "");
  }
}

$("#profileRefresh")?.addEventListener("click", () => {
  const hash = (location.hash || "").replace(/^#/, "");
  const m = hash.match(/^profile\/(@?[A-Za-z0-9_]{3,32})$/i);
  bootProfile(m ? m[1] : state.user?.username || "").catch(showErr);
});

window.bootDtdChat = bootChat;
window.bootDtdProfile = bootProfile;
window.addEventListener("hashchange", onChatVisible);
document.addEventListener("DOMContentLoaded", onChatVisible);
onChatVisible();

