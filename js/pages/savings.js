// Sparande & buffertar – sparmål som fylls på av kopplade transaktioner.
// Sparat = startbelopp + transaktioner kopplade till målet (direkt eller via kategori).
(() => {
  const { fmt, calc, ui, charts, esc, uid, iso, today, sum } = App;
  const GOAL_COLORS = ['var(--dark)', 'var(--caramel)', 'var(--rose)', 'var(--table-head)'];

  const accountOptions = (s, selected) =>
    `<option value="">Inget kopplat konto</option>${s.accounts.filter(a => !a.archived || a.id === selected).map(a => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}`;

  // Kategorier som kan fylla på ett mål: sparande/framtid, plus de som redan är kopplade
  function savingCategories(s) {
    const linked = new Set(s.goals.flatMap(g => g.categories || []));
    return s.categories.filter(c => c.group === 'future' || /spar|saving/i.test(c.parent || '') || linked.has(c.name));
  }

  function goalFields(s, g = {}) {
    const cats = savingCategories(s);
    const mine = g.categories || [];
    const taken = name => s.goals.find(x => x.id !== g.id && (x.categories || []).includes(name));
    return `
      ${ui.field('Namn', `<input name="name" required value="${esc(g.name ?? '')}" placeholder="t.ex. Buffert">`)}
      <div class="form-grid">
        ${ui.field('Målbelopp', ui.moneyInput(`name="target" min="0" value="${g.target ?? 0}"`))}
        ${ui.field('Redan sparat när du började', ui.moneyInput(`name="startAmount" step="any" value="${g.startAmount ?? 0}"`))}
      </div>
      ${ui.field('Måldatum', `<input type="date" name="date" value="${g.date || ''}">`)}
      ${ui.field('Kopplat konto', `<select name="accountId">${accountOptions(s, g.accountId)}</select>`)}
      ${cats.length ? `<div class="field"><span class="field-label">Fylls på av kategori</span>
        <div class="acc-checks">${cats.map(c => {
          const other = taken(c.name);
          return `<label class="check"><input type="checkbox" name="categories" value="${esc(c.name)}" ${mine.includes(c.name) ? 'checked' : ''}> ${esc(c.name)}${other ? ` <span class="muted">(nu: ${esc(other.name)})</span>` : ''}</label>`;
        }).join('')}</div>
        <span class="muted">Alla utgifter i kategorin räknas automatiskt till målet. Du kan också koppla enstaka transaktioner till målet.</span></div>` : ''}
      ${ui.field('Anteckningar', `<textarea name="notes">${esc(g.notes || '')}</textarea>`)}`;
  }
  const readGoal = f => ({
    name: String(f.get('name')).trim() || 'Mål',
    target: Math.abs(Number(f.get('target')) || 0),
    startAmount: Number(f.get('startAmount')) || 0,
    categories: f.getAll('categories').map(String),
    date: f.get('date') || '',
    accountId: f.get('accountId') || '',
    notes: String(f.get('notes') || '').trim(),
  });
  // En kategori kan bara fylla på ett mål åt gången
  const claim = (st, id, cats) => st.goals.forEach(g => { if (g.id !== id) g.categories = (g.categories || []).filter(c => !cats.includes(c)); });

  App.page({
    id: 'sparande',
    title: 'Sparande & buffertar',
    overline: 'Sparande',
    icon: 'piggy',

    render(s) {
      const goals = calc.goals();
      const saved = sum(goals.map(g => g.current));
      const target = sum(goals.map(g => g.target));

      const total = ui.card({
        overline: 'Totalt framsteg', title: 'Sparmål',
        body: s.goals.length
          ? `<div class="goal-total"><div id="goalRing"></div><p class="muted">${fmt.money(saved)} av ${fmt.money(target)}</p></div>`
          : ui.empty('Inga sparmål ännu', 'Skapa ditt första mål i formuläret.'),
      });

      const list = ui.card({
        overline: 'Mål', title: 'Sparmål',
        right: `<span>${s.goals.length} aktiva</span>`,
        body: goals.length ? goals.map((g, i) => {
          const share = g.target > 0 ? g.current / g.target : 0;
          const color = GOAL_COLORS[i % GOAL_COLORS.length];
          const history = calc.goalTx(g.id);
          const source = [(g.categories || []).length ? `Fylls på av ${g.categories.join(', ')}` : '', g.accountId ? calc.accountName(g.accountId) : ''].filter(Boolean).map(esc).join(' · ');
          return `<article class="goal-block">
            <div class="goal-id">
              ${ui.avatar(g.name, color)}
              <div style="min-width:0;flex:1">
                <b>${esc(g.name)}</b>
                <p class="muted">${fmt.pct(share)} finansierat${source ? ` · ${source}` : ''}</p>
                ${ui.progress(share, color)}
              </div>
            </div>
            <div class="goal-figs">
              <div><p class="stat-label">Sparat</p><p class="amount">${fmt.money(g.current)}</p></div>
              <div><p class="stat-label">Målbelopp</p><p class="amount">${fmt.money(g.target)}</p></div>
              <div><p class="stat-label">Kvar</p><p class="amount">${fmt.money(Math.max(0, g.target - g.current))}</p></div>
              <div class="goal-date"><p class="stat-label">Måldatum</p><p>${g.date ? fmt.date(g.date) : '–'}</p></div>
            </div>
            <div class="goal-actions">
              <button class="btn btn-primary" data-add="${g.id}">Sätt in pengar</button>
              <button class="btn btn-secondary" data-edit="${g.id}">Redigera mål</button>
              <button class="btn btn-danger" data-delete="${g.id}">Ta bort</button>
            </div>
            <details class="goal-history">
              <summary>Insättningar och uttag${history.length ? ` (${history.length})` : ''}</summary>
              ${Number(g.startAmount) ? `<p class="muted">Startbelopp: ${fmt.money(g.startAmount)}</p>` : ''}
              ${history.length
                ? `<ul class="rows">${history.map(h => `<li class="tx-row" data-tx="${h.id}"><span class="muted">${fmt.date(h.date)}</span><span style="flex:1">${esc(h.title || h.category)}</span><b class="${h.amount < 0 ? 'neg' : 'pos'}">${h.amount < 0 ? '−' : '+'}${fmt.money(Math.abs(h.amount))}</b></li>`).join('')}</ul>`
                : '<p class="muted">Inga transaktioner kopplade ännu.</p>'}
            </details>
          </article>`;
        }).join('') : ui.empty('Inga mål', 'Mål du skapar visas här.'),
      });

      const add = ui.card({
        overline: 'Skapa', title: 'Lägg till mål',
        body: `<form id="goalForm" class="form-stack">${goalFields(s)}<button class="btn btn-primary btn-block" type="submit">Skapa mål</button></form>`,
      });

      return `${total}<div class="grid-2-1">${list}${add}</div>`;
    },

    mount(root) {
      const goals = calc.goals();
      const saved = sum(goals.map(g => g.current));
      const target = sum(goals.map(g => g.target));
      const share = target > 0 ? saved / target : 0;
      charts.ring(root.querySelector('#goalRing'), { share, size: 200, center: { value: fmt.pct(share), label: 'Finansierat' } });

      root.addEventListener('click', e => {
        const row = e.target.closest('[data-tx]');
        if (row) { const t = App.state.transactions.find(x => x.id === row.dataset.tx); if (t) App.openTransactionDialog({ ...t }); return; }
        const btn = e.target.closest('button');
        if (!btn) return;
        const goal = id => App.state.goals.find(g => g.id === id);
        if (btn.dataset.add) {
          // Insättningen blir en vanlig transaktion, så att konton och budget följer med
          const g = goal(btn.dataset.add);
          const cat = (g.categories || [])[0] || savingCategories(App.state)[0]?.name || App.state.categories[0]?.name;
          App.openTransactionDialog({ type: 'expense', category: cat, goalId: g.id, title: `Till ${g.name}` });
        } else if (btn.dataset.edit) {
          const g = goal(btn.dataset.edit);
          App.formDialog({
            overline: 'Mål', title: 'Redigera mål', body: goalFields(App.state, g),
            onSubmit(f) {
              const next = readGoal(f);
              App.update(st => { claim(st, g.id, next.categories); Object.assign(st.goals.find(y => y.id === g.id), next); });
            },
          });
        } else if (btn.dataset.delete) {
          const g = goal(btn.dataset.delete);
          if (App.confirm(`Ta bort målet "${g.name}"?`)) App.update(st => { st.goals = st.goals.filter(x => x.id !== g.id); });
        }
      });

      root.querySelector('#goalForm').addEventListener('submit', e => {
        e.preventDefault();
        const g = readGoal(new FormData(e.target));
        App.update(st => { const id = uid(); claim(st, id, g.categories); st.goals.push({ id, ...g }); });
      });
    },
  });
})();
