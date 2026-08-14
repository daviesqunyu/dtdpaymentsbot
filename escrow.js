/* DTD Escrow — frontend. Talks to /api/escrow/* endpoints in _worker.js. */

(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const apiBase = "/api/escrow";
  let escrows = [];
  let activeFilter = "all";
  let activeDetail = null;

  const statusLabels = {
    open: "Open",
    active: "Active",
    funded: "Funded",
    released: "Completed",
    disputed: "Disputed",
    cancelled: "Cancelled"
  };

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });

  function esc(msg) {
    return String(msg)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(message, isError) {
    const node = $("#escrowToast");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("is-error", Boolean(isError));
    node.hidden = false;
    clearTimeout(node._timer);
    node._timer = setTimeout(() => {
      node.hidden = true;
    }, 3200);
  }

  function showNotice(id, message, isError) {
    const node = $(id);
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("is-error", Boolean(isError));
    node.hidden = false;
  }

  function hideNotice(id) {
    const node = $(id);
    if (node) node.hidden = true;
  }

  function openModal(id) {
    const modal = $(id);
    if (modal) modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    const modal = $(id);
    if (modal) modal.hidden = true;
    document.body.style.overflow = "";
  }

  function closeAllModals() {
    $$(".escrow-modal").forEach((modal) => {
      modal.hidden = true;
    });
    document.body.style.overflow = "";
  }

  async function api(path, options) {
    const response = await fetch(`${apiBase}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Request failed.");
    return payload;
  }

  function normalizeEscrow(raw) {
    const amountUsd = Number(raw.amount_usd ?? raw.amountUsd ?? 0);
    const feePercent = Number(raw.escrow_fee ?? raw.feePercent ?? 0);
    return {
      id: raw.id || "",
      code: raw.code || "",
      title: raw.title || "Escrow deal",
      description: raw.description || "",
      amountUsd,
      asset: raw.asset || raw.currency || "USDT",
      network: raw.network || "TRC20",
      feePercent,
      buyerTelegram: raw.buyer_telegram || raw.buyerTelegram || "",
      sellerTelegram: raw.seller_telegram || raw.sellerTelegram || "",
      buyerPayoutAddress: raw.buyer_payout_address || raw.buyerPayoutAddress || "",
      sellerPayoutAddress: raw.seller_payout_address || raw.sellerPayoutAddress || "",
      depositAddress: raw.deposit_address || raw.depositAddress || "",
      depositTxHash: raw.deposit_tx_hash || raw.depositTxHash || "",
      status: raw.status || "open",
      proofNote: raw.proof_note || raw.proofNote || "",
      createdAt: raw.created_at || raw.createdAt || "",
      updatedAt: raw.updated_at || raw.updatedAt || "",
      fundedAt: raw.funded_at || raw.fundedAt || "",
      releasedAt: raw.released_at || raw.releasedAt || "",
      transactions: Array.isArray(raw.transactions) ? raw.transactions : []
    };
  }

  function feeAmount(escrow) {
    return (escrow.amountUsd * escrow.feePercent) / 100;
  }

  function netAmount(escrow) {
    return Math.max(0, escrow.amountUsd - feeAmount(escrow));
  }

  function renderStats() {
    const total = escrows.length;
    const active = escrows.filter((e) => ["open", "active", "funded"].includes(e.status)).length;
    const completed = escrows.filter((e) => e.status === "released").length;
    const volume = escrows.reduce((sum, e) => sum + (e.status === "released" ? e.amountUsd : 0), 0);

    const setText = (id, value) => {
      const node = $(id);
      if (node) node.textContent = value;
    };
    setText("#statTotal", total);
    setText("#statActive", active);
    setText("#statCompleted", completed);
    setText("#statVolume", formatter.format(volume));
  }

  function renderList() {
    const root = $("#escrowList");
    if (!root) return;

    const query = ($("#escrowSearch")?.value || "").trim().toLowerCase();
    const filtered = escrows.filter((e) => {
      const statusOk = activeFilter === "all" || e.status === activeFilter;
      if (!statusOk) return false;
      if (!query) return true;
      const hay = `${e.code} ${e.title} ${e.buyerTelegram} ${e.sellerTelegram}`.toLowerCase();
      return hay.includes(query);
    });

    if (!filtered.length) {
      root.innerHTML = `
        <div class="escrow-empty">
          <span aria-hidden="true">🛡</span>
          <h3>No escrow deals found</h3>
          <p>${escrows.length ? "Try a different filter or search." : "Create your first escrow deal to get started."}</p>
        </div>`;
      return;
    }

    root.innerHTML = filtered
      .map(
        (e) => `
          <article class="escrow-card" data-id="${esc(e.id)}" tabindex="0" role="button" aria-label="Open ${esc(e.code)}">
            <div class="escrow-card-icon" aria-hidden="true">🛡</div>
            <div class="escrow-card-main">
              <p class="escrow-card-title">${esc(e.title)}</p>
              <div class="escrow-card-meta">
                <code>${esc(e.code)}</code>
                <span>${esc(e.asset)} · ${esc(e.network)}</span>
                <span>${esc(e.buyerTelegram || "no buyer")} ⇄ ${esc(e.sellerTelegram || "no seller")}</span>
              </div>
            </div>
            <div class="escrow-card-right">
              <div class="escrow-card-amount">${formatter.format(e.amountUsd)}</div>
              <span class="escrow-status-pill" data-status="${esc(e.status)}">${statusLabels[e.status] || e.status}</span>
            </div>
          </article>`
      )
      .join("");

    $$(".escrow-card").forEach((card) => {
      const open = () => {
        const id = card.dataset.id;
        const match = escrows.find((e) => e.id === id);
        if (match) renderDetail(match);
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
  }

  async function loadEscrows() {
    try {
      const data = await api("");
      escrows = (Array.isArray(data) ? data : data.escrows || []).map(normalizeEscrow);
      renderStats();
      renderList();
    } catch (error) {
      toast(error.message || "Could not load escrow deals.", true);
    }
  }

  function renderDetail(e) {
    activeDetail = e;
    openModal("#detailEscrowModal");

    const set = (id, value) => {
      const node = $(id);
      if (node) node.textContent = value ?? "—";
    };

    set("#detailEscrowCode", e.code);
    set("#detailEscrowTitleText", e.title);
    set("#detailEscrowDesc", e.description || "No description.");
    set("#detailEscrowAmount", `${formatter.format(e.amountUsd)} ${e.asset}`);
    set("#detailEscrowFee", `${e.feePercent}%`);
    set("#detailEscrowNet", `${formatter.format(netAmount(e))} ${e.asset}`);
    set("#detailEscrowBuyer", e.buyerTelegram || "@—");
    set("#detailEscrowSeller", e.sellerTelegram || "@—");
    set("#detailEscrowAddress", e.depositAddress || "Address assigned when the deal is created.");
    set("#detailEscrowNetworkHint", `Send ${e.asset} on ${e.network}. Confirm with the admin before paying.`);
    if ($("#detailEscrowTxHash")) $("#detailEscrowTxHash").value = e.depositTxHash || "";

    const banner = $("#detailEscrowStatus");
    if (banner) {
      banner.dataset.status = e.status;
      banner.textContent = `${statusLabels[e.status] || e.status} · ${formatter.format(e.amountUsd)} ${e.asset}`;
    }

    renderTimeline(e);
    renderActions(e);
  }

  function renderTimeline(e) {
    const root = $("#detailEscrowTimeline");
    if (!root) return;

    const events = [
      { title: "Deal created", time: e.createdAt, note: `By admin` },
      ...(Array.isArray(e.transactions)
        ? e.transactions.map((t) => ({
            title: statusLabels[t.kind] || t.kind,
            time: t.created_at || "",
            note: t.message || "",
            hash: t.tx_hash || ""
          }))
        : []),
      ...(e.fundedAt
        ? [{ title: "Funded", time: e.fundedAt, note: e.depositTxHash ? `TXID ${e.depositTxHash}` : "" }]
        : []),
      ...(e.releasedAt ? [{ title: "Released to seller", time: e.releasedAt }] : [])
    ];

    const fmt = (iso) => {
      if (!iso) return "";
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return "";
      return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    };

    root.innerHTML = events.length
      ? events
          .map(
            (ev) => `
              <li>
                <span class="tl-title">${esc(ev.title)}</span>
                <span class="tl-time">${fmt(ev.time)}</span>
                ${ev.note ? `<span class="tl-note">${esc(ev.note)}</span>` : ""}
              </li>`
          )
          .join("")
      : `<li><span class="tl-title">No timeline yet</span></li>`;
  }

  function renderActions(e) {
    const root = $("#detailEscrowActions");
    if (!root) return;

    const actions = [];
    const isPending = ["open"].includes(e.status);
    const isFunded = e.status === "funded";
    const isActive = ["open", "active"].includes(e.status);

    if (isPending) {
      actions.push(
        `<button class="escrow-primary-btn" type="button" data-action="mark-funded">Mark funded</button>`
      );
    }
    if (isActive) {
      actions.push(
        `<button class="escrow-ghost-btn" type="button" data-action="cancel">Cancel deal</button>`
      );
    }
    if (isFunded) {
      actions.push(
        `<button class="escrow-primary-btn" type="button" data-action="release">Release to seller</button>`
      );
      actions.push(
        `<button class="escrow-ghost-btn" type="button" data-action="dispute">Report dispute</button>`
      );
    }

    root.innerHTML = actions.length ? actions.join("") : "";

    root.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        if (action === "mark-funded") confirmTransition("funded", "Mark deal as funded?");
        if (action === "cancel") confirmTransition("cancelled", "Cancel this deal?");
        if (action === "release") confirmTransition("released", "Release funds to the seller? This triggers a Binance withdrawal.");
        if (action === "dispute") confirmTransition("disputed", "Report a dispute on this deal?");
      });
    });
  }

  async function confirmTransition(nextStatus, message) {
    if (!activeDetail) return;
    if (!window.confirm(message)) return;
    try {
      const payload = await api(`/${activeDetail.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: nextStatus })
      });
      toast(payload.message || "Deal updated.");
      await loadEscrows();
      const fresh = escrows.find((e) => e.id === activeDetail.id);
      if (fresh) renderDetail(fresh);
      else closeAllModals();
    } catch (error) {
      toast(error.message || "Update failed.", true);
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    hideNotice("#escrowFormNotice");

    const title = $("#escrowTitle").value.trim();
    const amountUsd = Number($("#escrowAmount").value);
    const buyerTelegram = $("#escrowBuyer").value.trim();
    const sellerTelegram = $("#escrowSeller").value.trim();

    if (!title) return showNotice("#escrowFormNotice", "Deal title is required.", true);
    if (!(amountUsd > 0)) return showNotice("#escrowFormNotice", "Enter a valid amount.", true);
    if (!buyerTelegram) return showNotice("#escrowFormNotice", "Buyer handle is required.", true);
    if (!sellerTelegram) return showNotice("#escrowFormNotice", "Seller handle is required.", true);

    const submit = $("#createEscrowSubmit");
    submit.disabled = true;
    submit.textContent = "Creating…";

    try {
      const payload = await api("", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: $("#escrowDescription").value.trim(),
          amountUsd,
          asset: $("#escrowCurrency").value,
          network: $("#escrowNetwork").value,
          feePercent: Number($("#escrowFee").value || 0),
          buyerTelegram,
          sellerTelegram,
          buyerPayoutAddress: $("#escrowBuyerAddress").value.trim(),
          sellerPayoutAddress: $("#escrowSellerAddress").value.trim()
        })
      });
      closeModal("#createEscrowModal");
      $("#createEscrowForm").reset();
      toast(payload.message || "Escrow deal created.");
      await loadEscrows();
    } catch (error) {
      showNotice("#escrowFormNotice", error.message || "Could not create deal.", true);
    } finally {
      submit.disabled = false;
      submit.textContent = "Create escrow deal";
    }
  }

  async function handleTrack(event) {
    event.preventDefault();
    hideNotice("#trackEscrowNotice");

    const code = $("#trackEscrowCode").value.trim().toUpperCase();
    if (!code) return showNotice("#trackEscrowNotice", "Enter a deal code.", true);

    try {
      const data = await api(`/code/${encodeURIComponent(code)}`);
      const escrow = normalizeEscrow(data);
      closeModal("#trackEscrowModal");
      $("#trackEscrowCode").value = "";
      renderDetail(escrow);
    } catch (error) {
      showNotice("#trackEscrowNotice", error.message || "Deal not found.", true);
    }
  }

  async function handleSaveTxHash() {
    if (!activeDetail) return;
    const txHash = $("#detailEscrowTxHash").value.trim();
    if (!txHash) return toast("Paste a transaction hash first.", true);
    try {
      const payload = await api(`/${activeDetail.id}/txhash`, {
        method: "POST",
        body: JSON.stringify({ txHash })
      });
      toast(payload.message || "Transaction hash saved.");
      await loadEscrows();
      const fresh = escrows.find((e) => e.id === activeDetail.id);
      if (fresh) renderDetail(fresh);
    } catch (error) {
      toast(error.message || "Could not save transaction hash.", true);
    }
  }

  function bind() {
    $("#openCreateEscrow")?.addEventListener("click", () => {
      hideNotice("#escrowFormNotice");
      openModal("#createEscrowModal");
    });

    $("#openTrackEscrow")?.addEventListener("click", () => {
      hideNotice("#trackEscrowNotice");
      openModal("#trackEscrowModal");
    });

    $("#createEscrowForm")?.addEventListener("submit", handleCreate);
    $("#trackEscrowForm")?.addEventListener("submit", handleTrack);
    $("#detailSaveTxHash")?.addEventListener("click", handleSaveTxHash);

    $("#detailCopyAddress")?.addEventListener("click", async () => {
      if (!activeDetail?.depositAddress) return toast("No deposit address on this deal.", true);
      try {
        await navigator.clipboard.writeText(activeDetail.depositAddress);
        toast("Deposit address copied.");
      } catch {
        toast("Copy failed — select the address manually.");
      }
    });

    $("#escrowRefresh")?.addEventListener("click", () => {
      $("#escrowRefresh").style.transform = "rotate(180deg)";
      setTimeout(() => {
        $("#escrowRefresh").style.transform = "";
      }, 300);
      loadEscrows();
    });

    $$(".escrow-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        activeFilter = tab.dataset.filter;
        $$(".escrow-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
        renderList();
      });
    });

    $("#escrowSearch")?.addEventListener("input", renderList);

    $$("[data-escrow-close]").forEach((node) => {
      node.addEventListener("click", closeAllModals);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAllModals();
    });

    loadEscrows();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
