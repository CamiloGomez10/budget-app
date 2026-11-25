// Månadsbudget – organisera inkomster och utgifter månad för månad.
(() => {
  const { fmt, calc, ui, charts, esc, sum, today, pad2, COLORS } = App;
  let year = today().getFullYear();
  let month = today().getMonth();

  const keyOf = () => `${year}-${pad2(month + 1)}`;

  function rows(s) {
    const key = keyOf();
    const planned = calc.planned(key);
    const actual = calc.byCategory(calc.txInMonth(key));
    return s.categories.map(c => ({ ...c, planned: Number(planned[c.name]) || 0, actual: actual[c.name] || 0 }));
  }

  App.page({
    id: 'manadsbudget',
    title: 'Månadsbudget',
    overline: 'Månadsbudget',
    heading: 'Månadsbudget',
    icon: 'calendar',

    render(s) {
      const list = rows(s);
      const monthLabel = fmt.cap(fmt.monthName(month));
      const totalPlanned = sum(list.map(r => r.planned));
      const totalActual = sum(list.map(r => r.actual));

      const table = `
        <div class="mon-table-wrap">
          <table class="mon-table">
            <thead><tr><th>Kategori</th><th>Planerat</th><th>Faktiskt</th><th>Skillnad</th></tr></thead>
            <tbody>
              ${list.map(r => {
                const share = r.planned > 0 ? r.actual / r.planned : 0;
                const diff = r.planned - r.actual;
                return `<tr>
                  <td>
                    <b>${esc(r.name)}</b>
                    <p class="muted">${fmt.money(r.actual)} av ${fmt.money(r.planned)}${r.planned > 0 ? ` · ${fmt.pct(share)}` : ''}</p>
                    ${ui.progress(share, r.color)}
                  </td>
                  <td>${ui.moneyInput(`class="mon-input" data-cat="${esc(r.name)}" min="0" value="${r.planned || 0}" aria-label="Planerat för ${esc(r.name)}"`)}</td>
                  <td class="mon-num">${fmt.money(r.actual)}</td>
                  <td class="mon-num"><b class="${diff < 0 ? 'neg' : ''}">${fmt.money(diff)}</b></td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot><tr>
              <td><b>Totalt</b></td>
              <td class="mon-num"><b>${fmt.money(totalPlanned)}</b></td>
              <td class="mon-num"><b>${fmt.money(totalActual)}</b></td>
              <td class="mon-num"><b class="${totalPlanned - totalActual < 0 ? 'neg' : ''}">${fmt.money(totalPlanned - totalActual)}</b></td>
            </tr></tfoot>
          </table>
        </div>`;

      return `
        <div class="ann-toolbar">
          ${ui.field('År', `<select id="monYear">${ui.yearOptions(year)}</select>`)}
        </div>
        ${ui.card({
          overline: 'Utfall per kategori',
          title: 'Planerat mot faktiskt',
          right: `${ui.legend([{ name: 'Planerat', color: COLORS.planned }, { name: 'Faktiskt', color: COLORS.actual }])}
            <label class="select-pill"><span class="sr-only">Månad</span><select id="monMonth">${ui.monthOptions(month)}</select></label>`,
          body: `<div class="chart" id="monChart"></div>`,
        })}
        ${ui.card({
          overline: 'Månadsplan',
          title: `Budget för ${fmt.monthName(month)}`,
          right: s.budgets[keyOf()] ? '' : '<span>Använder standardbudgeten tills du ändrar något</span>',
          body: table,
        })}`;
    },

    mount(root, s) {
      const list = rows(s);
      charts.bars(root.querySelector('#monChart'), {
        label: 'Planerat och faktiskt per kategori',
        labels: list.map(r => r.name).map((n, _, a) => ((root.querySelector('#monChart').clientWidth || 600) / a.length < 72 && n.length > 5 ? n.slice(0, 4) + '.' : n)),
        tooltipLabels: list.map(r => r.name),
        wide: true,
        series: [
          { name: 'Planerat', color: COLORS.planned, values: list.map(r => r.planned) },
          { name: 'Faktiskt', color: COLORS.actual, values: list.map(r => r.actual) },
        ],
      });
      root.querySelector('#monYear').addEventListener('change', e => { year = Number(e.target.value); App.render(); });
      root.querySelector('#monMonth').addEventListener('change', e => { month = Number(e.target.value); App.render(); });
      root.querySelectorAll('.mon-input').forEach(input => {
        input.addEventListener('change', () => {
          const key = keyOf();
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
