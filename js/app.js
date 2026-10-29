/* DTD Store - Unified App JS */

/* ============================================================
   CART STATE & INITIALIZATION
   ============================================================ */

// Cart state from localStorage or empty array
let cart = JSON.parse(localStorage.getItem('dtd_cart_new')) || [];

// Initialize app on DOM content
document.addEventListener('DOMContentLoaded', () => {
  // Show loading state while app initializes
  showLoadingState();
  
  // Check if we're on index page or other pages
  const path = window.location.pathname;
  const isIndexPage = (path === '/' || path.endsWith('/index.html') || path === '');
  
  if (isIndexPage) {
    // Index page: initialize everything
    initNavigation();
    initCart();
    renderFeaturedProducts();
    renderAllProducts();
    renderGatedProducts();
    initCategoryFilter();
    initSmoothScrolling();
    initCartBadgeAnimation();
    hideLoadingState();
  } else {
    // Other pages (payment.html, track.html, chat.html, admin.html etc)
    initCart();
    initMobileMenu();
    initNavigation();
    initCartBadgeAnimation();
    hideLoadingState();
  }
});

/* ============================================================
   NAVIGATION & MOBILE MENU
   ============================================================ */

function initMobileMenu() {
  const btnMenu = document.getElementById('btnMenuToggle');
  const btnClose = document.getElementById('btnNavClose');
  const sideNav = document.getElementById('sideNav');
  
  if (btnMenu && sideNav) {
    btnMenu.onclick = () => sideNav.classList.toggle('open');
  }
  if (btnClose && sideNav) {
    btnClose.onclick = () => sideNav.classList.remove('open');
  }
}

function initNavigation() {
  const navToggle = document.getElementById('navToggle');
  const navMenu = document.getElementById('navMenu');
  const navLinks = document.querySelectorAll('.nav-link');
  
  if (navToggle) {
    navToggle.addEventListener('click', () => {
      if (navMenu) navMenu.classList.toggle('active');
    });
  }
  
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      
      // Handle anchor links (smooth scroll)
      if (href && href.startsWith('#')) {
        e.preventDefault();
        navLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        
        if (navMenu) navMenu.classList.remove('active');
        
        const targetElement = document.querySelector(href);
        if (targetElement) {
          const navHeight = document.querySelector('.navbar')?.offsetHeight || 70;
          const targetPosition = targetElement.offsetTop - navHeight - 20;
          window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
          });
        }
      } else {
        // External link - just close mobile menu
        if (navMenu) navMenu.classList.remove('active');
      }
    });
  });
}

/* ============================================================
   CART FUNCTIONALITY
   ============================================================ */

function initCart() {
  const cartBtn = document.getElementById('cartBtn');
  const cartModal = document.getElementById('cartModal');
  const cartBackdrop = document.getElementById('cartBackdrop');
  const cartClose = document.getElementById('cartClose');
  
  // Cart button click - open modal
  if (cartBtn) {
    cartBtn.addEventListener('click', () => {
      renderCartModal();
      if (cartModal) cartModal.classList.add('active');
    });
  }
  
  // Backdrop click - close modal
  if (cartBackdrop) {
    cartBackdrop.addEventListener('click', () => {
      if (cartModal) cartModal.classList.remove('active');
    });
  }
  
  // Close button click - close modal
  if (cartClose) {
    cartClose.addEventListener('click', () => {
      if (cartModal) cartModal.classList.remove('active');
    });
  }
  
  // Update badge display
  updateCartBadge();
}

function updateCartBadge() {
  const badge = document.getElementById('cartBadge');
  if (!badge) return;
  
  // Calculate total quantity
  let total = 0;
  if (cart && Array.isArray(cart)) {
    cart.forEach(item => {
      if (item && item.quantity) {
        total += item.quantity;
      }
    });
  }
  
  // Update badge text and visibility
  badge.textContent = total;
  badge.style.display = total > 0 ? 'flex' : 'none';
  
  // Add subtle animation on click
  const cartBtn = document.getElementById('cartBtn');
  if (cartBtn) {
    cartBtn.addEventListener('click', () => {
      badge.style.transform = 'scale(1.2)';
      setTimeout(() => {
        badge.style.transform = 'scale(1)';
      }, 150);
    });
  }
}

// Add to cart function - called from product cards
function addToCart(productId) {
  // Find product in catalog
  const catalog = (typeof PRODUCT_CATALOG !== 'undefined') ? PRODUCT_CATALOG : [];
  const product = catalog.find(p => p && p.id === productId);
  
  if (!product) {
    // Product not found - show error and return
    showToast('Product not found');
    return;
  }
  
  // Add to cart array
  const existingItem = cart.find(item => item && item.id === product.id);
  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      quantity: 1
    });
  }
  
  // Persist to localStorage
  try {
    localStorage.setItem('dtd_cart_new', JSON.stringify(cart));
  } catch (e) {
    // localStorage full or disabled - continue anyway
  }
  
  // Update badge
  updateCartBadge();
  
  // Show success toast
  showToast('Added to cart');
  
  // Redirect to payment page with product data
  // This will be handled on payment.html
  const orderData = {
    items: [{
      product_id: product.id,
      product_name: product.name,
      quantity: 1,
      unit_price_usd: product.price
    }],
    totalUsd: product.price,
    usdtAddress: 'TN3W4H6rK2UMVEv7B4mRqG45nG5sPXsHmL',
    btcAddress: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
  };
  
  try {
    sessionStorage.setItem('dtd_order', JSON.stringify(orderData));
  } catch (e) {
    // sessionStorage full or disabled - continue anyway
  }
  
  // Redirect to payment page
  window.location.href = 'payment.html';
}

function removeFromCart(productId) {
  if (!cart || !Array.isArray(cart)) return;
  
  cart = cart.filter(item => item && item.id !== productId);
  try {
    localStorage.setItem('dtd_cart_new', JSON.stringify(cart));
  } catch (e) {}
  
  updateCartBadge();
  renderCartModal();
}

function updateCartQuantity(productId, delta) {
  if (!cart || !Array.isArray(cart)) return;
  
  const item = cart.find(item => item && item.id === productId);
  if (!item) return;
  
  item.quantity += delta;
  
  if (item.quantity <= 0) {
    removeFromCart(productId);
    return;
  }
  
  try {
    localStorage.setItem('dtd_cart_new', JSON.stringify(cart));
  } catch (e) {}
  
  updateCartBadge();
  renderCartModal();
}

/* ============================================================
   CHECKOUT FUNCTIONALITY
   ============================================================ */

function checkoutCart() {
  // Check if cart has items
  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    showToast('Cart is empty');
    return;
  }
  
  // Build order data from cart
  const orderData = {
    items: cart.map(item => ({
      product_id: item.id || item.name || '',
      product_name: item.name || 'Product',
      quantity: item.quantity || 1,
      unit_price_usd: item.price || 0
    })),
    totalUsd: cart.reduce((sum, item) => {
      if (item && item.price && item.quantity) {
        return sum + (item.price * item.quantity);
      }
      return sum;
    }, 0),
    usdtAddress: 'TN3W4H6rK2UMVEv7B4mRqG45nG5sPXsHmL',
    btcAddress: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
  };
  
  // Persist order data
  try {
    sessionStorage.setItem('dtd_order', JSON.stringify(orderData));
  } catch (e) {}
  
  // Clear cart from localStorage
  try {
    localStorage.removeItem('dtd_cart_new');
  } catch (e) {}
  
  // Clear cart array
  cart = [];
  
  // Update badge
  updateCartBadge();
  
  // Redirect to payment confirmation/tracking page
  window.location.href = 'payment.html';
}

// Payment form submission handler
function initPaymentForm() {
  const paymentForm = document.getElementById('paymentForm');
  if (!paymentForm) return;
  
  paymentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Get form values
    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value;
    const customerName = document.getElementById('customerName')?.value?.trim() || '';
    const customerEmail = document.getElementById('customerEmail')?.value?.trim() || '';
    const telegramUsername = document.getElementById('telegramUsername')?.value?.trim() || '';
    
    // Validation
    if (!paymentMethod) {
      showToast('Please select a payment method');
      return;
    }
    
    // Show loading state on submit button
    const submitBtn = document.getElementById('submitPayment');
    if (submitBtn) {
      const originalText = submitBtn.textContent;
      submitBtn.textContent = 'Processing...';
      submitBtn.disabled = true;
    }
    
    // Send order data to backend
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          customerName,
          customerEmail,
          telegramUsername,
          paymentMethod
        })
      });
      
      const result = await response.json();
      
      // Hide loading state
      if (submitBtn) {
        submitBtn.textContent = 'Complete Payment';
        submitBtn.disabled = false;
      }
      
      if (result && result.ok && result.order_id) {
        // Success - redirect to track page
        window.location.href = `track.html?order=${result.order_id}`;
      } else {
        // Failure - show error
        showToast('Payment failed: ' + (result?.error || 'Unknown error'));
      }
    } catch (error) {
      // Hide loading state
      if (submitBtn) {
        submitBtn.textContent = 'Complete Payment';
        submitBtn.disabled = false;
      }
      showToast('Error connecting to server. Please try again.');
      console.error('Payment submit error:', error);
    }
  });
}

/* ============================================================
   PRODUCT RENDERING
   ============================================================ */

function createProductCard(product, isFeatured) {
  // Safe access to badge class
  const badgeClass = product && product.badgeColor 
    ? (product.badgeColor === 'danger' ? 'badge-danger' 
       : product.badgeColor === 'warning' ? 'badge-warning' 
       : product.badgeColor === 'info' ? 'badge-info' : 'badge-accent')
    : 'badge-accent';
  
  const gatedBadge = product && product.gated 
    ? '<span class="gated-lock"><i class="fas fa-lock"></i></span>'
    : '';
  
  const badgeColorMap = {
    danger: 'rgba(239, 68, 68, 0.1)',
    warning: 'rgba(245, 158, 11, 0.1)', 
    info: 'rgba(6, 182, 212, 0.1)',
    accent: 'rgba(59, 130, 246, 0.1)'
  };
  const badgeBackground = badgeColorMap[product && product.badgeColor] || 'rgba(59, 130, 246, 0.1)';
  
  return `
    <div class="product-card" data-product-id="${product && product.id || ''}">
      <div class="product-image-container">
        <img src="${product && product.image || 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=800&h=600&fit=crop'}" 
             alt="${product && product.name || 'Product'}" 
             class="product-image" 
             loading="lazy"
             onerror="this.src='https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=800&h=600&fit=crop'">
        <span class="product-badge ${badgeClass}" style="background: ${background}">${product && product.badge || 'BADGE'}</span>
        ${gatedBadge}
      </div>
      <div class="product-content">
        <div class="product-category">${product && getCategoryName(product.category) || 'Category'}</div>
        <h3 class="product-name">${product && escapeHtml(product.name) || 'Product Name'}</h3>
        <p class="product-description">${product && escapeHtml(product.description) || 'Product description goes here. This is a premium digital product available for purchase with various payment methods.'}</p>
        <div class="product-footer">
          <div class="product-price">$${product && product.price !== undefined ? product.price.toFixed(2) : '0.00'}</div>
          ${product && product.gated 
            ? '<button onclick="addToCart(' + product.id + ')" class="btn btn-sm btn-primary">Unlock</button>'
            : '<button onclick="addToCart(' + product.id + ')" class="btn btn-sm btn-primary">\
              <i class="fas fa-credit-card"></i>\
              Buy Now</button>'
          }
        </div>
      </div>
    </div>
  `;
}

function getCategoryName(category) {
  const categories = {
    infrastructure: 'Infrastructure / SMTP',
    storage: 'Storage / Vaults', 
    accounts: 'Accounts / Domains',
    rdp: 'RDP / VPS / Remote',
    ai: 'AI Tools',
    gated: 'Gated / Premium',
    all: 'All Products'
  };
  return categories[category] || category;
}

function initCategoryFilter() {
  const categoryBtns = document.querySelectorAll('.category-btn');
  
  if (!categoryBtns || categoryBtns.length === 0) return;
  
  categoryBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all buttons
      categoryBtns.forEach(b => b.classList.remove('active'));
      
      // Add active class to clicked button
      btn.classList.add('active');
      
      // Get category filter value
      const category = btn.getAttribute('data-category') || 'all';
      
      // Re-render products with filter
      renderAllProducts(category);
    });
  });
}

// Smooth scrolling for anchor links
function initSmoothScrolling() {
  const links = document.querySelectorAll('a[href^="#"]');
  
  links.forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      
      // Skip if hash is just '#'
      if (!href || href === '#') return;
      
      // Prevent default only for internal links
      if (href.startsWith('#') && !href.includes(window.location.host)) {
        return;
      }
      
      e.preventDefault();
      
      const targetId = href;
      const targetElement = document.querySelector(href);
      
      if (targetElement) {
        const navHeight = document.querySelector('.navbar')?.offsetHeight || 70;
        const targetPosition = targetElement.offsetTop - navHeight - 20;
        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
}

/* ============================================================
   TOAST NOTIFICATION
   ============================================================ */

function showToast(message) {
  // Remove existing toast if any
  const existingToast = document.querySelector('.toast');
  if (existingToast) {
    existingToast.remove();
  }
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <i class="fas fa-check-circle"></i>
    <span>${message}</span>
  `;
  document.body.appendChild(toast);
  
  // Show toast
  setTimeout(() => toast.classList.add('show'), 100);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Escape HTML special characters
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* ============================================================
   INITIALIZE ON PAGE LOAD
   ============================================================ */

// Render featured products on index page
function renderFeaturedProducts() {
  const catalog = (typeof PRODUCT_CATALOG !== 'undefined') ? PRODUCT_CATALOG : [];
  const featuredProducts = catalog.filter(p => p && p.featured === true);
  const grid = document.getElementById('featuredGrid');
  if (!grid || !featuredProducts.length) return;
  
  grid.innerHTML = featuredProducts.map(product => createProductCard(product, true)).join('');
}

// Render all products on index page
function renderAllProducts(filterCategory = 'all') {
  const catalog = (typeof PRODUCT_CATALOG !== 'undefined') ? PRODUCT_CATALOG : [];
  const categoryMap = {
    infrastructure: 'infrastructure',
    storage: 'storage', 
    accounts: 'accounts',
    rdp: 'rdp',
    ai: 'ai',
    gated: 'gated',
    all: 'all'
  };
  const category = categoryMap[filterCategory] || 'all';
  
  let productsToShow;
  if (category === 'all') {
    productsToShow = catalog.filter(p => p && p.gated !== true);
  } else {
    productsToShow = catalog.filter(p => p && p.category === category && p.gated !== true);
  }
  
  const grid = document.getElementById('productsGrid');
  if (!grid || !productsToShow.length) return;
  
  grid.innerHTML = productsToShow.map(product => createProductCard(product, false)).join('');
}

// Render gated/premium products on index page
function renderGatedProducts() {
  const catalog = (typeof PRODUCT_CATALOG !== 'undefined') ? PRODUCT_CATALOG : [];
  const gatedProducts = catalog.filter(p => p && p.gated === true);
  const grid = document.getElementById('gatedProductsGrid');
  if (!grid || !gatedProducts.length) return;
  
  grid.innerHTML = gatedProducts.map(product => createProductCard(product, false)).join('');
}

// Make functions globally available for HTML onclick handlers
window.addToCart = addToCart;
window.removeFromCart = removeFromCart;
window.updateCartQuantity = updateCartQuantity;
window.checkoutCart = checkoutCart;
window.initPaymentForm = initPaymentForm;

/* Initialize payment form on payment page */
document.addEventListener('DOMContentLoaded', () => {
  initPaymentForm();
  initCartBadgeAnimation();
  
  // Render products only on index page
  const path = window.location.pathname;
  const isIndexPage = (path === '/' || path.endsWith('/index.html') || path === '');
  if (isIndexPage) {
    renderFeaturedProducts();
    renderAllProducts();
    renderGatedProducts();
    initCategoryFilter();
  }
});