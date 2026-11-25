// Sparande & buffertar – sparmål och hur långt du kommit.
(() => {
  const { fmt, calc, ui, charts, esc, uid, iso, today, sum } = App;
  const GOAL_COLORS = ['var(--dark)', 'var(--caramel)', 'var(--rose)', 'var(--table-head)'];

  const accountOptions = (s, selected) =>
    `<option value="">Inget kopplat konto</option>${s.accounts.map(a => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}`;

  function goalFields(s, g = {}) {
    return `
      ${ui.field('Namn', `<input name="name" required value="${esc(g.name ?? 'Nytt mål')}">`)}
      <div class="form-grid">
        ${ui.field('Målbelopp', ui.moneyInput(`name="target" min="0" value="${g.target ?? 0}"`))}
        ${ui.field('Sparat hittills', ui.moneyInput(`name="current" min="0" value="${g.current ?? 0}"`))}
      </div>
      ${ui.field('Måldatum', `<input type="date" name="date" value="${g.date || ''}">`)}
      ${ui.field('Kopplat konto', `<select name="accountId">${accountOptions(s, g.accountId)}</select>`)}
      ${ui.field('Anteckningar', `<textarea name="notes">${esc(g.notes || '')}</textarea>`)}`;
  }
  const readGoal = f => ({
    name: String(f.get('name')).trim() || 'Mål',
    target: Math.abs(Number(f.get('target')) || 0),
    current: Math.abs(Number(f.get('current')) || 0),
    date: f.get('date') || '',
    accountId: f.get('accountId') || '',
    notes: String(f.get('notes') || '').trim(),
  });

  App.page({
    id: 'sparande',
    title: 'Sparande & buffertar',
    overline: 'Sparande',
    icon: 'piggy',

    render(s) {
      const saved = sum(s.goals.map(g => g.current));
      const target = sum(s.goals.map(g => g.target));

      const total = ui.card({
        overline: 'Totalt framsteg', title: 'Sparmål',
        body: s.goals.length
          ? `<div class="goal-total"><div id="goalRing"></div><p class="muted">${fmt.money(saved)} av ${fmt.money(target)}</p></div>`
          : ui.empty('Inga sparmål ännu', 'Skapa ditt första mål i formuläret.'),
      });

      const list = ui.card({
        overline: 'Mål', title: 'Sparmål',
        right: `<span>${s.goals.length} aktiva</span>`,
        body: s.goals.length ? s.goals.map((g, i) => {
          const share = g.target > 0 ? g.current / g.target : 0;
          const color = GOAL_COLORS[i % GOAL_COLORS.length];
          const history = (g.history || []).slice().reverse();
          return `<article class="goal-block">
            <div class="goal-id">
              ${ui.avatar(g.name, color)}
              <div style="min-width:0;flex:1">
                <b>${esc(g.name)}</b>
                <p class="muted">${fmt.pct(share)} finansierat</p>
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
              <summary>Justeringshistorik${history.length ? ` (${history.length})` : ''}</summary>
              ${history.length
                ? `<ul class="rows">${history.map(h => `<li><span class="muted">${fmt.date(h.date)}</span><span style="flex:1">${esc(h.note || '')}</span><b class="${h.amount < 0 ? 'neg' : 'pos'}">${h.amount < 0 ? '−' : '+'}${fmt.money(Math.abs(h.amount))}</b></li>`).join('')}</ul>`
                : '<p class="muted">Inga justeringar ännu.</p>'}
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

    mount(root, s) {
      const saved = sum(s.goals.map(g => g.current));
      const target = sum(s.goals.map(g => g.target));
      const share = target > 0 ? saved / target : 0;
      charts.ring(root.querySelector('#goalRing'), { share, size: 200, center: { value: fmt.pct(share), label: 'Finansierat' } });

      root.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const goal = id => App.state.goals.find(g => g.id === id);
        if (btn.dataset.add) {
          const g = goal(btn.dataset.add);
          App.formDialog({
            overline: esc(g.name), title: 'Sätt in pengar',
            body: `${ui.field('Belopp (negativt för uttag)', ui.moneyInput('name="amount" required step="any"'))}
                   ${ui.field('Datum', `<input type="date" name="date" value="${iso(today())}">`)}
                   ${ui.field('Anteckning', '<input name="note" placeholder="t.ex. Månadsöverföring">')}`,
            submit: 'Spara',
            onSubmit(f) {
              const amount = Number(f.get('amount')) || 0;
              if (!amount) return false;
              App.update(st => {
                const x = st.goals.find(y => y.id === g.id);
                x.current = Math.max(0, x.current + amount);
                x.history = x.history || [];
                x.history.push({ date: f.get('date') || iso(today()), amount, note: String(f.get('note') || '').trim() });
              });
            },
          });
        } else if (btn.dataset.edit) {
          const g = goal(btn.dataset.edit);
          App.formDialog({
            overline: 'Mål', title: 'Redigera mål', body: goalFields(App.state, g),
            onSubmit(f) {
              const next = readGoal(f);
              App.update(st => {
                const x = st.goals.find(y => y.id === g.id);
                if (next.current !== x.current) {
                  x.history = x.history || [];
                  x.history.push({ date: iso(today()), amount: next.current - x.current, note: 'Justerat sparat belopp' });
                }
                Object.assign(x, next);
              });
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
        App.update(st => { st.goals.push({ id: uid(), ...g, history: [] }); });
      });
    },
  });
})();
