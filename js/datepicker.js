// Egen datumväljare i appens tema. Varje <input type="date"> får en knapp och en
// kalender i stället för webbläsarens standard. Det riktiga fältet finns kvar (dolt),
// så formulär, värden och change-händelser fungerar som förut.
(() => {
  const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  const WEEKDAYS = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const CAL = '<svg class="mp-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ARROW = d => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  let open = null; // { input, pop, view: Date (1:a i visad månad), active: Date }

  function refresh(input) {
    const c = input._dp;
    const d = parse(valueDesc.get.call(input));
    c.btn.innerHTML = `<span class="mp-text ${d ? '' : 'dp-empty'}">${d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : 'Välj'}</span>${CAL}`;
    c.btn.disabled = input.disabled;
  }

  function enhance(input) {
    if (input._dp) return;
    const wrap = document.createElement('span');
    wrap.className = 'mp dp';
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
    input._dp = { wrap, btn };
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return valueDesc.get.call(this); },
      set(v) { valueDesc.set.call(this, v); refresh(this); },
    });
    input.addEventListener('change', () => refresh(input));
    input.addEventListener('focus', () => btn.focus());
    // Webbläsarens egen väljare får aldrig öppnas, t.ex. när man klickar på fältets
    // rubrik (en <label> skickar klicket vidare till det dolda fältet). Visa vår i stället.
    input.addEventListener('click', e => { e.preventDefault(); if (!open || open.input !== input) show(input); });
    input.showPicker = () => show(input);
    const field = input.closest('label');
    if (field) {
      field.addEventListener('click', e => {
        if (e.target.closest('button') || e.target === input) return;
        e.preventDefault();
        if (!open || open.input !== input) show(input);
        btn.focus();
      });
    }
    btn.addEventListener('click', () => (open && open.input === input ? close() : show(input)));
    btn.addEventListener('keydown', e => onKey(e, input));
    refresh(input);
  }

  function draw() {
    const { input, pop, view, active } = open;
    const sel = valueDesc.get.call(input);
    const now = iso(today());
    const y = view.getFullYear(), m = view.getMonth();
    const lead = (new Date(y, m, 1).getDay() + 6) % 7; // måndag först
    const days = new Date(y, m + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span class="dp-blank"></span>';
    for (let d = 1; d <= days; d++) {
      const key = `${y}-${pad(m + 1)}-${pad(d)}`;
      cells += `<button type="button" class="dp-day ${key === sel ? 'is-selected' : ''} ${key === now ? 'is-now' : ''} ${key === iso(active) ? 'is-active' : ''}"
        data-d="${key}" aria-pressed="${key === sel}" aria-label="${d} ${MONTHS[m]} ${y}">${d}</button>`;
    }
    pop.innerHTML = `
      <div class="mp-head">
        <button type="button" class="mp-nav" data-mv="-1" aria-label="Föregående månad">${ARROW('M15 6l-6 6 6 6')}</button>
        <b class="mp-year dp-title" aria-live="polite">${cap(MONTHS[m])} ${y}</b>
        <button type="button" class="mp-nav" data-mv="1" aria-label="Nästa månad">${ARROW('M9 6l6 6-6 6')}</button>
      </div>
      <div class="dp-grid">${WEEKDAYS.map(w => `<span class="dp-wd">${w}</span>`).join('')}${cells}</div>
      <div class="mp-foot dp-foot">
        ${input.required ? '<span></span>' : '<button type="button" class="mp-today dp-clear">Rensa</button>'}
        <button type="button" class="mp-today dp-today">Idag</button>
      </div>`;
  }

  function place() {
    const { input, pop } = open;
    const r = input._dp.btn.getBoundingClientRect();
    const h = pop.offsetHeight;
    const up = window.innerHeight - r.bottom < h + 16 && r.top > h + 16;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
    pop.style.top = up ? '' : `${Math.max(8, Math.min(r.bottom + 6, window.innerHeight - h - 8))}px`;
    pop.style.bottom = up ? `${window.innerHeight - r.top + 6}px` : '';
  }

  function show(input) {
    close();
    if (input.disabled) return;
    const d = parse(valueDesc.get.call(input)) || today();
    const pop = document.createElement('div');
    pop.className = 'mp-pop dp-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Välj datum');
    (input.closest('dialog') || document.body).appendChild(pop);
    open = { input, pop, view: new Date(d.getFullYear(), d.getMonth(), 1), active: d };
    draw();
    place();
    input._dp.btn.setAttribute('aria-expanded', 'true');
    input._dp.wrap.classList.add('is-open');
    pop.addEventListener('mousedown', e => e.preventDefault()); // behåll fokus på knappen
    pop.addEventListener('click', e => {
      const mv = e.target.closest('[data-mv]');
      if (mv) { open.view = new Date(open.view.getFullYear(), open.view.getMonth() + Number(mv.dataset.mv), 1); draw(); return; }
      const day = e.target.closest('[data-d]');
      if (day) { choose(day.dataset.d); return; }
      if (e.target.closest('.dp-today')) choose(iso(today()));
      else if (e.target.closest('.dp-clear')) choose('');
    });
  }

  function close() {
    if (!open) return;
    open.pop.remove();
    open.input._dp.btn.setAttribute('aria-expanded', 'false');
    open.input._dp.wrap.classList.remove('is-open');
    open = null;
  }

  function choose(v) {
    const input = open.input;
    close();
    if (valueDesc.get.call(input) !== v) {
      valueDesc.set.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (input.isConnected) { refresh(input); input._dp.btn.focus(); }
  }

  // Tangentbord: pilar flyttar en dag/vecka, PageUp/PageDown en månad, Enter väljer, Esc stänger
  function onKey(e, input) {
    if (!open || open.input !== input) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(input); }
      return;
    }
    const days = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const a = open.active;
    if (e.key in days || e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      open.active = e.key in days
        ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + days[e.key])
        : new Date(a.getFullYear(), a.getMonth() + (e.key === 'PageUp' ? -1 : 1), a.getDate());
      open.view = new Date(open.active.getFullYear(), open.active.getMonth(), 1);
      draw();
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(iso(open.active)); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close();
  }

  document.addEventListener('mousedown', e => {
    if (open && !open.pop.contains(e.target) && !open.input._dp.wrap.contains(e.target)) close();
  }, true);
  window.addEventListener('resize', close);
  window.addEventListener('scroll', e => { if (open && !open.pop.contains(e.target)) close(); }, true);
  document.addEventListener('close', close, true);

  const scan = root => root.querySelectorAll && root.querySelectorAll('input[type="date"]').forEach(enhance);
  new MutationObserver(list => {
    for (const m of list) m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches('input[type="date"]')) enhance(n); else scan(n); } });
    if (open && !open.input.isConnected) close();
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
})();
