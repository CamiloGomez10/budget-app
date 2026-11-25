// Översikt – din ekonomi i en överblick.
(() => {
  const { fmt, calc, ui, charts, esc, sum, today, period, COLORS } = App;

  App.page({
    id: 'oversikt',
    title: 'Översikt',
    overline: 'Översikt',
    heading: 'Välkommen tillbaka.',
    icon: 'home',

    render(s) {
      const now = today();
      const key = period.current();
      const monthIndex = Number(key.slice(5)) - 1;
      const monthName = fmt.monthName(monthIndex);
      const range = period.range(key);
      const rangeLabel = period.rangeLabel(key);
      const t = calc.monthTotals(key);
      const plannedTotal = calc.plannedTotal(key);
      const remainingShare = t.income > 0 ? t.net / t.income : 0;
      const daysLeft = period.daysLeft(key);
      const avgExp = calc.avgMonthlyExpense();
      const runway = avgExp > 0 ? calc.liquid() / avgExp : null;
      const periodBills = calc.billsInRange(range.start, range.end);
      const bills = periodBills.filter(b => !b.isPaid);
      const onTrack = t.net >= 0 && (plannedTotal === 0 || t.expense <= plannedTotal);

      const hero = `
        <section class="hero" style="${s.settings.heroImage ? `background-image:linear-gradient(90deg,rgba(43,33,28,.55),rgba(43,33,28,.05) 70%),url(${s.settings.heroImage})` : ''}">
          <div class="hero-text">
            <p class="overline">Budget</p>
            <h2>Lite mer ordning.<br>Mycket mer frihet.</h2>
            <p>Ditt nästa kapitel</p>
          </div>
          <label class="btn btn-small hero-btn">Byt foto<input type="file" accept="image/*" id="heroInput" hidden></label>
        </section>`;

      const summary = `
        <div class="dash-summary">
          <div>
            <h2 class="card-title">Dina pengar, tydligt ordnade.</h2>
            <p class="muted">${t.income > 0 ? `${fmt.pct(Math.max(0, remainingShare))} av inkomsten finns kvar.` : 'Lägg till en inkomst för att komma igång.'}</p>
          </div>
          <div class="dash-health">
            <p class="overline">Månadens hälsa</p>
            <p class="serif dash-health-value">${onTrack ? 'I fas' : 'Se över'}</p>
          </div>
        </div>`;

      const stats = `
        <div class="grid-4">
          ${ui.stat({ label: 'Total inkomst', value: fmt.money(t.income), hint: rangeLabel ? `Lönemånad ${rangeLabel}` : `Registrerat i ${monthName}`, variant: 'dark' })}
          ${ui.stat({ label: 'Totala utgifter', value: fmt.money(t.expense), hint: t.income > 0 ? `${fmt.pct(t.expense / t.income)} av inkomsten` : '–' })}
          ${ui.stat({ label: 'Kvar av inkomsten', value: fmt.money(t.net), hint: 'Aktuellt saldo', variant: 'tan' })}
          ${ui.stat({ label: 'Totalt sparat', value: fmt.money(calc.totalSaved()), hint: `${s.goals.length} ${s.goals.length === 1 ? 'mål' : 'mål'}`, variant: 'tan' })}
          ${ui.stat({ label: 'Total skuld', value: fmt.money(calc.totalDebt()), hint: `${s.debts.length} ${s.debts.length === 1 ? 'skuld' : 'skulder'}` })}
          ${ui.stat({ label: 'Nettoförmögenhet', value: fmt.money(calc.netWorth()), hint: 'Tillgångar − skulder' })}
          ${ui.stat({ label: 'Kommande räkningar', value: fmt.money(sum(bills.map(b => b.amount))), hint: `${bills.length} planerade` })}
        </div>`;

      const strip = ui.strip([
        { label: 'Sparkvot', value: t.income > 0 ? fmt.pct(remainingShare, 1) : '–' },
        { label: 'Utrymme per dag', value: fmt.money(Math.max(0, t.net) / daysLeft), hint: `${daysLeft} dagar kvar` },
        { label: 'Buffert räcker', value: runway == null ? '–' : `${fmt.num(runway, 1)} mån` },
      ]);

      const year = Number(key.slice(0, 4));
      const months = calc.yearMonths(year);
      const cashflow = ui.card({
        overline: 'Kassaflöde',
        title: 'Inkomster och utgifter',
        right: `<span>12 månader</span>${ui.legend([{ name: 'Inkomster', color: COLORS.income }, { name: 'Utgifter', color: COLORS.expense }])}`,
        body: `<div class="chart" id="dashCashflow"></div>
          <div style="margin-top:14px">${t.net >= 0
            ? ui.note(`<b>Du bygger andrum.</b>${fmt.money(t.net)} finns kvar efter utgifterna i ${monthName}.`)
            : ui.note(`<b>Utgifterna är högre än inkomsterna i ${monthName}.</b>${fmt.money(-t.net)} över hittills.`)}</div>
          ${ui.tableView(['Månad', 'Inkomster', 'Utgifter'], months.map(m => [fmt.cap(fmt.monthName(m.index)), fmt.money0(m.income), fmt.money0(m.expense)]))}`,
      });

      const byCat = calc.byCategory(calc.txInMonth(key));
      const catItems = s.categories.map(c => ({ name: c.name, color: c.color, value: byCat[c.name] || 0 }))
        .concat(Object.keys(byCat).filter(n => !s.categories.some(c => c.name === n)).map(n => ({ name: n, color: '#8b8178', value: byCat[n] })));

      const spending = `
        <div class="grid-2-1">
          ${ui.card({
            overline: rangeLabel ? `Utgifter ${rangeLabel}` : 'Utgifter', title: 'Per kategori',
            body: t.expense > 0
              ? `<div class="donut-wrap"><div id="dashDonut"></div>${charts.donutLegend(catItems)}</div>`
              : ui.empty('Inga utgifter ännu', `Utgifter i ${monthName} visas här.`),
          })}
          ${ui.card({
            overline: 'Budget', title: 'Använd budget',
            body: plannedTotal > 0 ? '<div id="dashBudget" class="center"></div>' : ui.empty('Ingen budget satt', 'Planera månaden under Månadsbudget.'),
          })}
        </div>`;

      const nwLabels = [];
      const nwValues = [];
      s.snapshots.filter(x => x.month.startsWith(String(year)) && x.month < key).forEach(x => {
        nwLabels.push(`${fmt.monthShort(Number(x.month.slice(5)) - 1)} ${x.month.slice(2, 4)}`);
        nwValues.push(x.netWorth);
      });
      nwLabels.push(`${fmt.monthShort(monthIndex)} ${String(year).slice(2)}`);
      nwValues.push(calc.netWorth());
      const netWorth = ui.card({
        overline: 'Position', title: 'Nettoförmögenhet över tid',
        right: `<span class="amount" style="font-size:20px;color:var(--text)">${fmt.money(calc.netWorth())}</span>`,
        body: '<div class="chart" id="dashNetWorth"></div>',
      });
      App._dashNW = { labels: nwLabels, values: nwValues };

      const goals = ui.card({
        overline: 'Mål', title: 'Sparmål',
        right: `<span>${s.goals.length} mål</span>`,
        body: s.goals.length
          ? `<ul class="rows goal-rows">${s.goals.map(g => {
              const share = g.target > 0 ? g.current / g.target : 0;
              return `<li><div style="flex:1;min-width:0">
                  <div class="goal-line"><b>${esc(g.name)}</b><span class="pct">${fmt.pct(share)}</span></div>
                  ${ui.progress(share)}
                  <p class="muted">${fmt.money(g.current)} av ${fmt.money(g.target)}</p>
                </div></li>`;
            }).join('')}</ul>`
          : ui.empty('Inga sparmål ännu', 'Skapa ett mål under Sparande & buffertar.'),
      });

      const upcoming = ui.card({
        overline: 'Härnäst', title: 'Kommande räkningar',
        right: '<a class="link" href="#/rakningar">Kalender</a>',
        body: periodBills.length
          ? `<ul class="rows">${periodBills.map(b => {
              const d = App.parseISO(b.date);
              return `<li>
                <span class="date-badge ${b.debtId ? 'date-badge-dark' : ''}"><b>${d.getDate()}</b><small>${fmt.monthShort(d.getMonth())}</small></span>
                <div style="flex:1;min-width:0"><b>${esc(b.name)}</b><p class="muted">${b.debtId ? 'Månatlig avbetalning' : recurrenceLabel(b.recurrence)}${b.isPaid ? ' · Betald' : ''}</p></div>
                <span class="amount" style="font-size:17px">${fmt.money0(b.amount)}</span>
              </li>`;
            }).join('')}</ul>`
          : ui.empty('Inga räkningar denna period', 'Lägg till räkningar under Räkningar & kalender.'),
      });

      return `${hero}${summary}${stats}${strip}${cashflow}${spending}${netWorth}<div class="grid-2">${goals}${upcoming}</div>`;
    },

    mount(root, s) {
      const now = today();
      const key = period.current();
      const months = calc.yearMonths(Number(key.slice(0, 4)));
      charts.bars(root.querySelector('#dashCashflow'), {
        label: 'Inkomster och utgifter per månad',
        labels: months.map(m => fmt.monthShort(m.index)),
        tooltipLabels: months.map(m => fmt.cap(fmt.monthName(m.index))),
        series: [
          { name: 'Inkomster', color: COLORS.income, values: months.map(m => m.income) },
          { name: 'Utgifter', color: COLORS.expense, values: months.map(m => m.expense) },
        ],
      });

      const byCat = calc.byCategory(calc.txInMonth(key));
      const items = s.categories.map(c => ({ name: c.name, color: c.color, value: byCat[c.name] || 0 }))
        .concat(Object.keys(byCat).filter(n => !s.categories.some(c => c.name === n)).map(n => ({ name: n, color: '#8b8178', value: byCat[n] })));
      const t = calc.monthTotals(key);
      charts.donut(root.querySelector('#dashDonut'), { items, center: { label: 'Totalt', value: fmt.money0(t.expense) }, size: 190, label: 'Utgifter per kategori' });

      const planned = calc.plannedTotal(key);
      const share = planned > 0 ? t.expense / planned : 0;
      charts.ring(root.querySelector('#dashBudget'), {
        share, size: 180, color: share > 1 ? 'var(--rose)' : 'var(--dark)',
        center: { value: fmt.pct(share), label: 'Använt', sub: share <= 1 ? `Kvar ${fmt.money0(planned - t.expense)}` : `Över ${fmt.money0(t.expense - planned)}` },
      });

      const nw = App._dashNW;
      charts.bars(root.querySelector('#dashNetWorth'), {
        label: 'Nettoförmögenhet per månad', labels: nw.labels, wide: true, plotBg: 'var(--plot-bg)',
        series: [{ name: 'Nettoförmögenhet', color: COLORS.dark, values: nw.values }],
      });

      // Byt hero-foto: skalas ner så att det får plats i localStorage
      const input = root.querySelector('#heroInput');
      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, 1600 / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const data = canvas.toDataURL('image/jpeg', 0.8);
          URL.revokeObjectURL(img.src);
          App.update(st => { st.settings.heroImage = data; });
        };
        img.src = URL.createObjectURL(file);
      });
    },
  });

  function recurrenceLabel(r) {
    return { monthly: 'Varje månad', yearly: 'Varje år', once: 'En gång' }[r] || '';
  }
})();
