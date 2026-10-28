document.addEventListener('DOMContentLoaded', () => {
  initPayment();
});

let currentPaymentMethod = 'paystack';
let orderData = null;

function initPayment() {
  const orderDataStr = sessionStorage.getItem('dtd_order');
  if (!orderDataStr) {
    showMessage('No order found. Redirecting to store...', 'error');
    setTimeout(() => {
      window.location.href = '/';
    }, 2000);
    return;
  }
  
  try {
    orderData = JSON.parse(orderDataStr);
    renderOrderSummary();
    initPaymentMethods();
    initForm();
    updateCryptoDetails();
  } catch (e) {
    showMessage('Invalid order data', 'error');
  }
}

function renderOrderSummary() {
  const summaryEl = document.getElementById('orderSummary');
  if (!summaryEl || !orderData) return;
  
  const itemsHtml = orderData.items.map(item => `
    <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--cyber-border);">
      <div>
        <div style="color:var(--cyber-text);font-weight:500;">${escapeHtml(item.product_name)}</div>
        <div style="color:var(--cyber-muted);font-size:0.875rem;">Qty: ${item.quantity}</div>
      </div>
      <div style="color:var(--cyber-neon);font-family:'JetBrains Mono',monospace;">$${(item.unit_price_usd * item.quantity).toFixed(2)}</div>
    </div>
  `).join('');
  
  summaryEl.innerHTML = `
    <div style="margin-bottom:1rem;">
      <div style="color:var(--cyber-neon);font-weight:600;margin-bottom:0.75rem;">Order Summary</div>
      ${itemsHtml}
    </div>
    <div style="display:flex;justify-content:space-between;padding-top:0.75rem;border-top:2px solid var(--cyber-border);font-weight:600;">
      <span style="color:var(--cyber-text);">Total</span>
      <span style="color:var(--cyber-neon);font-family:'JetBrains Mono',monospace;font-size:1.125rem;">$${orderData.totalUsd.toFixed(2)}</span>
    </div>
  `;
}

function initPaymentMethods() {
  const methods = document.querySelectorAll('.payment-method');
  methods.forEach(method => {
    method.addEventListener('click', () => {
      methods.forEach(m => m.classList.remove('active'));
      method.classList.add('active');
      currentPaymentMethod = method.dataset.method;
      
      const cryptoDetails = document.getElementById('cryptoDetails');
      const paystackDetails = document.getElementById('paystackDetails');
      
      if (currentPaymentMethod === 'paystack') {
        if (cryptoDetails) cryptoDetails.style.display = 'none';
        if (paystackDetails) paystackDetails.style.display = 'block';
      } else {
        if (cryptoDetails) cryptoDetails.style.display = 'block';
        if (paystackDetails) paystackDetails.style.display = 'none';
        updateCryptoDetails();
      }
    });
  });
}

function updateCryptoDetails() {
  const cryptoDetails = document.getElementById('cryptoDetails');
  if (!cryptoDetails) return;
  
  if (currentPaymentMethod === 'usdt') {
    cryptoDetails.innerHTML = `
      <div style="background:rgba(0,243,255,0.05);border:1px solid rgba(0,243,255,0.3);border-radius:8px;padding:1rem;margin-top:1rem;">
        <div style="color:var(--cyber-neon);font-weight:600;margin-bottom:0.5rem;">USDT TRC20 Payment</div>
        <div style="color:var(--cyber-text);margin-bottom:0.75rem;">Send exactly <strong style="color:var(--cyber-neon);">$${(orderData?.totalUsd||0).toFixed(2)} USDT</strong> to:</div>
        <div style="background:var(--cyber-bg);padding:0.75rem;border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:0.875rem;color:var(--cyber-neon);word-break:break-all;margin-bottom:0.75rem;">
          ${orderData?.usdtAddress || 'Contact support for address'}
        </div>
        <div style="color:var(--cyber-muted);font-size:0.875rem;">Network: TRC20 (TRON)</div>
      </div>
    `;
  } else if (currentPaymentMethod === 'bitcoin') {
    cryptoDetails.innerHTML = `
      <div style="background:rgba(247,147,26,0.05);border:1px solid rgba(247,147,26,0.3);border-radius:8px;padding:1rem;margin-top:1rem;">
        <div style="color:#f7931a;font-weight:600;margin-bottom:0.5rem;">Bitcoin Payment</div>
        <div style="color:var(--cyber-text);margin-bottom:0.75rem;">Send exactly <strong style="color:#f7931a;">$${(orderData?.totalUsd||0).toFixed(2)}</strong> worth of BTC to:</div>
        <div style="background:var(--cyber-bg);padding:0.75rem;border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:0.875rem;color:#f7931a;word-break:break-all;margin-bottom:0.75rem;">
          ${orderData?.btcAddress || 'Contact support for address'}
        </div>
        <div style="color:var(--cyber-muted);font-size:0.875rem;">Network: Bitcoin</div>
      </div>
    `;
  }
}

function initForm() {
  const form = document.getElementById('paymentForm');
  if (!form) return;
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('customerEmail').value.trim();
    const name = document.getElementById('customerName').value.trim();
    const telegram = document.getElementById('telegramUsername').value.trim();
    
    if (!email || !name) {
      showMessage('Please fill in all required fields', 'error');
      return;
    }
    
    const submitBtn = document.getElementById('submitPayment');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';
    
    try {
      if (currentPaymentMethod === 'paystack') {
        await processPaystack(email, name, telegram);
      } else {
        await processCryptoPayment(email, name, telegram);
      }
    } catch (error) {
      showMessage(error.message || 'Payment failed', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Complete Payment';
    }
  });
}

async function processPaystack(email, name, telegram) {
  try {
    const response = await fetch('/api/paystack/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        amountUsd: orderData.totalUsd,
        name,
        cartItems: JSON.stringify(orderData.items)
      })
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to initialize payment');
    
    await createOrder(email, name, telegram, 'Paystack', data.reference);
    window.location.href = data.authorization_url;
  } catch (error) {
    throw error;
  }
}

async function processCryptoPayment(email, name, telegram) {
  try {
    const orderId = await createOrder(email, name, telegram, currentPaymentMethod === 'usdt' ? 'USDT' : 'Bitcoin');
    showMessage('Order created! Please send payment to the address shown above. Your order will be processed after confirmation.', 'success');
    setTimeout(() => {
      window.location.href = `/track.html?order=${encodeURIComponent(orderId)}&email=${encodeURIComponent(email)}`;
    }, 2000);
  } catch (error) {
    throw error;
  }
}

async function createOrder(email, name, telegram, paymentMethod, paymentRef = null) {
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: name,
        customerEmail: email,
        telegramUsername: telegram || null,
        paymentMethod: paymentMethod,
        paymentReference: paymentRef,
        items: orderData.items,
        totalUsd: orderData.totalUsd
      })
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to create order');
    sessionStorage.removeItem('dtd_order');
    return data.orderId;
  } catch (error) {
    throw error;
  }
}

function showMessage(message, type) {
  const messageEl = document.getElementById('paymentMessage');
  if (!messageEl) return;
  
  messageEl.innerHTML = `
    <div style="padding:0.75rem 1rem;border-radius:6px;margin-bottom:1rem;${type === 'error' ? 'background:rgba(255,0,85,0.1);border:1px solid rgba(255,0,85,0.3);color:var(--cyber-neon-red);' : 'background:rgba(0,255,136,0.1);border:1px solid rgba(0,255,136,0.3);color:var(--cyber-neon-green);'}">
      ${escapeHtml(message)}
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
