// DTD Store DTDSHOP.CC Gated Catalog Page
document.addEventListener('DOMContentLoaded', () => {
  initDtdShopcc();
});

function initDtdShopcc() {
  // Check if user has verified deposit
  const verified = localStorage.getItem('dtd_verified_deposit');
  if (!verified) {
    showGatedWelcome();
    return;
  }
  
  loadGatedProducts();
}

function showGatedWelcome() {
  const mainEl = document.getElementById('mainContent');
  if (!mainEl) return;
  
  mainEl.innerHTML = `
    <div style="max-width:700px;margin:0 auto;padding:2rem 1rem;">
      <div class="eyebrow"><span class="kicker-dot"></span>DTDSHOP.CC</div>
      <h1 class="page-title" style="text-align:center;">Premium Gated Catalog</h1>
      <p class="page-subtitle mb-4" style="text-align:center;">Secure Access Required</p>
      
      <div style="background:rgba(255,0,85,0.05);border:1px solid rgba(255,0,85,0.3);border-radius:8px;padding:1.5rem;margin:1.5rem 0;">
        <div style="color:#ff4d4d;font-weight:600;margin-bottom:0.5rem;">🔒 Gated Access</div>
        <div style="color:var(--cyber-text);">Minimum $5 USDT or BTC verified deposit required to unlock premium products</div>
      </div>
      
      <div style="text-align:center;">
        <button onclick="window.location.href='/payment.html'" class="btn btn-primary btn-block" style="width:100%;padding:0.75rem;background:var(--cyber-neon);color:var(--cyber-bg);border:none;border-radius:6px;font-weight:600;">
          Make Deposit
        </button>
      </div>
    </div>
  `;
}

async function loadGatedProducts() {
  const mainEl = document.getElementById('mainContent');
  if (!mainEl) return;
  
  mainEl.innerHTML = `
    <div style="max-width:700px;margin:0 auto;padding:1rem;">
      <div class="eyebrow"><span class="kicker-dot"></span>DTDSHOP.CC</div>
      <h1 class="page-title">Gated Products</h1>
      <p class="page-subtitle">Premium products unlocked with verified $5+ deposit</p>
      
      <div id="gatedProductsLoading" style="text-align:center;padding:2rem;color:var(--cyber-muted);">Loading products...</div>
      <div id="gatedProductsGrid" style="margin-top:1rem;"></div>
    </div>
  `;
  
  try {
    const res = await fetch('/api/config', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    const config = await res.json();
    
    if (config && config.products && config.products.length > 0) {
      renderGatedProducts(config.products);
    } else {
      mainEl.innerHTML = '<p style="color:var(--cyber-muted);text-align:center;">No gated products available</p>';
    }
  } catch (err) {
    console.error(err);
    mainEl.innerHTML = '<p style="color:var(--cyber-red);text-align:center;">Failed to load catalog</p>';
  }
}

function renderGatedProducts(products) {
  const grid = document.getElementById('gatedProductsGrid');
  if (!grid) return;
  
  grid.innerHTML = products.map(product => `
    <div class="gated-product-card" style="background:var(--cyber-bg);border:1px solid var(--cyber-border);border-radius:8px;padding:1rem;margin-bottom:1rem;">
      <div class="gated-product-header" style="height:180px;background:var(--cyber-bg);border-radius:6px 6px 0 0;overflow:hidden;">
        <img src="${product.image || 'https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&h=600&fit=crop'}" 
             alt="${product.name}" 
             style="width:100%;height:100%;object-fit:cover;">
        <span class="gated-badge" style="position:absolute;top:8px;left:8px;background:rgba(255,0,85,0.8);color:white;padding:2px 6px;border-radius:4px;font-size:0.65rem;">
          <i class="fas fa-lock"></i> GATED
        </span>
      </div>
      <div class="gated-product-body" style="padding:0.75rem;">
        <h4 class="gated-product-name" style="color:var(--cyber-neon);font-size:1rem;margin-bottom:0.25rem;">${escapeHtml(product.name)}</h4>
        <p class="gated-product-desc" style="color:var(--cyber-muted);font-size:0.813rem;margin-bottom:0.5rem;line-height:1.4;">${escapeHtml(product.description)}</p>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="gated-product-price" style="color:var(--cyber-neon);font-weight:600;font-size:1.125rem;">$${Number(product.price_usd||product.price||0).toFixed(2)}</span>
          <button onclick="unlockProduct('${product.id}')" class="btn btn-sm btn-primary" style="background:var(--cyber-neon);color:var(--cyber-bg);border:none;padding:0.25rem 0.5rem;border-radius:4px;font-size:0.75rem;">Unlock</button>
        </div>
      </div>
    </div>
  `).join('');
}

function unlockProduct(productId) {
  if (confirm('This will redirect you to payment. Minimum $5 deposit required.')) {
    window.location.href = '/payment.html';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}