// Budget › Månad – fördela periodens inkomst och följ utfallet. Samlar det som förut
// var Månadsbudget, Lönplanering och 50/30/20: allt läser och skriver samma budget.
// Tabellen är uppdelad per huvudkategori (Inkomster först). Inom varje huvudkategori
// visas underkategorierna i den ordning du väljer genom att dra dem.
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

  const SPLIT_ICON = '<svg class="mon-share-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3v18M5 8l-3 4 3 4M19 8l3 4-3 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const GRIP = '<svg viewBox="0 0 10 16" width="8" height="14" aria-hidden="true"><g fill="currentColor"><circle cx="2" cy="2" r="1.4"/><circle cx="8" cy="2" r="1.4"/><circle cx="2" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="2" cy="14" r="1.4"/><circle cx="8" cy="14" r="1.4"/></g></svg>';

  // Skillnad: för inkomster är mer än planerat bra, för utgifter är mindre bra
  const diffOf = (kind, planned, actual) => (kind === 'income' ? actual - planned : planned - actual);

  function rowHTML(r, kind, key) {
    const share = r.planned > 0 ? r.actual / r.planned : 0;
    const diff = diffOf(kind, r.planned, r.actual);
    const color = kind === 'income' ? 'var(--dark)' : r.color;
    const shared = kind === 'expense' && calc.isShared(r.name);
    const n = esc(r.name);
    // Delad kategori: bara din del syns. Ett tryck öppnar en liten ruta med fördelningen.
    let planCell = ui.moneyInput(`class="mon-input" data-cat="${n}" min="0" value="${r.planned || 0}" aria-label="Planerat för ${n}"`);
    if (shared) {
      planCell = `<button type="button" class="mon-share-btn" data-share="${n}" aria-haspopup="dialog" aria-expanded="false"
          aria-label="Din del av ${n}: ${fmt.money(r.planned || 0)}. Tryck för att ändra fördelningen">
        <span class="mon-share-kr">kr</span><span class="mon-share-val">${fmt.num(r.planned || 0, 2)}</span>${SPLIT_ICON}
      </button>`;
    }
    return `<tr class="mon-row" data-cat="${n}" data-kind="${kind}">
      <td>
        <div class="mon-cat">
          <div class="mon-cat-line">
            <span class="mon-grip" tabindex="0" role="button" aria-label="Flytta ${n}. Dra, eller använd pil upp och pil ner">${GRIP}</span>
            <b>${n}</b>${shared ? ui.pill('Delad', 'soft') : ''}
          </div>
          <p class="muted">${fmt.money(r.actual)} av ${fmt.money(r.planned)}${r.planned > 0 ? ` · ${fmt.pct(share)}` : ''}</p>
          ${ui.progress(share, color)}
        </div>
      </td>
      <td>${planCell}</td>
      <td class="mon-num">${fmt.money(r.actual)}</td>
      <td class="mon-num"><b class="${diff < 0 ? 'neg' : ''}">${fmt.money(diff)}</b></td>
    </tr>`;
  }

  // Ihopfällda huvudkategorier sparas på enheten (bara en visningsinställning)
  const COLLAPSE_KEY = 'budget-collapsed-groups';
  const collapsed = () => { try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || []); } catch (e) { return new Set(); } };
  const saveCollapsed = set => { try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set])); } catch (e) { /* ignorera */ } };
  const CHEVRON = '<svg class="mon-chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function groupHTML(g, key, closed) {
    const planned = sum(g.items.map(r => r.planned));
    const actual = sum(g.items.map(r => r.actual));
    const diff = diffOf(g.kind, planned, actual);
    const sums = `<td class="mon-num">${fmt.money(planned)}</td>
        <td class="mon-num">${fmt.money(actual)}</td>
        <td class="mon-num"><span class="${diff < 0 ? 'neg' : ''}">${fmt.money(diff)}</span></td>`;
    const isClosed = closed.has(g.name);
    // Summan står sist i gruppen. När gruppen är ihopfälld visas den på rubrikraden i stället.
    return `<tbody class="mon-group ${g.kind === 'income' ? 'mon-group-income' : ''} ${isClosed ? 'is-collapsed' : ''}" data-group="${esc(g.name)}">
      <tr class="mon-group-head">
        <th scope="rowgroup">
          <button type="button" class="mon-toggle" aria-expanded="${!isClosed}">${CHEVRON}<span>${esc(g.name)}</span> <span class="mon-count">${g.items.length}</span></button>
        </th>
        ${sums.replace(/class="mon-num"/g, 'class="mon-num mon-head-sum"')}
      </tr>
      ${g.items.map(r => rowHTML(r, g.kind, key)).join('')}
      <tr class="mon-group-foot">
        <td>Totalt ${esc(g.name)}</td>
        ${sums}
      </tr>
    </tbody>`;
  }

  // ---------- Fördelning av en delad kategori (liten ruta bredvid beloppet) ----------
  // Hela beloppet delas 50/50; ändrar du en del ändras den andra så att summan blir
  // hela beloppet. Sparas med Klar, Enter eller klick utanför. Esc stänger utan att spara.
  let pop = null;
  function closeSharePop(save) {
    if (!pop) return;
    const p = pop;
    pop = null;
    p.el.remove();
    p.btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', p.outside, true);
    window.removeEventListener('resize', p.reposition);
    window.removeEventListener('scroll', p.reposition, true);
    if (save) p.save();
    else p.btn.focus();
  }
  function openSharePop(btn, key, ensure) {
    if (pop && pop.btn === btn) { closeSharePop(true); return; }
    closeSharePop(true);
    const cat = btn.dataset.share;
    const partner = calc.partnerName();
    const mine0 = Number(calc.planned(key)[cat]) || 0;
    const total0 = calc.sharedTotal(key, cat);
    const r2 = v => Math.round(v * 100) / 100;
    const el = document.createElement('div');
    el.className = 'mon-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', `Fördelning för ${cat}`);
    el.innerHTML = `
      <p class="mon-pop-title">${esc(cat)} <span>delas med ${esc(partner)}</span></p>
      ${ui.field('Hela beloppet', ui.moneyInput(`class="mon-pop-total" value="${total0 ?? ''}" placeholder="0"`))}
      <div class="mon-pop-parts">
        ${ui.field('Du', ui.moneyInput(`class="mon-pop-mine" value="${mine0}"`))}
        ${ui.field(esc(partner), ui.moneyInput(`class="mon-pop-partner" value="${total0 != null ? r2(total0 - mine0) : ''}"`))}
      </div>
      <p class="muted mon-pop-help">Delas 50/50. Ändrar du en del justeras den andra.</p>
      <div class="mon-pop-actions"><button type="button" class="btn btn-primary btn-small mon-pop-done">Klar</button></div>`;
    document.body.appendChild(el);
    const total = el.querySelector('.mon-pop-total'), mine = el.querySelector('.mon-pop-mine'), other = el.querySelector('.mon-pop-partner');
    total.addEventListener('input', () => {
      const sp = calc.splitShare(Number(total.value) || 0, 0.5);
      mine.value = sp.mine;
      other.value = sp.partner;
    });
    mine.addEventListener('input', () => { if (total.value !== '') other.value = r2((Number(total.value) || 0) - (Number(mine.value) || 0)); });
    other.addEventListener('input', () => { if (total.value !== '') mine.value = r2((Number(total.value) || 0) - (Number(other.value) || 0)); });

    const save = () => {
      const t = total.value === '' ? null : Math.max(0, r2(Number(total.value) || 0));
      let m = Math.max(0, r2(Number(mine.value) || 0));
      if (t != null) m = Math.min(m, t);
      if (m === mine0 && t === total0) return; // inget ändrat
      App.update(st => {
        ensure(st);
        st.budgets[key][cat] = m;
        if (t == null) delete st.sharedTotals[key][cat]; else st.sharedTotals[key][cat] = t;
      });
    };
    // Placera rutan till höger om beloppet, annars till vänster, annars under (mobil)
    const reposition = () => {
      if (!btn.isConnected) { closeSharePop(false); return; } // sidan ritades om
      const r = btn.getBoundingClientRect();
      const w = el.offsetWidth, h = el.offsetHeight, gap = 12;
      let side = 'right', left = r.right + gap, top = r.top + r.height / 2 - h / 2;
      if (left + w > window.innerWidth - 8) { side = 'left'; left = r.left - gap - w; }
      if (left < 8) { side = 'below'; left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8); top = r.bottom + gap; }
      top = Math.min(Math.max(8, top), window.innerHeight - h - 8);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.dataset.side = side;
      // Pilen pekar mot beloppet
      el.style.setProperty('--arrow', side === 'below' ? `${r.left + r.width / 2 - left}px` : `${r.top + r.height / 2 - top}px`);
    };
    const outside = e => { if (!el.contains(e.target) && !btn.contains(e.target)) closeSharePop(true); };
    pop = { el, btn, save, outside, reposition };
    reposition();
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    el.querySelector('.mon-pop-done').addEventListener('click', () => closeSharePop(true));
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); closeSharePop(false); }
      else if (e.key === 'Enter') { e.preventDefault(); closeSharePop(true); }
    });
    (total0 == null ? total : mine).focus();
    (total0 == null ? total : mine).select?.();
  }

  // ---------- Dra och släpp för att ändra ordning ----------
  // Håll ner på en kategoris namn och dra. Med mus börjar det när du rör musen, på
  // mobilen efter att du hållit fingret still en kort stund (annars scrollar sidan).
  // Raden följer med och de andra flyttar sig. Ordningen sparas när du släpper.
  function enableDrag(root) {
    const table = root.querySelector('.mon-table');
    if (!table) return;
    let drag = null; // { row, body, grab, shift }
    const cellsOf = row => [...row.children];
    const setShift = (row, y) => cellsOf(row).forEach(td => { td.style.transform = y ? `translateY(${y}px)` : ''; });

    const position = y => {
      const { row, body } = drag;
      const others = [...body.querySelectorAll('.mon-row')].filter(r => r !== row);
      // Ny plats: efter alla rader vars mitt ligger ovanför pekaren
      const idx = others.filter(r => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 < y; }).length;
      const before = others[idx];
      if (before && row.nextElementSibling !== before) before.before(row);
      else if (!before && others.length && others[others.length - 1].nextElementSibling !== row) others[others.length - 1].after(row);
      // Låt raden följa pekaren
      const natural = row.getBoundingClientRect().top; // raden själv flyttas inte, bara dess celler
      drag.shift = y - drag.grab - natural;
      setShift(row, drag.shift);
      // Scrolla när du drar nära kanten
      if (y < 70) window.scrollBy(0, -12);
      else if (y > window.innerHeight - 70) window.scrollBy(0, 12);
    };

    const finish = commit => {
      if (!drag) return;
      const { row, body, kind } = drag;
      setShift(row, 0);
      row.classList.remove('is-dragging');
      document.body.classList.remove('mon-dragging');
      const names = [...body.querySelectorAll('.mon-row')].map(r => r.dataset.cat);
      drag = null;
      if (commit) App.setCategoryOrder(names, kind === 'income');
    };

    table.addEventListener('pointerdown', e => {
      const cell = e.target.closest('.mon-row > td:first-child');
      if (!cell || e.target.closest('button, input, a') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const row = cell.parentElement;
      const startX = e.clientX, startY = e.clientY;
      const touch = e.pointerType !== 'mouse';
      let started = false, timer = null;
      const begin = () => {
        started = true;
        drag = { row, body: row.parentElement, kind: row.dataset.kind, grab: startY - row.getBoundingClientRect().top, shift: 0 };
        row.classList.add('is-dragging');
        document.body.classList.add('mon-dragging');
        if (touch && navigator.vibrate) navigator.vibrate(10);
      };
      const stop = commit => {
        clearTimeout(timer);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        if (started) finish(commit);
      };
      const move = ev => {
        if (!started) {
          const far = Math.abs(ev.clientY - startY) > 6 || Math.abs(ev.clientX - startX) > 6;
          if (!far) return;
          if (touch) { stop(false); return; } // fingret rörde sig innan det höll still: det är scroll
          begin();
        }
        ev.preventDefault();
        position(ev.clientY);
      };
      const up = () => stop(true);
      const cancel = () => stop(false);
      if (touch) timer = setTimeout(begin, 280);
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    });
    // Hindra sidan från att scrolla medan en rad dras med fingret
    table.addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { passive: false });
    table.addEventListener('contextmenu', e => { if (drag || e.target.closest('.mon-row > td:first-child')) e.preventDefault(); });

    // Tangentbord: fokusera greppet och flytta med pil upp/ner
    table.querySelectorAll('.mon-grip').forEach(g => g.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const row = g.closest('.mon-row');
      App.moveCategory(row.dataset.cat, e.key === 'ArrowUp' ? -1 : 1, row.dataset.kind === 'income');
      requestAnimationFrame(() => document.querySelector(`.mon-row[data-cat="${CSS.escape(row.dataset.cat)}"] .mon-grip`)?.focus());
    }));
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
      const closedGroups = collapsed();
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
            ${groups.map(g => groupHTML(g, key, closedGroups)).join('<tbody class="mon-gap" aria-hidden="true"><tr><td colspan="4"></td></tr></tbody>')}
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
      enableDrag(root);

      // Fäll ihop och öppna huvudkategorier
      root.querySelectorAll('.mon-toggle').forEach(t => t.addEventListener('click', () => {
        const body = t.closest('.mon-group');
        const name = body.dataset.group;
        const set = collapsed();
        const closing = !body.classList.contains('is-collapsed');
        body.classList.toggle('is-collapsed', closing);
        t.setAttribute('aria-expanded', String(!closing));
        closing ? set.add(name) : set.delete(name);
        saveCollapsed(set);
      }));
      root.querySelectorAll('.mon-input').forEach(input => {
        input.addEventListener('change', () => {
          const value = Math.max(0, Number(input.value) || 0);
          App.update(st => { ensure(st); st.budgets[key][input.dataset.cat] = value; });
        });
      });

      // Delade kategorier: tryck på din del för att öppna fördelningen
      root.querySelectorAll('[data-share]').forEach(btn => btn.addEventListener('click', () => openSharePop(btn, key, ensure)));
      root.querySelectorAll('input[data-group]').forEach(inp => {
        inp.addEventListener('change', () => {
          const v = App.clamp(Math.round(Number(inp.value) || 0), 0, 100);
          App.update(st => { st.settings.split = { ...splitPct(st), [inp.dataset.group]: v }; });
        });
      });
    },
  });
})();
