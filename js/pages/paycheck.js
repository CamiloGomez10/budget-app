// Lönplanering – fördela varje lön med avsikt.
(() => {
  const { fmt, calc, ui, charts, esc, sum, COLORS } = App;

  // Korta kategorinamn när diagrammet är smalt så att etiketterna inte krockar
  function shortLabels(el, names) {
    const perLabel = (el ? el.clientWidth : 600) / names.length;
    return perLabel < 72 ? names.map(n => (n.length > 5 ? n.slice(0, 4) + '.' : n)) : names;
  }

  App.page({
    id: 'lon',
    title: 'Lönplanering',
    overline: 'Lönplanering',
    heading: 'Lönplanering',
    icon: 'wallet',

    render(s) {
      const p = s.paycheck;
      const allocated = sum(s.categories.map(c => p.alloc[c.name]));
      const period = calc.txBetween(p.start, p.end);
      const totals = calc.totals(period);
      const left = (Number(p.income) || 0) - allocated;

      return `
        ${ui.card({
          overline: 'Per period',
          title: 'Fördela lönen',
          body: `
            <p class="muted pay-intro">Fördela periodens förväntade inkomst. Faktiska belopp räknas från transaktionerna mellan datumen.</p>
            <div class="pay-fields">
              ${ui.field('Perioden börjar', `<input type="date" class="pay-input" data-key="start" value="${p.start}">`)}
              ${ui.field('Perioden slutar', `<input type="date" class="pay-input" data-key="end" value="${p.end}">`)}
              ${ui.field('Förväntad inkomst', ui.moneyInput(`class="pay-input" data-key="income" min="0" value="${Number(p.income) || 0}"`))}
            </div>
            <div class="pay-summary">
              <div><p class="stat-label">Fördelat</p><p class="strip-value">${fmt.money(allocated)}</p></div>
              <div><p class="stat-label">Kvar att fördela</p><p class="strip-value ${left < 0 ? 'neg' : ''}">${fmt.money(left)}</p></div>
              <div><p class="stat-label">Faktiska utgifter</p><p class="strip-value">${fmt.money(totals.expense)}</p></div>
              <div class="pay-income"><p class="stat-label">Inkomst i perioden</p><p class="strip-value">${fmt.money(totals.income)}</p></div>
            </div>`,
        })}
        <div class="grid-2">
          ${ui.card({
            overline: 'Fördelning',
            title: 'Per kategori',
            body: `<div class="pay-alloc">
              ${s.categories.map(c => ui.field(`<span class="swatch" style="background:${c.color}"></span> ${esc(c.name)}`,
                ui.moneyInput(`class="pay-alloc-input" data-cat="${esc(c.name)}" min="0" value="${Number(p.alloc[c.name]) || 0}"`))).join('')}
            </div>`,
          })}
          ${ui.card({
            overline: 'Utfall per kategori',
            title: 'Planerat mot faktiskt',
            right: ui.legend([{ name: 'Planerat', color: COLORS.planned }, { name: 'Faktiskt', color: COLORS.actual }]),
            body: '<div class="chart" id="payChart"></div>',
          })}
        </div>`;
    },

    mount(root, s) {
      const p = s.paycheck;
      const actual = calc.byCategory(calc.txBetween(p.start, p.end));
      charts.bars(root.querySelector('#payChart'), {
        label: 'Fördelat och faktiskt per kategori',
        labels: shortLabels(root.querySelector('#payChart'), s.categories.map(c => c.name)),
        tooltipLabels: s.categories.map(c => c.name),
        wide: true,
        height: 260,
        series: [
          { name: 'Planerat', color: COLORS.planned, values: s.categories.map(c => Number(p.alloc[c.name]) || 0) },
          { name: 'Faktiskt', color: COLORS.actual, values: s.categories.map(c => actual[c.name] || 0) },
        ],
      });

      root.querySelectorAll('.pay-input').forEach(input => {
        input.addEventListener('change', () => {
          const k = input.dataset.key;
          App.update(st => { st.paycheck[k] = k === 'income' ? Math.max(0, Number(input.value) || 0) : input.value; });
        });
      });
      root.querySelectorAll('.pay-alloc-input').forEach(input => {
        input.addEventListener('change', () => {
          App.update(st => { st.paycheck.alloc[input.dataset.cat] = Math.max(0, Number(input.value) || 0); });
        });
      });
    },
  });
})();
