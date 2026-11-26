// Egen månadsväljare i appens tema. Varje <input type="month"> får en knapp och en
// ruta med år och månader i stället för webbläsarens standard. Det riktiga fältet finns
// kvar (dolt), så värdet och change-händelser fungerar som förut.
(() => {
  const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  const SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const pad = n => String(n).padStart(2, '0');
  const CAL = '<svg class="mp-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ARROW = d => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  let open = null; // { input, pop, year, active }

  const parse = v => { const m = /^(\d{4})-(\d{2})$/.exec(v || ''); return m ? { y: Number(m[1]), m: Number(m[2]) - 1 } : null; };
  const now = () => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; };

  function refresh(input) {
    const c = input._mp;
    const v = parse(valueDesc.get.call(input));
    c.btn.innerHTML = `<span class="mp-text">${v ? `${cap(MONTHS[v.m])} ${v.y}` : 'Välj månad'}</span>${CAL}`;
    c.btn.disabled = input.disabled;
  }

  function enhance(input) {
    if (input._mp) return;
    const wrap = document.createElement('span');
    wrap.className = 'mp';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mp-btn csel-btn';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    const label = input.closest('label')?.querySelector('.field-label');
    if (label) btn.setAttribute('aria-label', label.textContent.trim());
    wrap.appendChild(btn);
    input.classList.add('csel-native');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    input._mp = { wrap, btn };
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return valueDesc.get.call(this); },
      set(v) { valueDesc.set.call(this, v); refresh(this); },
    });
    input.addEventListener('change', () => refresh(input));
    input.addEventListener('focus', () => btn.focus());
    btn.addEventListener('click', () => (open && open.input === input ? close() : show(input)));
    btn.addEventListener('keydown', e => onKey(e, input));
    refresh(input);
  }

  function draw() {
    const { input, pop, year, active } = open;
    const cur = parse(valueDesc.get.call(input));
    const today = now();
    pop.innerHTML = `
      <div class="mp-head">
        <button type="button" class="mp-nav" data-y="-1" aria-label="Föregående år">${ARROW('M15 6l-6 6 6 6')}</button>
        <b class="mp-year" aria-live="polite">${year}</b>
        <button type="button" class="mp-nav" data-y="1" aria-label="Nästa år">${ARROW('M9 6l6 6-6 6')}</button>
      </div>
      <div class="mp-grid" role="grid">
        ${SHORT.map((m, i) => {
          const sel = cur && cur.y === year && cur.m === i;
          const isNow = today.y === year && today.m === i;
          return `<button type="button" class="mp-month ${sel ? 'is-selected' : ''} ${isNow ? 'is-now' : ''} ${active === i ? 'is-active' : ''}"
            data-m="${i}" aria-pressed="${sel}" aria-label="${cap(MONTHS[i])} ${year}">${cap(m)}</button>`;
        }).join('')}
      </div>
      <div class="mp-foot"><button type="button" class="mp-today">Denna månad</button></div>`;
  }

  function place() {
    const { input, pop } = open;
    const r = input._mp.btn.getBoundingClientRect();
    const h = pop.offsetHeight;
    const up = window.innerHeight - r.bottom < h + 16 && r.top > h + 16;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
    pop.style.top = up ? '' : `${r.bottom + 6}px`;
    pop.style.bottom = up ? `${window.innerHeight - r.top + 6}px` : '';
  }

  function show(input) {
    close();
    if (input.disabled) return;
    const v = parse(valueDesc.get.call(input)) || now();
    const pop = document.createElement('div');
    pop.className = 'mp-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Välj månad');
    (input.closest('dialog') || document.body).appendChild(pop);
    open = { input, pop, year: v.y, active: v.m };
    draw();
    place();
    input._mp.btn.setAttribute('aria-expanded', 'true');
    input._mp.wrap.classList.add('is-open');
    pop.addEventListener('mousedown', e => e.preventDefault()); // behåll fokus på knappen
    pop.addEventListener('click', e => {
      const nav = e.target.closest('[data-y]');
      if (nav) { open.year += Number(nav.dataset.y); draw(); return; }
      const m = e.target.closest('[data-m]');
      if (m) { choose(open.year, Number(m.dataset.m)); return; }
      if (e.target.closest('.mp-today')) { const t = now(); choose(t.y, t.m); }
    });
  }

  function close() {
    if (!open) return;
    open.pop.remove();
    open.input._mp.btn.setAttribute('aria-expanded', 'false');
    open.input._mp.wrap.classList.remove('is-open');
    open = null;
  }

  function choose(y, m) {
    const input = open.input;
    close();
    const v = `${y}-${pad(m + 1)}`;
    if (valueDesc.get.call(input) !== v) {
      valueDesc.set.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (input.isConnected) { refresh(input); input._mp.btn.focus(); }
  }

  // Tangentbord: pilar flyttar mellan månader (och år), Enter väljer, Esc stänger
  function onKey(e, input) {
    if (!open || open.input !== input) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(input); }
      return;
    }
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };
    if (e.key in moves) {
      e.preventDefault();
      let i = open.active + moves[e.key];
      if (i < 0) { open.year--; i += 12; } else if (i > 11) { open.year++; i -= 12; }
      open.active = i;
      draw();
    } else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); open.year += e.key === 'PageUp' ? -1 : 1; draw(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(open.year, open.active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close();
  }

  document.addEventListener('mousedown', e => {
    if (open && !open.pop.contains(e.target) && !open.input._mp.wrap.contains(e.target)) close();
  }, true);
  window.addEventListener('resize', close);
  window.addEventListener('scroll', e => { if (open && !open.pop.contains(e.target)) close(); }, true);
  document.addEventListener('close', close, true);

  const scan = root => root.querySelectorAll && root.querySelectorAll('input[type="month"]').forEach(enhance);
  new MutationObserver(list => {
    for (const m of list) m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches('input[type="month"]')) enhance(n); else scan(n); } });
    if (open && !open.input.isConnected) close();
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
})();
