/**
 * Trade wallet helpers — USDT TRC20 deposit address + withdraw request API client.
 */

export function usdtDepositFromConfig(cfg = {}) {
  return String(cfg.usdtTrc20Address || "").trim();
}

export function renderWalletPanel(root, ctx) {
  if (!root) return;
  const { address, botUrl, onCopy, onOpenBot } = ctx;
  const has = Boolean(address);
  root.innerHTML = `
    <div class="trade-wallet-card">
      <h4>USDT deposit (TRC20)</h4>
      <p class="form-note">Send USDT on <strong>Tron (TRC20)</strong> only. This address funds the desk — the bot controls withdrawals after you confirm.</p>
      <div class="trade-wallet-address" id="tradeUsdtAddress">${
        has ? escapeHtml(address) : "USDT_TRC20_ADDRESS is not configured yet."
      }</div>
      <div class="trade-wallet-actions">
        <button type="button" class="smtp-primary-btn" id="tradeCopyUsdt" ${has ? "" : "disabled"}>Copy address</button>
        <a class="ghost-btn" href="${escapeAttr(botUrl || "https://t.me/DTDSTOREBOT")}" target="_blank" rel="noopener noreferrer">Open trading bot</a>
      </div>
    </div>
    <div class="trade-wallet-card">
      <h4>Withdraw via @DTDSTOREBOT</h4>
      <ol class="trade-wallet-steps">
        <li>Message the bot: <code>/withdraw AMOUNT YOUR_USDT_ADDRESS</code></li>
        <li>Owner reviews and sends USDT from the deposit wallet.</li>
        <li>Owner taps <strong>Confirm withdrawn</strong> — you get a Telegram receipt.</li>
      </ol>
      <p class="form-note">Example: <code>/withdraw 25 TLyt…</code></p>
      <div class="trade-wallet-actions">
        <button type="button" class="ghost-btn" id="tradeWithdrawHelp">How withdraw works</button>
      </div>
      <p class="form-note" id="tradeWalletStatus" role="status"></p>
    </div>
  `;

  root.querySelector("#tradeCopyUsdt")?.addEventListener("click", () => onCopy?.(address));
  root.querySelector("#tradeWithdrawHelp")?.addEventListener("click", () => onOpenBot?.());
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
