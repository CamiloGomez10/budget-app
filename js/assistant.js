// AI-assistent: en chatt där du kan fråga om din ekonomi eller be den lägga in,
// ändra eller ta bort transaktioner. Frågan går via mellanstationen i Supabase
// (supabase/functions/assistent) till Claude. Claude väljer verktyg, verktygen körs
// här i appen på din egen data, och allt som ändrar något måste du godkänna först.
(() => {
  const { calc, fmt, esc, uid, iso, today, period, sum } = App;
  const FUNCTION = 'assistent';
  const MAX_STEPS = 12;     // max antal verktygsvändor per fråga
  const MAX_ROWS = 100;     // max antal transaktioner i ett sökresultat

  let history = [];         // hela konversationen som Claude ser den
  let busy = false;
  let els = null;

  // ---------- Verktygen Claude får använda ----------
  const DATE = { type: 'string', description: 'Datum som YYYY-MM-DD' };
  const TOOLS = [
    {
      name: 'search_transactions',
      description: 'Sök bland användarens transaktioner. Använd för frågor om enskilda köp, vad något kostade, när något betalades eller för att hitta transaktioner som ska ändras eller tas bort. Alla filter är valfria och kombineras.',
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Fritext som matchar beskrivning, kategori eller konto (skiftlägesokänsligt)' },
          category: { type: 'string', description: 'Exakt kategorinamn' },
          type: { type: 'string', enum: ['expense', 'income', 'transfer'] },
          date_from: DATE,
          date_to: DATE,
          min_amount: { type: 'number' },
          max_amount: { type: 'number' },
          account: { type: 'string', description: 'Kontonamn' },
          limit: { type: 'integer', description: `Max antal rader att visa, standard 25, högst ${MAX_ROWS}` },
        },
      },
    },
    {
      name: 'spending_summary',
      description: 'Summera utgifter eller inkomster mellan två datum, grupperat. Använd för frågor som "hur mycket har jag lagt på mat i år" eller "vilken kategori kostar mest".',
      input_schema: {
        type: 'object',
        properties: {
          date_from: DATE,
          date_to: DATE,
          group_by: { type: 'string', enum: ['category', 'parent', 'month', 'title'], description: 'category = kategori, parent = huvudkategori, month = månad, title = beskrivning (t.ex. butik)' },
          type: { type: 'string', enum: ['expense', 'income'], description: 'Standard: expense' },
        },
        required: ['date_from', 'date_to', 'group_by'],
      },
    },
    {
      name: 'budget_status',
      description: 'Budget mot utfall för en budgetperiod: planerat, faktiskt och kvar per kategori. Använd för frågor om budgeten och hur mycket som finns kvar att spendera.',
      input_schema: {
        type: 'object',
        properties: { period: { type: 'string', description: 'Budgetperiod som YYYY-MM. Utelämna för innevarande period.' } },
      },
    },
    {
      name: 'financial_overview',
      description: 'Kontosaldon, sparmål, skulder, nettoförmögenhet och räkningar de närmaste 30 dagarna.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'create_transactions',
      description: 'Lägg till en eller flera transaktioner. Appen visar ett förslag som användaren godkänner eller avbryter, så fråga inte om lov i text först. Kategorin måste vara en av de befintliga.',
      input_schema: {
        type: 'object',
        properties: {
          transactions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: DATE,
                type: { type: 'string', enum: ['expense', 'income', 'transfer'] },
                amount: { type: 'number', description: 'Positivt belopp i kronor' },
                title: { type: 'string', description: 'Kort beskrivning, t.ex. butikens namn' },
                category: { type: 'string', description: 'Befintlig kategori (krävs ej för överföringar)' },
                account: { type: 'string', description: 'Kontonamn. Utelämna för standardkontot.' },
                to_account: { type: 'string', description: 'Mottagande konto, bara för överföringar' },
              },
              required: ['date', 'type', 'amount', 'title'],
            },
          },
        },
        required: ['transactions'],
      },
    },
    {
      name: 'update_transaction',
      description: 'Ändra en befintlig transaktion. Hitta id:t med search_transactions först. Användaren godkänner ändringen i appen.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          date: DATE,
          amount: { type: 'number' },
          title: { type: 'string' },
          category: { type: 'string' },
          account: { type: 'string' },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete_transactions',
      description: 'Ta bort transaktioner. Hitta id:n med search_transactions först. Användaren godkänner i appen.',
      input_schema: {
        type: 'object',
        properties: { ids: { type: 'array', items: { type: 'string' } } },
        required: ['ids'],
      },
    },
  ];

  const ACTIVITY = {
    search_transactions: 'Söker bland transaktionerna',
    spending_summary: 'Summerar',
    budget_status: 'Läser budgeten',
    financial_overview: 'Läser konton och mål',
    create_transactions: 'Förbereder transaktioner',
    update_transaction: 'Förbereder ändring',
    delete_transactions: 'Förbereder borttagning',
  };

  // Instruktioner + fakta om appen. Datumet ligger i varje fråga i stället, så att den
  // här texten är likadan varje gång och kan cachas.
  function systemPrompt() {
    const s = App.state;
    const def = calc.defaultAccount();
    const parents = [...(s.parents || []), App.OTHER_PARENT];
    const cats = parents.map(p => {
      const list = s.categories.filter(c => (c.parent || App.OTHER_PARENT) === p).map(c => c.name);
      return list.length ? `- ${p}: ${list.join(', ')}` : '';
    }).filter(Boolean).join('\n');
    const accounts = s.accounts.filter(a => !a.archived).map(a => `${a.name}${def && a.id === def.id ? ' (standard)' : ''}`).join(', ');
    return `Du är assistenten i användarens privata budgetapp. Svara på svenska, kort och vänligt, som en kunnig vän. Alla belopp är i svenska kronor.

Hämta alltid siffror med verktygen. Gissa aldrig belopp, datum eller saldon. Räcker inte ett verktygsanrop, gör flera.
När användaren vill lägga in, ändra eller ta bort något: använd verktyget direkt. Appen visar ett förslag som användaren godkänner, så fråga inte om lov i text först. Är något oklart (t.ex. vilken kategori), välj det mest rimliga och nämn det kort, eller fråga om det verkligen inte går att avgöra.
"Idag", "igår", "förra månaden" osv. räknas från dagens datum som står i användarens meddelande.
Budgeten följer budgetperioder${s.settings.payday ? ' från lönedag till lönedag' : ' (kalendermånader)'}. Perioden "2026-11" är den period som slutar i november.
Skriv utan tabeller. Använd korta stycken eller punktlistor med "- ", och **fetstil** sparsamt.

Utgiftskategorier per huvudkategori:
${cats || '- (inga)'}
Inkomstkategorier: ${s.incomeCategories.map(c => c.name).join(', ') || '(inga)'}
Konton: ${accounts || '(inga konton – transaktioner sparas utan konto)'}`;
  }

  // ---------- Verktygens kod ----------
  const accountByName = name => {
    if (!name) return null;
    const n = String(name).trim().toLowerCase();
    return App.state.accounts.find(a => !a.archived && a.name.toLowerCase() === n) || null;
  };
  const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v));
  const txOut = t => ({
    id: t.id, date: t.date, type: t.type, title: t.title || '', category: t.category,
    amount: t.amount, account: calc.accountName(t.accountId) || (calc.defaultAccount()?.name ?? ''),
    ...(t.type === 'transfer' ? { to_account: calc.accountName(t.toAccountId) } : {}),
  });
  const round = v => Math.round(v * 100) / 100;

  function searchTransactions(i) {
    let list = App.state.transactions;
    if (i.text) {
      const q = String(i.text).toLowerCase();
      list = list.filter(t => [t.title, t.category, calc.accountName(t.accountId)].some(v => (v || '').toLowerCase().includes(q)));
    }
    if (i.category) list = list.filter(t => t.category.toLowerCase() === String(i.category).toLowerCase());
    if (i.type) list = list.filter(t => t.type === i.type);
    if (i.date_from) list = list.filter(t => t.date >= i.date_from);
    if (i.date_to) list = list.filter(t => t.date <= i.date_to);
    if (i.min_amount != null) list = list.filter(t => t.amount >= Number(i.min_amount));
    if (i.max_amount != null) list = list.filter(t => t.amount <= Number(i.max_amount));
    if (i.account) {
      const a = accountByName(i.account);
      if (!a) return { error: `Inget konto heter "${i.account}".` };
      const def = calc.defaultAccount();
      list = list.filter(t => t.accountId === a.id || t.toAccountId === a.id || (!t.accountId && def && def.id === a.id));
    }
    const limit = Math.min(MAX_ROWS, Math.max(1, Number(i.limit) || 25));
    return {
      count: list.length,
      total_amount: round(sum(list.map(t => t.amount))),
      shown: Math.min(limit, list.length),
      transactions: list.slice(0, limit).map(txOut),
    };
  }

  function spendingSummary(i) {
    if (!isDate(i.date_from) || !isDate(i.date_to)) return { error: 'date_from och date_to måste vara YYYY-MM-DD.' };
    const type = i.type === 'income' ? 'income' : 'expense';
    const list = calc.txBetween(i.date_from, i.date_to).filter(t => t.type === type);
    const keyOf = {
      category: t => t.category,
      parent: t => (App.state.categories.find(c => c.name === t.category) || {}).parent || App.OTHER_PARENT,
      month: t => t.date.slice(0, 7),
      title: t => (t.title || '(utan beskrivning)').trim(),
    }[i.group_by] || (t => t.category);
    const groups = {};
    for (const t of list) { const k = keyOf(t); groups[k] = groups[k] || { amount: 0, count: 0 }; groups[k].amount += t.amount; groups[k].count++; }
    const rows = Object.entries(groups).map(([name, g]) => ({ name, amount: round(g.amount), count: g.count }));
    rows.sort((a, b) => (i.group_by === 'month' ? a.name.localeCompare(b.name) : b.amount - a.amount));
    return { type, total: round(sum(list.map(t => t.amount))), transactions: list.length, groups: rows.slice(0, 60) };
  }

  function budgetStatus(i) {
    const key = /^\d{4}-\d{2}$/.test(i.period || '') ? i.period : period.current();
    const r = period.range(key);
    const groups = calc.grouped(key).map(g => ({
      group: g.name, kind: g.kind,
      planned: round(sum(g.items.map(x => x.planned))), actual: round(sum(g.items.map(x => x.actual))),
      categories: g.items.filter(x => x.planned || x.actual).map(x => ({ name: x.name, planned: x.planned, actual: round(x.actual), left: round(x.planned - x.actual) })),
    }));
    const t = calc.monthTotals(key);
    return {
      period: key, from: r.start, to: r.end, is_current: key === period.current(),
      days_left: key === period.current() ? period.daysLeft(key) : null,
      planned_income: calc.plannedIncome(key), planned_expenses: calc.plannedTotal(key),
      actual_income: round(t.income), actual_expenses: round(t.expense), left_after_expenses: round(t.net),
      groups,
    };
  }

  function financialOverview() {
    const now = iso(today());
    const in30 = iso(new Date(today().getTime() + 30 * 864e5));
    return {
      accounts: calc.accounts().map(a => ({ name: a.name, balance: round(a.balance) })),
      goals: calc.goals().map(g => ({ name: g.name, saved: round(g.current), target: g.target, deadline: g.date || null })),
      debts: calc.debts().map(d => ({ name: d.name, left: d.balance, paid: d.paid })),
      assets: round(calc.assets()), total_debt: round(calc.totalDebt()), net_worth: round(calc.netWorth()),
      upcoming_bills: calc.billsInRange(now, in30).map(b => ({ name: b.name, date: b.date, amount: b.amount, paid: !!b.isPaid })),
    };
  }

  // Gör om Claudes förslag till en riktig transaktion, eller returnera ett felmeddelande
  function buildTx(p) {
    const s = App.state;
    if (!isDate(p.date)) return { error: `Ogiltigt datum: ${p.date}` };
    const amount = round(Math.abs(Number(p.amount)));
    if (!amount) return { error: 'Beloppet måste vara större än 0.' };
    if (!['expense', 'income', 'transfer'].includes(p.type)) return { error: `Okänd typ: ${p.type}` };
    const acc = p.account ? accountByName(p.account) : calc.defaultAccount();
    if (p.account && !acc) return { error: `Inget konto heter "${p.account}".` };
    const tx = { id: uid(), date: p.date, type: p.type, title: String(p.title || '').trim(), accountId: acc ? acc.id : '', amount, recurring: false };
    if (p.type === 'transfer') {
      const to = accountByName(p.to_account);
      if (!to) return { error: 'Överföringar behöver ett mottagande konto (to_account) som finns.' };
      if (acc && to.id === acc.id) return { error: 'Från- och till-konto kan inte vara samma.' };
      tx.category = 'Överföring';
      tx.toAccountId = to.id;
    } else {
      const pool = p.type === 'income' ? s.incomeCategories : s.categories;
      const cat = pool.find(c => c.name.toLowerCase() === String(p.category || '').trim().toLowerCase());
      if (!cat) return { error: `Kategorin "${p.category || ''}" finns inte bland ${p.type === 'income' ? 'inkomst' : 'utgifts'}kategorierna.` };
      tx.category = cat.name;
    }
    return { tx };
  }

  async function createTransactions(i) {
    const items = Array.isArray(i.transactions) ? i.transactions.slice(0, 50) : [];
    if (!items.length) return { error: 'Inga transaktioner angavs.' };
    const built = items.map(buildTx);
    const errors = built.map((b, n) => (b.error ? `Rad ${n + 1}: ${b.error}` : '')).filter(Boolean);
    if (errors.length) return { error: errors.join(' ') };
    const txs = built.map(b => b.tx);
    const ok = await confirmCard(txs.length === 1 ? 'Lägga till den här transaktionen?' : `Lägga till ${txs.length} transaktioner?`, txs.map(rowHTML).join(''), 'Lägg till');
    if (!ok) return { result: 'Användaren avbröt. Inget lades till.' };
    App.update(st => {
      st.transactions.push(...txs);
      st.transactions.sort((a, b) => b.date.localeCompare(a.date));
    });
    return { result: `${txs.length} transaktion(er) tillagda.`, ids: txs.map(t => t.id) };
  }

  async function updateTransaction(i) {
    const old = App.state.transactions.find(t => t.id === i.id);
    if (!old) return { error: `Ingen transaktion med id ${i.id}.` };
    const next = { ...old };
    if (i.date != null) { if (!isDate(i.date)) return { error: 'Ogiltigt datum.' }; next.date = i.date; }
    if (i.amount != null) { const a = round(Math.abs(Number(i.amount))); if (!a) return { error: 'Ogiltigt belopp.' }; next.amount = a; }
    if (i.title != null) next.title = String(i.title).trim();
    if (i.category != null) {
      if (old.type === 'transfer') return { error: 'Överföringar har ingen kategori.' };
      const pool = old.type === 'income' ? App.state.incomeCategories : App.state.categories;
      const cat = pool.find(c => c.name.toLowerCase() === String(i.category).trim().toLowerCase());
      if (!cat) return { error: `Kategorin "${i.category}" finns inte.` };
      next.category = cat.name;
    }
    if (i.account != null) { const a = accountByName(i.account); if (!a) return { error: `Inget konto heter "${i.account}".` }; next.accountId = a.id; }
    const ok = await confirmCard('Ändra transaktionen?', `<p class="ai-card-label">Före</p>${rowHTML(old)}<p class="ai-card-label">Efter</p>${rowHTML(next)}`, 'Spara ändring');
    if (!ok) return { result: 'Användaren avbröt. Inget ändrades.' };
    App.update(st => {
      const idx = st.transactions.findIndex(t => t.id === old.id);
      if (idx >= 0) st.transactions[idx] = next;
      st.transactions.sort((a, b) => b.date.localeCompare(a.date));
    });
    return { result: 'Transaktionen är ändrad.', transaction: txOut(next) };
  }

  async function deleteTransactions(i) {
    const ids = new Set(Array.isArray(i.ids) ? i.ids : []);
    const list = App.state.transactions.filter(t => ids.has(t.id));
    if (!list.length) return { error: 'Hittade inga transaktioner med de id:na.' };
    const ok = await confirmCard(list.length === 1 ? 'Ta bort den här transaktionen?' : `Ta bort ${list.length} transaktioner?`, list.map(rowHTML).join(''), 'Ta bort', true);
    if (!ok) return { result: 'Användaren avbröt. Inget togs bort.' };
    App.update(st => { st.transactions = st.transactions.filter(t => !ids.has(t.id)); });
    return { result: `${list.length} transaktion(er) borttagna.` };
  }

  const RUN = {
    search_transactions: searchTransactions,
    spending_summary: spendingSummary,
    budget_status: budgetStatus,
    financial_overview: financialOverview,
    create_transactions: createTransactions,
    update_transaction: updateTransaction,
    delete_transactions: deleteTransactions,
  };

  // ---------- Samtalet ----------
  // Skickar konversationen till mellanstationen. Kan bytas ut vid test (App.assistant.transport).
  async function callServer(payload) {
    const client = App.sync.client;
    if (!client) throw friendly('Molnet är inte tillgängligt just nu. Kontrollera internetanslutningen.');
    const { data, error } = await client.functions.invoke(FUNCTION, { body: payload });
    if (!error) return data;
    let code = '';
    let status = error.context && error.context.status;
    try { code = (await error.context.json()).error || ''; } catch (e) { /* inget svar att läsa */ }
    throw friendly({
      not_signed_in: 'Logga in (längst ner i menyn) för att använda assistenten.',
      not_allowed: 'Ditt konto har inte behörighet. Lägg till din e-post i hemligheten ALLOWED_EMAILS i Supabase.',
      no_api_key: 'API-nyckeln saknas. Lägg in ANTHROPIC_API_KEY under Edge Functions → Secrets i Supabase.',
      bad_api_key: 'API-nyckeln fungerar inte. Kontrollera ANTHROPIC_API_KEY i Supabase och att kontot har pengar.',
      rate_limited: 'För många frågor på kort tid. Vänta en liten stund och försök igen.',
    }[code] || (status === 404 || (!status && /fetch|relay/i.test(error.name || ''))
      ? 'Assistenten är inte installerad i Supabase ännu. Se instruktionen i README.'
      : 'Något gick fel hos assistenten. Försök igen om en stund.'));
  }
  const friendly = message => Object.assign(new Error(message), { friendly: true });

  async function ask(text) {
    if (busy || !text.trim()) return;
    if (!App.sync.user && !api.transport) { addBubble('assistant', '<p>Logga in (längst ner i menyn) för att använda assistenten. Då kan den läsa och ändra din budget åt dig.</p>'); return; }
    busy = true;
    setBusy(true);
    addBubble('user', `<p>${esc(text).replace(/\n/g, '<br>')}</p>`);
    const d = today();
    const weekday = d.toLocaleDateString('sv-SE', { weekday: 'long' });
    history.push({ role: 'user', content: [{ type: 'text', text: `[Idag är det ${weekday} ${iso(d)}.]\n\n${text.trim()}` }] });
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const thinking = addThinking();
        let res;
        try {
          res = await (api.transport || callServer)({ system: systemPrompt(), tools: TOOLS, messages: history });
        } finally { thinking.remove(); }
        // Hela svaret sparas oförändrat (även dolda tankeblock), annars blir nästa fråga fel
        history.push({ role: 'assistant', content: res.content });
        const said = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
        if (said) addBubble('assistant', markdown(said));

        if (res.stop_reason === 'refusal') { addBubble('assistant', '<p class="muted">Det kan jag tyvärr inte hjälpa till med.</p>'); break; }
        if (res.stop_reason === 'pause_turn') continue;
        if (res.stop_reason !== 'tool_use') {
          if (res.stop_reason === 'max_tokens') addBubble('assistant', '<p class="muted">Svaret blev för långt och kortades av.</p>');
          break;
        }
        const results = [];
        for (const call of res.content.filter(b => b.type === 'tool_use')) {
          addActivity(ACTIVITY[call.name] || 'Arbetar');
          let out;
          try {
            const fn = RUN[call.name];
            out = fn ? await fn(call.input || {}) : { error: `Okänt verktyg: ${call.name}` };
          } catch (e) {
            console.error(e);
            out = { error: `Verktyget misslyckades: ${e.message}` };
          }
          results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out), ...(out && out.error ? { is_error: true } : {}) });
        }
        history.push({ role: 'user', content: results });
      }
    } catch (e) {
      console.error(e);
      addBubble('assistant', `<p class="ai-error">${esc(e.friendly ? e.message : 'Något gick fel. Försök igen.')}</p>`);
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  // ---------- Gränssnittet ----------
  const SPARK = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" fill="currentColor"/></svg>';
  const SEND = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SUGGESTIONS = [
    'Hur ligger jag till mot budgeten?',
    'Vad har jag lagt mest pengar på den här månaden?',
    'Lägg in 250 kr på ICA idag',
    'Vilka räkningar kommer snart?',
  ];

  function build() {
    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'ai-fab';
    fab.setAttribute('aria-label', 'Öppna assistenten');
    fab.innerHTML = `${SPARK}<span>Fråga</span>`;
    const panel = document.createElement('section');
    panel.className = 'ai-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Assistent');
    panel.innerHTML = `
      <header class="ai-head">
        <div><p class="overline">Assistent</p><h2 class="ai-title">Fråga om din ekonomi</h2></div>
        <div class="ai-head-btns">
          <button type="button" class="link-btn" data-new>Ny chatt</button>
          <button type="button" class="ai-close" data-close aria-label="Stäng">✕</button>
        </div>
      </header>
      <div class="ai-log" aria-live="polite"></div>
      <form class="ai-form">
        <textarea rows="1" placeholder="Skriv en fråga…" aria-label="Meddelande"></textarea>
        <button type="submit" class="ai-send" aria-label="Skicka">${SEND}</button>
      </form>`;
    document.body.append(fab, panel);
    els = { fab, panel, log: panel.querySelector('.ai-log'), form: panel.querySelector('form'), input: panel.querySelector('textarea'), send: panel.querySelector('.ai-send') };

    fab.addEventListener('click', () => toggle(true));
    panel.querySelector('[data-close]').addEventListener('click', () => toggle(false));
    panel.querySelector('[data-new]').addEventListener('click', () => { if (!busy) { history = []; welcome(); els.input.focus(); } });
    panel.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) toggle(false); });
    els.form.addEventListener('submit', e => {
      e.preventDefault();
      const text = els.input.value;
      if (!text.trim() || busy) return;
      els.input.value = '';
      grow();
      ask(text);
    });
    els.input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); els.form.requestSubmit(); } });
    els.input.addEventListener('input', grow);
    els.log.addEventListener('click', e => { const s = e.target.closest('[data-suggest]'); if (s && !busy) ask(s.dataset.suggest); });
    welcome();
  }

  function grow() { els.input.style.height = 'auto'; els.input.style.height = `${Math.min(140, els.input.scrollHeight)}px`; }

  function toggle(open) {
    els.panel.hidden = !open;
    els.fab.hidden = open;
    document.body.classList.toggle('ai-open', open);
    if (open) els.input.focus(); else els.fab.focus();
  }

  function welcome() {
    els.log.innerHTML = `<div class="ai-welcome">
        <p>Hej! Jag kan söka bland dina transaktioner, räkna på budgeten och lägga in, ändra eller ta bort transaktioner åt dig. Allt jag ändrar får du godkänna först.</p>
        <div class="ai-suggest">${SUGGESTIONS.map(s => `<button type="button" class="ai-chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      </div>`;
  }

  function scroll() { els.log.scrollTop = els.log.scrollHeight; }
  function addBubble(role, html) {
    els.log.querySelector('.ai-welcome')?.remove();
    const div = document.createElement('div');
    div.className = `ai-msg ai-${role}`;
    div.innerHTML = html;
    els.log.appendChild(div);
    scroll();
    return div;
  }
  function addActivity(text) { const d = addBubble('activity', esc(text) + '…'); return d; }
  function addThinking() { return addBubble('thinking', '<span></span><span></span><span></span>'); }
  function setBusy(on) { els.send.disabled = on; els.panel.classList.toggle('is-busy', on); }

  function rowHTML(t) {
    const sign = t.type === 'income' ? '+' : t.type === 'transfer' ? '' : '−';
    const where = t.type === 'transfer'
      ? `${esc(calc.accountName(t.accountId) || 'Standardkonto')} → ${esc(calc.accountName(t.toAccountId))}`
      : `${esc(t.category)} · ${esc(calc.accountName(t.accountId) || calc.defaultAccount()?.name || 'Inget konto')}`;
    return `<div class="ai-tx"><div><b>${esc(t.title || t.category)}</b><p class="muted">${fmt.date(t.date)} · ${where}</p></div><b class="ai-tx-amt ${t.type === 'income' ? 'pos' : ''}">${sign}${fmt.money(t.amount)}</b></div>`;
  }

  // Förslag som användaren godkänner eller avbryter. Svarar true/false.
  function confirmCard(title, body, okLabel, danger = false) {
    return new Promise(resolve => {
      const card = addBubble('card', `<p class="ai-card-title">${esc(title)}</p>${body}
        <div class="ai-card-btns">
          <button type="button" class="btn btn-secondary btn-small" data-no>Avbryt</button>
          <button type="button" class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'} btn-small" data-yes>${esc(okLabel)}</button>
        </div>`);
      const done = ok => {
        card.querySelector('.ai-card-btns').innerHTML = `<p class="ai-card-done ${ok ? '' : 'muted'}">${ok ? '✓ Klart' : 'Avbrutet'}</p>`;
        resolve(ok);
      };
      card.querySelector('[data-yes]').addEventListener('click', () => done(true), { once: true });
      card.querySelector('[data-no]').addEventListener('click', () => done(false), { once: true });
      card.querySelector('[data-yes]').focus();
    });
  }

  // Enkel och säker markdown: texten escapas först, sedan fetstil, kursiv och listor
  function markdown(text) {
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    const out = [];
    let list = null;
    for (const line of text.split('\n')) {
      const m = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line);
      if (m) { if (!list) { list = []; out.push(list); } list.push(`<li>${inline(m[1])}</li>`); continue; }
      list = null;
      if (/^#{1,6}\s+/.test(line)) out.push(`<p><b>${inline(line.replace(/^#{1,6}\s+/, ''))}</b></p>`);
      else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
    return out.map(x => (Array.isArray(x) ? `<ul>${x.join('')}</ul>` : x)).join('');
  }

  const api = { ask, transport: null, get history() { return history; }, tools: TOOLS, run: RUN, systemPrompt };
  App.assistant = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
