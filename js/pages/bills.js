// Räkningar & kalender – förfallodagar och återkommande räkningar.
// En räkning är betald när det finns en transaktion för den: "Betala" skapar transaktionen.
(() => {
  const { fmt, calc, ui, esc, uid, ym, today, parseISO, daysInMonth, pad2, sum } = App;

  // Gemensam formulärdialog (används även av Konton, Sparande, Skulder).
  // onSubmit(FormData) körs vid "Spara"; returnera false för att låta dialogen vara öppen.
  App.formDialog = App.formDialog || function ({ overline = '', title, body, submit = 'Spara', onSubmit }) {
    const dlg = document.getElementById('dialog');
    dlg.innerHTML = `
      <form class="dialog-form" novalidate>
        ${overline ? `<p class="overline">${overline}</p>` : ''}
        <h2 class="card-title" style="margin-bottom:14px">${title}</h2>
        <div class="form-stack">${body}</div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" data-cancel>Avbryt</button>
          <button type="submit" class="btn btn-primary">${submit}</button>
        </div>
      </form>`;
    const form = dlg.querySelector('form');
    dlg.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      if (onSubmit(new FormData(form)) !== false) dlg.close();
    });
    dlg.showModal();
    const first = form.querySelector('input, select, textarea');
    if (first) first.focus();
  };

  const RECURRENCE = { monthly: 'Varje månad', yearly: 'Varje år', once: 'En gång' };

  function billFields(s, b = {}) {
    const def = calc.defaultAccount();
    const accId = b.accountId ?? def?.id ?? '';
    return `
      ${ui.field('Namn', `<input name="name" required placeholder="t.ex. Internet" value="${esc(b.name ?? '')}">`)}
      ${ui.field('Belopp', ui.moneyInput(`name="amount" required min="0" step="any" value="${b.amount ?? 0}"`))}
      ${ui.field('Förfallodag', `<input type="date" name="dueDate" required value="${b.dueDate || ''}">`)}
      ${ui.field('Upprepning', `<select name="recurrence">${Object.entries(RECURRENCE).map(([k, v]) => `<option value="${k}" ${k === b.recurrence ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
      ${ui.field('Kategori', `<select name="category"><option value="">Välj kategori</option>${ui.categoryOptions(b.category)}</select>`)}
      ${s.accounts.length ? ui.field('Betalas från', `<select name="accountId">${s.accounts.filter(a => !a.archived || a.id === accId).map(a => `<option value="${a.id}" ${a.id === accId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`) : ''}
      ${s.debts.length ? ui.field('Kopplad skuld (valfritt)', `<select name="debtId"><option value="">Ingen</option>${s.debts.map(d => `<option value="${d.id}" ${d.id === b.debtId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`) : ''}`;
  }
  const readBill = f => ({
    name: String(f.get('name')).trim(),
    amount: Math.abs(Number(f.get('amount')) || 0),
    dueDate: f.get('dueDate'),
    recurrence: f.get('recurrence'),
    category: f.get('category') || '',
    accountId: f.get('accountId') || '',
    debtId: f.get('debtId') || undefined,
  });
  const WEEKDAYS = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];
  let selected = ym(today());

  App.page({
    id: 'rakningar',
    title: 'Räkningar',
    heading: 'Räkningar & kalender',
    overline: 'Räkningar',
    icon: 'bill',

    render(s) {
      const bills = calc.billsForMonth(selected);
      const total = sum(bills.map(b => b.amount));
      const paid = sum(bills.filter(b => b.isPaid).map(b => b.amount));
      const [Y, M] = selected.split('-').map(Number);

      const top = `
        <div class="bill-top">
          ${ui.field('Vald månad', `<input type="month" id="billMonth" value="${selected}">`)}
          <p class="muted">När du trycker på <b>Betala</b> skapas utgiften under Transaktioner, och kontot (och en eventuell skuld) uppdateras. En utgift i räkningens kategori med samma belopp samma månad räknas också som betalning.</p>
        </div>`;

      const stats = `<div class="grid-4">
        ${ui.stat({ label: 'Räkningar denna månad', value: bills.length, accent: 'var(--dark)' })}
        ${ui.stat({ label: 'Totalt att betala', value: fmt.money(total), accent: 'var(--rose)' })}
        ${ui.stat({ label: 'Betalt', value: fmt.money(paid), accent: 'var(--caramel)' })}
        ${ui.stat({ label: 'Kvar', value: fmt.money(total - paid), accent: 'var(--dark)' })}
      </div>`;

      const list = ui.card({
        overline: 'Vald månad', title: 'Kommande räkningar',
        right: `<span>${fmt.cap(fmt.month(selected))}</span>`,
        body: bills.length ? `<ul class="rows">${bills.map(b => `
          <li class="bill-row">
            <span class="bill-dot" style="background:${b.debtId ? 'var(--dark)' : 'var(--caramel)'}"></span>
            <div class="bill-main">
              <div class="bill-line">
                <b>${fmt.dateShort(b.date)}</b>
                <span class="bill-name">${esc(b.name)}</span>
                ${b.isPaid ? ui.pill('Betald', 'dark') : ''}
                <span class="amount bill-amount">${fmt.money(b.amount)}</span>
              </div>
              <p class="muted">${[b.debtId ? 'Avbetalning' : RECURRENCE[b.recurrence] || '', b.category, calc.accountName(b.accountId)].filter(Boolean).map(esc).join(' · ')}${b.isPaid ? ` · betald ${fmt.dateShort(b.tx.date)}` : ''}</p>
              <div class="bill-actions">
                ${b.isPaid
                  ? `<button class="btn btn-small" data-show="${b.tx.id}">Visa betalning</button>`
                  : `<button class="btn btn-secondary" data-pay="${b.id}" data-date="${b.date}">Betala</button>`}
                <button class="btn btn-small" data-edit="${b.id}">Redigera</button>
                <button class="icon-btn" data-delete="${b.id}" aria-label="Ta bort ${esc(b.name)}">${ui.icon('x', 14)}</button>
              </div>
            </div>
          </li>`).join('')}</ul>`
          : ui.empty('Inga räkningar den här månaden', 'Lägg till en räkning i formuläret nedan.'),
      });

      // Kalender, måndag först
      const first = new Date(Y, M - 1, 1);
      const offset = (first.getDay() + 6) % 7;
      const days = daysInMonth(selected);
      const todayIso = App.iso(today());
      let cells = '';
      for (let i = 0; i < offset; i++) cells += '<div class="bill-cell bill-cell-empty"></div>';
      for (let d = 1; d <= days; d++) {
        const date = `${selected}-${pad2(d)}`;
        const items = bills.filter(b => b.date === date);
        cells += `<div class="bill-cell ${date === todayIso ? 'bill-today' : ''}">
          <span class="bill-daynum">${d}</span>
          ${items.map(b => `<span class="bill-chip ${b.debtId ? 'bill-chip-dark' : ''} ${b.isPaid ? 'bill-chip-paid' : ''}" title="${esc(b.name)} – ${fmt.money(b.amount)}"><span class="bill-chip-text">${esc(b.name)} – ${fmt.money(b.amount)}</span></span>`).join('')}
        </div>`;
      }
      const trailing = (7 - ((offset + days) % 7)) % 7;
      for (let i = 0; i < trailing; i++) cells += '<div class="bill-cell bill-cell-empty"></div>';

      const calendar = ui.card({
        overline: fmt.month(selected), title: 'Räkningar & smart kalender',
        body: `<div class="bill-cal">${WEEKDAYS.map(w => `<div class="bill-wd">${w}</div>`).join('')}${cells}</div>`,
      });

      const add = ui.card({
        overline: 'Schema', title: 'Lägg till räkning',
        body: `<form id="billForm" class="form-stack">
          ${billFields(s, { dueDate: `${selected}-${pad2(Math.min(25, days))}` })}
          <button class="btn btn-primary btn-block" type="submit">Lägg till i kalendern</button>
        </form>`,
      });

      return `${top}${stats}${list}<div class="grid-2-1 bill-grid">${calendar}${add}</div>`;
    },

    mount(root) {
      root.querySelector('#billMonth').addEventListener('change', e => {
        if (e.target.value) { selected = e.target.value; App.render(); }
      });

      root.addEventListener('click', async e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const find = id => App.state.bills.find(b => b.id === id);
        if (btn.dataset.pay) {
          // Betalningen blir en transaktion kopplad till räkningen och månaden
          const b = find(btn.dataset.pay);
          const date = btn.dataset.date;
          const preset = { type: 'expense', amount: b.amount, date: date <= App.iso(today()) ? date : App.iso(today()), title: b.name, billId: b.id, billMonth: selected };
          if (b.category) preset.category = b.category;
          if (b.accountId) preset.accountId = b.accountId;
          if (b.debtId) preset.debtId = b.debtId;
          App.openTransactionDialog(preset);
        } else if (btn.dataset.show) {
          const t = App.state.transactions.find(x => x.id === btn.dataset.show);
          if (t) App.openTransactionDialog({ ...t });
        } else if (btn.dataset.edit) {
          const b = find(btn.dataset.edit);
          App.formDialog({
            overline: 'Räkning', title: 'Redigera räkning', body: billFields(App.state, b),
            onSubmit(f) {
              const next = readBill(f);
              if (!next.name || !next.dueDate) return false;
              App.update(s => { const x = s.bills.find(y => y.id === b.id); Object.assign(x, next); if (!next.debtId) delete x.debtId; });
            },
          });
        } else if (btn.dataset.delete) {
          const b = find(btn.dataset.delete);
          if (await App.confirm(`Ta bort räkningen "${b.name}"? Den försvinner från alla månader. Betalningar finns kvar som transaktioner.`)) {
            App.update(s => { s.bills = s.bills.filter(x => x.id !== b.id); });
          }
        }
      });

      root.querySelector('#billForm').addEventListener('submit', e => {
        e.preventDefault();
        const b = readBill(new FormData(e.target));
        if (!b.name || !b.dueDate) return;
        App.update(s => { s.bills.push({ id: uid(), ...b }); });
      });
    },
  });

})();
