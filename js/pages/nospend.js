// Köpfri utmaning – markera dagar utan köp och följ dina streaks.
(() => {
  const { fmt, ui, charts, ym, iso, today, daysInMonth, pad2, parseISO } = App;
  const WEEKDAYS = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];
  const WEEKDAYS_LONG = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];

  function stats(s) {
    const now = today();
    const key = ym(now);
    const marked = Object.keys(s.noSpend).filter(d => s.noSpend[d]).sort();

    // Nuvarande streak: dagar i följd bakåt från idag (eller igår om idag inte är markerad än)
    let current = 0;
    const d = new Date(now);
    if (!s.noSpend[iso(d)]) d.setDate(d.getDate() - 1);
    while (s.noSpend[iso(d)]) { current++; d.setDate(d.getDate() - 1); }

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
    return { current, longest, monthCount, days, rate: monthCount / days };
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
        const on = !!s.noSpend[date];
        const future = parseISO(date) > now;
        const isToday = date === iso(now);
        const wd = WEEKDAYS_LONG[(lead + day - 1) % 7];
        cells += `<button type="button" class="ns-cell ${on ? 'ns-on' : ''} ${isToday ? 'ns-today' : ''}" data-date="${date}" ${future ? 'disabled' : ''}
            aria-pressed="${on}" aria-label="${wd} ${day} ${fmt.monthName(now.getMonth())}: ${on ? 'köpfri dag' : 'köp'}">
          <span class="ns-num">${day}</span>
          <span class="ns-dot">${on ? ui.icon('check', 11) : ''}</span>
          <span class="ns-label">${future ? '' : on ? 'Köpfritt' : 'Köp'}</span>
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
              <p class="muted">${st.monthCount} av ${st.days} dagar</p>
            </div>
            <div id="nsRing"></div>
          </section>
        </div>
        ${ui.card({
          overline: fmt.month(key),
          title: 'Tryck på en dag för att markera den som köpfri',
          body: `<div class="ns-grid" role="group" aria-label="Kalender för ${fmt.month(key)}">
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
          App.update(state => {
            if (state.noSpend[date]) delete state.noSpend[date]; else state.noSpend[date] = true;
          });
        });
      });
    },
  });
})();
