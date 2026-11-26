// Egna − och + knappar för sifferfält i appens tema (t.ex. lönedag, betalningsdag,
// ränta och procent). Webbläsarens små pilar döljs i CSS. Beloppsfält (kr) får inga
// knappar: där skriver man in beloppet.
(() => {
  const MINUS = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 12h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const PLUS = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 6v12M6 12h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function enhance(input) {
    if (input._step || input.closest('.input-money')) return;
    const wrap = document.createElement('span');
    wrap.className = 'stepper';
    input.parentNode.insertBefore(wrap, input);
    const minus = document.createElement('button');
    const plus = document.createElement('button');
    for (const [b, html, dir, label] of [[minus, MINUS, -1, 'Minska'], [plus, PLUS, 1, 'Öka']]) {
      b.type = 'button';
      b.className = 'stepper-btn';
      b.innerHTML = html;
      b.tabIndex = -1; // pilarna på tangentbordet fungerar redan i fältet
      b.setAttribute('aria-label', label);
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => step(input, dir));
    }
    wrap.append(minus, input, plus);
    input._step = true;
  }

  function step(input, dir) {
    if (input.disabled || input.readOnly) return;
    const before = input.value;
    if (input.value === '') input.value = input.min !== '' ? input.min : '0';
    else {
      try { dir > 0 ? input.stepUp() : input.stepDown(); } catch (e) { return; }
    }
    // stepUp hamnar ibland mellan stegen (t.ex. 4.25 med steg 0.01) – avrunda till stegets decimaler
    const st = input.step && input.step !== 'any' ? input.step : '1';
    const dec = (st.split('.')[1] || '').length;
    input.value = String(Number(Number(input.value).toFixed(dec)));
    if (input.value !== before) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  const scan = root => root.querySelectorAll && root.querySelectorAll('input[type="number"]').forEach(enhance);
  new MutationObserver(list => {
    for (const m of list) m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches('input[type="number"]')) enhance(n); else scan(n); } });
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
})();
