// Årsbudget – planera hela året med tydlighet.
(() => {
  const { fmt, calc, ui, charts, sum, today, COLORS } = App;
  let year = today().getFullYear();
  const ACCENTS = ['var(--dark)', 'var(--rose)', 'var(--caramel)', '#7f6348'];

  App.page({
    id: 'arsbudget',
    title: 'Årsbudget',
    overline: 'Årsbudget',
    heading: 'Årsbudget',
    icon: 'bars',

    render() {
      const months = calc.yearMonths(year);
      const planned = sum(months.map(m => m.planned));
      const spent = sum(months.map(m => m.expense));

      const cards = months.map((m, i) => {
        const remaining = m.planned - m.expense;
        const over = m.expense > m.planned;
        return `<article class="ann-month" style="--ann-accent:${ACCENTS[i % ACCENTS.length]}">
          <div class="ann-month-head">
            <h3 class="serif">${fmt.cap(fmt.monthName(i))}</h3>
            ${over ? ui.pill('Över', 'warn') : ui.pill('I fas', 'dark')}
          </div>
          <p class="ann-amount amount ${over ? 'neg' : ''}">${fmt.money(remaining)}</p>
          <p class="muted">${over ? 'över budget' : 'kvar att använda'}</p>
          <div class="ann-divider"></div>
          <div class="ann-figs">
            <div><p class="stat-label">Planerad budget</p><p class="ann-fig">${fmt.money(m.planned)}</p></div>
            <div><p class="stat-label">Faktiska utgifter</p><p class="ann-fig">${fmt.money(m.expense)}</p></div>
          </div>
          ${ui.progress(m.planned > 0 ? m.expense / m.planned : 0, over ? 'var(--rose)' : 'var(--dark)')}
        </article>`;
      }).join('');

      return `
        <div class="ann-toolbar">
          ${ui.field('År', `<select id="annYear">${ui.yearOptions(year)}</select>`)}
        </div>
        <div class="grid-3">
          ${ui.stat({ label: 'Planerat för året', value: fmt.money(planned), accent: 'var(--dark)' })}
          ${ui.stat({ label: 'Använt hittills', value: fmt.money(spent), accent: 'var(--rose)' })}
          ${ui.stat({ label: 'Kvar för året', value: fmt.money(planned - spent), accent: 'var(--caramel)' })}
        </div>
        ${ui.card({
          overline: `Plan ${year}`,
          title: 'Planerat mot faktiskt',
          right: `<span>12 månader</span>${ui.legend([{ name: 'Planerat', color: COLORS.planned }, { name: 'Faktiskt', color: COLORS.actual }])}`,
          body: `<div class="chart" id="annChart"></div>
            ${ui.tableView(['Månad', 'Planerat', 'Faktiskt', 'Kvar'], months.map(m => [fmt.cap(fmt.monthName(m.index)), fmt.money0(m.planned), fmt.money0(m.expense), fmt.money0(m.planned - m.expense)]))}`,
        })}
        <div class="ann-grid">${cards}</div>`;
    },

    mount(root) {
      const months = calc.yearMonths(year);
      charts.bars(root.querySelector('#annChart'), {
        label: 'Planerad budget och faktiska utgifter per månad',
        labels: months.map(m => fmt.monthShort(m.index)),
        tooltipLabels: months.map(m => fmt.cap(fmt.monthName(m.index))),
        series: [
          { name: 'Planerat', color: COLORS.planned, values: months.map(m => m.planned) },
          { name: 'Faktiskt', color: COLORS.actual, values: months.map(m => m.expense) },
        ],
      });
      root.querySelector('#annYear').addEventListener('change', e => { year = Number(e.target.value); App.render(); });
    },
  });
})();
