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

  // Kategorier som kan betala av en skuld: märkta som Skuldbetalning under Inställningar, plus redan kopplade
  function debtCategories(s) {
    const linked = new Set(s.debts.flatMap(d => d.categories || []));
    return s.categories.filter(c => calc.isDebt(c.name) || linked.has(c.name));
  }

  // Ny skuld: förfallodag om 30 dagar
  const in30 = () => { const t = today(); t.setDate(t.getDate() + 30); return iso(t); };

  function debtFields(s, d = {}) {
    const cats = debtCategories(s);
    const mine = d.categories || [];
    const lenders = s.lenders || [];
    const type = d.type || 'invoice';
    return `
      <div class="seg-control debt-type" role="radiogroup" aria-label="Typ av skuld">
        <label><input type="radio" name="type" value="invoice" ${type === 'invoice' ? 'checked' : ''}><span>Inom 30 dagar</span></label>
        <label><input type="radio" name="type" value="installment" ${type === 'installment' ? 'checked' : ''}><span>Avbetalning</span></label>
      </div>
        ${ui.field('Långivare', `<select name="lender" data-lender-select>
          <option value="">Ingen</option>
          ${lenders.map(l => `<option value="${l.id}" ${l.id === d.lenderId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
          <option value="__new">+ Ny långivare…</option>
        </select>`)}
      <div data-lender-new hidden>${ui.field('Ny långivare', '<input name="lenderName" maxlength="30" placeholder="t.ex. Klarna">')}</div>
        ${ui.field('Namn på skulden', `<input name="name" required value="${esc(d.name ?? '')}" placeholder="t.ex. Soffa">`)}
      ${ui.field('<span data-amount-label>Belopp</span>', ui.moneyInput(`name="original" min="0" step="any" value="${d.original ?? 0}"`))}
      <div data-for="invoice">
        ${ui.field('Förfallodag', `<input type="date" name="dueDate" value="${d.dueDate || in30()}">`)}
      </div>
      <div class="form-grid" data-for="installment">
        ${ui.field('Månadsbetalning', ui.moneyInput(`name="installment" min="0" value="${d.installment ?? 0}"`))}
        ${ui.field('Extra per månad', ui.moneyInput(`name="extra" min="0" value="${d.extra ?? 0}"`))}
        ${ui.field('Betalningsdag', `<input type="number" name="payDay" min="1" max="31" value="${d.payDay ?? 28}">`)}
        ${ui.field('Ränta % (valfritt)', `<input type="number" name="apr" step="0.01" min="0" value="${d.apr ?? ''}">`)}
      </div>
      <p class="muted debt-type-help" data-for="invoice">Skulden dyker upp under Räkningar på förfallodagen. Är det en helg eller röd dag flyttas den till nästa bankdag. Tryck Betala där när du har betalat.</p>
      <p class="muted debt-type-help" data-for="installment">Varje månad dyker avbetalningen upp under Räkningar på betalningsdagen, tills skulden är betald. Är det en helg eller röd dag dras pengarna nästa bankdag. Extra per månad är om du vill betala mer än du måste för att bli klar snabbare.</p>
      ${cats.length ? `<div class="field"><span class="field-label">Betalas av med kategori (valfritt)</span>
        <div class="acc-checks">${cats.map(c => `<label class="check"><input type="checkbox" name="categories" value="${esc(c.name)}" ${mine.includes(c.name) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div>
        <span class="muted">Alla utgifter i kategorin minskar skulden. Delar flera skulder samma kategori, lämna den tom och välj skulden på varje transaktion i stället.</span></div>` : ''}
      ${ui.field('Anteckningar', `<textarea name="notes">${esc(d.notes || '')}</textarea>`)}`;
  }

  // Visa fälten för vald typ av skuld
  function wireType(form) {
    const sync = () => {
      const type = form.querySelector('[name=type]:checked').value;
      form.querySelectorAll('[data-for]').forEach(el => { el.hidden = el.dataset.for !== type; });
      form.querySelector('[data-amount-label]').textContent = type === 'invoice' ? 'Belopp att betala' : 'Skuld när du började';
    };
    form.querySelectorAll('[name=type]').forEach(r => r.addEventListener('change', sync));
    sync();
  }

  // Visa fältet för en ny långivare när "+ Ny långivare…" väljs
  function wireLender(form) {
    const sel = form.querySelector('[data-lender-select]');
    const box = form.querySelector('[data-lender-new]');
    const sync = () => { box.hidden = sel.value !== '__new'; if (!box.hidden) box.querySelector('input').focus(); };
    sel.addEventListener('change', sync);
    sync();
  }
  // Långivaren från formuläret: befintlig, ny (skapas i st) eller ingen
  function lenderFrom(st, f) {
    const v = String(f.get('lender') || '');
    if (v !== '__new') return v || '';
    const name = String(f.get('lenderName') || '').trim();
    if (!name) return '';
    st.lenders = st.lenders || [];
    const same = st.lenders.find(l => l.name.toLowerCase() === name.toLowerCase());
    if (same) return same.id;
    const id = uid();
    st.lenders.push({ id, name });
    return id;
  }

  const readDebt = f => {
    const n = k => Math.abs(Number(f.get(k)) || 0);
    const type = f.get('type') === 'installment' ? 'installment' : 'invoice';
    const base = {
      type,
      name: String(f.get('name')).trim() || 'Skuld',
      original: n('original'),
      categories: f.getAll('categories').map(String),
      notes: String(f.get('notes') || '').trim(),
    };
    return type === 'invoice'
      ? { ...base, dueDate: f.get('dueDate') || '', installment: 0, extra: 0, payDay: '', apr: '' }
      : { ...base, dueDate: '', installment: n('installment'), extra: n('extra'), payDay: Math.min(31, Math.max(1, n('payDay') || 1)), apr: f.get('apr') === '' ? '' : n('apr') };
  };

  App.page({
    id: 'skulder',
    group: 'mal',
    tab: 'Skulder',
    title: 'Skuldavbetalning',
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

      // Per långivare: totalen att jämföra med t.ex. Klarna-appen
      const byLender = calc.debtsByLender().filter(g => g.lender || g.debts.length);
      const lenderCard = (s.lenders || []).length ? ui.card({
        overline: 'Per långivare', title: 'Totalt hos varje långivare',
        body: `<ul class="rows debt-lenders">${byLender.map(g => `<li>
            <div style="flex:1;min-width:0"><b>${g.lender ? esc(g.lender.name) : 'Utan långivare'}</b>
              <p class="muted">${g.debts.length} ${g.debts.length === 1 ? 'skuld' : 'skulder'}${g.monthly ? ` · ${fmt.money(g.monthly)}/mån` : ''}</p></div>
            <b class="amount debt-lender-sum">${fmt.money(g.balance)}</b>
            ${g.lender ? `<button class="icon-btn" data-lender-edit="${g.lender.id}" aria-label="Byt namn på ${esc(g.lender.name)}">${ui.icon('cog', 14)}</button>` : ''}
            ${g.lender && !g.debts.length ? `<button class="icon-btn" data-lender-del="${g.lender.id}" aria-label="Ta bort ${esc(g.lender.name)}">${ui.icon('x', 14)}</button>` : ''}
          </li>`).join('')}</ul>
          <p class="muted debt-lender-help">Jämför totalen med saldot i långivarens app. Stämmer det inte, tryck Stäm av saldo på den skuld som skiljer.</p>`,
      }) : '';

      const strategy = `<div class="debt-strategy">
        ${ui.field('Avbetalningsstrategi', `<select id="debtStrategy">${Object.entries(STRATEGIES).map(([k, v]) => `<option value="${k}" ${s.strategy === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
        <p class="muted">Det här ändrar bara den rekommenderade ordningen, aldrig dina betalningar.</p>
      </div>`;

      const cards = list.length ? list.map((d, i) => {
        const months = calc.debtMonthsRemaining(d);
        const paidOff = d.balance <= 0;
        const invoice = (d.type || 'invoice') === 'invoice';
        // Betala inom 30 dagar: dagar kvar till förfallodagen (negativt = försenad)
        // Förfallodag på helg eller röd dag räknas till nästa bankdag
        const due = invoice && d.dueDate ? App.nextBankDay(d.dueDate) : '';
        const moved = due && due !== d.dueDate;
        const daysLeft = due ? Math.round((App.parseISO(due) - today()) / 864e5) : null;
        const dueText = daysLeft == null ? 'Ingen förfallodag' : daysLeft < 0 ? `Försenad ${-daysLeft} ${-daysLeft === 1 ? 'dag' : 'dagar'}` : daysLeft === 0 ? 'Förfaller idag' : `${daysLeft} ${daysLeft === 1 ? 'dag' : 'dagar'} kvar`;
        return `<article class="debt-card ${paidOff ? 'debt-done' : ''}">
          <div class="debt-head">
            <span class="debt-num">${paidOff ? ui.icon('check', 14) : i + 1}</span>
            <div style="flex:1;min-width:0">
              <b>${esc(d.name)}</b>${calc.lenderOf(d) ? ` ${ui.pill(esc(calc.lenderOf(d).name), 'soft')}` : ''}
              <p class="muted">${invoice
                ? (due ? `Betala senast ${fmt.date(due)}${moved ? ' (helg/röd dag, flyttad till nästa bankdag)' : ''}` : 'Betala inom 30 dagar')
                : `Avbetalning${d.apr !== '' && d.apr != null ? ` · ${fmt.num(Number(d.apr), 2)} % ränta` : ''}`}</p>
            </div>
            <span class="amount debt-balance">${paidOff ? 'Betald' : fmt.money(d.balance)}</span>
          </div>
          ${invoice ? `<div class="debt-cols">
            <div><p class="stat-label">Belopp</p><p>${fmt.money(Math.max(0, (Number(d.original) || 0) + (Number(d.adjust) || 0)))}</p></div>
            <div><p class="stat-label">Betalt</p><p>${fmt.money(d.paid)}</p></div>
            <div><p class="stat-label">Förfallodag</p><p>${due ? fmt.date(due) : '–'}</p></div>
            <div><p class="stat-label">Tid kvar</p><p class="${!paidOff && daysLeft != null && daysLeft < 0 ? 'neg' : ''}">${paidOff ? 'Betald' : dueText}</p></div>
          </div>` : `<div class="debt-cols">
            <div><p class="stat-label">Betalt hittills</p><p>${fmt.money(d.paid)}</p></div>
            <div><p class="stat-label">Månadsbetalning</p><p>${fmt.money((Number(d.installment) || 0) + (Number(d.extra) || 0))}</p></div>
            <div><p class="stat-label">Betalningsdag</p><p>${d.payDay || '–'}</p></div>
            <div><p class="stat-label">Månader kvar</p><p>${paidOff ? 0 : Number.isFinite(months) ? months : '–'}</p></div>
          </div>
          ${!paidOff && !Number.isFinite(months) ? '<p class="muted debt-warn">Betalningen täcker inte räntan – skulden växer.</p>' : ''}`}
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
        body: `<form id="debtForm" class="form-stack">${debtFields(s, {})}<button class="btn btn-primary btn-block" type="submit">Lägg till skuld</button></form>`,
      });

      return `${summary}${lenderCard}${strategy}
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
        type: 'expense', amount: (d.type || 'invoice') === 'invoice' ? d.balance : Math.min(d.balance, (Number(d.installment) || 0) + (Number(d.extra) || 0)) || '',
        category: (d.categories || [])[0] || debtCategories(App.state)[0]?.name || App.state.categories[0]?.name,
        debtId: d.id, title: d.name,
      });
      const claim = (s, id, cats) => s.debts.forEach(x => { if (x.id !== id) x.categories = (x.categories || []).filter(c => !cats.includes(c)); });

      wireLender(root.querySelector('#debtForm'));
      wireType(root.querySelector('#debtForm'));

      root.addEventListener('click', async e => {
        const lb = e.target.closest('[data-lender-edit], [data-lender-del]');
        if (lb) {
          const l = (App.state.lenders || []).find(x => x.id === (lb.dataset.lenderEdit || lb.dataset.lenderDel));
          if (!l) return;
          if (lb.dataset.lenderDel) { App.update(s => { s.lenders = s.lenders.filter(x => x.id !== l.id); }); return; }
          App.formDialog({
            overline: 'Långivare', title: 'Byt namn',
            body: ui.field('Namn', `<input name="name" required maxlength="30" value="${esc(l.name)}">`),
            onSubmit(f) { const v = String(f.get('name')).trim(); if (!v) return false; App.update(s => { s.lenders.find(x => x.id === l.id).name = v; }); },
          });
          return;
        }
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
            onSubmit(f) {
              const next = readDebt(f);
              App.update(s => { next.lenderId = lenderFrom(s, f); claim(s, d.id, next.categories); const x = s.debts.find(y => y.id === d.id); Object.assign(x, next); delete x.start; delete x.end; });
            },
          });
          wireLender(document.querySelector('#dialog form'));
          wireType(document.querySelector('#dialog form'));
        } else if (btn.dataset.delete && await App.confirm(`Ta bort skulden "${d.name}"? Betalningarna finns kvar som vanliga transaktioner.`)) {
          App.update(s => {
            s.debts = s.debts.filter(x => x.id !== d.id);
            s.bills.forEach(b => { if (b.debtId === d.id) delete b.debtId; });
          });
        }
      });

      root.querySelector('#debtForm').addEventListener('submit', e => {
        e.preventDefault();
        const f = new FormData(e.target);
        const d = readDebt(f);
        App.update(s => { const id = uid(); d.lenderId = lenderFrom(s, f); claim(s, id, d.categories); s.debts.push({ id, ...d, adjust: 0 }); });
      });
    },
  });
})();
