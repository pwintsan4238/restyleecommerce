// RESTYLE site behaviour: bag, wishlist, search, filters, FAQ, forms and the generated pages.
(function () {
  'use strict';

  const PRODUCTS = window.RESTYLE_PRODUCTS || [];
  const CONFIG = window.RESTYLE_CONFIG || { PAYMENT: { instructions: [] }, DELIVERY_FEE: 0 };
  const CONTACT = { phone: '+959795607196', email: 'restyleofficial.mm@gmail.com', maps: 'https://maps.google.com/?q=Time+City+Yangon' };
  const page = document.body.dataset.page;

  // ---------- Storage (per browser; falls back to memory when blocked) ----------
  const memory = {};
  const load = (k, d) => { try { const v = localStorage.getItem('restyle.' + k); return v ? JSON.parse(v) : d; } catch (e) { return memory[k] || d; } };
  const save = (k, v) => { memory[k] = v; try { localStorage.setItem('restyle.' + k, JSON.stringify(v)); } catch (e) {} };

  const getCart = () => load('cart', []);
  const getWish = () => load('wish', []);

  // ---------- Live catalogue ----------
  // Once products are managed in the dashboard, the Sheet's list replaces the built-in one.
  // The last copy is kept so pages draw at once; a fresh copy is fetched in the background.
  const STATIC_PRODUCTS = PRODUCTS.slice();
  const LIVE_MAX_AGE = 60 * 1000;
  let liveInUse = false;
  let checkoutRefresh = null; // set by renderCheckout
  const useLive = (list) => { if (Array.isArray(list) && list.length) { PRODUCTS.length = 0; list.forEach((p) => PRODUCTS.push(p)); liveInUse = true; } };
  let liveCache = load('live', null);
  if (liveCache) useLive(liveCache.products);
  // Bundles and membership tiers come with the product list (see Code.gs publicPromotions_)
  const NO_PROMOS = { membership: false, tiers: [], bundles: [], coupons: false };
  let PROMOS = (liveCache && liveCache.promotions) || NO_PROMOS;
  function refreshLive(onChange, force) {
    if (!CONFIG.ORDER_ENDPOINT || (!force && liveCache && Date.now() - liveCache.at < LIVE_MAX_AGE)) return;
    fetch(CONFIG.ORDER_ENDPOINT + '?action=products', { signal: AbortSignal.timeout(20000) }).then((r) => r.json()).then((out) => {
      if (!out.ok || !Array.isArray(out.products)) return; // older backend without a Products tab
      const promos = out.promotions || NO_PROMOS;
      const changed = JSON.stringify([out.products, promos]) !== JSON.stringify(liveCache && [liveCache.products, liveCache.promotions || NO_PROMOS]);
      liveCache = { at: Date.now(), products: out.products, promotions: promos };
      save('live', liveCache);
      PROMOS = promos;
      if (changed) { useLive(out.products); if (onChange) onChange(); }
    }).catch(() => {});
  }

  // ---------- Helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => n.toLocaleString('en-US') + ' Ks';
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const byId = (id) => PRODUCTS.find((p) => p.id === id);
  const byName = (name) => PRODUCTS.find((p) => norm(p.name) === norm(name));
  const url = (p) => 'product.html?id=' + encodeURIComponent(p.id);
  const hexOf = (p, name) => (p.colors.find((c) => c.name === name) || { hex: name }).hex;
  // Only lines that still match a sellable product, colour and size count
  const validLines = () => getCart().filter((i) => { const p = byId(i.id); return p && !p.soldOut && p.colors.some((c) => c.name === i.color) && p.sizes.includes(i.size); });
  const lineTotal = (lines) => lines.reduce((n, i) => n + byId(i.id).price * i.qty, 0);
  // The pricing rule, the same as promoTotals_ in Code.gs (the Sheet re-checks every order).
  // Each complete set of a bundle's pieces gets its % off; a piece counts towards one bundle, best discount first.
  // A member discount then applies to what's left.
  function promoTotals(items, tier, coupon) {
    const price = {}, left = {};
    let subtotal = 0;
    items.forEach((i) => { price[i.id] = i.price; left[i.id] = (left[i.id] || 0) + i.qty; subtotal += i.price * i.qty; });
    const bundles = [];
    PROMOS.bundles.filter((b) => b.active).slice().sort((a, b) => b.percent - a.percent).forEach((b) => {
      const sets = Math.min(...b.items.map((id) => left[id] || 0));
      if (!(sets > 0)) return;
      const setPrice = b.items.reduce((n, id) => n + price[id], 0);
      b.items.forEach((id) => { left[id] -= sets; });
      bundles.push({ id: b.id, name: b.name, sets, percent: b.percent, discount: Math.round(setPrice * sets * b.percent / 100) });
    });
    const bundleDiscount = bundles.reduce((n, b) => n + b.discount, 0);
    const base = subtotal - bundleDiscount;
    let memberDiscount = 0;
    if (tier && PROMOS.membership) memberDiscount = tier.type === 'amount' ? Math.min(Math.round(tier.value), base) : Math.round(base * tier.value / 100);
    const afterMember = base - memberDiscount;
    let couponDiscount = 0;
    if (coupon) couponDiscount = coupon.type === 'amount' ? Math.min(Math.round(coupon.value), afterMember) : Math.round(afterMember * coupon.value / 100);
    return { subtotal, bundles, bundleDiscount, tierName: memberDiscount ? tier.name : '', memberDiscount, couponCode: couponDiscount ? coupon.code : '', couponDiscount, total: afterMember - couponDiscount + (CONFIG.DELIVERY_FEE || 0) };
  }
  const priced = (lines) => lines.map((i) => ({ ...i, price: byId(i.id).price }));
  const tierDeal = (t) => (t.type === 'amount' ? fmt(t.value) + ' off' : t.value + '% off');
  // Badge colour follows the tier's rank (lowest spend first); names are whatever the shop chose
  const tierBadge = (name) => {
    const r = PROMOS.tiers.findIndex((t) => t.name === name);
    return `<span class="rs-tier" data-rank="${r < 0 ? 0 : r}">${esc(name)}</span>`;
  };
  // Lines for a summary box: bundle savings, the member discount and a coupon
  const discountRows = (t, cls) => t.bundles.map((b) => `<div class="flex justify-between gap-4 ${cls} rs-disc"><span>Bundle: ${esc(b.name)}${b.sets > 1 ? ' × ' + b.sets : ''}</span><span>−${fmt(b.discount)}</span></div>`).join('')
    + (t.memberDiscount ? `<div class="flex justify-between gap-4 ${cls} rs-disc"><span>${esc(t.tierName)} member</span><span>−${fmt(t.memberDiscount)}</span></div>` : '')
    + (t.couponDiscount ? `<div class="flex justify-between gap-4 ${cls} rs-disc"><span>Coupon ${esc(t.couponCode)}</span><span>−${fmt(t.couponDiscount)}</span></div>` : '');

  // "Member privileges" button with a popover listing the tiers. align: 'left' | 'right'; up: open above.
  let tipCount = 0;
  function privilegeTip(label = 'Member privileges', { align = 'left', up = false } = {}) {
    if (!PROMOS.membership || !PROMOS.tiers.length) return '';
    const id = 'rs-tip-' + (++tipCount);
    return `<span class="rs-tip"><button type="button" class="rs-tip-btn" aria-expanded="false" aria-controls="${id}" data-tip><span class="material-symbols-outlined" aria-hidden="true">workspace_premium</span>${esc(label)}</button>
      <span class="rs-tip-pop${align === 'right' ? ' right' : ''}${up ? ' up' : ''}" id="${id}" role="region" aria-label="Membership tiers" hidden>
        <strong class="block text-[11px] tracking-[0.2em] uppercase">RESTYLE Membership</strong>
        <span class="block text-neutral-300 mt-1">Your total spend on paid orders unlocks a discount on every order.</span>
        <ul>${PROMOS.tiers.map((t) => `<li>${tierBadge(t.name)}<span class="text-right"><strong>${tierDeal(t)}</strong><span class="block text-[11px] text-neutral-400">from ${fmt(t.threshold)} spent</span></span></li>`).join('')}</ul>
        <span class="block text-neutral-300">We recognise you by your phone number at checkout. <a href="info.html?p=membership">How it works</a></span>
      </span></span>`;
  }
  // One set of listeners for every tooltip on the page
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tip]');
    $$('[data-tip][aria-expanded="true"]').forEach((b) => { if (b !== btn) { b.setAttribute('aria-expanded', 'false'); $('#' + b.getAttribute('aria-controls')).hidden = true; } });
    if (!btn) return;
    const open = btn.getAttribute('aria-expanded') !== 'true';
    const pop = $('#' + btn.getAttribute('aria-controls'));
    btn.setAttribute('aria-expanded', String(open));
    pop.hidden = !open;
    if (!open) return;
    // Keep the popover on screen on narrow phones. `translate` rather than `transform`,
    // because the fade-in animation owns `transform`.
    pop.style.translate = '';
    const r = pop.getBoundingClientRect(), edge = 12;
    const shift = r.left < edge ? edge - r.left : r.right > innerWidth - edge ? innerWidth - edge - r.right : 0;
    if (shift) pop.style.translate = `${Math.round(shift)}px 0`;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const b = $('[data-tip][aria-expanded="true"]');
    if (b) { b.setAttribute('aria-expanded', 'false'); $('#' + b.getAttribute('aria-controls')).hidden = true; b.focus(); }
  });

  // Membership status for a phone number, asked of the Sheet once per number per visit
  const phoneKey = (p) => String(p || '').replace(/\D/g, '').replace(/^(95|0)+/, '');
  const memberCache = {};
  function memberFor(phone) {
    const k = phoneKey(phone);
    if (!PROMOS.membership || k.length < 6 || !CONFIG.ORDER_ENDPOINT) return Promise.resolve(null);
    if (!memberCache[k]) memberCache[k] = postApi({ action: 'member', phone }).catch(() => { delete memberCache[k]; return null; });
    return memberCache[k];
  }

  // Bundles a product belongs to, with the other pieces and the set price
  function bundlesFor(p) {
    return PROMOS.bundles.filter((b) => b.active && b.items.includes(p.id)).map((b) => {
      const items = b.items.map(byId).filter(Boolean);
      if (items.length !== b.items.length) return null;
      const full = items.reduce((n, x) => n + x.price, 0);
      return { ...b, products: items, full, price: full - Math.round(full * b.percent / 100) };
    }).filter(Boolean);
  }

  const icon = (el) => { const s = el.querySelector('.material-symbols-outlined'); return s ? s.textContent.trim() : ''; };
  const label = (el) => norm(el.textContent.replace(/\b(arrow_forward|north_east|add|remove)\b/g, ''));

  let toastTimer;
  // kind: 'success' (default), 'info' or 'error'. Errors stay up longer so contact details can be read.
  const TOAST_ICONS = { success: ['check_circle', '#7fd1a8'], info: ['info', '#d6d3cc'], error: ['error', '#f2a7a0'] };
  function toast(html, kind = 'success') {
    let t = $('.rs-toast');
    if (!t) { t = document.createElement('div'); t.className = 'rs-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    const [ic, colour] = TOAST_ICONS[kind] || TOAST_ICONS.success;
    t.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true" style="color:' + colour + '">' + ic + '</span><span>' + html + '</span>';
    t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), kind === 'error' ? 8000 : 3200);
  }

  function updateBadges() {
    // Count only pieces still in the shop, so removed or sold-out items don't inflate the badges
    const counts = { cart: validLines().reduce((n, i) => n + i.qty, 0), wish: getWish().filter(byId).length };
    $$('[data-count]').forEach((b) => {
      const n = counts[b.dataset.count];
      if (n > Number(b.textContent || 0)) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
      b.textContent = n; b.hidden = !n;
      const link = b.closest('a');
      if (link) link.setAttribute('aria-label', (b.dataset.count === 'cart' ? 'Shopping bag' : 'Wishlist') + (n ? ', ' + n + (b.dataset.count === 'cart' ? ' pieces' : ' saved') : ''));
    });
  }

  // ---------- Bag & wishlist ----------
  function addToCart(p, opts = {}) {
    if (!p) return;
    if (p.soldOut) return notifyMe(p);
    const size = opts.size || (p.sizes.includes('M') ? 'M' : p.sizes[0]);
    const color = opts.color || p.colors[0].name;
    const cart = getCart();
    const line = cart.find((i) => i.id === p.id && i.size === size && i.color === color);
    const have = line ? line.qty : 0;
    // At most 10 of one piece per order; only add what fits
    const qty = Math.min(10 - have, Math.max(1, Math.min(10, opts.qty || 1)));
    if (qty <= 0) { toast('You already have the maximum of 10 in your bag — <a href="cart.html">View bag</a>', 'info'); return false; }
    if (line) line.qty += qty; else cart.push({ id: p.id, size, color, qty });
    save('cart', cart);
    updateBadges();
    const capped = qty < (opts.qty || 1);
    toast(esc(p.name) + ' · ' + esc(color) + ', ' + esc(size) + (qty > 1 ? ' × ' + qty : '') + ' added' + (capped ? ' (limit 10)' : '') + ' — <a href="cart.html">View bag</a>');
    return true;
  }

  function toggleWish(p) {
    const wish = getWish();
    const i = wish.indexOf(p.id);
    if (i >= 0) wish.splice(i, 1); else wish.push(p.id);
    save('wish', wish);
    updateBadges();
    syncWishIcons();
    toast(i >= 0 ? 'Removed from wishlist' : esc(p.name) + ' saved — <a href="wishlist.html">View wishlist</a>');
    return i < 0;
  }

  function syncWishIcons() {
    const wish = getWish();
    $$('[data-wish-id]').forEach((b) => {
      const on = wish.includes(b.dataset.wishId);
      const s = b.querySelector('.material-symbols-outlined');
      if (s) s.classList.toggle('is-filled', on);
      b.setAttribute('aria-pressed', on);
      if (b.dataset.wishLabel) b.lastChild.textContent = on ? 'SAVED TO WISHLIST' : 'ADD TO WISHLIST';
    });
  }

  // Sends a contact message, consultation request, restock alert or newsletter sign-up to the Enquiries sheet.
  // Disables the form's button while sending; on failure tells the buyer how to reach us instead.
  async function sendEnquiry(form, kind, data) {
    const btn = $('button[type=submit], button:not([type])', form);
    const label = btn && btn.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="rs-spinner" aria-hidden="true"></span>Sending…'; }
    try {
      if (CONFIG.ORDER_ENDPOINT) {
        const res = await fetch(CONFIG.ORDER_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ type: 'enquiry', kind, ...data }), signal: AbortSignal.timeout(20000) });
        const out = await res.json();
        if (!out.ok) throw new Error(out.error);
      }
      return true;
    } catch (e) {
      toast("Sorry, that didn't send. Please call " + CONTACT.phone + ' or email ' + CONTACT.email, 'error');
      return false;
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = label; }
    }
  }

  function notifyMe(p) {
    modal(`<span class="rs-label mb-2">Restock alert</span>
      <h3 class="font-display-lg text-3xl mb-2">${esc(p.name)}</h3>
      <p class="text-sm text-on-surface-variant mb-6">This piece is sold out. Leave your email and we'll tell you when it's back.</p>
      <form data-form="notify" class="space-y-6"><label class="rs-label" for="nt-email">Email</label>
      <input id="nt-email" class="rs-field" type="email" name="email" required placeholder="name@email.com" autocomplete="email"/>
      <button class="w-full bg-primary text-white py-4 rounded-full font-label-caps text-[11px] tracking-[0.2em]">NOTIFY ME</button></form>`,
    (box) => $('form', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!await sendEnquiry(e.target, 'restock', { contact: e.target.email.value, product: p.name })) return;
      closeModal(); toast("We'll email you when it's back");
    }));
  }

  // ---------- Modal ----------
  function modal(inner, onOpen, opts = {}) {
    closeModal();
    const o = document.createElement('div');
    o.className = 'rs-overlay' + (opts.center === false ? '' : ' center');
    o.innerHTML = `<div class="rs-panel" role="dialog" aria-modal="true"><button class="rs-close" aria-label="Close" data-close><span class="material-symbols-outlined">close</span></button>${inner}</div>`;
    o.addEventListener('click', (e) => { if (e.target === o || e.target.closest('[data-close]')) closeModal(); });
    document.body.appendChild(o);
    document.body.style.overflow = 'hidden';
    if (onOpen) onOpen(o);
    const f = o.querySelector('input, select, textarea, button:not([data-close])');
    if (f) f.focus();
  }
  function closeModal() { const o = $('.rs-overlay'); if (o) o.remove(); document.body.style.overflow = ''; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  function consultation() {
    modal(`<span class="rs-label mb-2">Atelier private service</span>
      <h3 class="font-display-lg text-3xl mb-6">Book a Consultation</h3>
      <form data-form="consult" class="space-y-6">
        <div><label class="rs-label" for="c-name">Full name</label><input id="c-name" name="name" class="rs-field" required/></div>
        <div><label class="rs-label" for="c-phone">Phone or email</label><input id="c-phone" name="contact" class="rs-field" required/></div>
        <div class="grid grid-cols-2 gap-4">
          <div><label class="rs-label" for="c-date">Preferred date</label><input id="c-date" name="date" type="date" class="rs-field" required/></div>
          <div><label class="rs-label" for="c-type">Service</label><select id="c-type" name="service" class="rs-field">
            <option>Fitting &amp; sizing</option><option>Wardrobe styling</option><option>Tailoring alterations</option><option>Private viewing</option></select></div>
        </div>
        <div><label class="rs-label" for="c-notes">Notes</label><textarea id="c-notes" name="notes" rows="2" class="rs-field resize-none"></textarea></div>
        <button class="w-full bg-primary text-white py-4 rounded-full font-label-caps text-[11px] tracking-[0.2em]">REQUEST APPOINTMENT</button>
      </form>`,
    (box) => {
      const d = $('input[type=date]', box); d.min = new Date().toISOString().slice(0, 10);
      $('form', box).addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target));
        if (!await sendEnquiry(e.target, 'consultation', { name: data.name, contact: data.contact, date: data.date, service: data.service, message: data.notes })) return;
        closeModal(); toast('Request received — our concierge will confirm by ' + esc(data.date));
      });
    });
  }

  // ---------- Search ----------
  function search() {
    modal(`<label class="rs-label mb-2" for="rs-q">Search the atelier</label>
      <input id="rs-q" class="rs-field text-xl" placeholder="Jacket, trousers, black…" autocomplete="off"/>
      <div id="rs-results" class="mt-6 max-h-[60vh] overflow-y-auto divide-y divide-black/5"></div>`,
    (box) => {
      const q = $('#rs-q', box), out = $('#rs-results', box);
      const render = () => {
        const term = norm(q.value);
        const hits = PRODUCTS.filter((p) => !term || norm(p.name + ' ' + p.category).includes(term)).slice(0, 8);
        out.innerHTML = hits.length ? hits.map((p) => `<a href="${url(p)}" class="flex items-center gap-4 py-3 hover:opacity-70">
          <img src="${p.img}" alt="" class="w-12 h-16 object-cover rounded"/><span class="flex-1"><span class="block font-display-lg text-lg">${esc(p.name)}</span>
          <span class="text-[10px] tracking-widest text-on-surface-variant">${esc(p.category)}</span></span><span class="text-sm">${fmt(p.price)}</span></a>`).join('')
          : '<p class="py-6 text-sm text-on-surface-variant">No pieces match that search.</p>';
      };
      q.addEventListener('input', render); render();
    }, { center: false });
  }

  // ---------- Header ----------
  function initHeader() {
    const btn = $('[data-action="menu"]'), menu = $('#mobile-menu');
    const setMenu = (open) => {
      menu.classList.toggle('hidden', !open);
      btn.setAttribute('aria-expanded', open);
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      btn.querySelector('.material-symbols-outlined').textContent = open ? 'close' : 'menu';
    };
    if (btn && menu) {
      btn.addEventListener('click', () => setMenu(menu.classList.contains('hidden')));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.classList.contains('hidden')) { setMenu(false); btn.focus(); } });
    }
    $$('[data-action="search"]').forEach((b) => b.addEventListener('click', search));
  }

  // ---------- Product cards on designed pages ----------
  function cardFor(h3) {
    let el = h3.parentElement;
    while (el && el !== document.body && !el.querySelector('img')) el = el.parentElement;
    return el;
  }

  // The designed collections grid only shows 12 pieces; add the rest in the same card style
  const catalogCard = (p) => `<div class="product-card group bg-[#EFECE6] p-4 rounded-lg border border-[#E2DDD5]/50 shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all duration-500">
    <div class="relative aspect-[3/4] overflow-hidden mb-6">
      <img class="product-image w-full h-full object-cover transition-transform duration-700 ease-out rounded-lg" src="${p.img}" alt="${esc(p.name)}" loading="lazy"/>
      ${p.badge ? `<div class="absolute top-4 left-4"><span class="bg-primary text-on-primary px-3 py-1 font-label-caps text-[10px] tracking-widest">${esc(p.badge)}</span></div>` : ''}
      <div class="absolute top-4 right-4 flex flex-col gap-2 product-hover-action">
        <button class="w-10 h-10 glass-card flex items-center justify-center hover:bg-white transition-colors"><span class="material-symbols-outlined text-[20px]">favorite</span></button>
        <button class="w-10 h-10 glass-card flex items-center justify-center hover:bg-white transition-colors"><span class="material-symbols-outlined text-[20px]">visibility</span></button>
      </div>
      <div class="absolute bottom-0 left-0 w-full p-4 product-hover-action translate-y-2">
        <button class="w-full py-3 glass-card text-primary font-label-caps tracking-[0.2em] hover:bg-white/90 transition-all">${p.soldOut ? 'RESTOCK NOTIFY' : 'QUICK ADD'}</button>
      </div>
    </div>
    <div class="flex flex-col gap-2">
      <span class="font-label-caps text-on-surface-variant uppercase text-[10px] tracking-widest">${esc(p.category)}</span>
      <h3 class="font-headline-sm text-headline-sm">${esc(p.name)}</h3>
      <div class="flex justify-between items-center"><span class="font-body-md text-primary rs-num">${fmt(p.price)}</span>
        <div class="flex gap-1">${p.colors.map((c) => `<div class="w-3 h-3 rounded-full border border-black/10" style="background-color:${c.hex}" title="${esc(c.name)}"></div>`).join('')}</div></div>
      <div class="pt-2 border-t border-outline/10 flex gap-2"></div>
    </div></div>`;

  function fillCatalog() {
    const grid = document.body.dataset.page === 'collections' && $('.staggered-grid');
    if (!grid) return;
    const shown = new Set($$('h3', grid).map((h) => byName(h.textContent)).filter(Boolean).map((p) => p.id));
    grid.insertAdjacentHTML('beforeend', PRODUCTS.filter((p) => !shown.has(p.id) && !p.placeholder).map(catalogCard).join(''));
  }

  // Price text on designed cards follows the live catalogue
  function syncCardPrices() {
    $$('[data-price-for]').forEach((el) => { const p = byId(el.dataset.priceFor); if (p) el.textContent = fmt(p.price); });
  }

  function initCards() {
    $$('main h3').forEach((h3) => {
      const p = byName(h3.textContent);
      if (!p) {
        // A designed piece that was removed or hidden in the dashboard
        if (liveInUse && STATIC_PRODUCTS.some((s) => norm(s.name) === norm(h3.textContent))) {
          const gone = cardFor(h3);
          if (gone && gone !== document.body) gone.classList.add('rs-hidden-card');
        }
        return;
      }
      const card = cardFor(h3);
      if (!card || card.dataset.productId) return;
      card.dataset.productId = p.id;
      card.dataset.category = p.category;
      const priceEl = $$('span, p, div', card).find((el) => !el.children.length && /^[\d,]+\s*Ks$/.test(el.textContent.trim()));
      if (priceEl) priceEl.dataset.priceFor = p.id;
      // Size row on designed cards lists old sizes; show what is actually sold
      const sizeRow = $('.border-t.flex', card);
      if (sizeRow) sizeRow.innerHTML = p.sizes.map((s) => `<span class="font-label-caps text-[10px] text-on-surface-variant">${esc(s)}</span>`).join('');
      [h3, card.querySelector('img')].forEach((el) => {
        el.classList.add('rs-clickable');
        el.addEventListener('click', () => { location.href = url(p); });
      });
      $$('button', card).forEach((b) => {
        const ic = icon(b), t = label(b);
        if (ic === 'favorite' || /^bookmark/.test(ic)) { b.dataset.wishId = p.id; b.setAttribute('aria-label', 'Save ' + p.name); b.addEventListener('click', () => toggleWish(p)); }
        else if (ic === 'visibility') { b.setAttribute('aria-label', 'View ' + p.name); b.addEventListener('click', () => { location.href = url(p); }); }
        else if (/quick add/.test(t) || /shopping_(cart|bag)|add_shopping_cart/.test(ic)) {
          if (ic && !t.replace(ic, '').trim()) b.setAttribute('aria-label', 'Add ' + p.name + ' to bag');
          b.addEventListener('click', () => addToCart(p));
        }
        else if (/select size/.test(t)) b.addEventListener('click', () => { location.href = url(p); });
        else if (/notify|waitlist/.test(t)) b.addEventListener('click', () => notifyMe(p));
      });
    });
  }

  // Category chips (home + collections)
  function initFilters() {
    const chips = $$('main button').filter((b) => /^(all new|tailored outerwear|oversized shirts|wide trousers|knitwear)$/.test(label(b)));
    chips.forEach((chip) => chip.addEventListener('click', () => {
      const group = chips.filter((c) => c.parentElement === chip.parentElement);
      group.forEach((c) => { const on = c === chip; c.classList.toggle('bg-primary', on); c.classList.toggle('text-on-primary', on); c.classList.toggle('text-white', on); c.setAttribute('aria-pressed', on); });
      const cat = label(chip);
      const scope = chip.closest('section').parentElement;
      const cards = $$('[data-product-id]', scope);
      let shown = 0;
      cards.forEach((c) => { const hide = cat !== 'all new' && norm(c.dataset.category) !== cat; c.classList.toggle('rs-hidden-card', hide); if (!hide) shown++; });
      let empty = $('.rs-empty', scope);
      if (!shown) {
        if (!empty) { empty = document.createElement('p'); empty.className = 'rs-empty col-span-full py-16 text-center text-on-surface-variant'; cards[0] && cards[0].parentElement.appendChild(empty); }
        empty.textContent = 'New ' + cat + ' pieces arrive soon.';
      } else if (empty) empty.remove();
    }));
    // collections.html?cat=… opens with that category chosen (the homepage category tiles link here)
    const wanted = norm(new URLSearchParams(location.search).get('cat'));
    const start = wanted && chips.find((c) => label(c) === wanted);
    if (start) start.click();
  }

  // Homepage category tiles: each opens the collection filtered to its category
  const TILE_CATS = { 'blazers & tailoring': 'tailored outerwear', jackets: 'tailored outerwear', shirts: 'oversized shirts', pants: 'wide trousers', hoodies: 'knitwear', 'instock collections': '' };
  function initCategoryTiles() {
    $$('.bento-card').forEach((card) => {
      const alt = norm(($('img', card) || {}).alt);
      if (!(alt in TILE_CATS)) return;
      const href = 'collections.html' + (TILE_CATS[alt] ? '?cat=' + encodeURIComponent(TILE_CATS[alt]) : '');
      const name = ($('h3', card) || $('span.font-label-caps', card) || {}).textContent || alt;
      card.setAttribute('role', 'link');
      card.tabIndex = 0;
      card.setAttribute('aria-label', 'Shop ' + name.trim());
      card.addEventListener('click', () => { location.href = href; });
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.href = href; });
    });
  }

  // Remaining buttons on the designed pages, matched by their text or icon
  function initButtons() {
    $$('main button, body > section button').forEach((b) => {
      if (b.closest('[data-product-id]') || b.closest('form')) return;
      const t = label(b), ic = icon(b);
      if (/book a consultation|book appointment/.test(t)) b.addEventListener('click', consultation);
      else if (/contact concierge/.test(t)) b.addEventListener('click', () => { const f = $('main form'); if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => f.querySelector('input').focus(), 500); } else location.href = 'contact.html'; });
      else if (/explore collection/.test(t) || ic === 'north_east') {
        if (ic && !t.replace(ic, '').trim()) b.setAttribute('aria-label', 'Explore the collection');
        b.addEventListener('click', () => { location.href = 'collections.html'; });
      }
      else if (ic === 'directions' || ic === 'fullscreen') { b.setAttribute('aria-label', 'Open in Google Maps'); b.addEventListener('click', () => window.open(CONTACT.maps, '_blank', 'noopener')); }
      else if (ic === 'play_arrow') { b.setAttribute('aria-label', 'Play film'); b.addEventListener('click', () => toast('The atelier film is coming soon', 'info')); }
      else if (/quick add/.test(t)) {
        // About-page hotspots: product name sits in the same callout
        const box = b.parentElement;
        const p = byName((box.querySelector('p') || {}).textContent);
        if (p) {
          b.addEventListener('click', () => addToCart(p));
          const priceEl = $$('p, span', box).find((el) => !el.children.length && /^[\d,]+\s*Ks$/.test(el.textContent.trim()));
          if (priceEl) priceEl.dataset.priceFor = p.id;
        } else if (liveInUse) {
          // Hidden in the dashboard: hide the hotspot's callout rather than offer a dead button
          box.closest('.group, [class*=absolute]')?.classList.add('rs-hidden-card');
        }
      }
    });
  }

  // ---------- FAQ accordion (contact page) ----------
  const FAQ = {
    'how do i know which size to choose?': "Refer to our detailed size guide on each product page. If you're unsure, you can always contact customer service for sizing help.",
    'do your sizes run true to size?': 'Our tailoring follows a relaxed, architectural cut. Most clients take their usual size; size down for a closer fit.',
    "what if the item i ordered doesn't fit?": 'Unworn pieces can be exchanged for another size within 7 days of delivery.',
    'do you offer custom sizing?': 'Yes. Book a private consultation and our atelier will tailor selected pieces to your measurements.',
    'can i get assistance with sizing before purchasing?': 'Message our concierge with your height, weight and usual size and we will recommend the right fit.',
    'what are your shipping rates?': 'Delivery within Yangon is free on orders above 150,000 Ks. Other regions are quoted at checkout.',
    'how long does delivery take?': 'Yangon orders arrive in 1–2 days; other regions in 3–5 working days.',
    'do you ship internationally?': 'International shipping is available on request. Contact our concierge for a quote.',
    'can i track my order?': 'Yes. Once dispatched, you will receive a tracking reference from our concierge.',
    'what if my package is lost?': 'Contact us immediately. Every parcel is insured and we will replace or refund lost orders.',
    'what is your return policy?': 'Unworn items with tags attached can be returned or exchanged within 7 days of delivery.',
    'how do i initiate a return?': 'Email or call our concierge with your order number and we will arrange collection.',
    'are returns free?': 'Exchanges are free. Returns for refund carry a small courier fee.',
    'can i exchange an item?': 'Yes, for a different size or colour, subject to availability.',
    'how long do refunds take?': 'Refunds are processed within 3–5 working days of receiving the item.',
    'where are your clothes made?': 'Our pieces are designed in Yangon and produced with trusted partner workshops.',
    'what materials do you use?': 'We select premium cottons, wool blends, linen and technical fabrics for structure and comfort.',
    'how should i care for my garments?': 'Follow the care label on each piece. Tailored outerwear should be dry cleaned and stored on a shaped hanger.',
    'are your products sustainable?': 'We produce in small batches to limit waste and choose durable fabrics made to be worn for years.',
    'do you offer a warranty?': 'Construction faults are repaired free of charge within 6 months of purchase.',
  };
  function initFaq() {
    $$('main button, body > section button').forEach((b) => {
      const q = norm(b.textContent.replace(/\b(add|remove)\b\s*$/, ''));
      if (!FAQ[q]) return;
      const item = b.parentElement;
      let panel = b.nextElementSibling;
      if (!panel) {
        panel = document.createElement('div');
        panel.className = 'rs-faq-panel pb-4 pr-8';
        panel.innerHTML = '<p class="font-body-md text-on-surface-variant leading-relaxed">' + esc(FAQ[q]) + '</p>';
        panel.hidden = true;
        item.appendChild(panel);
      }
      const ic = b.querySelector('.material-symbols-outlined');
      b.setAttribute('aria-expanded', !panel.hidden);
      b.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        b.setAttribute('aria-expanded', !panel.hidden);
        if (ic) ic.textContent = panel.hidden ? 'add' : 'remove';
      });
    });
  }

  // ---------- Forms ----------
  function initForms() {
    // Designed contact forms only; generated forms (checkout, modals) handle their own submit
    $$('main form:not([data-form]):not([id])').forEach((f) => {
      const fields = $$('input, textarea', f);
      ['name', 'email', 'message'].forEach((n, i) => { if (fields[i] && !fields[i].name) { fields[i].name = n; fields[i].required = true; } });
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!f.checkValidity()) return f.reportValidity();
        const data = Object.fromEntries(new FormData(f));
        if (!await sendEnquiry(f, 'contact', { name: data.name, contact: data.email, message: data.message })) return;
        f.reset();
        toast('Thank you, ' + esc((data.name || '').split(' ')[0] || 'friend') + ' — we reply within 24 hours');
      });
    });
    $$('form[data-form="newsletter"]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!await sendEnquiry(f, 'newsletter', { contact: f.email.value })) return;
      f.reset(); toast("You're on the list");
    }));
  }

  // ---------- Generated pages ----------
  const btnDark = 'w-full bg-primary text-white py-5 rounded-lg font-label-caps text-[11px] tracking-[0.25em] hover:opacity-90 transition-opacity';
  const btnLight = 'w-full border border-black/10 py-5 rounded-lg font-label-caps text-[11px] tracking-[0.25em] hover:border-black transition-colors';

  const miniCard = (p) => `<a href="${url(p)}" class="group block bg-white/60 border border-black/5 rounded-lg p-4 shadow-[0_4px_12px_rgba(0,0,0,0.04)] hover:-translate-y-1 transition-transform">
    <div class="relative aspect-[3/4] overflow-hidden rounded mb-5"><img src="${p.img}" alt="${esc(p.name)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"/>
    ${p.soldOut ? '<span class="absolute top-3 left-3 bg-black text-white px-2 py-1 text-[9px] tracking-widest">SOLD OUT</span>' : ''}</div>
    <p class="text-[10px] tracking-[0.2em] text-on-surface-variant uppercase mb-2">${esc(p.category)}</p>
    <h3 class="font-display-lg text-xl mb-1">${esc(p.name)}</h3><p class="text-sm rs-num">${fmt(p.price)}</p></a>`;

  const emptyState = (iconName, title, text) => `<div class="text-center py-24"><span class="material-symbols-outlined text-5xl text-black/20">${iconName}</span>
    <h1 class="font-display-lg text-3xl mt-4 mb-2">${title}</h1><p class="text-on-surface-variant mb-8">${text}</p>
    <a href="collections.html" class="inline-block bg-primary text-white px-10 py-4 rounded-full font-label-caps text-[11px] tracking-[0.2em]">EXPLORE COLLECTIONS</a></div>`;

  function renderProduct() {
    const root = $('#product-root'); if (!root) return;
    const id = new URLSearchParams(location.search).get('id');
    const p = byId(id);
    if (!p) {
      document.title = 'Piece not found | RESTYLE';
      root.innerHTML = emptyState('search_off', 'We couldn’t find that piece', 'It may have sold out or the link may be wrong. Browse the full collection instead.');
      return;
    }
    document.title = p.name + ' | RESTYLE';
    let size = p.soldOut ? null : (p.sizes.includes('M') ? 'M' : p.sizes[0]);
    let color = p.colors[0].name;
    let qty = 1;
    const related = PRODUCTS.filter((x) => x.id !== p.id).sort((a, b) => (b.category === p.category) - (a.category === p.category)).slice(0, 4);

    root.innerHTML = `
      <nav class="text-[10px] tracking-[0.2em] uppercase text-on-surface-variant mb-10" aria-label="Breadcrumb">
        <a href="index.html" class="hover:text-primary">Home</a><span class="mx-3">/</span><a href="collections.html" class="hover:text-primary">${esc(p.category)}</a><span class="mx-3">/</span><span class="text-primary">${esc(p.name)}</span></nav>
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-start">
        <div class="lg:col-span-7"><div class="aspect-[4/5] overflow-hidden rounded-lg bg-surface-container"><img src="${p.img}" alt="${esc(p.name)}" class="w-full h-full object-cover"/></div></div>
        <div class="lg:col-span-5 lg:sticky lg:top-32">
          <p class="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-on-surface-variant mb-5">
            <span class="w-1.5 h-1.5 rounded-full ${p.soldOut ? 'bg-red-600' : 'bg-emerald-600'}"></span>${p.soldOut ? 'Sold out' : 'Available in stock'}</p>
          <h1 class="font-display-lg text-[40px] md:text-[52px] leading-[1.05] mb-4">${esc(p.name)}</h1>
          <p class="font-display-lg text-2xl mb-4 rs-num">${fmt(p.price)}</p>
          <div class="mb-8 space-y-4">${privilegeTip('Member privileges')}
            ${bundlesFor(p).map((b) => `<div class="rs-bundle"><p class="text-[10px] tracking-[0.2em] uppercase flex items-center gap-2"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">redeem</span>Bundle offer <span class="rs-save">Save ${b.percent}%</span></p>
              <p class="font-display-lg text-xl mt-2">${esc(b.name)}</p>
              <div class="rs-bundle-items">${b.products.map((x) => `<a href="${url(x)}" class="${x.id === p.id ? 'is-in' : ''}"><img src="${x.img}" alt=""/><span class="truncate">${esc(x.name)}</span></a>`).join('')}</div>
              <p class="text-sm rs-num">Buy the set: <s class="text-on-surface-variant">${fmt(b.full)}</s> <strong>${fmt(b.price)}</strong></p>
              <p class="text-xs text-on-surface-variant mt-1">Add every piece to your bag, any colour or size. The saving appears in your bag.</p></div>`).join('')}
          </div>
          <p class="text-[10px] tracking-[0.2em] uppercase text-on-surface-variant mb-3">Colour — <span id="pd-color-name" class="text-primary">${esc(color)}</span></p>
          <div class="flex flex-wrap gap-4 mb-8" id="pd-colors" role="group" aria-label="Colour">${p.colors.map((c, i) => `<button class="rs-swatch" style="background:${c.hex}" data-color="${esc(c.name)}" aria-pressed="${i === 0}" aria-label="${esc(c.name)}" title="${esc(c.name)}"></button>`).join('')}</div>
          <div class="flex justify-between items-center mb-3"><p class="text-[10px] tracking-[0.2em] uppercase text-on-surface-variant">Select size</p>
            <button class="text-[10px] tracking-[0.2em] uppercase underline underline-offset-4 py-2 -my-2 inline-flex items-center gap-1" id="pd-guide"><span class="material-symbols-outlined text-[16px]" aria-hidden="true">straighten</span>Size guide</button></div>
          <div class="grid grid-cols-3 gap-3 mb-8" id="pd-sizes" role="group" aria-label="Size">${p.sizes.map((s) => `<button class="rs-size" data-size="${esc(s)}" aria-pressed="${s === size}" ${p.soldOut ? 'disabled' : ''}>${esc(s)}</button>`).join('')}</div>
          ${p.soldOut ? '' : `<p class="text-[10px] tracking-[0.2em] uppercase text-on-surface-variant mb-3">Quantity</p>
          <div class="rs-stepper inline-flex items-center border border-black/10 rounded-lg mb-8">
            <button id="pd-minus" aria-label="Decrease quantity" disabled>−</button>
            <input id="pd-qty" type="number" min="1" max="10" value="1" class="w-12 text-center border-0 bg-transparent focus:ring-0 p-0" aria-label="Quantity"/>
            <button id="pd-plus" aria-label="Increase quantity">+</button></div>`}
          <div class="space-y-3 mb-10">
            <button class="${btnDark}" id="pd-add">${p.soldOut ? 'NOTIFY ME WHEN BACK' : 'ADD TO BAG'}</button>
            <button class="${btnLight} flex items-center justify-center gap-2" id="pd-wish" data-wish-id="${p.id}" data-wish-label="1"><span class="material-symbols-outlined text-[18px]">favorite</span>ADD TO WISHLIST</button>
          </div>
          <div class="border-t border-black/10">
            ${[['Product philosophy', p.description ? `<p class="whitespace-pre-line">${esc(p.description)}</p>` : `<p class="mb-3">A masterclass in architectural tailoring. The ${esc(p.name)} pairs a sharp, structured silhouette with a considered, high-fidelity textile.</p><p>Designed for the modern minimalist who demands both form and function. Every seam is considered; every stitch is deliberate.</p>`, true],
                ['Atelier care', '<p>Dry clean recommended. Store on a shaped hanger, steam lightly to release creases and avoid direct sunlight to preserve colour.</p>', false]]
              .map(([t, body, open]) => `<details class="border-b border-black/10 group" ${open ? 'open' : ''}><summary class="flex justify-between items-center py-6 cursor-pointer list-none text-[10px] tracking-[0.2em] uppercase">${t}<span class="material-symbols-outlined text-[18px] group-open:rotate-180 transition-transform">expand_more</span></summary>
                <div class="pb-6 text-sm leading-relaxed text-on-surface-variant">${body}</div></details>`).join('')}
          </div>
          <div class="grid grid-cols-2 gap-6 mt-10 p-6 bg-white/60 border border-black/5 rounded-lg">
            ${[['local_shipping', 'Global', 'Priority shipping'], ['verified', 'Bespoke', 'Quality assurance'], ['support_agent', 'Concierge', '24/7 assistance'], ['lock', 'Secure', 'Encrypted checkout']]
              .map(([i, a, b]) => `<div class="flex gap-3 items-start"><span class="material-symbols-outlined text-[20px]" aria-hidden="true">${i}</span><div><p class="text-[10px] tracking-[0.15em] uppercase">${a}</p><p class="text-[10px] tracking-[0.1em] uppercase text-on-surface-variant">${b}</p></div></div>`).join('')}
          </div>
        </div>
      </div>
      <section class="mt-32">
        <div class="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div><p class="text-[10px] tracking-[0.3em] uppercase text-on-surface-variant mb-3">The curation</p><h2 class="font-display-lg text-4xl md:text-5xl tracking-[0.15em] uppercase">Complete the look</h2></div>
          <a href="collections.html" class="self-start md:self-auto bg-primary text-white px-8 py-4 rounded-full font-label-caps text-[11px] tracking-[0.2em]">FIND YOUR STYLE →</a>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">${related.map(miniCard).join('')}</div>
      </section>
      <div class="rs-buybar" id="pd-buybar" aria-hidden="true">
        <img src="${p.img}" alt="" class="w-10 h-12 object-cover rounded"/>
        <div class="flex-1 min-w-0"><p class="text-sm truncate">${esc(p.name)}</p><p class="text-xs text-on-surface-variant rs-num" id="pd-buybar-meta"></p></div>
        <button class="bg-primary text-white px-5 py-3 rounded-lg font-label-caps text-[11px] tracking-[0.2em]" id="pd-buybar-add" tabindex="-1">${p.soldOut ? 'NOTIFY ME' : 'ADD TO BAG'}</button>
      </div>`;

    $$('#pd-colors .rs-swatch').forEach((b) => b.addEventListener('click', () => {
      color = b.dataset.color; $('#pd-color-name').textContent = color; syncBar();
      $$('#pd-colors .rs-swatch').forEach((x) => x.setAttribute('aria-pressed', x === b));
    }));
    $$('#pd-sizes .rs-size').forEach((b) => b.addEventListener('click', () => { size = b.dataset.size; $$('#pd-sizes .rs-size').forEach((x) => x.setAttribute('aria-pressed', x === b)); syncBar(); }));
    const qtyInput = $('#pd-qty');
    if (qtyInput) {
      const setQty = (n) => { qty = Math.max(1, Math.min(10, Number(n) || 1)); qtyInput.value = qty; $('#pd-minus').disabled = qty <= 1; $('#pd-plus').disabled = qty >= 10; syncBar(); };
      $('#pd-minus').addEventListener('click', () => setQty(qty - 1));
      $('#pd-plus').addEventListener('click', () => setQty(qty + 1));
      qtyInput.addEventListener('change', () => setQty(qtyInput.value));
    }
    const add = () => {
      if (!addToCart(p, { size, color, qty })) return;
      const btn = $('#pd-add');
      btn.innerHTML = '<span class="material-symbols-outlined text-[16px] align-[-3px] mr-2" aria-hidden="true">check</span>ADDED TO BAG';
      clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = 'ADD TO BAG'; }, 1800);
    };
    $('#pd-add').addEventListener('click', add);
    $('#pd-buybar-add').addEventListener('click', add);
    // Show the bottom bar on phones once the main button scrolls away
    const bar = $('#pd-buybar');
    if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => bar.classList.toggle('show', !e.isIntersecting && e.boundingClientRect.top < 0)).observe($('#pd-add'));
    $('#pd-wish').addEventListener('click', () => toggleWish(p));
    $('#pd-guide').addEventListener('click', () => modal(`<h3 class="font-display-lg text-3xl mb-6">Size guide</h3>
      <table class="w-full text-sm text-left"><thead class="text-[10px] tracking-[0.2em] uppercase text-on-surface-variant"><tr><th class="py-2">Size</th><th>Chest (cm)</th><th>Waist (cm)</th><th>Height (cm)</th></tr></thead>
      <tbody class="divide-y divide-black/5">${[['S', '92–96', '76–80', '165–172'], ['M', '96–102', '80–86', '170–178'], ['L', '102–108', '86–92', '175–183']].map((r) => '<tr>' + r.map((c) => '<td class="py-3">' + c + '</td>').join('') + '</tr>').join('')}</tbody></table>
      <p class="text-xs text-on-surface-variant mt-6">Between sizes? Our cuts are relaxed, so size down for a closer fit. <a class="underline" href="contact.html">Ask our concierge</a>.</p>`));
    function syncBar() { $('#pd-buybar-meta').textContent = [color, size && 'Size ' + size, qty > 1 && '× ' + qty, fmt(p.price * qty)].filter(Boolean).join(' · '); }
    syncBar();
    syncWishIcons();
  }

  function renderCart() {
    const root = $('#cart-root'); if (!root) return;
    const cart = validLines();
    const dropped = getCart().length - cart.length;
    if (dropped) {
      save('cart', cart); updateBadges();
      setTimeout(() => toast(dropped + (dropped > 1 ? ' pieces are' : ' piece is') + ' no longer available and ' + (dropped > 1 ? 'were' : 'was') + ' removed from your bag', 'info'), 50);
    }
    if (!cart.length) { root.innerHTML = emptyState('shopping_bag', 'Your bag is empty', 'Pieces you add will wait here for you.'); return; }
    const shipping = CONFIG.DELIVERY_FEE || 0;
    const t = promoTotals(priced(cart), null);
    // Bundles that are part-way there: say what's missing
    const inBag = new Set(cart.map((i) => i.id));
    const nearly = PROMOS.bundles.filter((b) => b.active && !t.bundles.some((x) => x.id === b.id) && b.items.some((id) => inBag.has(id)))
      .map((b) => ({ ...b, missing: b.items.filter((id) => !inBag.has(id)).map(byId).filter(Boolean) })).filter((b) => b.missing.length && b.missing.length < b.items.length);
    root.innerHTML = `<h1 class="font-display-lg text-4xl md:text-5xl mb-2">Your Bag</h1>
      <p class="text-on-surface-variant mb-12">${cart.reduce((n, i) => n + i.qty, 0)} piece(s) selected</p>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-12 items-start">
        <ul class="lg:col-span-2 divide-y divide-black/10 border-y border-black/10">
          ${cart.map((i, idx) => { const p = byId(i.id); return `<li class="flex gap-5 py-6">
            <a href="${url(p)}" class="shrink-0"><img src="${p.img}" alt="" class="w-24 h-32 object-cover rounded"/></a>
            <div class="flex-1 min-w-0"><div class="flex justify-between gap-4"><a href="${url(p)}" class="font-display-lg text-xl">${esc(p.name)}</a><span class="whitespace-nowrap rs-num">${fmt(p.price * i.qty)}</span></div>
              <p class="text-[10px] tracking-[0.2em] uppercase text-on-surface-variant mt-1 flex items-center gap-2"><span class="inline-block w-3 h-3 rounded-full border border-black/10" style="background:${hexOf(p, i.color)}"></span>${esc(i.color)} · Size ${esc(i.size)} · ${fmt(p.price)} each</p>
              <div class="flex items-center justify-between mt-5"><div class="rs-stepper flex items-center border border-black/10 rounded-full">
                <button data-qty="${idx}" data-d="-1" aria-label="Decrease quantity of ${esc(p.name)}" ${i.qty <= 1 ? 'disabled' : ''}>−</button><span class="w-6 text-center text-sm rs-num">${i.qty}</span><button data-qty="${idx}" data-d="1" aria-label="Increase quantity of ${esc(p.name)}" ${i.qty >= 10 ? 'disabled' : ''}>+</button></div>
                <button class="inline-flex items-center gap-1 py-3 text-[10px] tracking-[0.2em] uppercase text-on-surface-variant hover:text-red-700 transition-colors" data-remove="${idx}" aria-label="Remove ${esc(p.name)} from bag"><span class="material-symbols-outlined text-[16px]" aria-hidden="true">delete</span>Remove</button></div></div></li>`; }).join('')}
        </ul>
        ${nearly.length ? `<div class="lg:col-span-2 lg:row-start-2 -mt-6 space-y-3">${nearly.map((b) => `<p class="rs-bundle text-sm flex flex-wrap items-center gap-2"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">redeem</span>
          Add ${b.missing.map((x) => `<a class="underline underline-offset-4 font-semibold" href="${url(x)}">${esc(x.name)}</a>`).join(' and ')} to complete <strong>${esc(b.name)}</strong> and save ${b.percent}% on the set.</p>`).join('')}</div>` : ''}
        <aside class="bg-white/60 border border-black/5 rounded-lg p-8 space-y-4 lg:sticky lg:top-28 rs-num lg:row-start-1 lg:col-start-3">
          <h2 class="text-[11px] tracking-[0.2em] uppercase mb-4">Summary</h2>
          <div class="flex justify-between text-sm"><span>Subtotal</span><span>${fmt(t.subtotal)}</span></div>
          ${discountRows(t, 'text-sm')}
          ${shipping ? `<div class="flex justify-between text-sm"><span>Delivery</span><span>${fmt(shipping)}</span></div>` : ''}
          <div class="flex justify-between font-display-lg text-2xl pt-4 border-t border-black/10"><span>Total</span><span>${fmt(t.total)}</span></div>
          ${t.bundleDiscount ? `<p class="text-xs rs-disc text-center">You’re saving ${fmt(t.bundleDiscount)} with bundles.</p>` : ''}
          ${PROMOS.membership && PROMOS.tiers.length ? `<div class="text-xs text-on-surface-variant flex flex-wrap items-center gap-2 justify-center"><span>Members get up to ${tierDeal(PROMOS.tiers[PROMOS.tiers.length - 1])} at checkout.</span>${privilegeTip('Tiers', { align: 'right' })}</div>` : ''}
          <a class="${btnDark} mt-4 flex items-center justify-center gap-2" href="checkout.html"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">lock</span>PROCEED TO CHECKOUT</a>
          <p class="text-[11px] text-on-surface-variant text-center leading-relaxed">Pay by KBZ Pay transfer after placing your order.</p>
          <a href="collections.html" class="block text-center text-[10px] tracking-[0.2em] uppercase underline underline-offset-4 pt-2">Continue shopping</a>
        </aside>
      </div>`;
    const set = (next) => { save('cart', next); updateBadges(); renderCart(); };
    $$('[data-qty]', root).forEach((b) => b.addEventListener('click', () => {
      const c = getCart(); const it = c[b.dataset.qty]; it.qty = Math.max(1, Math.min(10, it.qty + Number(b.dataset.d))); set(c);
      // The bag re-renders; keep keyboard focus on the same control (or its partner once it disables)
      const same = $(`[data-qty="${b.dataset.qty}"][data-d="${b.dataset.d}"]`, root);
      (same && !same.disabled ? same : $(`[data-qty="${b.dataset.qty}"]:not(:disabled)`, root))?.focus();
    }));
    $$('[data-remove]', root).forEach((b) => b.addEventListener('click', () => {
      const c = getCart(); const idx = Number(b.dataset.remove); const [gone] = c.splice(idx, 1); set(c);
      toast('Removed from bag — <button type="button" class="underline underline-offset-4" data-undo>Undo</button>', 'info');
      const u = $('.rs-toast [data-undo]');
      if (u) u.addEventListener('click', () => { const n = getCart(); n.splice(idx, 0, gone); set(n); toast('Restored to bag'); });
    }));
  }

  // ---------- Checkout ----------
  const lineLabel = (i) => `${byId(i.id).name} - ${i.color}, ${i.size}`;
  const paymentNote = () => (CONFIG.PAYMENT.instructions || []).map((l) => `<p>${esc(l)}</p>`).join('');
  const orderCode = () => {
    const d = new Date();
    const ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
    return 'RS' + ymd + rand;
  };

  function renderCheckout() {
    const root = $('#checkout-root'); if (!root) return;
    const cart = validLines();
    if (!cart.length) { root.innerHTML = emptyState('shopping_bag', 'Your bag is empty', 'Add a piece before checking out.'); return; }
    let member = null; // { tier, next } from the Sheet for the phone entered
    let coupon = null; // { code, type, value } once a code is applied
    const totalsNow = () => promoTotals(priced(validLines()), member && member.tier, coupon);
    const total = totalsNow().total;
    const saved = load('billing', {});
    const inputCls = 'w-full border border-black/20 rounded-md px-4 py-3 text-base sm:text-sm bg-white focus:border-black focus:ring-1 focus:ring-black transition-colors';
    const field = (name, labelText, opts = {}) => `<div class="${opts.cls || ''}">
      ${labelText ? `<label for="co-${name}" class="block text-xs font-semibold mb-2">${labelText}${opts.required ? ' <span class="text-red-600">*</span>' : ' <span class="font-normal text-on-surface-variant">(optional)</span>'}</label>` : ''}
      <input id="co-${name}" name="${name}" aria-describedby="co-${name}-msg" type="${opts.type || 'text'}" ${opts.required ? 'required' : ''} ${opts.attrs || ''} placeholder="${opts.placeholder || ''}" value="${esc(saved[name] || opts.value || '')}" class="${inputCls}"/><p id="co-${name}-msg" class="rs-field-msg" hidden></p></div>`;
    const REGIONS = ['Yangon', 'Mandalay', 'Naypyidaw', 'Ayeyarwady', 'Bago', 'Magway', 'Sagaing', 'Tanintharyi', 'Kachin', 'Kayah', 'Kayin', 'Chin', 'Mon', 'Rakhine', 'Shan'];

    root.innerHTML = `<h1 class="font-display-lg text-4xl md:text-5xl mb-10">Checkout</h1>
      ${CONFIG.ORDER_ENDPOINT ? '' : '<p class="mb-8 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-4 py-3">Test mode: orders are not sent anywhere until ORDER_ENDPOINT is set in assets/config.js.</p>'}
      <form id="checkout-form" class="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start" novalidate>
        <div class="lg:col-span-7 space-y-6">
          <h2 class="text-sm font-semibold flex items-center gap-2"><span class="w-6 h-6 rounded-full bg-primary text-white text-[11px] inline-flex items-center justify-center" aria-hidden="true">1</span>Billing details</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
            ${field('firstName', 'First name', { required: true, attrs: 'autocomplete="given-name"' })}
            ${field('lastName', 'Last name', { required: true, attrs: 'autocomplete="family-name"' })}
          </div>
          <div><label for="co-country" class="block text-xs font-semibold mb-2">Country / Region <span class="text-red-600">*</span></label>
            <select id="co-country" name="country" required class="${inputCls}">${['Myanmar', 'Thailand', 'Singapore', 'Malaysia', 'Other'].map((c) => `<option ${c === (saved.country || 'Myanmar') ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div class="space-y-3">
            ${field('street', 'Street address', { required: true, placeholder: 'House number and street name', attrs: 'autocomplete="address-line1"' })}
            ${field('apartment', '', { placeholder: 'Apartment, suite, unit, etc. (optional)', attrs: 'autocomplete="address-line2"' })}
          </div>
          ${field('city', 'Town / City', { required: true, attrs: 'autocomplete="address-level2"' })}
          ${field('state', 'State / County', { required: true, attrs: 'list="co-regions" autocomplete="address-level1"' })}
          <datalist id="co-regions">${REGIONS.map((r) => `<option value="${r}">`).join('')}</datalist>
          ${field('phone', 'Phone', { required: true, type: 'tel', placeholder: '09xxxxxxxxx', attrs: 'autocomplete="tel" pattern="[0-9 \\+\\(\\)\\-]{7,20}"' })}
          ${field('email', 'Email address', { type: 'email', attrs: 'autocomplete="email"' })}
          ${field('extra', esc(CONFIG.EXTRA_FIELD_LABEL || 'Facebook name'))}
          <h2 class="text-sm font-semibold pt-4 flex items-center gap-2"><span class="w-6 h-6 rounded-full bg-primary text-white text-[11px] inline-flex items-center justify-center" aria-hidden="true">2</span>Additional information</h2>
          <div><label for="co-notes" class="block text-xs font-semibold mb-2">Order notes <span class="font-normal text-on-surface-variant">(optional)</span></label>
            <textarea id="co-notes" name="notes" rows="5" maxlength="1000" placeholder="Notes about your order, e.g. special notes for delivery." class="${inputCls}"></textarea></div>
        </div>
        <aside class="lg:col-span-5 lg:sticky lg:top-28 border border-black/10 rounded-md p-6 md:p-8 bg-white/60 rs-num">
          <div class="flex items-center justify-between mb-6"><h2 class="text-sm font-semibold flex items-center gap-2"><span class="w-6 h-6 rounded-full bg-primary text-white text-[11px] inline-flex items-center justify-center" aria-hidden="true">3</span>Your order</h2><a href="cart.html" class="text-xs underline underline-offset-4 py-2">Edit bag</a></div>
          <div class="flex justify-between text-xs font-semibold pb-4 border-b border-black/10"><span>Product</span><span>Subtotal</span></div>
          ${cart.map((i) => `<div class="flex justify-between items-center gap-4 text-sm py-4 border-b border-dashed border-black/10"><span class="flex items-center gap-3 min-w-0"><img src="${byId(i.id).img}" alt="" class="w-10 h-12 object-cover rounded shrink-0"/><span class="text-on-surface-variant">${esc(lineLabel(i))} <strong class="text-primary">× ${i.qty}</strong></span></span><span class="whitespace-nowrap">${fmt(byId(i.id).price * i.qty)}</span></div>`).join('')}
          <div id="co-totals"></div>
          <div id="co-member" class="mt-2" aria-live="polite"></div>
          <div id="co-coupon" class="mt-4"></div>
          <div class="border border-black/10 border-l-2 border-l-amber-700 rounded-md mt-6 bg-white">
            <label class="flex items-center gap-3 px-4 py-4 border-b border-black/10 text-sm cursor-pointer">
              <input type="radio" name="payment" value="${esc(CONFIG.PAYMENT.title)}" checked class="text-amber-700 focus:ring-amber-700"/>${esc(CONFIG.PAYMENT.title)}</label>
            <div class="px-4 py-4 text-xs leading-relaxed text-on-surface-variant space-y-1">${paymentNote()}</div>
          </div>
          <p class="text-xs text-on-surface-variant leading-relaxed my-6">Your personal data will be used to process your order, support your experience throughout this website, and for other purposes described in our <a href="info.html?p=privacy" class="text-amber-700 underline">privacy policy</a>.</p>
          <p id="co-error" class="hidden text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-3 mb-4" role="alert"></p>
          <button type="submit" id="co-submit" class="w-full bg-primary text-white hover:opacity-90 transition-opacity py-4 rounded-md text-sm font-semibold inline-flex items-center justify-center">Place order · ${fmt(total)}</button>
        </aside>
      </form>`;

    const form = $('#checkout-form'), err = $('#co-error'), btn = $('#co-submit');
    let btnLabel = btn.textContent;
    // Totals box: subtotal, bundle and member savings, total — redrawn when the phone (and so the tier) changes
    const drawTotals = () => {
      const t = totalsNow();
      $('#co-totals').innerHTML = `<div class="flex justify-between text-sm py-4 border-b border-dashed border-black/10"><span>Subtotal</span><span>${fmt(t.subtotal)}</span></div>
        ${t.bundles.length || t.memberDiscount || t.couponDiscount ? `<div class="py-3 border-b border-dashed border-black/10 space-y-2">${discountRows(t, 'text-sm')}</div>` : ''}
        ${CONFIG.DELIVERY_FEE ? `<div class="flex justify-between text-sm py-4 border-b border-dashed border-black/10"><span>Delivery</span><span>${fmt(CONFIG.DELIVERY_FEE)}</span></div>` : ''}
        <div class="flex justify-between items-baseline font-semibold py-4"><span class="text-sm">Total</span><span class="font-display-lg text-2xl">${fmt(t.total)}</span></div>`;
      const box = $('#co-member');
      if (!PROMOS.membership || !PROMOS.tiers.length) box.innerHTML = '';
      else if (member && member.tier) box.innerHTML = `<div class="rs-bundle text-sm flex flex-wrap items-center gap-2">${tierBadge(member.tier.name)}<span>Welcome back — <strong>${tierDeal(member.tier)}</strong> applied.</span>${member.next ? `<span class="text-xs text-on-surface-variant w-full">${esc(member.next.name)} unlocks at ${fmt(member.next.threshold)} total spend.</span>` : ''}</div>`;
      else box.innerHTML = `<div class="text-xs text-on-surface-variant flex flex-wrap items-center gap-2">${member ? `<span>Not a member yet. ${esc(PROMOS.tiers[0].name)} unlocks at ${fmt(PROMOS.tiers[0].threshold)} total spend.</span>` : '<span>Members get their discount here after entering their phone number.</span>'}${privilegeTip('Tiers', { align: 'right', up: true })}</div>`;
      btnLabel = 'Place order · ' + fmt(t.total);
      if (!btn.disabled) btn.textContent = btnLabel;
    };
    drawTotals();
    // Look up the tier when a valid phone number is entered (and once for a saved number)
    const phoneInput = $('#co-phone');
    const checkMember = () => {
      if (!phoneInput.checkValidity()) { member = null; drawTotals(); return Promise.resolve(); }
      const asked = phoneInput.value;
      return memberFor(asked).then((m) => { if (phoneInput.value === asked) { member = m; drawTotals(); } });
    };
    phoneInput.addEventListener('change', checkMember);
    if (phoneInput.value) checkMember();
    // Coupon box, shown once the shop has live coupon codes. A code is checked with the Sheet when applied,
    // and again when the order is placed.
    const couponBox = $('#co-coupon');
    const couponDeal = (c) => (c.type === 'amount' ? fmt(c.value) : c.value + '%') + ' off';
    const drawCoupon = (msg, isError) => {
      if (!PROMOS.coupons) { couponBox.innerHTML = ''; return; }
      if (coupon) {
        couponBox.innerHTML = `<div class="rs-bundle text-sm flex items-center justify-between gap-3"><span class="flex items-center gap-2 min-w-0"><span class="material-symbols-outlined text-[18px] rs-disc" aria-hidden="true">confirmation_number</span><span><strong>${esc(coupon.code)}</strong> applied — ${esc(couponDeal(coupon))}</span></span>
          <button type="button" class="text-xs underline underline-offset-4 py-2 shrink-0" id="co-coupon-remove">Remove</button></div>`;
        $('#co-coupon-remove').addEventListener('click', () => { coupon = null; drawCoupon(); drawTotals(); $('#co-coupon-code').focus(); });
        return;
      }
      couponBox.innerHTML = `<label for="co-coupon-code" class="block text-xs font-semibold mb-2">Coupon code <span class="font-normal text-on-surface-variant">(optional)</span></label>
        <div class="flex gap-2"><input id="co-coupon-code" class="${inputCls} uppercase tracking-[0.12em]" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" ${isError ? 'aria-invalid="true"' : ''} aria-describedby="co-coupon-msg"/>
          <button type="button" id="co-coupon-apply" class="px-5 min-h-[44px] rounded-md border border-black/20 bg-white text-sm font-semibold hover:border-black transition-colors shrink-0">Apply</button></div>
        <p id="co-coupon-msg" class="${isError ? 'rs-field-msg' : 'text-xs text-on-surface-variant mt-2'}" role="${isError ? 'alert' : 'status'}" ${msg ? '' : 'hidden'}>${esc(msg || '')}</p>`;
      const inp = $('#co-coupon-code'), go = $('#co-coupon-apply');
      const apply = async () => {
        const code = inp.value.trim().toUpperCase();
        if (!code) { inp.focus(); return; }
        go.disabled = true; go.innerHTML = '<span class="rs-spinner" aria-hidden="true" style="margin:0"></span><span class="sr-only">Checking</span>';
        const t = promoTotals(priced(validLines()), member && member.tier);
        try {
          const r = await postApi({ action: 'coupon', code, spend: t.subtotal - t.bundleDiscount, phone: phoneInput.value });
          coupon = r.coupon; drawCoupon(); drawTotals(); toast(code + ' applied — ' + couponDeal(coupon));
        } catch (ex) {
          drawCoupon(ex.message, true);
          const again = $('#co-coupon-code'); again.value = code; again.focus();
        }
      };
      go.addEventListener('click', apply);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    };
    drawCoupon();
    // Fresh promotions can arrive after the page has drawn (first visit). Redraw the totals, and add the
    // coupon box if it wasn't there yet — never redraw it under someone typing a code.
    checkoutRefresh = () => { if (PROMOS.coupons && !couponBox.innerHTML) drawCoupon(); drawTotals(); };
    let tried = false;
    const message = (el) => {
      const label = (form.querySelector('label[for="' + el.id + '"]')?.firstChild?.textContent || 'This field').trim();
      if (el.validity.valueMissing) return label + ' is required.';
      if (el.name === 'phone') return 'Enter a phone number, e.g. 09xxxxxxxxx.';
      if (el.type === 'email') return 'Enter an email like name@example.com.';
      return el.validationMessage;
    };
    const check = (el) => {
      const msg = $('#' + el.id + '-msg'); if (!msg) return;
      const ok = el.checkValidity();
      el.classList.toggle('rs-input-error', !ok); el.setAttribute('aria-invalid', String(!ok));
      msg.hidden = ok; msg.textContent = ok ? '' : message(el);
    };
    // Checks every field; on submit, moves focus to the first problem
    function showErrors(focus) {
      tried = true;
      const fields = $$('input[aria-describedby]', form); fields.forEach(check);
      const bad = fields.find((el) => !el.checkValidity());
      if (bad && focus) { bad.focus({ preventScroll: true }); bad.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      return !bad;
    }
    $$('input[aria-describedby]', form).forEach((el) => {
      el.addEventListener('blur', () => { if (el.value || tried) check(el); });
      el.addEventListener('input', () => { if (el.classList.contains('rs-input-error')) check(el); });
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.classList.add('hidden');
      if (!showErrors(true)) return;
      const lines = validLines();
      if (!lines.length) { location.href = 'cart.html'; return; }
      const data = Object.fromEntries(new FormData(form));
      Object.keys(data).forEach((k) => { data[k] = String(data[k]).trim(); });
      const order = {
        ...data,
        // Reuse the code on retry, so an order that did reach the sheet shows up as a duplicate, not a new order
        code: (form.dataset.code ||= orderCode()),
        items: lines.map((i) => { const p = byId(i.id); return { id: p.id, name: p.name, color: i.color, size: i.size, qty: i.qty, price: p.price }; }),
        createdAt: new Date().toISOString(),
      };
      // Make sure the tier for this exact phone number is known before working out the total
      await checkMember();
      const t = totalsNow();
      Object.assign(order, { total: t.total, subtotal: t.subtotal, bundles: t.bundles, memberDiscount: t.memberDiscount, tier: t.tierName, coupon: coupon ? coupon.code : '', couponDiscount: t.couponDiscount });
      btn.disabled = true; btn.innerHTML = '<span class="rs-spinner" aria-hidden="true"></span>Placing order…';
      try {
        if (CONFIG.ORDER_ENDPOINT) {
          // text/plain avoids a CORS preflight, which Apps Script can't answer
          const res = await fetch(CONFIG.ORDER_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(order), signal: AbortSignal.timeout(20000) });
          const out = await res.json();
          if (!out.ok) throw new Error(out.error || 'Order was not accepted');
          // The Sheet's figures are the ones the customer pays
          Object.assign(order, { total: out.total ?? order.total, memberDiscount: out.memberDiscount ?? order.memberDiscount, tier: out.tier ?? order.tier, couponDiscount: out.couponDiscount ?? order.couponDiscount });
        } else {
          order.test = true;
        }
        const { notes, ...billing } = data;
        save('billing', billing);
        save('orders', [order, ...load('orders', [])].slice(0, 20));
        save('cart', []);
        location.href = 'order-received.html?code=' + encodeURIComponent(order.code);
      } catch (ex) {
        const why = ex.name === 'TimeoutError' ? 'The connection took too long.'
          : ex instanceof TypeError ? 'Please check your internet connection.'
          : ex instanceof SyntaxError ? 'Our order system did not respond properly.'
          : ex.message + '.';
        // The coupon stopped working (expired, used up, below minimum): drop it and show the new total
        if (/^Coupon /.test(ex.message)) {
          coupon = null; drawCoupon(ex.message.replace(/^Coupon \S+: /, '').replace(/^./, (c) => c.toUpperCase()), true); drawTotals();
          err.textContent = ex.message + '. We removed it — check the new total and press Place order again.';
        // The shop changed under the buyer (price, stock): fetch the new catalogue and send them to the bag
        } else if (/sold out|no longer available|not available|Prices have changed/.test(ex.message)) {
          // Prices, stock, bundles or a tier changed: refresh them and forget cached tiers
          refreshLive(() => drawTotals(), true);
          Object.keys(memberCache).forEach((k) => delete memberCache[k]);
          err.innerHTML = esc(ex.message) + '. <a href="cart.html" class="underline font-semibold">Review your bag</a>';
        } else {
          err.textContent = "We couldn't place your order. " + why + ' Your bag is saved — please try again, or call ' + CONTACT.phone + ' with order code ' + order.code + '.';
        }
        err.classList.remove('hidden');
        btn.disabled = false; btn.textContent = btnLabel;
      }
    });
  }

  function renderOrder() {
    const root = $('#order-root'); if (!root) return;
    const code = new URLSearchParams(location.search).get('code');
    const o = load('orders', []).find((x) => x.code === code);
    if (!o) { root.innerHTML = emptyState('receipt_long', 'Order not found', 'This order isn\'t saved on this device.'); return; }
    const note = (CONFIG.PAYMENT.notePrefix ? CONFIG.PAYMENT.notePrefix + ' ' : '') + o.code;
    root.innerHTML = `<div class="text-center mb-12">
        <span class="material-symbols-outlined text-5xl text-emerald-700">check_circle</span>
        <h1 class="font-display-lg text-4xl md:text-5xl mt-4 mb-3">Thank you, ${esc(o.firstName)}</h1>
        <p class="text-on-surface-variant">Your order has been received. ${o.test ? '<strong class="text-amber-800">(Test mode — not sent)</strong>' : ''}</p></div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center border-y border-black/10 py-6 mb-10">
        ${[['Order code', o.code], ['Date', new Date(o.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })], ['Total', fmt(o.total)], ['Payment', CONFIG.PAYMENT.title]].map(([k, v]) => `<div><p class="text-[10px] tracking-[0.2em] uppercase text-on-surface-variant mb-1">${k}</p><p class="text-sm font-semibold break-all">${esc(v)}</p></div>`).join('')}
      </div>
      <div class="bg-amber-50 border border-amber-200 rounded-lg p-6 mb-10">
        <h2 class="text-sm font-semibold mb-3">Complete your payment</h2>
        <div class="text-sm leading-relaxed space-y-1 mb-5">${paymentNote()}</div>
        <div class="grid sm:grid-cols-2 gap-3">
          ${[['KBZ Pay number', CONFIG.PAYMENT.kbzNumber], ['Transfer note', note]].map(([k, v]) => `<div class="bg-white rounded-md border border-amber-200 px-4 py-3 flex items-center justify-between gap-3">
            <div><p class="text-[10px] tracking-[0.15em] uppercase text-on-surface-variant">${k}</p><p class="font-semibold">${esc(v)}</p></div>
            <button class="text-xs underline" data-copy="${esc(v)}">Copy</button></div>`).join('')}
        </div>
        <p class="text-xs text-on-surface-variant mt-4">Amount: <strong>${fmt(o.total)}</strong> · Account name: ${esc(CONFIG.PAYMENT.kbzName)}</p>
      </div>
      <h2 class="text-sm font-semibold mb-4">Order details</h2>
      <div class="border border-black/10 rounded-md divide-y divide-black/10 mb-10 text-sm">
        ${o.items.map((i) => `<div class="flex justify-between gap-4 px-5 py-4"><span>${esc(i.name)} - ${esc(i.color)}, ${esc(i.size)} <strong>× ${i.qty}</strong></span><span class="whitespace-nowrap">${fmt(i.price * i.qty)}</span></div>`).join('')}
        ${(o.bundles && o.bundles.length) || o.memberDiscount || o.couponDiscount ? `<div class="px-5 py-4 space-y-2"><div class="flex justify-between"><span>Subtotal</span><span>${fmt(o.subtotal)}</span></div>
          ${(o.bundles || []).map((b) => `<div class="flex justify-between rs-disc"><span>Bundle: ${esc(b.name)}${b.sets > 1 ? ' × ' + b.sets : ''}</span><span>−${fmt(b.discount)}</span></div>`).join('')}
          ${o.memberDiscount ? `<div class="flex justify-between rs-disc"><span>${esc(o.tier)} member</span><span>−${fmt(o.memberDiscount)}</span></div>` : ''}
          ${o.couponDiscount ? `<div class="flex justify-between rs-disc"><span>Coupon ${esc(o.coupon)}</span><span>−${fmt(o.couponDiscount)}</span></div>` : ''}</div>` : ''}
        <div class="flex justify-between px-5 py-4 font-semibold"><span>Total</span><span>${fmt(o.total)}</span></div>
      </div>
      <div class="grid sm:grid-cols-2 gap-6 text-sm mb-12">
        <div><h3 class="text-xs font-semibold mb-2">Delivery address</h3><p class="text-on-surface-variant leading-relaxed">${esc(o.firstName + ' ' + o.lastName)}<br>${esc(o.street)}${o.apartment ? '<br>' + esc(o.apartment) : ''}<br>${esc(o.city)}, ${esc(o.state)}<br>${esc(o.country)}<br>${esc(o.phone)}</p></div>
        ${o.notes ? `<div><h3 class="text-xs font-semibold mb-2">Order notes</h3><p class="text-on-surface-variant leading-relaxed whitespace-pre-line">${esc(o.notes)}</p></div>` : ''}
      </div>
      <div class="flex flex-wrap justify-center gap-3"><a href="collections.html" class="inline-block bg-primary text-white px-10 py-4 rounded-full text-[11px] tracking-[0.2em]">CONTINUE SHOPPING</a>
        <a href="account.html?code=${encodeURIComponent(o.code)}" class="inline-block border border-black/15 px-10 py-4 rounded-full text-[11px] tracking-[0.2em] hover:border-black transition-colors">TRACK THIS ORDER</a></div>`;
    $$('[data-copy]', root).forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied'); } catch (e) { toast('Copy failed — select the text instead', 'error'); }
    }));
  }

  function renderWishlist() {
    const root = $('#wishlist-root'); if (!root) return;
    const items = getWish().map(byId).filter(Boolean);
    if (!items.length) { root.innerHTML = emptyState('favorite', 'Your wishlist is empty', 'Tap the heart on any piece to save it here.'); return; }
    root.innerHTML = `<h1 class="font-display-lg text-4xl md:text-5xl mb-12">Wishlist</h1>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">${items.map((p) => `<div>${miniCard(p)}
        <div class="flex gap-2 mt-3"><button class="flex-1 bg-primary text-white py-3 rounded-full text-[10px] tracking-[0.2em]" data-add="${p.id}">${p.soldOut ? 'NOTIFY ME' : 'ADD TO BAG'}</button>
        <button class="px-4 border border-black/10 rounded-full" data-unwish="${p.id}" aria-label="Remove"><span class="material-symbols-outlined text-[18px]">close</span></button></div></div>`).join('')}</div>`;
    $$('[data-add]', root).forEach((b) => b.addEventListener('click', () => addToCart(byId(b.dataset.add))));
    $$('[data-unwish]', root).forEach((b) => b.addEventListener('click', () => { toggleWish(byId(b.dataset.unwish)); renderWishlist(); }));
  }

  const INFO = {
    tracking: ['Order tracking', 'Once your order is dispatched, our concierge sends you a tracking reference by phone or email. For an update on any order, contact us with your name and order date.'],
    orders: ['Orders', 'Orders are currently confirmed directly with our concierge. Your bag and wishlist are saved on this device so you can return to them at any time.'],
    privacy: ['Privacy policy', 'We only use the details you share with us — such as your name, email and phone number — to answer enquiries, confirm orders and send updates you have asked for. We never sell your information. Your bag and wishlist are stored only in your own browser. Contact us at any time to have your details removed.'],
  };
  function renderMembership(root) {
    document.title = 'Membership | RESTYLE';
    const on = PROMOS.membership && PROMOS.tiers.length;
    const bundles = PROMOS.bundles.filter((b) => b.active);
    root.innerHTML = `<p class="text-[10px] tracking-[0.3em] uppercase text-on-surface-variant mb-4">RESTYLE atelier</p><h1 class="font-display-lg text-4xl md:text-5xl mb-6">Membership &amp; offers</h1>
      ${on ? `<p class="text-lg leading-relaxed text-on-surface-variant mb-10">The more you shop with us, the more you save. Your total spend on paid orders unlocks a tier, and its discount applies to every order after that.</p>
        <div class="grid sm:grid-cols-3 gap-4 mb-10">${PROMOS.tiers.map((t) => `<div class="rs-bundle"><p class="mb-4">${tierBadge(t.name)}</p><p class="font-display-lg text-3xl rs-num">${tierDeal(t)}</p><p class="text-xs text-on-surface-variant mt-2 rs-num">every order, once you’ve spent ${fmt(t.threshold)}</p></div>`).join('')}</div>
        <h2 class="text-sm font-semibold mb-3">How it works</h2>
        <ul class="list-disc pl-5 space-y-2 text-on-surface-variant mb-12"><li>We recognise you by the phone number you use at checkout — no account needed.</li><li>Orders count once they’re paid. Your tier and discount show at checkout as soon as you enter your phone number.</li><li>Member discounts are added on top of bundle savings.</li></ul>`
        : '<p class="text-lg leading-relaxed text-on-surface-variant mb-12">Our membership programme is coming soon.</p>'}
      ${bundles.length ? `<h2 class="text-sm font-semibold mb-4">Bundle offers</h2><div class="grid gap-4 mb-12">${bundles.map((b) => { const items = b.items.map(byId).filter(Boolean); return `<div class="rs-bundle"><p class="font-display-lg text-xl">${esc(b.name)} <span class="rs-save">Save ${b.percent}%</span></p><div class="rs-bundle-items">${items.map((x) => `<a href="${url(x)}"><img src="${x.img}" alt=""/><span class="truncate">${esc(x.name)}</span></a>`).join('')}</div></div>`; }).join('')}</div>` : ''}
      <div class="flex flex-wrap gap-3"><a href="collections.html" class="bg-primary text-white px-8 py-4 rounded-full text-[11px] tracking-[0.2em]">SHOP THE COLLECTION</a><a href="account.html" class="border border-black/10 px-8 py-4 rounded-full text-[11px] tracking-[0.2em]">TRACK AN ORDER</a></div>`;
  }

  function renderInfo() {
    const root = $('#info-root'); if (!root) return;
    const key = new URLSearchParams(location.search).get('p');
    if (key === 'membership') return renderMembership(root);
    const [title, text] = INFO[key] || INFO.privacy;
    document.title = title + ' | RESTYLE';
    const orders = load('orders', []);
    if ((key === 'orders' || key === 'tracking') && orders.length) {
      root.innerHTML = `<h1 class="font-display-lg text-4xl md:text-5xl mb-3">${title}</h1>
        <p class="text-on-surface-variant mb-10">Orders placed on this device. For a delivery update, contact our concierge with your order code.</p>
        <div class="border border-black/10 rounded-md divide-y divide-black/10">${orders.map((o) => `<a href="order-received.html?code=${encodeURIComponent(o.code)}" class="flex flex-wrap justify-between gap-3 px-5 py-4 hover:bg-white/60">
          <span><strong class="block">${esc(o.code)}</strong><span class="text-xs text-on-surface-variant">${new Date(o.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${o.items.reduce((n, i) => n + i.qty, 0)} piece(s)${o.test ? ' · test' : ''}</span></span>
          <span class="self-center">${fmt(o.total)}</span></a>`).join('')}</div>`;
      return;
    }
    root.innerHTML = `<p class="text-[10px] tracking-[0.3em] uppercase text-on-surface-variant mb-4">RESTYLE atelier</p><h1 class="font-display-lg text-4xl md:text-5xl mb-8">${title}</h1>
      <p class="text-lg leading-relaxed text-on-surface-variant mb-12">${text}</p>
      <div class="flex flex-wrap gap-3"><a href="mailto:${CONTACT.email}" class="bg-primary text-white px-8 py-4 rounded-full text-[11px] tracking-[0.2em]">EMAIL CONCIERGE</a>
      <a href="tel:${CONTACT.phone}" class="border border-black/10 px-8 py-4 rounded-full text-[11px] tracking-[0.2em]">CALL ${CONTACT.phone}</a></div>`;
  }

  // ---------- Sign-in panel: customers track an order, staff sign in to the dashboard ----------
  async function postApi(body) {
    if (!CONFIG.ORDER_ENDPOINT) throw new Error('The shop backend is not connected yet');
    let out;
    try {
      const res = await fetch(CONFIG.ORDER_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      out = await res.json();
    } catch (e) {
      throw new Error(e.name === 'TimeoutError' ? 'The connection took too long. Please try again.' : 'Please check your internet connection and try again.');
    }
    if (!out.ok) throw new Error(out.error || 'Something went wrong');
    return out;
  }

  const TRACK_STEPS = ['Awaiting payment', 'Paid', 'Packed', 'Shipped', 'Delivered'];
  const trackResult = (o) => {
    const at = TRACK_STEPS.indexOf(o.status);
    const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
    return `<div class="mt-8 border border-black/10 rounded-lg p-6 bg-white/60 rs-num">
      <div class="flex justify-between items-start gap-4 mb-6"><div><p class="rs-label mb-1">Order</p><p class="font-semibold">${esc(o.code)}</p><p class="text-xs text-on-surface-variant">${date(o.date)}</p></div>
        <span class="rs-pill" data-status="${esc(o.status)}">${esc(o.status)}</span></div>
      ${o.status === 'Cancelled' ? '<p class="text-sm text-red-700 mb-6">This order was cancelled. Contact us if you have questions.</p>' : `<ol class="rs-steps mb-6" aria-label="Order progress">${TRACK_STEPS.map((s, i) => `<li class="${i <= at ? 'done' : ''}${i === at ? ' now' : ''}"${i === at ? ' aria-current="step"' : ''}><span></span>${s}</li>`).join('')}</ol>`}
      ${o.status === 'Awaiting payment' ? `<p class="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-4 py-3 mb-6">We're waiting for your KBZ Pay transfer of <strong>${fmt(o.total)}</strong> to ${esc(CONFIG.PAYMENT.kbzNumber)} with the note <strong>${esc(CONFIG.PAYMENT.notePrefix)} ${esc(o.code)}</strong>.</p>` : ''}
      ${o.courier || o.tracking || o.deliveryDate ? `<div class="grid grid-cols-2 gap-4 text-sm mb-6">
        ${o.courier ? `<div><p class="rs-label mb-1">Courier</p><p>${esc(o.courier)}</p></div>` : ''}
        ${o.tracking ? `<div><p class="rs-label mb-1">Tracking no.</p><p class="break-all">${esc(o.tracking)}</p></div>` : ''}
        ${o.deliveryDate ? `<div><p class="rs-label mb-1">Expected delivery</p><p>${esc(date(o.deliveryDate))}</p></div>` : ''}</div>` : ''}
      <ul class="text-sm divide-y divide-dashed divide-black/10 border-t border-black/10">${(o.items || []).map((i) => `<li class="flex justify-between gap-4 py-3"><span>${esc(i.name)}${i.qty ? `${i.color ? ` - ${esc(i.color)}, ${esc(i.size)}` : ''} <strong>× ${i.qty}</strong>` : ''}</span>${i.qty ? `<span class="whitespace-nowrap">${fmt(i.price * i.qty)}</span>` : ''}</li>`).join('')}</ul>
      ${o.bundleDiscount || o.memberDiscount || o.couponDiscount ? `<div class="text-sm pt-3 border-t border-black/10 space-y-1"><div class="flex justify-between"><span>Subtotal</span><span>${fmt(o.subtotal)}</span></div>
        ${o.bundleDiscount ? `<div class="flex justify-between rs-disc"><span>Bundle savings</span><span>−${fmt(o.bundleDiscount)}</span></div>` : ''}
        ${o.memberDiscount ? `<div class="flex justify-between rs-disc"><span>${esc(o.memberTier)} member</span><span>−${fmt(o.memberDiscount)}</span></div>` : ''}
        ${o.couponDiscount ? `<div class="flex justify-between rs-disc"><span>Coupon ${esc(o.coupon)}</span><span>−${fmt(o.couponDiscount)}</span></div>` : ''}</div>` : ''}
      <div class="flex justify-between font-semibold pt-4 border-t border-black/10"><span>Total</span><span>${fmt(o.total)}</span></div></div>`;
  };

  function renderAccount() {
    const root = $('#account-root'); if (!root) return;
    const params = new URLSearchParams(location.search);
    const staff = (() => { try { return JSON.parse(sessionStorage.getItem('restyle.admin') || 'null'); } catch (e) { return null; } })();
    const field = (id, label, attrs = '') => `<div><label class="rs-label mb-2" for="${id}">${label}</label><input id="${id}" class="w-full border border-black/20 rounded-md px-4 py-3 text-base sm:text-sm bg-white focus:border-black focus:ring-1 focus:ring-black" ${attrs}/></div>`;

    root.innerHTML = `<div class="py-6">
      <h1 class="font-display-lg text-4xl md:text-5xl text-center mb-3">Sign in</h1>
      <p class="text-center text-on-surface-variant mb-10">Track an order, or sign in to the RESTYLE dashboard.</p>
      <div class="rs-switch" role="tablist" aria-label="Sign-in type">
        <button role="tab" id="tab-customer" aria-controls="panel-customer" aria-selected="true">Customer</button>
        <button role="tab" id="tab-admin" aria-controls="panel-admin" aria-selected="false" tabindex="-1">Admin</button>
        <span class="rs-switch-thumb" aria-hidden="true"></span>
      </div>

      <section id="panel-customer" role="tabpanel" aria-labelledby="tab-customer" class="mt-8">
        <form id="track-form" class="space-y-5" novalidate>
          <p class="text-sm text-on-surface-variant">Enter the order code from your confirmation (e.g. RS261028ABC) and the phone number you used at checkout.</p>
          ${field('tr-code', 'Order code', `name="code" required autocomplete="off" autocapitalize="characters" value="${esc(params.get('code') || '')}"`)}
          ${field('tr-phone', 'Phone', 'name="phone" type="tel" required autocomplete="tel" placeholder="09xxxxxxxxx"')}
          <p id="tr-error" class="hidden text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-3" role="alert"></p>
          <button class="${btnDark}" type="submit">TRACK ORDER</button>
        </form>
        <div id="track-result" aria-live="polite"></div>
        <p class="text-xs text-on-surface-variant text-center mt-8">Your bag and wishlist are saved on this device. <a class="underline" href="cart.html">View bag</a> · <a class="underline" href="wishlist.html">Wishlist</a></p>
      </section>

      <section id="panel-admin" role="tabpanel" aria-labelledby="tab-admin" class="mt-8" hidden>
        ${staff ? `<div class="text-center border border-black/10 rounded-lg p-8 bg-white/60"><p class="mb-6">Signed in as <strong>${esc(staff.user.name)}</strong></p><a class="${btnDark} block" href="admin.html">OPEN DASHBOARD</a></div>` : `
        <form id="admin-form" class="space-y-5" novalidate>
          ${field('ad-user', 'Username', 'name="username" required autocomplete="username" autocapitalize="none" spellcheck="false"')}
          <div><label class="rs-label mb-2" for="ad-pass">Password</label>
            <div class="relative"><input id="ad-pass" name="password" type="password" required autocomplete="current-password" class="w-full border border-black/20 rounded-md pl-4 pr-12 py-3 text-base sm:text-sm bg-white focus:border-black focus:ring-1 focus:ring-black"/>
            <button type="button" id="ad-show" class="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 inline-flex items-center justify-center rounded" aria-label="Show password" aria-pressed="false"><span class="material-symbols-outlined text-[20px]" aria-hidden="true">visibility</span></button></div></div>
          <p id="ad-error" class="hidden text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-3" role="alert"></p>
          <button class="${btnDark}" type="submit">SIGN IN</button>
          <p class="text-xs text-on-surface-variant text-center">Staff only. Forgot your password? Ask the shop owner to reset it.</p>
        </form>
        <div id="setup-box" hidden class="mt-10 border-t border-black/10 pt-8">
          <h2 class="font-display-lg text-2xl mb-2">First-time setup</h2>
          <p class="text-sm text-on-surface-variant mb-6">No staff accounts exist yet. Create the owner account with the setup key from your Apps Script.</p>
          <form id="setup-form" class="space-y-5" novalidate>
            ${field('su-key', 'Setup key', 'name="key" required autocomplete="off" autocapitalize="characters" placeholder="RS-XXXX-XXXX"')}
            ${field('su-name', 'Your name', 'name="name" required autocomplete="name"')}
            ${field('su-user', 'Choose a username', 'name="username" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="e.g. aye"')}
            ${field('su-pass', 'Choose a password', 'name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"')}
            <p id="su-error" class="hidden text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-3" role="alert"></p>
            <button class="${btnLight}" type="submit">CREATE OWNER ACCOUNT</button>
          </form>
        </div>`}
      </section></div>`;

    // Switch between the two panels (arrow keys move between tabs)
    const tabs = $$('[role=tab]', root);
    let setupChecked = false;
    const select = (tab, focus) => {
      tabs.forEach((t) => { const on = t === tab; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; $('#' + t.getAttribute('aria-controls')).hidden = !on; });
      root.querySelector('.rs-switch').dataset.side = tab.id === 'tab-admin' ? 'right' : 'left';
      if (focus) tab.focus();
      history.replaceState(null, '', tab.id === 'tab-admin' ? '#admin' : location.pathname + location.search);
      if (tab.id === 'tab-admin' && !staff && !setupChecked) {
        setupChecked = true;
        postApi({ action: 'setupNeeded' }).then((r) => { if (r.needed) $('#setup-box').hidden = false; }).catch(() => {});
      }
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); select(tabs[(i + 1) % 2], true); } });
    });
    if (location.hash === '#admin') select(tabs[1]);

    // Shared submit handling: validates, shows the error under the form, spins the button
    const handle = (form, errEl, work) => form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $(errEl), btn = $('button[type=submit]', form), label = btn.innerHTML;
      err.classList.add('hidden');
      const bad = $$('input', form).find((i) => !i.checkValidity());
      if (bad) {
        const name = ($('label[for="' + bad.id + '"]', root) || {}).textContent || 'This field';
        err.textContent = bad.validity.tooShort ? name + ' must be at least ' + bad.minLength + ' characters.' : name + ' is required.';
        err.classList.remove('hidden'); bad.focus(); return;
      }
      btn.disabled = true; btn.innerHTML = '<span class="rs-spinner" aria-hidden="true"></span>Please wait…';
      try { await work(Object.fromEntries(new FormData(form))); } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
      btn.disabled = false; btn.innerHTML = label;
    });

    handle($('#track-form'), '#tr-error', async (d) => {
      const r = await postApi({ action: 'track', code: d.code.trim(), phone: d.phone });
      $('#track-result').innerHTML = trackResult(r.order);
      $('#track-result').firstElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    // Prefill the phone from the last checkout on this device
    const billing = load('billing', {});
    if (billing.phone) $('#tr-phone').value = billing.phone;

    if (staff) return;
    // The dashboard sends people here when their session ends; say so, and take them back afterwards
    const why = sessionStorage.getItem('restyle.adminMsg');
    if (why) {
      sessionStorage.removeItem('restyle.adminMsg');
      const note = document.createElement('p');
      note.className = 'text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-4 py-3';
      note.setAttribute('role', 'status');
      note.textContent = why;
      $('#admin-form').prepend(note);
    }
    const signedIn = (r) => {
      sessionStorage.setItem('restyle.admin', JSON.stringify({ token: r.token, user: r.user }));
      const back = sessionStorage.getItem('restyle.adminReturn') || '';
      sessionStorage.removeItem('restyle.adminReturn');
      location.href = 'admin.html' + (/^#[a-z]+$/.test(back) ? back : '');
    };
    handle($('#admin-form'), '#ad-error', async (d) => signedIn(await postApi({ action: 'login', username: d.username.trim(), password: d.password })));
    handle($('#setup-form'), '#su-error', async (d) => signedIn(await postApi({ action: 'setup', key: d.key.trim().toUpperCase(), name: d.name.trim(), username: d.username.trim().toLowerCase(), password: d.password })));
    $('#ad-show').addEventListener('click', (e) => {
      const b = e.currentTarget, input = $('#ad-pass'), show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.setAttribute('aria-pressed', show); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      $('span', b).textContent = show ? 'visibility_off' : 'visibility';
    });
  }

  // ---------- Boot ----------
  initHeader();
  fillCatalog();
  initCards();
  initFilters();
  initCategoryTiles();
  initButtons();
  initFaq();
  initForms();
  if (page === 'product') renderProduct();
  if (page === 'cart') renderCart();
  if (page === 'wishlist') renderWishlist();
  if (page === 'info') renderInfo();
  if (page === 'checkout') renderCheckout();
  if (page === 'order') renderOrder();
  if (page === 'account') renderAccount();
  // Footer: a Membership link once there's something to show
  const membershipLink = () => {
    const list = $('footer a[href="cart.html"]')?.closest('ul');
    if (!list || $('a[href="info.html?p=membership"]', list) || !(PROMOS.membership || PROMOS.bundles.some((b) => b.active))) return;
    const li = document.createElement('li');
    li.innerHTML = '<a class="font-body-md text-neutral-400 hover:text-white transition-colors" href="info.html?p=membership">Membership</a>';
    list.appendChild(li);
  };
  membershipLink();
  syncCardPrices();
  updateBadges();
  syncWishIcons();
  window.addEventListener('storage', updateBadges);
  // Pick up dashboard changes (prices, stock, new pieces). The checkout form is left alone
  // so typing isn't lost — only its totals and coupon box update; the server re-checks prices at order time.
  refreshLive(() => {
    fillCatalog(); initCards(); syncCardPrices(); updateBadges(); syncWishIcons(); membershipLink();
    if (page === 'info') renderInfo();
    if (page === 'product') renderProduct();
    if (page === 'cart') renderCart();
    if (page === 'wishlist') renderWishlist();
    if (page === 'checkout' && checkoutRefresh) checkoutRefresh();
  });
})();
