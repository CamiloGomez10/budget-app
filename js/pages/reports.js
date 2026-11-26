// Rapporter & insikter – trender och fördelning över en period.
(() => {
  const { fmt, calc, ui, charts, esc, sum, ym, today, addMonths, COLORS } = App;
  let period = 'year'; // 'year' | '12m'

  function monthKeys() {
    const now = today();
    if (period === '12m') {
      const cur = App.period.current();
      return Array.from({ length: 12 }, (_, i) => addMonths(cur, i - 11));
    }
    return Array.from({ length: 12 }, (_, i) => `${App.period.current().slice(0, 4)}-${App.pad2(i + 1)}`);
  }
  const label = key => fmt.monthShort(Number(key.slice(5)) - 1);
  const longLabel = key => fmt.cap(fmt.month(key));

  function data(s) {
    const keys = monthKeys();
    const months = keys.map(k => ({ key: k, ...calc.monthTotals(k), savings: sum(calc.txInMonth(k).filter(t => t.type === 'expense' && calc.isSaving(t.category)).map(t => t.amount)) }));
    const from = App.period.range(keys[0]).start, to = App.period.range(keys[11]).end;
    const tx = s.transactions.filter(t => t.date >= from && t.date <= to);
    const byCat = calc.byCategory(tx);
    const catItems = s.categories.map(c => ({ name: c.name, color: c.color, value: byCat[c.name] || 0 }))
      .concat(Object.keys(byCat).filter(n => !s.categories.some(c => c.name === n)).map(n => ({ name: n, color: '#8b8178', value: byCat[n] })));
    let running = 0;
    const savingsCum = months.map(m => (running += m.savings));

    // Skuldbetalningar per månad (transaktioner kopplade till skulder)
    const payments = s.transactions.filter(t => t.date >= from && t.date <= to && calc.debtOf(t)).map(t => ({ date: t.date, amount: t.amount, debt: calc.debtOf(t).name }));
    const payByMonth = keys.map(k => sum(payments.filter(p => p.date && App.period.keyOf(p.date) === k).map(p => p.amount)));

    const hist = new Set(calc.historyKeys(24));
    const nw = calc.netWorthSeries(keys.filter(k => hist.has(k)));
    const nwLabels = nw.map(x => label(x.key));
    const nwValues = nw.map(x => x.value);

    return { keys, months, tx, catItems, totalSpent: sum(Object.values(byCat)), savingsCum, payments, payByMonth, nwLabels, nwValues };
  }

  App.page({
    id: 'rapporter',
    title: 'Rapporter & insikter',
    overline: 'Analys',
    heading: 'Ekonomiska signaler, tydligt sammankopplade.',
    icon: 'report',

    render(s) {
      const d = data(s);
      const hasTx = d.tx.length > 0;
      const periodLabel = period === 'year' ? 'I år' : 'Senaste 12 månaderna';
      const principal = sum(d.payments.map(p => p.amount));

      const select = `<div class="rep-bar">
          <label class="select-pill"><span class="sr-only">Period</span>
            <select id="repPeriod">
              <option value="year" ${period === 'year' ? 'selected' : ''}>I år</option>
              <option value="12m" ${period === '12m' ? 'selected' : ''}>Senaste 12 månaderna</option>
            </select>
          </label>
        </div>`;

      const spending = ui.card({
        overline: 'Utgiftstrend', title: 'Utgifter per månad', right: `<span>${periodLabel}</span>`,
        body: hasTx
          ? `<div class="chart" id="repSpending"></div>${ui.tableView(['Månad', 'Utgifter'], d.months.map(m => [longLabel(m.key), fmt.money0(m.expense)]))}`
          : ui.empty('Ditt diagram visas här när du har lagt in data.', 'Lägg till en transaktion eller ladda exempeldata för att börja.'),
      });

      const where = ui.card({
        overline: 'Kategorier', title: 'Vart pengarna tog vägen',
        body: d.totalSpent > 0
          ? `<div class="donut-wrap"><div id="repDonut"></div>${charts.donutLegend(d.catItems)}</div>`
          : ui.empty('Inga utgifter under perioden'),
      });

      const cashflow = ui.card({
        overline: 'Kassaflöde', title: 'Inkomster och utgifter',
        right: ui.legend([{ name: 'Inkomster', color: COLORS.income }, { name: 'Utgifter', color: COLORS.expense }]),
        body: hasTx
          ? `<div class="chart" id="repCashflow"></div>${ui.tableView(['Månad', 'Inkomster', 'Utgifter'], d.months.map(m => [longLabel(m.key), fmt.money0(m.income), fmt.money0(m.expense)]))}`
          : ui.empty('Inget kassaflöde ännu'),
      });

      const savings = ui.card({
        overline: 'Sparande', title: 'Sparandets utveckling',
        right: `<span class="amount rep-head-amount">${fmt.money(calc.totalSaved())}</span>`,
        body: d.savingsCum[d.savingsCum.length - 1] > 0
          ? `<div class="chart" id="repSavings"></div><p class="muted" style="margin-top:8px">Ackumulerade insättningar i dina sparkategorier under perioden.</p>`
          : ui.empty('Inget sparande registrerat', 'Utgifter i dina sparkategorier visas här.'),
      });

      const position = ui.card({
        overline: 'Skulder & nettoförmögenhet', title: 'Position över tid',
        body: `
          <p class="overline rep-sub">Skuldminskning</p>
          ${d.payments.length ? '' : `<p class="muted">Skuldhistoriken visas när du har registrerat betalningar på dina skulder.</p>`}
          <div class="grid-2 rep-mini">
            ${ui.stat({ label: 'Betald amortering', value: fmt.money(principal) })}
            ${ui.stat({ label: 'Betald ränta', value: fmt.money(0), hint: 'Räntan registreras inte separat' })}
          </div>
          <p class="overline rep-sub">Nettoförmögenhet</p>
          ${d.nwValues.length ? '<div class="chart" id="repNetWorth"></div>' : ui.empty('Ingen historik ännu', 'Spara en ögonblicksbild under Nettoförmögenhet.')}`,
      });

      const monthly = ui.card({
        overline: 'Betalningshistorik', title: 'Total månadsbetalning',
        body: sum(d.payByMonth) > 0
          ? `<div class="chart" id="repPayments"></div>`
          : ui.empty('Ditt diagram visas här när du har lagt in data.', 'Registrera en betalning under Skuldavbetalning för att börja.'),
      });

      return `${select}${spending}<div class="grid-2">${where}${cashflow}</div><div class="grid-2">${savings}${position}</div>${monthly}`;
    },

    mount(root, s) {
      const d = data(s);
      root.querySelector('#repPeriod').addEventListener('change', e => { period = e.target.value; App.render(); });
      const labels = d.keys.map(label);
      const tips = d.keys.map(longLabel);
      charts.bars(root.querySelector('#repSpending'), {
        label: 'Utgifter per månad', labels, tooltipLabels: tips, wide: true,
        series: [{ name: 'Utgifter', color: COLORS.expense, values: d.months.map(m => m.expense) }],
      });
      charts.donut(root.querySelector('#repDonut'), {
        items: d.catItems, center: { label: 'Totalt', value: fmt.money0(d.totalSpent) }, size: 180, label: 'Utgifter per kategori',
      });
      charts.bars(root.querySelector('#repCashflow'), {
        label: 'Inkomster och utgifter', labels, tooltipLabels: tips, height: 220,
        series: [
          { name: 'Inkomster', color: COLORS.income, values: d.months.map(m => m.income) },
          { name: 'Utgifter', color: COLORS.expense, values: d.months.map(m => m.expense) },
        ],
      });
      charts.bars(root.querySelector('#repSavings'), {
        label: 'Ackumulerat sparande', labels, tooltipLabels: tips, wide: true, height: 220,
        series: [{ name: 'Sparat', color: COLORS.dark, values: d.savingsCum }],
      });
      charts.bars(root.querySelector('#repNetWorth'), {
        label: 'Nettoförmögenhet', labels: d.nwLabels, wide: true, height: 160, plotBg: 'var(--plot-bg)',
        series: [{ name: 'Nettoförmögenhet', color: COLORS.dark, values: d.nwValues }],
      });
      charts.bars(root.querySelector('#repPayments'), {
        label: 'Skuldbetalningar per månad', labels, tooltipLabels: tips, wide: true,
        series: [{ name: 'Betalt', color: COLORS.dark, values: d.payByMonth }],
      });
    },
  });
})();
