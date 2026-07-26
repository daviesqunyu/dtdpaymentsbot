/**
 * SMTP + SMS console UI (store #smtp page).
 * Email: To + subject + body → VPS Postfix.
 * SMS: phone numbers → VPS worker (Telegram bot = control/notify only).
 * Admin unlock uses the same Supabase email/password as admin.html.
 */
(function () {
  const TOKEN_KEY = "dtd_smtp_token";
  const META_KEY = "dtd_smtp_meta";
  const GW_KEY = "dtd_smsgate";

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    meta: null,
    adminJwt: ""
  };

  try {
    state.meta = JSON.parse(localStorage.getItem(META_KEY) || "null");
  } catch {
    state.meta = null;
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function getSb() {
    return window.supabaseClient || (typeof supabaseClient !== "undefined" ? supabaseClient : null);
  }

  function normalizePhoneClient(raw) {
    let value = String(raw || "").trim();
    if (!value) return null;
    const hadPlus = value.startsWith("+") || value.startsWith("00");
    let digits = value.replace(/\D/g, "");
    if (!digits) return null;
    if (digits.startsWith("00")) digits = digits.slice(2);
    const cc = "254";
    let phone;
    if (digits.startsWith(cc) && digits.length >= cc.length + 7) phone = `+${digits}`;
    else if (digits.startsWith("0") && digits.length >= 9) phone = `+${cc}${digits.slice(1)}`;
    else if (!hadPlus && digits.length >= 7 && digits.length <= 10) phone = `+${cc}${digits}`;
    else if (digits.length >= 8 && digits.length <= 15) phone = `+${digits}`;
    else return null;
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null;
    return phone;
  }

  function parseList(raw, kind) {
    const seen = new Set();
    const valid = [];
    if (kind === "email") {
      const parts = String(raw || "")
        .split(/[\n\r,;\s]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      for (const part of parts) {
        const key = part.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) valid.push(part);
      }
      return valid;
    }

    // Phones: split on newline / comma / semicolon only (keep spaces inside a number)
    const parts = String(raw || "")
      .split(/[\n\r,;|]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const part of parts) {
      const phone = normalizePhoneClient(part);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      valid.push(phone);
    }
    return valid;
  }

  function setUnlocked(meta, token) {
    state.token = token;
    state.meta = meta;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(META_KEY, JSON.stringify(meta || {}));
    renderSession({ refreshHistory: true });
  }

  function lockConsole() {
    state.token = "";
    state.meta = null;
    state.adminJwt = "";
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(META_KEY);
    renderSession();
  }

  function renderBadges() {
    const badges = $("#smtpConfigBadges");
    if (!badges) return;
    const mailOk = state.meta?.mailerConfigured !== false;
    const smsOk = state.meta?.smsConfigured !== false;
    badges.innerHTML = `
      <span class="smtp-badge ${mailOk ? "ok" : "warn"}">Email VPS ${mailOk ? "ready" : "unset"}</span>
      <span class="smtp-badge ${smsOk ? "ok" : "warn"}">SMS VPS ${smsOk ? "ready" : "unset"}</span>
    `;
  }

  function renderSession(opts = {}) {
    const lockPanel = $("#smtpLockPanel");
    const consoleEl = $("#smtpConsole");
    if (!lockPanel || !consoleEl) return;

    const unlocked = Boolean(state.token);
    lockPanel.hidden = unlocked;
    consoleEl.hidden = !unlocked;
    if (!unlocked) return;

    const from = state.meta?.from || "contact@dvtechnologies.xyz";
    const fromInput = $("#smtpFrom");
    if (fromInput) fromInput.value = from;
    const fromPhone = state.meta?.fromPhone || "";
    const phoneInput = $("#smtpFromPhone");
    if (phoneInput) phoneInput.value = fromPhone || "TELETHON_PHONE not set";

    const label = $("#smtpSessionLabel");
    if (label) {
      label.textContent =
        state.meta?.role === "admin"
          ? "Admin · premium access"
          : `Unlocked · ${state.meta?.email || "buyer"}`;
    }

    renderBadges();
    const smsBtn = $("#smtpSmsSendBtn");
    if (smsBtn) smsBtn.disabled = false;
    const setup = $("#smtpSmsSetup");
    if (setup) setup.hidden = false;

    if (opts.refreshHistory) refreshJobs();
  }

  async function api(path, { method = "GET", body, admin } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (state.token) headers["X-SMTP-Token"] = state.token;
    if (admin && state.adminJwt) headers.Authorization = `Bearer ${state.adminJwt}`;
    const response = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
  }

  async function unlockAsAdmin(jwt) {
    state.adminJwt = jwt;
    const unlocked = await api("/api/smtp/unlock", {
      method: "POST",
      body: { mode: "admin" },
      admin: true
    });
    setUnlocked(unlocked, unlocked.token);
    return unlocked;
  }

  function switchTab(name) {
    document.querySelectorAll(".smtp-tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.smtpTab === name);
    });
    document.querySelectorAll(".smtp-tab-panel").forEach((panel) => {
      const active = panel.dataset.smtpPanel === name;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    if (name === "history") refreshJobs();
  }

  function updateEmailCount() {
    const form = $("#smtpEmailForm");
    const el = $("#smtpEmailCount");
    if (!form || !el) return;
    const to = parseList(form.to.value, "email");
    el.textContent = `${to.length} recipient${to.length === 1 ? "" : "s"}`;
  }

  function updateSmsCount() {
    const form = $("#smtpSmsForm");
    const el = $("#smtpSmsCount");
    if (!form || !el) return;
    const phones = parseList(form.to.value, "sms");
    const chars = String(form.text.value || "").length;
    el.textContent = `${phones.length} phone${phones.length === 1 ? "" : "s"} · ${chars}/1000 chars`;
  }

  async function refreshJobs() {
    const list = $("#smtpJobsList");
    if (!list || !state.token) return;
    list.innerHTML = `<p class="form-note">Loading…</p>`;
    try {
      const data = await api("/api/smtp/jobs");
      state.meta = {
        ...(state.meta || {}),
        from: data.from,
        fromPhone: data.fromPhone,
        limits: data.limits,
        smsConfigured: data.smsConfigured,
        mailerConfigured: data.mailerConfigured,
        role: data.role
      };
      localStorage.setItem(META_KEY, JSON.stringify(state.meta));
      const fromInput = $("#smtpFrom");
      if (fromInput && state.meta.from) fromInput.value = state.meta.from;
      const phoneInput = $("#smtpFromPhone");
      if (phoneInput) phoneInput.value = state.meta.fromPhone || "TELETHON_PHONE not set";
      renderBadges();

      if (!data.jobs?.length) {
        list.innerHTML = `<p class="form-note">No sends yet. After you send, status appears here (queued → sent).</p>`;
        return data.jobs || [];
      }
      list.innerHTML = data.jobs
        .map((job) => {
          const when = job.created_at ? new Date(job.created_at).toLocaleString() : "";
          const st = String(job.status || "queued").toLowerCase();
          return `<article class="smtp-job smtp-job-${escapeHtml(st)}">
            <div>
              <strong>${escapeHtml(job.channel)}</strong>
              <span class="smtp-job-status smtp-st-${escapeHtml(st)}">${escapeHtml(st)}</span>
            </div>
            <p>${escapeHtml(job.subject || job.body_preview || "—")}</p>
            <p class="form-note">${job.recipient_count || 0} recipients · ${escapeHtml(when)}${
              job.error ? ` · ${escapeHtml(job.error)}` : ""
            }</p>
          </article>`;
        })
        .join("");
      return data.jobs || [];
    } catch (error) {
      list.innerHTML = `<p class="form-note">${escapeHtml(error.message)}</p>`;
      if (/unlock|unauthor/i.test(error.message)) lockConsole();
      return [];
    }
  }

  async function waitForJob(jobId, statusEl, recipientCount, kind = "email") {
    if (!jobId) return;
    const deadline = Date.now() + 60000;
    statusEl.textContent = `Queued ${recipientCount} ${kind}… VPS delivering (see History)`;
    switchTab("history");
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const jobs = await refreshJobs();
      const job = (jobs || []).find((j) => j.id === jobId);
      if (!job) continue;
      if (job.status === "sent") {
        statusEl.textContent = `Sent to ${recipientCount}. Check History.`;
        return;
      }
      if (job.status === "failed" || job.status === "partial") {
        statusEl.textContent = `Delivery ${job.status}${job.error ? `: ${job.error}` : ""}. See History.`;
        return;
      }
      statusEl.textContent = `Status: ${job.status}… on VPS`;
    }
    statusEl.textContent = "Still delivering — refresh History in a few seconds.";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function tryResumeAdminSession(statusEl) {
    const sb = getSb();
    if (!sb || state.token) return;
    try {
      const { data } = await sb.auth.getSession();
      const jwt = data?.session?.access_token;
      if (!jwt) return;
      if (statusEl) statusEl.textContent = "Resuming admin session…";
      await unlockAsAdmin(jwt);
      if (statusEl) statusEl.textContent = "Admin unlocked (existing session).";
    } catch {
      /* stay on lock panel */
    }
  }

  function bind() {
    if (!$("#smtp")) return;

    const adminEmailInput = $("#smtpAdminEmail");
    if (adminEmailInput && !adminEmailInput.value) {
      adminEmailInput.value = "daviesqunyu@gmail.com";
      adminEmailInput.autocomplete = "username";
    }
    const adminPass = $("#smtpAdminPassword");
    if (adminPass) adminPass.autocomplete = "current-password";

    const adminBox = $("#smtpAdminLogin");
    if (adminBox) adminBox.hidden = false;

    $("#smtpUnlockForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const status = $("#smtpUnlockStatus");
      status.textContent = "Checking…";
      try {
        const data = await api("/api/smtp/unlock", {
          method: "POST",
          body: {
            mode: "order",
            orderId: form.orderId.value.trim(),
            email: form.email.value.trim()
          }
        });
        setUnlocked(data, data.token);
        status.textContent = "Unlocked.";
      } catch (error) {
        status.textContent = error.message;
      }
    });

    $("#smtpAdminUnlock")?.addEventListener("click", () => {
      const box = $("#smtpAdminLogin");
      if (box) box.hidden = !box.hidden;
    });

    $("#smtpAdminSignIn")?.addEventListener("click", async () => {
      const status = $("#smtpUnlockStatus");
      const btn = $("#smtpAdminSignIn");
      const email = ($("#smtpAdminEmail")?.value || "").trim();
      const password = $("#smtpAdminPassword")?.value || "";
      const sb = getSb();
      if (!sb) {
        status.textContent = "Supabase client missing — refresh the page.";
        return;
      }
      if (!email || !password) {
        status.textContent = "Enter the same admin email and password as Admin.";
        return;
      }
      status.textContent = "Signing in…";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Unlocking…";
      }
      try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const jwt = data.session?.access_token || "";
        if (!jwt) throw new Error("No session token returned.");
        await unlockAsAdmin(jwt);
        status.textContent = "Admin unlocked.";
        if ($("#smtpAdminPassword")) $("#smtpAdminPassword").value = "";
      } catch (error) {
        status.textContent = error.message || "Admin unlock failed.";
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Sign in & unlock";
        }
      }
    });

    $("#smtpAdminPassword")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        $("#smtpAdminSignIn")?.click();
      }
    });

    $("#smtpLockBtn")?.addEventListener("click", lockConsole);

    document.querySelectorAll(".smtp-tab").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.smtpTab));
    });

    const emailForm = $("#smtpEmailForm");
    emailForm?.addEventListener("input", updateEmailCount);
    emailForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = $("#smtpEmailStatus");
      const btn = emailForm.querySelector('button[type="submit"]');
      const to = parseList(emailForm.to.value, "email");
      if (!to.length) {
        status.textContent = "Add at least one To address.";
        return;
      }
      status.textContent = "Queuing…";
      btn.disabled = true;
      try {
        const data = await api("/api/smtp/send-email", {
          method: "POST",
          body: {
            to: emailForm.to.value,
            subject: emailForm.subject.value,
            text: emailForm.text.value
          }
        });
        emailForm.reset();
        if ($("#smtpFrom") && state.meta?.from) $("#smtpFrom").value = state.meta.from;
        updateEmailCount();
        if (data.delivered) {
          status.textContent = data.message || `Delivered to ${data.sent} recipient(s).`;
          switchTab("history");
          await refreshJobs();
        } else {
          await waitForJob(data.jobId, status, data.sent, "email");
        }
      } catch (error) {
        status.textContent = error.message;
      } finally {
        btn.disabled = false;
      }
    });

    const smsForm = $("#smtpSmsForm");
    // Restore free SMSGate inputs
    try {
      const gw = JSON.parse(localStorage.getItem(GW_KEY) || "null");
      if (gw && smsForm) {
        if (gw.user && smsForm.gwUser) smsForm.gwUser.value = gw.user;
        if (gw.pass && smsForm.gwPass) smsForm.gwPass.value = gw.pass;
        if (gw.url && smsForm.gwUrl) smsForm.gwUrl.value = gw.url;
      }
    } catch {
      /* ignore */
    }
    smsForm?.addEventListener("input", updateSmsCount);
    smsForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = $("#smtpSmsStatus");
      const btn = $("#smtpSmsSendBtn");
      const phones = parseList(smsForm.to.value, "sms");
      if (!phones.length) {
        status.textContent =
          "No usable phones found. Paste one number per line (e.g. 0712345678 or +254712345678).";
        return;
      }
      const gwUser = (smsForm.gwUser?.value || "").trim();
      const gwPass = (smsForm.gwPass?.value || "").trim();
      const gwUrl = (smsForm.gwUrl?.value || "").trim();
      if (!gwUser || !gwPass) {
        status.textContent =
          "Enter SMSGate username + password (free Android app, Cloud mode) to send real SMS.";
        return;
      }
      localStorage.setItem(GW_KEY, JSON.stringify({ user: gwUser, pass: gwPass, url: gwUrl }));
      status.textContent = `Queuing ${phones.length} real SMS…`;
      btn.disabled = true;
      try {
        const body = {
          to: phones.join("\n"),
          text: smsForm.text.value,
          gwUser,
          gwPass,
          gwUrl
        };
        const data = await api("/api/smtp/send-sms", {
          method: "POST",
          body
        });
        smsForm.to.value = phones.join("\n");
        smsForm.text.value = "";
        updateSmsCount();
        status.textContent = data.message || `Queued ${phones.length}.`;
        await waitForJob(data.jobId, status, data.sent, "SMS");
      } catch (error) {
        status.textContent = error.message;
      } finally {
        btn.disabled = false;
      }
    });

    $("#smtpRefreshJobs")?.addEventListener("click", refreshJobs);

    const params = new URLSearchParams(location.search);
    const orderId = params.get("smtpOrder") || params.get("orderId");
    const email = params.get("smtpEmail") || params.get("email");
    const unlockForm = $("#smtpUnlockForm");
    if (unlockForm && orderId) unlockForm.orderId.value = orderId;
    if (unlockForm && email) unlockForm.email.value = email;

    renderSession({ refreshHistory: Boolean(state.token) });
    updateEmailCount();
    updateSmsCount();
    tryResumeAdminSession($("#smtpUnlockStatus"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
