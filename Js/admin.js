/* ══════════════════════════════════════════════════════════════
   CHROME NOIR — ADMIN PANEL JS v2.0
   Full CRUD · Real-time Polling · Complete Order View
   Backend: Backendless (credentials in ../js/backendless-config.js)
══════════════════════════════════════════════════════════════ */

const ADMIN_PASSWORD  = '1234';
const ADMIN_POLL_MS   = 20000; // 20-second polling

/* ── State ───────────────────────────────────────── */
let allProducts  = [];
let allOrders    = [];
let currentTab   = 'overview';
let _pollTimer   = null;
let pendingDeleteId   = null;
let pendingDeleteName = '';

/* ══════════════════════════════════════════════════
   AUTH
══════════════════════════════════════════════════ */
function adminLogin() {
  const pass = document.getElementById('admin-pass').value;
  const err  = document.getElementById('login-error');
  if (pass === ADMIN_PASSWORD) {
    sessionStorage.setItem('cn_admin_auth', '1');
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    initDashboard();
  } else {
    err.classList.remove('hidden');
    document.getElementById('admin-pass').value = '';
    document.getElementById('admin-pass').focus();
  }
}

function adminLogout() {
  clearInterval(_pollTimer);
  sessionStorage.removeItem('cn_admin_auth');
  location.reload();
}

window.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('cn_admin_auth') === '1') {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    initDashboard();
  }
});

async function initDashboard() {
  await Promise.all([loadProducts(), loadOrders()]);
  loadSiteContent();
  startPolling();
}

function startPolling() {
  clearInterval(_pollTimer);
  _pollTimer = setInterval(async () => {
    if (currentTab === 'overview' || currentTab === 'orders') await loadOrders(true);
    if (currentTab === 'overview' || currentTab === 'products') await loadProducts(true);
  }, ADMIN_POLL_MS);
}

/* ══════════════════════════════════════════════════
   TAB SWITCHING
══════════════════════════════════════════════════ */
function switchTab(tabName, el) {
  currentTab = tabName;

  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('tab-' + tabName).classList.add('active');
  if (el) el.classList.add('active');

  const titles = {
    overview: ['Overview', 'Dashboard summary'],
    products: ['Products', 'Manage your inventory'],
    orders:   ['Orders', 'View and update customer orders'],
    content:  ['Site Content', 'Edit website text and CMS']
  };
  setEl('page-title', titles[tabName]?.[0] || tabName);
  setEl('page-sub',   titles[tabName]?.[1] || '');

  const addBtn = document.getElementById('header-add-btn');
  if (addBtn) addBtn.classList.toggle('hidden', tabName !== 'products');

  if (tabName === 'orders')  loadOrders();
  if (tabName === 'content') loadSiteContent();
}

function refreshCurrent() {
  if (currentTab === 'products') loadProducts();
  else if (currentTab === 'orders') loadOrders();
  else if (currentTab === 'content') loadSiteContent();
  else initDashboard();
  toast('Refreshed', 'info');
}

/* ══════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════ */
function toast(msg, type = 'success') {
  const t = document.getElementById('global-toast');
  t.textContent = msg;
  t.className = `global-toast ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3500);
}

/* ══════════════════════════════════════════════════
   PRODUCTS — LOAD
══════════════════════════════════════════════════ */
async function loadProducts(silent = false) {
  if (!silent) {
    const tbody = document.getElementById('products-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="loading-cell"><div class="loading-spinner"></div>Loading...</td></tr>';
  }
  try {
    const data = await Backendless.get('products', '?sortBy=created%20DESC&pageSize=100');
    allProducts = data;

    const inStock  = data.filter(p => p.stock === 'in_stock').length;
    const outStock = data.filter(p => p.stock === 'out_of_stock').length;
    setEl('stat-total-products', data.length);
    setEl('stat-in-stock',  inStock);
    setEl('stat-out-stock', outStock);
    setEl('product-count-label', `${data.length} products in inventory`);

    const nb = document.getElementById('nav-product-count');
    if (nb) { nb.textContent = data.length; nb.classList.remove('hidden'); }

    if (!silent || currentTab === 'products') renderProductsTable(data);
  } catch (err) {
    if (!silent) {
      const tbody = document.getElementById('products-tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="loading-cell" style="color:var(--danger)">Error: ${err.message}</td></tr>`;
      toast('Failed to load products', 'error');
    }
  }
}

function renderProductsTable(products) {
  const tbody = document.getElementById('products-tbody');
  if (!tbody) return;

  if (!products.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No products yet. Add your first!</td></tr>';
    return;
  }

  tbody.innerHTML = products.map(p => {
    // Handle both image formats
    let imgSrc = '';
    if (p.main_image) {
      imgSrc = p.main_image;
    } else if (p.images) {
      try { imgSrc = JSON.parse(p.images)[0] || ''; } catch { imgSrc = p.images; }
    }

    const stockKey   = p.stock || 'in_stock';
    const stockLabel = { in_stock:'In Stock', low_stock:'Low Stock', out_of_stock:'Out of Stock' }[stockKey] || stockKey;
    const stockCls   = { in_stock:'badge-in-stock', low_stock:'badge-low-stock', out_of_stock:'badge-out-stock' }[stockKey] || '';

    return `
      <tr>
        <td>
          ${imgSrc
            ? `<img src="${sanitize(imgSrc)}" class="prod-thumb" alt="${sanitize(p.name)}" onerror="this.outerHTML='<div class=prod-thumb-placeholder>NO IMG</div>'">`
            : `<div class="prod-thumb-placeholder">NO IMG</div>`}
        </td>
        <td>
          <div class="prod-name">${sanitize(p.name || '—')}</div>
          <div class="prod-category">${sanitize(p.category || '—')}</div>
        </td>
        <td>
          <div style="font-weight:700;color:var(--chrome-light)">৳${Number(p.price || 0).toLocaleString()}</div>
          ${p.old_price ? `<div style="font-size:9px;color:var(--chrome-dark);text-decoration:line-through">৳${Number(p.old_price).toLocaleString()}</div>` : ''}
        </td>
        <td style="text-transform:capitalize">${sanitize(p.category || '—')}</td>
        <td>${p.badge ? `<span class="badge" style="background:rgba(192,192,192,.06);color:var(--chrome);border-color:var(--border)">${sanitize(p.badge)}</span>` : '<span style="color:rgba(192,192,192,.2);font-size:10px">—</span>'}</td>
        <td><span class="badge ${stockCls}">${stockLabel}</span></td>
        <td>
          <div class="action-btns">
            <button class="btn-edit" onclick='openEditModal(${JSON.stringify(p)})'>
              <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
            <button class="btn-danger" onclick="openDeleteModal('${p.objectId}','${(p.name||'').replace(/'/g,"\\'")}')">
              <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
              Delete
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/* ── Search/Filter products ──────────────────────── */
function searchProducts(q) {
  const term = q.toLowerCase();
  const stock = document.getElementById('product-filter-stock')?.value || 'all';
  let filtered = allProducts.filter(p =>
    (p.name || '').toLowerCase().includes(term) ||
    (p.category || '').toLowerCase().includes(term) ||
    (p.badge || '').toLowerCase().includes(term)
  );
  if (stock !== 'all') filtered = filtered.filter(p => p.stock === stock);
  renderProductsTable(filtered);
}

function filterProductsByStock(stock) {
  const q = document.getElementById('product-search')?.value || '';
  const term = q.toLowerCase();
  let filtered = stock === 'all' ? allProducts : allProducts.filter(p => p.stock === stock);
  if (term) filtered = filtered.filter(p => (p.name||'').toLowerCase().includes(term));
  renderProductsTable(filtered);
}

/* ══════════════════════════════════════════════════
   PRODUCT MODAL — OPEN/CLOSE
══════════════════════════════════════════════════ */
function openProductModal() {
  ['p-objectId','p-img1','p-img2','p-img3','p-name','p-price','p-old-price',
   'p-sizes','p-colors','p-desc','p-details','p-tags'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  setVal('p-category', 'outerwear');
  setVal('p-badge', '');
  setVal('p-stock', 'in_stock');
  setVal('p-sizes', 'S, M, L, XL');
  [1,2,3].forEach(n => clearPreview(n));
  setEl('product-modal-title', 'Add Product');
  setEl('product-save-btn', 'Save Product');
  openModal('product');
}

function openEditModal(p) {
  let img1 = p.main_image || '';
  let img2 = p.image1     || '';
  let img3 = p.image2     || '';

  // Legacy JSON images array fallback
  if (!img1 && p.images) {
    try {
      const imgs = JSON.parse(p.images);
      img1 = imgs[0] || ''; img2 = imgs[1] || ''; img3 = imgs[2] || '';
    } catch { img1 = p.images; }
  }

  setVal('p-objectId',  p.objectId || '');
  setVal('p-name',      p.name     || '');
  setVal('p-price',     p.price    || '');
  setVal('p-old-price', p.old_price || '');
  setVal('p-img1',      img1);
  setVal('p-img2',      img2);
  setVal('p-img3',      img3);
  setVal('p-sizes',     p.sizes    || 'S, M, L, XL');
  setVal('p-colors',    p.colors   || '');
  setVal('p-desc',      p.description || '');
  setVal('p-details',   p.details  || '');
  setVal('p-tags',      p.tags     || '');
  setVal('p-category',  p.category || 'outerwear');
  setVal('p-badge',     p.badge    || '');
  setVal('p-stock',     p.stock    || 'in_stock');

  [1,2,3].forEach(n => previewImage(n));
  setEl('product-modal-title', 'Edit Product');
  setEl('product-save-btn', 'Update Product');
  openModal('product');
}

function closeProductModal() { closeModal('product'); }

/* ══════════════════════════════════════════════════
   PRODUCT SAVE (Create/Update)
   Stores images in separate fields: main_image, image1, image2
   Also keeps backward-compatible 'images' JSON string
══════════════════════════════════════════════════ */
async function saveProduct() {
  const objectId = getVal('p-objectId');
  const name     = getVal('p-name').trim();
  const price    = getVal('p-price');
  const img1     = getVal('p-img1').trim();

  if (!name)  { toast('Product name is required', 'error'); return; }
  if (!price) { toast('Price is required', 'error'); return; }
  if (!img1)  { toast('Main image URL is required', 'error'); return; }

  const img2 = getVal('p-img2').trim();
  const img3 = getVal('p-img3').trim();

  const payload = {
    name,
    price:       parseFloat(price) || 0,
    old_price:   parseFloat(getVal('p-old-price')) || 0,
    category:    getVal('p-category'),
    badge:       getVal('p-badge'),
    stock:       getVal('p-stock'),
    sizes:       getVal('p-sizes').trim() || 'S, M, L, XL',
    colors:      getVal('p-colors').trim() || '',
    description: getVal('p-desc').trim() || '',
    details:     getVal('p-details').trim() || '',
    tags:        getVal('p-tags').trim() || '',
    /* Primary image fields (as per DB schema) */
    main_image:  img1,
    image1:      img2,
    image2:      img3,
    /* Backward-compatible JSON array */
    images:      JSON.stringify([img1, img2, img3].filter(Boolean))
  };

  const btn = document.getElementById('product-save-btn');
  btn.disabled = true; btn.textContent = 'Saving...';

  try {
    if (objectId) {
      await Backendless.put('products', objectId, payload);
      toast('✓ Product updated');
    } else {
      await Backendless.post('products', payload);
      toast('✓ Product added');
    }
    closeProductModal();
    await loadProducts();
  } catch (err) {
    toast('Save failed: ' + (err.message || 'Unknown error'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = objectId ? 'Update Product' : 'Save Product';
  }
}

/* ══════════════════════════════════════════════════
   PRODUCT DELETE
══════════════════════════════════════════════════ */
function openDeleteModal(objectId, name) {
  pendingDeleteId = objectId; pendingDeleteName = name;
  setEl('delete-product-name', `"${name}"`);
  openModal('delete');
}
function closeDeleteModal() { closeModal('delete'); pendingDeleteId = null; }

async function confirmDelete() {
  if (!pendingDeleteId) return;
  const btn = document.querySelector('#delete-modal .btn-danger-solid');
  btn.disabled = true; btn.textContent = 'Deleting...';
  try {
    await Backendless.delete('products', pendingDeleteId);
    toast(`✓ "${pendingDeleteName}" deleted`);
    closeDeleteModal();
    await loadProducts();
  } catch (err) {
    toast('Delete failed: ' + (err.message || ''), 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Delete Forever';
  }
}

/* ── Image preview ───────────────────────────────── */
function previewImage(n) {
  const url  = getVal(`p-img${n}`).trim();
  const img  = document.getElementById(`prev-thumb${n}`);
  const icon = document.getElementById(`prev-icon${n}`);
  if (!img || !icon) return;
  if (url) {
    img.src = url; img.style.display = ''; icon.style.display = 'none';
  } else {
    clearPreview(n);
  }
}
function clearPreview(n) {
  const img  = document.getElementById(`prev-thumb${n}`);
  const icon = document.getElementById(`prev-icon${n}`);
  if (img) { img.src = ''; img.style.display = 'none'; }
  if (icon) icon.style.display = '';
}

/* ══════════════════════════════════════════════════
   ORDERS — LOAD
══════════════════════════════════════════════════ */
async function loadOrders(silent = false) {
  if (!silent) {
    const tbody = document.getElementById('orders-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="loading-cell"><div class="loading-spinner"></div>Loading orders...</td></tr>';
  }
  try {
    const data = await Backendless.get('orders', '?sortBy=created%20DESC&pageSize=100');
    allOrders = data;

    const pending = data.filter(o => (o.status || 'Pending').toLowerCase() === 'pending').length;
    const revenue = data
      .filter(o => (o.status || '').toLowerCase() !== 'cancelled')
      .reduce((s, o) => s + (parseFloat(o.total) || 0), 0);

    setEl('stat-total-orders',   data.length);
    setEl('stat-pending-orders', pending);
    setEl('stat-revenue',        '৳' + revenue.toLocaleString());
    setEl('order-count-label',   `${data.length} total orders`);

    const nb = document.getElementById('nav-order-count');
    if (nb) { nb.textContent = data.length; nb.classList.remove('hidden'); }

    if (!silent || currentTab === 'orders') renderOrdersTable(data);
    renderRecentOrders(data.slice(0, 5));
  } catch (err) {
    if (!silent) {
      const tbody = document.getElementById('orders-tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="loading-cell" style="color:var(--danger)">Error: ${err.message}</td></tr>`;
      toast('Failed to load orders', 'error');
    }
  }
}

/* ── Recent orders for overview tab ─────────────── */
function renderRecentOrders(orders) {
  const el = document.getElementById('recent-orders-list');
  if (!el) return;
  if (!orders.length) { el.innerHTML = '<div class="loading-cell">No orders yet</div>'; return; }

  const statusColors = { pending:'#e0b45a', confirmed:'#5a96e0', processing:'#5ab4e0', shipped:'#9664e0', delivered:'#5ac878', cancelled:'#e05a5a' };

  el.innerHTML = orders.map(o => {
    const status = (o.status || 'Pending').toLowerCase();
    const color  = statusColors[status.replace(/\s+/g,'-')] || '#888';
    const ordId  = o.order_id || (o.objectId||'').slice(-8).toUpperCase();
    const date   = o.created_at ? new Date(o.created_at).toLocaleDateString('en-BD', { day:'2-digit', month:'short' }) : '—';
    return `
      <div class="recent-order-row">
        <span style="font-family:'Space Mono',monospace;font-size:10px;color:var(--chrome-dark)">#${ordId}</span>
        <span style="font-size:11px;color:white">${sanitize(o.customer_name || o.full_name || '—')}</span>
        <span style="font-size:11px;color:var(--chrome)">৳${Number(o.total||0).toLocaleString()}</span>
        <span style="font-size:9px;color:${color};text-transform:uppercase;letter-spacing:.08em">${o.status || 'Pending'}</span>
        <span style="font-size:9px;color:rgba(192,192,192,.3)">${date}</span>
        <button class="btn-edit" style="padding:4px 8px;font-size:8px" onclick='openOrderModal(${JSON.stringify(o)})'>View</button>
      </div>
    `;
  }).join('');
}

/* ── Render orders table ─────────────────────────── */
function renderOrdersTable(orders) {
  const tbody = document.getElementById('orders-tbody');
  if (!tbody) return;
  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">No orders found</td></tr>';
    return;
  }

  const statusCls = { pending:'badge-pending', confirmed:'badge-confirmed', processing:'badge-processing', shipped:'badge-shipped', delivered:'badge-delivered', cancelled:'badge-cancelled' };

  tbody.innerHTML = orders.map(o => {
    let items = [];
    try { items = JSON.parse(o.items || o.ordered_products || '[]'); } catch { items = []; }
    const itemsText = items.length
      ? items.map(i => `${sanitize(i.name || i.product_name || '')} ×${i.qty || i.quantity || 1}`).join(', ')
      : sanitize(o.product_names || '—');

    const status    = (o.status || 'Pending');
    const statusKey = status.toLowerCase().replace(/\s+/g,'-');
    const ordId     = o.order_id || (o.objectId||'').slice(-8).toUpperCase();
    const date      = o.created_at
      ? new Date(o.created_at).toLocaleDateString('en-BD', { day:'2-digit', month:'short', year:'numeric' })
      : '—';

    return `
      <tr>
        <td><span style="font-family:'Space Mono',monospace;font-size:10px;color:var(--chrome-dark)">#${ordId}</span></td>
        <td>
          <div style="font-weight:700;color:#fff;font-size:12px">${sanitize(o.customer_name || o.full_name || '—')}</div>
          <div style="font-size:9px;color:var(--chrome-dark)">${sanitize(o.customer_phone || o.phone_number || '')}</div>
          <div style="font-size:9px;color:rgba(192,192,192,.3)">${sanitize(o.district || '')}</div>
        </td>
        <td style="max-width:180px"><div style="font-size:10px;line-height:1.6;white-space:normal">${itemsText}</div></td>
        <td><span style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--chrome-dark)">${sanitize(o.payment_method || o.payment || '—')}</span></td>
        <td><span style="font-weight:700;color:var(--chrome-light)">৳${Number(o.total||0).toLocaleString()}</span></td>
        <td><span class="badge ${statusCls[statusKey] || ''}">${status}</span></td>
        <td style="font-size:10px;color:var(--chrome-dark)">${date}</td>
        <td>
          <button class="btn-edit" onclick='openOrderModal(${JSON.stringify(o)})'>
            <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            View
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

/* ── Search/Filter orders ────────────────────────── */
function searchOrders(q) {
  const term = q.toLowerCase();
  const status = document.getElementById('order-filter-select')?.value || 'all';
  let filtered = allOrders.filter(o =>
    (o.customer_name || o.full_name || '').toLowerCase().includes(term) ||
    (o.order_id || '').toLowerCase().includes(term) ||
    (o.customer_phone || o.phone_number || '').includes(term) ||
    (o.district || '').toLowerCase().includes(term)
  );
  if (status !== 'all') filtered = filtered.filter(o => (o.status || 'pending').toLowerCase() === status);
  renderOrdersTable(filtered);
}

function filterOrders(status) {
  const q = document.getElementById('order-search')?.value || '';
  const term = q.toLowerCase();
  let filtered = status === 'all' ? allOrders : allOrders.filter(o => (o.status || 'pending').toLowerCase() === status);
  if (term) filtered = filtered.filter(o => (o.customer_name || '').toLowerCase().includes(term) || (o.order_id || '').toLowerCase().includes(term));
  renderOrdersTable(filtered);
}

/* ══════════════════════════════════════════════════
   ORDER DETAIL MODAL — Full customer + product view
══════════════════════════════════════════════════ */
function openOrderModal(order) {
  setVal('o-objectId', order.objectId);
  setVal('o-status', order.status || 'Pending');

  /* Customer info */
  setEl('o-customer-name',     order.customer_name  || order.full_name      || '—');
  setEl('o-customer-phone',    order.customer_phone || order.phone_number   || '—');
  setEl('o-customer-email',    order.customer_email || order.email_address  || '—');
  setEl('o-delivery-address',  order.delivery_address ||
    [order.house, order.road_no, order.area_name, order.thana, order.district].filter(Boolean).join(', ') || '—');

  /* Products */
  let items = [];
  try { items = JSON.parse(order.items || order.ordered_products || '[]'); } catch { items = []; }

  const prodList = document.getElementById('o-products-list');
  if (prodList) {
    if (!items.length) {
      prodList.innerHTML = `<div style="font-size:11px;color:var(--chrome-dark);padding:8px">${sanitize(order.product_names || '—')}</div>`;
    } else {
      prodList.innerHTML = items.map(i => {
        const name  = sanitize(i.name || i.product_name || '');
        const img   = i.image || '';
        const size  = i.size  || i.selected_size  || '';
        const color = i.color || i.selected_color || '';
        const qty   = i.qty   || i.quantity        || 1;
        const price = parseFloat(i.price) || 0;
        const sub   = i.subtotal || price * qty;
        return `
          <div class="order-product-row">
            ${img ? `<img src="${sanitize(img)}" class="opr-img" onerror="this.style.display='none'">` : '<div class="opr-img"></div>'}
            <div class="opr-info">
              <div class="opr-name">${name}</div>
              <div class="opr-meta">Size: ${sanitize(size)}${color ? ' · ' + sanitize(color) : ''} | Qty: ${qty}</div>
            </div>
            <div class="opr-price">৳${Number(sub).toLocaleString()}</div>
          </div>
        `;
      }).join('');
    }
  }

  /* Totals */
  const subtotal = parseFloat(order.subtotal) || 0;
  const delivery = parseFloat(order.delivery_charge || order.delivery) || 0;
  const total    = parseFloat(order.total) || 0;
  setEl('o-subtotal', '৳' + subtotal.toLocaleString());
  setEl('o-delivery', '৳' + delivery.toLocaleString());
  setEl('o-total',    '৳' + total.toLocaleString());

  openModal('order');
}

function closeOrderModal() { closeModal('order'); }

async function updateOrderStatus() {
  const objectId = getVal('o-objectId');
  const status   = getVal('o-status');
  if (!objectId) return;

  const btn = document.querySelector('#order-modal .btn-primary');
  btn.disabled = true; btn.textContent = 'Updating...';

  try {
    await Backendless.put('orders', objectId, { status, order_status: status });
    toast(`✓ Status updated to "${status}"`);
    closeOrderModal();
    await loadOrders();
  } catch (err) {
    toast('Update failed: ' + (err.message || ''), 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Update Status';
  }
}

/* ══════════════════════════════════════════════════
   SITE CONTENT CMS
   Table: site_content — columns: key, value
══════════════════════════════════════════════════ */
async function loadSiteContent() {
  try {
    const rows = await Backendless.get('site_content', '?pageSize=100');
    const c = {};
    rows.forEach(r => { if (r.key) c[r.key] = r.value; });

    const map = {
      'c-hero-title1':   'hero_title1',
      'c-hero-title2':   'hero_title2',
      'c-hero-subtitle': 'hero_subtitle',
      'c-hero-cta':      'hero_cta',
      'c-announcement':  'announcement',
      'c-shop-title':    'shop_title',
      'c-shop-subtitle': 'shop_subtitle',
      'c-manifesto-p1':  'manifesto_p1',
      'c-manifesto-p2':  'manifesto_p2'
    };
    Object.entries(map).forEach(([elId, key]) => {
      const el = document.getElementById(elId);
      if (el && c[key] !== undefined) el.value = c[key];
    });
  } catch (err) {
    console.warn('[Admin] Content load failed:', err.message);
  }
}

async function saveContent(section) {
  const sectionMap = {
    hero: {
      hero_title1:   'c-hero-title1',
      hero_title2:   'c-hero-title2',
      hero_subtitle: 'c-hero-subtitle',
      hero_cta:      'c-hero-cta',
    },
    announcement: { announcement: 'c-announcement' },
    shop: {
      shop_title:    'c-shop-title',
      shop_subtitle: 'c-shop-subtitle'
    },
    manifesto: {
      manifesto_p1: 'c-manifesto-p1',
      manifesto_p2: 'c-manifesto-p2'
    }
  };

  const fields = sectionMap[section];
  if (!fields) return;

  toast('Saving...', 'info');
  try {
    const existing    = await Backendless.get('site_content', '?pageSize=100');
    const existingMap = {};
    existing.forEach(r => { existingMap[r.key] = r.objectId; });

    await Promise.all(Object.entries(fields).map(([key, elId]) => {
      const value = document.getElementById(elId)?.value || '';
      return existingMap[key]
        ? Backendless.put('site_content', existingMap[key], { key, value })
        : Backendless.post('site_content', { key, value });
    }));
    toast(`✓ ${section.charAt(0).toUpperCase() + section.slice(1)} content saved`);
  } catch (err) {
    toast('Save failed — check site_content table exists in Backendless', 'error');
  }
}

async function saveAllContent() {
  for (const sec of ['hero', 'announcement', 'shop', 'manifesto']) {
    await saveContent(sec);
  }
  toast('✓ All content saved');
}

/* ══════════════════════════════════════════════════
   MODAL HELPERS
══════════════════════════════════════════════════ */
function openModal(name) {
  const overlay = document.getElementById(`${name}-modal-overlay`);
  const modal   = document.getElementById(`${name}-modal`);
  if (overlay) overlay.classList.add('modal-active');
  if (modal)   modal.classList.add('modal-active');
  document.body.style.overflow = 'hidden';
}
function closeModal(name) {
  const overlay = document.getElementById(`${name}-modal-overlay`);
  const modal   = document.getElementById(`${name}-modal`);
  if (overlay) overlay.classList.remove('modal-active');
  if (modal)   modal.classList.remove('modal-active');
  document.body.style.overflow = '';
}

/* ══════════════════════════════════════════════════
   DOM HELPERS
══════════════════════════════════════════════════ */
function getVal(id) { return document.getElementById(id)?.value || ''; }
function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val || ''; }
function setEl(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
