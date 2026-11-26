// Skuldavbetalning – saldot minskar av kopplade transaktioner (t.ex. Klarna, Walley).
// Saldo = skuld vid start + justeringar − kopplade betalningar.
(() => {
  const { fmt, calc, ui, esc, uid, iso, today, sum } = App;

  const STRATEGIES = {
    snowball: 'Snöboll – minsta saldot först',
    avalanche: 'Lavin – högsta räntan först',
  };

  function ordered(s) {
    const debts = calc.debts();
    const active = debts.filter(d => d.balance > 0);
    const done = debts.filter(d => d.balance <= 0);
    active.sort(s.strategy === 'avalanche'
      ? (a, b) => (Number(b.apr) || 0) - (Number(a.apr) || 0) || a.balance - b.balance
      : (a, b) => a.balance - b.balance);
    return [...active, ...done];
  }

  // Kategorier som kan betala av en skuld: de som heter något med lån/skuld/avbetalning, plus redan kopplade
  function debtCategories(s) {
    const linked = new Set(s.debts.flatMap(d => d.categories || []));
    return s.categories.filter(c => /lån|skuld|avbetal|kredit|klarna|walley|debt|loan/i.test(c.name + ' ' + (c.parent || '')) || linked.has(c.name));
  }

  function debtFields(s, d = {}) {
    const cats = debtCategories(s);
    const mine = d.categories || [];
    return `
      ${ui.field('Namn', `<input name="name" required value="${esc(d.name ?? '')}" placeholder="t.ex. Klarna">`)}
      <div class="form-grid">
        ${ui.field('Skuld när du började', ui.moneyInput(`name="original" min="0" step="any" value="${d.original ?? 0}"`))}
        ${ui.field('Ränta % (valfritt)', `<input type="number" name="apr" step="0.01" min="0" value="${d.apr ?? ''}">`)}
        ${ui.field('Månadsbetalning', ui.moneyInput(`name="installment" min="0" value="${d.installment ?? 0}"`))}
        ${ui.field('Extra per månad', ui.moneyInput(`name="extra" min="0" value="${d.extra ?? 0}"`))}
        ${ui.field('Betalningsdag', `<input type="number" name="payDay" min="1" max="31" value="${d.payDay ?? 1}">`)}
        ${ui.field('Startdatum', `<input type="date" name="start" value="${d.start || ''}">`)}
        ${ui.field('Slutdatum (valfritt)', `<input type="date" name="end" value="${d.end || ''}">`)}
      </div>
      ${cats.length ? `<div class="field"><span class="field-label">Betalas av med kategori (valfritt)</span>
        <div class="acc-checks">${cats.map(c => `<label class="check"><input type="checkbox" name="categories" value="${esc(c.name)}" ${mine.includes(c.name) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div>
        <span class="muted">Alla utgifter i kategorin minskar skulden. Delar flera skulder samma kategori (t.ex. Avbetalningar för både Klarna och Walley), lämna den tom och välj skulden på varje transaktion i stället.</span></div>` : ''}
      ${ui.field('Anteckningar', `<textarea name="notes">${esc(d.notes || '')}</textarea>`)}`;
  }
  const readDebt = f => {
    const n = k => Math.abs(Number(f.get(k)) || 0);
    return {
      name: String(f.get('name')).trim() || 'Skuld',
      original: n('original'),
      categories: f.getAll('categories').map(String),
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
      const debts = calc.debts();
      const original = sum(debts.map(d => Math.max(0, (Number(d.original) || 0) + (Number(d.adjust) || 0))));
      const remaining = sum(debts.map(d => d.balance));
      const repaid = Math.max(0, original - remaining);
      const monthly = sum(debts.filter(d => d.balance > 0).map(d => (Number(d.installment) || 0) + (Number(d.extra) || 0)));
      const progress = original > 0 ? repaid / original : 0;
      const list = ordered(s);
      const active = debts.filter(d => d.balance > 0).length;

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
            <div><p class="stat-label">Betalt hittills</p><p>${fmt.money(d.paid)}</p></div>
            <div><p class="stat-label">Månadsbetalning</p><p>${fmt.money((Number(d.installment) || 0) + (Number(d.extra) || 0))}</p></div>
            <div><p class="stat-label">Betalningsdag</p><p>${d.payDay || '–'}</p></div>
            <div><p class="stat-label">Månader kvar</p><p>${paidOff ? 0 : Number.isFinite(months) ? months : '–'}</p></div>
          </div>
          ${!paidOff && !Number.isFinite(months) ? '<p class="muted debt-warn">Betalningen täcker inte räntan – skulden växer.</p>' : ''}
          ${(d.categories || []).length ? `<p class="muted">Betalas av med ${esc(d.categories.join(', '))}</p>` : ''}
          <div class="debt-actions">
            ${paidOff ? '' : `<button class="btn btn-primary" data-pay="${d.id}">Registrera betalning</button>`}
            <button class="btn btn-secondary" data-adjust="${d.id}">Stäm av saldo</button>
            <button class="btn btn-secondary" data-edit="${d.id}">Redigera</button>
            <button class="btn btn-danger" data-delete="${d.id}">Ta bort</button>
          </div>
          ${(() => { const tx = calc.debtTx(d.id); return `<details class="goal-history">
            <summary>Betalningar${tx.length ? ` (${tx.length})` : ''}</summary>
            ${tx.length ? `<ul class="rows">${tx.map(t => `<li class="tx-row" data-tx="${t.id}"><span class="muted">${fmt.date(t.date)}</span><span style="flex:1">${esc(t.title || t.category)}</span><b>${t.amount < 0 ? '+' : '−'}${fmt.money(Math.abs(t.amount))}</b></li>`).join('')}</ul>` : '<p class="muted">Inga betalningar kopplade ännu.</p>'}
            ${Number(d.adjust) ? `<p class="muted">Justering vid avstämning: ${d.adjust > 0 ? '+' : '−'}${fmt.money(Math.abs(d.adjust))}</p>` : ''}
          </details>`; })()}
        </article>`;
      }).join('') : ui.card({ body: ui.empty('Inga skulder', 'Lägg till en skuld för att följa avbetalningen.') });

      const add = ui.card({
        overline: 'Skapa', title: 'Lägg till skuld',
        body: `<form id="debtForm" class="form-stack">${debtFields(s, { payDay: 1 })}<button class="btn btn-primary btn-block" type="submit">Lägg till skuld</button></form>`,
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

      // En betalning blir en vanlig transaktion, så att konto och budget följer med
      const pay = d => App.openTransactionDialog({
        type: 'expense', amount: (Number(d.installment) || 0) + (Number(d.extra) || 0) || '',
        category: (d.categories || [])[0] || debtCategories(App.state)[0]?.name || App.state.categories[0]?.name,
        debtId: d.id, title: d.name,
      });
      const claim = (s, id, cats) => s.debts.forEach(x => { if (x.id !== id) x.categories = (x.categories || []).filter(c => !cats.includes(c)); });

      root.addEventListener('click', e => {
        const row = e.target.closest('[data-tx]');
        if (row) { const t = App.state.transactions.find(x => x.id === row.dataset.tx); if (t) App.openTransactionDialog({ ...t }); return; }
        const btn = e.target.closest('button');
        if (!btn) return;
        const id = btn.dataset.pay || btn.dataset.adjust || btn.dataset.edit || btn.dataset.delete;
        const d = calc.debts().find(x => x.id === id);
        if (!d) return;
        if (btn.dataset.pay) pay(d);
        else if (btn.dataset.adjust) {
          App.formDialog({
            overline: esc(d.name), title: 'Stäm av saldo',
            body: `${ui.field('Skulden enligt långivaren', ui.moneyInput(`name="actual" required min="0" step="any" value="${d.balance}"`))}
                   <p class="muted">Använd när t.ex. ränta eller avgifter gjort att skulden inte stämmer. Appen sparar skillnaden som en justering.</p>`,
            onSubmit(f) {
              const diff = Math.round(((Number(f.get('actual')) || 0) - d.balance) * 100) / 100;
              App.update(s => { const x = s.debts.find(y => y.id === d.id); x.adjust = Math.round(((Number(x.adjust) || 0) + diff) * 100) / 100; });
            },
          });
        } else if (btn.dataset.edit) {
          App.formDialog({
            overline: 'Skuld', title: 'Redigera skuld', body: debtFields(App.state, d),
            onSubmit(f) { const next = readDebt(f); App.update(s => { claim(s, d.id, next.categories); Object.assign(s.debts.find(x => x.id === d.id), next); }); },
          });
        } else if (btn.dataset.delete && App.confirm(`Ta bort skulden "${d.name}"? Betalningarna finns kvar som vanliga transaktioner.`)) {
          App.update(s => {
            s.debts = s.debts.filter(x => x.id !== d.id);
            s.bills.forEach(b => { if (b.debtId === d.id) delete b.debtId; });
          });
        }
      });

      root.querySelector('#debtForm').addEventListener('submit', e => {
        e.preventDefault();
        const d = readDebt(new FormData(e.target));
        App.update(s => { const id = uid(); claim(s, id, d.categories); s.debts.push({ id, ...d, adjust: 0 }); });
      });
    },
  });
})();
