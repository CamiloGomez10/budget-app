// Köpfri utmaning – dagar utan köp räknas fram från transaktionerna.
// Ett köp = en utgift som inte är fast kostnad, sparande, skuldbetalning eller betald räkning.
// Tryck på en dag för att ändra den manuellt (noSpend[datum] = true/false).
(() => {
  const { fmt, ui, charts, calc, esc, ym, iso, today, daysInMonth, pad2, parseISO } = App;

  // Datum med minst ett köp
  function purchaseDays(s) {
    const fixed = (s.parents || [])[0];
    const out = new Set();
    for (const t of s.transactions) {
      if (t.type !== 'expense' || t.amount <= 0 || t.billId || calc.debtOf(t) || calc.isSaving(t.category)) continue;
      const c = s.categories.find(x => x.name === t.category);
      if (c && fixed && c.parent === fixed) continue;
      out.add(t.date);
    }
    return out;
  }
  // Är dagen köpfri? Manuell markering vinner, annars transaktionerna.
  const isFree = (s, bought, date) => (date in s.noSpend ? !!s.noSpend[date] : !bought.has(date));
  const startDate = s => s.transactions.reduce((m, t) => (t.date < m ? t.date : m), iso(today()));
  const WEEKDAYS = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];
  const WEEKDAYS_LONG = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];

  function stats(s) {
    const now = today();
    const key = ym(now);
    const bought = purchaseDays(s);
    const marked = [];
    for (const d = parseISO(startDate(s)); d <= now; d.setDate(d.getDate() + 1)) if (isFree(s, bought, iso(d))) marked.push(iso(d));
    const free = new Set(marked);

    // Nuvarande streak: dagar i följd bakåt från idag (eller igår om idag inte är köpfri än)
    let current = 0;
    const d = new Date(now);
    if (!free.has(iso(d))) d.setDate(d.getDate() - 1);
    while (free.has(iso(d))) { current++; d.setDate(d.getDate() - 1); }

    // Längsta streak över alla markerade dagar
    let longest = 0, run = 0, prev = null;
    for (const day of marked) {
      const t = parseISO(day);
      if (prev && (t - prev) / 86400000 === 1) run++; else run = 1;
      longest = Math.max(longest, run);
      prev = t;
    }
    const monthCount = marked.filter(x => x.startsWith(key)).length;
    const days = daysInMonth(key);
    const passed = now.getDate();
    return { current, longest, monthCount, days, passed, rate: monthCount / passed, bought };
  }

  const dayWord = n => `${n} ${n === 1 ? 'dag' : 'dagar'}`;

  App.page({
    id: 'kopfritt',
    title: 'Köpfri utmaning',
    overline: 'Köpfritt',
    icon: 'ban',

    render(s) {
      const now = today();
      const key = ym(now);
      const st = stats(s);
      const first = parseISO(`${key}-01`);
      const lead = (first.getDay() + 6) % 7; // måndag först

      let cells = '';
      for (let i = 0; i < lead; i++) cells += '<div class="ns-cell ns-blank" aria-hidden="true"></div>';
      for (let day = 1; day <= st.days; day++) {
        const date = `${key}-${pad2(day)}`;
        const future = parseISO(date) > now;
        const on = !future && isFree(s, st.bought, date);
        const manual = date in s.noSpend;
        const isToday = date === iso(now);
        const wd = WEEKDAYS_LONG[(lead + day - 1) % 7];
        cells += `<button type="button" class="ns-cell ${on ? 'ns-on' : ''} ${isToday ? 'ns-today' : ''}" data-date="${date}" ${future ? 'disabled' : ''}
            aria-pressed="${on}" aria-label="${wd} ${day} ${fmt.monthName(now.getMonth())}: ${on ? 'köpfri dag' : 'köp'}">
          <span class="ns-num">${day}</span>
          <span class="ns-dot">${on ? ui.icon('check', 11) : ''}</span>
          <span class="ns-label">${future ? '' : on ? 'Köpfritt' : 'Köp'}${manual ? '*' : ''}</span>
        </button>`;
      }

      return `
        <div class="ns-top">
          <div class="ns-stats">
            ${ui.stat({ label: 'Nuvarande streak', value: dayWord(st.current) })}
            ${ui.stat({ label: 'Längsta streak', value: dayWord(st.longest) })}
            ${ui.stat({ label: 'Köpfria dagar', value: String(st.monthCount), hint: `i ${fmt.monthName(now.getMonth())}` })}
            ${ui.stat({ label: 'Andel i månaden', value: fmt.pct(st.rate) })}
          </div>
          <section class="card ns-progress">
            <div>
              <p class="overline">Månadens framsteg</p>
              <h2 class="card-title">Köpfri rytm</h2>
              <p class="muted">${st.monthCount} av ${st.passed} dagar hittills</p>
            </div>
            <div id="nsRing"></div>
          </section>
        </div>
        ${ui.card({
          overline: fmt.month(key),
          title: 'Dina köpfria dagar',
          body: `<p class="muted ns-help">Räknas ut från dina transaktioner: en dag är köpfri om du inte har några utgifter förutom fasta kostnader (${esc((s.parents || [])[0] || '')}), sparande, skuldbetalningar och räkningar. Tryck på en dag för att ändra den själv (markeras med *), tryck igen för att återgå.</p>
            <div class="ns-grid" role="group" aria-label="Kalender för ${fmt.month(key)}">
              ${WEEKDAYS.map(w => `<div class="ns-head" aria-hidden="true">${w}</div>`).join('')}
              ${cells}
            </div>`,
        })}`;
    },

    mount(root, s) {
      const st = stats(s);
      charts.ring(root.querySelector('#nsRing'), {
        share: st.rate, size: 120, stroke: 16,
        center: { value: fmt.pct(st.rate), label: 'köpfritt' },
      });
      root.querySelectorAll('.ns-cell[data-date]').forEach(btn => {
        btn.addEventListener('click', () => {
          const date = btn.dataset.date;
          const bought = purchaseDays(App.state);
          App.update(state => {
            // Första trycket vänder det uträknade värdet, andra trycket tar bort ändringen
            if (date in state.noSpend) delete state.noSpend[date];
            else state.noSpend[date] = !isFree(state, bought, date);
          });
        });
      });
    },
  });
})();
