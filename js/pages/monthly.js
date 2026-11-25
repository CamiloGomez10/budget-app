// Månadsbudget – organisera inkomster och utgifter månad för månad.
// Tabellen är uppdelad per huvudkategori (Inkomster först). Inom varje
// huvudkategori sorteras underkategorierna efter budgetbelopp, störst först.
(() => {
  const { fmt, calc, ui, charts, esc, sum, pad2, COLORS } = App;
  // Startar på aktuell budgetperiod (lönemånad eller kalendermånad). Sätts först när
  // datan är inläst, eftersom inställningen avgör vilken period som gäller idag.
  let year = null;
  let month = null;
  const init = () => {
    if (year !== null) return;
    const k = App.period.current();
    year = Number(k.slice(0, 4));
    month = Number(k.slice(5)) - 1;
  };
  const keyOf = () => { init(); return `${year}-${pad2(month + 1)}`; };

  // Skillnad: för inkomster är mer än planerat bra, för utgifter är mindre bra
  const diffOf = (kind, planned, actual) => (kind === 'income' ? actual - planned : planned - actual);

  function rowHTML(r, kind) {
    const share = r.planned > 0 ? r.actual / r.planned : 0;
    const diff = diffOf(kind, r.planned, r.actual);
    const color = kind === 'income' ? 'var(--dark)' : r.color;
    return `<tr class="mon-row">
      <td>
        <b>${esc(r.name)}</b>
        <p class="muted">${fmt.money(r.actual)} av ${fmt.money(r.planned)}${r.planned > 0 ? ` · ${fmt.pct(share)}` : ''}</p>
        ${ui.progress(share, color)}
      </td>
      <td>${ui.moneyInput(`class="mon-input" data-cat="${esc(r.name)}" min="0" value="${r.planned || 0}" aria-label="Planerat för ${esc(r.name)}"`)}</td>
      <td class="mon-num">${fmt.money(r.actual)}</td>
      <td class="mon-num"><b class="${diff < 0 ? 'neg' : ''}">${fmt.money(diff)}</b></td>
    </tr>`;
  }

  function groupHTML(g) {
    const planned = sum(g.items.map(r => r.planned));
    const actual = sum(g.items.map(r => r.actual));
    const diff = diffOf(g.kind, planned, actual);
    return `<tbody class="mon-group ${g.kind === 'income' ? 'mon-group-income' : ''}">
      <tr class="mon-group-head">
        <th scope="rowgroup">${esc(g.name)} <span class="mon-count">${g.items.length}</span></th>
        <td class="mon-num">${fmt.money(planned)}</td>
        <td class="mon-num">${fmt.money(actual)}</td>
        <td class="mon-num"><span class="${diff < 0 ? 'neg' : ''}">${fmt.money(diff)}</span></td>
      </tr>
      ${g.items.map(r => rowHTML(r, g.kind)).join('')}
    </tbody>`;
  }

  App.page({
    id: 'manadsbudget',
    title: 'Månadsbudget',
    overline: 'Månadsbudget',
    heading: 'Månadsbudget',
    icon: 'calendar',

    render(s) {
      const key = keyOf();
      const groups = calc.grouped(key);
      const expenseGroups = groups.filter(g => g.kind === 'expense');
      const income = groups.find(g => g.kind === 'income');
      const incPlanned = income ? sum(income.items.map(r => r.planned)) : 0;
      const incActual = income ? sum(income.items.map(r => r.actual)) : 0;
      const expPlanned = sum(expenseGroups.flatMap(g => g.items.map(r => r.planned)));
      const expActual = sum(expenseGroups.flatMap(g => g.items.map(r => r.actual)));

      const table = `
        <div class="mon-table-wrap">
          <table class="mon-table">
            <thead><tr><th>Kategori</th><th>Planerat</th><th>Faktiskt</th><th>Skillnad</th></tr></thead>
            ${groups.map(groupHTML).join('')}
            <tfoot>
              <tr><td>Inkomster</td><td class="mon-num">${fmt.money(incPlanned)}</td><td class="mon-num">${fmt.money(incActual)}</td><td></td></tr>
              <tr><td>Utgifter</td><td class="mon-num">${fmt.money(expPlanned)}</td><td class="mon-num">${fmt.money(expActual)}</td><td class="mon-num"><b class="${expPlanned - expActual < 0 ? 'neg' : ''}">${fmt.money(expPlanned - expActual)}</b></td></tr>
              <tr class="mon-total"><td><b>Kvar efter utgifter</b></td><td class="mon-num"><b>${fmt.money(incPlanned - expPlanned)}</b></td><td class="mon-num"><b class="${incActual - expActual < 0 ? 'neg' : ''}">${fmt.money(incActual - expActual)}</b></td><td></td></tr>
            </tfoot>
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
          body: `<div class="chart" id="monChart"></div>
            ${ui.tableView(['Huvudkategori', 'Planerat', 'Faktiskt'], expenseGroups.map(g => [esc(g.name), fmt.money0(sum(g.items.map(r => r.planned))), fmt.money0(sum(g.items.map(r => r.actual)))]))}`,
        })}
        ${ui.card({
          overline: 'Månadsplan',
          title: `Budget för ${fmt.monthName(month)}${App.period.isPayday() ? ` <span class="muted" style="font-family:var(--sans);font-size:13px">${App.period.rangeLabel(key)}</span>` : ''}`,
          right: s.budgets[key] ? '' : '<span>Använder standardbudgeten tills du ändrar något</span>',
          body: table,
        })}`;
    },

    mount(root) {
      // Diagrammet visar huvudkategorierna för utgifter (underkategorierna syns i tabellen)
      const groups = calc.grouped(keyOf()).filter(g => g.kind === 'expense');
      charts.bars(root.querySelector('#monChart'), {
        label: 'Planerat och faktiskt per huvudkategori',
        labels: groups.map(g => g.name),
        wide: true,
        series: [
          { name: 'Planerat', color: COLORS.planned, values: groups.map(g => sum(g.items.map(r => r.planned))) },
          { name: 'Faktiskt', color: COLORS.actual, values: groups.map(g => sum(g.items.map(r => r.actual))) },
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
