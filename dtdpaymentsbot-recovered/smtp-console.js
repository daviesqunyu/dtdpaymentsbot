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
  const OTP_WATCH_KEY = "dtd_otp_watch";
  const OTP_LABEL_KEY = "dtd_otp_label";

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    meta: null,
    adminJwt: "",
    otpTimer: null,
    otpListening: false
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
    const mailOk = state.meta?.mailerConfigured === true || state.meta?.queueConfigured === true;
    const smsOk = state.meta?.smsGatewayConfigured === true || state.meta?.smsConfigured === true;
    const from = state.meta?.from || "—";
    const q = state.meta?.queue || {};
    const sesPrimary = state.meta?.awsSesPrimary === true;
    const via = sesPrimary ? "AWS SES" : "Postfix queue";
    badges.innerHTML = `
      <span class="smtp-badge ${mailOk ? "ok" : "warn"}">${via} ${mailOk ? "ready" : "unset"}</span>
      <span class="smtp-badge ${smsOk ? "ok" : "warn"}">SMSGate ${smsOk ? "ready" : "needs login"}</span>
      <span class="smtp-badge">From ${escapeHtml(from)}</span>
      <span class="smtp-badge">Q ${Number(q.queued || 0)} · S ${Number(q.sending || 0)}</span>
    `;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
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
    if (phoneInput) phoneInput.value = fromPhone || "SIM via SMSGate app";

    const label = $("#smtpSessionLabel");
    if (label) {
      label.textContent =
        state.meta?.role === "admin"
          ? `Admin · @${state.meta?.ownerTelegram || "Glock7money"} · VPS Postfix`
          : `Unlocked · ${state.meta?.email || "buyer"}`;
    }

    const hint = $("#smtpDnsHint");
    if (hint) {
      hint.textContent = state.meta?.dnsHint
        ? `DNS: ${state.meta.dnsHint}`
        : "DNS: SPF + DKIM + PTR required for inbox placement.";
      hint.hidden = false;
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
    // Keep admin JWT on later calls when available (unlock + send + history).
    if ((admin || state.meta?.role === "admin") && state.adminJwt) {
      headers.Authorization = `Bearer ${state.adminJwt}`;
    }
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

  function setDeliveryStatus(text) {
    const historyStatus = $("#smtpHistoryStatus");
    if (historyStatus) historyStatus.textContent = text || "";
    const session = $("#smtpSessionLabel");
    if (session && text) session.dataset.delivery = text;
  }

  function formatInvalid(invalid) {
    if (!Array.isArray(invalid) || !invalid.length) return "";
    const sample = invalid.slice(0, 3).join(", ");
    const more = invalid.length > 3 ? ` (+${invalid.length - 3} more)` : "";
    return ` Skipped invalid: ${sample}${more}.`;
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
    if (name === "otp") {
      syncOtpGatewayFromSms();
      refreshOtpInbox();
      startOtpPoll();
    } else {
      stopOtpPoll();
    }
  }

  function syncOtpGatewayFromSms() {
    const sms = $("#smtpSmsForm");
    const otpUser = $("#smtpOtpGwUser");
    const otpPass = $("#smtpOtpGwPass");
    const otpUrl = $("#smtpOtpGwUrl");
    try {
      const gw = JSON.parse(localStorage.getItem(GW_KEY) || "null");
      if (gw) {
        if (otpUser && !otpUser.value && gw.user) otpUser.value = gw.user;
        if (otpPass && !otpPass.value && gw.pass) otpPass.value = gw.pass;
        if (otpUrl && gw.url) otpUrl.value = gw.url;
      }
    } catch {
      /* ignore */
    }
    if (sms) {
      if (otpUser && !otpUser.value && sms.gwUser?.value) otpUser.value = sms.gwUser.value;
      if (otpPass && !otpPass.value && sms.gwPass?.value) otpPass.value = sms.gwPass.value;
      if (otpUrl && sms.gwUrl?.value) otpUrl.value = sms.gwUrl.value;
    }
    const watch = $("#smtpOtpWatch");
    const label = $("#smtpOtpLabel");
    if (watch && !watch.value) watch.value = localStorage.getItem(OTP_WATCH_KEY) || "";
    if (label && !label.value) label.value = localStorage.getItem(OTP_LABEL_KEY) || "";
  }

  function otpGatewayBody() {
    const gwUser = ($("#smtpOtpGwUser")?.value || "").trim();
    const gwPass = ($("#smtpOtpGwPass")?.value || "").trim();
    const gwUrl = ($("#smtpOtpGwUrl")?.value || "").trim();
    const phones = ($("#smtpOtpWatch")?.value || "").trim();
    const label = ($("#smtpOtpLabel")?.value || "").trim();
    localStorage.setItem(GW_KEY, JSON.stringify({ user: gwUser, pass: gwPass, url: gwUrl }));
    localStorage.setItem(OTP_WATCH_KEY, phones);
    localStorage.setItem(OTP_LABEL_KEY, label);
    return { gwUser, gwPass, gwUrl, phones, label };
  }

  function renderOtpList(items) {
    const list = $("#smtpOtpList");
    if (!list) return;
    if (!items?.length) {
      list.innerHTML = `<p class="form-note">No OTPs yet. Start receiving, then trigger a login/OTP to the SIM on your SMSGate phone.</p>`;
      return;
    }
    list.innerHTML = items
      .map((row) => {
        const when = row.receivedAt || row.createdAt || "";
        const whenLabel = when ? new Date(when).toLocaleString() : "";
        const code = row.otp ? escapeHtml(row.otp) : "—";
        const hasCode = Boolean(row.otp);
        return `<article class="smtp-otp-card ${hasCode ? "has-code" : ""}">
          <div class="smtp-otp-code-row">
            <span class="smtp-otp-code">${code}</span>
            ${
              hasCode
                ? `<button type="button" class="smtp-ghost-btn smtp-otp-copy" data-otp="${escapeHtml(row.otp)}">Copy</button>`
                : ""
            }
          </div>
          <p><strong>From</strong> ${escapeHtml(row.sender || "—")} · <strong>To</strong> ${escapeHtml(row.recipient || "—")}</p>
          <p class="smtp-otp-msg">${escapeHtml(row.message || "")}</p>
          <p class="form-note">${escapeHtml(whenLabel)}</p>
        </article>`;
      })
      .join("");
    list.querySelectorAll("[data-otp]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const value = btn.getAttribute("data-otp") || "";
        try {
          await navigator.clipboard.writeText(value);
          btn.textContent = "Copied";
          setTimeout(() => {
            btn.textContent = "Copy";
          }, 1200);
        } catch {
          btn.textContent = "Failed";
        }
      });
    });
  }

  async function refreshOtpInbox() {
    const status = $("#smtpOtpStatus");
    const live = $("#smtpOtpLive");
    if (!state.token) return;
    try {
      const watch = ($("#smtpOtpWatch")?.value || "").trim();
      const q = watch ? `?watch=${encodeURIComponent(watch)}&limit=40` : "?limit=40";
      const data = await api(`/api/smtp/otp${q}`);
      renderOtpList(data.items || []);
      if (live) live.textContent = state.otpListening ? "Listening…" : `${(data.items || []).length} messages`;
    } catch (error) {
      if (status) status.textContent = error.message;
    }
  }

  function startOtpPoll() {
    stopOtpPoll();
    state.otpTimer = setInterval(() => {
      if (state.token) refreshOtpInbox();
    }, 8000);
  }

  function stopOtpPoll() {
    if (state.otpTimer) {
      clearInterval(state.otpTimer);
      state.otpTimer = null;
    }
  }

  async function otpAction(action) {
    const status = $("#smtpOtpStatus");
    const live = $("#smtpOtpLive");
    const { gwUser, gwPass, gwUrl, phones, label } = otpGatewayBody();
    if (!gwUser || !gwPass) {
      if (status) status.textContent = "Enter SMSGate username + password (same as SMS tab).";
      return;
    }
    if (status) status.textContent = action === "listen" ? "Starting listener…" : "Working…";
    try {
      const data = await api("/api/smtp/otp", {
        method: "POST",
        body: {
          action,
          gwUser,
          gwPass,
          gwUrl,
          phones,
          label,
          pull: action === "listen",
          hours: 6
        }
      });
      if (action === "listen") state.otpListening = true;
      renderOtpList(data.items || []);
      if (status) status.textContent = data.message || "OK";
      if (live) live.textContent = state.otpListening ? "Listening…" : "Updated";
      startOtpPoll();
    } catch (error) {
      if (status) status.textContent = error.message;
    }
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
        ...data,
        from: data.from,
        fromPhone: data.fromPhone,
        limits: data.limits,
        smsConfigured: data.smsConfigured,
        smsGatewayConfigured: data.smsGatewayConfigured,
        mailerConfigured: data.mailerConfigured,
        queueConfigured: data.queueConfigured,
        queue: data.queue,
        dnsHint: data.dnsHint,
        ownerTelegram: data.ownerTelegram,
        role: data.role
      };
      localStorage.setItem(META_KEY, JSON.stringify(state.meta));
      const fromInput = $("#smtpFrom");
      if (fromInput && state.meta.from) fromInput.value = state.meta.from;
      const phoneInput = $("#smtpFromPhone");
      if (phoneInput) phoneInput.value = state.meta.fromPhone || "SIM via SMSGate app";
      renderBadges();
      const hint = $("#smtpDnsHint");
      if (hint && state.meta.dnsHint) {
        hint.textContent = `DNS: ${state.meta.dnsHint}`;
        hint.hidden = false;
      }

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
    const announce = (msg) => {
      if (statusEl) statusEl.textContent = msg;
      setDeliveryStatus(msg);
    };
    announce(`Queued ${recipientCount} ${kind}… VPS delivering`);
    switchTab("history");
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const jobs = await refreshJobs();
      const job = (jobs || []).find((j) => j.id === jobId);
      if (!job) continue;
      if (job.status === "sent") {
        announce(`Sent to ${recipientCount}.`);
        return;
      }
      if (job.status === "failed" || job.status === "partial") {
        announce(`Delivery ${job.status}${job.error ? `: ${job.error}` : ""}.`);
        return;
      }
      announce(`Status: ${job.status}… on VPS`);
    }
    announce("Still delivering — tap Refresh in a few seconds.");
  }

  async function tryResumeAdminSession(statusEl) {
    const sb = getSb();
    if (!sb || state.token) return;
    try {
      const { data } = await sb.auth.getSession();
      const jwt = data?.session?.access_token;
      if (!jwt) return;
      const details = document.querySelector(".smtp-staff-details");
      if (details) details.open = true;
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
        const invalidNote = formatInvalid(data.invalid);
        if (data.delivered) {
          const msg = (data.message || `Delivered to ${data.sent} recipient(s).`) + invalidNote;
          status.textContent = msg;
          setDeliveryStatus(msg);
          switchTab("history");
          await refreshJobs();
        } else {
          await waitForJob(data.jobId, status, data.sent, "email");
          if (invalidNote && status) status.textContent = (status.textContent || "") + invalidNote;
          if (invalidNote) setDeliveryStatus(($("#smtpHistoryStatus")?.textContent || "") + invalidNote);
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
        const invalidNote = formatInvalid(data.invalid);
        status.textContent = (data.message || `Queued ${phones.length}.`) + invalidNote;
        await waitForJob(data.jobId, status, data.sent, "SMS");
        if (invalidNote) setDeliveryStatus(($("#smtpHistoryStatus")?.textContent || "") + invalidNote);
      } catch (error) {
        status.textContent = error.message;
      } finally {
        btn.disabled = false;
      }
    });

    $("#smtpRefreshJobs")?.addEventListener("click", refreshJobs);

    $("#smtpOtpListenBtn")?.addEventListener("click", () => otpAction("listen"));
    $("#smtpOtpPullBtn")?.addEventListener("click", () => otpAction("export"));
    $("#smtpOtpRefreshBtn")?.addEventListener("click", () => refreshOtpInbox());

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
