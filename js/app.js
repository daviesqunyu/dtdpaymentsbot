/* DTD Store — Frontend Application Logic */
const API = ''; // relative to same origin

// ── State ──
const state = {
  cart: JSON.parse(localStorage.getItem('dtd_cart') || '[]'),
  checkout: {
    step: 'idle',
    email: '',
    paymentMethod: null,
    txHash: '',
    order: null
  },
  user: null,
  products: [],
  gatedUnlocked: false,
  ticker: {},
  connected: false
};

function saveCart() {
  localStorage.setItem('dtd_cart', JSON.stringify(state.cart));
}

// ── DOM helpers ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function showAlert(container, message, type = 'info') {
  const el = document.createElement('div');
  el.className = `alert alert-${type}`;
  el.textContent = message;
  container.prepend(el);
  setTimeout(() => el.remove(), 5000);
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { ...headers, ...(opts.headers || {}) },
    credentials: 'include'
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ── Navigation ──
function navigate(path) {
  window.location.href = path;
}

// ── Pages ──
async function renderHome() {
  const container = $('#app');
  container.innerHTML = `
    <div class="ambient"></div>
    <h1 class="page-title">DTD Store</h1>
    <p class="eyebrow mb-4">Premium digital products. Secure payments via Paystack, USDT TRC20, and Bitcoin.</p>
    <div class="product-grid" id="homeGrid">
      ${Array.from({length: 6}).map(() => `
        <div class="product-card">
          <div class="product-image skeleton"></div>
          <div class="product-content">
            <h3 class="product-title skeleton" style="width: 70%"></h3>
            <p class="product-desc skeleton" style="width: 100%"></p>
            <div class="product-price skeleton" style="width: 40%"></div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="mt-4">
      <a href="/payment" class="btn btn-primary btn-block">Start Shopping</a>
    </div>
  `;

  try {
    const { products } = await api('/api/products');
    state.products = products;
    const grid = $('#homeGrid');
    grid.innerHTML = products.map(p => `
      <div class="product-card">
        <div class="product-image">${p.imageUrl ? `<img src="${p.imageUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:0.5rem">` : '<span style="color:var(--cyber-muted);font-size:0.8rem">No image</span>'}</div>
        ${p.isGated ? '<div class="product-badge">GATED</div>' : ''}
        <div class="product-content">
          <h3 class="product-title">${escapeHtml(p.name)}</h3>
          <p class="product-desc">${escapeHtml(p.description || '')}</p>
          <div class="product-price">$${Number(p.price_usd).toFixed(2)}</div>
        </div>
        <div style="padding:1rem">
          <a href="/payment" class="btn btn-primary btn-sm btn-block">Buy ${escapeHtml(p.name)}</a>
        </div>
      </div>
    `).join('');
  } catch (e) {
    $('#homeGrid').innerHTML = `<p class="text-cyber-muted text-center mt-4">Unable to load products.</p>`;
  }
}

async function renderPayment() {
  const container = $('#app');
  const urlParams = new URLSearchParams(window.location.search);
  const preEmail = urlParams.get('email') || '';
  const preMethod = urlParams.get('method') || '';

  container.innerHTML = `
    <div class="ambient"></div>
    <h1 class="page-title">Secure Checkout</h1>
    <div class="step-indicator">
      <div class="step ${['idle','email'].includes(state.checkout.step) ? 'active' : ''}"><span class="step-dot"></span>Email</div>
      <div class="step ${state.checkout.step === 'payment_method' ? 'active' : ''}"><span class="step-dot"></span>Payment</div>
      <div class="step ${state.checkout.step === 'crypto_hash' || state.checkout.step === 'paystack_redirect' ? 'active' : ''}"><span class="step-dot"></span>Verify</div>
      <div class="step ${state.checkout.step === 'paid' ? 'active' : ''}"><span class="step-dot"></span>Paid</div>
    </div>
    <div class="card mb-4" id="checkoutForm"></div>
    <div id="checkoutAlert"></div>
  `;

  const form = $('#checkoutForm');
  const alertEl = $('#checkoutAlert');

  async function renderStep() {
    const step = state.checkout.step;
    if (step === 'idle' || step === 'email') {
      form.innerHTML = `
        <div class="form-group">
          <label class="form-label">Delivery Email</label>
          <input type="email" id="checkoutEmail" class="form-input" value="${escapeHtml(preEmail)}" placeholder="you@example.com">
        </div>
        <button class="btn btn-primary btn-block mt-4" id="btnNextEmail">Continue to Payment</button>
      `;
      $('#btnNextEmail')?.onclick = async () => {
        const email = $('#checkoutEmail').value.trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          showAlert(alertEl, 'Enter a valid email address.', 'error');
          return;
        }
        state.checkout.email = email;
        state.checkout.step = 'payment_method';
        renderStep();
      };
    } else if (step === 'payment_method') {
      form.innerHTML = `
        <h3 style="margin-bottom:1rem;color:var(--cyber-text)">Choose Payment Method</h3>
        <div class="toggle-group mb-4">
          <button class="toggle-btn ${state.checkout.paymentMethod === 'usdt' ? 'active' : ''}" id="btnUsdt">USDT (TRC20)</button>
          <button class="toggle-btn ${state.checkout.paymentMethod === 'btc' ? 'active' : ''}" id="btnBtc">Bitcoin</button>
          <button class="toggle-btn ${state.checkout.paymentMethod === 'paystack' ? 'active' : ''}" id="btnPaystack">Card / Bank</button>
        </div>
        <button class="btn btn-primary btn-block mt-4" id="btnCreateOrder">Create Order</button>
      `;
      ['btnUsdt','btnBtc','btnPaystack'].forEach(id => {
        $(id)?.onclick = () => {
          state.checkout.paymentMethod = id.replace('btn','').toLowerCase();
          $$('.toggle-btn').forEach(b => b.classList.remove('active'));
          $(id).classList.add('active');
        };
      });
      $('#btnCreateOrder')?.onclick = async () => {
        if (!state.checkout.paymentMethod) {
          showAlert(alertEl, 'Select a payment method.', 'error');
          return;
        }
        try {
          const order = await api('/api/orders', {
            method: 'POST',
            body: {
              customerName: 'Store Customer',
              customerEmail: state.checkout.email,
              paymentMethod: state.checkout.paymentMethod,
              totalUsd: 49,
              items: []
            }
          });
          state.checkout.order = order;
          if (state.checkout.paymentMethod === 'paystack') {
            state.checkout.step = 'paystack_redirect';
          } else {
            state.checkout.step = 'crypto_hash';
          }
          renderStep();
        } catch (e) {
          showAlert(alertEl, e.message, 'error');
        }
      };
    } else if (step === 'crypto_hash') {
      const network = state.checkout.paymentMethod === 'btc' ? 'btc' : 'trc20';
      const label = state.checkout.paymentMethod === 'btc' ? 'Bitcoin (BTC)' : 'USDT (TRC20)';
      const address = state.checkout.paymentMethod === 'btc' ? 'bc1q...' : 'T...';
      form.innerHTML = `
        <h3 style="margin-bottom:0.5rem;color:var(--cyber-text)">Verify ${label} Payment</h3>
        <p class="text-cyber-muted text-sm mb-3">Paste the transaction hash after sending funds to:</p>
        <div style="margin-bottom:1rem">
          <input type="text" id="cryptoAddr" class="form-input font-mono text-xs" value="${escapeHtml(address)}" readonly>
          <button class="btn btn-outline btn-sm mt-2" onclick="navigator.clipboard.writeText('${escapeHtml(address)}')">Copy Address</button>
        </div>
        <div class="form-group">
          <label class="form-label">Transaction Hash (64 hex chars)</label>
          <input type="text" id="cryptoHash" class="form-input font-mono text-xs" maxlength="64" placeholder="Paste tx hash here..." spellcheck="false">
          <div id="hashHint" class="text-cyber-muted text-sm mt-1"></div>
        </div>
        <button class="btn btn-primary btn-block mt-4" id="btnVerifyCrypto">Verify Payment</button>
      `;
      const hashInput = $('#cryptoHash');
      const hint = $('#hashHint');
      hashInput?.oninput = () => {
        const valid = /^[0-9a-fA-F]{64}$/.test(hashInput.value);
        hint.textContent = valid ? 'Valid format' : 'Invalid format (64 hex characters)';
        hint.style.color = valid ? 'var(--cyber-neon-green)' : 'var(--cyber-neon-red)';
      };
      $('#btnVerifyCrypto')?.onclick = async () => {
        const hash = hashInput.value.trim();
        if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
          showAlert(alertEl, 'Invalid transaction hash format.', 'error');
          return;
        }
        try {
          const result = await api('/api/payments/crypto/verify', {
            method: 'POST',
            body: {
              tx_hash: hash,
              order_id: state.checkout.order.id,
              network,
              wallet_address: address,
              amount_paid: 49
            }
          });
          state.checkout.step = 'paid';
          renderStep();
        } catch (e) {
          showAlert(alertEl, e.message, 'error');
        }
      };
    } else if (step === 'paystack_redirect') {
      form.innerHTML = `
        <div class="text-center py-10">
          <div class="skeleton" style="width:3rem;height:3rem;border-radius:50%;margin:0 auto 1rem"></div>
          <p class="text-cyber-text mb-2">Redirecting to Paystack…</p>
          <p class="text-cyber-muted text-sm">Complete payment on Paystack, then return here.</p>
        </div>
      `;
      // In production, this would open Paystack checkout. For now, show manual verify option.
      form.innerHTML += `
        <div class="mt-4">
          <p class="text-cyber-muted text-sm mb-2">Or manually verify Paystack payment:</p>
          <input type="text" id="paystackRef" class="form-input font-mono text-xs" placeholder="Paystack reference">
          <button class="btn btn-primary btn-block mt-2" id="btnVerifyPaystack">Verify Paystack Payment</button>
        </div>
      `;
      $('#btnVerifyPaystack')?.onclick = async () => {
        const ref = $('#paystackRef').value.trim();
        if (!ref) return;
        try {
          const result = await api('/api/paystack/verify', { method: 'POST', body: { reference: ref } });
          if (result.paid) {
            state.checkout.step = 'paid';
            renderStep();
          } else {
            showAlert(alertEl, 'Payment not yet confirmed.', 'error');
          }
        } catch (e) {
          showAlert(alertEl, e.message, 'error');
        }
      };
    } else if (step === 'paid') {
      const order = state.checkout.order;
      form.innerHTML = `
        <div class="text-center">
          <div style="width:3rem;height:3rem;border-radius:50%;background:var(--cyber-neon-green);color:var(--cyber-bg);display:flex;align-items:center;justify-content:center;font-weight:800;margin:0 auto 1rem">✓</div>
          <h2 class="text-cyber-neon-green font-bold text-lg">Order Confirmed</h2>
          <p class="text-cyber-text text-sm mt-2">Order ID: <span class="mono">${escapeHtml(order.id)}</span></p>
          <p class="text-cyber-text text-sm">Amount: $${Number(order.amount_paid || 0).toFixed(2)} USD</p>
          <p class="text-cyber-text text-sm">Delivery email: ${escapeHtml(state.checkout.email)}</p>
          <p class="text-cyber-muted text-xs mt-4">A receipt has been sent to your email and Telegram.</p>
        </div>
      `;
    }
  }

  renderStep();
}

async function renderGated() {
  const container = $('#app');
  container.innerHTML = `
    <div class="ambient"></div>
    <h1 class="page-title">DTDSHOP.CC — Gated Catalog</h1>
    <p class="eyebrow mb-4">Premium products — requires verified $5+ USDT/BTC crypto deposit.</p>
    <div id="gatedStatus" class="card mb-4"></div>
    <div id="gatedProducts" class="product-grid"></div>
  `;

  try {
    const result = await api('/api/products/gated');
    state.gatedUnlocked = result.unlocked;
    const status = $('#gatedStatus');
    if (result.unlocked) {
      status.innerHTML = `<div class="alert alert-success">✅ Gated catalog unlocked — verified $5+ deposit detected.</div>`;
      const grid = $('#gatedProducts');
      grid.innerHTML = (result.products || []).map(p => `
        <div class="product-card">
          <div class="product-image">${p.imageUrl ? `<img src="${p.imageUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:0.5rem">` : '<span style="color:var(--cyber-muted);font-size:0.8rem">No image</span>'}</div>
          <div class="product-content">
            <h3 class="product-title">${escapeHtml(p.name)}</h3>
            <p class="product-desc">${escapeHtml(p.description || '')}</p>
            <div class="product-price">$${Number(p.price_usd).toFixed(2)}</div>
          </div>
          <div style="padding:1rem">
            <a href="/payment?email=buyer@example.com&method=usdt" class="btn btn-primary btn-sm btn-block">Buy</a>
          </div>
        </div>
      `).join('');
    } else {
      status.innerHTML = `<div class="alert alert-error">🔒 Gated catalog locked. Complete a verified $5+ USDT/BTC crypto deposit to unlock premium products.</div>`;
    }
  } catch (e) {
    $('#gatedStatus').innerHTML = `<div class="alert alert-error">Unable to verify access. ${e.message}</div>`;
  }
}

async function renderTrade() {
  const container = $('#app');
  container.innerHTML = `
    <div class="ambient"></div>
    <h1 class="page-title">Spot Desk</h1>
    <p class="eyebrow mb-4">Live Binance trading — candlestick charts, order book, and order execution.</p>
    <div class="card mb-4">
      <h3 style="margin-bottom:1rem;color:var(--cyber-text)">Binance API Connection</h3>
      <p class="text-cyber-muted text-sm mb-3">API keys are stored in your browser only (localStorage). They are never transmitted to our backend.</p>
      <div class="form-group">
        <label class="form-label">API Key</label>
        <input type="text" id="binanceApiKey" class="form-input font-mono text-xs" placeholder="Enter Binance API key">
      </div>
      <div class="form-group">
        <label class="form-label">API Secret</label>
        <input type="password" id="binanceApiSecret" class="form-input font-mono text-xs" placeholder="Enter Binance API secret">
      </div>
      <button class="btn btn-primary btn-sm" id="btnConnectBinance">Connect to Binance</button>
      <div id="binanceStatus" class="mt-2 text-cyber-muted text-sm"></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:1rem;color:var(--cyber-text)">Market Ticker</h3>
      <div class="table">
        <thead><tr>
          <th>Symbol</th><th>Price</th><th>24h Change</th><th>Bid</th><th>Ask</th>
        </tr></thead>
        <tbody id="tickerBody">
          <tr><td colspan="5" class="text-cyber-muted text-sm">Loading market data…</td></tr>
        </tbody>
      </div>
    </div>
  `;

  $('#btnConnectBinance')?.onclick = () => {
    const key = $('#binanceApiKey').value.trim();
    const secret = $('#binanceApiSecret').value.trim();
    if (!key || !secret) {
      $('#binanceStatus').textContent = 'Enter API key and secret.';
      return;
    }
    localStorage.setItem('dtd_binance_key', key);
    localStorage.setItem('dtd_binance_secret', secret);
    $('#binanceStatus').textContent = 'Keys saved locally. (Testnet connection not configured in this build.)';
    $('#binanceStatus').style.color = 'var(--cyber-neon)';
  };

  // Fetch ticker from public Binance API
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    const tickers = await res.json();
    const symbols = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT'];
    const body = $('#tickerBody');
    body.innerHTML = symbols.map(s => {
      const t = tickers.find(t => t.symbol === s);
      if (!t) return '';
      const change = Number(t.priceChangePercent);
      const color = change >= 0 ? 'var(--cyber-neon-green)' : 'var(--cyber-neon-red)';
      return `
        <tr>
          <td><span class="mono">${s}</span></td>
          <td><span class="mono">${Number(t.lastPrice).toFixed(2)}</span></td>
          <td style="color:${color}">${change.toFixed(2)}%</td>
          <td><span class="mono">${Number(t.bidPrice).toFixed(2)}</span></td>
          <td><span class="mono">${Number(t.askPrice).toFixed(2)}</span></td>
        </tr>
      `;
    }).join('');
  } catch {
    $('#tickerBody').innerHTML = `<tr><td colspan="5" class="text-cyber-muted text-sm">Unable to load market data.</td></tr>`;
  }
}

async function renderSmtp() {
  const container = $('#app');
  container.innerHTML = `
    <div class="ambient"></div>
    <h1 class="page-title">SMTP Vault</h1>
    <p class="eyebrow mb-4">Bulk email, carrier SMS gateways, and live OTP inbox. Admin unlock required.</p>
    <div id="smtpStatus" class="card mb-4"></div>
    <div class="card">
      <h3 style="margin-bottom:1rem;color:var(--cyber-text)">Unlock Console</h3>
      <div class="toggle-group mb-4">
        <button class="toggle-btn active" id="smtpModeAdmin">Admin</button>
        <button class="toggle-btn" id="smtpModeOrder">Order</button>
      </div>
      <div id="smtpUnlockForm">
        <div class="form-group">
          <label class="form-label">Admin JWT Token</label>
          <input type="password" id="smtpAdminJwt" class="form-input font-mono text-xs" placeholder="Paste admin JWT">
        </div>
        <button class="btn btn-primary btn-sm" id="smtpBtnUnlock">Unlock</button>
      </div>
      <div id="smtpUnlockAlert"></div>
    </div>
    <div class="card mt-4" id="smtpSender" style="display:none">
      <h3 style="margin-bottom:1rem;color:var(--cyber-text)">Send Email / SMS</h3>
      <div class="toggle-group mb-4">
        <button class="toggle-btn active" id="smtpTabEmail">Email</button>
        <button class="toggle-btn" id="smtpTabSms">SMS</button>
        <button class="toggle-btn" id="smtpTabOtp">OTP Listener</button>
      </div>
      <div id="smtpTabContent"></div>
      <div id="smtpSenderAlert"></div>
    </div>
  `;

  let smtpMode = 'admin';
  $('#smtpModeAdmin')?.onclick = () => { smtpMode = 'admin'; $('#smtpUnlockForm').innerHTML = `
    <div class="form-group">
      <label class="form-label">Admin JWT Token</label>
      <input type="password" id="smtpAdminJwt" class="form-input font-mono text-xs" placeholder="Paste admin JWT">
    </div>
    <button class="btn btn-primary btn-sm" id="smtpBtnUnlock">Unlock</button>
  `; bindUnlock(); };
  $('#smtpModeOrder')?.onclick = () => { smtpMode = 'order'; $('#smtpUnlockForm').innerHTML = `
    <div class="form-group">
      <label class="form-label">Order ID</label>
      <input type="text" id="smtpOrderId" class="form-input" placeholder="Order ID">
    </div>
    <div class="form-group">
      <label class="form-label">Email on Order</label>
      <input type="email" id="smtpOrderEmail" class="form-input" placeholder="you@example.com">
    </div>
    <button class="btn btn-primary btn-sm" id="smtpBtnUnlock">Unlock</button>
  `; bindUnlock(); };

  function bindUnlock() {
    $('#smtpBtnUnlock')?.onclick = async () => {
      const alertEl = $('#smtpUnlockAlert');
      try {
        if (smtpMode === 'admin') {
          const jwt = $('#smtpAdminJwt').value.trim();
          const result = await api('/api/smtp/unlock', {
            method: 'POST',
            body: { mode: 'admin', adminJwt: jwt }
          });
          $('#smtpStatus').innerHTML = `<div class="alert alert-success">✅ Admin console unlocked. Role: ${result.role}</div>`;
          $('#smtpSender').style.display = 'block';
          renderSmtpTabs();
        } else {
          const orderId = $('#smtpOrderId').value.trim();
          const email = $('#smtpOrderEmail').value.trim();
          const result = await api('/api/smtp/unlock', {
            method: 'POST',
            body: { mode: 'order', orderId, email }
          });
          $('#smtpStatus').innerHTML = `<div class="alert alert-success">✅ SMTP unlocked for order ${result.order_id}. Role: ${result.role}</div>`;
          $('#smtpSender').style.display = 'block';
          renderSmtpTabs();
        }
      } catch (e) {
        showAlert($('#smtpUnlockAlert'), e.message, 'error');
      }
    };
  }
  bindUnlock();

  function renderSmtpTabs() {
    let activeTab = 'email';
    const content = $('#smtpTabContent');
    const alertEl = $('#smtpSenderAlert');

    function render() {
      if (activeTab === 'email') {
        content.innerHTML = `
          <div class="form-group">
            <label class="form-label">To Addresses</label>
            <textarea id="smtpEmailTo" class="form-input font-mono text-xs" rows="3" placeholder="one@example.com
two@example.com"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Subject</label>
            <input type="text" id="smtpEmailSubject" class="form-input" placeholder="Subject">
          </div>
          <div class="form-group">
            <label class="form-label">Message</label>
            <textarea id="smtpEmailBody" class="form-input font-mono text-xs" rows="5" placeholder="Email body…"></textarea>
          </div>
          <button class="btn btn-primary btn-sm" id="smtpBtnSendEmail">Send Email</button>
        `;
        $('#smtpBtnSendEmail')?.onclick = async () => {
          const to = $('#smtpEmailTo').value.split(/[\n\r,;]+/).map(s => s.trim()).filter(Boolean);
          try {
            const result = await api('/api/smtp/send-email', {
              method: 'POST',
              body: { to, subject: $('#smtpEmailSubject').value, text: $('#smtpEmailBody').value }
            });
            showAlert(alertEl, result.message || `Sent to ${to.length} recipient(s).`, 'success');
          } catch (e) {
            showAlert(alertEl, e.message, 'error');
          }
        };
      } else if (activeTab === 'sms') {
        content.innerHTML = `
          <div class="form-group">
            <label class="form-label">Phone Numbers</label>
            <textarea id="smtpSmsTo" class="form-input font-mono text-xs" rows="3" placeholder="+254712345678
+254798765432"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">SMSGate Username</label>
            <input type="text" id="smtpSmsUser" class="form-input" placeholder="Username">
          </div>
          <div class="form-group">
            <label class="form-label">SMSGate Password</label>
            <input type="password" id="smtpSmsPass" class="form-input" placeholder="Password">
          </div>
          <div class="form-group">
            <label class="form-label">Gateway URL</label>
            <input type="text" id="smtpSmsUrl" class="form-input" placeholder="https://smsgate.example.com">
          </div>
          <div class="form-group">
            <label class="form-label">Message</label>
            <textarea id="smtpSmsBody" class="form-input font-mono text-xs" rows="3" placeholder="SMS message…"></textarea>
          </div>
          <button class="btn btn-primary btn-sm" id="smtpBtnSendSms">Send SMS</button>
        `;
        $('#smtpBtnSendSms')?.onclick = async () => {
          const to = $('#smtpSmsTo').value.split(/[\n\r,;|]+/).map(s => s.trim()).filter(Boolean);
          try {
            const result = await api('/api/smtp/send-sms', {
              method: 'POST',
              body: { to, text: $('#smtpSmsBody').value, gwUser: $('#smtpSmsUser').value, gwPass: $('#smtpSmsPass').value, gwUrl: $('#smtpSmsUrl').value }
            });
            showAlert(alertEl, result.message || `Sent to ${to.length} phone(s).`, 'success');
          } catch (e) {
            showAlert(alertEl, e.message, 'error');
          }
        };
      } else {
        content.innerHTML = `
          <div class="form-group">
            <label class="form-label">Phone to Watch</label>
            <input type="text" id="smtpOtpPhone" class="form-input" placeholder="+254712345678">
          </div>
          <div class="form-group">
            <label class="form-label">SMSGate Username</label>
            <input type="text" id="smtpOtpUser" class="form-input" placeholder="Username">
          </div>
          <div class="form-group">
            <label class="form-label">SMSGate Password</label>
            <input type="password" id="smtpOtpPass" class="form-input" placeholder="Password">
          </div>
          <button class="btn btn-primary btn-sm" id="smtpBtnOtpListen">Start OTP Listener</button>
          <div id="smtpOtpInbox" class="mt-4"></div>
        `;
        $('#smtpBtnOtpListen')?.onclick = async () => {
          try {
            const result = await api('/api/smtp/otp', {
              method: 'POST',
              body: { action: 'listen', gwUser: $('#smtpOtpUser').value, gwPass: $('#smtpOtpPass').value, phones: [$('#smtpOtpPhone').value] }
            });
            showAlert(alertEl, result.message || 'OTP listener started.', 'success');
            loadOtps();
          } catch (e) {
            showAlert(alertEl, e.message, 'error');
          }
        };
      }
    }

    $('#smtpTabEmail')?.onclick = () => { activeTab = 'email'; $$('.toggle-btn').forEach(b=>b.classList.remove('active')); $('#smtpTabEmail').classList.add('active'); render(); };
    $('#smtpTabSms')?.onclick = () => { activeTab = 'sms'; $$('.toggle-btn').forEach(b=>b.classList.remove('active')); $('#smtpTabSms').classList.add('active'); render(); };
    $('#smtpTabOtp')?.onclick = () => { activeTab = 'otp'; $$('.toggle-btn').forEach(b=>b.classList.remove('active')); $('#smtpTabOtp').classList.add('active'); render(); };

    render();

    async function loadOtps() {
      try {
        const result = await api('/api/smtp/otp');
        const inbox = $('#smtpOtpInbox');
        inbox.innerHTML = (result.items || []).map(item => `
          <div class="otp-card">
            <div class="otp-code">${escapeHtml(item.otp || '—')}</div>
            <div class="otp-meta">
              From: ${escapeHtml(item.sender || '—')} · To: ${escapeHtml(item.recipient || '—')}
              <div>${new Date(item.receivedAt || item.createdAt).toLocaleString()}</div>
            </div>
          </div>
        `).join('') || '<p class="text-cyber-muted text-sm">No OTPs yet.</p>';
      } catch {}
    }
    setInterval(loadOtps, 8000);
    loadOtps();
  }
}

async function renderChat() {
  const container = $('#app');
  container.innerHTML = `
    <div class="ambient"></div>
    <h1 class="page-title">Store Chat</h1>
    <p class="eyebrow mb-4">Live chat feed mirrored with Telegram auth. Request phone/video callbacks.</p>
    <div style="display:flex;gap:1rem">
      <div style="flex:1">
        <div class="card mb-4">
          <div class="chat-messages" id="chatMessages">
            <div class="text-cyber-muted text-sm text-center mt-4">Connecting to chat feed…</div>
          </div>
        </div>
        <form id="chatForm" class="chat-form">
          <input type="text" id="chatMessage" class="chat-input" placeholder="Type a message…" required>
          <input type="text" id="chatContact" class="chat-input" placeholder="Phone or @username (optional)">
          <button type="submit" class="btn btn-primary btn-sm">Send</button>
        </form>
      </div>
      <div style="width:320px">
        <div class="card">
          <h3 style="margin-bottom:1rem;color:var(--cyber-text)">Request Callback</h3>
          <form id="callbackForm">
            <div class="form-group">
              <label class="form-label">Name</label>
              <input type="text" id="cbName" class="form-input" placeholder="Your name" required>
            </div>
            <div class="form-group">
              <label class="form-label">Contact</label>
              <input type="text" id="cbContact" class="form-input" placeholder="Phone or @username" required>
            </div>
            <div class="form-group">
              <label class="form-label">Topic</label>
              <input type="text" id="cbTopic" class="form-input" placeholder="What do you need help with?">
            </div>
            <button class="btn btn-primary btn-block btn-sm" type="submit">Request Callback</button>
          </form>
          <div id="cbStatus" class="mt-2 text-cyber-muted text-sm"></div>
        </div>
      </div>
    </div>
  `;

  let messages = [];
  async function loadMessages() {
    try {
      const result = await api('/api/chat/messages');
      messages = result.messages || [];
      const el = $('#chatMessages');
      el.innerHTML = messages.map(m => `
        <div class="chat-message received">
          <div style="font-weight:700;font-size:0.85rem">${escapeHtml(m.displayName || m.username || 'User')}</div>
          <div>${escapeHtml(m.body || '')}</div>
          <div class="chat-meta">${new Date(m.createdAt).toLocaleString()}</div>
        </div>
      `).join('');
      el.scrollTop = el.scrollHeight;
    } catch {
      $('#chatMessages').innerHTML = '<div class="text-cyber-neon-red text-sm text-center mt-4">Unable to load chat.</div>';
    }
  }

  $('#chatForm')?.onsubmit = async (e) => {
    e.preventDefault();
    const message = $('#chatMessage').value.trim();
    const contact = $('#chatContact').value.trim();
    if (!message) return;
    try {
      await api('/api/telegram/message', {
        method: 'POST',
        body: { message, name: 'Store Customer', contact: contact || undefined }
      });
      messages.unshift({ message, contact, displayName: 'You' });
      const el = $('#chatMessages');
      el.innerHTML = `
        <div class="chat-message sent">
          <div style="font-weight:700;font-size:0.85rem">You</div>
          <div>${escapeHtml(message)}</div>
          ${contact ? `<div class="chat-meta">${escapeHtml(contact)}</div>` : ''}
        </div>
      ` + el.innerHTML;
      $('#chatMessage').value = '';
    } catch (e) {
      showAlert(document.createElement('div'), e.message, 'error');
    }
  };

  $('#callbackForm')?.onsubmit = async (e) => {
    e.preventDefault();
    const status = $('#cbStatus');
    try {
      await api('/api/call-requests', {
        method: 'POST',
        body: {
          name: $('#cbName').value.trim(),
          phone: $('#cbContact').value.trim(),
          topic: $('#cbTopic').value.trim(),
          message: 'Callback requested from store chat',
          preferredTime: ''
        }
      });
      status.textContent = '✅ Callback requested — we will contact you shortly.';
      status.style.color = 'var(--cyber-neon-green)';
      $('#callbackForm').reset();
    } catch (e) {
      status.textContent = '❌ ' + e.message;
      status.style.color = 'var(--cyber-neon-red)';
    }
  };

  loadMessages();
  setInterval(loadMessages, 5000);
}

async function renderTrack() {
  const container = $('#app');
  container.innerHTML = `
    <div class="ambient"></div>
    <h1 class="page-title">Track Order</h1>
    <p class="eyebrow mb-4">Enter your Order ID and email to check payment and delivery status.</p>
    <div class="card">
      <div class="form-group">
        <label class="form-label">Order ID</label>
        <input type="text" id="trackOrderId" class="form-input font-mono text-xs" placeholder="e.g. DTD-abc123">
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input type="email" id="trackEmail" class="form-input" placeholder="you@example.com">
      </div>
      <button class="btn btn-primary btn-sm btn-block" id="trackBtn">Check Status</button>
      <div id="trackResult" class="mt-4"></div>
    </div>
  `;

  $('#trackBtn')?.onclick = async () => {
    const orderId = $('#trackOrderId').value.trim();
    const email = $('#trackEmail').value.trim().toLowerCase();
    if (!orderId || !email) {
      $('#trackResult').innerHTML = `<div class="alert alert-error">Order ID and email are required.</div>`;
      return;
    }
    try {
      const { order } = await api(`/api/orders/status?orderId=${encodeURIComponent(orderId)}&email=${encodeURIComponent(email)}`);
      $('#trackResult').innerHTML = `
        <div class="alert alert-success">✅ Order found</div>
        <table class="table mt-2">
          <tr><th>Order ID</th><td>${escapeHtml(order.id)}</td></tr>
          <tr><th>Payment Method</th><td>${escapeHtml(order.paymentMethod || order.payment_method || '—')}</td></tr>
          <tr><th>Payment Status</th><td><span style="font-family:var(--cyber-font-mono)">${escapeHtml(order.paymentStatus || order.payment_status || '—')}</span></td></tr>
          <tr><th>Order Status</th><td>${escapeHtml(order.orderStatus || order.order_status || '—')}</td></tr>
          <tr><th>Amount Paid</th><td>$${Number(order.amountPaid || order.amount_paid || 0).toFixed(2)} USD</td></tr>
          <tr><th>TX Hash</th><td><span class="mono text-cyber-muted">${escapeHtml(order.txHash || order.tx_hash || '—')}</span></td></tr>
        </table>
      `;
    } catch (e) {
      $('#trackResult').innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    }
  };
}

// ── Router ──
const routes = {
  '/': renderHome,
  '/payment': renderPayment,
  '/dtdshopcc': renderGated,
  '/trade': renderTrade,
  '/smtp': renderSmtp,
  '/chat': renderChat,
  '/track': renderTrack
};

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function router() {
  const path = window.location.pathname;
  const render = routes[path];
  if (render) render();
  else {
    $('#app').innerHTML = `<div class="text-cyber-neon-red text-center mt-10">404 — Page not found</div>`;
  }
}

// ── Boot ──
window.addEventListener('DOMContentLoaded', () => {
  const app = document.createElement('div');
  app.id = 'app';
  document.body.prepend(app);

  // Mobile menu toggle
  const btnMenu = document.getElementById('btnMenuToggle');
  const btnClose = document.getElementById('btnNavClose');
  const sideNav = document.getElementById('sideNav');
  if (btnMenu && sideNav) {
    btnMenu.addEventListener('click', () => sideNav.classList.toggle('open'));
  }
  if (btnClose && sideNav) {
    btnClose.addEventListener('click', () => sideNav.classList.remove('open'));
  }

  router();
  window.addEventListener('popstate', router);
});
