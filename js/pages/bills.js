// Räkningar & kalender – förfallodagar och återkommande räkningar.
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
  const WEEKDAYS = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];
  let selected = ym(today());

  App.page({
    id: 'rakningar',
    title: 'Räkningar & kalender',
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
          <p class="muted">Betalstatus är en checklista. Registrera själva utgiften separat under Transaktioner.</p>
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
              <p class="muted">${b.debtId ? 'Avbetalning' : RECURRENCE[b.recurrence] || ''}</p>
              <div class="bill-actions">
                ${b.debtId
                  ? (b.isPaid
                      ? `<button class="btn btn-small" data-unpay="${b.id}">Ångra</button>`
                      : `<button class="btn btn-secondary" data-record="${b.id}">Registrera betalning</button>`)
                  : `<button class="btn btn-secondary" data-toggle="${b.id}">${b.isPaid ? 'Markera obetald' : 'Markera betald'}</button>`}
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
          ${ui.field('Namn', '<input name="name" required placeholder="t.ex. Internet">')}
          ${ui.field('Belopp', ui.moneyInput('name="amount" required min="0" value="0"'))}
          ${ui.field('Förfallodag', `<input type="date" name="dueDate" required value="${selected}-${pad2(Math.min(25, days))}">`)}
          ${ui.field('Upprepning', `<select name="recurrence">${Object.entries(RECURRENCE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`)}
          ${s.debts.length ? ui.field('Kopplad skuld (valfritt)', `<select name="debtId"><option value="">Ingen</option>${s.debts.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>`) : ''}
          <button class="btn btn-primary btn-block" type="submit">Lägg till i kalendern</button>
        </form>`,
      });

      return `${top}${stats}${list}<div class="grid-2-1 bill-grid">${calendar}${add}</div>`;
    },

    mount(root) {
      root.querySelector('#billMonth').addEventListener('change', e => {
        if (e.target.value) { selected = e.target.value; App.render(); }
      });

      root.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const find = id => App.state.bills.find(b => b.id === id);
        if (btn.dataset.toggle) {
          App.update(() => {
            const b = find(btn.dataset.toggle);
            b.paid = b.paid || {};
            if (b.paid[selected]) delete b.paid[selected]; else b.paid[selected] = true;
          });
        } else if (btn.dataset.unpay) {
          App.update(() => { const b = find(btn.dataset.unpay); if (b.paid) delete b.paid[selected]; });
        } else if (btn.dataset.record) {
          recordPayment(find(btn.dataset.record));
        } else if (btn.dataset.delete) {
          const b = find(btn.dataset.delete);
          if (App.confirm(`Ta bort räkningen "${b.name}"? Den försvinner från alla månader.`)) {
            App.update(s => { s.bills = s.bills.filter(x => x.id !== b.id); });
          }
        }
      });

      root.querySelector('#billForm').addEventListener('submit', e => {
        e.preventDefault();
        const f = new FormData(e.target);
        const name = String(f.get('name')).trim();
        const amount = Math.abs(Number(f.get('amount')) || 0);
        if (!name || !f.get('dueDate')) return;
        App.update(s => {
          s.bills.push({ id: uid(), name, amount, dueDate: f.get('dueDate'), recurrence: f.get('recurrence'), debtId: f.get('debtId') || undefined, paid: {} });
        });
      });
    },
  });

  // Avbetalning: minska skulden, logga betalningen och bocka av räkningen.
  function recordPayment(bill) {
    const debt = App.state.debts.find(d => d.id === bill.debtId);
    const dateInMonth = calc.billsForMonth(selected).find(b => b.id === bill.id)?.date || App.iso(today());
    App.formDialog({
      overline: debt ? esc(debt.name) : 'Avbetalning',
      title: 'Registrera betalning',
      body: `
        ${ui.field('Belopp', ui.moneyInput(`name="amount" required min="0" value="${bill.amount}"`))}
        ${ui.field('Datum', `<input type="date" name="date" required value="${dateInMonth}">`)}
        ${debt ? `<p class="muted">Kvarvarande skuld efter betalningen: <b id="billAfter">${fmt.money(Math.max(0, debt.balance - bill.amount))}</b></p>` : '<p class="muted">Ingen skuld är kopplad längre; räkningen markeras bara som betald.</p>'}`,
      submit: 'Registrera',
      onSubmit(f) {
        const amount = Math.abs(Number(f.get('amount')) || 0);
        App.update(s => {
          const b = s.bills.find(x => x.id === bill.id);
          b.paid = b.paid || {};
          b.paid[selected] = true;
          const d = s.debts.find(x => x.id === bill.debtId);
          if (d && amount > 0) {
            d.balance = Math.max(0, Math.round((d.balance - amount) * 100) / 100);
            d.payments = d.payments || [];
            d.payments.push({ date: f.get('date'), amount, kind: 'installment' });
          }
        });
      },
    });
  }
})();
