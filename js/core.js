// ============================================================
// Budget – kärna: data, beräkningar, formatering, UI-byggstenar,
// diagram och router. Sidorna ligger i js/pages/ och registrerar
// sig med App.page({...}).
// ============================================================
'use strict';

const App = (() => {
  const KEYS = { personal: 'budget-personal-v2', mode: 'budget-mode' };
  const OLD_DEMO_KEY = 'budget-demo-v2'; // exempelläget är borttaget; gammal data städas bort

  // ---------- Kategorier ----------
  // Färgerna är kontrollerade för färgblindhet (i den här ordningen).
  const CATEGORY_COLORS = ['#9a4a22', '#00897a', '#d08a1c', '#6b5ab2', '#7a8a12', '#c4507c', '#3f7fc4', '#7a4a8a'];
  // Huvudkategorier för utgifter, i den ordning de visas. Inkomster visas alltid först.
  const DEFAULT_PARENTS = ['Fasta kostnader', 'Sparande', 'Rörliga utgifter', 'Livsstil'];
  // Typ per huvudkategori: styr vad kategorierna under den räknas som i hela appen
  const PARENT_TYPES = { fixed: 'Fasta kostnader', variable: 'Rörliga utgifter', saving: 'Sparande' };
  const DEFAULT_PARENT_TYPES = { 'Fasta kostnader': 'fixed', 'Sparande': 'saving', 'Rörliga utgifter': 'variable', 'Livsstil': 'variable' };
  const DEBT_HINT = /lån|skuld|avbetal|kredit|klarna|walley|debt|loan/i;
  const DEFAULT_CATEGORIES = [
    { name: 'Boende',     group: 'needs',  parent: 'Fasta kostnader'  },
    { name: 'Mat',        group: 'needs',  parent: 'Rörliga utgifter' },
    { name: 'Transport',  group: 'needs',  parent: 'Fasta kostnader'  },
    { name: 'Livsstil',   group: 'wants',  parent: 'Livsstil'         },
    { name: 'Hälsa',      group: 'needs',  parent: 'Fasta kostnader'  },
    { name: 'Utbildning', group: 'needs',  parent: 'Rörliga utgifter' },
    { name: 'Sparande',   group: 'future', parent: 'Sparande'         },
    { name: 'Skulder',    group: 'future', parent: 'Fasta kostnader', debt: true },
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
  // Alla belopp är i svenska kronor.
  const MONEY = {
    2: new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    0: new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  };
  const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

  const fmt = {
    money: (v, decimals = 2) => (MONEY[decimals] || MONEY[2]).format(Number(v) || 0),
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
      settings: { frequency: 'monthly', startDate: `${now.getFullYear()}-01-01`, heroImage: null, period: { mode: 'calendar', payday: 25 } },
      categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),   // utgiftskategorier (underkategorier)
      parents: [...DEFAULT_PARENTS],                           // huvudkategorier för utgifter, i ordning
      parentTypes: { ...DEFAULT_PARENT_TYPES },                // { huvudkategori: fixed|variable|saving }
      incomeLabel: 'Inkomster',                                // rubriken för inkomstkategorierna
      typesV: 1,                                               // kategorityper är satta (styr migreringen)
      incomeCategories: DEFAULT_INCOME.map(c => ({ ...c })),  // underkategorier för inkomster
      budgets: {},                 // { "2026-11": { Boende: 8500, ... } }
      // type transfer = flytt mellan egna konton (toAccountId), räknas inte i budgeten.
      // goalId/debtId kopplar till sparmål/skuld, billId + billMonth till en betald räkning.
      transactions: [],            // { id, date, type: income|expense|transfer, category, title, accountId, toAccountId, goalId, debtId, billId, billMonth, amount, recurring }
      // Saldot räknas fram: startBalance + transaktioner. categories = sparkategorier vars
      // utgifter hamnar på kontot (pengarna flyttas dit från kontot transaktionen gjordes på).
      accounts: [],                // { id, name, type: checking|savings|investment, startBalance, categories: [], archived, reconciled }
      // Räkningar räknas som betalda när det finns en transaktion för dem (billId + billMonth).
      bills: [],                   // { id, name, amount, dueDate, recurrence: monthly|yearly|once, category, accountId, debtId?, goalId? }
      // Sparat = startAmount + kopplade transaktioner (goalId, eller en kategori i categories).
      goals: [],                   // { id, name, target, startAmount, categories: [], date, accountId, notes }
      // Saldo = original + adjust − kopplade transaktioner (debtId, eller en kategori i categories).
      debts: [],                   // { id, name, original, adjust, categories: [], apr, installment, extra, payDay, start, end, notes }
      snapshots: [],               // används inte längre (historiken räknas fram), finns kvar för gammal data
      paycheck: { start: iso(new Date(now.getFullYear(), now.getMonth(), 1)), end: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)), income: 0, alloc: {} },
      strategy: 'snowball',
    };
  }

  // Appen har bara ett läge: din egen data (mode finns kvar för molnsynken)
  const mode = 'personal';
  let state = emptyState();

  function read(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  function load() {
    try { localStorage.removeItem(OLD_DEMO_KEY); } catch (e) { /* ignorera */ }
    state = migrate(read(KEYS.personal)) || emptyState();
    save();
  }

  function migrate(s) {
    if (!s || s.version !== 2) return null;
    const out = { ...emptyState(), ...s, settings: { ...emptyState().settings, ...s.settings } };
    delete out.settings.currency; // appen visar alltid svenska kronor
    delete out.forecast;          // sidan Sparprognos är borttagen
    delete out.noSpend;           // sidan Köpfri utmaning är borttagen
    delete out.defaultBudget;     // ingen standardbudget: en månad utan plan tar förra månadens
    // Äldre data utan inkomstkategorier: hämta dem från befintliga inkomster
    if (!Array.isArray(s.incomeCategories)) {
      const names = [...new Set((s.transactions || []).filter(t => t.type === 'income').map(t => t.category).filter(Boolean))];
      out.incomeCategories = (names.length ? names : DEFAULT_INCOME.map(c => c.name)).map(name => ({ name }));
    }
    // Typ på huvudkategorierna: huvudkategorier som saknar typ får en gissning från namnet
    const types = { ...(s.parentTypes || {}) };
    (out.parents || []).forEach(p => {
      if (!types[p]) types[p] = /fast|fixed/i.test(p) ? 'fixed' : /spar|saving/i.test(p) ? 'saving' : 'variable';
    });
    out.parentTypes = Object.fromEntries((out.parents || []).map(p => [p, types[p]]));
    // Skuldbetalning (en gång): kategorier vars namn låter som lån eller avbetalningar
    if (!s.typesV) {
      out.categories = (out.categories || []).map(c => (c.debt === undefined && DEBT_HINT.test(c.name) ? { ...c, debt: true } : c));
      out.typesV = 1;
    }
    // Konton: det gamla manuella saldot ersätts av ett startsaldo (0 = saldot när budgeten började)
    out.accounts = (out.accounts || []).map(a => {
      const { balance, ...rest } = a;
      return { startBalance: 0, categories: [], archived: false, ...rest };
    });
    // Transaktioner pekar på kontots id i stället för namnet (tål namnbyten)
    out.transactions = (out.transactions || []).map(t => {
      if (t.accountId !== undefined) return t;
      const { account, ...rest } = t;
      const acc = out.accounts.find(a => a.name === account);
      return { ...rest, accountId: acc ? acc.id : '' };
    });
    // Sparmål: det gamla manuella beloppet blir startbelopp, transaktioner fyller på
    out.goals = (out.goals || []).map(g => {
      if (g.startAmount !== undefined) return g;
      const { current, history, ...rest } = g;
      return { categories: [], ...rest, startAmount: Number(current) || 0 };
    });
    // Skulder: det gamla saldot blir startskuld, kopplade transaktioner betalar av
    out.debts = (out.debts || []).map(d => {
      if (d.adjust !== undefined) return d;
      const { balance, payments, ...rest } = d;
      return { categories: [], ...rest, original: Number(balance) || 0, adjust: 0 };
    });
    // Räkningar: avbockningar ersätts av transaktioner
    out.bills = (out.bills || []).map(b => {
      if (!('paid' in b)) return b;
      const { paid, ...rest } = b;
      return { category: '', accountId: '', ...rest };
    });
    return out;
  }

  function save() {
    write(KEYS.personal, state);
    try { localStorage.setItem(KEYS.mode, mode); } catch (e) { /* ignorera */ }
  }

  // Lyssnare som får veta när den personliga datan ändrats av användaren (molnsynk).
  const changeListeners = [];
  function onChange(fn) { changeListeners.push(fn); }
  function changed() {
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
    state = next;
    save();
    render();
    return true;
  }
  function readPersonal() { return read(KEYS.personal); }

  function replaceState(next) {
    state = migrate(next) || emptyState();
    save();
    changed();
    render();
  }

  function resetAll() {
    try { Object.values(KEYS).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignorera */ }
    state = emptyState();
    save();
    changed();
    render();
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

    // Planerad budget för en period: periodens egen plan, annars den senaste perioden
    // innan som har en plan. Finns ingen tidigare plan är allt 0.
    planned: key => { const src = calc.plannedFrom(key); return src ? state.budgets[src] : {}; },
    // Vilken period budgeten hämtas från (samma nyckel = egen plan, null = ingen plan)
    plannedFrom(key) {
      if (state.budgets[key]) return key;
      return Object.keys(state.budgets).filter(k => k < key).sort().pop() || null;
    },
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

    // ---------- Konton ----------
    // Standardkontot: transaktioner utan konto räknas hit.
    defaultAccount() {
      const active = state.accounts.filter(a => !a.archived);
      return active.find(a => a.id === state.settings.defaultAccountId)
        || active.find(a => a.type === 'checking') || active[0] || null;
    },
    // Kontot en sparkategori är kopplad till (eller null)
    accountForCategory: name => state.accounts.find(a => (a.categories || []).includes(name)) || null,

    /**
     * Hur en transaktion påverkar kontona: [{ accountId, amount }].
     * Inkomst: + på kontot. Utgift: − på kontot. Utgift i en sparkategori som är kopplad
     * till ett konto: pengarna flyttas dit (negativt belopp = uttag, flyttas tillbaka).
     */
    txMoves(t) {
      const def = calc.defaultAccount();
      const from = (t.accountId && state.accounts.some(a => a.id === t.accountId)) ? t.accountId : (def ? def.id : '');
      if (t.type === 'income') return from ? [{ accountId: from, amount: t.amount }] : [];
      if (t.type === 'transfer') {
        const to = state.accounts.some(a => a.id === t.toAccountId) ? t.toAccountId : '';
        return [from && { accountId: from, amount: -t.amount }, to && to !== from && { accountId: to, amount: t.amount }].filter(Boolean);
      }
      const target = calc.accountForCategory(t.category);
      if (target) {
        // Lagd direkt på sparkontot: pengarna kommer från standardkontot
        const source = from === target.id ? (def && def.id !== target.id ? def.id : '') : from;
        return [source && { accountId: source, amount: -t.amount }, { accountId: target.id, amount: t.amount }].filter(Boolean);
      }
      return from ? [{ accountId: from, amount: -t.amount }] : [];
    },

    // Senaste marknadsvärdet för ett investeringskonto (t.o.m. ett datum), eller null
    valuationAt(a, until = '') {
      if (a.type !== 'investment') return null;
      return (a.valuations || []).filter(v => !until || v.date <= until)
        .reduce((best, v) => (!best || v.date >= best.date ? v : best), null);
    },
    /**
     * { kontoId: saldo } för alla konton, eventuellt bara t.o.m. ett datum.
     * Investeringskonton med ett inlagt marknadsvärde: värdet + rörelser efter den dagen.
     * deposited = true ger i stället bara det som satts in (startsaldo + rörelser).
     */
    balances(until = '', deposited = false) {
      const out = {};
      const since = {};
      state.accounts.forEach(a => {
        const v = deposited ? null : calc.valuationAt(a, until);
        out[a.id] = v ? Number(v.value) || 0 : Number(a.startBalance) || 0;
        since[a.id] = v ? v.date : '';
      });
      for (const t of state.transactions) {
        if (until && t.date > until) continue;
        for (const m of calc.txMoves(t)) {
          if (!(m.accountId in out) || (since[m.accountId] && t.date <= since[m.accountId])) continue;
          out[m.accountId] += m.amount;
        }
      }
      Object.keys(out).forEach(k => { out[k] = Math.round(out[k] * 100) / 100; });
      return out;
    },
    // Aktiva konton med uträknat saldo. Investeringskonton får även insatt belopp och avkastning.
    accounts() {
      const b = calc.balances();
      const dep = calc.balances('', true);
      return state.accounts.filter(a => !a.archived).map(a => {
        const valuation = calc.valuationAt(a);
        const balance = b[a.id] || 0;
        return valuation
          ? { ...a, balance, valuation, deposited: dep[a.id] || 0, gain: Math.round((balance - (dep[a.id] || 0)) * 100) / 100 }
          : { ...a, balance };
      });
    },
    // Transaktioner som rör ett konto, nyast först, med beloppet för just det kontot
    accountTx(id) {
      return state.transactions
        .map(t => ({ t, amount: sum(calc.txMoves(t).filter(m => m.accountId === id).map(m => m.amount)) }))
        .filter(x => calc.txMoves(x.t).some(m => m.accountId === id))
        .sort((a, b) => b.t.date.localeCompare(a.t.date));
    },
    accountName: id => (state.accounts.find(a => a.id === id) || {}).name || '',

    assets: () => sum(calc.accounts().filter(a => a.balance > 0).map(a => a.balance)),
    liquid: () => sum(calc.accounts().filter(a => a.type !== 'investment' && a.balance > 0).map(a => a.balance)),
    negativeAccounts: () => -sum(calc.accounts().filter(a => a.balance < 0).map(a => a.balance)),
    // ---------- Sparmål och skulder ----------
    // Vilket sparmål / vilken skuld en transaktion hör till: uttryckligen, annars via kategorin
    goalOf(t) {
      if (t.goalId) return state.goals.find(g => g.id === t.goalId) || null;
      if (t.type === 'transfer' || t.goalId === null) return null;
      return state.goals.find(g => (g.categories || []).includes(t.category)) || null;
    },
    debtOf(t) {
      if (t.debtId) return state.debts.find(d => d.id === t.debtId) || null;
      if (t.type !== 'expense' || t.debtId === null) return null;
      return state.debts.find(d => (d.categories || []).includes(t.category)) || null;
    },
    goalTx: id => state.transactions.filter(t => calc.goalOf(t)?.id === id).sort((a, b) => b.date.localeCompare(a.date)),
    debtTx: id => state.transactions.filter(t => calc.debtOf(t)?.id === id).sort((a, b) => b.date.localeCompare(a.date)),
    // Sparmål med uträknat belopp (current)
    goals() {
      const add = {};
      for (const t of state.transactions) { const g = calc.goalOf(t); if (g) add[g.id] = (add[g.id] || 0) + t.amount; }
      return state.goals.map(g => ({ ...g, current: Math.round(((Number(g.startAmount) || 0) + (add[g.id] || 0)) * 100) / 100 }));
    },
    // Skulder med uträknat saldo (balance) och betalt (paid)
    debts() {
      const paid = {};
      for (const t of state.transactions) { const d = calc.debtOf(t); if (d) paid[d.id] = (paid[d.id] || 0) + t.amount; }
      return state.debts.map(d => {
        const p = Math.round((paid[d.id] || 0) * 100) / 100;
        return { ...d, paid: p, balance: Math.max(0, Math.round(((Number(d.original) || 0) + (Number(d.adjust) || 0) - p) * 100) / 100) };
      });
    },

    // Skulder som de såg ut ett visst datum (bara betalningar t.o.m. datumet räknas)
    debtsAt(until) {
      const paid = {};
      for (const t of state.transactions) { if (t.date > until) continue; const d = calc.debtOf(t); if (d) paid[d.id] = (paid[d.id] || 0) + t.amount; }
      return sum(state.debts.map(d => Math.max(0, (Number(d.original) || 0) + (Number(d.adjust) || 0) - (paid[d.id] || 0))));
    },
    // Nettoförmögenhet ett visst datum, räknad från konton och skulder
    netWorthAt(until) {
      const b = calc.balances(until);
      const vals = state.accounts.filter(a => !a.archived).map(a => b[a.id] || 0);
      return sum(vals) - calc.debtsAt(until);
    },
    // [{ key, value }] för budgetperioderna, värdet vid periodens slut (idag för innevarande)
    netWorthSeries(keys) {
      const now = iso(today());
      return keys.map(k => { const end = period.range(k).end; return { key: k, value: Math.round(calc.netWorthAt(end < now ? end : now)) }; });
    },
    // Perioder från första transaktionen (max n st) fram till nu
    historyKeys(n = 12) {
      const cur = period.current();
      const first = state.transactions.reduce((m, t) => (t.date < m ? t.date : m), iso(today()));
      const keys = [];
      for (let k = period.keyOf(first); k <= cur; k = addMonths(k, 1)) keys.push(k);
      return keys.slice(-n);
    },
    // Är en utgiftskategori sparande? (grupp Framtid, eller kopplad till sparkonto/sparmål)
    // ---------- Kategorityper (väljs under Inställningar) ----------
    parentType: p => (state.parentTypes || {})[p] || 'variable',
    // 'debt' | 'fixed' | 'variable' | 'saving' för en utgiftskategori
    categoryKind(name) {
      const c = state.categories.find(x => x.name === name);
      if (!c) return 'variable';
      return c.debt ? 'debt' : calc.parentType(c.parent);
    },
    isSaving: name => calc.categoryKind(name) === 'saving',
    isFixed: name => calc.categoryKind(name) === 'fixed',
    isDebt: name => calc.categoryKind(name) === 'debt',

    totalDebt: () => sum(calc.debts().map(d => d.balance)) + calc.negativeAccounts(),
    netWorth: () => calc.assets() - calc.totalDebt(),
    totalSaved: () => sum(calc.goals().map(g => g.current)),

    // Räkningar som infaller en viss månad, med datum och betalstatus
    billsForMonth(key) {
      return state.bills.flatMap(b => {
        const due = parseISO(b.dueDate);
        const dueKey = ym(due);
        if (b.recurrence === 'once' && dueKey !== key) return [];
        if (b.recurrence === 'yearly' && Number(key.slice(5)) !== due.getMonth() + 1) return [];
        if (dueKey > key && b.recurrence !== 'once') return [];
        const day = Math.min(due.getDate(), daysInMonth(key));
        const tx = calc.billTx(b, key);
        return [{ ...b, date: `${key}-${pad2(day)}`, isPaid: !!tx, tx }];
      }).sort((a, b) => a.date.localeCompare(b.date));
    },

    // Transaktionen som betalade räkningen en viss månad: kopplad direkt, eller en utgift
    // i samma kategori, samma kalendermånad och med samma belopp som inte hör till en annan räkning.
    billTx(b, key) {
      const linked = state.transactions.find(t => t.billId === b.id && t.billMonth === key);
      if (linked) return linked;
      if (!b.category) return null;
      return state.transactions.find(t => !t.billId && t.type === 'expense' && t.category === b.category
        && t.date.slice(0, 7) === key && Math.abs(t.amount - b.amount) < 0.5) || null;
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
    // Input med kr-prefix
    moneyInput(attrs) {
      return `<span class="input-money"><span>kr</span><input type="number" inputmode="decimal" step="any" ${attrs}></span>`;
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
  // preset kan innehålla en befintlig transaktion (id) → redigering.
  // goalId/debtId: undefined = följ kategorin, null = uttryckligen ingen, id = kopplad.
  function openTransactionDialog(preset = {}) {
    const dlg = document.getElementById('dialog');
    const editing = !!(preset.id && state.transactions.some(x => x.id === preset.id));
    const t = { type: 'expense', date: iso(today()), category: state.categories[0]?.name || '', title: '', accountId: calc.defaultAccount()?.id || '', toAccountId: '', amount: '', recurring: false, ...preset };
    const activeAccounts = state.accounts.filter(a => !a.archived || a.id === t.accountId || a.id === t.toAccountId);
    const accOpts = (sel, none) => `${none ? `<option value="">${none}</option>` : ''}${activeAccounts.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}`;
    const goal0 = calc.goalOf(t), debt0 = calc.debtOf(t);
    const goals = state.goals, debts = state.debts;

    dlg.innerHTML = `
      <form method="dialog" class="dialog-form" id="txForm">
        <p class="overline">${editing ? 'Ändra post' : 'Ny post'}</p>
        <h2 class="card-title">${editing ? 'Redigera transaktion' : 'Lägg till transaktion'}</h2>
        <div class="seg-control" role="radiogroup">
          <label><input type="radio" name="type" value="expense" ${t.type === 'expense' ? 'checked' : ''}><span>Utgift</span></label>
          <label><input type="radio" name="type" value="income" ${t.type === 'income' ? 'checked' : ''}><span>Inkomst</span></label>
          ${state.accounts.length > 1 ? `<label><input type="radio" name="type" value="transfer" ${t.type === 'transfer' ? 'checked' : ''}><span>Överföring</span></label>` : ''}
        </div>
        <div class="form-grid">
          ${ui.field('Belopp', ui.moneyInput(`name="amount" required step="any" value="${esc(t.amount)}"`))}
          ${ui.field('Datum', `<input type="date" name="date" required value="${t.date}">`)}
          ${ui.field('Kategori', `<select name="category" id="txCategory"></select>`, 'tx-f-cat')}
          ${ui.field('Beskrivning', `<input name="title" placeholder="t.ex. ICA eller arbetsgivare" value="${esc(t.title)}">`)}
          ${ui.field('<span id="txAccLabel">Konto</span>', `<select name="accountId">${accOpts(t.accountId, activeAccounts.length ? '' : 'Inget konto')}</select>`)}
          ${ui.field('Till konto', `<select name="toAccountId">${accOpts(t.toAccountId, 'Välj konto')}</select>`, 'tx-f-to')}
          ${goals.length ? ui.field('Sparmål', `<select name="goalId" id="txGoal"><option value="">Inget</option>${goals.map(g => `<option value="${g.id}" ${goal0?.id === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>`, 'tx-f-goal') : ''}
          ${debts.length ? ui.field('Skuld', `<select name="debtId" id="txDebt"><option value="">Ingen</option>${debts.map(d => `<option value="${d.id}" ${debt0?.id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`, 'tx-f-debt') : ''}
          <p class="muted tx-move-hint" id="txMoveHint"></p>
          <label class="check tx-f-rec"><input type="checkbox" name="recurring" ${t.recurring ? 'checked' : ''}> Återkommande</label>
        </div>
        <p class="muted tx-sign-hint">Ett negativt belopp betyder pengar tillbaka, t.ex. ett uttag från sparandet eller en retur.</p>
        <div class="dialog-actions">
          ${editing ? '<button type="button" class="btn btn-danger" id="txDelete">Ta bort</button>' : ''}
          <button type="button" class="btn btn-secondary" value="cancel" id="txCancel">Avbryt</button>
          <button type="submit" class="btn btn-primary">Spara</button>
        </div>
      </form>`;
    const form = dlg.querySelector('#txForm');
    const $ = sel => form.querySelector(sel);
    const catSelect = $('#txCategory');
    const typeOf = () => form.querySelector('[name=type]:checked').value;
    const show = (cls, on) => { const el = form.querySelector('.' + cls); if (el) el.hidden = !on; };

    // Kategorilistan följer vald typ: inkomstkategorier eller utgiftskategorier
    const fillCategories = () => {
      catSelect.innerHTML = typeOf() === 'income' ? ui.incomeOptions(t.category) : ui.categoryOptions(t.category);
    };
    // När kategorin byts: föreslå sparmålet/skulden som kategorin är kopplad till
    const suggestLinks = () => {
      const probe = { type: typeOf(), category: catSelect.value };
      const g = calc.goalOf(probe), d = calc.debtOf(probe);
      if ($('#txGoal')) $('#txGoal').value = g ? g.id : '';
      if ($('#txDebt')) $('#txDebt').value = d ? d.id : '';
    };
    const refresh = () => {
      const type = typeOf();
      show('tx-f-cat', type !== 'transfer');
      show('tx-f-to', type === 'transfer');
      show('tx-f-debt', type === 'expense');
      show('tx-f-rec', type !== 'transfer');
      $('#txAccLabel').textContent = type === 'transfer' ? 'Från konto' : 'Konto';
      const target = type === 'expense' && calc.accountForCategory(catSelect.value);
      const hint = $('#txMoveHint');
      hint.textContent = type === 'transfer' ? 'En överföring flyttar pengar mellan dina konton och räknas inte i budgeten.'
        : target ? `Pengarna flyttas till ${target.name}.` : '';
      hint.hidden = !hint.textContent;
    };
    form.querySelectorAll('[name=type]').forEach(r => r.addEventListener('change', () => { fillCategories(); suggestLinks(); refresh(); }));
    catSelect.addEventListener('change', () => { suggestLinks(); refresh(); });
    fillCategories();
    refresh();

    $('#txCancel').addEventListener('click', () => dlg.close());
    if (editing) $('#txDelete').addEventListener('click', async () => {
      if (!await confirmDialog('Ta bort transaktionen?')) return;
      update(s => { s.transactions = s.transactions.filter(x => x.id !== t.id); });
      dlg.close();
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const f = new FormData(form);
      const type = f.get('type');
      let amount = Number(f.get('amount'));
      if (!amount) return;
      if (type === 'transfer') {
        amount = Math.abs(amount);
        if (!f.get('toAccountId') || f.get('toAccountId') === f.get('accountId')) { $('[name=toAccountId]').focus(); return; }
      }
      // Kopplingar: spara uttryckligt val bara när det skiljer sig från kategorins förslag
      const probe = { type, category: f.get('category') };
      const pick = (val, auto) => val ? (auto && auto.id === val && !t.goalId && !t.debtId ? undefined : val) : (auto ? null : undefined);
      const goalId = f.has('goalId') ? pick(f.get('goalId'), calc.goalOf(probe)) : undefined;
      const debtId = type === 'expense' && f.has('debtId') ? pick(f.get('debtId'), calc.debtOf(probe)) : undefined;
      const tx = {
        id: editing ? t.id : uid(), date: f.get('date'), type,
        category: type === 'transfer' ? 'Överföring' : f.get('category'),
        title: f.get('title').trim(), accountId: f.get('accountId') || '', amount,
        recurring: type !== 'transfer' && f.get('recurring') === 'on',
      };
      if (type === 'transfer') tx.toAccountId = f.get('toAccountId');
      if (goalId !== undefined) tx.goalId = goalId;
      if (debtId !== undefined) tx.debtId = debtId;
      if (t.billId) { tx.billId = t.billId; tx.billMonth = t.billMonth; }
      update(s => {
        s.transactions = s.transactions.filter(x => x.id !== tx.id);
        s.transactions.unshift(tx);
        s.transactions.sort((a, b) => b.date.localeCompare(a.date));
      });
      dlg.close();
    });
    dlg.showModal();
    $('[name=amount]').focus();
  }

  // Bekräftelseruta i appens tema. Returnerar ett löfte: true = Ja, false = Avbryt.
  // opts: { ok: knapptext, danger: röd knapp (standard för "Ta bort") }
  function confirmDialog(message, opts = {}) {
    return new Promise(resolve => {
      const okLabel = opts.ok || (/^ta bort/i.test(message) ? 'Ta bort' : 'Fortsätt');
      const danger = opts.danger ?? /ta bort|arkiv/i.test(okLabel + message);
      const dlg = document.createElement('dialog');
      dlg.className = 'dialog confirm-dialog';
      dlg.innerHTML = `<form method="dialog" class="dialog-form">
          <p class="confirm-text">${esc(message)}</p>
          <div class="dialog-actions">
            <button type="button" class="btn btn-secondary" value="cancel">Avbryt</button>
            <button type="submit" class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" value="ok">${esc(okLabel)}</button>
          </div>
        </form>`;
      document.body.appendChild(dlg);
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        if (dlg.open) dlg.close();
        dlg.remove();
        resolve(ok);
      };
      dlg.querySelector('[value=cancel]').addEventListener('click', () => finish(false));
      dlg.querySelector('form').addEventListener('submit', e => { e.preventDefault(); finish(true); });
      dlg.addEventListener('click', e => { if (e.target === dlg) finish(false); }); // klick utanför
      dlg.addEventListener('cancel', e => { e.preventDefault(); finish(false); });  // Esc
      dlg.addEventListener('close', () => finish(false));
      dlg.showModal();
      dlg.querySelector('[value=ok]').focus();
    });
  }

  // ---------- Namnbyten (uppdaterar allt som pekar på namnet) ----------
  function renameCategory(oldName, newName) {
    const swapKeys = obj => { if (obj && oldName in obj) { obj[newName] = obj[oldName]; delete obj[oldName]; } };
    const swapList = list => (list || []).map(n => (n === oldName ? newName : n));
    update(s => {
      [...s.categories, ...s.incomeCategories].forEach(c => { if (c.name === oldName) c.name = newName; });
      s.transactions.forEach(t => { if (t.category === oldName) t.category = newName; });
      Object.values(s.budgets).forEach(swapKeys);
      if (s.paycheck) swapKeys(s.paycheck.alloc);
      [...s.accounts, ...s.goals, ...s.debts].forEach(x => { x.categories = swapList(x.categories); });
      s.bills.forEach(b => { if (b.category === oldName) b.category = newName; });
    });
  }
  function renameParent(oldName, newName) {
    update(s => {
      s.parents = s.parents.map(p => (p === oldName ? newName : p));
      s.categories.forEach(c => { if (c.parent === oldName) c.parent = newName; });
      s.parentTypes = s.parentTypes || {};
      if (oldName in s.parentTypes) { s.parentTypes[newName] = s.parentTypes[oldName]; delete s.parentTypes[oldName]; }
    });
  }

  // ---------- Router ----------
  const PAGES = [];
  let current = null;

  // Sidor med samma grupp visas som ett menyval med flikar högst upp
  const GROUPS = {
    oversikt: { title: 'Översikt', icon: 'home' },
    budget: { title: 'Budget', icon: 'calendar' },
    mal: { title: 'Mål', icon: 'target' },
    formogenhet: { title: 'Förmögenhet', icon: 'chart' },
  };
  // Gamla adresser (sidor som slagits ihop) leder till sin nya plats
  const ALIASES = {
    lon: 'manadsbudget', '503020': 'manadsbudget', kopfritt: 'oversikt',
    konton: 'formogenhet', nettoformogenhet: 'formogenhet',
  };
  const lastTab = {}; // senast visade flik per grupp

  function page(def) { PAGES.push(def); }

  function navHTML(active) {
    const seen = new Set();
    return PAGES.map(p => {
      if (p.group) {
        if (seen.has(p.group)) return '';
        seen.add(p.group);
        const g = GROUPS[p.group];
        const target = lastTab[p.group] || p.id;
        return `<a href="#/${target}" ${active.group === p.group ? 'aria-current="page"' : ''}>${icon(g.icon)}<span>${g.title}</span></a>`;
      }
      return `<a href="#/${p.id}" ${p.id === active.id ? 'aria-current="page"' : ''}>${icon(p.icon)}<span>${p.title}</span></a>`;
    }).join('');
  }

  function tabsHTML(p) {
    if (!p.group) return '';
    const tabs = PAGES.filter(x => x.group === p.group);
    return `<nav class="page-tabs" aria-label="${esc(GROUPS[p.group].title)}">${tabs.map(t =>
      `<a href="#/${t.id}" class="page-tab" ${t === p ? 'aria-current="page"' : ''}>${esc(t.tab || t.title)}</a>`).join('')}</nav>`;
  }
  function topbarHTML(p) {
    return `<div class="page-top">
      <div>
        <p class="overline">${esc(p.group ? GROUPS[p.group].title : (p.overline || p.title))}</p>
        <h1 class="page-title">${esc(p.heading || p.title)}</h1>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="addTxBtn">${icon('plus', 14)} Lägg till transaktion</button>
      </div>
    </div>
    ${tabsHTML(p)}
`;
  }

  function render() {
    hideTooltip();
    const raw = location.hash.replace(/^#\/?/, '').split('?')[0] || PAGES[0].id;
    if (ALIASES[raw]) { history.replaceState(null, '', `#/${ALIASES[raw]}`); }
    const id = ALIASES[raw] || raw;
    const p = PAGES.find(x => x.id === id) || PAGES[0];
    if (p.group) lastTab[p.group] = p.id;
    const changed = current !== p;
    current = p;
    document.getElementById('nav').innerHTML = navHTML(p);
    document.title = `${p.group ? `${GROUPS[p.group].title} · ${p.tab || p.title}` : p.title} – Budget`;
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
    root.querySelector('#addTxBtn').addEventListener('click', () => openTransactionDialog());
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
    const v = document.getElementById('appVersion');
    if (v && self.APP_VERSION) v.textContent = `Version ${self.APP_VERSION}`;
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
    page, start, update, save, render, replaceState, resetAll, onChange, applyRemote, readPersonal,
    get state() { return state; },
    get mode() { return mode; },
    get storageKeys() { return KEYS; },
    COLORS, CATEGORY_COLORS, OTHER_PARENT, PARENT_TYPES,
    renameCategory, renameParent,
    uid, esc, iso, ym, parseISO, today, daysInMonth, addMonths, sum, clamp, pad2,
    fmt, calc, ui, charts, period, categoryColor,
    openTransactionDialog, confirm: confirmDialog, bindTooltip, tipRow,
  };
})();
