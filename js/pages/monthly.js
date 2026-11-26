// Budget › Månad – fördela periodens inkomst och följ utfallet. Samlar det som förut
// var Månadsbudget, Lönplanering och 50/30/20: allt läser och skriver samma budget.
// Tabellen är uppdelad per huvudkategori (Inkomster först). Inom varje huvudkategori
// visas underkategorierna i den ordning du väljer med pilarna.
(() => {
  const { fmt, calc, ui, charts, esc, sum, COLORS } = App;
  let offset = 0; // 0 = innevarande period, -1 = förra, +1 = nästa
  const keyOf = () => App.addMonths(App.period.current(), offset);

  // ---------- 50/30/20 ----------
  const SPLIT = [
    { id: 'needs', label: 'Behov', color: '#9a4a22', def: 50 },
    { id: 'wants', label: 'Nöje', color: '#00897a', def: 30 },
    { id: 'future', label: 'Framtid & sparande', color: '#d08a1c', def: 20 },
  ];
  function splitPct(s) {
    const sp = (s.settings && s.settings.split) || {};
    return Object.fromEntries(SPLIT.map(g => [g.id, Number.isFinite(Number(sp[g.id])) ? Number(sp[g.id]) : g.def]));
  }
  function splitRows(s, key) {
    const income = calc.monthTotals(key).income || calc.plannedIncome(key);
    const actual = { needs: 0, wants: 0, future: 0 };
    for (const [name, amount] of Object.entries(calc.byCategory(calc.txInMonth(key)))) {
      const c = s.categories.find(x => x.name === name);
      actual[c && actual[c.group] !== undefined ? c.group : 'needs'] += amount;
    }
    const pct = splitPct(s);
    return { income, rows: SPLIT.map(g => ({ ...g, pct: pct[g.id], target: income * pct[g.id] / 100, actual: actual[g.id] })) };
  }

  // Skillnad: för inkomster är mer än planerat bra, för utgifter är mindre bra
  const diffOf = (kind, planned, actual) => (kind === 'income' ? actual - planned : planned - actual);

  function rowHTML(r, kind, key, i, len) {
    const share = r.planned > 0 ? r.actual / r.planned : 0;
    const diff = diffOf(kind, r.planned, r.actual);
    const color = kind === 'income' ? 'var(--dark)' : r.color;
    const shared = kind === 'expense' && calc.isShared(r.name);
    const n = esc(r.name);
    // Delad kategori: hela beloppet + din del + den andras del. Din del räknas i budgeten.
    let planCell = ui.moneyInput(`class="mon-input" data-cat="${n}" min="0" value="${r.planned || 0}" aria-label="Planerat för ${n}"`);
    if (shared) {
      const total = calc.sharedTotal(key, r.name);
      const partner = calc.partnerName();
      planCell = `<div class="mon-share">
        ${ui.moneyInput(`class="mon-total" data-cat="${n}" min="0" value="${total ?? ''}" placeholder="Hela beloppet" aria-label="Hela beloppet för ${n}"`)}
        <div class="mon-share-parts">
          <label><span>Du</span>${ui.moneyInput(`class="mon-mine" data-cat="${n}" value="${r.planned || 0}" aria-label="Din del av ${n}"`)}</label>
          <label><span>${esc(partner)}</span>${ui.moneyInput(`class="mon-partner" data-cat="${n}" value="${total != null ? Math.round((total - r.planned) * 100) / 100 : ''}" aria-label="${esc(partner)}s del av ${n}"`)}</label>
        </div>
      </div>`;
    }
    return `<tr class="mon-row">
      <td>
        <span class="mon-move">
          <button type="button" class="icon-btn" data-cat-move="${n}" data-dir="-1" data-kind="${kind}" ${i === 0 ? 'disabled' : ''} aria-label="Flytta ${n} upp">${ui.icon('up', 12)}</button>
          <button type="button" class="icon-btn" data-cat-move="${n}" data-dir="1" data-kind="${kind}" ${i === len - 1 ? 'disabled' : ''} aria-label="Flytta ${n} ner">${ui.icon('down', 12)}</button>
        </span>
        <b>${n}</b>${shared ? ` ${ui.pill('Delad', 'soft')}` : ''}
        <p class="muted">${fmt.money(r.actual)} av ${fmt.money(r.planned)}${r.planned > 0 ? ` · ${fmt.pct(share)}` : ''}</p>
        ${ui.progress(share, color)}
      </td>
      <td>${planCell}</td>
      <td class="mon-num">${fmt.money(r.actual)}</td>
      <td class="mon-num"><b class="${diff < 0 ? 'neg' : ''}">${fmt.money(diff)}</b></td>
    </tr>`;
  }

  function groupHTML(g, key) {
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
      ${g.items.map((r, i) => rowHTML(r, g.kind, key, i, g.items.length)).join('')}
    </tbody>`;
  }

  App.page({
    id: 'manadsbudget',
    group: 'budget',
    tab: 'Månad',
    title: 'Månadsbudget',
    heading: 'Månadsbudget',
    icon: 'calendar',

    render(s) {
      const key = keyOf();
      const r = App.period.range(key);
      const groups = calc.grouped(key);
      const expenseGroups = groups.filter(g => g.kind === 'expense');
      const income = groups.find(g => g.kind === 'income');
      const incPlanned = income ? sum(income.items.map(x => x.planned)) : 0;
      const incActual = income ? sum(income.items.map(x => x.actual)) : 0;
      const expPlanned = sum(expenseGroups.flatMap(g => g.items.map(x => x.planned)));
      const expActual = sum(expenseGroups.flatMap(g => g.items.map(x => x.actual)));
      const toAllocate = incPlanned - expPlanned;

      const head = `<div class="mon-head">
          <div class="pay-period">
            <button class="btn btn-small" data-move="-1" aria-label="Förra perioden">←</button>
            <div><b>${fmt.cap(fmt.month(key))}</b><p class="muted">${fmt.date(r.start)} – ${fmt.date(r.end)}</p></div>
            <button class="btn btn-small" data-move="1" aria-label="Nästa period">→</button>
          </div>
          ${offset !== 0 ? '<button class="link-btn" data-move="0">Till denna period</button>' : ''}
        </div>
        ${ui.strip([
          { label: 'Förväntad inkomst', value: fmt.money(incPlanned), hint: `Har kommit in: ${fmt.money(incActual)}` },
          { label: 'Kvar att fördela', value: `<span class="${toAllocate < 0 ? 'neg' : ''}">${fmt.money(toAllocate)}</span>`, hint: toAllocate < 0 ? 'Du har budgeterat mer än inkomsten' : toAllocate > 0 ? 'Ge varje krona en uppgift' : 'Hela inkomsten är fördelad' },
          { label: 'Kvar efter utgifter', value: `<span class="${incActual - expActual < 0 ? 'neg' : ''}">${fmt.money(incActual - expActual)}</span>`, hint: `Utgifter hittills: ${fmt.money(expActual)}` },
        ])}`;

      const table = `
        <div class="mon-table-wrap">
          <table class="mon-table">
            <thead><tr><th>Kategori</th><th>Planerat</th><th>Faktiskt</th><th>Skillnad</th></tr></thead>
            ${groups.map(g => groupHTML(g, key)).join('')}
            <tfoot>
              <tr><td>Inkomster</td><td class="mon-num">${fmt.money(incPlanned)}</td><td class="mon-num">${fmt.money(incActual)}</td><td></td></tr>
              <tr><td>Utgifter</td><td class="mon-num">${fmt.money(expPlanned)}</td><td class="mon-num">${fmt.money(expActual)}</td><td class="mon-num"><b class="${expPlanned - expActual < 0 ? 'neg' : ''}">${fmt.money(expPlanned - expActual)}</b></td></tr>
              <tr class="mon-total"><td><b>Kvar efter utgifter</b></td><td class="mon-num"><b>${fmt.money(incPlanned - expPlanned)}</b></td><td class="mon-num"><b class="${incActual - expActual < 0 ? 'neg' : ''}">${fmt.money(incActual - expActual)}</b></td><td></td></tr>
            </tfoot>
          </table>
        </div>`;

      const plan = ui.card({
        overline: 'Fördela inkomsten',
        title: 'Budget per kategori',
        right: (() => {
          const from = calc.plannedFrom(key);
          if (from === key) return '';
          if (!from) return '<span>Ingen budget än. Fyll i beloppen nedan.</span>';
          return `<span>Samma som ${fmt.month(from)} tills du ändrar något</span>`;
        })(),
        body: table,
      });

      const chart = ui.card({
        overline: 'Utfall per huvudkategori',
        title: 'Planerat mot faktiskt',
        right: ui.legend([{ name: 'Planerat', color: COLORS.planned }, { name: 'Faktiskt', color: COLORS.actual }]),
        body: `<div class="chart" id="monChart"></div>
          ${ui.tableView(['Huvudkategori', 'Planerat', 'Faktiskt'], expenseGroups.map(g => [esc(g.name), fmt.money0(sum(g.items.map(x => x.planned))), fmt.money0(sum(g.items.map(x => x.actual)))]))}`,
      });

      const sp = splitRows(s, key);
      const pctSum = sum(sp.rows.map(g => g.pct));
      const split = ui.card({
        overline: '50/30/20',
        title: 'Behov, nöje och framtid',
        body: `<ul class="split-list">${sp.rows.map(g => {
            const share = g.target > 0 ? g.actual / g.target : 0;
            const left = g.target - g.actual;
            return `<li>
              <div class="split-line"><span class="swatch" style="background:${g.color}"></span><b>${esc(g.label)}</b>
                <span class="split-pct"><input type="number" min="0" max="100" step="1" inputmode="numeric" data-group="${g.id}" value="${g.pct}" aria-label="Målprocent för ${esc(g.label)}"> %</span></div>
              ${ui.progress(share, g.color)}
              <p class="muted">${fmt.money(g.actual)} av ${fmt.money(g.target)} · <span class="${left < 0 ? 'neg' : ''}">${left >= 0 ? 'kvar' : 'över'} ${fmt.money(Math.abs(left))}</span></p>
            </li>`;
          }).join('')}</ul>
          ${pctSum !== 100 ? `<p class="neg split-warn">Procenten blir ${fmt.num(pctSum)} % tillsammans. Justera så att summan blir 100 %.</p>` : ''}
          <p class="muted split-help">Räknas på ${calc.monthTotals(key).income ? 'periodens inkomster' : 'den förväntade inkomsten'} (${fmt.money(sp.income)}). Vilken grupp en kategori hör till ändrar du under Inställningar.</p>`,
      });

      return `${head}${plan}<div class="grid-2">${split}${chart}</div>`;
    },

    mount(root, s) {
      const key = keyOf();
      // Diagrammet visar huvudkategorierna för utgifter (underkategorierna syns i tabellen)
      const groups = calc.grouped(key).filter(g => g.kind === 'expense');
      charts.bars(root.querySelector('#monChart'), {
        label: 'Planerat och faktiskt per huvudkategori',
        labels: groups.map(g => g.name),
        wide: true,
        series: [
          { name: 'Planerat', color: COLORS.planned, values: groups.map(g => sum(g.items.map(r => r.planned))) },
          { name: 'Faktiskt', color: COLORS.actual, values: groups.map(g => sum(g.items.map(r => r.actual))) },
        ],
      });
      root.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => {
        const mv = Number(b.dataset.move);
        offset = mv === 0 ? 0 : offset + mv;
        App.render();
      }));
      // Första ändringen i en period kopierar den budget som visas (från en tidigare period)
      // till perioden, även hela beloppen för delade kategorier.
      const ensure = st => {
        const src = calc.plannedFrom(key);
        if (!st.sharedTotals) st.sharedTotals = {};
        if (!st.budgets[key]) {
          st.budgets[key] = { ...calc.planned(key) };
          st.sharedTotals[key] = { ...(src ? st.sharedTotals[src] || {} : {}) };
        }
        if (!st.sharedTotals[key]) st.sharedTotals[key] = {};
      };
      // Ändra ordning på kategorierna
      root.querySelectorAll('[data-cat-move]').forEach(b => b.addEventListener('click', () => {
        App.moveCategory(b.dataset.catMove, Number(b.dataset.dir), b.dataset.kind === 'income');
      }));
      root.querySelectorAll('.mon-input').forEach(input => {
        input.addEventListener('change', () => {
          const value = Math.max(0, Number(input.value) || 0);
          App.update(st => { ensure(st); st.budgets[key][input.dataset.cat] = value; });
        });
      });

      // Delade kategorier: hela beloppet delas 50/50. Ändrar du en del ändras den andra
      // så att summan blir hela beloppet. Sparas när du lämnar fältet.
      const r2 = v => Math.round(v * 100) / 100;
      root.querySelectorAll('.mon-share').forEach(box => {
        const cat = box.querySelector('.mon-total').dataset.cat;
        const total = box.querySelector('.mon-total'), mine = box.querySelector('.mon-mine'), other = box.querySelector('.mon-partner');
        total.addEventListener('input', () => {
          const sp = calc.splitShare(Number(total.value) || 0, 0.5);
          mine.value = sp.mine;
          other.value = sp.partner;
        });
        mine.addEventListener('input', () => { if (total.value !== '') other.value = r2((Number(total.value) || 0) - (Number(mine.value) || 0)); });
        other.addEventListener('input', () => { if (total.value !== '') mine.value = r2((Number(total.value) || 0) - (Number(other.value) || 0)); });
        const commit = () => App.update(st => {
          ensure(st);
          const t = total.value === '' ? null : Math.max(0, r2(Number(total.value) || 0));
          let m = Math.max(0, r2(Number(mine.value) || 0));
          if (t != null) m = Math.min(m, t);
          st.budgets[key][cat] = m;
          if (t == null) delete st.sharedTotals[key][cat]; else st.sharedTotals[key][cat] = t;
        });
        [total, mine, other].forEach(el => el.addEventListener('change', commit));
      });
      root.querySelectorAll('input[data-group]').forEach(inp => {
        inp.addEventListener('change', () => {
          const v = App.clamp(Math.round(Number(inp.value) || 0), 0, 100);
          App.update(st => { st.settings.split = { ...splitPct(st), [inp.dataset.group]: v }; });
        });
      });
    },
  });
})();
