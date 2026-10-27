/* DTD Store - New Unified App JS */

// Cart state
let cart = JSON.parse(localStorage.getItem('dtd_cart_new') || '[]');

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initCart();
  renderFeaturedProducts();
  renderAllProducts();
  renderGatedProducts();
  initCategoryFilter();
  initSmoothScrolling();
});

// Navigation
function initNavigation() {
  const navToggle = document.getElementById('navToggle');
  const navMenu = document.getElementById('navMenu');
  const navLinks = document.querySelectorAll('.nav-link');
  
  if (navToggle) {
    navToggle.addEventListener('click', () => {
      navMenu.classList.toggle('active');
    });
  }
  
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      if (link.getAttribute('href').startsWith('#')) {
        e.preventDefault();
        navLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        navMenu.classList.remove('active');
        
        const targetId = link.getAttribute('href');
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
          const navHeight = document.querySelector('.navbar').offsetHeight;
          const targetPosition = targetElement.offsetTop - navHeight - 20;
          window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
          });
        }
      } else {
        navMenu.classList.remove('active');
      }
    });
  });
}

// Cart
function initCart() {
  const cartBtn = document.getElementById('cartBtn');
  const cartModal = document.getElementById('cartModal');
  const cartBackdrop = document.getElementById('cartBackdrop');
  const cartClose = document.getElementById('cartClose');
  
  if (cartBtn) {
    cartBtn.addEventListener('click', () => {
      renderCartModal();
      cartModal.classList.add('active');
    });
  }
  
  if (cartBackdrop) {
    cartBackdrop.addEventListener('click', () => {
      cartModal.classList.remove('active');
    });
  }
  
  if (cartClose) {
    cartClose.addEventListener('click', () => {
      cartModal.classList.remove('active');
    });
  }
  
  updateCartBadge();
}

function updateCartBadge() {
  const badge = document.getElementById('cartBadge');
  if (badge) {
    const total = cart.reduce((sum, item) => sum + item.quantity, 0);
    badge.textContent = total;
    badge.style.display = total > 0 ? 'flex' : 'none';
  }
}

function addToCart(productId) {
  const product = PRODUCT_CATALOG.find(p => p.id === productId);
  if (!product) return;
  
  const existing = cart.find(item => item.id === productId);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id: productId,
      name: product.name,
      price: product.price,
      image: product.image,
      quantity: 1
    });
  }
  
  localStorage.setItem('dtd_cart_new', JSON.stringify(cart));
  updateCartBadge();
  
  // Show feedback
  showToast('Added to cart!');
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.id !== productId);
  localStorage.setItem('dtd_cart_new', JSON.stringify(cart));
  updateCartBadge();
  renderCartModal();
}

function updateCartQuantity(productId, delta) {
  const item = cart.find(item => item.id === productId);
  if (!item) return;
  
  item.quantity += delta;
  if (item.quantity <= 0) {
    removeFromCart(productId);
    return;
  }
  
  localStorage.setItem('dtd_cart_new', JSON.stringify(cart));
  updateCartBadge();
  renderCartModal();
}

function renderCartModal() {
  const modalBody = document.getElementById('cartModalBody');
  const cartTotal = document.getElementById('cartTotal');
  
  if (!modalBody) return;
  
  if (cart.length === 0) {
    modalBody.innerHTML = `
      <div class="cart-empty">
        <i class="fas fa-shopping-cart"></i>
        <p>Your cart is empty</p>
      </div>
    `;
    if (cartTotal) cartTotal.textContent = '$0.00';
    return;
  }
  
  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  if (cartTotal) cartTotal.textContent = '$' + total.toFixed(2);
  
  modalBody.innerHTML = cart.map(item => `
    <div class="cart-item">
      <img src="${item.image}" alt="${item.name}" class="cart-item-image">
      <div class="cart-item-details">
        <div class="cart-item-name">${escapeHtml(item.name)}</div>
        <div class="cart-item-price">$${item.price.toFixed(2)}</div>
        <div class="cart-item-controls">
          <button class="qty-btn" onclick="updateCartQuantity('${item.id}', -1)">
            <i class="fas fa-minus"></i>
          </button>
          <span class="qty-display">${item.quantity}</span>
          <button class="qty-btn" onclick="updateCartQuantity('${item.id}', 1)">
            <i class="fas fa-plus"></i>
          </button>
          <button class="remove-btn" onclick="removeFromCart('${item.id}')">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

// Render products
function renderFeaturedProducts() {
  const grid = document.getElementById('featuredGrid');
  if (!grid) return;
  
  const featured = PRODUCT_CATALOG.filter(p => p.featured).slice(0, 4);
  
  grid.innerHTML = featured.map(product => createProductCard(product, true)).join('');
}

function renderAllProducts(category = 'all') {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  
  let products = PRODUCT_CATALOG;
  if (category !== 'all') {
    products = PRODUCT_CATALOG.filter(p => p.category === category && !p.gated);
  } else {
    products = PRODUCT_CATALOG.filter(p => !p.gated);
  }
  
  grid.innerHTML = products.map(product => createProductCard(product, false)).join('');
}

function renderGatedProducts() {
  const grid = document.getElementById('gatedProductsGrid');
  if (!grid) return;
  
  const gated = PRODUCT_CATALOG.filter(p => p.gated);
  
  grid.innerHTML = gated.map(product => `
    <div class="gated-product-card">
      <div class="gated-product-header">
        <img src="${product.image}" alt="${product.name}" class="gated-product-image">
        <span class="gated-badge">
          <i class="fas fa-lock"></i>
          GATED
        </span>
      </div>
      <div class="gated-product-body">
        <h4 class="gated-product-name">${escapeHtml(product.name)}</h4>
        <p class="gated-product-desc">${escapeHtml(product.description)}</p>
        <div class="gated-product-footer">
          <span class="gated-product-price">$${product.price.toFixed(2)}</span>
          <a href="payment.html" class="btn btn-sm btn-primary">Unlock</a>
        </div>
      </div>
    </div>
  `).join('');
}

function createProductCard(product, isFeatured) {
  const badgeClass = product.badgeColor === 'danger' ? 'badge-danger' : 
                     product.badgeColor === 'warning' ? 'badge-warning' :
                     product.badgeColor === 'info' ? 'badge-info' : 'badge-accent';
  
  return `
    <div class="product-card" data-product-id="${product.id}">
      <div class="product-image-container">
        <img src="${product.image}" alt="${product.name}" class="product-image" loading="lazy">
        <span class="product-badge ${badgeClass}">${product.badge}</span>
        ${product.gated ? '<span class="gated-lock"><i class="fas fa-lock"></i></span>' : ''}
      </div>
      <div class="product-content">
        <div class="product-category">${getCategoryName(product.category)}</div>
        <h3 class="product-name">${escapeHtml(product.name)}</h3>
        <p class="product-description">${escapeHtml(product.description)}</p>
        <div class="product-footer">
          <div class="product-price">$${product.price.toFixed(2)}</div>
          ${product.gated ? 
            `<a href="payment.html" class="btn btn-sm btn-primary">Unlock</a>` :
            `<button class="btn btn-sm btn-primary" onclick="addToCart('${product.id}')">
              <i class="fas fa-cart-plus"></i>
              Add to Cart
            </button>`
          }
        </div>
      </div>
    </div>
  `;
}

function getCategoryName(category) {
  const cat = CATEGORIES.find(c => c.id === category);
  return cat ? cat.name : category;
}

// Category filter
function initCategoryFilter() {
  const categoryBtns = document.querySelectorAll('.category-btn');
  
  categoryBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      categoryBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const category = btn.getAttribute('data-category');
      renderAllProducts(category);
    });
  });
}

// Smooth scrolling
function initSmoothScrolling() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#') return;
      
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        const navHeight = document.querySelector('.navbar').offsetHeight;
        const targetPosition = target.offsetTop - navHeight - 20;
        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
}

// Toast notification
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <i class="fas fa-check-circle"></i>
    <span>${escapeHtml(message)}</span>
  `;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.classList.add('show'), 100);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make functions global
window.addToCart = addToCart;
window.removeFromCart = removeFromCart;
window.updateCartQuantity = updateCartQuantity;
