// Lönplanering – fördela varje lön med avsikt. Använder samma budget som Månadsbudget:
// en ändring här ändrar månadens budget, och utfallet räknas från transaktionerna.
(() => {
  const { fmt, calc, ui, charts, esc, sum, COLORS } = App;
  let offset = 0; // 0 = innevarande period, -1 = förra, +1 = nästa
  const keyOf = () => App.addMonths(App.period.current(), offset);

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
      const key = keyOf();
      const r = App.period.range(key);
      const plan = calc.planned(key);
      const income = calc.plannedIncome(key);
      const allocated = calc.plannedTotal(key);
      const totals = calc.monthTotals(key);
      const left = income - allocated;

      return `
        ${ui.card({
          overline: 'Per period',
          title: 'Fördela lönen',
          body: `
            <p class="muted pay-intro">Fördela periodens förväntade inkomst. Beloppen är samma som i Månadsbudget, och utfallet räknas från dina transaktioner.</p>
            <div class="pay-period">
              <button class="btn btn-small" data-move="-1" aria-label="Förra perioden">←</button>
              <div><b>${fmt.cap(fmt.month(key))}</b><p class="muted">${fmt.date(r.start)} – ${fmt.date(r.end)}</p></div>
              <button class="btn btn-small" data-move="1" aria-label="Nästa period">→</button>
            </div>
            <div class="pay-fields">
              ${s.incomeCategories.map(c => ui.field(`Förväntad inkomst: ${esc(c.name)}`, ui.moneyInput(`class="pay-alloc-input" data-cat="${esc(c.name)}" min="0" value="${Number(plan[c.name]) || 0}"`))).join('')}
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
                ui.moneyInput(`class="pay-alloc-input" data-cat="${esc(c.name)}" min="0" value="${Number(plan[c.name]) || 0}"`))).join('')}
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
      const key = keyOf();
      const plan = calc.planned(key);
      const actual = calc.byCategory(calc.txInMonth(key));
      charts.bars(root.querySelector('#payChart'), {
        label: 'Fördelat och faktiskt per kategori',
        labels: shortLabels(root.querySelector('#payChart'), s.categories.map(c => c.name)),
        tooltipLabels: s.categories.map(c => c.name),
        wide: true,
        height: 260,
        series: [
          { name: 'Planerat', color: COLORS.planned, values: s.categories.map(c => Number(plan[c.name]) || 0) },
          { name: 'Faktiskt', color: COLORS.actual, values: s.categories.map(c => actual[c.name] || 0) },
        ],
      });

      root.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => { offset += Number(b.dataset.move); App.render(); }));
      // Samma budget som Månadsbudget: första ändringen kopierar standardbudgeten till perioden
      root.querySelectorAll('.pay-alloc-input').forEach(input => {
        input.addEventListener('change', () => {
          const value = Math.max(0, Number(input.value) || 0);
          App.update(st => {
            if (!st.budgets[key]) st.budgets[key] = { ...calc.planned(key) };
            st.budgets[key][input.dataset.cat] = value;
          });
        });
      });
    },
  });
})();
