// Transaktioner – logga inkomster, utgifter och överföringar. Klicka på en rad för att ändra.
(() => {
  const { fmt, calc, ui, esc, ym, today } = App;
  let query = '';
  let typeFilter = 'all';
  let accountFilter = 'all';
  const PAGE_SIZE = 50;
  let limit = PAGE_SIZE;

  function filtered(s) {
    const q = query.trim().toLowerCase();
    return s.transactions
      .filter(t => typeFilter === 'all' || t.type === typeFilter)
      .filter(t => accountFilter === 'all' || calc.txMoves(t).some(m => m.accountId === accountFilter))
      .filter(t => !q || [t.title, t.category, calc.accountName(t.accountId), calc.goalOf(t)?.name, calc.debtOf(t)?.name, t.date, String(t.amount)].some(v => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  function listHTML(s) {
    const list = filtered(s);
    if (!list.length) {
      return s.transactions.length
        ? ui.empty('Inga träffar', 'Prova en annan sökning eller ett annat filter.')
        : ui.empty('Inga transaktioner ännu', 'Lägg till din första inkomst eller utgift.');
    }
    const shown = list.slice(0, limit);
    const def = calc.defaultAccount();
    return `<ul class="rows tx-rows">${shown.map(t => {
      const income = t.type === 'income';
      const transfer = t.type === 'transfer';
      const title = t.title || (transfer ? 'Överföring' : t.category);
      const from = calc.accountName(t.accountId) || (def ? def.name : '');
      const acc = transfer ? `${from} → ${calc.accountName(t.toAccountId)}` : from;
      const meta = [fmt.date(t.date), !transfer && t.category !== title ? t.category : '', acc].filter(Boolean).map(esc).join(' · ');
      const goal = calc.goalOf(t), debt = calc.debtOf(t);
      const plus = income || (!transfer && t.amount < 0);
      return `<li class="tx-row" data-edit="${esc(t.id)}" tabindex="0" role="button" aria-label="Redigera ${esc(title)}">
        <span class="tx-icon ${transfer ? 'tx-icon-move' : income ? 'tx-icon-in' : 'tx-icon-out'}" aria-hidden="true">${ui.icon(transfer ? 'swap' : income ? 'down' : 'up', 14)}</span>
        <div class="tx-main">
          <div class="tx-title"><b>${esc(title)}</b>${t.recurring ? ui.pill('Återkommande', 'soft') : ''}${goal ? ui.pill(esc(goal.name), 'soft') : ''}${debt ? ui.pill(esc(debt.name), 'soft') : ''}</div>
          <p class="muted">${meta}</p>
        </div>
        <span class="tx-amount ${plus ? 'pos' : ''}">${transfer ? '' : plus ? '+' : '−'}${fmt.money(Math.abs(t.amount))}</span>
        <button class="icon-btn tx-del" data-id="${esc(t.id)}" aria-label="Ta bort ${esc(title)}">${ui.icon('x', 14)}</button>
      </li>`;
    }).join('')}</ul>
    ${list.length > shown.length ? `<div class="tx-more"><button class="btn btn-secondary" id="txMore">Visa fler (${fmt.num(list.length - shown.length)} till)</button></div>` : ''}`;
  }

  function countLabel(s) {
    const n = filtered(s).length;
    return `${fmt.num(n)} ${n === 1 ? 'post' : 'poster'}`;
  }

  App.page({
    id: 'transaktioner',
    title: 'Transaktioner',
    overline: 'Transaktioner',
    heading: 'Transaktioner',
    icon: 'swap',

    render(s) {
      const t = calc.monthTotals(App.period.current());
      return `
        <div class="grid-3">
          ${ui.stat({ label: 'Inkomster denna månad', value: fmt.money(t.income), accent: 'var(--dark)' })}
          ${ui.stat({ label: 'Utgifter denna månad', value: fmt.money(t.expense), accent: 'var(--rose)' })}
          ${ui.stat({ label: 'Nettoflöde', value: fmt.money(t.net), accent: 'var(--caramel)' })}
        </div>
        ${ui.card({
          overline: 'Huvudbok',
          title: `Transaktioner <span class="tx-count muted" id="txCount">${countLabel(s)}</span>`,
          right: `<button class="btn btn-primary" id="txNew">${ui.icon('plus', 14)} Ny</button>`,
          body: `
            <div class="tx-tools">
              <label class="tx-search"><span class="sr-only">Sök</span>
                <input type="search" id="txSearch" placeholder="Sök transaktioner…" value="${esc(query)}">
              </label>
              <label class="tx-filter"><span class="sr-only">Typ</span>
                <select id="txType">
                  <option value="all" ${typeFilter === 'all' ? 'selected' : ''}>Alla typer</option>
                  <option value="income" ${typeFilter === 'income' ? 'selected' : ''}>Inkomster</option>
                  <option value="expense" ${typeFilter === 'expense' ? 'selected' : ''}>Utgifter</option>
                  <option value="transfer" ${typeFilter === 'transfer' ? 'selected' : ''}>Överföringar</option>
                </select>
              </label>
              ${s.accounts.length ? `<label class="tx-filter"><span class="sr-only">Konto</span>
                <select id="txAccount">
                  <option value="all">Alla konton</option>
                  ${s.accounts.map(a => `<option value="${a.id}" ${accountFilter === a.id ? 'selected' : ''}>${esc(a.name)}${a.archived ? ' (arkiverat)' : ''}</option>`).join('')}
                </select>
              </label>` : ''}
            </div>
            <div id="txList">${listHTML(s)}</div>`,
        })}`;
    },

    mount(root, s) {
      const refresh = () => {
        root.querySelector('#txList').innerHTML = listHTML(App.state);
        root.querySelector('#txCount').textContent = countLabel(App.state);
      };
      root.querySelector('#txSearch').addEventListener('input', e => { query = e.target.value; limit = PAGE_SIZE; refresh(); });
      root.querySelector('#txType').addEventListener('change', e => { typeFilter = e.target.value; limit = PAGE_SIZE; refresh(); });
      const accSel = root.querySelector('#txAccount');
      if (accSel) accSel.addEventListener('change', e => { accountFilter = e.target.value; limit = PAGE_SIZE; refresh(); });
      const openEdit = row => { const tx = App.state.transactions.find(t => t.id === row.dataset.edit); if (tx) App.openTransactionDialog({ ...tx }); };
      root.querySelector('#txList').addEventListener('keydown', e => {
        const row = e.target.closest('[data-edit]');
        if (row && (e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); openEdit(row); }
      });
      root.querySelector('#txNew').addEventListener('click', () => App.openTransactionDialog());
      root.querySelector('#txList').addEventListener('click', e => {
        if (e.target.closest('#txMore')) { limit += PAGE_SIZE; refresh(); return; }
        const btn = e.target.closest('.tx-del');
        if (!btn) { const row = e.target.closest('[data-edit]'); if (row) openEdit(row); return; }
        const tx = App.state.transactions.find(t => t.id === btn.dataset.id);
        if (!tx) return;
        if (!App.confirm(`Ta bort ”${tx.title || tx.category}” (${fmt.money(tx.amount)})?`)) return;
        App.update(st => { st.transactions = st.transactions.filter(t => t.id !== tx.id); });
      });
    },
  });
})();
