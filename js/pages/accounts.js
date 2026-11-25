// Konton – alla konton på ett ställe. Saldon är manuella ögonblicksbilder.
(() => {
  const { fmt, calc, ui, charts, esc, uid, CATEGORY_COLORS } = App;

  const TYPES = { checking: 'Lönekonto', savings: 'Sparkonto', investment: 'Investering' };
  const TYPE_COLOR = { checking: 'var(--dark)', savings: 'var(--caramel)', investment: 'var(--rose)' };

  // Ringdiagrammets delar: färger i fast ordning, fler än 7 konton slås ihop till "Övrigt".
  function donutItems(accounts) {
    const pos = accounts.filter(a => a.balance > 0);
    const items = pos.slice(0, 7).map((a, i) => ({ name: a.name, color: CATEGORY_COLORS[i], value: a.balance }));
    const rest = pos.slice(7);
    if (rest.length) items.push({ name: 'Övrigt', color: '#8b8178', value: App.sum(rest.map(a => a.balance)) });
    return items;
  }

  App.page({
    id: 'konton',
    title: 'Konton',
    overline: 'Konton',
    icon: 'card',

    render(s) {
      const assets = calc.assets();
      const items = donutItems(s.accounts);

      const info = ui.note('Registrera varje skuld en gång: antingen som ett negativt kontosaldo eller under Skuldavbetalning. Saldona är manuella ögonblicksbilder; transaktioner ändrar dem inte automatiskt.');

      const dist = ui.card({
        overline: 'Fördelning av saldon', title: 'Var dina tillgångar finns',
        right: `<span>Totala tillgångar <b class="amount acc-total">${fmt.money(assets)}</b></span>`,
        body: items.length
          ? `<div class="donut-wrap"><div id="accDonut"></div>${charts.donutLegend(items)}</div>`
          : ui.empty('Inga tillgångar ännu', 'Lägg till ett konto med ett positivt saldo.'),
      });

      const list = ui.card({
        overline: 'Konto', title: 'Dina konton',
        right: `<span>${s.accounts.length} aktiva</span>`,
        body: s.accounts.length ? `<ul class="rows">${s.accounts.map(a => `
          <li class="acc-row">
            ${ui.avatar(a.name || '?', TYPE_COLOR[a.type] || 'var(--dark)')}
            <div class="acc-name"><b>${esc(a.name)}</b><p class="muted">${TYPES[a.type] || ''}</p></div>
            <label class="acc-balance"><span class="field-label">Saldo</span>${ui.moneyInput(`data-balance="${a.id}" value="${a.balance}" aria-label="Saldo för ${esc(a.name)}"`)}</label>
            <button class="icon-btn" data-delete="${a.id}" aria-label="Ta bort ${esc(a.name)}">${ui.icon('x', 14)}</button>
          </li>`).join('')}</ul>`
          : ui.empty('Inga konton ännu', 'Lägg till ditt första konto i formuläret.'),
      });

      const add = ui.card({
        overline: 'Skapa', title: 'Lägg till konto',
        body: `<form id="accForm" class="form-stack">
          ${ui.field('Namn', '<input name="name" required value="Nytt konto">')}
          ${ui.field('Startsaldo', ui.moneyInput('name="balance" value="0"'))}
          ${ui.field('Typ', `<select name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`)}
          <button class="btn btn-primary btn-block" type="submit">Lägg till konto</button>
        </form>`,
      });

      return `${info}${dist}<div class="grid-2-1">${list}${add}</div>`;
    },

    mount(root, s) {
      const assets = calc.assets();
      charts.donut(root.querySelector('#accDonut'), {
        items: donutItems(s.accounts), size: 190, label: 'Tillgångar per konto',
        center: { label: 'Totalt', value: fmt.money0(assets) },
      });

      root.addEventListener('change', e => {
        const id = e.target.dataset.balance;
        if (!id) return;
        const value = Number(e.target.value) || 0;
        App.update(st => { const a = st.accounts.find(x => x.id === id); if (a) a.balance = value; });
      });

      root.addEventListener('click', e => {
        const btn = e.target.closest('[data-delete]');
        if (!btn) return;
        const a = App.state.accounts.find(x => x.id === btn.dataset.delete);
        if (a && App.confirm(`Ta bort kontot "${a.name}"?`)) {
          App.update(st => {
            st.accounts = st.accounts.filter(x => x.id !== a.id);
            st.goals.forEach(g => { if (g.accountId === a.id) g.accountId = ''; });
          });
        }
      });

      root.querySelector('#accForm').addEventListener('submit', e => {
        e.preventDefault();
        const f = new FormData(e.target);
        const name = String(f.get('name')).trim();
        if (!name) return;
        App.update(st => { st.accounts.push({ id: uid(), name, type: f.get('type'), balance: Number(f.get('balance')) || 0 }); });
      });
    },
  });
})();
