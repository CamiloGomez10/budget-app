// 50/30/20-planering – dela upp inkomsten i behov, nöje och framtid.
(() => {
  const { fmt, calc, ui, charts, esc, sum, ym, today } = App;

  const GROUPS = [
    { id: 'needs',  label: 'Behov',              color: '#9a4a22', def: 50 },
    { id: 'wants',  label: 'Nöje',               color: '#00897a', def: 30 },
    { id: 'future', label: 'Framtid & sparande', color: '#d08a1c', def: 20 },
  ];

  function split(s) {
    const sp = (s.settings && s.settings.split) || {};
    return Object.fromEntries(GROUPS.map(g => [g.id, Number.isFinite(Number(sp[g.id])) ? Number(sp[g.id]) : g.def]));
  }

  function compute(s) {
    const key = App.period.current();
    const income = calc.monthTotals(key).income || calc.plannedIncome(key);
    const byCat = calc.byCategory(calc.txInMonth(key));
    const actual = { needs: 0, wants: 0, future: 0 };
    for (const [name, amount] of Object.entries(byCat)) {
      const c = s.categories.find(x => x.name === name);
      const g = c && actual[c.group] !== undefined ? c.group : 'needs';
      actual[g] += amount;
    }
    const sp = split(s);
    return GROUPS.map(g => {
      const target = income * sp[g.id] / 100;
      return { ...g, pct: sp[g.id], target, actual: actual[g.id], share: income > 0 ? actual[g.id] / income : 0 };
    });
  }

  App.page({
    id: '503020',
    title: '50/30/20-planering',
    overline: '50/30/20',
    icon: 'target',

    render(s) {
      const key = App.period.current();
      const actualIncome = calc.monthTotals(key).income;
      const income = actualIncome || calc.plannedIncome(key);
      const groups = compute(s);
      const allocated = sum(groups.map(g => g.actual));
      const pctSum = sum(groups.map(g => g.pct));

      const balance = ui.card({
        overline: 'Mål mot utfall',
        title: 'Din 50/30/20-balans',
        right: `<span>${fmt.cap(fmt.month(key))}</span>`,
        body: allocated > 0
          ? `<div class="donut-wrap"><div id="p5Donut"></div>
              <ul class="cat-list">${groups.map(g => `<li><span class="swatch" style="background:${g.color}"></span><span class="name">${g.label}</span><span class="pct">${fmt.pct(allocated > 0 ? g.actual / allocated : 0)}</span></li>`).join('')}</ul>
            </div>`
          : ui.empty('Inga utgifter ännu', 'När du registrerar utgifter den här månaden visas fördelningen här.'),
      });

      const warn = pctSum !== 100
        ? ui.note(`<b>Procentsatserna blir ${fmt.num(pctSum)} % tillsammans.</b>Justera dem så att summan blir 100 %.`)
        : '';
      const noIncome = income <= 0
        ? ui.note('<b>Ingen inkomst den här månaden.</b>Målen räknas fram från månadens inkomster, eller från den budgeterade inkomsten om inget kommit in än.')
        : actualIncome <= 0 ? ui.note('<b>Ingen inkomst registrerad än.</b>Målen räknas från den budgeterade inkomsten tills lönen kommer in.') : '';

      const cards = `<div class="grid-3">${groups.map(g => `
        <section class="card p5-card">
          <p class="p5-title">${esc(g.label)}</p>
          <div class="p5-ring" id="p5Ring-${g.id}"></div>
          <div class="p5-box">
            <div><span>Mål</span><b>${fmt.money(g.target)}</b></div>
            <div><span>Utfall</span><b>${fmt.money(g.actual)}</b></div>
            <p class="p5-diff">${g.target - g.actual >= 0 ? 'Kvar' : 'Över'}: <b>${fmt.money(Math.abs(g.target - g.actual))}</b></p>
          </div>
          ${ui.field('Målprocent', `<span class="p5-pct"><input type="number" min="0" max="100" step="1" inputmode="numeric" data-group="${g.id}" value="${g.pct}"><span>%</span></span>`)}
          <p class="p5-foot"><span>Mål</span><b>${fmt.money(g.target)}</b></p>
        </section>`).join('')}</div>`;

      return `${balance}${noIncome}${warn}${cards}
        <p class="muted">Kategorierna delas in efter grupp: ${GROUPS.map(g => `<b>${g.label}</b> (${s.categories.filter(c => c.group === g.id).map(c => esc(c.name)).join(', ') || '–'})`).join(' · ')}. Grupperna ändras under Inställningar.</p>`;
    },

    mount(root, s) {
      const groups = compute(s);
      const allocated = sum(groups.map(g => g.actual));
      charts.donut(root.querySelector('#p5Donut'), {
        items: groups.map(g => ({ name: g.label, color: g.color, value: g.actual })),
        center: { label: 'Fördelat', value: fmt.money0(allocated) },
        size: 190, label: 'Utgifter per grupp',
      });
      groups.forEach(g => {
        charts.ring(root.querySelector(`#p5Ring-${g.id}`), {
          share: g.share, size: 150, color: g.color,
          center: { value: fmt.pct(g.share), label: 'av inkomsten' },
        });
      });
      root.querySelectorAll('input[data-group]').forEach(inp => {
        inp.addEventListener('change', () => {
          const v = App.clamp(Math.round(Number(inp.value) || 0), 0, 100);
          App.update(st => { st.settings.split = { ...split(st), [inp.dataset.group]: v }; });
        });
      });
    },
  });
})();
