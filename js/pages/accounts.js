// Förmögenhet – nettoförmögenheten (tillgångar minus skulder) och alla konton på ett ställe.
// Saldot räknas fram: startsaldo + alla transaktioner på kontot. Utgifter i en
// sparkategori som är kopplad till ett konto flyttar pengarna dit.
(() => {
  const { fmt, calc, ui, charts, esc, uid, iso, today } = App;

  const TYPES = { checking: 'Lönekonto', savings: 'Sparkonto', investment: 'Investering' };
  const TYPE_COLOR = { checking: 'var(--dark)', savings: 'var(--caramel)', investment: 'var(--rose)' };
  const open = new Set();   // vilka konton som är utfällda (överlever omritning)

  // Historik räknas fram från konton och skulder vid slutet av varje budgetperiod
  const history = () => calc.netWorthSeries(calc.historyKeys(12));
  const shortLabel = key => `${fmt.monthShort(Number(key.slice(5)) - 1)} ${key.slice(2, 4)}`;
  // Kategorier som kan kopplas till ett konto: typen Sparande, plus de som redan är kopplade
  function savingCategories(s) {
    const linked = new Set(s.accounts.flatMap(a => a.categories || []));
    return s.categories.filter(c => calc.isSaving(c.name) || linked.has(c.name));
  }

  const signed = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt.money(Math.abs(v))}`;

  function accountRow(s, a, def, cats) {
    const recent = calc.accountTx(a.id).slice(0, 5);
    const linked = a.categories || [];
    const isDef = def && def.id === a.id;
    const sub = [TYPES[a.type] || '', linked.length ? `Får: ${linked.join(', ')}` : ''].filter(Boolean).map(esc).join(' · ');
    const rec = a.reconciled
      ? `Senast avstämt ${fmt.date(a.reconciled.date)}${a.reconciled.diff ? ` (justerat ${signed(a.reconciled.diff)})` : ' (stämde)'}`
      : 'Inte avstämt mot banken än';
    const invest = a.type === 'investment';
    const pct = a.deposited > 0 ? ` (${a.gain >= 0 ? '+' : '−'}${fmt.pct(Math.abs(a.gain) / a.deposited, 1)})` : '';
    const gainLine = a.valuation
      ? `<p class="acc-gain">Insatt ${fmt.money0(a.deposited)} · <span class="${a.gain < 0 ? 'neg' : 'pos'}">${signed(a.gain)}${pct}</span></p>`
      : '';
    const history = (a.valuations || []).slice().sort((x, y) => y.date.localeCompare(x.date));

    // Investeringskonton: logga marknadsvärdet. Övriga konton: stäm av mot banken.
    const topBlock = invest ? `
          <div class="acc-reconcile">
            <p class="field-label">Uppdatera värde</p>
            <p class="muted">${a.valuation
              ? `Senast ${fmt.date(a.valuation.date)}: ${fmt.money(a.valuation.value)}. Insättningar efter det läggs till automatiskt tills du uppdaterar igen.`
              : 'Skriv in vad kontot är värt enligt banken. Utan värde visas bara det du har satt in.'}</p>
            <div class="acc-inline acc-value">
              <input type="date" data-value-date="${a.id}" value="${iso(today())}" required aria-label="Datum för värdet">
              ${ui.moneyInput(`data-value="${a.id}" placeholder="Värde" aria-label="Värde enligt banken för ${esc(a.name)}"`)}
              <button class="btn btn-secondary btn-small" data-value-save="${a.id}">Spara värde</button>
            </div>
            ${history.length ? `<ul class="rows acc-tx acc-values">${history.slice(0, 6).map(v => `<li>
              <span class="acc-tx-name">${fmt.date(v.date)}</span>
              <span class="acc-value-right"><b>${fmt.money(v.value)}</b>
              <button class="icon-btn" data-value-del="${a.id}" data-date="${v.date}" aria-label="Ta bort värdet ${fmt.date(v.date)}">${ui.icon('x', 12)}</button></span></li>`).join('')}</ul>` : ''}
          </div>` : `
          <div class="acc-reconcile">
            <p class="field-label">Stäm av mot banken</p>
            <p class="muted">${rec}</p>
            <div class="acc-inline">
              ${ui.moneyInput(`data-bank="${a.id}" placeholder="Saldo enligt banken" aria-label="Saldo enligt banken för ${esc(a.name)}"`)}
              <button class="btn btn-secondary btn-small" data-reconcile="${a.id}">Stäm av</button>
            </div>
          </div>`;
    return `<li class="acc-item">
      <details data-acc="${a.id}" ${open.has(a.id) ? 'open' : ''}>
        <summary class="acc-row">
          ${ui.avatar(a.name || '?', TYPE_COLOR[a.type] || 'var(--dark)')}
          <div class="acc-name"><b>${esc(a.name)}</b> ${isDef ? ui.pill('Standardkonto', 'soft') : ''}<p class="muted">${sub}</p>${gainLine}</div>
          <span class="acc-amount amount ${a.balance < 0 ? 'neg' : ''}">${fmt.money(a.balance)}</span>
          <span class="acc-chevron" aria-hidden="true">${ui.icon('down', 14)}</span>
        </summary>
        <div class="acc-detail">${topBlock}
          <div class="form-grid">
            ${ui.field('Namn', `<input data-name="${a.id}" value="${esc(a.name)}">`)}
            ${ui.field('Typ', `<select data-type="${a.id}">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === a.type ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
            ${ui.field('Startsaldo', ui.moneyInput(`data-start="${a.id}" value="${Number(a.startBalance) || 0}"`))}
          </div>
          <p class="muted acc-help">${invest
            ? 'Startsaldot är vad du hade satt in när du började med budgeten. Insatt = startsaldo + alla insättningar och uttag.'
            : 'Startsaldot är vad kontot hade när du började med budgeten. Saldot ovan = startsaldo + alla transaktioner.'}</p>

          ${cats.length ? `<div class="acc-cats">
            <p class="field-label">Sparkategorier som hamnar på det här kontot</p>
            <div class="acc-checks">${cats.map(c => `<label class="check"><input type="checkbox" data-cat="${esc(c.name)}" data-acc-id="${a.id}" ${linked.includes(c.name) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div>
            <p class="muted acc-help">En utgift i kategorin flyttar pengarna hit från kontot den betalades från. Ett uttag (negativt belopp) flyttar tillbaka dem.</p>
          </div>` : ''}

          <div class="acc-recent">
            <p class="field-label">Senaste rörelser</p>
            ${recent.length ? `<ul class="rows acc-tx">${recent.map(({ t, amount }) => `<li>
              <span class="acc-tx-name">${esc(t.title || t.category)}<span class="muted"> · ${fmt.dateShort(t.date)}</span></span>
              <b class="${amount >= 0 ? 'pos' : ''}">${signed(amount)}</b></li>`).join('')}</ul>`
              : '<p class="muted">Inga transaktioner på kontot ännu.</p>'}
          </div>

          <div class="acc-actions">
            ${isDef ? '' : `<button class="btn btn-secondary btn-small" data-default="${a.id}">Gör till standardkonto</button>`}
            <button class="btn btn-secondary btn-small" data-remove="${a.id}">${ui.icon('x', 12)} Ta bort</button>
          </div>
        </div>
      </details>
    </li>`;
  }

  App.page({
    id: 'formogenhet',
    title: 'Förmögenhet',
    heading: 'Förmögenhet',
    icon: 'chart',

    render(s) {
      const accounts = calc.accounts();
      const archived = s.accounts.filter(a => a.archived);
      const def = calc.defaultAccount();
      const cats = savingCategories(s);
      const assets = calc.assets();
      const liab = calc.totalDebt();
      const noAccount = s.transactions.filter(t => !t.accountId).length;

      const hero = `<section class="nw-hero">
        <p class="overline">Nettoförmögenhet</p>
        <p class="nw-hero-value">${fmt.money(calc.netWorth())}</p>
        <p class="nw-hero-sub">Tillgångar ${fmt.money(assets)} − skulder ${fmt.money(liab)}. Räknas fram av sig självt vid slutet av varje budgetmånad.</p>
        <div class="chart" id="nwHeroChart"></div>
      </section>`;

      const list = ui.card({
        overline: 'Det du äger', title: 'Konton',
        right: `<b class="amount nw-sum">${fmt.money(assets)}</b>`,
        body: accounts.length
          ? `<ul class="rows acc-list">${accounts.map(a => accountRow(s, a, def, cats)).join('')}</ul>
             <p class="muted acc-help">Saldo = startsaldo + alla transaktioner på kontot. Transaktioner utan konto räknas på standardkontot${def ? ` (${esc(def.name)})` : ''}${noAccount ? `, just nu ${fmt.num(noAccount)} st` : ''}. Tryck på ett konto för att stämma av mot banken, ändra eller koppla sparkategorier.</p>`
          : ui.empty('Inga konton ännu', 'Lägg till ditt första konto i formuläret.'),
      });

      const liabRows = [
        ...calc.debts().filter(d => d.balance > 0).map(d => ({ name: d.name, value: d.balance })),
        ...accounts.filter(a => a.balance < 0).map(a => ({ name: a.name, value: -a.balance })),
      ];
      const debtsCard = ui.card({
        overline: 'Det du är skyldig', title: 'Skulder',
        right: `<b class="amount nw-sum">${fmt.money(liab)}</b>`,
        body: `${liabRows.length ? `<ul class="rows">${liabRows.map(l => `<li><span style="flex:1">${esc(l.name)}</span><b>${fmt.money(l.value)}</b></li>`).join('')}</ul>` : '<p class="muted">Inga skulder. Snyggt!</p>'}
          <p class="muted acc-help"><a class="link" href="#/skulder">Hantera skulder under Mål</a></p>`,
      });
      const add = ui.card({
        overline: 'Skapa', title: 'Lägg till konto',
        body: `<form id="accForm" class="form-stack">
          ${ui.field('Namn', '<input name="name" required placeholder="t.ex. Lönekonto">')}
          ${ui.field('Typ', `<select name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`)}
          ${ui.field('Startsaldo', ui.moneyInput('name="start" value="0"'))}
          <p class="muted">Vad kontot hade när du började med budgeten. Har du lagt in alla transaktioner sedan dess kan du lämna 0.</p>
          <button class="btn btn-primary btn-block" type="submit">Lägg till konto</button>
        </form>`,
      });

      const arch = archived.length ? ui.card({
        overline: 'Arkiv', title: 'Arkiverade konton',
        body: `<p class="muted acc-help">Arkiverade konton räknas inte i tillgångarna, men deras transaktioner finns kvar.</p>
          <ul class="rows">${archived.map(a => `<li><span style="flex:1">${esc(a.name)}</span>
            <button class="btn btn-secondary btn-small" data-restore="${a.id}">Återställ</button></li>`).join('')}</ul>`,
      }) : '';

      return `${hero}<div class="grid-2-1">${list}<div class="stack">${debtsCard}${add}${arch}</div></div>`;
    },

    mount(root) {
      const rows = history();
      charts.bars(root.querySelector('#nwHeroChart'), {
        label: 'Nettoförmögenhet per månad', labels: rows.map(r => shortLabel(r.key)),
        tooltipLabels: rows.map(r => fmt.cap(fmt.month(r.key))), wide: true, onDark: true, highlightLast: true, height: 170,
        series: [{ name: 'Nettoförmögenhet', color: '#b9a48c', highlight: '#fffaf2', values: rows.map(r => Math.max(0, r.value)) }],
      });
      const edit = (id, fn) => App.update(st => { const a = st.accounts.find(x => x.id === id); if (a) fn(a, st); });

      root.querySelectorAll('details[data-acc]').forEach(d => d.addEventListener('toggle', () => {
        d.open ? open.add(d.dataset.acc) : open.delete(d.dataset.acc);
      }));

      root.addEventListener('change', e => {
        const el = e.target;
        if (el.dataset.name) { const v = el.value.trim(); if (v) edit(el.dataset.name, a => { a.name = v; }); }
        else if (el.dataset.type) edit(el.dataset.type, a => { a.type = el.value; });
        else if (el.dataset.start) edit(el.dataset.start, a => { a.startBalance = Number(el.value) || 0; });
        else if (el.dataset.cat) {
          const cat = el.dataset.cat;
          App.update(st => {
            // En kategori kan bara höra till ett konto
            st.accounts.forEach(a => { a.categories = (a.categories || []).filter(c => c !== cat); });
            if (el.checked) { const a = st.accounts.find(x => x.id === el.dataset.accId); if (a) a.categories.push(cat); }
          });
        }
      });

      root.addEventListener('click', async e => {
        const btn = e.target.closest('button[data-reconcile], button[data-default], button[data-remove], button[data-restore], button[data-value-save], button[data-value-del]');
        if (!btn) return;
        const { reconcile, default: def, remove, restore, valueSave, valueDel } = btn.dataset;

        if (valueSave) {
          const input = root.querySelector(`[data-value="${valueSave}"]`);
          const date = root.querySelector(`[data-value-date="${valueSave}"]`).value || iso(today());
          if (input.value === '') { input.focus(); return; }
          const value = Math.round((Number(input.value) || 0) * 100) / 100;
          // Ett värde per dag: samma datum skriver över
          edit(valueSave, a => { a.valuations = [...(a.valuations || []).filter(v => v.date !== date), { date, value }]; });
          return;
        }
        if (valueDel) {
          edit(valueDel, a => { a.valuations = (a.valuations || []).filter(v => v.date !== btn.dataset.date); });
          return;
        }
        if (reconcile) {
          const input = root.querySelector(`[data-bank="${reconcile}"]`);
          if (input.value === '') { input.focus(); return; }
          const bank = Number(input.value) || 0;
          const current = calc.balances()[reconcile] || 0;
          const diff = Math.round((bank - current) * 100) / 100;
          edit(reconcile, a => {
            a.startBalance = Math.round(((Number(a.startBalance) || 0) + diff) * 100) / 100;
            a.reconciled = { date: iso(today()), diff };
          });
        } else if (def) {
          App.update(st => { st.settings.defaultAccountId = def; });
        } else if (restore) {
          edit(restore, a => { a.archived = false; });
        } else if (remove) {
          const a = App.state.accounts.find(x => x.id === remove);
          if (!a) return;
          const used = App.state.transactions.some(t => t.accountId === a.id) || calc.accountTx(a.id).length > 0;
          if (used) {
            if (!await App.confirm(`Kontot "${a.name}" har transaktioner. Det arkiveras i stället för att tas bort, så att historiken finns kvar.`, { ok: 'Arkivera' })) return;
            App.update(st => {
              const x = st.accounts.find(y => y.id === a.id);
              x.archived = true;
              x.categories = [];
              if (st.settings.defaultAccountId === a.id) st.settings.defaultAccountId = '';
            });
          } else if (await App.confirm(`Ta bort kontot "${a.name}"?`)) {
            App.update(st => {
              st.accounts = st.accounts.filter(x => x.id !== a.id);
              st.goals.forEach(g => { if (g.accountId === a.id) g.accountId = ''; });
              if (st.settings.defaultAccountId === a.id) st.settings.defaultAccountId = '';
            });
          }
        }
      });

      root.querySelector('#accForm').addEventListener('submit', e => {
        e.preventDefault();
        const f = new FormData(e.target);
        const name = String(f.get('name')).trim();
        if (!name) return;
        App.update(st => {
          const id = uid();
          st.accounts.push({ id, name, type: f.get('type'), startBalance: Number(f.get('start')) || 0, categories: [], archived: false });
          if (!st.settings.defaultAccountId && f.get('type') === 'checking') st.settings.defaultAccountId = id;
        });
      });
    },
  });
})();
