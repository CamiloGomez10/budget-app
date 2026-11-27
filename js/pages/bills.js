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
      ${ui.field('<span data-bill-amount-label>Belopp</span>', ui.moneyInput(`name="amount" required min="0" step="any" value="${b.amount ?? 0}"`))}
      ${ui.field('Förfallodag', `<input type="date" name="dueDate" required value="${b.dueDate || ''}">`)}
      ${ui.field('Upprepning', `<select name="recurrence">${Object.entries(RECURRENCE).map(([k, v]) => `<option value="${k}" ${k === b.recurrence ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
      ${ui.field('Kategori', `<select name="category"><option value="">Välj kategori</option>${ui.categoryOptions(b.category)}</select>`)}
      <div class="bill-share" data-bill-share hidden>
        <p class="field-label">Delas med ${esc(calc.partnerName())}</p>
        <div class="tx-share-split">
          ${ui.field('Din del', ui.moneyInput(`name="mine" step="any" value="${b.mine ?? ''}"`))}
          ${ui.field(`${esc(calc.partnerName())}s del`, ui.moneyInput(`name="partnerShare" step="any" value="${b.mine != null ? Math.round(((b.amount || 0) - b.mine) * 100) / 100 : ''}"`))}
          <p class="muted">Kategorin delas. Beloppet är hela räkningen; ändrar du en del justeras den andra.</p>
        </div>
      </div>
      ${s.accounts.length ? ui.field('Betalas från', `<select name="accountId">${s.accounts.filter(a => !a.archived || a.id === accId).map(a => `<option value="${a.id}" ${a.id === accId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`) : ''}
      ${s.debts.length ? ui.field('Kopplad skuld (valfritt)', `<select name="debtId"><option value="">Ingen</option>${s.debts.map(d => `<option value="${d.id}" ${d.id === b.debtId ? 'selected' : ''}>${esc(calc.debtLabel(d))}</option>`).join('')}</select>`) : ''}`;
  }
  const readBill = f => {
    const b = {
      name: String(f.get('name')).trim(),
      amount: Math.abs(Number(f.get('amount')) || 0),
      dueDate: f.get('dueDate'),
      recurrence: f.get('recurrence'),
      category: f.get('category') || '',
      accountId: f.get('accountId') || '',
      debtId: f.get('debtId') || undefined,
    };
    // Delad kategori: spara din del av räkningen
    if (calc.isShared(b.category) && f.get('mine') !== '' && f.get('mine') != null) {
      b.mine = Math.min(b.amount, Math.max(0, Math.round(Number(f.get('mine')) * 100) / 100));
    }
    return b;
  };

  // Visa din och den andras del när kategorin delas. Hela beloppet delas enligt budgetens
  // fördelning för kategorin (annars 50/50); ändras en del justeras den andra.
  function wireBillShare(form) {
    const $ = s => form.querySelector(s);
    const box = $('[data-bill-share]'), amount = $('[name=amount]'), cat = $('[name=category]');
    const mine = $('[name=mine]'), other = $('[name=partnerShare]');
    const r2 = v => Math.round(v * 100) / 100;
    const fill = () => {
      const date = $('[name=dueDate]').value || App.iso(today());
      const sp = calc.splitShare(Number(amount.value) || 0, calc.shareRatio(App.period.keyOf(date), cat.value));
      mine.value = sp.mine;
      other.value = sp.partner;
    };
    const refresh = () => {
      const on = calc.isShared(cat.value);
      box.hidden = !on;
      $('[data-bill-amount-label]').textContent = on ? 'Hela beloppet' : 'Belopp';
      if (on && mine.value === '') fill();
    };
    cat.addEventListener('change', () => { if (calc.isShared(cat.value)) fill(); refresh(); });
    amount.addEventListener('input', () => { if (calc.isShared(cat.value)) fill(); });
    mine.addEventListener('input', () => { other.value = r2((Number(amount.value) || 0) - (Number(mine.value) || 0)); });
    other.addEventListener('input', () => { mine.value = r2((Number(amount.value) || 0) - (Number(other.value) || 0)); });
    refresh();
  }
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
        const shared = calc.isShared(b.category);
        const mine = !shared ? b.amount : b.mine != null ? b.mine : calc.splitShare(b.amount, calc.shareRatio(App.period.keyOf(b.date), b.category)).mine;
        return { ...b, mine, shared };
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
        ${ui.stat({ label: payday ? 'Denna lönemånad' : 'Denna månad', value: bills.length, accent: 'var(--dark)' })}
        ${ui.stat({ label: bills.some(b => b.shared) ? 'Din del att betala' : 'Totalt att betala', value: fmt.money(total), accent: 'var(--rose)' })}
        ${ui.stat({ label: 'Betalt', value: fmt.money(paid), accent: 'var(--caramel)' })}
        ${ui.stat({ label: 'Kvar', value: fmt.money(total - paid), accent: 'var(--dark)' })}
      </div>`;

      // Räkningarna som enkla rader i två kolumner: att betala och betalda.
      // Sista veckan i perioden visas också nästa periods räkningar under "Att betala".
      const withShare = b => {
        const shared = calc.isShared(b.category);
        const mine = !shared ? b.amount : b.mine != null ? b.mine : calc.splitShare(b.amount, calc.shareRatio(App.period.keyOf(b.date), b.category)).mine;
        return { ...b, mine, shared };
      };
      const todayIso0 = App.iso(today());
      const nextKey = App.addMonths(selected, 1);
      const nr = App.period.range(nextKey);
      const showNext = selected === App.period.current() && App.period.daysLeft(selected) <= 7;
      const nextBills = showNext ? calc.billsInRange(nr.start, nr.end).map(withShare).filter(b => !b.isPaid) : [];
      const recurring = b => b.recurrence !== 'once';
      // Ett kort: datum, namn (med ↻ om den kommer tillbaka), belopp och Betala.
      // Klick på kortet öppnar räkningen (eller betalningen när den är betald).
      const billCard = b => {
        const d = parseISO(b.date);
        const late = !b.isPaid && b.date < todayIso0;
        const open = b.isPaid ? `data-show="${b.tx.id}"` : b.auto ? 'data-debt="1"' : `data-edit="${b.id}" data-month="${b.month}"`;
        const sub = b.isPaid ? `Betald ${fmt.dateShort(b.tx.date)}`
          : late ? '<span class="bill-late">Försenad</span>'
          : recurring(b) ? (b.debtId ? 'Avbetalning' : RECURRENCE[b.recurrence]) : (b.debtId ? 'Skuld' : 'En gång');
        return `<article class="bill-card ${b.isPaid ? 'is-paid' : ''} ${late ? 'is-late' : ''}">
          <button class="bill-card-open" ${open} aria-label="Öppna ${esc(b.name)}">
            <span class="date-badge"><b>${d.getDate()}</b><small>${fmt.monthShort(d.getMonth())}</small></span>
            <span class="bill-card-name"><b>${recurring(b) ? '<span class="bill-rec" title="Återkommande">↻</span>' : ''}${esc(b.name)}</b><small>${sub}</small></span>
            <span class="amount">${fmt.money0(b.mine)}</span>
          </button>
          ${b.isPaid ? '' : `<button class="btn btn-small btn-primary" data-pay="${b.id}" data-date="${b.date}" data-month="${b.month}">Betala</button>`}
        </article>`;
      };
      const column = (title, items, emptyText, extra = '') => `
        <section class="bill-col">
          <header class="bill-col-head">
            <h3 class="card-title">${title}</h3>
            <span class="bill-col-sum">${items.length ? fmt.money0(sum(items.map(b => b.mine))) : ''}</span>
          </header>
          ${items.length ? items.map(billCard).join('') : `<p class="muted bill-col-empty">${emptyText}</p>`}
          ${extra}
        </section>`;
      const nextBlock = nextBills.length ? `
          <p class="overline bill-next-head">${payday ? 'Nästa lönemånad' : 'Nästa månad'} · från ${fmt.dateShort(nr.start)}</p>
          ${nextBills.map(billCard).join('')}` : '';
      const list = `<div class="bill-cols">
        ${column('Att betala', bills.filter(b => !b.isPaid), 'Allt är betalt.', nextBlock)}
        ${column('Betalda', bills.filter(b => b.isPaid), 'Inget betalt ännu.')}
      </div>
      <p class="muted bill-legend"><span class="bill-rec">↻</span> kommer tillbaka varje månad eller år. Tryck på en räkning för att ändra eller ta bort den.</p>`;

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
        // Räkningar från skulder (id "debt:…") finns inte i listan över egna räkningar
        const find = id => App.state.bills.find(b => b.id === id)
          || calc.debtBillsForMonth(btn.dataset.month || '').find(b => b.id === id);
        if (btn.dataset.pay) {
          // Betalningen blir en transaktion kopplad till räkningen och månaden
          const b = find(btn.dataset.pay);
          const date = btn.dataset.date;
          const preset = { type: 'expense', amount: b.amount, date: date <= App.iso(today()) ? date : App.iso(today()), title: b.name, billId: b.id, billMonth: btn.dataset.month };
          if (b.category) preset.category = b.category;
          if (b.accountId) preset.accountId = b.accountId;
          if (b.debtId) preset.debtId = b.debtId;
          // Delad räkning: förifyll din del
          if (calc.isShared(b.category)) {
            preset.shareMine = b.mine != null ? b.mine : calc.splitShare(b.amount, calc.shareRatio(App.period.keyOf(date), b.category)).mine;
          }
          App.openTransactionDialog(preset);
        } else if (btn.dataset.show) {
          const t = App.state.transactions.find(x => x.id === btn.dataset.show);
          if (t) App.openTransactionDialog({ ...t });
        } else if (btn.dataset.debt) {
          location.hash = '#/skulder';
        } else if (btn.dataset.edit) {
          const b = find(btn.dataset.edit);
          App.formDialog({
            overline: 'Räkning', title: 'Redigera räkning',
            body: `${billFields(App.state, b)}<button type="button" class="btn btn-danger btn-small bill-del" data-bill-del>Ta bort räkningen</button>`,
            onSubmit(f) {
              const next = readBill(f);
              if (!next.name || !next.dueDate) return false;
              App.update(s => {
                const x = s.bills.find(y => y.id === b.id);
                Object.assign(x, next);
                if (!next.debtId) delete x.debtId;
                if (next.mine == null) delete x.mine;
              });
            },
          });
          wireBillShare(document.querySelector('#dialog form'));
          document.querySelector('#dialog [data-bill-del]').addEventListener('click', async () => {
            document.getElementById('dialog').close();
            if (await App.confirm(`Ta bort räkningen "${b.name}"? Den försvinner från alla månader. Betalningar finns kvar som transaktioner.`)) {
              App.update(s => { s.bills = s.bills.filter(x => x.id !== b.id); });
            }
          });
        } else if (btn.dataset.delete) {
          const b = find(btn.dataset.delete);
          if (await App.confirm(`Ta bort räkningen "${b.name}"? Den försvinner från alla månader. Betalningar finns kvar som transaktioner.`)) {
            App.update(s => { s.bills = s.bills.filter(x => x.id !== b.id); });
          }
        }
      });

      wireBillShare(root.querySelector('#billForm'));
      root.querySelector('#billForm').addEventListener('submit', e => {
        e.preventDefault();
        const b = readBill(new FormData(e.target));
        if (!b.name || !b.dueDate) return;
        App.update(s => { s.bills.push({ id: uid(), ...b }); });
      });
    },
  });

})();
