/* ═══════════════════════════════════════════════════════════════
   CHROME NOIR — MAIN SCRIPT v2.0
   Real-time product sync · Full checkout · Order tracking
   Backend: Backendless only (via backendless-config.js)
═══════════════════════════════════════════════════════════════ */

/* ── TELEGRAM CONFIG ─────────────────────────────────────────── */
const TELEGRAM_TOKEN   = '';
const TELEGRAM_CHAT_ID = '';
const BKASH_NUMBER     = '01700000000'; // Update with real bKash number

/* ── DELIVERY CHARGES ────────────────────────────────────────── */
const DELIVERY_CHARGES = {
  'Dhaka': 80, 'Barishal': 150, 'Chattogram': 150,
  'Khulna': 150, 'Mymensingh': 150, 'Rajshahi': 150,
  'Rangpur': 150, 'Sylhet': 150
};

/* ── POLL INTERVAL (ms) ─────────────────────────────────────── */
const POLL_INTERVAL = 10000; // 30 seconds real-time sync

/* ══════════════════════════════════════════════════════════════
   PRODUCT STORE — Single source of truth
══════════════════════════════════════════════════════════════ */
let productStore      = {};
let currentProduct    = null;
let currentSize       = '';
let currentColor      = '';
let currentImageIndex = 0;
let _pollTimer        = null;
let _isSubmitting     = false; // prevent duplicate orders

/* ── Local session state ───────────────────────────────────── */
let cart   = JSON.parse(localStorage.getItem('cnCart'))   || [];
let orders = JSON.parse(localStorage.getItem('cnOrders')) || [];
let selectedPayment = 'cod';

/* ════════════════════════════════════════════════════════════
   NORMALIZE DB ROW → product object
   Handles images stored as separate fields (main_image, image1,
   image2) OR as legacy JSON string array.
════════════════════════════════════════════════════════════ */
function normalizeProduct(row) {
  /* ── images ───────────────────────────────────────────── */
  let images = [];

  // Priority: main_image + image1 + image2 fields
  if (row.main_image) {
    images.push(row.main_image.trim());
    if (row.image1 && row.image1.trim()) images.push(row.image1.trim());
    if (row.image2 && row.image2.trim()) images.push(row.image2.trim());
  } else if (row.images) {
    // Legacy: JSON string array
    try { images = JSON.parse(row.images); } catch { images = [row.images]; }
  } else if (row.image) {
    images = [row.image];
  }

  // Filter empty/invalid entries
  images = images.filter(u => u && u.startsWith('http'));
  if (!images.length) images = [''];

  /* ── sizes ────────────────────────────────────────────── */
  let sizes = ['S', 'M', 'L', 'XL'];
  if (row.sizes) {
    sizes = typeof row.sizes === 'string'
      ? row.sizes.split(',').map(s => s.trim()).filter(Boolean)
      : (Array.isArray(row.sizes) ? row.sizes : sizes);
  }

  /* ── colors ───────────────────────────────────────────── */
  let colors = [];
  if (row.colors) {
    colors = typeof row.colors === 'string'
      ? row.colors.split(',').map(c => c.trim()).filter(Boolean)
      : (Array.isArray(row.colors) ? row.colors : []);
  }

  return {
    id:       row.objectId,
    name:     row.name        || 'Untitled',
    price:    parseFloat(row.price)     || 0,
    oldPrice: parseFloat(row.old_price) || 0,
    category: (row.category   || 'Collection').toLowerCase(),
    badge:    row.badge       || '',
    stock:    row.stock       || 'in_stock',
    desc:     row.description || '',
    details:  row.details     || '',
    tags:     row.tags        || '',
    images,
    sizes,
    colors,
    created:  row.created || 0
  };
}

/* ══════════════════════════════════════════════════════════════
   LOAD PRODUCTS — fetch from Backendless, populate store
   Called on init + every POLL_INTERVAL seconds for real-time sync
══════════════════════════════════════════════════════════════ */
async function loadProducts(silent = false) {
  try {
    const rows = await Backendless.get('products', '?sortBy=created%20DESC&pageSize=100');

    // Rebuild store
    const newStore = {};
    rows.forEach(row => {
      const p = normalizeProduct(row);
      newStore[p.id] = p;
    });

    // Only re-render if data actually changed
    const changed = JSON.stringify(newStore) !== JSON.stringify(productStore);
    productStore = newStore;

    if (changed || !silent) {
      renderHomeGrid();
      renderShopGrid(currentShopFilter);
    }
  } catch (err) {
    if (!silent) console.error('[] Product load error:', err);
  }
}

/* ── Start polling ───────────────────────────────────────── */
function startProductPolling() {
  clearInterval(_pollTimer);
  _pollTimer = setInterval(() => loadProducts(true), POLL_INTERVAL);
}

/* ── Current shop filter ─────────────────────────────────── */
let currentShopFilter = 'all';

/* ══════════════════════════════════════════════════════════════
   HOME — FEATURED GRID (first 10 products)
   Container: #home-featured-grid
══════════════════════════════════════════════════════════════ */
function renderHomeGrid() {
  const grid = document.getElementById('home-featured-grid');
  if (!grid) return;

  const items = Object.values(productStore).slice(0, 10);

  if (!items.length) {
    grid.innerHTML = `<div class="col-span-4 py-12 text-center text-xs font-mono text-[var(--chrome-dark)] tracking-[.2em] uppercase">Collection coming soon</div>`;
    return;
  }

  grid.innerHTML = items.map((p, idx) => buildProductCard(p, idx === 3)).join('');
  setTimeout(initScrollFade, 80);
}

/* ══════════════════════════════════════════════════════════════
   SHOP PAGE — FULL GRID (all products)
   Container: #shop-grid
══════════════════════════════════════════════════════════════ */
function renderShopGrid(filter = 'all') {
  currentShopFilter = filter;
  const grid = document.getElementById('shop-grid');
  if (!grid) return;

  let items = Object.values(productStore);
  if (filter !== 'all') {
    items = items.filter(p => p.category === filter.toLowerCase());
  }

  if (!items.length) {
    grid.innerHTML = `<div class="col-span-4 py-16 text-center text-xs font-mono text-[var(--chrome-dark)] tracking-[.2em] uppercase">No products in this category</div>`;
    return;
  }

  grid.innerHTML = items.map(p => buildProductCard(p, false, true)).join('');
  setTimeout(initScrollFade, 80);
}

/* ── Build single product card HTML ─────────────────────── */
function buildProductCard(p, large = false, showStock = false) {
  const imgSrc   = p.images[0] || '';
  const badge    = p.badge    ? `<span class="prod-badge">${sanitize(p.badge)}</span>` : '';
  const oldPrice = p.oldPrice ? `<span class="old-price">৳${p.oldPrice}</span>` : '';

  let stockBadge = '';
  if (showStock) {
    if (p.stock === 'out_of_stock') stockBadge = `<span class="stock-badge out">Sold Out</span>`;
    else if (p.stock === 'low_stock') stockBadge = `<span class="stock-badge low">Low Stock</span>`;
  }

  const outOfStock  = p.stock === 'out_of_stock';
  const cartBtnAttr = outOfStock ? 'disabled style="opacity:.3;cursor:not-allowed"' : '';

  return `
    <div class="product-card rounded-xl p-3 group scroll-fade${large ? ' md:row-span-2 flex flex-col' : ''}"
         onclick="showDetail('${p.id}')" data-category="${sanitize(p.category)}">
      <div class="relative mb-3${large ? ' flex-1' : ''}">
        <div class="img-placeholder w-full ${large ? 'h-full min-h-[200px] md:min-h-[280px]' : 'aspect-[4/5]'} rounded-lg flex items-center justify-center overflow-hidden">
          ${imgSrc
            ? `<img src="${sanitize(imgSrc)}" alt="${sanitize(p.name)}" loading="lazy"
                 class="w-full h-full object-cover rounded-lg transition-transform duration-700 group-hover:scale-105"
                 onerror="this.style.display='none'">`
            : ''}
        </div>
        <button class="icon-btn absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300" aria-label="Wishlist">
          <svg width="12" height="12" fill="none" stroke="var(--chrome)" stroke-width="1.5" viewBox="0 0 24 24">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
          </svg>
        </button>
        ${badge}${stockBadge}
      </div>
      <p class="text-sm text-white font-mono truncate mb-0.5">${sanitize(p.name)}</p>
      <p class="text-xs text-[var(--chrome-dark)] font-mono mb-2 capitalize">${sanitize(p.category)}</p>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1 flex-wrap">
          ${oldPrice}
          <span class="text-sm font-playfair font-bold text-white">৳${p.price.toLocaleString()}</span>
        </div>
        <button class="icon-btn w-7 h-7 rounded-lg flex items-center justify-center hover:scale-110 transition-transform"
          ${cartBtnAttr}
          onclick="event.stopPropagation();quickAddToCart('${p.id}')" aria-label="Add to cart">
          <svg width="12" height="12" fill="none" stroke="var(--chrome)" stroke-width="1.5" viewBox="0 0 24 24">
            <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

/* ── Quick add (first available size) ───────────────────── */
window.quickAddToCart = function(id) {
  const p = productStore[id];
  if (!p || p.stock === 'out_of_stock') return;
  const size  = p.sizes[0]  || 'M';
  const color = p.colors[0] || '';
  addToCart(id, p.name, p.price, size, color, p.images[0]);
};

/* ── Filter products (shop page) ────────────────────────── */
window.filterProducts = function(cat, btn) {
  renderShopGrid(cat);
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('selected'));
  if (btn) btn.classList.add('selected');
};

/* ══════════════════════════════════════════════════════════════
   PRODUCT DETAIL PAGE
══════════════════════════════════════════════════════════════ */
window.showDetail = function(id) {
  const p = productStore[id];
  if (!p) return;

  currentProduct    = p;
  currentSize       = p.sizes[0]  || 'M';
  currentColor      = p.colors[0] || '';
  currentImageIndex = 0;

  // Breadcrumb + meta
  _setTxt('detail-breadcrumb', p.name);
  _setTxt('detail-category',   p.category);
  _setTxt('detail-name',       p.name);
  _setTxt('detail-desc',       p.desc);

  // Price
  const priceEl = document.getElementById('detail-price');
  if (priceEl) {
    priceEl.innerHTML = p.oldPrice
      ? `৳${p.price.toLocaleString()} <span style="font-size:.7em;font-weight:400;color:var(--chrome-dark);text-decoration:line-through;margin-left:8px">৳${p.oldPrice.toLocaleString()}</span>`
      : `৳${p.price.toLocaleString()}`;
  }

  // Specs/details
  const specsEl = document.getElementById('detail-specs');
  if (specsEl) { specsEl.textContent = p.details; specsEl.style.display = p.details ? '' : 'none'; }

  // Badge
  const badgeEl = document.getElementById('detail-badge');
  if (badgeEl) { badgeEl.textContent = p.badge; badgeEl.style.display = p.badge ? '' : 'none'; }

  // Stock
  const stockEl = document.getElementById('detail-stock');
  if (stockEl) {
    if (p.stock === 'out_of_stock') {
      stockEl.textContent = '✕ Out of Stock'; stockEl.style.cssText = 'display:block;color:#e05a5a';
    } else if (p.stock === 'low_stock') {
      stockEl.textContent = '⚠ Low Stock — Order Soon'; stockEl.style.cssText = 'display:block;color:#e0b45a';
    } else {
      stockEl.style.display = 'none';
    }
  }

  // Sizes
  const sizesEl = document.getElementById('size-buttons');
  if (sizesEl) {
    sizesEl.innerHTML = p.sizes.map((s, i) =>
      `<button class="size-btn rounded-sm${i === 0 ? ' selected' : ''}" onclick="selectSize(this,'${s}')">${sanitize(s)}</button>`
    ).join('');
  }

  // Colors
  const colorsEl  = document.getElementById('color-buttons');
  const colorSect = colorsEl?.parentElement;
  if (colorsEl) {
    if (p.colors.length) {
      colorsEl.innerHTML = p.colors.map((c, i) =>
        `<button class="color-btn${i === 0 ? ' selected' : ''}" style="background:${sanitize(c)}"
          onclick="selectColor(this,'${sanitize(c)}')" title="${sanitize(c)}"></button>`
      ).join('');
      if (colorSect) colorSect.style.display = '';
    } else {
      if (colorSect) colorSect.style.display = 'none';
    }
  }

  // Add-to-cart button
  const addBtn = document.getElementById('detail-add-btn');
  if (addBtn) {
    const oos = p.stock === 'out_of_stock';
    addBtn.disabled = oos; addBtn.style.opacity = oos ? '0.4' : ''; addBtn.style.cursor = oos ? 'not-allowed' : '';
  }

  setupGallery(p);
  renderRelated(p);
  showPage('detail');
};

function setupGallery(p) {
  currentImageIndex = 0;
  updateMainImage(p, 0);
  const thumbsEl = document.getElementById('detail-thumbnails');
  if (thumbsEl) {
    thumbsEl.innerHTML = p.images.map((img, i) =>
      img ? `<div class="detail-thumb${i === 0 ? ' selected' : ''}" onclick="selectThumb(${i})">
        <img src="${sanitize(img)}" alt="${sanitize(p.name)} ${i + 1}" onerror="this.parentElement.style.display='none'">
      </div>` : ''
    ).join('');
  }
}

function updateMainImage(p, index) {
  const mainEl = document.getElementById('detail-main-img');
  if (!mainEl || !p) return;
  const src = p.images[index] || '';
  mainEl.innerHTML = `
    ${src ? `<img src="${sanitize(src)}" alt="${sanitize(p.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:12px" onerror="this.style.display='none'">` : ''}
    <button onclick="prevImage()" class="gallery-arrow gallery-arrow-left" aria-label="Previous image">
      <svg width="20" height="20" fill="none" stroke="var(--chrome)" stroke-width="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
    </button>
    <button onclick="nextImage()" class="gallery-arrow gallery-arrow-right" aria-label="Next image">
      <svg width="20" height="20" fill="none" stroke="var(--chrome)" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
    </button>
  `;
}

window.selectThumb = function(index) {
  if (!currentProduct) return;
  currentImageIndex = index;
  updateMainImage(currentProduct, index);
  document.querySelectorAll('.detail-thumb').forEach((t, i) => t.classList.toggle('selected', i === index));
};

window.prevImage = function() {
  if (!currentProduct) return;
  currentImageIndex = (currentImageIndex - 1 + currentProduct.images.length) % currentProduct.images.length;
  selectThumb(currentImageIndex);
};

window.nextImage = function() {
  if (!currentProduct) return;
  currentImageIndex = (currentImageIndex + 1) % currentProduct.images.length;
  selectThumb(currentImageIndex);
};

window.selectSize = function(btn, size) {
  document.querySelectorAll('#size-buttons .size-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  currentSize = size;
};

window.selectColor = function(btn, color) {
  document.querySelectorAll('#color-buttons .color-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  currentColor = color;
};

/* ── Related products ───────────────────────────────────── */
function renderRelated(p) {
  const container = document.getElementById('related-products');
  const section   = document.querySelector('.related-section');
  if (!container) return;

  const related = Object.values(productStore)
    .filter(r => r.id !== p.id && r.category === p.category)
    .slice(0, 4);

  if (!related.length) { if (section) section.style.display = 'none'; return; }
  if (section) section.style.display = '';

  container.innerHTML = related.map(r => `
    <div class="product-card rounded-xl p-3 group scroll-fade" onclick="showDetail('${r.id}')">
      <div class="relative mb-3">
        <div class="img-placeholder w-full aspect-[4/5] rounded-lg overflow-hidden">
          ${r.images[0] ? `<img src="${sanitize(r.images[0])}" alt="${sanitize(r.name)}" loading="lazy"
            class="w-full h-full object-cover rounded-lg group-hover:scale-105 transition-transform duration-700"
            onerror="this.style.display='none'">` : ''}
        </div>
      </div>
      <p class="text-sm text-white font-mono truncate mb-0.5">${sanitize(r.name)}</p>
      <p class="text-xs font-playfair font-bold chrome-text">৳${r.price.toLocaleString()}</p>
    </div>
  `).join('');
  setTimeout(initScrollFade, 80);
}

/* ══════════════════════════════════════════════════════════════
   CART ENGINE
══════════════════════════════════════════════════════════════ */
window.openCart = function() {
  document.getElementById('cart-sidebar')?.classList.add('open');
  document.getElementById('cart-overlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
};

window.closeCart = function() {
  document.getElementById('cart-sidebar')?.classList.remove('open');
  document.getElementById('cart-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
};

window.addToCart = function(id, name, price, size, color = '', image = '') {
  const key = `${id}_${size}_${color}`;
  const existing = cart.find(i => i.key === key);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ key, id, name, price: parseFloat(price), size, color, qty: 1, image });
  }
  saveCart();
  updateCartUI();
  openCart();
  showToast('Added to cart');
};

window.changeQty = function(key, delta) {
  const item = cart.find(i => i.key === key);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(i => i.key !== key);
  saveCart();
  updateCartUI();
};

window.addCurrentToCart = function() {
  if (!currentProduct || currentProduct.stock === 'out_of_stock') return;
  addToCart(currentProduct.id, currentProduct.name, currentProduct.price, currentSize, currentColor, currentProduct.images[0]);
};

window.buyNowCurrent = function() {
  if (!currentProduct) return;
  addCurrentToCart();
  goToCheckout();
};

function saveCart() { localStorage.setItem('cnCart', JSON.stringify(cart)); }

function updateCartUI() {
  const totalItems = cart.reduce((s, i) => s + i.qty, 0);
  const totalPrice = cart.reduce((s, i) => s + i.price * i.qty, 0);

  const countEl = document.getElementById('cart-count');
  if (countEl) { countEl.textContent = totalItems; countEl.classList.toggle('hidden', totalItems === 0); }

  _setTxt('cart-total', '৳' + totalPrice.toLocaleString());

  const cartItems = document.getElementById('cart-items');
  const empty     = document.getElementById('cart-empty');
  const summary   = document.getElementById('cart-summary');
  if (!cartItems) return;

  cartItems.querySelectorAll('.cart-item').forEach(r => r.remove());

  if (!cart.length) {
    if (empty) empty.style.display = 'flex';
    if (summary) summary.classList.add('hidden');
  } else {
    if (empty) empty.style.display = 'none';
    if (summary) summary.classList.remove('hidden');

    cart.forEach(item => {
      const div = document.createElement('div');
      div.className = 'cart-item';
      div.innerHTML = `
        <div class="cart-item-img">
          ${item.image ? `<img src="${sanitize(item.image)}" alt="${sanitize(item.name)}" onerror="this.style.display='none'">` : ''}
        </div>
        <div class="cart-item-info">
          <h4 class="cart-item-name">${sanitize(item.name)}</h4>
          <p class="cart-item-meta">Size: ${sanitize(item.size)}${item.color ? ' · ' + sanitize(item.color) : ''}</p>
          <div class="cart-item-bottom">
            <span class="cart-item-price">৳${(item.price * item.qty).toLocaleString()}</span>
            <div class="cart-qty-controls">
              <button class="cart-qty-btn" onclick="changeQty('${item.key}',-1)">−</button>
              <span class="cart-qty-value">${item.qty}</span>
              <button class="cart-qty-btn" onclick="changeQty('${item.key}',1)">+</button>
            </div>
          </div>
        </div>
      `;
      cartItems.appendChild(div);
    });
  }
}

/* ══════════════════════════════════════════════════════════════
   NAVIGATION & PAGE ROUTING
══════════════════════════════════════════════════════════════ */
window.showPage = function(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + id);
  if (target) target.classList.add('active');

  window.scrollTo({ top: 0, behavior: 'smooth' });

  document.querySelectorAll('[id^="nav-"]').forEach(l => l.classList.remove('active'));
  const navEl = document.getElementById('nav-' + id);
  if (navEl) navEl.classList.add('active');

  closeMobileMenu();
  closeCart();
  closeTracking();

  setTimeout(() => {
    initScrollFade();
    if (id === 'checkout') renderCheckoutItems();
    if (id === 'tracking') renderTrackingPage();
    if (id === 'shop')     renderShopGrid(currentShopFilter);
  }, 100);
};

window.toggleMobileMenu = function() {
  const menu    = document.getElementById('mobile-menu');
  const overlay = document.getElementById('mobile-menu-overlay');
  const isOpen  = menu?.classList.contains('open');
  menu?.classList.toggle('open', !isOpen);
  overlay?.classList.toggle('open', !isOpen);
  document.body.style.overflow = isOpen ? '' : 'hidden';
};

window.closeMobileMenu = function() {
  document.getElementById('mobile-menu')?.classList.remove('open');
  document.getElementById('mobile-menu-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
};

/* ── Scroll fade observer ───────────────────────────────── */
function initScrollFade() {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
  }, { threshold: 0.06 });
  document.querySelectorAll('.scroll-fade:not(.visible)').forEach(el => obs.observe(el));
}

/* ── Toast notifications ────────────────────────────────── */
function showToast(msg, type = 'success') {
  let toast = document.getElementById('site-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'site-toast';
    toast.style.cssText = `
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);
      background:rgba(10,10,10,.95);border:1px solid rgba(192,192,192,.15);
      color:#c0c0c0;font-family:'Space Mono',monospace;font-size:11px;
      letter-spacing:.12em;padding:12px 24px;border-radius:30px;
      z-index:99999;opacity:0;transition:all .3s ease;white-space:nowrap;
      box-shadow:0 8px 32px rgba(0,0,0,.5);
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.background = type === 'error' ? 'rgba(180,40,40,.95)' : 'rgba(10,10,10,.95)';
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
  }, 3000);
}

/* ══════════════════════════════════════════════════════════════
   CHECKOUT
══════════════════════════════════════════════════════════════ */
window.goToCheckout = function() {
  if (!cart.length) { showToast('Your cart is empty', 'error'); return; }
  closeCart();
  showPage('checkout');
};

function renderCheckoutItems() {
  const container = document.getElementById('checkout-items');
  if (!container) return;

  let subtotal = 0;
  container.innerHTML = cart.map(item => {
    const lineTotal = item.price * item.qty;
    subtotal += lineTotal;
    return `
      <div class="checkout-item-row">
        <div class="checkout-item-img">
          ${item.image ? `<img src="${sanitize(item.image)}" alt="${sanitize(item.name)}" onerror="this.style.display='none'">` : ''}
        </div>
        <div class="checkout-item-details">
          <p class="checkout-item-name">${sanitize(item.name)}</p>
          <p class="checkout-item-meta">Size: ${sanitize(item.size)}${item.color ? ' · ' + sanitize(item.color) : ''} | Qty: ${item.qty}</p>
          <p class="checkout-item-price">৳${lineTotal.toLocaleString()}</p>
        </div>
      </div>
    `;
  }).join('');

  _setTxt('checkout-subtotal', '৳' + subtotal.toLocaleString());
  updateDeliveryCharge();
}

window.updateDeliveryCharge = function() {
  const district = document.getElementById('chk-district')?.value || '';
  const charge   = DELIVERY_CHARGES[district] || 0;
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  _setTxt('checkout-delivery', '৳' + charge);
  _setTxt('checkout-total',    '৳' + (subtotal + charge).toLocaleString());
};

window.selectPayment = function(method) {
  selectedPayment = method;
  document.querySelectorAll('.payment-option-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('pay-' + method)?.classList.add('selected');
  const bkash = document.getElementById('bkash-info');
  if (bkash) {
    bkash.classList.toggle('hidden', method !== 'bkash');
    _setTxt('bkash-number-display', BKASH_NUMBER);
  }
};

/* ── Validation ─────────────────────────────────────────── */
function validateField(field) {
  const val    = field.value.trim();
  const parent = field.closest('.form-field');
  if (!parent) return true;
  const req    = field.dataset.required === 'true';

  if (req && !val) { parent.classList.add('error'); return false; }
  if (field.id === 'chk-phone' && val && !/^01[3-9]\d{8}$/.test(val)) {
    parent.classList.add('error'); return false;
  }
  parent.classList.remove('error'); return true;
}

function validateAllFields() {
  let valid = true, first = null;
  document.querySelectorAll('#page-checkout [data-required="true"]').forEach(f => {
    if (!validateField(f)) { valid = false; if (!first) first = f; }
  });
  if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => first.focus(), 400); }
  return valid;
}

function setupValidation() {
  document.querySelectorAll('#page-checkout input, #page-checkout select').forEach(f => {
    f.addEventListener('blur',  () => validateField(f));
    f.addEventListener('input', () => { if (f.closest('.form-field')?.classList.contains('error')) validateField(f); });
  });
}

/* ── Generate unique order ID ───────────────────────────── */
function generateOrderId() {
  const chars  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const prefix = 'CN';
  const suffix = Array.from({ length: 7 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return prefix + suffix;
}

/* ── CONFIRM ORDER ──────────────────────────────────────── */
window.confirmOrder = async function() {
  if (_isSubmitting) return;
  if (!validateAllFields()) {
    const btn = document.getElementById('confirm-order-btn');
    btn?.classList.add('error');
    setTimeout(() => btn?.classList.remove('error'), 600);
    return;
  }

  _isSubmitting = true;
  const btn     = document.getElementById('confirm-order-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Placing Order...'; }

  /* ── Gather all customer data ─────────────────────────── */
  const customer = {
    full_name:       _getVal('chk-name'),
    phone_number:    _getVal('chk-phone'),
    email_address:   _getVal('chk-email'),
    district:        _getVal('chk-district'),
    thana:           _getVal('chk-thana'),
    area_name:       _getVal('chk-area'),
    zip_code:        _getVal('chk-zip'),
    post_office:     _getVal('chk-post'),
    house:           _getVal('chk-house'),
    road_no:         _getVal('chk-road'),
    sector:          _getVal('chk-sector'),
    delivery_address: [
      _getVal('chk-house'), _getVal('chk-road'), _getVal('chk-area'),
      _getVal('chk-thana'), _getVal('chk-district')
    ].filter(Boolean).join(', ')
  };

  const orderId  = generateOrderId();
  const now      = new Date();
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const delivery = DELIVERY_CHARGES[customer.district] || 0;
  const total    = subtotal + delivery;

  const orderItems = cart.map(i => ({
    product_name:  i.name,
    image:         i.image,
    quantity:      i.qty,
    selected_size: i.size,
    selected_color: i.color || '',
    price:         i.price,
    subtotal:      i.price * i.qty
  }));

  const order = {
    id: orderId,
    customer,
    items:     [...cart],
    orderItems,
    payment:   selectedPayment === 'bkash' ? 'BKash' : 'Cash On Delivery',
    subtotal,
    delivery,
    total,
    status:    'Pending',
    createdAt: now.toISOString(),
    cancelDeadline: new Date(now.getTime() + 60 * 60 * 1000).toISOString()
  };

  /* ── Save locally first so UI updates instantly ────── */
  orders.push(order);
  localStorage.setItem('cnOrders', JSON.stringify(orders));
  updateTrackingUI();

  /* ── Fire & forget — backend saves ─────────────────── */
  try {
    await saveOrderToBackendless(order);
    sendOrderToTelegram(order).catch(() => {});
  } catch (err) {
    console.error('[Chrome Noir] Order backend error:', err);
    // Order still saved locally — show success to user
  }

  /* ── Reset and show confirmation ─────────────────── */
  cart = []; saveCart(); updateCartUI();

  showOrderPopup(order);

  _isSubmitting = false;
  if (btn) { btn.disabled = false; btn.textContent = 'Confirm Order'; }
};

/* ── Save order to Backendless with full data structure ─ */
async function saveOrderToBackendless(order) {
  const c = order.customer;

  const payload = {
    /* Order info */
    order_id:         order.id,
    order_status:     order.status,
    created_at:       order.createdAt,

    /* Customer info */
    customer_name:    c.full_name,
    full_name:        c.full_name,
    phone_number:     c.phone_number,
    email_address:    c.email_address,

    /* Delivery info */
    delivery_address: c.delivery_address,
    district:         c.district,
    thana:            c.thana,
    area_name:        c.area_name,
    post_office:      c.post_office,
    zip_code:         c.zip_code,
    house:            c.house,
    road_no:          c.road_no,
    sector:           c.sector,

    /* Payment */
    payment_method:   order.payment,
    payment:          order.payment,

    /* Products as JSON string */
    ordered_products: JSON.stringify(order.orderItems),
    items:            JSON.stringify(order.items.map(i => ({
      product_name:   i.name,
      image:          i.image,
      quantity:       i.qty,
      selected_size:  i.size,
      selected_color: i.color || '',
      price:          i.price,
      subtotal:       i.price * i.qty
    }))),
    product_names:    order.items.map(i => i.name).join(' / '),

    /* Totals */
    subtotal:         order.subtotal,
    delivery_charge:  order.delivery,
    total:            order.total,
    quantity:         order.items.reduce((s, i) => s + i.qty, 0),
    status:           order.status
  };

  return Backendless.post('orders', payload);
}

/* ── Order popup ────────────────────────────────────────── */
function showOrderPopup(order) {
  const popup   = document.getElementById('order-popup');
  const overlay = document.getElementById('order-popup-overlay');
  if (!popup) return;

  const created  = new Date(order.createdAt);
  const delivery = new Date(created);
  delivery.setDate(delivery.getDate() + 4);

  _setTxt('popup-order-id',      order.id);
  _setTxt('popup-order-time',    created.toLocaleString('en-BD', { weekday:'short', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }));
  _setTxt('popup-delivery-time', delivery.toLocaleDateString('en-BD', { weekday:'short', month:'short', day:'numeric' }));
  _setTxt('popup-total',         '৳' + order.total.toLocaleString());

  const prodEl = document.getElementById('popup-products');
  if (prodEl) {
    prodEl.innerHTML = order.items.map(item => `
      <div class="popup-product-item">
        ${item.image ? `<img src="${sanitize(item.image)}" alt="${sanitize(item.name)}" onerror="this.style.display='none'">` : ''}
        <div>
          <p style="font-size:12px;color:white;font-family:'Space Mono',monospace;margin-bottom:2px">${sanitize(item.name)}</p>
          <p style="font-size:10px;color:var(--chrome-dark);font-family:'Space Mono',monospace">
            Size: ${sanitize(item.size)}${item.color ? ' · ' + sanitize(item.color) : ''} | Qty: ${item.qty}
          </p>
          <p style="font-size:11px;color:var(--chrome);font-family:'Space Mono',monospace;margin-top:4px">৳${(item.price * item.qty).toLocaleString()}</p>
        </div>
      </div>
    `).join('');
  }

  popup.classList.add('open');
  if (overlay) overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

window.closeOrderPopup = function() {
  document.getElementById('order-popup')?.classList.remove('open');
  document.getElementById('order-popup-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
  showPage('home');
};

/* ── Telegram notification ─────────────────────────────── */
async function sendOrderToTelegram(order) {
  const c   = order.customer;
  let msg   = `🔴 *NEW ORDER — ${order.id}*\n*Payment:* ${order.payment}\n\n`;
  msg += `👤 *Customer*\nName: ${c.full_name}\nPhone: ${c.phone_number}\n`;
  if (c.email_address) msg += `Email: ${c.email_address}\n`;
  msg += `\n📍 *Delivery*\n${c.delivery_address}\n\n🛍️ *Items*\n`;
  order.items.forEach((i, n) => {
    msg += `${n + 1}. ${i.name} | Size: ${i.size}${i.color ? ' · '+i.color : ''} | Qty: ${i.qty} | ৳${(i.price * i.qty).toLocaleString()}\n`;
  });
  msg += `\n💰 Subtotal: ৳${order.subtotal} | Delivery: ৳${order.delivery} | *Total: ৳${order.total}*`;

  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'Markdown' })
  });
}

/* ══════════════════════════════════════════════════════════════
   ORDER TRACKING — Sidebar
══════════════════════════════════════════════════════════════ */
window.openTracking = function() {
  document.getElementById('tracking-sidebar')?.classList.add('open');
  document.getElementById('tracking-overlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
  renderTrackingSidebar();
};

window.closeTracking = function() {
  document.getElementById('tracking-sidebar')?.classList.remove('open');
  document.getElementById('tracking-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
};

function updateTrackingUI() {
  const btn   = document.getElementById('tracking-btn');
  const count = document.getElementById('tracking-count');
  if (!btn) return;
  btn.classList.toggle('hidden', !orders.length);
  if (count) { count.textContent = orders.length; count.classList.toggle('hidden', !orders.length); }
}

function renderTrackingSidebar() {
  const container = document.getElementById('tracking-items');
  const empty     = document.getElementById('tracking-empty');
  if (!container) return;
  container.querySelectorAll('.tracking-sidebar-item').forEach(e => e.remove());

  if (!orders.length) { if (empty) empty.style.display = 'flex'; return; }
  if (empty) empty.style.display = 'none';

  orders.forEach(order => {
    const div = document.createElement('div');
    div.className = 'tracking-sidebar-item';
    div.style.cssText = 'padding:16px;border:1px solid rgba(192,192,192,.1);border-radius:12px;margin-bottom:12px;background:rgba(255,255,255,.02);cursor:pointer;transition:border-color .2s;';
    div.onmouseenter = () => div.style.borderColor = 'rgba(192,192,192,.25)';
    div.onmouseleave = () => div.style.borderColor = 'rgba(192,192,192,.1)';
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:11px;color:var(--chrome);font-family:'Space Mono',monospace;font-weight:700">${order.id}</span>
        <span class="order-status-badge status-${(order.status || 'pending').toLowerCase().replace(/\s+/g,'-')}" style="font-size:9px;padding:2px 8px;border-radius:20px">${order.status || 'Pending'}</span>
      </div>
      <p style="font-size:11px;color:white;font-family:'Space Mono',monospace;margin-bottom:4px">${order.items.map(i => sanitize(i.name)).join(', ')}</p>
      <p style="font-size:11px;color:var(--chrome);font-family:'Space Mono',monospace">৳${order.total.toLocaleString()}</p>
    `;
    div.onclick = () => { closeTracking(); showPage('tracking'); };
    container.appendChild(div);
  });
}

/* ── Full tracking page ─────────────────────────────────── */
function renderTrackingPage() {
  const container = document.getElementById('tracking-content');
  if (!container) return;

  if (!orders.length) {
    container.innerHTML = `<div class="text-center py-20"><p class="text-sm tracking-[0.25em] text-[var(--chrome-dark)] font-mono uppercase">No active orders found</p></div>`;
    return;
  }

  const STATUS_STEPS = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered'];
  const STATUS_POS   = { 'pending':0, 'confirmed':1, 'processing':2, 'shipped':3, 'delivered':4, 'cancelled':-1 };

  container.innerHTML = orders.map(order => {
    const created   = new Date(order.createdAt);
    const deadline  = new Date(order.cancelDeadline);
    const canCancel = new Date() < deadline && order.status !== 'Cancelled' && order.status !== 'cancelled';
    const statusKey = (order.status || 'Pending').toLowerCase().replace(/\s+/g,'-');
    const stepIdx   = STATUS_POS[statusKey] ?? 0;
    const isCancelled = statusKey === 'cancelled';

    const progressBars = STATUS_STEPS.map((s, i) => `
      <div class="track-step${i <= stepIdx && !isCancelled ? ' active' : ''}">
        <div class="track-step-dot"></div>
        <span class="track-step-label">${s}</span>
      </div>
    `).join('<div class="track-connector"></div>');

    return `
      <div class="tracking-card scroll-fade" data-order-id="${order.id}">
        <div class="tracking-header">
          <div>
            <p class="tracking-order-id">ORDER #${order.id}</p>
            <p style="font-size:10px;color:var(--chrome-dark);font-family:'Space Mono',monospace">${created.toLocaleString('en-BD')}</p>
          </div>
          <span class="order-status-badge status-${statusKey}">${order.status || 'Pending'}</span>
        </div>

        ${!isCancelled ? `<div class="tracking-steps">${progressBars}</div>` : ''}

        <div class="tracking-details-grid">
          <div class="tracking-detail-box"><span>Customer</span><h4>${sanitize(order.customer?.full_name || order.customer?.name || '')}</h4></div>
          <div class="tracking-detail-box"><span>Phone</span><h4>${sanitize(order.customer?.phone_number || order.customer?.phone || '')}</h4></div>
          <div class="tracking-detail-box"><span>District</span><h4>${sanitize(order.customer?.district || '')}</h4></div>
          <div class="tracking-detail-box"><span>Payment</span><h4>${sanitize(order.payment || '')}</h4></div>
        </div>

        <div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(192,192,192,.08)">
          ${order.items.map(i => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(192,192,192,.04)">
              <span style="font-size:12px;color:white;font-family:'Space Mono',monospace">${sanitize(i.name)} ×${i.qty}</span>
              <span style="font-size:12px;color:var(--chrome);font-family:'Space Mono',monospace">৳${(i.price * i.qty).toLocaleString()}</span>
            </div>
          `).join('')}
          <div style="display:flex;justify-content:space-between;margin-top:10px;padding-top:8px;border-top:1px solid rgba(192,192,192,.1)">
            <span style="font-size:12px;color:var(--chrome-dark);font-family:'Space Mono',monospace">Delivery</span>
            <span style="font-size:12px;color:var(--chrome);font-family:'Space Mono',monospace">৳${order.delivery || 0}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:6px">
            <span style="font-size:13px;color:white;font-family:'Space Mono',monospace;font-weight:700">Total</span>
            <span style="font-size:13px;color:var(--chrome);font-family:'Playfair Display',serif;font-weight:700">৳${order.total.toLocaleString()}</span>
          </div>
        </div>

        ${!isCancelled ? `
          <div class="countdown-box" id="countdown-${order.id}">
            <div class="countdown-timer" id="timer-${order.id}">--:--</div>
            <p class="countdown-label">${canCancel ? 'Time remaining to cancel' : 'Cancellation window closed'}</p>
          </div>
          ${canCancel ? `<button class="cancel-btn" onclick="cancelOrder('${order.id}')">Cancel Order</button>` : ''}
        ` : `<div style="padding:12px;background:rgba(231,76,60,.08);border:1px solid rgba(231,76,60,.15);margin-top:16px;text-align:center;color:#e74c3c;font-family:'Space Mono',monospace;font-size:11px;border-radius:6px">Order Cancelled</div>`}
      </div>
    `;
  }).join('');

  startCountdownTimers();
  setTimeout(initScrollFade, 80);
}

function startCountdownTimers() {
  const iv = setInterval(() => {
    let any = false;
    orders.forEach(order => {
      if ((order.status || '').toLowerCase() === 'cancelled') return;
      const left    = Math.max(0, new Date(order.cancelDeadline) - new Date());
      const timerEl = document.getElementById('timer-' + order.id);
      if (timerEl) {
        any = true;
        if (left > 0) {
          const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
          timerEl.textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
        } else {
          timerEl.textContent = '00:00';
          const cancelBtn = timerEl.closest('.tracking-card')?.querySelector('.cancel-btn');
          if (cancelBtn) cancelBtn.remove();
        }
      }
    });
    if (!any) clearInterval(iv);
  }, 1000);
}

window.cancelOrder = function(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  const name = prompt('Enter your name to confirm cancellation:');
  if (!name) return;
  const customerName = order.customer?.full_name || order.customer?.name || '';
  if (name.trim().toLowerCase() !== customerName.toLowerCase()) {
    showToast('Name does not match', 'error'); return;
  }
  order.status = 'Cancelled';
  localStorage.setItem('cnOrders', JSON.stringify(orders));
  updateTrackingUI();
  renderTrackingPage();
  showToast('Order cancelled');
};

/* ══════════════════════════════════════════════════════════════
   SITE CONTENT — Dynamic CMS
══════════════════════════════════════════════════════════════ */
async function loadSiteContent() {
  try {
    const rows = await Backendless.get('site_content', '?pageSize=100');
    const c    = {};
    rows.forEach(r => { if (r.key) c[r.key] = r.value; });

    const map = {
      'hero-title1-text':  'hero_title1',
      'hero-title2-text':  'hero_title2',
      'announcement-text': 'announcement'
    };
    Object.entries(map).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el && c[key]) el.textContent = c[key];
    });
  } catch { /* Silent — hardcoded fallback */ }
}

/* ── FAQ accordion ─────────────────────────────────────── */
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('faq-question')) {
    const item = e.target.parentElement;
    const wasOpen = item.classList.contains('active');
    document.querySelectorAll('.faq-item.active').forEach(i => i.classList.remove('active'));
    if (!wasOpen) item.classList.add('active');
  }
});

/* ── DOM helpers ────────────────────────────────────────── */
function _setTxt(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function _getVal(id)       { return document.getElementById(id)?.value.trim() || ''; }

/* ══════════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  /* Ensure home is active */
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-home')?.classList.add('active');

  /* Restore state */
  updateCartUI();
  updateTrackingUI();
  initScrollFade();
  setupValidation();
  selectPayment('cod');

  /* Load dynamic data */
  loadProducts();
  loadSiteContent();
  startProductPolling();
});
