// Nettoförmögenhet – tillgångar minus skulder, månad för månad.
(() => {
  const { fmt, calc, ui, charts, esc, ym, today } = App;

  // Historik räknas fram från konton och skulder vid slutet av varje budgetperiod.
  function history() {
    return calc.netWorthSeries(calc.historyKeys(12)).map(r => ({ month: r.key, value: r.value }));
  }
  const shortLabel = key => `${fmt.monthShort(Number(key.slice(5)) - 1)} ${key.slice(2, 4)}`;

  App.page({
    id: 'nettoformogenhet',
    title: 'Nettoförmögenhet',
    overline: 'Nettoförmögenhet',
    icon: 'chart',

    render(s) {
      const nw = calc.netWorth();
      const assets = calc.assets();
      const liab = calc.totalDebt();
      const rows = history();
      const cur = App.period.current();
      const scale = Math.max(assets, liab, 1);

      const hero = `<section class="nw-hero">
        <p class="overline">Aktuell nettoförmögenhet</p>
        <p class="nw-hero-value">${fmt.money(nw)}</p>
        <p class="nw-hero-sub">Totala tillgångar minus totala skulder</p>
        <div class="chart" id="nwHeroChart"></div>
      </section>`;

      const historyCard = ui.card({
        overline: 'Historik', title: 'Nettoförmögenhet över tid',
        right: `<span>${rows.length} ${rows.length === 1 ? 'månad' : 'månader'}</span>`,
        body: `<div class="chart" id="nwChart"></div>
          <ul class="rows nw-list">${rows.slice().reverse().map(r => `
            <li><span style="flex:1">${fmt.cap(fmt.month(r.month))}${r.month === cur ? ' <span class="muted">(aktuellt)</span>' : ''}</span><b>${fmt.money(r.value)}</b></li>`).join('')}</ul>`,
      });

      const accs = calc.accounts();
      const assetRows = accs.filter(a => a.balance > 0);
      const liabRows = [
        ...calc.debts().filter(d => d.balance > 0).map(d => ({ name: d.name, value: d.balance })),
        ...accs.filter(a => a.balance < 0).map(a => ({ name: a.name, value: -a.balance })),
      ];

      const assetsCard = ui.card({
        overline: 'Det du äger', title: 'Tillgångar',
        right: `<b class="amount nw-sum">${fmt.money(assets)}</b>`,
        body: `<div class="nw-bar"><span style="width:${(assets / scale) * 100}%;background:var(--dark)"></span></div>
          ${assetRows.length ? `<ul class="rows">${assetRows.map(a => `<li><span style="flex:1">${esc(a.name)}</span><b>${fmt.money(a.balance)}</b></li>`).join('')}</ul>` : '<p class="muted">Inga konton med positivt saldo.</p>'}`,
      });
      const liabCard = ui.card({
        overline: 'Det du är skyldig', title: 'Skulder',
        right: `<b class="amount nw-sum">${fmt.money(liab)}</b>`,
        body: `<div class="nw-bar"><span style="width:${(liab / scale) * 100}%;background:var(--caramel)"></span></div>
          ${liabRows.length ? `<ul class="rows">${liabRows.map(l => `<li><span style="flex:1">${esc(l.name)}</span><b>${fmt.money(l.value)}</b></li>`).join('')}</ul>` : '<p class="muted">Inga skulder. Snyggt!</p>'}`,
      });

      return `${ui.note('<b>Räknas fram automatiskt</b>Historiken räknas ut från dina konton och skulder vid slutet av varje budgetmånad. Du behöver inte spara något själv.')}
        ${hero}${historyCard}<div class="grid-2">${assetsCard}${liabCard}</div>`;
    },

    mount(root) {
      const rows = history();
      const labels = rows.map(r => shortLabel(r.month));
      const tooltipLabels = rows.map(r => fmt.cap(fmt.month(r.month)));
      const values = rows.map(r => Math.max(0, r.value));

      charts.bars(root.querySelector('#nwHeroChart'), {
        label: 'Nettoförmögenhet per månad', labels, tooltipLabels, wide: true, onDark: true, highlightLast: true, height: 170,
        series: [{ name: 'Nettoförmögenhet', color: '#b9a48c', highlight: '#fffaf2', values }],
      });
      charts.bars(root.querySelector('#nwChart'), {
        label: 'Nettoförmögenhet över tid', labels, tooltipLabels, wide: true, plotBg: 'var(--plot-bg)',
        series: [{ name: 'Nettoförmögenhet', color: 'var(--dark)', values }],
      });

    },
  });
})();
