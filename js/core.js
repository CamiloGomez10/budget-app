// ============================================================
// Budget – kärna: data, beräkningar, formatering, UI-byggstenar,
// diagram och router. Sidorna ligger i js/pages/ och registrerar
// sig med App.page({...}).
// ============================================================
'use strict';

const App = (() => {
  const KEYS = { personal: 'budget-personal-v2', demo: 'budget-demo-v2', mode: 'budget-mode' };

  // ---------- Kategorier ----------
  // Färgerna är kontrollerade för färgblindhet (i den här ordningen).
  const CATEGORY_COLORS = ['#9a4a22', '#00897a', '#d08a1c', '#6b5ab2', '#7a8a12', '#c4507c', '#3f7fc4', '#7a4a8a'];
  // Huvudkategorier för utgifter, i den ordning de visas. Inkomster visas alltid först.
  const DEFAULT_PARENTS = ['Fasta kostnader', 'Sparande', 'Rörliga utgifter', 'Livsstil'];
  const DEFAULT_CATEGORIES = [
    { name: 'Boende',     group: 'needs',  parent: 'Fasta kostnader'  },
    { name: 'Mat',        group: 'needs',  parent: 'Rörliga utgifter' },
    { name: 'Transport',  group: 'needs',  parent: 'Fasta kostnader'  },
    { name: 'Livsstil',   group: 'wants',  parent: 'Livsstil'         },
    { name: 'Hälsa',      group: 'needs',  parent: 'Fasta kostnader'  },
    { name: 'Utbildning', group: 'needs',  parent: 'Rörliga utgifter' },
    { name: 'Sparande',   group: 'future', parent: 'Sparande'         },
    { name: 'Skulder',    group: 'future', parent: 'Fasta kostnader'  },
  ].map((c, i) => ({ ...c, color: CATEGORY_COLORS[i] }));
  const DEFAULT_INCOME = [{ name: 'Lön' }, { name: 'Övrig inkomst' }];
  const OTHER_PARENT = 'Övrigt';

  const COLORS = {
    income: '#8a4522',    // inkomster / faktiskt utfall
    expense: '#d4925e',   // utgifter
    planned: '#c08a4e',   // planerat
    actual: '#8a4522',
    dark: '#54382d',
  };

  // ---------- Små hjälpare ----------
  const uid = () => Math.random().toString(36).slice(2, 10);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const ym = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;          // "2026-11"
  const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1); };
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const daysInMonth = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const addMonths = (key, n) => { const [y, m] = key.split('-').map(Number); return ym(new Date(y, m - 1 + n, 1)); };
  const sum = arr => arr.reduce((s, v) => s + (Number(v) || 0), 0);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---------- Formatering ----------
  const CURRENCIES = {
    SEK: { label: 'SEK kr', locale: 'sv-SE' },
    EUR: { label: 'EUR €',  locale: 'sv-SE' },
    USD: { label: 'USD $',  locale: 'en-US' },
    NOK: { label: 'NOK kr', locale: 'nb-NO' },
    DKK: { label: 'DKK kr', locale: 'da-DK' },
    GBP: { label: 'GBP £',  locale: 'en-GB' },
  };
  const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

  const fmt = {
    money(v, decimals = 2) {
      const cur = state.settings.currency;
      return new Intl.NumberFormat((CURRENCIES[cur] || CURRENCIES.SEK).locale, {
        style: 'currency', currency: cur, minimumFractionDigits: decimals, maximumFractionDigits: decimals,
      }).format(Number(v) || 0);
    },
    money0: v => fmt.money(v, 0),
    pct: (v, d = 0) => new Intl.NumberFormat('sv-SE', { style: 'percent', maximumFractionDigits: d, minimumFractionDigits: d }).format(Number.isFinite(v) ? v : 0),
    num: (v, d = 0) => new Intl.NumberFormat('sv-SE', { maximumFractionDigits: d }).format(v),
    date: s => { const d = parseISO(s); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; },
    dateShort: s => { const d = parseISO(s); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; },
    month: key => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; },
    monthName: i => MONTHS[i],
    monthShort: i => MONTHS_SHORT[i],
    cap: s => s.charAt(0).toUpperCase() + s.slice(1),
    // Kort belopp för diagramaxlar, t.ex. "12 tn"
    axis: v => Math.abs(v) >= 1e6 ? fmt.num(v / 1e6, 1) + ' mn' : Math.abs(v) >= 1000 ? fmt.num(v / 1000, 1) + ' tn' : fmt.num(v),
  };

  // ---------- State ----------
  function emptyState() {
    const now = today();
    return {
      version: 2,
      // period.mode: 'calendar' (1:a–sista) eller 'payday' (lönedag till dagen före nästa lönedag)
      settings: { currency: 'SEK', frequency: 'monthly', startDate: `${now.getFullYear()}-01-01`, heroImage: null, period: { mode: 'calendar', payday: 25 } },
      categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),   // utgiftskategorier (underkategorier)
      parents: [...DEFAULT_PARENTS],                           // huvudkategorier för utgifter, i ordning
      incomeCategories: DEFAULT_INCOME.map(c => ({ ...c })),  // underkategorier för inkomster
      defaultBudget: {},           // { Boende: 8500, ... } används när en månad saknar egen plan
      budgets: {},                 // { "2026-11": { Boende: 8500, ... } }
      transactions: [],            // { id, date, type: income|expense, category, title, account, amount, recurring }
      accounts: [],                // { id, name, type: checking|savings|investment, balance }
      bills: [],                   // { id, name, amount, dueDate, recurrence: monthly|yearly|once, debtId?, paid: { "2026-11": true } }
      goals: [],                   // { id, name, target, current, date, accountId, notes, history: [{ date, amount, note }] }
      debts: [],                   // { id, name, original, balance, apr, installment, extra, payDay, start, end, notes, payments: [{ date, amount, kind }] }
      snapshots: [],               // { month: "2026-01", assets, liabilities, netWorth }
      noSpend: {},                 // { "2026-11-03": true }
      paycheck: { start: iso(new Date(now.getFullYear(), now.getMonth(), 1)), end: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)), income: 0, alloc: {} },
      forecast: { start: 10000, monthly: 1500, years: 10, rate: 5 },
      strategy: 'snowball',
    };
  }

  let mode = 'demo';
  let state = emptyState();

  function read(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  function load() {
    let m = null;
    try { m = localStorage.getItem(KEYS.mode); } catch (e) { /* ignorera */ }
    // Första besöket: visa exempeldata så att sidorna inte är tomma.
    mode = m === 'personal' ? 'personal' : 'demo';
    if (mode === 'demo') {
      state = migrate(read(KEYS.demo)) || createDemoState();
    } else {
      state = migrate(read(KEYS.personal)) || emptyState();
    }
    save();
  }

  function migrate(s) {
    if (!s || s.version !== 2) return null;
    const out = { ...emptyState(), ...s, settings: { ...emptyState().settings, ...s.settings } };
    // Äldre data utan inkomstkategorier: hämta dem från befintliga inkomster
    if (!Array.isArray(s.incomeCategories)) {
      const names = [...new Set((s.transactions || []).filter(t => t.type === 'income').map(t => t.category).filter(Boolean))];
      out.incomeCategories = (names.length ? names : DEFAULT_INCOME.map(c => c.name)).map(name => ({ name }));
    }
    return out;
  }

  function save() {
    write(mode === 'demo' ? KEYS.demo : KEYS.personal, state);
    try { localStorage.setItem(KEYS.mode, mode); } catch (e) { /* ignorera */ }
  }

  // Lyssnare som får veta när den personliga datan ändrats av användaren (molnsynk).
  const changeListeners = [];
  function onChange(fn) { changeListeners.push(fn); }
  function changed() {
    if (mode !== 'personal') return;
    changeListeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } });
  }

  // Ändra state och rita om aktuell sida.
  function update(fn) {
    fn(state);
    save();
    changed();
    render();
  }

  // Data från molnet: ersätter den personliga datan utan att räknas som en ny ändring.
  function applyRemote(data) {
    const next = migrate(data);
    if (!next) return false;
    mode = 'personal';
    state = next;
    save();
    render();
    return true;
  }
  function readPersonal() { return read(KEYS.personal); }

  function setMode(next) {
    save();
    mode = next;
    state = next === 'demo' ? createDemoState() : (migrate(read(KEYS.personal)) || emptyState());
    save();
    render();
  }

  function replaceState(next) {
    state = migrate(next) || emptyState();
    save();
    changed();
    render();
  }

  function resetAll() {
    try { Object.values(KEYS).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignorera */ }
    mode = 'personal';
    state = emptyState();
    save();
    changed();
    render();
  }

  // ---------- Exempeldata ----------
  function createDemoState() {
    const s = emptyState();
    const now = today();
    const Y = now.getFullYear();
    const curM = now.getMonth();
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

    s.accounts = [
      { id: uid(), name: 'Lönekonto', type: 'checking', balance: 31000 },
      { id: uid(), name: 'Sparkonto med ränta', type: 'savings', balance: 90000 },
      { id: uid(), name: 'Investeringskonto', type: 'investment', balance: 42000 },
    ];
    const checking = s.accounts[0].name;

    s.defaultBudget = { Lön: 42100, Boende: 8500, Mat: 3500, Transport: 1800, Livsstil: 2800, Hälsa: 1200, Utbildning: 500, Sparande: 4500, Skulder: 2675 };
    for (let m = 0; m < 12; m++) s.budgets[`${Y}-${pad2(m + 1)}`] = { ...s.defaultBudget };

    const tx = [];
    const add = (m, d, type, category, title, amount, recurring = false) => {
      const date = new Date(Y, m, d);
      if (date > now) return;
      tx.push({ id: uid(), date: iso(date), type, category, title, account: checking, amount: Math.round(amount), recurring });
    };
    for (let m = 0; m <= curM; m++) {
      add(m, 10, 'income', 'Lön', 'Ateljé Norr AB', 21050, true);
      add(m, 25, 'income', 'Lön', 'Ateljé Norr AB', 21050, true);
      add(m, 1, 'expense', 'Boende', 'Hyra', 7500, true);
      add(m, 4, 'expense', 'Mat', 'ICA', 700 + rand() * 500);
      add(m, 12, 'expense', 'Mat', 'Coop', 600 + rand() * 500);
      add(m, 21, 'expense', 'Mat', 'Willys', 700 + rand() * 500);
      add(m, 6, 'expense', 'Transport', 'Månadskort', 950, true);
      if (rand() > 0.5) add(m, 16, 'expense', 'Transport', 'Taxi', 150 + rand() * 300);
      add(m, 8, 'expense', 'Livsstil', 'Restaurang', 400 + rand() * 700);
      add(m, 19, 'expense', 'Livsstil', 'Kläder', 300 + rand() * 900);
      add(m, 14, 'expense', 'Hälsa', 'Gym', 425, true);
      if (m % 3 === 0) add(m, 22, 'expense', 'Utbildning', 'Kursbok', 350);
      add(m, 24, 'expense', 'Skulder', 'Reskort avbetalning', 625, true);
      add(m, 28, 'expense', 'Skulder', 'CSN', 2050, true);
      add(m, 26, 'expense', 'Sparande', 'Överföring till buffert', 3000, true);
    }
    s.transactions = tx.sort((a, b) => b.date.localeCompare(a.date));

    const debtTravel = { id: uid(), name: 'Reskort', original: 7750, balance: 6200, apr: 19.99, installment: 625, extra: 0, payDay: 24, start: `${Y}-01-01`, end: '', notes: '', payments: [] };
    const debtStudent = { id: uid(), name: 'Studielån', original: 80000, balance: 64000, apr: 4.25, installment: 2050, extra: 0, payDay: 28, start: `${Y - 2}-09-01`, end: '', notes: '', payments: [] };
    s.debts = [debtTravel, debtStudent];

    const mk = ym(now);
    s.bills = [
      { id: uid(), name: 'Hyra', amount: 7500, dueDate: `${mk}-03`, recurrence: 'monthly', paid: {} },
      { id: uid(), name: 'Streamingtjänst', amount: 119, dueDate: `${mk}-17`, recurrence: 'monthly', paid: {} },
      { id: uid(), name: 'Reskort', amount: 625, dueDate: `${mk}-24`, recurrence: 'monthly', debtId: debtTravel.id, paid: {} },
      { id: uid(), name: 'Studielån', amount: 2050, dueDate: `${mk}-28`, recurrence: 'monthly', debtId: debtStudent.id, paid: {} },
    ];

    s.goals = [
      { id: uid(), name: 'Buffert', target: 120000, current: 91000, date: `${Y + 1}-03-01`, accountId: s.accounts[1].id, notes: '', history: [] },
      { id: uid(), name: 'Resa till Portugal', target: 27500, current: 16000, date: `${Y + 1}-04-01`, accountId: '', notes: '', history: [] },
    ];

    // Nettoförmögenhet som växer stadigt fram till förra månaden
    const assets = sum(s.accounts.map(a => a.balance));
    const liab = sum(s.debts.map(d => d.balance));
    for (let m = 0; m < curM; m++) {
      const nw = Math.round((assets - liab) * (0.35 + 0.65 * (m / Math.max(1, curM))));
      s.snapshots.push({ month: `${Y}-${pad2(m + 1)}`, assets: nw + liab, liabilities: liab, netWorth: nw });
    }

    // Några köpfria dagar denna månad
    for (let d = 1; d < now.getDate(); d++) if (rand() > 0.7) s.noSpend[`${mk}-${pad2(d)}`] = true;

    s.paycheck = { start: `${mk}-01`, end: `${mk}-${pad2(daysInMonth(mk))}`, income: 42100, alloc: { ...s.defaultBudget } };
    s.forecast = { start: 10000, monthly: 1500, years: 10, rate: 5 };
    return s;
  }

  // ---------- Budgetperioder ----------
  // En "månad" i appen har nyckeln "2026-11". Med lönemånader är det perioden som
  // SLUTAR i november: från lönedagen i oktober till dagen före lönedagen i november
  // (samma logik som Notion-formeln). Faller lönedagen på en helg eller en dag då
  // bankerna har stängt betalas lönen ut närmaste bankdag innan, och då börjar perioden där.

  // Påskdagen (gregoriansk beräkning, Meeus/Jones/Butcher)
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  // Svenska dagar då bankerna har stängt (helgdagar + julafton, midsommarafton och nyårsafton)
  const holidayCache = {};
  function bankHolidays(y) {
    if (holidayCache[y]) return holidayCache[y];
    const e = easter(y);
    const rel = n => iso(new Date(y, e.getMonth(), e.getDate() + n));
    // Midsommarafton: fredagen mellan 19 och 25 juni
    const mid = new Date(y, 5, 19);
    while (mid.getDay() !== 5) mid.setDate(mid.getDate() + 1);
    const set = new Set([
      `${y}-01-01`, `${y}-01-06`,               // nyårsdagen, trettondedag jul
      rel(-2), rel(1), rel(39),                  // långfredag, annandag påsk, Kristi himmelsfärd
      `${y}-05-01`, `${y}-06-06`,               // första maj, nationaldagen
      iso(mid),                                  // midsommarafton
      `${y}-12-24`, `${y}-12-25`, `${y}-12-26`, `${y}-12-31`, // julafton, juldagen, annandag jul, nyårsafton
    ]);
    return (holidayCache[y] = set);
  }
  const isBankDay = d => d.getDay() !== 0 && d.getDay() !== 6 && !bankHolidays(d.getFullYear()).has(iso(d));

  function payDate(year, monthIndex) {
    const day = Math.min(Number(state.settings.period?.payday) || 25, new Date(year, monthIndex + 1, 0).getDate());
    const d = new Date(year, monthIndex, day);
    while (!isBankDay(d)) d.setDate(d.getDate() - 1); // helg eller röd dag → bankdagen innan
    return d;
  }
  const period = {
    isPayday: () => state.settings.period?.mode === 'payday',
    // Första dagen i perioden med nyckeln key
    startOf(key) {
      const [y, m] = key.split('-').map(Number);
      return period.isPayday() ? payDate(y, m - 2) : new Date(y, m - 1, 1);
    },
    range(key) {
      const start = period.startOf(key);
      const end = period.startOf(addMonths(key, 1));
      end.setDate(end.getDate() - 1);
      return { start: iso(start), end: iso(end), days: Math.round((end - start) / 864e5) + 1 };
    },
    // Vilken period ett datum hör till
    keyOf(date) {
      const d = typeof date === 'string' ? parseISO(date) : date;
      const key = ym(d);
      return d >= period.startOf(addMonths(key, 1)) ? addMonths(key, 1) : key;
    },
    current: () => period.keyOf(today()),
    // Dagar kvar av perioden, inklusive idag
    daysLeft(key) {
      const end = parseISO(period.range(key).end);
      return Math.max(1, Math.round((end - today()) / 864e5) + 1);
    },
    // "23 okt – 24 nov" (tom sträng för vanliga kalendermånader)
    rangeLabel(key) {
      if (!period.isPayday()) return '';
      const r = period.range(key);
      return `${fmt.dateShort(r.start)} – ${fmt.dateShort(r.end)}`;
    },
  };

  // ---------- Beräkningar ----------
  const calc = {
    txInMonth(key) {
      const r = period.range(key);
      return state.transactions.filter(t => t.date >= r.start && t.date <= r.end);
    },
    txBetween: (from, to) => state.transactions.filter(t => t.date >= from && t.date <= to),

    totals(list) {
      const income = sum(list.filter(t => t.type === 'income').map(t => t.amount));
      const expense = sum(list.filter(t => t.type === 'expense').map(t => t.amount));
      return { income, expense, net: income - expense };
    },
    monthTotals: key => calc.totals(calc.txInMonth(key)),

    // { kategori: belopp } för utgifter i listan
    byCategory(list) {
      const out = {};
      for (const t of list) if (t.type === 'expense') out[t.category] = (out[t.category] || 0) + t.amount;
      return out;
    },

    // Planerad budget för en månad (egen plan, annars standardbudgeten)
    planned: key => state.budgets[key] || state.defaultBudget || {},
    // Bara utgiftskategorier räknas (inkomstbudgeten ligger i samma objekt)
    plannedTotal: key => { const p = calc.planned(key); return sum(state.categories.map(c => p[c.name])); },
    plannedIncome: key => { const p = calc.planned(key); return sum(state.incomeCategories.map(c => p[c.name])); },

    incomeByCategory(list) {
      const out = {};
      for (const t of list) if (t.type === 'income') out[t.category] = (out[t.category] || 0) + t.amount;
      return out;
    },

    /**
     * Kategorier uppdelade per huvudkategori, i ordning: Inkomster, sedan huvudkategorierna
     * i vald ordning, sist "Övrigt". Inom varje grupp: störst budget först, sedan störst
     * utfall, sedan namn.
     * Returnerar [{ name, kind: 'income'|'expense', items: [{ ...kategori, planned, actual }] }]
     */
    grouped(key) {
      const planned = calc.planned(key);
      const list = calc.txInMonth(key);
      const spent = calc.byCategory(list);
      const earned = calc.incomeByCategory(list);
      const sortItems = items => items.sort((a, b) => b.planned - a.planned || b.actual - a.actual || a.name.localeCompare(b.name, 'sv'));
      const withNums = (c, actualMap) => ({ ...c, planned: Number(planned[c.name]) || 0, actual: actualMap[c.name] || 0 });

      const groups = [{ name: state.incomeLabel || 'Inkomster', kind: 'income', items: sortItems(state.incomeCategories.map(c => withNums(c, earned))) }];
      const parents = state.parents || [];
      for (const p of parents) {
        groups.push({ name: p, kind: 'expense', items: sortItems(state.categories.filter(c => c.parent === p).map(c => withNums(c, spent))) });
      }
      const rest = state.categories.filter(c => !c.parent || !parents.includes(c.parent));
      if (rest.length) groups.push({ name: OTHER_PARENT, kind: 'expense', items: sortItems(rest.map(c => withNums(c, spent))) });
      return groups.filter(g => g.items.length);
    },

    yearMonths(year) {
      return Array.from({ length: 12 }, (_, i) => {
        const key = `${year}-${pad2(i + 1)}`;
        return { key, index: i, ...calc.monthTotals(key), planned: calc.plannedTotal(key) };
      });
    },

    assets: () => sum(state.accounts.filter(a => a.balance > 0).map(a => a.balance)),
    liquid: () => sum(state.accounts.filter(a => a.type !== 'investment' && a.balance > 0).map(a => a.balance)),
    negativeAccounts: () => -sum(state.accounts.filter(a => a.balance < 0).map(a => a.balance)),
    totalDebt: () => sum(state.debts.map(d => d.balance)) + calc.negativeAccounts(),
    netWorth: () => calc.assets() - calc.totalDebt(),
    totalSaved: () => sum(state.goals.map(g => g.current)),

    // Räkningar som infaller en viss månad, med datum och betalstatus
    billsForMonth(key) {
      return state.bills.flatMap(b => {
        const due = parseISO(b.dueDate);
        const dueKey = ym(due);
        if (b.recurrence === 'once' && dueKey !== key) return [];
        if (b.recurrence === 'yearly' && Number(key.slice(5)) !== due.getMonth() + 1) return [];
        if (dueKey > key && b.recurrence !== 'once') return [];
        const day = Math.min(due.getDate(), daysInMonth(key));
        return [{ ...b, date: `${key}-${pad2(day)}`, isPaid: !!(b.paid && b.paid[key]) }];
      }).sort((a, b) => a.date.localeCompare(b.date));
    },

    // Räkningar med förfallodag mellan två datum (ISO), över flera kalendermånader
    billsInRange(from, to) {
      const out = [];
      for (let k = from.slice(0, 7); k <= to.slice(0, 7); k = addMonths(k, 1)) {
        out.push(...calc.billsForMonth(k).filter(b => b.date >= from && b.date <= to));
      }
      return out;
    },

    // Månader kvar tills skulden är betald (månadsränta APR/12)
    debtMonthsRemaining(d) {
      let bal = d.balance;
      const pay = (Number(d.installment) || 0) + (Number(d.extra) || 0);
      const r = (Number(d.apr) || 0) / 100 / 12;
      if (bal <= 0) return 0;
      if (pay <= bal * r) return Infinity;
      let n = 0;
      while (bal > 0.005 && n < 1200) { bal = bal * (1 + r) - pay; n++; }
      return n;
    },

    // Genomsnittliga utgifter för de senaste hela månaderna (max 3)
    avgMonthlyExpense() {
      const cur = period.current();
      const months = [1, 2, 3].map(n => calc.monthTotals(addMonths(cur, -n)).expense).filter(v => v > 0);
      if (months.length) return sum(months) / months.length;
      return calc.monthTotals(cur).expense;
    },
  };

  const categoryColor = name => {
    const c = state.categories.find(c => c.name === name);
    return c ? c.color : '#8b8178';
  };

  // ---------- UI-byggstenar (returnerar HTML-strängar) ----------
  const ICONS = {
    home: 'M3 11l9-7 9 7M5 10v10h14V10',
    bars: 'M5 20V11M10 20V6M15 20v-7M20 20V9',
    calendar: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
    wallet: 'M4 6h16v12H4zM8 10h8M8 14h5',
    trend: 'M4 17l6-6 4 4 6-7M15 8h5v5',
    swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
    bill: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h4',
    card: 'M3 6h18v12H3zM3 10h18M7 15h4',
    piggy: 'M5 11a7 6 0 0114 0v3l-2 1v3h-3v-2h-4v2H7v-3a6 6 0 01-2-4zM15 10h.01',
    coins: 'M12 6c4 0 7-1 7-2s-3-2-7-2-7 1-7 2 3 2 7 2zM5 4v6c0 1 3 2 7 2s7-1 7-2V4M5 10v6c0 1 3 2 7 2s7-1 7-2v-6',
    chart: 'M4 20h16M7 16v-4M12 16V8M17 16V5',
    target: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 16a4 4 0 110-8 4 4 0 010 8zM12 12h.01',
    ban: 'M12 21a9 9 0 110-18 9 9 0 010 18zM6 6l12 12',
    report: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3',
    backup: 'M4 12a8 8 0 0114-5l2 2M20 12a8 8 0 01-14 5l-2-2M18 4v5h-5M6 20v-5h5',
    cog: 'M12 15a3 3 0 100-6 3 3 0 000 6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
    up: 'M12 19V5M6 11l6-6 6 6',
    down: 'M12 5v14M6 13l6 6 6-6',
    x: 'M6 6l12 12M18 6L6 18',
    plus: 'M12 5v14M5 12h14',
    check: 'M5 12l5 5 9-10',
    lock: 'M6 11h12v9H6zM9 11V8a3 3 0 016 0v3',
    sparkle: 'M12 3v6M12 15v6M3 12h6M15 12h6',
  };
  const icon = (name, size) =>
    `<svg class="icon" ${size ? `width="${size}" height="${size}"` : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;

  const ui = {
    icon,
    // Kort med overline, rubrik och valfritt innehåll till höger
    card({ overline = '', title = '', right = '', body = '', cls = '', id = '' }) {
      const head = overline || title || right
        ? `<div class="card-head"><div>${overline ? `<p class="overline">${overline}</p>` : ''}${title ? `<h2 class="card-title">${title}</h2>` : ''}</div>${right ? `<div class="card-right">${right}</div>` : ''}</div>`
        : '';
      return `<section class="card ${cls}" ${id ? `id="${id}"` : ''}>${head}${body}</section>`;
    },
    // Statkort. variant: '' | 'dark' | 'tan'. accent: färg på topplinjen.
    stat({ label, value, hint = '', variant = '', accent = '' }) {
      return `<div class="stat ${variant ? 'stat-' + variant : ''} ${accent ? 'stat-accent' : ''}" ${accent ? `style="--accent-line:${accent}"` : ''}>
        <p class="stat-label">${label}</p>
        <p class="stat-value">${value}</p>
        ${hint ? `<p class="stat-hint">${hint}</p>` : ''}
      </div>`;
    },
    // Tan-remsa med nyckeltal: [{label, value}]
    strip(items) {
      return `<div class="strip">${items.map(i => `<div><p class="stat-label">${i.label}</p><p class="strip-value">${i.value}</p>${i.hint ? `<p class="stat-hint">${i.hint}</p>` : ''}</div>`).join('')}</div>`;
    },
    progress(share, color = 'var(--dark)') {
      return `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(clamp(share, 0, 1) * 100)}"><span style="width:${clamp(share, 0, 1) * 100}%;background:${color}"></span></div>`;
    },
    pill: (text, kind = '') => `<span class="pill ${kind ? 'pill-' + kind : ''}">${text}</span>`,
    field(label, control, cls = '') {
      return `<label class="field ${cls}"><span class="field-label">${label}</span>${control}</label>`;
    },
    // Input med valutaprefix
    moneyInput(attrs) {
      return `<span class="input-money"><span>${currencySymbol()}</span><input type="number" inputmode="decimal" step="any" ${attrs}></span>`;
    },
    empty(text, sub = '') {
      return `<div class="empty"><span class="empty-icon">${icon('chart', 20)}</span><p class="empty-title">${text}</p>${sub ? `<p class="empty-sub">${sub}</p>` : ''}</div>`;
    },
    note(html) {
      return `<div class="note"><span class="note-icon">✦</span><div>${html}</div></div>`;
    },
    avatar(letter, color = 'var(--dark)') {
      return `<span class="avatar" style="background:${color}">${esc(letter.charAt(0).toUpperCase())}</span>`;
    },
    // Tabell som alternativ vy till ett diagram
    tableView(headers, rows) {
      return `<details class="table-view"><summary>Visa som tabell</summary><div class="table-scroll"><table>
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div></details>`;
    },
    legend(items) {
      return `<ul class="legend">${items.map(i => `<li><span class="swatch" style="background:${i.color}"></span>${esc(i.name)}</li>`).join('')}</ul>`;
    },
    // Select med kategorier
    // Utgiftskategorier grupperade per huvudkategori (optgroup)
    categoryOptions(selected) {
      const opt = c => `<option ${c.name === selected ? 'selected' : ''}>${esc(c.name)}</option>`;
      const parents = state.parents || [];
      const groups = parents.map(p => [p, state.categories.filter(c => c.parent === p)]);
      groups.push([OTHER_PARENT, state.categories.filter(c => !c.parent || !parents.includes(c.parent))]);
      return groups.filter(([, items]) => items.length)
        .map(([p, items]) => `<optgroup label="${esc(p)}">${items.map(opt).join('')}</optgroup>`).join('');
    },
    incomeOptions(selected) {
      return state.incomeCategories.map(c => `<option ${c.name === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    },
    monthOptions(selectedIndex) {
      return MONTHS.map((m, i) => `<option value="${i}" ${i === selectedIndex ? 'selected' : ''}>${fmt.cap(m)}</option>`).join('');
    },
    yearOptions(selected) {
      const years = new Set([today().getFullYear(), selected]);
      state.transactions.forEach(t => years.add(Number(t.date.slice(0, 4))));
      return [...years].sort().map(y => `<option ${y === selected ? 'selected' : ''}>${y}</option>`).join('');
    },
  };

  function currencySymbol() {
    const parts = new Intl.NumberFormat((CURRENCIES[state.settings.currency] || CURRENCIES.SEK).locale, { style: 'currency', currency: state.settings.currency }).formatToParts(0);
    return (parts.find(p => p.type === 'currency') || { value: '' }).value;
  }

  // ---------- Tooltip ----------
  function tooltipEl() { return document.getElementById('tooltip'); }
  function showTooltip(html, x, y) {
    const t = tooltipEl();
    t.innerHTML = html;
    t.hidden = false;
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = clamp(x - w / 2, 8, window.innerWidth - w - 8) + 'px';
    t.style.top = Math.max(8, y - h - 12) + 'px';
  }
  function hideTooltip() { const t = tooltipEl(); if (t) t.hidden = true; }
  function bindTooltip(target, html) {
    target.addEventListener('mousemove', e => showTooltip(html, e.clientX, e.clientY));
    target.addEventListener('focus', () => { const r = target.getBoundingClientRect(); showTooltip(html, r.left + r.width / 2, r.top); });
    target.addEventListener('mouseleave', hideTooltip);
    target.addEventListener('blur', hideTooltip);
  }
  const tipRow = (color, name, value) => `<div class="row"><span class="swatch" style="background:${color}"></span><span>${esc(name)}</span><span>${value}</span></div>`;

  // ---------- Diagram (SVG) ----------
  const charts = {
    /**
     * Stapeldiagram. Ritas in i ett element (div.chart).
     * opts: { labels: [..], series: [{ name, color, values: [..] }], height, wide (breda staplar),
     *         plotBg, highlightLast, format (fn för tooltip), axisColor, gridColor, onDark }
     */
    bars(el, opts) {
      if (!el) return;
      const { labels, series, wide = false, plotBg = '', highlightLast = false, onDark = false } = opts;
      const format = opts.format || fmt.money;
      const draw = () => {
        const W = Math.max(280, el.clientWidth || 600);
        const H = opts.height || (W < 500 ? 200 : 240);
        const pad = { top: 10, right: 4, bottom: 24, left: 42 };
        const innerW = W - pad.left - pad.right;
        const innerH = H - pad.top - pad.bottom;
        // Jämnt steg först (1/2/2,5/5 × 10ⁿ), sedan max = 4 steg → axlar som 0, 15, 30, 45, 60 tn
        const step = niceMax(Math.max(4, ...series.flatMap(s => s.values)) / 4);
        const max = step * 4;
        const y = v => pad.top + innerH - (Math.max(0, v) / max) * innerH;
        const n = labels.length;
        const slot = innerW / n;
        const groups = series.length;
        const gap = 2;
        const barW = wide
          ? Math.max(6, Math.min(48, (slot * 0.62 - gap * (groups - 1)) / groups))
          : Math.max(4, Math.min(12, slot * 0.22));
        const labelEvery = W < 500 && n > 8 ? Math.ceil(n / 6) : 1;
        const axisCls = onDark ? 'axis-label on-dark' : 'axis-label';
        const gridCls = onDark ? 'grid-line on-dark' : 'grid-line';

        let svg = plotBg ? `<rect x="${pad.left}" y="${pad.top}" width="${innerW}" height="${innerH}" rx="8" fill="${plotBg}"/>` : '';
        [0, 0.25, 0.5, 0.75, 1].forEach(f => {
          const v = f * max;
          svg += `<line class="${gridCls}" x1="${pad.left}" x2="${W - pad.right}" y1="${y(v)}" y2="${y(v)}"/>`;
          svg += `<text class="${axisCls}" x="${pad.left - 8}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? '0' : fmt.axis(v)}</text>`;
        });
        labels.forEach((label, i) => {
          const cx = pad.left + slot * i + slot / 2;
          const total = groups * barW + (groups - 1) * gap;
          series.forEach((s, k) => {
            const v = s.values[i] || 0;
            let color = s.color;
            if (highlightLast && i === n - 1 && s.highlight) color = s.highlight;
            svg += barPath(cx - total / 2 + k * (barW + gap), y(v), barW, y(0) - y(v), color);
          });
          if (i % labelEvery === 0) svg += `<text class="${axisCls}" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(label)}</text>`;
          const aria = series.map(s => `${s.name} ${format(s.values[i] || 0)}`).join(', ');
          svg += `<rect class="hit" data-i="${i}" tabindex="0" x="${pad.left + slot * i}" y="${pad.top}" width="${slot}" height="${innerH}" rx="6" aria-label="${esc(label)}: ${esc(aria)}"/>`;
        });
        el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || 'Stapeldiagram')}">${svg}</svg>`;
        el.querySelectorAll('.hit').forEach(r => {
          const i = Number(r.dataset.i);
          bindTooltip(r, `<b>${esc(opts.tooltipLabels ? opts.tooltipLabels[i] : labels[i])}</b>${series.map(s => tipRow(s.color, s.name, format(s.values[i] || 0))).join('')}`);
        });
      };
      draw();
      el._redraw = draw;
    },

    /**
     * Ringdiagram. items: [{ name, color, value }], center: { label, value }
     */
    donut(el, { items, center = {}, size = 200, label = 'Ringdiagram' }) {
      if (!el) return;
      const list = items.filter(i => i.value > 0);
      const total = sum(list.map(i => i.value));
      const R = 80, SW = 22, C = 2 * Math.PI * R, GAP = list.length > 1 ? 2 : 0;
      let offset = 0;
      const segs = list.map((e, i) => {
        const len = (e.value / total) * C;
        const s = `<circle class="seg" data-i="${i}" tabindex="0" cx="100" cy="100" r="${R}" fill="none" stroke="${e.color}" stroke-width="${SW}"
          stroke-dasharray="${Math.max(0, len - GAP)} ${C}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)" aria-label="${esc(e.name)}: ${fmt.money(e.value)}"/>`;
        offset += len;
        return s;
      }).join('');
      el.classList.add('donut');
      el.style.width = size + 'px';
      el.innerHTML = `<svg viewBox="0 0 200 200" role="img" aria-label="${esc(label)}">
          <circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--track)" stroke-width="${SW}"/>${segs}
        </svg>
        <div class="donut-center">${center.label ? `<small>${center.label}</small>` : ''}${center.value ? `<b>${center.value}</b>` : ''}${center.sub ? `<span>${center.sub}</span>` : ''}</div>`;
      el.querySelectorAll('.seg').forEach(c => {
        const e = list[Number(c.dataset.i)];
        bindTooltip(c, tipRow(e.color, e.name, `${fmt.money(e.value)} · ${fmt.pct(e.value / total)}`));
      });
    },

    // HTML för en lista bredvid ett ringdiagram
    donutLegend(items) {
      const list = items.filter(i => i.value > 0);
      const total = sum(list.map(i => i.value));
      if (!list.length) return '<p class="muted">Inga belopp ännu.</p>';
      return `<ul class="cat-list">${list.map(i => `<li><span class="swatch" style="background:${i.color}"></span><span class="name">${esc(i.name)}</span><span class="pct">${fmt.pct(i.value / total)}</span></li>`).join('')}</ul>`;
    },

    /**
     * Framstegsring. share 0..1 (kan vara >1). center: { value, label, sub }
     */
    ring(el, { share, center = {}, size = 180, color = 'var(--dark)', stroke = 14 }) {
      if (!el) return;
      const R = 80, C = 2 * Math.PI * R;
      const len = clamp(share, 0, 1) * C;
      el.classList.add('donut');
      el.style.width = size + 'px';
      el.innerHTML = `<svg viewBox="0 0 200 200" role="img" aria-label="${esc((center.value || '') + ' ' + (center.label || ''))}">
          <circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
          ${len > 0 ? `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${len} ${C}" transform="rotate(-90 100 100)"/>` : ''}
        </svg>
        <div class="donut-center">${center.value ? `<b>${center.value}</b>` : ''}${center.label ? `<small>${center.label}</small>` : ''}${center.sub ? `<span>${center.sub}</span>` : ''}</div>`;
    },
  };

  function barPath(x, top, w, h, fill) {
    if (h <= 0.5) return '';
    const r = Math.min(4, w / 2, h);
    const b = top + h;
    return `<path fill="${fill}" d="M${x},${b} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${b} Z"/>`;
  }
  function niceMax(v) {
    const step = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / step;
    const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return nice * step;
  }

  // ---------- Dialog: lägg till transaktion ----------
  function openTransactionDialog(preset = {}) {
    const dlg = document.getElementById('dialog');
    const t = { type: 'expense', date: iso(today()), category: state.categories[0]?.name || '', title: '', account: state.accounts[0]?.name || '', amount: '', recurring: false, ...preset };
    dlg.innerHTML = `
      <form method="dialog" class="dialog-form" id="txForm">
        <p class="overline">Ny post</p>
        <h2 class="card-title">Lägg till transaktion</h2>
        <div class="seg-control" role="radiogroup">
          <label><input type="radio" name="type" value="expense" ${t.type === 'expense' ? 'checked' : ''}><span>Utgift</span></label>
          <label><input type="radio" name="type" value="income" ${t.type === 'income' ? 'checked' : ''}><span>Inkomst</span></label>
        </div>
        <div class="form-grid">
          ${ui.field('Belopp', ui.moneyInput(`name="amount" required min="0" value="${esc(t.amount)}"`))}
          ${ui.field('Datum', `<input type="date" name="date" required value="${t.date}">`)}
          ${ui.field('Kategori', `<select name="category" id="txCategory"></select>`)}
          ${ui.field('Beskrivning', `<input name="title" placeholder="t.ex. ICA eller arbetsgivare" value="${esc(t.title)}">`)}
          ${ui.field('Konto', `<select name="account"><option value="">Inget konto</option>${state.accounts.map(a => `<option ${a.name === t.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`)}
          <label class="check"><input type="checkbox" name="recurring" ${t.recurring ? 'checked' : ''}> Återkommande</label>
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" value="cancel" id="txCancel">Avbryt</button>
          <button type="submit" class="btn btn-primary">Spara</button>
        </div>
      </form>`;
    const form = dlg.querySelector('#txForm');
    // Kategorilistan följer vald typ: inkomstkategorier eller utgiftskategorier
    const catSelect = form.querySelector('#txCategory');
    const fillCategories = () => {
      const isIncome = form.querySelector('[name=type]:checked').value === 'income';
      catSelect.innerHTML = isIncome ? ui.incomeOptions(t.category) : ui.categoryOptions(t.category);
    };
    form.querySelectorAll('[name=type]').forEach(r => r.addEventListener('change', fillCategories));
    fillCategories();
    dlg.querySelector('#txCancel').addEventListener('click', () => dlg.close());
    form.addEventListener('submit', e => {
      e.preventDefault();
      const f = new FormData(form);
      const amount = Math.abs(Number(f.get('amount')));
      if (!amount) return;
      const type = f.get('type');
      update(s => {
        s.transactions.unshift({
          id: uid(), date: f.get('date'), type,
          category: f.get('category'),
          title: f.get('title').trim(), account: f.get('account'), amount, recurring: f.get('recurring') === 'on',
        });
        s.transactions.sort((a, b) => b.date.localeCompare(a.date));
      });
      dlg.close();
    });
    dlg.showModal();
    form.querySelector('[name=amount]').focus();
  }

  function confirmDialog(message) {
    return window.confirm(message);
  }

  // ---------- Router ----------
  const PAGES = [];
  let current = null;

  function page(def) { PAGES.push(def); }

  function navHTML(activeId) {
    return PAGES.map(p =>
      `<a href="#/${p.id}" ${p.id === activeId ? 'aria-current="page"' : ''}>${icon(p.icon)}<span>${p.title}</span></a>`
    ).join('');
  }

  function topbarHTML(p) {
    const cur = state.settings.currency;
    return `<div class="page-top">
      <div>
        <p class="overline">${esc(p.overline || p.title)}</p>
        <h1 class="page-title">${esc(p.heading || p.title)}</h1>
      </div>
      <div class="page-actions">
        <label class="select-pill"><span class="sr-only">Valuta</span>
          <select id="currencySelect">${Object.entries(CURRENCIES).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
        </label>
        <button class="btn btn-primary" id="addTxBtn">${icon('plus', 14)} Lägg till transaktion</button>
      </div>
    </div>
    ${mode === 'demo' ? `<div class="demo-banner"><span><b>✦ Exempeldata</b> · Exempelläget är skilt från dina egna uppgifter. Avsluta för att komma tillbaka till dem.</span><button class="btn btn-small" id="exitDemo">Avsluta exempelläge</button></div>` : ''}`;
  }

  function render() {
    hideTooltip();
    const id = location.hash.replace(/^#\/?/, '').split('?')[0] || PAGES[0].id;
    const p = PAGES.find(x => x.id === id) || PAGES[0];
    const changed = current !== p;
    current = p;
    document.getElementById('nav').innerHTML = navHTML(p.id);
    document.title = `${p.title} – Budget`;
    const root = document.getElementById('page');
    const scrollY = window.scrollY;
    let body;
    try {
      body = p.render(state);
    } catch (err) {
      console.error(err);
      body = ui.card({ title: 'Något gick fel', body: `<p class="muted">${esc(err.message)}</p>` });
    }
    root.innerHTML = topbarHTML(p) + `<div class="page-body">${body}</div>`;
    root.querySelector('#currencySelect').addEventListener('change', e => update(s => { s.settings.currency = e.target.value; }));
    root.querySelector('#addTxBtn').addEventListener('click', () => openTransactionDialog());
    const exit = root.querySelector('#exitDemo');
    if (exit) exit.addEventListener('click', () => setMode('personal'));
    if (p.mount) {
      try { p.mount(root.querySelector('.page-body'), state); } catch (err) { console.error(err); }
    }
    closeMenu();
    window.scrollTo(0, changed ? 0 : scrollY);
  }

  // ---------- Mobilmeny ----------
  function closeMenu() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('scrim').classList.remove('open');
    document.getElementById('menuBtn').setAttribute('aria-expanded', 'false');
  }

  function start() {
    load();
    document.getElementById('menuBtn').addEventListener('click', () => {
      document.getElementById('sidebar').classList.add('open');
      document.getElementById('scrim').classList.add('open');
      document.getElementById('menuBtn').setAttribute('aria-expanded', 'true');
    });
    document.getElementById('scrim').addEventListener('click', closeMenu);
    window.addEventListener('hashchange', render);
    let timer;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => document.querySelectorAll('.chart').forEach(c => c._redraw && c._redraw()), 150);
    });
    render();
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  return {
    page, start, update, save, render, setMode, replaceState, resetAll, onChange, applyRemote, readPersonal,
    get state() { return state; },
    get mode() { return mode; },
    get storageKeys() { return KEYS; },
    COLORS, CATEGORY_COLORS, CURRENCIES, OTHER_PARENT,
    uid, esc, iso, ym, parseISO, today, daysInMonth, addMonths, sum, clamp, pad2,
    fmt, calc, ui, charts, period, categoryColor, currencySymbol,
    openTransactionDialog, confirm: confirmDialog, bindTooltip, tipRow,
  };
})();
