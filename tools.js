/* DTD TOOLS — shared front-end logic for free-tools / pro-tools / tool-download */
(function () {
  const TOOLS = window.DTD_TOOLS || [];

  const qs = (params) =>
    new URLSearchParams(window.location.search).get(params) || "";

  const fmtDownloads = (n) =>
    new Intl.NumberFormat("en-US").format(Number(n || 0));

  const getTool = (id) => TOOLS.findById && TOOLS.findById(id);

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function coverLines(tool) {
    const lines = [
      `./${tool.id} --run --threads 16`,
      `[+] scanning ${fmtDownloads(tool.downloads)}+ targets`,
      `[+] found 128 valid results`,
      `[+] saved to output.txt`
    ];
    return lines.map((l) => `<span><samp>${escapeHtml(l)}</samp></span>`).join("");
  }

  function toolCard(tool, opts = {}) {
    const { showPrice } = opts;
    const priceBtn =
      tool.kind === "pro"
        ? `<a class="tool-btn pro" href="tool-download.html?tool=${encodeURIComponent(tool.id)}">Purchase $${Number(tool.price || 0).toLocaleString("en-US")}<span class="btn-arrow">→</span></a>`
        : `<a class="tool-btn" style="--tool-accent:${tool.accent}" href="tool-download.html?tool=${encodeURIComponent(tool.id)}">Get it<span class="btn-arrow">→</span></a>`;

    const tagClass = tool.kind === "pro" ? "tool-tag-pro" : "tool-tag-free";

    return `
      <article class="tool-card">
        <div class="tool-cover" style="--tool-accent:${tool.accent}">
          <span class="tool-cover-icon" aria-hidden="true">${tool.icon}</span>
          <div class="tool-cover-terminal" aria-hidden="true">${coverLines(tool)}</div>
        </div>
        <div class="tool-body">
          <div class="tool-meta">
            <span class="tool-pill ${tagClass}">${escapeHtml(tool.tag)}</span>
            <span class="tool-pill" style="color:var(--tools-muted);background:var(--tools-border-soft)">${escapeHtml(tool.version)}</span>
            <span class="tool-date">${escapeHtml(tool.date)}</span>
          </div>
          <h3>${escapeHtml(tool.name)}</h3>
          <p class="tool-short">${escapeHtml(tool.short)}</p>
          <details class="tool-more">
            <summary>Show more</summary>
            <p>${escapeHtml(tool.description)}</p>
          </details>
        </div>
        <div class="tool-footer">
          <span class="tool-downloads"><b>${fmtDownloads(tool.downloads)}</b> downloads</span>
          ${priceBtn}
        </div>
      </article>
    `;
  }

  function renderGrid(container, kind) {
    if (!container) return;
    const list = TOOLS.filter((t) => t.kind === kind);
    container.innerHTML = list.map((t) => toolCard(t)).join("");
  }

  function applyCounts(kind) {
    const list = TOOLS.filter((t) => t.kind === kind);
    const total = list.reduce((s, t) => s + Number(t.downloads || 0), 0);
    const elCount = document.querySelector("[data-count-tools]");
    const elTotal = document.querySelector("[data-count-downloads]");
    const elUpdated = document.querySelector("[data-count-updated]");
    const elFree = document.querySelector("[data-count-free]");
    const elPro = document.querySelector("[data-count-pro]");
    if (elCount) elCount.textContent = list.length;
    if (elTotal) elTotal.textContent = fmtDownloads(total);
    if (elUpdated) elUpdated.textContent = list.reduce((a, b) => (a.date > b.date ? a : b), list[0]).date;
    if (elFree) elFree.textContent = TOOLS.filter((t) => t.kind === "free").length;
    if (elPro) elPro.textContent = TOOLS.filter((t) => t.kind === "pro").length;
  }

  /* ─── Gate / download page ────────────────────────────── */

  function initGate() {
    const card = document.querySelector("[data-gate-card]");
    const panel = document.querySelector("[data-gate-form-panel]");
    if (!card) return;

    const tool = getTool(qs("tool"));
    if (!tool) {
      card.classList.add("is-done");
      const shot = document.querySelector("[data-gate-shot]");
      if (shot) {
        shot.classList.add("bad");
        shot.innerHTML =
          '<span class="shot-icon">🧭</span><h3>Tool not found</h3><p>The tool you were looking for does not exist. Return to the tools page and pick again.</p><a class="tool-btn" href="free-tools.html">← Back to Free Tools</a>';
      }
      return;
    }

    const fill = (sel, value) => {
      const el = document.querySelector(sel);
      if (el) el.textContent = value;
    };

    fill("[data-gate-icon]", tool.icon);
    fill("[data-gate-name]", tool.name);
    fill("[data-gate-short]", tool.short);
    fill("[data-gate-tag]", tool.tag);
    fill("[data-gate-version]", tool.version);
    fill("[data-gate-downloads]", fmtDownloads(tool.downloads));
    document.title = `${tool.name} · DTD Tools`;

    const submitBtn = document.querySelector("[data-gate-submit]");
    const nameInput = document.querySelector('[name="name"]');
    const emailInput = document.querySelector('[name="email"]');
    const phoneInput = document.querySelector('[name="phone"]');

    const isPro = tool.kind === "pro";
    if (isPro) {
      submitBtn.textContent = `Continue to payment  $${Number(tool.price || 0).toLocaleString("en-US")} →`;
      const hint = document.querySelector("[data-gate-hint]");
      if (hint) {
        hint.textContent =
          "This is a paid tool. Enter your details below — your download (license) link is unlocked after payment.";
      }
    }

    if (panel) {
      panel.addEventListener("submit", async (event) => {
        event.preventDefault();

        const name = String(nameInput.value || "").trim();
        const email = String(emailInput.value || "").trim();
        const phone = String(phoneInput.value || "").trim();
        let valid = true;

        [nameInput, emailInput, phoneInput].forEach((input) => {
          const field = input.closest(".tools-field");
          if (field) field.classList.remove("error");
        });

        if (!name) {
          nameInput.closest(".tools-field").classList.add("error");
          valid = false;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          emailInput.closest(".tools-field").classList.add("error");
          valid = false;
        }
        if (!valid) return;

        submitBtn.disabled = true;
        submitBtn.textContent = isPro ? "Saving details…" : "Preparing download…";

        try {
          const response = await fetch("/api/tool-download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tool: tool.id, name, email, phone })
          });
          const data = await response.json();

          if (!response.ok || !data.ok) {
            throw new Error(data.error || "Request failed. Try again.");
          }

          card.classList.add("is-done");
          animateShotProgress();

          const shot = document.querySelector("[data-gate-shot]");

          if (isPro) {
            shot.innerHTML =
              '<span class="shot-icon">✅</span>' +
              `<h3>Details saved — proceed to payment</h3>` +
              `<p>You are being taken to the checkout to complete payment for <strong>${escapeHtml(tool.name)}</strong>. Your download unlocks once the payment is confirmed.</p>` +
              `<a class="tool-btn" style="--tool-accent:${tool.accent}" href="index.html#payment">Go to payment →</a>`;
          } else if (data.downloadUrl) {
            const wait = startFakeProgress();
            setTimeout(() => {
              const link = document.createElement("a");
              link.href = data.downloadUrl;
              link.download = "";
              document.body.appendChild(link);
              link.click();
              link.remove();
            }, 1400);
            shot.innerHTML =
              '<span class="shot-icon">📦</span>' +
              `<h3>You're all set — download started</h3>` +
              `<p>Thanks <strong>${escapeHtml(name)}</strong>! If the download doesn't start automatically, click the button below.</p>` +
              `<div class="tools-progress" data-gate-progress><i></i></div>` +
              `<a class="tool-btn" style="--tool-accent:${tool.accent}" href="${escapeHtml(data.downloadUrl)}">Download ${escapeHtml(tool.name)} (${escapeHtml(tool.version)})</a>`;
            wait;
          } else {
            shot.innerHTML =
              '<span class="shot-icon">📬</span>' +
              `<h3>Request received</h3>` +
              `<p>Your details were saved. The download link has been sent to your email shortly.</p>`;
          }
        } catch (error) {
          submitBtn.disabled = false;
          submitBtn.textContent = isPro ? "Continue to payment →" : "Download now";
          const shot = document.querySelector("[data-gate-shot]");
          if (shot) {
            shot.classList.add("bad");
            shot.innerHTML =
              '<span class="shot-icon">⚠️</span><h3>Something went wrong</h3><p>' +
              escapeHtml(error.message) +
              '</p><button type="button" class="tool-btn" data-gate-retry style="--tool-accent:#f87171">Try again</button>';
            shot.querySelector("[data-gate-retry]").addEventListener("click", () => {
              location.reload();
            });
          }
        }
      });
    }
  }

  function animateShotProgress() {
    const bar = document.querySelector('[data-gate-progress] i');
    if (!bar) return;
    let width = 0;
    const timer = setInterval(() => {
      width = Math.min(100, width + Math.random() * 24);
      bar.style.width = `${width}%`;
      if (width >= 100) clearInterval(timer);
    }, 180);
  }

  function startFakeProgress() {
    const bar = document.querySelector('[data-gate-progress] i');
    if (bar) {
      let width = 0;
      const timer = setInterval(() => {
        width = Math.min(96, width + Math.random() * 22);
        bar.style.width = `${width}%`;
        if (width >= 96) clearInterval(timer);
      }, 160);
    }
  }

  window.DTD_TOOLS_UI = {
    renderGrid,
    applyCounts,
    initGate
  };

  document.addEventListener("DOMContentLoaded", () => {
    const page = document.body.dataset.page;
    if (page === "free-tools") {
      renderGrid(document.querySelector("[data-grid]"), "free");
      applyCounts("free");
    }
    if (page === "pro-tools") {
      renderGrid(document.querySelector("[data-grid]"), "pro");
      applyCounts("pro");
    }
    if (page === "tool-download") {
      initGate();
    }
  });
})();