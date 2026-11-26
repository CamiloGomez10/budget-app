// Räkningar & kalender – förfallodagar per budgetperiod (lönemånad eller kalendermånad).
// En räkning är betald när det finns en transaktion för den: "Betala" skapar transaktionen.
(() => {
  const { fmt, calc, ui, esc, uid, today, parseISO, sum } = App;

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
  let selected = null; // budgetperiod ("2026-12" = lönemånaden som slutar i december); sätts vid första visningen
  App.page({
    id: 'rakningar',
    title: 'Räkningar',
    heading: 'Räkningar & kalender',
    overline: 'Räkningar',
    icon: 'bill',

    render(s) {
      if (!selected) selected = App.period.current();
      const r = App.period.range(selected);
      const payday = App.period.isPayday();
      // Räkningarna som förfaller inom perioden (lönemånad eller kalendermånad)
      // Delade räkningar (t.ex. hyra med sambo) räknas med din del
      const bills = calc.billsInRange(r.start, r.end).map(b => {
        const rule = calc.shareRule(b.category);
        return { ...b, mine: rule ? calc.splitAmount(b.amount, rule).mine : b.amount, shared: !!rule };
      });
      const total = sum(bills.map(b => b.mine));
      const paid = sum(bills.filter(b => b.isPaid).map(b => b.mine));
      const rangeText = `${fmt.date(r.start)} – ${fmt.date(r.end)}`;

      const top = `
        <div class="bill-top">
          ${ui.field(payday ? 'Lönemånad' : 'Månad', `<input type="month" id="billMonth" value="${selected}">`)}
          <p class="muted">${payday ? `<b>${rangeText}</b>. ` : ''}När du trycker på <b>Betala</b> skapas utgiften under Transaktioner, och kontot (och en eventuell skuld) uppdateras. En utgift i räkningens kategori med samma belopp i samma ${payday ? 'lönemånad' : 'månad'} räknas också som betalning.</p>
        </div>`;

      const stats = `<div class="grid-4">
        ${ui.stat({ label: payday ? 'Räkningar denna lönemånad' : 'Räkningar denna månad', value: bills.length, accent: 'var(--dark)' })}
        ${ui.stat({ label: bills.some(b => b.shared) ? 'Din del att betala' : 'Totalt att betala', value: fmt.money(total), accent: 'var(--rose)' })}
        ${ui.stat({ label: 'Betalt', value: fmt.money(paid), accent: 'var(--caramel)' })}
        ${ui.stat({ label: 'Kvar', value: fmt.money(total - paid), accent: 'var(--dark)' })}
      </div>`;

      const list = ui.card({
        overline: payday ? 'Vald lönemånad' : 'Vald månad', title: 'Kommande räkningar',
        right: `<span>${payday ? rangeText : fmt.cap(fmt.month(selected))}</span>`,
        body: bills.length ? `<ul class="rows">${bills.map(b => `
          <li class="bill-row">
            <span class="bill-dot" style="background:${b.debtId ? 'var(--dark)' : 'var(--caramel)'}"></span>
            <div class="bill-main">
              <div class="bill-line">
                <b>${fmt.dateShort(b.date)}</b>
                <span class="bill-name">${esc(b.name)}</span>
                ${b.isPaid ? ui.pill('Betald', 'dark') : ''}
                <span class="amount bill-amount">${fmt.money(b.amount)}${b.shared ? `<small class="bill-mine">din del ${fmt.money(b.mine)}</small>` : ''}</span>
              </div>
              <p class="muted">${[b.debtId ? 'Avbetalning' : RECURRENCE[b.recurrence] || '', b.category, calc.accountName(b.accountId)].filter(Boolean).map(esc).join(' · ')}${b.isPaid ? ` · betald ${fmt.dateShort(b.tx.date)}` : ''}</p>
              <div class="bill-actions">
                ${b.isPaid
                  ? `<button class="btn btn-small" data-show="${b.tx.id}">Visa betalning</button>`
                  : `<button class="btn btn-secondary" data-pay="${b.id}" data-date="${b.date}" data-month="${b.month}">Betala</button>`}
                <button class="btn btn-small" data-edit="${b.id}">Redigera</button>
                <button class="icon-btn" data-delete="${b.id}" aria-label="Ta bort ${esc(b.name)}">${ui.icon('x', 14)}</button>
              </div>
            </div>
          </li>`).join('')}</ul>`
          : ui.empty(payday ? 'Inga räkningar den här lönemånaden' : 'Inga räkningar den här månaden', 'Lägg till en räkning i formuläret nedan.'),
      });

      // Kalender över periodens dagar, måndag först. Första dagen och varje månadsskifte
      // får månadens namn, så att det syns när perioden går över till nästa månad.
      const first = parseISO(r.start);
      const last = parseISO(r.end);
      const offset = (first.getDay() + 6) % 7;
      const todayIso = App.iso(today());
      let cells = '';
      let count = 0;
      for (let i = 0; i < offset; i++) cells += '<div class="bill-cell bill-cell-empty"></div>';
      for (const d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
        const date = App.iso(d);
        const items = bills.filter(b => b.date === date);
        const label = count === 0 || d.getDate() === 1 ? `${d.getDate()} ${fmt.monthShort(d.getMonth())}` : d.getDate();
        cells += `<div class="bill-cell ${date === todayIso ? 'bill-today' : ''}">
          <span class="bill-daynum">${label}</span>
          ${items.map(b => `<span class="bill-chip ${b.debtId ? 'bill-chip-dark' : ''} ${b.isPaid ? 'bill-chip-paid' : ''}" title="${esc(b.name)} – ${fmt.money(b.amount)}"><span class="bill-chip-text">${esc(b.name)} – ${fmt.money(b.amount)}</span></span>`).join('')}
        </div>`;
        count++;
      }
      const trailing = (7 - ((offset + count) % 7)) % 7;
      for (let i = 0; i < trailing; i++) cells += '<div class="bill-cell bill-cell-empty"></div>';

      const calendar = ui.card({
        overline: payday ? rangeText : fmt.month(selected), title: 'Räkningar & smart kalender',
        body: `<div class="bill-cal">${WEEKDAYS.map(w => `<div class="bill-wd">${w}</div>`).join('')}${cells}</div>`,
      });

      const add = ui.card({
        overline: 'Schema', title: 'Lägg till räkning',
        body: `<form id="billForm" class="form-stack">
          ${billFields(s, { dueDate: todayIso >= r.start && todayIso <= r.end ? todayIso : r.start })}
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
          const preset = { type: 'expense', amount: b.amount, date: date <= App.iso(today()) ? date : App.iso(today()), title: b.name, billId: b.id, billMonth: btn.dataset.month };
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
