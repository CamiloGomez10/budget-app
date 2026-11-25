// Skuldavbetalning – saldon, avbetalningsordning och betalningar.
(() => {
  const { fmt, calc, ui, esc, uid, iso, today, sum } = App;

  const STRATEGIES = {
    snowball: 'Snöboll – minsta saldot först',
    avalanche: 'Lavin – högsta räntan först',
  };

  function ordered(s) {
    const active = s.debts.filter(d => d.balance > 0);
    const done = s.debts.filter(d => d.balance <= 0);
    active.sort(s.strategy === 'avalanche'
      ? (a, b) => (Number(b.apr) || 0) - (Number(a.apr) || 0) || a.balance - b.balance
      : (a, b) => a.balance - b.balance);
    return [...active, ...done];
  }

  function debtFields(d = {}) {
    return `
      ${ui.field('Namn', `<input name="name" required value="${esc(d.name ?? '')}" placeholder="t.ex. Billån">`)}
      <div class="form-grid">
        ${ui.field('Ursprunglig skuld', ui.moneyInput(`name="original" min="0" value="${d.original ?? 0}"`))}
        ${ui.field('Saldo', ui.moneyInput(`name="balance" min="0" value="${d.balance ?? 0}"`))}
        ${ui.field('Ränta % (valfritt)', `<input type="number" name="apr" step="0.01" min="0" value="${d.apr ?? ''}">`)}
        ${ui.field('Månadsbetalning', ui.moneyInput(`name="installment" min="0" value="${d.installment ?? 0}"`))}
        ${ui.field('Extra per månad', ui.moneyInput(`name="extra" min="0" value="${d.extra ?? 0}"`))}
        ${ui.field('Betalningsdag', `<input type="number" name="payDay" min="1" max="31" value="${d.payDay ?? 1}">`)}
        ${ui.field('Startdatum', `<input type="date" name="start" value="${d.start || ''}">`)}
        ${ui.field('Slutdatum (valfritt)', `<input type="date" name="end" value="${d.end || ''}">`)}
      </div>
      ${ui.field('Anteckningar', `<textarea name="notes">${esc(d.notes || '')}</textarea>`)}`;
  }
  const readDebt = f => {
    const n = k => Math.abs(Number(f.get(k)) || 0);
    return {
      name: String(f.get('name')).trim() || 'Skuld',
      original: n('original'), balance: n('balance'),
      apr: f.get('apr') === '' ? '' : n('apr'),
      installment: n('installment'), extra: n('extra'),
      payDay: Math.min(31, Math.max(1, n('payDay') || 1)),
      start: f.get('start') || '', end: f.get('end') || '',
      notes: String(f.get('notes') || '').trim(),
    };
  };

  App.page({
    id: 'skulder',
    title: 'Skuldavbetalning',
    overline: 'Skulder',
    icon: 'coins',

    render(s) {
      const original = sum(s.debts.map(d => Math.max(d.original, d.balance)));
      const remaining = sum(s.debts.map(d => d.balance));
      const repaid = Math.max(0, original - remaining);
      const monthly = sum(s.debts.filter(d => d.balance > 0).map(d => (Number(d.installment) || 0) + (Number(d.extra) || 0)));
      const progress = original > 0 ? repaid / original : 0;
      const list = ordered(s);
      const active = s.debts.filter(d => d.balance > 0).length;

      const summary = ui.card({
        overline: 'Avbetalningsframsteg', title: 'Skuldavbetalning',
        right: `<span class="amount debt-progress">${fmt.pct(progress)}</span>`,
        body: `${ui.progress(progress)}
          <div class="debt-minis">
            ${[['Ursprunglig skuld', original], ['Kvarvarande skuld', remaining], ['Återbetalt', repaid], ['Total månadsbetalning', monthly]]
              .map(([l, v]) => `<div class="debt-mini"><p class="stat-label">${l}</p><p class="amount">${fmt.money(v)}</p></div>`).join('')}
          </div>`,
      });

      const strategy = `<div class="debt-strategy">
        ${ui.field('Avbetalningsstrategi', `<select id="debtStrategy">${Object.entries(STRATEGIES).map(([k, v]) => `<option value="${k}" ${s.strategy === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
        <p class="muted">Det här ändrar bara den rekommenderade ordningen, aldrig dina betalningar.</p>
      </div>`;

      const cards = list.length ? list.map((d, i) => {
        const months = calc.debtMonthsRemaining(d);
        const paidOff = d.balance <= 0;
        return `<article class="debt-card ${paidOff ? 'debt-done' : ''}">
          <div class="debt-head">
            <span class="debt-num">${paidOff ? ui.icon('check', 14) : i + 1}</span>
            <div style="flex:1;min-width:0">
              <b>${esc(d.name)}</b>
              <p class="muted">${d.apr !== '' && d.apr != null ? `${fmt.num(Number(d.apr), 2)} % ränta` : 'Ränta ej angiven'}</p>
            </div>
            <span class="amount debt-balance">${paidOff ? 'Betald' : fmt.money(d.balance)}</span>
          </div>
          <div class="debt-cols">
            <div><p class="stat-label">Ursprunglig</p><p>${fmt.money(d.original)}</p></div>
            <div><p class="stat-label">Månadsbetalning</p><p>${fmt.money((Number(d.installment) || 0) + (Number(d.extra) || 0))}</p></div>
            <div><p class="stat-label">Betalningsdag</p><p>${d.payDay || '–'}</p></div>
            <div><p class="stat-label">Månader kvar</p><p>${paidOff ? 0 : Number.isFinite(months) ? months : '–'}</p></div>
          </div>
          ${!paidOff && !Number.isFinite(months) ? '<p class="muted debt-warn">Betalningen täcker inte räntan – skulden växer.</p>' : ''}
          <div class="debt-actions">
            ${paidOff ? '' : `<button class="btn btn-primary" data-pay="${d.id}">Registrera betalning</button>
            <button class="btn btn-secondary" data-extra="${d.id}">Extrabetalning</button>`}
            <button class="btn btn-secondary" data-edit="${d.id}">Redigera</button>
            <button class="btn btn-danger" data-delete="${d.id}">Ta bort</button>
          </div>
        </article>`;
      }).join('') : ui.card({ body: ui.empty('Inga skulder', 'Lägg till en skuld för att följa avbetalningen.') });

      const add = ui.card({
        overline: 'Skapa', title: 'Lägg till skuld',
        body: `<form id="debtForm" class="form-stack">${debtFields({ payDay: 1 })}<button class="btn btn-primary btn-block" type="submit">Lägg till skuld</button></form>`,
      });

      return `${summary}${strategy}
        <div class="grid-2-1">
          <div class="debt-list">
            <div class="debt-list-head"><p class="overline">Rekommenderad ordning</p><span class="muted">${active} aktiva</span></div>
            ${cards}
          </div>
          ${add}
        </div>`;
    },

    mount(root) {
      root.querySelector('#debtStrategy').addEventListener('change', e => App.update(s => { s.strategy = e.target.value; }));

      const pay = (d, kind) => App.formDialog({
        overline: esc(d.name),
        title: kind === 'extra' ? 'Extrabetalning' : 'Registrera betalning',
        body: `${ui.field('Belopp', ui.moneyInput(`name="amount" required min="0" value="${kind === 'extra' ? '' : d.installment}"`))}
               ${ui.field('Datum', `<input type="date" name="date" value="${iso(today())}">`)}
               <p class="muted">Nuvarande saldo: ${fmt.money(d.balance)}</p>`,
        submit: 'Registrera',
        onSubmit(f) {
          const amount = Math.abs(Number(f.get('amount')) || 0);
          if (!amount) return false;
          App.update(s => {
            const x = s.debts.find(y => y.id === d.id);
            x.balance = Math.max(0, Math.round((x.balance - amount) * 100) / 100);
            x.payments = x.payments || [];
            x.payments.push({ date: f.get('date') || iso(today()), amount, kind });
          });
        },
      });

      root.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const d = App.state.debts.find(x => x.id === (btn.dataset.pay || btn.dataset.extra || btn.dataset.edit || btn.dataset.delete));
        if (!d) return;
        if (btn.dataset.pay) pay(d, 'installment');
        else if (btn.dataset.extra) pay(d, 'extra');
        else if (btn.dataset.edit) {
          App.formDialog({
            overline: 'Skuld', title: 'Redigera skuld', body: debtFields(d),
            onSubmit(f) { const next = readDebt(f); App.update(s => { Object.assign(s.debts.find(x => x.id === d.id), next); }); },
          });
        } else if (btn.dataset.delete && App.confirm(`Ta bort skulden "${d.name}"?`)) {
          App.update(s => {
            s.debts = s.debts.filter(x => x.id !== d.id);
            s.bills.forEach(b => { if (b.debtId === d.id) delete b.debtId; });
          });
        }
      });

      root.querySelector('#debtForm').addEventListener('submit', e => {
        e.preventDefault();
        const d = readDebt(new FormData(e.target));
        if (!d.original) d.original = d.balance;
        App.update(s => { s.debts.push({ id: uid(), ...d, payments: [] }); });
      });
    },
  });
})();
