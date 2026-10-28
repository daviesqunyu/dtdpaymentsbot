// DTD Store Track Order Page
document.addEventListener('DOMContentLoaded', () => {
  initTrack();
});

function initTrack() {
  const form = document.getElementById('trackForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await trackOrder();
    });
  }
  
  // Check URL params
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order');
  const email = params.get('email');
  if (orderId && email) {
    document.getElementById('trackOrderId').value = orderId;
    document.getElementById('trackEmail').value = email;
    trackOrder();
  }
}

async function trackOrder() {
  const orderId = document.getElementById('trackOrderId').value.trim();
  const email = document.getElementById('trackEmail').value.trim();
  const resultEl = document.getElementById('trackResult');
  
  if (!orderId || !email) {
    resultEl.innerHTML = '<div style="background:rgba(255,0,85,0.1);border:1px solid rgba(255,0,85,0.3);color:var(--cyber-neon-red);padding:0.75rem 1rem;border-radius:6px;">Please enter both Order ID and Email</div>';
    return;
  }
  
  resultEl.innerHTML = '<div style="color:var(--cyber-muted);">Checking...</div>';
  
  try {
    const response = await fetch(`/api/orders/status?orderId=${encodeURIComponent(orderId)}&email=${encodeURIComponent(email)}`);
    const data = await response.json();
    
    if (!response.ok) {
      resultEl.innerHTML = `<div style="background:rgba(255,0,85,0.1);border:1px solid rgba(255,0,85,0.3);color:var(--cyber-neon-red);padding:0.75rem 1rem;border-radius:6px;">${escapeHtml(data.error || 'Order not found')}</div>`;
      return;
    }
    
    resultEl.innerHTML = `
      <div class="card" style="margin-top:1.5rem;padding:1.5rem;">
        <div style="color:var(--cyber-neon);font-weight:600;margin-bottom:1rem;font-size:1.125rem;">Order Status</div>
        <div style="display:grid;gap:0.75rem;">
          <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--cyber-border);">
            <span style="color:var(--cyber-muted);">Order ID</span>
            <span style="color:var(--cyber-text);font-family:'JetBrains Mono',monospace;">${escapeHtml(data.order.id)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--cyber-border);">
            <span style="color:var(--cyber-muted);">Status</span>
            <span style="color:${getStatusColor(data.order.order_status)};font-weight:600;">${escapeHtml(data.order.order_status || 'pending')}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--cyber-border);">
            <span style="color:var(--cyber-muted);">Payment</span>
            <span style="color:${data.order.payment_status === 'paid' ? 'var(--cyber-neon-green)' : 'var(--cyber-muted)'};font-weight:600;">${escapeHtml(data.order.payment_status || 'pending')}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--cyber-border);">
            <span style="color:var(--cyber-muted);">Total</span>
            <span style="color:var(--cyber-neon);font-family:'JetBrains Mono',monospace;">$${Number(data.order.total_usd || 0).toFixed(2)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:0.5rem 0;">
            <span style="color:var(--cyber-muted);">Payment Method</span>
            <span style="color:var(--cyber-text);">${escapeHtml(data.order.payment_method || 'N/A')}</span>
          </div>
        </div>
        ${data.order.delivery_details ? `<div style="margin-top:1rem;padding:0.75rem;background:rgba(0,243,255,0.05);border:1px solid rgba(0,243,255,0.2);border-radius:6px;"><div style="color:var(--cyber-neon);font-weight:600;margin-bottom:0.5rem;">Delivery Info</div><div style="color:var(--cyber-text);white-space:pre-wrap;font-size:0.875rem;">${escapeHtml(data.order.delivery_details)}</div></div>` : ''}
      </div>
    `;
  } catch (error) {
    resultEl.innerHTML = `<div style="background:rgba(255,0,85,0.1);border:1px solid rgba(255,0,85,0.3);color:var(--cyber-neon-red);padding:0.75rem 1rem;border-radius:6px;">Error: ${escapeHtml(error.message)}</div>`;
  }
}

function getStatusColor(status) {
  status = (status || '').toLowerCase();
  if (status === 'completed' || status === 'delivered') return 'var(--cyber-neon-green)';
  if (status === 'processing' || status === 'confirmed') return 'var(--cyber-neon)';
  if (status === 'cancelled') return 'var(--cyber-neon-red)';
  return 'var(--cyber-muted)';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
