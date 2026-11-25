// Sparprognos – följ hur sparandet kan växa över tid.
(() => {
  const { fmt, ui, charts, COLORS } = App;

  // Månatlig ränta på ränta. Returnerar saldot vid varje årsskifte (år 0..years).
  function project({ start, monthly, years, rate }) {
    const r = (Number(rate) || 0) / 100 / 12;
    let bal = Number(start) || 0;
    const perYear = [bal];
    for (let y = 1; y <= years; y++) {
      for (let m = 0; m < 12; m++) bal = bal * (1 + r) + (Number(monthly) || 0);
      perYear.push(bal);
    }
    const contributions = (Number(start) || 0) + (Number(monthly) || 0) * 12 * years;
    return { perYear, balance: bal, contributions, growth: bal - contributions };
  }

  const FIELDS = [
    { key: 'start', label: 'Startsaldo', money: true },
    { key: 'monthly', label: 'Månadssparande', money: true },
    { key: 'years', label: 'Antal år', min: 1, max: 60 },
    { key: 'rate', label: 'Årlig avkastning (%)', step: '0.1' },
  ];

  App.page({
    id: 'sparprognos',
    title: 'Sparprognos',
    overline: 'Sparprognos',
    heading: 'Sparprognos',
    icon: 'trend',

    render(s) {
      const f = s.forecast;
      const years = Math.max(1, Math.min(60, Math.round(Number(f.years) || 1)));
      const res = project({ ...f, years });
      return ui.card({
        overline: 'Ditt nästa kapitel',
        title: 'Så kan sparandet växa',
        body: `
          <div class="fc-fields">
            ${FIELDS.map(x => ui.field(x.label, x.money
              ? ui.moneyInput(`class="fc-input" data-key="${x.key}" min="0" value="${Number(f[x.key]) || 0}"`)
              : `<input type="number" class="fc-input" data-key="${x.key}" inputmode="decimal" step="${x.step || '1'}" ${x.min ? `min="${x.min}"` : ''} ${x.max ? `max="${x.max}"` : ''} value="${Number(f[x.key]) || 0}">`)).join('')}
          </div>
          ${ui.strip([
            { label: 'Beräknat saldo', value: fmt.money(res.balance) },
            { label: 'Totalt insatt', value: fmt.money(res.contributions) },
            { label: 'Beräknad tillväxt', value: fmt.money(res.growth) },
          ])}
          <div class="fc-chart-head">${ui.legend([{ name: 'Beräknat saldo', color: COLORS.dark }])}</div>
          <div class="chart" id="fcChart"></div>
          ${ui.tableView(['År', 'Saldo'], res.perYear.map((v, i) => [`År ${i}`, fmt.money0(v)]))}
          <p class="muted fc-foot">En förenklad uppskattning med månatlig ränta på ränta. Avkastning är aldrig garanterad.</p>`,
      });
    },

    mount(root, s) {
      const f = s.forecast;
      const years = Math.max(1, Math.min(60, Math.round(Number(f.years) || 1)));
      const res = project({ ...f, years });
      charts.bars(root.querySelector('#fcChart'), {
        label: 'Beräknat saldo per år',
        labels: res.perYear.map((_, i) => String(i)),
        tooltipLabels: res.perYear.map((_, i) => `År ${i}`),
        series: [{ name: 'Beräknat saldo', color: COLORS.dark, values: res.perYear }],
      });
      root.querySelectorAll('.fc-input').forEach(input => {
        input.addEventListener('change', () => {
          let v = Number(input.value) || 0;
          if (input.dataset.key === 'years') v = Math.max(1, Math.min(60, Math.round(v)));
          else if (input.dataset.key !== 'rate') v = Math.max(0, v);
          App.update(st => { st.forecast[input.dataset.key] = v; });
        });
      });
    },
  });
})();
