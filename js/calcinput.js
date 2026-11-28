// Räkna i beloppsfält (kr) som i Excel: skriv t.ex. =100-25 eller 1200/2 och få svaret
// när du trycker Enter, Tab eller lämnar fältet. Komma fungerar som decimaltecken (12,50).
// Under tiden du skriver är fältet ett textfält; efteråt blir det ett vanligt sifferfält igen.
(() => {
  const SEL = '.input-money input';
  const PLAIN = /^-?\d+(\.\d+)?$/;

  // Liten räknare utan eval: + − * / ( ) och decimaltal
  function evaluate(text) {
    const src = String(text).trim().replace(/^=/, '').replace(/\s+/g, '').replace(/,/g, '.').replace(/[×x]/gi, '*').replace(/÷/g, '/').replace(/−/g, '-');
    if (src === '') return '';
    if (!/^[\d.+\-*/()]+$/.test(src)) return null;
    let i = 0;
    const peek = () => src[i];
    const num = () => {
      const m = /^\d*\.?\d+|^\d+\.?/.exec(src.slice(i));
      if (!m) throw 0;
      i += m[0].length;
      return parseFloat(m[0]);
    };
    const factor = () => {
      if (peek() === '-') { i++; return -factor(); }
      if (peek() === '+') { i++; return factor(); }
      if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw 0; i++; return v; }
      return num();
    };
    const term = () => {
      let v = factor();
      while (peek() === '*' || peek() === '/') {
        const op = src[i++];
        const r = factor();
        v = op === '*' ? v * r : v / r;
      }
      return v;
    };
    const expr = () => {
      let v = term();
      while (peek() === '+' || peek() === '-') {
        const op = src[i++];
        const r = term();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    };
    try {
      const v = expr();
      if (i !== src.length || !Number.isFinite(v)) return null;
      return String(Math.round(v * 100) / 100);
    } catch (e) { return null; }
  }

  // Fältet blir textfält när man klickar i det, så att = + − * / går att skriva
  document.addEventListener('focusin', e => {
    const input = e.target;
    if (!input.matches || !input.matches(SEL) || input.type !== 'number') return;
    input._calc = true;
    input.type = 'text';
    input.setAttribute('autocomplete', 'off');
  });

  // Räkna ut och gör fältet till sifferfält igen. Returnerar false om uträkningen är fel.
  function finish(input, notify) {
    if (!input._calc) return true;
    const before = input.value;
    const result = evaluate(before);
    if (result === null) {
      input.setCustomValidity('Uträkningen gick inte att förstå. Skriv t.ex. =100-25');
      input.reportValidity();
      return false;
    }
    input.setCustomValidity('');
    input._calc = false;
    input.type = 'number';
    input.value = result;
    // Berätta för sidan om det nya värdet (sidan har inte sett uträkningen medan den skrevs)
    if (notify && result !== before) input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  // Medan man skriver en uträkning (t.ex. "=100-" eller "12,5") ska sidan inte läsa fältet
  document.addEventListener('input', e => {
    const input = e.target;
    if (!input._calc) return;
    input.setCustomValidity('');
    if (!PLAIN.test(input.value.trim()) && input.value.trim() !== '') e.stopImmediatePropagation();
  }, true);

  // "change" kommer före "blur": räkna ut först så att sidan sparar svaret
  document.addEventListener('change', e => { if (e.target._calc) finish(e.target, true); }, true);
  document.addEventListener('focusout', e => { if (e.target._calc) finish(e.target, true); }, true);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target._calc) return;
    if (!finish(e.target, true)) e.preventDefault();
  }, true);
  // Säkerhet: räkna ut alla fält innan ett formulär skickas
  document.addEventListener('submit', e => {
    for (const input of e.target.querySelectorAll(SEL)) {
      if (input._calc && !finish(input, true)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    }
  }, true);

  window.calcInput = { evaluate };
})();
