// Egna listrutor i appens tema. Varje <select> i appen får automatiskt en knapp och en
// meny som ersätter webbläsarens standardmeny. Den riktiga <select> finns kvar (dold),
// så formulär, värden och change-händelser fungerar precis som förut.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CHEVRON = '<svg class="csel-chev" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 12l5 5 9-10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const proto = HTMLSelectElement.prototype;
  const desc = { value: Object.getOwnPropertyDescriptor(proto, 'value'), selectedIndex: Object.getOwnPropertyDescriptor(proto, 'selectedIndex') };
  let open = null; // { select, pop, items, active }
  let uidN = 0;

  function labelFor(select) {
    if (select.getAttribute('aria-label')) return select.getAttribute('aria-label');
    const field = select.closest('label');
    const text = field && field.querySelector('.field-label, .sr-only');
    return text ? text.textContent.trim() : '';
  }

  function refresh(select) {
    const c = select._csel;
    if (!c) return;
    const opt = select.options[desc.selectedIndex.get.call(select)];
    c.btn.innerHTML = `<span class="csel-text">${esc(opt ? opt.textContent : '')}</span>${CHEVRON}`;
    c.btn.disabled = select.disabled;
    if (open && open.select === select) build();
  }

  function enhance(select) {
    if (select._csel || select.multiple || select.size > 1) return;
    const wrap = document.createElement('span');
    wrap.className = 'csel' + (select.closest('.select-pill') ? ' csel-pill' : '');
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'csel-btn';
    btn.id = `csel-${++uidN}`;
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    const label = labelFor(select);
    if (label) btn.setAttribute('aria-label', label);
    wrap.appendChild(btn);
    select.classList.add('csel-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select._csel = { wrap, btn };

    // Kod som sätter select.value direkt ska också uppdatera knappen
    for (const k of ['value', 'selectedIndex']) {
      Object.defineProperty(select, k, {
        configurable: true,
        get() { return desc[k].get.call(this); },
        set(v) { desc[k].set.call(this, v); refresh(this); },
      });
    }
    new MutationObserver(() => refresh(select)).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected'] });
    select.addEventListener('change', () => refresh(select));
    select.addEventListener('focus', () => btn.focus());

    btn.addEventListener('click', () => (open && open.select === select ? close() : show(select)));
    btn.addEventListener('keydown', e => onKey(e, select));
    refresh(select);
  }

  // ---------- Menyn ----------
  function build() {
    const { select, pop } = open;
    const items = [];
    const current = desc.value.get.call(select);
    let html = '';
    const optHTML = o => {
      const i = items.length;
      items.push(o);
      const sel = o.value === current && o.selected;
      return `<div class="csel-opt ${sel ? 'is-selected' : ''} ${o.disabled ? 'is-disabled' : ''}" role="option" id="${pop.id}-${i}" data-i="${i}" aria-selected="${sel}">
        <span>${esc(o.textContent)}</span>${sel ? CHECK : ''}</div>`;
    };
    for (const node of select.children) {
      if (node.tagName === 'OPTGROUP') {
        html += `<div class="csel-group" role="presentation">${esc(node.label)}</div>${[...node.children].map(optHTML).join('')}`;
      } else if (node.tagName === 'OPTION') html += optHTML(node);
    }
    pop.innerHTML = html || '<div class="csel-empty">Inga val</div>';
    open.items = items;
    if (open.active == null || open.active >= items.length) open.active = Math.max(0, items.findIndex(o => o.selected));
    mark();
  }

  function mark() {
    const { pop, active, select } = open;
    pop.querySelectorAll('.csel-opt').forEach(el => el.classList.toggle('is-active', Number(el.dataset.i) === active));
    const el = pop.querySelector(`[data-i="${active}"]`);
    if (el) {
      select._csel.btn.setAttribute('aria-activedescendant', el.id);
      const top = el.offsetTop, bottom = top + el.offsetHeight;
      if (top < pop.scrollTop) pop.scrollTop = top - 6;
      else if (bottom > pop.scrollTop + pop.clientHeight) pop.scrollTop = bottom - pop.clientHeight + 6;
    }
  }

  function place() {
    const { select, pop } = open;
    const r = select._csel.btn.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 180 && above > below;
    pop.style.minWidth = `${r.width}px`;
    pop.style.maxHeight = `${Math.max(120, Math.min(320, up ? above : below))}px`;
    const left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8);
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.top = up ? '' : `${r.bottom + 6}px`;
    pop.style.bottom = up ? `${window.innerHeight - r.top + 6}px` : '';
  }

  function show(select) {
    close();
    if (select.disabled) return;
    const pop = document.createElement('div');
    pop.className = 'csel-pop';
    pop.id = `${select._csel.btn.id}-list`;
    pop.setAttribute('role', 'listbox');
    if (select._csel.btn.getAttribute('aria-label')) pop.setAttribute('aria-label', select._csel.btn.getAttribute('aria-label'));
    // I en dialog måste menyn ligga i dialogen för att synas ovanpå den
    (select.closest('dialog') || document.body).appendChild(pop);
    open = { select, pop, items: [], active: null };
    build();
    place();
    mark();
    const btn = select._csel.btn;
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', pop.id);
    select._csel.wrap.classList.add('is-open');
    pop.addEventListener('mousedown', e => e.preventDefault()); // behåll fokus på knappen
    pop.addEventListener('click', e => {
      const el = e.target.closest('.csel-opt');
      if (el && !el.classList.contains('is-disabled')) choose(Number(el.dataset.i));
    });
    pop.addEventListener('mousemove', e => {
      const el = e.target.closest('.csel-opt');
      if (el && Number(el.dataset.i) !== open.active) { open.active = Number(el.dataset.i); mark(); }
    });
  }

  function close() {
    if (!open) return;
    const { select, pop } = open;
    pop.remove();
    const btn = select._csel.btn;
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-activedescendant');
    select._csel.wrap.classList.remove('is-open');
    open = null;
  }

  function choose(i) {
    const { select, items } = open;
    const o = items[i];
    close();
    if (!o) return;
    if (!o.selected) {
      desc.value.set.call(select, o.value);
      o.selected = true;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    refresh(select);
    if (select._csel && select._csel.btn.isConnected) select._csel.btn.focus();
  }

  function step(dir) {
    const n = open.items.length;
    let i = open.active;
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      if (!open.items[i].disabled) break;
    }
    open.active = i;
    mark();
  }

  let typed = '', typedAt = 0;
  function onKey(e, select) {
    const isOpen = open && open.select === select;
    if (!isOpen) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(select); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); open.active = 0; mark(); }
    else if (e.key === 'End') { e.preventDefault(); open.active = open.items.length - 1; mark(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(open.active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close();
    else if (e.key.length === 1) {
      // Skriv början på ett namn för att hoppa dit
      const now = Date.now();
      typed = (now - typedAt < 700 ? typed : '') + e.key.toLowerCase();
      typedAt = now;
      const i = open.items.findIndex(o => o.textContent.trim().toLowerCase().startsWith(typed));
      if (i >= 0) { open.active = i; mark(); }
    }
  }

  document.addEventListener('mousedown', e => {
    if (open && !open.pop.contains(e.target) && !open.select._csel.wrap.contains(e.target)) close();
  }, true);
  window.addEventListener('resize', close);
  window.addEventListener('scroll', e => { if (open && !open.pop.contains(e.target)) close(); }, true);
  document.addEventListener('close', close, true); // en dialog stängs

  // Förbättra alla listrutor, även de som skapas senare (sidor, dialoger)
  const scan = root => root.querySelectorAll && root.querySelectorAll('select').forEach(enhance);
  new MutationObserver(list => {
    for (const m of list) m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.tagName === 'SELECT') enhance(n); else scan(n); } });
    if (open && !open.select.isConnected) close();
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
})();
