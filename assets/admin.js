// RESTYLE staff dashboard: orders, delivery, products, enquiries, staff and profile.
// Talks to the Apps Script backend (apps-script/Code.gs); the sign-in token lives in sessionStorage.
(function () {
  'use strict';

  const CONFIG = window.RESTYLE_CONFIG || {};
  const API = CONFIG.ORDER_ENDPOINT;
  const SITE_PRODUCTS = window.RESTYLE_PRODUCTS || [];
  const root = document.getElementById('admin-root');

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US') + ' Ks';
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const time = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const isToday = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();

  const STATUSES = ['Awaiting payment', 'Paid', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];
  const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', delivery: 'Delivery' };
  const ROLE_HELP = { owner: 'Everything, including staff accounts', manager: 'Orders, delivery, products and enquiries', delivery: 'Delivery board: mark paid orders packed, shipped, delivered' };
  const VIEWS = [
    { id: 'overview', label: 'Overview', icon: 'space_dashboard', roles: ['owner', 'manager', 'delivery'] },
    { id: 'orders', label: 'Orders', icon: 'receipt_long', roles: ['owner', 'manager'] },
    { id: 'delivery', label: 'Delivery', icon: 'local_shipping', roles: ['owner', 'manager', 'delivery'] },
    { id: 'products', label: 'Products', icon: 'apparel', roles: ['owner', 'manager'] },
    { id: 'enquiries', label: 'Enquiries', icon: 'mail', roles: ['owner', 'manager'] },
    { id: 'staff', label: 'Staff', icon: 'group', roles: ['owner'] },
    { id: 'profile', label: 'My profile', icon: 'account_circle', roles: ['owner', 'manager', 'delivery'] },
  ];

  // ---------------------------------------------------------------- session & API
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem('restyle.admin') || 'null'); } catch (e) { session = null; }
  if (!session || !session.token) { location.replace('account.html#admin'); return; }

  const signOut = (why) => {
    sessionStorage.removeItem('restyle.admin');
    if (why) sessionStorage.setItem('restyle.adminMsg', why);
    location.replace('account.html#admin');
  };

  async function api(action, data = {}) {
    let out;
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token: session.token, ...data }), signal: AbortSignal.timeout(30000) });
      out = await res.json();
    } catch (e) {
      throw new Error(e.name === 'TimeoutError' ? 'The Sheet took too long to answer. Try again.' : 'Can’t reach the Sheet. Check your connection.');
    }
    if (!out.ok && out.error === 'SESSION') { signOut('Your session ended. Please sign in again.'); throw new Error('Signed out'); }
    if (!out.ok) throw new Error(out.error || 'Something went wrong');
    return out;
  }

  const state = { view: null, orders: null, products: null, enquiries: null, staff: null, orderFilter: 'all', orderQuery: '', productQuery: '', productFilter: 'all', enquiryFilter: 'open' };
  const can = (viewId) => VIEWS.find((v) => v.id === viewId).roles.includes(session.user.role);

  // ---------------------------------------------------------------- feedback
  let toastTimer;
  function toast(msg, kind = 'success') {
    let t = $('.rs-toast');
    if (!t) { t = document.createElement('div'); t.className = 'rs-toast'; document.body.appendChild(t); }
    const icon = { success: ['check_circle', '#7fd1a8'], error: ['error', '#f2a7a0'], info: ['info', '#d6d3cc'] }[kind];
    t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    t.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true" style="color:${icon[1]}">${icon[0]}</span><span>${esc(msg)}</span>`;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), kind === 'error' ? 7000 : 3000);
  }

  // Runs an async action with the button showing a spinner; reports errors as a toast
  async function busy(btn, work) {
    const label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="rs-spinner" aria-hidden="true"></span>Saving…'; }
    try { return await work(); } catch (e) { if (e.message !== 'Signed out') toast(e.message, 'error'); return undefined; } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
  }

  // Side panel (orders) and centred dialog (products, staff) share one implementation
  let lastFocus = null;
  function panel(html, { side = false, label = 'Details' } = {}) {
    closePanel();
    lastFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'ad-overlay' + (side ? ' side' : '');
    wrap.innerHTML = `<div class="ad-panel" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1">
      <button class="ad-close" data-close aria-label="Close"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>${html}</div>`;
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) closePanel(); });
    const box = $('.ad-panel', wrap);
    (box.querySelector('input:not([type=hidden]), select, textarea') || box).focus();
    return box;
  }
  function closePanel() {
    const w = $('.ad-overlay');
    if (!w) return;
    w.remove();
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
    // Keep Tab inside an open dialog
    if (e.key === 'Tab' && $('.ad-panel')) {
      const f = $$('.ad-panel button, .ad-panel a, .ad-panel input, .ad-panel select, .ad-panel textarea').filter((x) => !x.disabled && x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  const confirmBox = (title, text, action, danger = true) => new Promise((resolve) => {
    const box = panel(`<h2 class="font-display-lg text-2xl mb-3 pr-10">${esc(title)}</h2><p class="text-sm text-on-surface-variant mb-8">${esc(text)}</p>
      <div class="flex gap-3 justify-end"><button class="ad-btn" data-close>Cancel</button><button class="ad-btn ${danger ? 'danger' : 'dark'}" data-ok>${esc(action)}</button></div>`, { label: title });
    $('[data-ok]', box).addEventListener('click', () => { closePanel(); resolve(true); });
    $('.ad-overlay').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target.classList.contains('ad-overlay')) resolve(false); });
  });

  // ---------------------------------------------------------------- layout
  function layout() {
    const views = VIEWS.filter((v) => v.roles.includes(session.user.role));
    const initial = esc((session.user.name || '?').trim().charAt(0).toUpperCase());
    const signOutBtn = '<button class="ad-icon" data-signout aria-label="Sign out" title="Sign out"><span class="material-symbols-outlined" aria-hidden="true">logout</span></button>';
    root.innerHTML = `<div class="ad-shell">
      <aside class="ad-side" aria-label="Dashboard">
        <div class="ad-top">
          <a href="index.html" class="ad-brand font-display-lg" aria-label="RESTYLE shop">RESTYLE<span>Dashboard</span></a>
          <div class="ad-me lg:hidden"><span class="ad-avatar" aria-hidden="true">${initial}</span>${signOutBtn}</div>
        </div>
        <nav class="ad-nav" aria-label="Sections">${views.map((v) => `<a href="#${v.id}" data-view="${v.id}"><span class="material-symbols-outlined" aria-hidden="true">${v.icon}</span>${v.label}<span class="ad-count" data-count-for="${v.id}" hidden></span></a>`).join('')}</nav>
        <div class="ad-me hidden lg:flex">
          <span class="ad-avatar" aria-hidden="true">${initial}</span>
          <div class="ad-me-text"><p class="text-sm font-semibold truncate" id="ad-me-name">${esc(session.user.name)}</p><p class="text-[11px] text-neutral-400">${ROLE_LABEL[session.user.role]}</p></div>
          ${signOutBtn}
        </div>
      </aside>
      <main id="admin-main" class="ad-main" tabindex="-1"></main>
    </div>`;
    $$('[data-signout]').forEach((b) => b.addEventListener('click', async () => { try { await api('logout'); } catch (e) { /* signing out locally either way */ } signOut(); }));
  }

  function route() {
    const want = location.hash.slice(1) || 'overview';
    const view = VIEWS.find((v) => v.id === want && can(v.id)) ? want : 'overview';
    state.view = view;
    $$('.ad-nav a').forEach((a) => {
      const on = a.dataset.view === view;
      a.classList.toggle('active', on);
      if (on) { a.setAttribute('aria-current', 'page'); a.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } else a.removeAttribute('aria-current');
    });
    document.title = VIEWS.find((v) => v.id === view).label + ' | RESTYLE Dashboard';
    closePanel();
    render();
  }

  function header(title, sub, actions = '') {
    return `<header class="ad-head"><div><h1 class="font-display-lg text-3xl md:text-4xl">${esc(title)}</h1>${sub ? `<p class="text-sm text-on-surface-variant mt-1">${sub}</p>` : ''}</div>
      <div class="flex flex-wrap gap-2">${actions}<button class="ad-btn" data-refresh><span class="material-symbols-outlined text-[18px]" aria-hidden="true">refresh</span>Refresh</button></div></header>`;
  }

  const loadingHtml = '<div class="ad-loading" role="status"><span class="rs-spinner" aria-hidden="true"></span>Loading from your Google Sheet…</div>';
  const errorHtml = (msg) => `<div class="ad-empty"><span class="material-symbols-outlined" aria-hidden="true">cloud_off</span><p class="font-semibold mb-1">Couldn’t load</p><p class="text-sm text-on-surface-variant mb-6">${esc(msg)}</p><button class="ad-btn dark" data-refresh>Try again</button></div>`;
  const emptyHtml = (icon, title, text) => `<div class="ad-empty"><span class="material-symbols-outlined" aria-hidden="true">${icon}</span><p class="font-semibold mb-1">${esc(title)}</p><p class="text-sm text-on-surface-variant">${esc(text)}</p></div>`;

  // Loads what a view needs, then draws it. force=true re-reads the Sheet.
  async function render(force) {
    const main = $('#admin-main');
    const view = state.view;
    const needs = { overview: ['orders', 'enquiries'], orders: ['orders'], delivery: ['orders'], products: ['products'], enquiries: ['enquiries'], staff: ['staff'], profile: [] }[view]
      .filter((k) => k !== 'enquiries' || can('enquiries'));
    const missing = needs.filter((k) => force || !state[k]);
    if (missing.length) {
      if (!needs.every((k) => state[k])) main.innerHTML = loadingHtml;
      try { await Promise.all(missing.map(load)); } catch (e) { if (state.view === view) main.innerHTML = errorHtml(e.message); bindCommon(main); return; }
    }
    if (state.view !== view) return; // the user moved on while loading
    VIEWS_RENDER[view](main);
    bindCommon(main);
    counts();
  }

  async function load(kind) {
    const action = { orders: 'orders.list', products: 'products.list', enquiries: 'enquiries.list', staff: 'staff.list' }[kind];
    const out = await api(action);
    state[kind] = out[kind];
  }

  function bindCommon(main) {
    $$('[data-refresh]', main).forEach((b) => b.addEventListener('click', () => render(true)));
  }

  // Sidebar badges: orders awaiting payment, paid orders to ship, open enquiries
  function counts() {
    const set = (id, n) => { const el = $(`[data-count-for="${id}"]`); if (el) { el.textContent = n; el.hidden = !n; } };
    if (state.orders) {
      set('orders', state.orders.filter((o) => o.status === 'Awaiting payment').length);
      set('delivery', state.orders.filter((o) => o.status === 'Paid' || o.status === 'Packed').length);
    }
    if (state.enquiries) set('enquiries', state.enquiries.filter((e) => !e.handled).length);
  }

  const pill = (s) => `<span class="rs-pill" data-status="${esc(s)}">${esc(s)}</span>`;
  const customer = (o) => `${esc(o.firstName)} ${esc(o.lastName)}`;

  // ---------------------------------------------------------------- views
  const VIEWS_RENDER = {
    overview(main) {
      const orders = state.orders || [];
      const live = orders.filter((o) => o.status !== 'Cancelled');
      const month = new Date().getMonth(), year = new Date().getFullYear();
      const paidStates = ['Paid', 'Packed', 'Shipped', 'Delivered'];
      const monthRevenue = live.filter((o) => paidStates.includes(o.status) && new Date(o.date).getMonth() === month && new Date(o.date).getFullYear() === year).reduce((n, o) => n + o.total, 0);
      const awaiting = orders.filter((o) => o.status === 'Awaiting payment');
      const toShip = orders.filter((o) => o.status === 'Paid' || o.status === 'Packed');
      const tiles = [
        ['Orders today', orders.filter((o) => isToday(o.date)).length, 'receipt_long', 'orders'],
        ['Awaiting payment', awaiting.length, 'hourglass_top', 'orders', fmt(awaiting.reduce((n, o) => n + o.total, 0)) + ' to check'],
        ['To pack & ship', toShip.length, 'inventory_2', 'delivery'],
        ['Paid this month', fmt(monthRevenue), 'payments', 'orders', 'Paid, packed, shipped & delivered'],
      ].filter((t) => can(t[3]));
      const open = (state.enquiries || []).filter((e) => !e.handled).length;
      main.innerHTML = header('Hello, ' + (session.user.name || '').split(' ')[0], new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })) + `
        <section class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10" aria-label="Summary">${tiles.map(([k, v, ic, to, sub]) => `<a href="#${to}" class="ad-tile"><span class="material-symbols-outlined" aria-hidden="true">${ic}</span><p class="ad-tile-k">${k}</p><p class="ad-tile-v rs-num">${v}</p>${sub ? `<p class="text-[11px] text-on-surface-variant mt-1">${sub}</p>` : ''}</a>`).join('')}</section>
        ${can('enquiries') && open ? `<a href="#enquiries" class="ad-note mb-10"><span class="material-symbols-outlined" aria-hidden="true">mail</span>${open} enquir${open > 1 ? 'ies' : 'y'} waiting for a reply<span class="material-symbols-outlined ml-auto" aria-hidden="true">arrow_forward</span></a>` : ''}
        <section><div class="flex items-center justify-between mb-4"><h2 class="ad-h2">Latest orders</h2>${can('orders') ? '<a href="#orders" class="text-xs underline underline-offset-4 py-3">All orders</a>' : ''}</div>
          ${orders.length ? orderTable(orders.slice(0, 8)) : emptyHtml('receipt_long', 'No orders yet', 'Orders placed on the website will appear here.')}</section>`;
      bindOrderRows(main);
    },

    orders(main) {
      const all = state.orders;
      const q = state.orderQuery.trim().toLowerCase();
      const qd = q.replace(/\D/g, '');
      const list = all.filter((o) => (state.orderFilter === 'all' || o.status === state.orderFilter) &&
        (!q || o.code.toLowerCase().includes(q) || customer(o).toLowerCase().includes(q) || (qd.length > 3 && o.phone.replace(/\D/g, '').includes(qd)) || o.city.toLowerCase().includes(q)));
      main.innerHTML = header('Orders', `${all.length} order${all.length === 1 ? '' : 's'} in your Sheet`, '<button class="ad-btn" data-export><span class="material-symbols-outlined text-[18px]" aria-hidden="true">download</span>CSV</button>') + `
        <div class="ad-toolbar">
          <label class="ad-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><span class="sr-only">Search orders</span><input type="search" id="ord-q" placeholder="Code, name, phone or town" value="${esc(state.orderQuery)}"/></label>
          <div class="ad-chips" role="group" aria-label="Filter by status">${['all', ...STATUSES].map((s) => `<button class="ad-chip" data-filter="${esc(s)}" aria-pressed="${state.orderFilter === s}">${s === 'all' ? 'All' : esc(s)} <span class="rs-num">${s === 'all' ? all.length : all.filter((o) => o.status === s).length}</span></button>`).join('')}</div>
        </div>
        <div id="ord-list">${list.length ? orderTable(list) : emptyHtml('search_off', 'No matching orders', 'Try another search or status.')}</div>`;
      const qInput = $('#ord-q', main);
      qInput.addEventListener('input', () => { state.orderQuery = qInput.value; const pos = qInput.selectionStart; VIEWS_RENDER.orders(main); bindCommon(main); const n = $('#ord-q', main); n.focus(); n.setSelectionRange(pos, pos); });
      $$('[data-filter]', main).forEach((b) => b.addEventListener('click', () => { state.orderFilter = b.dataset.filter; VIEWS_RENDER.orders(main); bindCommon(main); $(`[data-filter="${CSS.escape(b.dataset.filter)}"]`, main).focus(); }));
      $('[data-export]', main).addEventListener('click', () => exportCsv(list));
      bindOrderRows(main);
    },

    delivery(main) {
      const orders = state.orders;
      const weekAgo = Date.now() - 7 * 864e5;
      const cols = [
        { status: 'Paid', title: 'To pack', next: 'Packed', action: 'Mark packed', icon: 'inventory_2' },
        { status: 'Packed', title: 'Ready to ship', next: 'Shipped', action: 'Mark shipped', icon: 'local_shipping' },
        { status: 'Shipped', title: 'On the way', next: 'Delivered', action: 'Mark delivered', icon: 'where_to_vote' },
        { status: 'Delivered', title: 'Delivered (7 days)', recent: true },
      ];
      main.innerHTML = header('Delivery', 'Paid orders move left to right. Add the courier and tracking number when you ship.') + `
        <div class="ad-board">${cols.map((c) => {
          const items = orders.filter((o) => o.status === c.status && (!c.recent || new Date(o.updatedAt || o.date).getTime() > weekAgo));
          return `<section class="ad-col" aria-label="${c.title}"><h2 class="ad-col-h">${c.title}<span class="rs-num">${items.length}</span></h2>
            ${items.length ? items.map((o) => `<article class="ad-card">
              <button class="ad-card-main" data-order="${esc(o.code)}" aria-label="Open order ${esc(o.code)}">
                <span class="flex justify-between gap-2"><strong class="text-sm">${esc(o.code)}</strong><span class="text-xs text-on-surface-variant rs-num">${o.pieces} pc</span></span>
                <span class="block text-sm mt-1">${customer(o)}</span>
                <span class="block text-xs text-on-surface-variant">${esc(o.city)}, ${esc(o.state)}</span>
                ${o.courier || o.tracking ? `<span class="block text-xs mt-2">${esc(o.courier)}${o.tracking ? ' · ' + esc(o.tracking) : ''}</span>` : ''}
                ${o.deliveryDate ? `<span class="block text-xs text-on-surface-variant">Due ${esc(day(o.deliveryDate))}</span>` : ''}
              </button>
              <div class="flex gap-2 mt-3"><a class="ad-icon sm" href="tel:${esc(o.phone.replace(/[^\d+]/g, ''))}" aria-label="Call ${customer(o)}"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">call</span></a>
              ${c.next ? `<button class="ad-btn dark grow" data-advance="${esc(o.code)}" data-next="${c.next}"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">${c.icon}</span>${c.action}</button>` : ''}</div>
            </article>`).join('') : `<p class="ad-col-empty">Nothing here</p>`}</section>`;
        }).join('')}</div>`;
      bindOrderRows(main);
      $$('[data-advance]', main).forEach((b) => b.addEventListener('click', () => {
        const o = orders.find((x) => x.code === b.dataset.advance);
        // Shipping needs the courier details, so open the order instead of a one-click change
        if (b.dataset.next === 'Shipped' && !o.tracking && !o.courier) return openOrder(o.code, { ship: true });
        busy(b, async () => { await saveOrder(o.code, { status: b.dataset.next }); toast(o.code + ' → ' + b.dataset.next); VIEWS_RENDER.delivery(main); bindCommon(main); counts(); });
      }));
    },

    products(main) {
      const all = state.products;
      if (!all.length) {
        main.innerHTML = header('Products', '') + `<div class="ad-empty"><span class="material-symbols-outlined" aria-hidden="true">apparel</span>
          <p class="font-semibold mb-1">Your products aren’t in the Sheet yet</p>
          <p class="text-sm text-on-surface-variant mb-6 max-w-md mx-auto">Import the ${SITE_PRODUCTS.length} pieces from the website into a new Products tab. After that, prices, stock and new pieces are managed here and update the shop within a minute. The two About-page pieces come in hidden, because their prices are placeholders.</p>
          <button class="ad-btn dark" id="prod-import">Import ${SITE_PRODUCTS.length} products</button></div>`;
        $('#prod-import', main).addEventListener('click', (e) => busy(e.currentTarget, async () => {
          const out = await api('products.import', { products: SITE_PRODUCTS });
          state.products = out.products; toast('Imported ' + out.products.length + ' products'); render();
        }));
        return;
      }
      const q = state.productQuery.trim().toLowerCase();
      const f = state.productFilter;
      const list = all.filter((p) => (!q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)) &&
        (f === 'all' || (f === 'live' && p.active && !p.soldOut) || (f === 'soldout' && p.soldOut) || (f === 'hidden' && !p.active)));
      const n = (fn) => all.filter(fn).length;
      main.innerHTML = header('Products', `${n((p) => p.active)} live on the shop · ${n((p) => p.soldOut)} sold out · ${n((p) => !p.active)} hidden`, '<button class="ad-btn dark" id="prod-add"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">add</span>Add product</button>') + `
        <div class="ad-toolbar">
          <label class="ad-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><span class="sr-only">Search products</span><input type="search" id="prod-q" placeholder="Name or category" value="${esc(state.productQuery)}"/></label>
          <div class="ad-chips" role="group" aria-label="Filter products">${[['all', 'All'], ['live', 'On sale'], ['soldout', 'Sold out'], ['hidden', 'Hidden']].map(([k, l]) => `<button class="ad-chip" data-pfilter="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
        </div>
        ${list.length ? `<div class="ad-products">${list.map((p) => `<article class="ad-prod${p.active ? '' : ' is-hidden'}">
          <img src="${esc(p.img)}" alt="" loading="lazy"/>
          <div class="min-w-0 flex-1">
            <p class="text-[10px] tracking-[0.15em] uppercase text-on-surface-variant">${esc(p.category)}</p>
            <h3 class="font-semibold text-sm truncate">${esc(p.name)}</h3>
            <p class="text-sm rs-num">${fmt(p.price)}</p>
            <p class="flex gap-1 mt-1">${p.colors.map((c) => `<span class="w-3 h-3 rounded-full border border-black/10" style="background:${esc(c.hex)}" title="${esc(c.name)}"></span>`).join('')}<span class="text-[11px] text-on-surface-variant ml-1">${esc(p.sizes.join(' / '))}</span></p>
          </div>
          <div class="ad-prod-actions">
            <label class="ad-toggle"><input type="checkbox" data-ptoggle="soldOut" data-id="${esc(p.id)}" ${p.soldOut ? 'checked' : ''}/><span></span>Sold out</label>
            <label class="ad-toggle"><input type="checkbox" data-ptoggle="active" data-id="${esc(p.id)}" ${p.active ? 'checked' : ''}/><span></span>On shop</label>
            <button class="ad-btn" data-pedit="${esc(p.id)}"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">edit</span>Edit</button>
          </div></article>`).join('')}</div>` : emptyHtml('search_off', 'No matching products', 'Try another search or filter.')}`;
      const qInput = $('#prod-q', main);
      qInput.addEventListener('input', () => { state.productQuery = qInput.value; const pos = qInput.selectionStart; VIEWS_RENDER.products(main); bindCommon(main); const n2 = $('#prod-q', main); n2.focus(); n2.setSelectionRange(pos, pos); });
      $$('[data-pfilter]', main).forEach((b) => b.addEventListener('click', () => { state.productFilter = b.dataset.pfilter; VIEWS_RENDER.products(main); bindCommon(main); $(`[data-pfilter="${b.dataset.pfilter}"]`, main).focus(); }));
      $('#prod-add', main).addEventListener('click', () => editProduct(null));
      $$('[data-pedit]', main).forEach((b) => b.addEventListener('click', () => editProduct(all.find((p) => p.id === b.dataset.pedit))));
      // Quick switches save straight away and roll back if the Sheet refuses
      $$('[data-ptoggle]', main).forEach((box) => box.addEventListener('change', async () => {
        const p = all.find((x) => x.id === box.dataset.id);
        const key = box.dataset.ptoggle;
        box.disabled = true;
        try {
          const out = await api('products.save', { product: { ...p, [key]: box.checked } });
          Object.assign(p, out.product);
          toast(p.name + (key === 'soldOut' ? (p.soldOut ? ' marked sold out' : ' back in stock') : (p.active ? ' is on the shop' : ' hidden from the shop')));
          box.closest('.ad-prod').classList.toggle('is-hidden', !p.active);
        } catch (e) { box.checked = !box.checked; if (e.message !== 'Signed out') toast(e.message, 'error'); }
        box.disabled = false;
      }));
    },

    enquiries(main) {
      const all = state.enquiries;
      const f = state.enquiryFilter;
      const list = all.filter((e) => f === 'all' || (f === 'open' ? !e.handled : e.type === f));
      const types = [...new Set(all.map((e) => e.type))];
      const icon = { 'Contact message': 'chat', 'Consultation request': 'event', 'Restock alert': 'notifications', Newsletter: 'mail' };
      main.innerHTML = header('Enquiries', 'Messages, consultation requests, restock alerts and newsletter sign-ups from the website.', '<button class="ad-btn" data-export-emails><span class="material-symbols-outlined text-[18px]" aria-hidden="true">content_copy</span>Copy newsletter emails</button>') + `
        <div class="ad-toolbar"><div class="ad-chips" role="group" aria-label="Filter enquiries">${[['open', 'Needs reply'], ['all', 'All'], ...types.map((t) => [t, t])].map(([k, l]) => `<button class="ad-chip" data-efilter="${esc(k)}" aria-pressed="${f === k}">${esc(l)}</button>`).join('')}</div></div>
        ${list.length ? `<ul class="ad-list">${list.map((e) => {
          const isMail = /@/.test(e.contact);
          return `<li class="ad-enq${e.handled ? ' is-done' : ''}">
            <span class="material-symbols-outlined ad-enq-ic" aria-hidden="true">${icon[e.type] || 'mail'}</span>
            <div class="min-w-0 flex-1">
              <p class="text-xs text-on-surface-variant">${esc(e.type)} · ${time(e.date)}</p>
              <p class="font-semibold text-sm">${esc(e.name || e.contact)}${e.product ? ` <span class="font-normal text-on-surface-variant">— ${esc(e.product)}</span>` : ''}</p>
              ${e.preferredDate || e.service ? `<p class="text-sm">${esc(e.service)}${e.preferredDate ? ' on ' + esc(day(e.preferredDate)) : ''}</p>` : ''}
              ${e.message ? `<p class="text-sm text-on-surface-variant mt-1 whitespace-pre-line">${esc(e.message)}</p>` : ''}
              <a class="text-xs underline underline-offset-4 mt-2 inline-block py-1" href="${isMail ? 'mailto:' : 'tel:'}${esc(isMail ? e.contact : e.contact.replace(/[^\d+]/g, ''))}">${isMail ? 'Email' : 'Call'} ${esc(e.contact)}</a>
            </div>
            ${e.type === 'Newsletter' ? '' : `<label class="ad-toggle shrink-0"><input type="checkbox" data-handled="${e.row}" ${e.handled ? 'checked' : ''}/><span></span>Replied</label>`}
          </li>`;
        }).join('')}</ul>` : emptyHtml('inbox', f === 'open' ? 'All caught up' : 'Nothing here', f === 'open' ? 'Every enquiry has a reply.' : 'New enquiries will appear here.')}`;
      $$('[data-efilter]', main).forEach((b) => b.addEventListener('click', () => { state.enquiryFilter = b.dataset.efilter; VIEWS_RENDER.enquiries(main); bindCommon(main); }));
      $$('[data-handled]', main).forEach((box) => box.addEventListener('change', async () => {
        const e = all.find((x) => x.row === Number(box.dataset.handled));
        box.disabled = true;
        try { await api('enquiries.update', { row: e.row, contact: e.contact, handled: box.checked }); e.handled = box.checked; box.closest('.ad-enq').classList.toggle('is-done', e.handled); counts(); }
        catch (err) { box.checked = !box.checked; if (err.message !== 'Signed out') toast(err.message, 'error'); }
        box.disabled = false;
      }));
      $('[data-export-emails]', main).addEventListener('click', async () => {
        const emails = [...new Set(all.filter((e) => e.type === 'Newsletter').map((e) => e.contact))];
        if (!emails.length) return toast('No newsletter sign-ups yet', 'info');
        try { await navigator.clipboard.writeText(emails.join(', ')); toast(emails.length + ' emails copied'); } catch (e) { toast('Couldn’t copy — your browser blocked it', 'error'); }
      });
    },

    staff(main) {
      const all = state.staff;
      main.innerHTML = header('Staff', 'Give each person their own sign-in. Deactivating someone signs them out straight away.', '<button class="ad-btn dark" id="staff-add"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">person_add</span>Add staff</button>') + `
        <div class="ad-table-wrap"><table class="ad-table"><thead><tr><th scope="col">Name</th><th scope="col">Username</th><th scope="col">Role</th><th scope="col">Last sign-in</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${all.map((s) => { const me = s.username === session.user.username; return `<tr class="${s.active ? '' : 'opacity-50'}">
          <td data-label="Name"><strong>${esc(s.name)}</strong>${me ? ' <span class="text-xs text-on-surface-variant">(you)</span>' : ''}</td>
          <td data-label="Username">${esc(s.username)}</td>
          <td data-label="Role">${me ? ROLE_LABEL[s.role] : `<label class="sr-only" for="role-${esc(s.username)}">Role for ${esc(s.name)}</label><select id="role-${esc(s.username)}" class="ad-select" data-role="${esc(s.username)}">${Object.keys(ROLE_LABEL).map((r) => `<option value="${r}" ${r === s.role ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select>`}</td>
          <td data-label="Last sign-in">${s.lastLogin ? time(s.lastLogin) : 'Never'}</td>
          <td data-label="Status">${s.active ? 'Active' : 'Deactivated'}</td>
          <td class="text-right whitespace-nowrap">${me ? '' : `<button class="ad-btn sm" data-reset="${esc(s.username)}">Reset password</button> <button class="ad-btn sm" data-active="${esc(s.username)}">${s.active ? 'Deactivate' : 'Reactivate'}</button>`}</td>
        </tr>`; }).join('')}</tbody></table></div>
        <section class="mt-10"><h2 class="ad-h2 mb-3">What each role can do</h2><ul class="grid sm:grid-cols-3 gap-4">${Object.keys(ROLE_LABEL).map((r) => `<li class="ad-tile static"><p class="font-semibold text-sm">${ROLE_LABEL[r]}</p><p class="text-sm text-on-surface-variant mt-1">${ROLE_HELP[r]}</p></li>`).join('')}</ul></section>`;
      $('#staff-add', main).addEventListener('click', () => addStaff());
      $$('[data-role]', main).forEach((sel) => sel.addEventListener('change', async () => {
        const s = all.find((x) => x.username === sel.dataset.role);
        const prev = s.role; sel.disabled = true;
        try { await api('staff.save', { username: s.username, role: sel.value }); s.role = sel.value; toast(s.name + ' is now ' + ROLE_LABEL[s.role]); }
        catch (e) { sel.value = prev; if (e.message !== 'Signed out') toast(e.message, 'error'); }
        sel.disabled = false;
      }));
      $$('[data-active]', main).forEach((b) => b.addEventListener('click', async () => {
        const s = all.find((x) => x.username === b.dataset.active);
        if (s.active && !await confirmBox('Deactivate ' + s.name + '?', 'They’ll be signed out and can’t sign in until you reactivate them.', 'Deactivate')) return;
        busy(b, async () => { await api('staff.save', { username: s.username, active: !s.active }); s.active = !s.active; toast(s.name + (s.active ? ' reactivated' : ' deactivated')); VIEWS_RENDER.staff(main); bindCommon(main); });
      }));
      $$('[data-reset]', main).forEach((b) => b.addEventListener('click', () => resetPassword(all.find((x) => x.username === b.dataset.reset))));
    },

    profile(main) {
      const u = session.user;
      main.innerHTML = header('My profile', `${esc(ROLE_LABEL[u.role])} · signed in as <strong>${esc(u.username)}</strong>`) + `
        <div class="grid lg:grid-cols-2 gap-8 max-w-4xl">
          <form id="pf-form" class="ad-form" novalidate><h2 class="ad-h2">Your details</h2>
            ${input('pf-name', 'Display name', `value="${esc(u.name)}" required autocomplete="name"`, 'Shown on orders you update.')}
            ${input('pf-user', 'Username', `value="${esc(u.username)}" disabled`, 'Ask the owner if this needs to change.')}
            <button class="ad-btn dark self-start" type="submit">Save details</button></form>
          <form id="pw-form" class="ad-form" novalidate><h2 class="ad-h2">Change password</h2>
            <input type="text" name="username" value="${esc(u.username)}" autocomplete="username" hidden/>
            ${input('pw-cur', 'Current password', 'type="password" required autocomplete="current-password"')}
            ${input('pw-new', 'New password', 'type="password" required minlength="8" autocomplete="new-password"', 'At least 8 characters.')}
            ${input('pw-new2', 'Repeat new password', 'type="password" required autocomplete="new-password"')}
            <button class="ad-btn dark self-start" type="submit">Change password</button></form>
        </div>`;
      $('#pf-form', main).addEventListener('submit', (e) => {
        e.preventDefault();
        const name = $('#pf-name', main).value.trim();
        if (!fieldError($('#pf-name', main), !name && 'Display name is required.')) return;
        busy($('button[type=submit]', e.target), async () => {
          await api('profile.save', { name }); session.user.name = name;
          sessionStorage.setItem('restyle.admin', JSON.stringify(session));
          $('#ad-me-name').textContent = name; $$('.ad-avatar').forEach((a) => { a.textContent = name.charAt(0).toUpperCase(); }); toast('Details saved');
        });
      });
      $('#pw-form', main).addEventListener('submit', (e) => {
        e.preventDefault();
        const cur = $('#pw-cur', main), nw = $('#pw-new', main), nw2 = $('#pw-new2', main);
        const ok = [fieldError(cur, !cur.value && 'Enter your current password.'), fieldError(nw, nw.value.length < 8 && 'Use at least 8 characters.'), fieldError(nw2, nw2.value !== nw.value && 'The passwords don’t match.')].every(Boolean);
        if (!ok) return $('[aria-invalid=true]', e.target).focus();
        busy($('button[type=submit]', e.target), async () => { await api('password.change', { current: cur.value, next: nw.value }); e.target.reset(); toast('Password changed'); });
      });
    },
  };

  // ---------------------------------------------------------------- orders: table, detail, save
  function orderTable(list) {
    return `<div class="ad-table-wrap"><table class="ad-table clickable"><thead><tr><th scope="col">Order</th><th scope="col">Date</th><th scope="col">Customer</th><th scope="col">Town</th><th scope="col" class="text-right">Total</th><th scope="col">Status</th></tr></thead>
      <tbody>${list.map((o) => `<tr data-order="${esc(o.code)}" tabindex="0" aria-label="Open order ${esc(o.code)}">
        <td data-label="Order"><strong>${esc(o.code)}</strong></td><td data-label="Date">${time(o.date)}</td><td data-label="Customer">${customer(o)}</td>
        <td data-label="Town">${esc(o.city)}</td><td data-label="Total" class="text-right rs-num">${fmt(o.total)}</td><td data-label="Status">${pill(o.status)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function bindOrderRows(scope) {
    $$('[data-order]', scope).forEach((el) => {
      el.addEventListener('click', () => openOrder(el.dataset.order));
      if (el.tagName === 'TR') el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOrder(el.dataset.order); } });
    });
  }

  async function saveOrder(code, changes) {
    const out = await api('orders.update', { code, ...changes });
    const i = state.orders.findIndex((o) => o.code === code);
    if (out.order && i >= 0) state.orders[i] = out.order;
    return state.orders[i];
  }

  function openOrder(code, { ship = false } = {}) {
    const o = state.orders.find((x) => x.code === code);
    if (!o) return;
    const deliveryOnly = session.user.role === 'delivery';
    const statusOptions = deliveryOnly ? ['Packed', 'Shipped', 'Delivered'] : STATUSES;
    const locked = deliveryOnly && ['Awaiting payment', 'Cancelled'].includes(o.status);
    const phone = o.phone.replace(/[^\d+]/g, '');
    const box = panel(`
      <p class="rs-label mb-1">Order</p>
      <div class="flex items-center gap-3 flex-wrap pr-10 mb-1"><h2 class="font-display-lg text-3xl">${esc(o.code)}</h2>${pill(o.status)}</div>
      <p class="text-xs text-on-surface-variant mb-6">Placed ${time(o.date)}${o.updatedBy ? ` · last updated by ${esc(o.updatedBy)} ${time(o.updatedAt)}` : ''}</p>

      ${o.status === 'Awaiting payment' && !deliveryOnly ? `<div class="ad-note warn mb-6"><span class="material-symbols-outlined" aria-hidden="true">account_balance_wallet</span><span>Check KBZ Pay for <strong class="rs-num">${fmt(o.total)}</strong> with the note <strong>${esc(CONFIG.PAYMENT ? CONFIG.PAYMENT.notePrefix : 'Clothing')} ${esc(o.code)}</strong>, then mark it Paid.</span></div>` : ''}

      <section class="ad-sec"><h3 class="ad-h3">Customer</h3>
        <p class="font-semibold">${customer(o)}</p>
        <p class="text-sm">${esc(o.street)}${o.apartment ? ', ' + esc(o.apartment) : ''}<br/>${esc(o.city)}, ${esc(o.state)}, ${esc(o.country)}</p>
        <div class="flex flex-wrap gap-2 mt-3">
          <a class="ad-btn sm" href="tel:${esc(phone)}"><span class="material-symbols-outlined text-[16px]" aria-hidden="true">call</span>${esc(o.phone)}</a>
          ${o.email ? `<a class="ad-btn sm" href="mailto:${esc(o.email)}"><span class="material-symbols-outlined text-[16px]" aria-hidden="true">mail</span>Email</a>` : ''}
          <button class="ad-btn sm" data-copy-address><span class="material-symbols-outlined text-[16px]" aria-hidden="true">content_copy</span>Copy address</button>
        </div>
        ${o.extra ? `<p class="text-xs text-on-surface-variant mt-2">Facebook / Viber: ${esc(o.extra)}</p>` : ''}
      </section>

      <section class="ad-sec"><h3 class="ad-h3">Items</h3>
        <ul class="text-sm divide-y divide-dashed divide-black/10">${o.items.map((i) => `<li class="flex justify-between gap-4 py-2"><span>${esc(i.name)}${i.qty ? ` — ${esc(i.color)}, ${esc(i.size)} <strong>× ${i.qty}</strong>` : ''}</span>${i.qty ? `<span class="rs-num whitespace-nowrap">${fmt(i.price * i.qty)}</span>` : ''}</li>`).join('')}</ul>
        <p class="flex justify-between font-semibold pt-3 border-t border-black/10 mt-1"><span>Total</span><span class="rs-num">${fmt(o.total)}</span></p>
        ${o.notes ? `<p class="text-sm mt-4 p-3 bg-black/[0.03] rounded"><span class="rs-label mb-1">Customer note</span>${esc(o.notes)}</p>` : ''}
      </section>

      <form id="ord-form" class="ad-sec ad-form" novalidate><h3 class="ad-h3">Status & delivery</h3>
        ${locked ? `<p class="text-sm text-on-surface-variant">This order is ${esc(o.status.toLowerCase())}. A manager handles it until it’s paid.</p>` : `
        <div><label class="ad-label" for="ord-status">Status</label>
          <select id="ord-status" class="ad-input">${(statusOptions.includes(o.status) ? statusOptions : [o.status, ...statusOptions]).map((s) => `<option ${s === o.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>`}
        <div class="grid sm:grid-cols-2 gap-4">
          ${input('ord-courier', 'Courier', `value="${esc(o.courier)}" list="couriers" ${locked ? 'disabled' : ''}`)}
          ${input('ord-tracking', 'Tracking no.', `value="${esc(o.tracking)}" ${locked ? 'disabled' : ''}`)}
        </div>
        <datalist id="couriers">${['Royal Express', 'Ninja Van', 'Bee Express', 'Shop delivery', 'Customer pick-up'].map((c) => `<option value="${c}">`).join('')}</datalist>
        ${input('ord-date', 'Delivery date', `type="date" value="${esc(o.deliveryDate)}" ${locked ? 'disabled' : ''}`)}
        <div><label class="ad-label" for="ord-notes">Delivery notes <span class="font-normal text-on-surface-variant">(staff only)</span></label>
          <textarea id="ord-notes" rows="2" class="ad-input" ${locked ? 'disabled' : ''}>${esc(o.deliveryNotes)}</textarea></div>
        ${locked ? '' : '<button class="ad-btn dark self-start" type="submit">Save changes</button>'}
      </form>`, { side: true, label: 'Order ' + o.code });

    $('[data-copy-address]', box).addEventListener('click', async () => {
      const text = [o.firstName + ' ' + o.lastName, o.phone, o.street + (o.apartment ? ', ' + o.apartment : ''), o.city + ', ' + o.state, o.country].join('\n');
      try { await navigator.clipboard.writeText(text); toast('Address copied'); } catch (e) { toast('Couldn’t copy — your browser blocked it', 'error'); }
    });
    if (ship) { $('#ord-status', box).value = 'Shipped'; $('#ord-courier', box).focus(); }
    const form = $('#ord-form', box);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const status = $('#ord-status', box).value;
      const changes = { status, courier: $('#ord-courier', box).value.trim(), tracking: $('#ord-tracking', box).value.trim(), deliveryDate: $('#ord-date', box).value, deliveryNotes: $('#ord-notes', box).value.trim() };
      const go = async () => {
        await busy($('button[type=submit]', form), async () => {
          await saveOrder(o.code, changes);
          toast(o.code + ' saved');
          closePanel();
          render();
        });
      };
      if (status === 'Cancelled' && o.status !== 'Cancelled') {
        confirmBox('Cancel order ' + o.code + '?', 'The customer will see it as cancelled when they track it. You can change the status back later.', 'Cancel order').then((yes) => { if (yes) go(); else openOrder(o.code); });
        return;
      }
      go();
    });
  }

  function exportCsv(list) {
    const cols = [['Order code', 'code'], ['Date', (o) => o.date], ['Status', 'status'], ['First name', 'firstName'], ['Last name', 'lastName'], ['Phone', 'phone'], ['Email', 'email'],
      ['Street', 'street'], ['Apartment', 'apartment'], ['Town', 'city'], ['State', 'state'], ['Items', (o) => o.items.map((i) => i.qty ? `${i.name} - ${i.color}, ${i.size} x ${i.qty}` : i.name).join('; ')],
      ['Total (Ks)', 'total'], ['Courier', 'courier'], ['Tracking', 'tracking'], ['Delivery date', 'deliveryDate']];
    const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
    const csv = [cols.map((c) => c[0]).join(','), ...list.map((o) => cols.map(([, k]) => cell(typeof k === 'function' ? k(o) : o[k])).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'restyle-orders-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------------------------------------------------------------- products: edit / add
  function editProduct(p) {
    const isNew = !p;
    const data = p ? JSON.parse(JSON.stringify(p)) : { name: '', category: '', price: '', img: '', colors: [{ name: 'Black', hex: '#000000' }], sizes: ['S', 'M', 'L'], badge: '', description: '', soldOut: false, active: true };
    const categories = [...new Set([...(state.products || []).map((x) => x.category), 'TAILORED OUTERWEAR', 'OVERSIZED SHIRTS', 'WIDE TROUSERS', 'KNITWEAR'])].filter(Boolean);
    const sizes = [...new Set(['XS', 'S', 'M', 'L', 'XL', ...data.sizes])];
    const box = panel(`<h2 class="font-display-lg text-3xl mb-6 pr-10">${isNew ? 'Add product' : 'Edit product'}</h2>
      <form id="pe-form" class="ad-form" novalidate>
        <div class="grid sm:grid-cols-[140px_1fr] gap-5 items-start">
          <div class="ad-preview"><img id="pe-img-preview" src="${esc(data.img)}" alt="" ${data.img ? '' : 'hidden'}/><span class="material-symbols-outlined" aria-hidden="true" ${data.img ? 'hidden' : ''}>image</span></div>
          <div class="grid gap-4">
            ${input('pe-name', 'Name', `value="${esc(data.name)}" required`)}
            <div class="grid grid-cols-2 gap-4">
              ${input('pe-price', 'Price (Ks)', `type="number" inputmode="numeric" min="1" step="500" value="${esc(data.price)}" required`)}
              ${input('pe-cat', 'Category', `value="${esc(data.category)}" list="pe-cats" required`)}
            </div>
            <datalist id="pe-cats">${categories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
          </div>
        </div>
        ${input('pe-img', 'Image URL', `type="url" value="${esc(data.img)}" required placeholder="https://…"`, 'Paste a link to the photo (it must start with https://). Tip: upload to Google Photos or Imgur and copy the image address.')}
        <fieldset><legend class="ad-label">Colours</legend><div id="pe-colors" class="grid gap-2"></div>
          <button type="button" class="ad-btn sm mt-2" id="pe-color-add"><span class="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>Add colour</button></fieldset>
        <fieldset><legend class="ad-label">Sizes</legend><div class="flex flex-wrap gap-2">${sizes.map((s) => `<label class="ad-check"><input type="checkbox" name="size" value="${esc(s)}" ${data.sizes.includes(s) ? 'checked' : ''}/><span>${esc(s)}</span></label>`).join('')}</div>
          <p class="ad-help" id="pe-size-msg"></p></fieldset>
        <div class="grid grid-cols-2 gap-4">
          <div><label class="ad-label" for="pe-badge">Badge</label><select id="pe-badge" class="ad-input">${['', 'NEW', 'RESTOCKED', 'LIMITED', 'ESSENTIAL'].map((b) => `<option value="${b}" ${b === (data.badge || '') ? 'selected' : ''}>${b || 'None'}</option>`).join('')}</select></div>
          <div class="flex flex-col gap-3 pt-6">
            <label class="ad-toggle"><input type="checkbox" id="pe-soldout" ${data.soldOut ? 'checked' : ''}/><span></span>Sold out</label>
            <label class="ad-toggle"><input type="checkbox" id="pe-active" ${data.active !== false ? 'checked' : ''}/><span></span>Show on shop</label>
          </div>
        </div>
        <div><label class="ad-label" for="pe-desc">Description <span class="font-normal text-on-surface-variant">(optional)</span></label><textarea id="pe-desc" rows="3" class="ad-input">${esc(data.description)}</textarea></div>
        <div class="flex flex-wrap gap-3 justify-between pt-2">
          ${isNew ? '<span></span>' : '<button type="button" class="ad-btn danger" id="pe-delete"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>Delete</button>'}
          <div class="flex gap-3"><button type="button" class="ad-btn" data-close>Cancel</button><button type="submit" class="ad-btn dark">${isNew ? 'Add product' : 'Save changes'}</button></div>
        </div>
      </form>`, { label: isNew ? 'Add product' : 'Edit ' + data.name });

    // Colour rows: name + colour picker
    const colorsBox = $('#pe-colors', box);
    const drawColors = () => {
      colorsBox.innerHTML = data.colors.map((c, i) => `<div class="flex gap-2 items-center">
        <label class="sr-only" for="pe-hex-${i}">Colour ${i + 1} shade</label><input type="color" id="pe-hex-${i}" value="${esc(c.hex)}" class="ad-swatch" data-hex="${i}"/>
        <label class="sr-only" for="pe-cname-${i}">Colour ${i + 1} name</label><input id="pe-cname-${i}" class="ad-input flex-1" value="${esc(c.name)}" placeholder="e.g. Charcoal" data-cname="${i}"/>
        <button type="button" class="ad-icon" data-cdel="${i}" aria-label="Remove colour ${esc(c.name || i + 1)}" ${data.colors.length < 2 ? 'disabled' : ''}><span class="material-symbols-outlined text-[18px]" aria-hidden="true">close</span></button></div>`).join('') + '<p class="ad-help" id="pe-color-msg"></p>';
      $$('[data-hex]', colorsBox).forEach((el) => el.addEventListener('input', () => { data.colors[el.dataset.hex].hex = el.value; }));
      $$('[data-cname]', colorsBox).forEach((el) => el.addEventListener('input', () => { data.colors[el.dataset.cname].name = el.value; }));
      $$('[data-cdel]', colorsBox).forEach((el) => el.addEventListener('click', () => { data.colors.splice(Number(el.dataset.cdel), 1); drawColors(); }));
    };
    drawColors();
    $('#pe-color-add', box).addEventListener('click', () => { data.colors.push({ name: '', hex: '#888888' }); drawColors(); $(`#pe-cname-${data.colors.length - 1}`, box).focus(); });

    const img = $('#pe-img', box);
    img.addEventListener('change', () => {
      const prev = $('#pe-img-preview', box);
      const ok = /^https:\/\//.test(img.value.trim());
      prev.hidden = !ok; prev.nextElementSibling.hidden = ok;
      if (ok) prev.src = img.value.trim();
    });

    if (!isNew) $('#pe-delete', box).addEventListener('click', async () => {
      if (!await confirmBox('Delete ' + data.name + '?', 'It disappears from the shop and the Products tab. Past orders keep their details. To pause it instead, turn off “Show on shop”.', 'Delete')) return editProduct(p);
      const ok = await busy(null, async () => { await api('products.delete', { id: data.id }); return true; });
      if (ok) { state.products = state.products.filter((x) => x.id !== data.id); toast(data.name + ' deleted'); render(); }
    });

    $('#pe-form', box).addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#pe-name', box), price = $('#pe-price', box), cat = $('#pe-cat', box);
      const chosenSizes = $$('input[name=size]:checked', box).map((x) => x.value);
      const colors = data.colors.map((c) => ({ name: c.name.trim(), hex: c.hex })).filter((c) => c.name);
      const checks = [
        fieldError(name, !name.value.trim() && 'Name is required.'),
        fieldError(price, !(Number(price.value) > 0) && 'Enter a price above 0.'),
        fieldError(cat, !cat.value.trim() && 'Category is required.'),
        fieldError(img, !/^https:\/\/\S+$/.test(img.value.trim()) && 'Paste an image link that starts with https://'),
      ];
      $('#pe-size-msg', box).textContent = chosenSizes.length ? '' : 'Pick at least one size.';
      $('#pe-color-msg', box).textContent = colors.length ? '' : 'Name at least one colour.';
      if (!checks.every(Boolean) || !chosenSizes.length || !colors.length) {
        const bad = $('[aria-invalid=true]', box) || (!colors.length ? $('[data-cname]', box) : $('input[name=size]', box));
        if (bad) bad.focus();
        return;
      }
      busy($('button[type=submit]', e.target), async () => {
        const out = await api('products.save', { product: {
          id: data.id, name: name.value.trim(), price: Number(price.value), category: cat.value.trim(), img: img.value.trim(), colors, sizes: chosenSizes,
          badge: $('#pe-badge', box).value, soldOut: $('#pe-soldout', box).checked, active: $('#pe-active', box).checked, description: $('#pe-desc', box).value.trim(),
        } });
        const i = state.products.findIndex((x) => x.id === out.product.id);
        if (i >= 0) state.products[i] = out.product; else state.products.unshift(out.product);
        toast(out.product.name + (isNew ? ' added' : ' saved'));
        closePanel();
        render();
      });
    });
  }

  // ---------------------------------------------------------------- staff: add / reset password
  function addStaff() {
    const box = panel(`<h2 class="font-display-lg text-3xl mb-2 pr-10">Add staff</h2><p class="text-sm text-on-surface-variant mb-6">Share the username and temporary password with them in person. They can change the password under My profile.</p>
      <form id="sa-form" class="ad-form" novalidate>
        ${input('sa-name', 'Name', 'required autocomplete="off"')}
        ${input('sa-user', 'Username', 'required autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="e.g. kokyaw"', 'Letters, numbers, dots or dashes. 3–30 characters.')}
        <fieldset><legend class="ad-label">Role</legend><div class="grid gap-2">${Object.keys(ROLE_LABEL).map((r) => `<label class="ad-radio"><input type="radio" name="role" value="${r}" ${r === 'delivery' ? 'checked' : ''}/><span><strong>${ROLE_LABEL[r]}</strong><br/><span class="text-xs text-on-surface-variant">${ROLE_HELP[r]}</span></span></label>`).join('')}</div></fieldset>
        ${input('sa-pass', 'Temporary password', `value="${tempPassword()}" required minlength="8" autocomplete="off"`, 'At least 8 characters. We made one up for you.')}
        <div class="flex gap-3 justify-end"><button type="button" class="ad-btn" data-close>Cancel</button><button type="submit" class="ad-btn dark">Add staff</button></div>
      </form>`, { label: 'Add staff' });
    $('#sa-form', box).addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#sa-name', box), user = $('#sa-user', box), pass = $('#sa-pass', box);
      const ok = [fieldError(name, !name.value.trim() && 'Name is required.'), fieldError(user, !/^[a-z0-9._-]{3,30}$/i.test(user.value.trim()) && 'Use 3–30 letters, numbers, dots or dashes.'), fieldError(pass, pass.value.length < 8 && 'Use at least 8 characters.')].every(Boolean);
      if (!ok) return $('[aria-invalid=true]', box).focus();
      busy($('button[type=submit]', e.target), async () => {
        await api('staff.save', { create: true, name: name.value.trim(), username: user.value.trim().toLowerCase(), role: $('input[name=role]:checked', box).value, password: pass.value });
        await load('staff');
        toast(name.value.trim() + ' added — share their sign-in details');
        closePanel(); render();
      });
    });
  }

  function resetPassword(s) {
    const box = panel(`<h2 class="font-display-lg text-3xl mb-2 pr-10">Reset password</h2><p class="text-sm text-on-surface-variant mb-6">Set a new temporary password for <strong>${esc(s.name)}</strong> and share it with them.</p>
      <form id="rp-form" class="ad-form" novalidate>${input('rp-pass', 'New password', `value="${tempPassword()}" required minlength="8" autocomplete="off"`)}
      <div class="flex gap-3 justify-end"><button type="button" class="ad-btn" data-close>Cancel</button><button type="submit" class="ad-btn dark">Set password</button></div></form>`, { label: 'Reset password for ' + s.name });
    $('#rp-form', box).addEventListener('submit', (e) => {
      e.preventDefault();
      const pass = $('#rp-pass', box);
      if (!fieldError(pass, pass.value.length < 8 && 'Use at least 8 characters.')) return pass.focus();
      busy($('button[type=submit]', e.target), async () => { await api('staff.save', { username: s.username, password: pass.value }); toast('Password reset for ' + s.name); closePanel(); });
    });
  }

  function tempPassword() {
    const c = 'abcdefghjkmnpqrstuvwxyz23456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => c[b % c.length]).join('').replace(/(.{5})/, '$1-');
  }

  // ---------------------------------------------------------------- form helpers
  function input(id, label, attrs, help) {
    return `<div><label class="ad-label" for="${id}">${label}</label><input id="${id}" class="ad-input" ${attrs} aria-describedby="${id}-msg${help ? ` ${id}-help` : ''}"/>
      ${help ? `<p class="ad-help" id="${id}-help">${help}</p>` : ''}<p class="ad-err" id="${id}-msg" hidden></p></div>`;
  }
  // Shows (or clears) a message under a field. Returns true when the field is fine.
  function fieldError(el, msg) {
    const out = $('#' + el.id + '-msg');
    el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (out) { out.hidden = !msg; out.textContent = msg || ''; }
    return !msg;
  }

  // ---------------------------------------------------------------- boot
  layout();
  route();
  window.addEventListener('hashchange', route);
  // Confirm the session is still valid and pick up role or name changes made by the owner
  api('me').then((r) => {
    const roleChanged = r.user.role !== session.user.role;
    session.user = r.user;
    sessionStorage.setItem('restyle.admin', JSON.stringify(session));
    if (roleChanged) { layout(); route(); } else { $('#ad-me-name').textContent = r.user.name; }
  }).catch(() => {});
  // Quietly refresh orders every 2 minutes while the tab is open, so new orders show up
  setInterval(() => {
    if (document.hidden || !state.orders || $('.ad-overlay') || !['overview', 'orders', 'delivery'].includes(state.view)) return;
    const before = state.orders.length;
    load('orders').then(() => {
      const fresh = state.orders.length - before;
      if (fresh > 0) toast(fresh + ' new order' + (fresh > 1 ? 's' : ''), 'info');
      if (!$('.ad-overlay') && document.activeElement && !document.activeElement.matches('input, select, textarea')) render();
    }).catch(() => {});
  }, 120000);
})();
