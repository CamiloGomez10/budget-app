// Koppling (MCP-server) mellan Claude-appen och budgetappen, som Supabase Edge Function.
//
// Du lägger till den i Claude (Inställningar → Kopplingar → Lägg till egen koppling)
// och loggar in med ditt vanliga budgetkonto. Claude kan då söka, summera och lägga in,
// ändra eller ta bort transaktioner i DIN budget. Inloggningen sköts av Supabase
// (OAuth 2.1) och databasens regler gör att varje konto bara kommer åt sin egen rad.
// Inget kostar extra: frågorna ingår i ditt Claude-abonnemang.
//
// Räkningarna nedan (budgetperioder, saldon, sparmål, skulder) är samma logik som i
// js/core.js, så att svaren stämmer med det appen visar.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createMcpHandler, McpServer } from "npm:@modelcontextprotocol/server@2.4.0";
import { pipeline } from "npm:@supabase/middleware@1.0.0";
import { withOAuthProtectedResource, withSupabase } from "npm:@supabase/server@1.9.2";
import { z } from "npm:zod@4.6.7";

const TABLE = "budget_state";
const OTHER_PARENT = "Övrigt";
const MAX_ROWS = 100;

// ---------- Datatyper (samma form som appen sparar) ----------
type Tx = {
  id: string; date: string; type: "income" | "expense" | "transfer"; category: string; title?: string;
  accountId?: string; toAccountId?: string; goalId?: string | null; debtId?: string | null;
  billId?: string; billMonth?: string; amount: number; recurring?: boolean; total?: number;
};

type Valuation = { date: string; value: number };
type Account = { id: string; name: string; type: string; startBalance?: number; categories?: string[]; archived?: boolean; valuations?: Valuation[] };
type Category = { name: string; parent?: string; group?: string; debt?: boolean; color?: string };
type Goal = { id: string; name: string; target: number; startAmount?: number; categories?: string[]; date?: string };
type Debt = { id: string; name: string; original?: number; adjust?: number; categories?: string[] };
type Bill = { id: string; name: string; amount: number; dueDate: string; recurrence: string; category?: string };
type State = {
  transactions: Tx[]; accounts: Account[]; categories: Category[]; incomeCategories: Category[];
  parents?: string[]; goals: Goal[]; debts: Debt[]; bills: Bill[];
  budgets: Record<string, Record<string, number>>;
  settings: { defaultAccountId?: string; period?: { mode?: string; payday?: number }; sharing?: { partner?: string; categories?: string[] } };
  sharedTotals?: Record<string, Record<string, number>>;
  incomeLabel?: string;
};

// ---------- Datum (svensk tid) ----------
const pad2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseISO = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const todayISO = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
const ym = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const addMonths = (key: string, n: number) => { const [y, m] = key.split("-").map(Number); return ym(new Date(y, m - 1 + n, 1)); };
const daysInMonth = (key: string) => { const [y, m] = key.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const sum = (list: number[]) => list.reduce((a, b) => a + (Number(b) || 0), 0);
const round = (v: number) => Math.round(v * 100) / 100;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(parseISO(v).getTime());
const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);

function easter(y: number) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
function bankHolidays(y: number) {
  const e = easter(y);
  const rel = (n: number) => iso(new Date(y, e.getMonth(), e.getDate() + n));
  const mid = new Date(y, 5, 19);
  while (mid.getDay() !== 5) mid.setDate(mid.getDate() + 1);
  return new Set([`${y}-01-01`, `${y}-01-06`, rel(-2), rel(1), rel(39), `${y}-05-01`, `${y}-06-06`, iso(mid),
    `${y}-12-24`, `${y}-12-25`, `${y}-12-26`, `${y}-12-31`]);
}
const isBankDay = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6 && !bankHolidays(d.getFullYear()).has(iso(d));

// ---------- Beräkningar (samma som js/core.js) ----------
function makeCalc(state: State) {
  const today = parseISO(todayISO());
  const isPayday = () => state.settings.period?.mode === "payday";
  const payDate = (year: number, monthIndex: number) => {
    const day = Math.min(Number(state.settings.period?.payday) || 25, new Date(year, monthIndex + 1, 0).getDate());
    const d = new Date(year, monthIndex, day);
    while (!isBankDay(d)) d.setDate(d.getDate() - 1);
    return d;
  };
  const period = {
    startOf(key: string) { const [y, m] = key.split("-").map(Number); return isPayday() ? payDate(y, m - 2) : new Date(y, m - 1, 1); },
    range(key: string) {
      const start = period.startOf(key);
      const end = period.startOf(addMonths(key, 1));
      end.setDate(end.getDate() - 1);
      return { start: iso(start), end: iso(end) };
    },
    keyOf(date: string) { const d = parseISO(date); const key = ym(d); return d >= period.startOf(addMonths(key, 1)) ? addMonths(key, 1) : key; },
    current: () => period.keyOf(iso(today)),
    daysLeft(key: string) { return Math.max(1, Math.round((parseISO(period.range(key).end).getTime() - today.getTime()) / 864e5) + 1); },
  };

  const accName = (id?: string) => state.accounts.find((a) => a.id === id)?.name || "";
  const defaultAccount = () => {
    const active = state.accounts.filter((a) => !a.archived);
    return active.find((a) => a.id === state.settings.defaultAccountId) || active.find((a) => a.type === "checking") || active[0] || null;
  };
  const accountForCategory = (name: string) => state.accounts.find((a) => (a.categories || []).includes(name)) || null;
  function txMoves(t: Tx) {
    const def = defaultAccount();
    const from = t.accountId && state.accounts.some((a) => a.id === t.accountId) ? t.accountId : def ? def.id : "";
    if (t.type === "income") return from ? [{ accountId: from, amount: t.amount }] : [];
    if (t.type === "transfer") {
      const to = state.accounts.some((a) => a.id === t.toAccountId) ? t.toAccountId! : "";
      return [from && { accountId: from, amount: -t.amount }, to && to !== from && { accountId: to, amount: t.amount }]
        .filter(Boolean) as { accountId: string; amount: number }[];
    }
    const target = accountForCategory(t.category);
    if (target) {
      const source = from === target.id ? (def && def.id !== target.id ? def.id : "") : from;
      return [source && { accountId: source, amount: -t.amount }, { accountId: target.id, amount: t.amount }]
        .filter(Boolean) as { accountId: string; amount: number }[];
    }
    return from ? [{ accountId: from, amount: -t.amount }] : [];
  }
  // Senaste marknadsvärdet för ett investeringskonto, eller null
  const valuationAt = (a: Account) => a.type !== "investment" ? null
    : (a.valuations || []).reduce<Valuation | null>((best, v) => (!best || v.date >= best.date ? v : best), null);
  // Saldo: startsaldo + rörelser. Investeringskonto med värde: värdet + rörelser efter den dagen.
  function balances(deposited: boolean) {
    const out: Record<string, number> = {};
    const since: Record<string, string> = {};
    state.accounts.forEach((a) => {
      const v = deposited ? null : valuationAt(a);
      out[a.id] = v ? Number(v.value) || 0 : Number(a.startBalance) || 0;
      since[a.id] = v ? v.date : "";
    });
    for (const t of state.transactions) {
      for (const m of txMoves(t)) {
        if (!(m.accountId in out) || (since[m.accountId] && t.date <= since[m.accountId])) continue;
        out[m.accountId] += m.amount;
      }
    }
    return out;
  }
  function accounts() {
    const b = balances(false), dep = balances(true);
    return state.accounts.filter((a) => !a.archived).map((a) => {
      const valuation = valuationAt(a);
      const balance = round(b[a.id] || 0);
      return { ...a, balance, valuation, deposited: round(dep[a.id] || 0), gain: valuation ? round(balance - (dep[a.id] || 0)) : null };
    });
  }
  const goalOf = (t: Tx) => {
    if (t.goalId) return state.goals.find((g) => g.id === t.goalId) || null;
    if (t.type === "transfer" || t.goalId === null) return null;
    return state.goals.find((g) => (g.categories || []).includes(t.category)) || null;
  };
  const debtOf = (t: Tx) => {
    if (t.debtId) return state.debts.find((d) => d.id === t.debtId) || null;
    if (t.type !== "expense" || t.debtId === null) return null;
    return state.debts.find((d) => (d.categories || []).includes(t.category)) || null;
  };
  function goals() {
    const add: Record<string, number> = {};
    for (const t of state.transactions) { const g = goalOf(t); if (g) add[g.id] = (add[g.id] || 0) + t.amount; }
    return state.goals.map((g) => ({ ...g, current: round((Number(g.startAmount) || 0) + (add[g.id] || 0)) }));
  }
  function debts() {
    const paid: Record<string, number> = {};
    for (const t of state.transactions) { const d = debtOf(t); if (d) paid[d.id] = (paid[d.id] || 0) + t.amount; }
    return state.debts.map((d) => {
      const p = round(paid[d.id] || 0);
      return { ...d, paid: p, balance: Math.max(0, round((Number(d.original) || 0) + (Number(d.adjust) || 0) - p)) };
    });
  }
  const txBetween = (from: string, to: string) => state.transactions.filter((t) => t.date >= from && t.date <= to);
  const txInPeriod = (key: string) => { const r = period.range(key); return txBetween(r.start, r.end); };
  const byCat = (list: Tx[], type: "expense" | "income") => {
    const out: Record<string, number> = {};
    for (const t of list) if (t.type === type) out[t.category] = (out[t.category] || 0) + t.amount;
    return out;
  };
  // Periodens egen plan, annars den senaste perioden innan som har en plan, annars 0
  const plannedFrom = (key: string) => {
    const budgets = state.budgets || {};
    if (budgets[key]) return key;
    return Object.keys(budgets).filter((k) => k < key).sort().pop() || null;
  };
  const planned = (key: string) => { const src = plannedFrom(key); return src ? state.budgets[src] : {}; };
  const sharedTotal = (key: string, category: string) => {
    const src = plannedFrom(key);
    const v = src ? state.sharedTotals?.[src]?.[category] : undefined;
    return v == null ? null : Number(v);
  };
  // Din andel enligt budgetens fördelning för kategorin, annars hälften
  const shareRatio = (key: string, category: string) => {
    const total = sharedTotal(key, category);
    const mine = Number(planned(key)[category]);
    return total != null && total > 0 && Number.isFinite(mine) ? Math.min(1, Math.max(0, mine / total)) : 0.5;
  };
  // Betald: kopplad transaktion, eller en utgift i samma kategori, samma budgetperiod som förfallodagen och samma belopp
  function billTx(b: Bill, key: string, date: string) {
    const linked = state.transactions.find((t) => t.billId === b.id && t.billMonth === key);
    if (linked) return linked;
    if (!b.category) return null;
    const r = period.range(period.keyOf(date));
    return state.transactions.find((t) => !t.billId && t.type === "expense" && t.category === b.category &&
      t.date >= r.start && t.date <= r.end && Math.abs((t.total ?? t.amount) - b.amount) < 0.5) || null;
  }
  function billsForMonth(key: string) {
    return (state.bills || []).flatMap((b) => {
      const due = parseISO(b.dueDate);
      const dueKey = ym(due);
      if (b.recurrence === "once" && dueKey !== key) return [];
      if (b.recurrence === "yearly" && Number(key.slice(5)) !== due.getMonth() + 1) return [];
      if (dueKey > key && b.recurrence !== "once") return [];
      const day = Math.min(due.getDate(), daysInMonth(key));
      const date = `${key}-${pad2(day)}`;
      return [{ name: b.name, amount: b.amount, date, paid: !!billTx(b, key, date) }];
    });
  }
  return { today, period, accName, defaultAccount, accounts, goals, debts, txBetween, txInPeriod, byCat, planned, plannedFrom, sharedTotal, shareRatio, billsForMonth };
}

// ---------- Delade kostnader (samma som i js/core.js) ----------
// Ni betalar var och en er egen del: total = hela beloppet, amount = din del.
// Hur en delad kategori fördelas styrs av budgeten (hela beloppet och din del), annars 50/50.
const partnerName = (s: State) => (s.settings.sharing?.partner || "").trim() || "Sambo";
const isShared = (s: State, category: string) => (s.settings.sharing?.categories || []).includes(category);
function splitShare(total: number, ratio = 0.5) {
  const t = round(total);
  const mine = ratio === 0.5 ? Math.ceil(t * 50 - 1e-9) / 100 : round(t * ratio);
  return { mine, partner: round(t - mine) };
}

// ---------- Läsa och skriva budgeten ----------
type Db = { from: (t: string) => any };

async function load(supabase: Db) {
  const { data, error } = await supabase.from(TABLE).select("data, updated_at").maybeSingle();
  if (error) throw new Error(`Kunde inte läsa budgeten: ${error.message}`);
  if (!data) throw new Error("Det finns ingen budget i molnet för det här kontot än. Öppna budgetappen, logga in och vänta tills det står Synkat.");
  return { state: data.data as State, updatedAt: data.updated_at as string };
}

// Ändrar budgeten säkert: skrivs bara om ingen annan (t.ex. appen) hann ändra under tiden, annars görs ett nytt försök
async function modify<T>(supabase: Db, userId: string, fn: (s: State) => T): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { state, updatedAt } = await load(supabase);
    const result = fn(state);
    const { data, error } = await supabase.from(TABLE)
      .update({ data: state, updated_at: new Date().toISOString() })
      .eq("user_id", userId).eq("updated_at", updatedAt).select("user_id");
    if (error) throw new Error(`Kunde inte spara: ${error.message}`);
    if (data && data.length) return result;
  }
  throw new Error("Budgeten ändrades samtidigt från appen. Försök igen.");
}

// ---------- Hjälp för verktygen ----------
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

function accountByName(state: State, name?: string) {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  return state.accounts.find((a) => !a.archived && a.name.toLowerCase() === n) || null;
}
function findCategory(state: State, type: string, name?: string) {
  const pool = type === "income" ? state.incomeCategories : state.categories;
  return pool.find((c) => c.name.toLowerCase() === String(name || "").trim().toLowerCase()) || null;
}
function txOut(state: State, c: ReturnType<typeof makeCalc>, t: Tx) {
  return {
    id: t.id, date: t.date, type: t.type, title: t.title || "", category: t.category, amount: t.amount,
    ...(t.total != null ? { shared: true, total_amount: t.total, partner_share: round(t.total - t.amount) } : {}),
    account: c.accName(t.accountId) || c.defaultAccount()?.name || "",
    ...(t.type === "transfer" ? { to_account: c.accName(t.toAccountId) } : {}),
  };
}
function describe(state: State) {
  const parents = [...(state.parents || []), OTHER_PARENT];
  const cats = parents.map((p) => {
    const list = state.categories.filter((c) => (c.parent && parents.includes(c.parent) ? c.parent : OTHER_PARENT) === p).map((c) => c.name);
    return list.length ? { parent: p, categories: list } : null;
  }).filter(Boolean);
  const def = makeCalc(state).defaultAccount();
  return {
    expense_categories: cats,
    income_categories: state.incomeCategories.map((c) => c.name),
    accounts: state.accounts.filter((a) => !a.archived).map((a) => a.name),
    default_account: def?.name || null,
    shared_with: partnerName(state),
    shared_categories: state.settings.sharing?.categories || [],
    budget_periods: state.settings.period?.mode === "payday"
      ? `Lönemånader från lönedag ${state.settings.period?.payday || 25}. Perioden "2026-11" är den som slutar i november.`
      : "Kalendermånader.",
  };
}

const DATE = z.string().describe("Datum som YYYY-MM-DD");
const INSTRUCTIONS = `Den här kopplingen ger åtkomst till användarens privata budgetapp. Alla belopp är i svenska kronor.
Börja med budget_info om du inte redan vet vilka kategorier och konton som finns. Hämta alltid siffror med verktygen i stället för att gissa.
Datum räknas i svensk tid; budget_info visar dagens datum. Använd bara befintliga kategorier och konton när du lägger in eller ändrar något.
Delade kostnader: användaren delar vissa kostnader med sin sambo och var och en betalar sin egen del. Vanliga transaktioner delas inte. Bara när användaren ber om det, eller det gäller en delad räkning (t.ex. hyra eller el i en delad kategori, se budget_info), sätter du shared: true och anger HELA beloppet; användarens del räknas ut enligt budgetens fördelning för kategorin (annars 50/50) och kan anges med my_share. Det är användarens del som räknas i budgeten. Transaktionens amount är användarens del, total_amount hela beloppet.`;

function buildServer(supabase: Db, userId: string) {
  const server = new McpServer({ name: "budget", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const read = { readOnlyHint: true, openWorldHint: false };

  server.registerTool("budget_info", {
    title: "Budgetens kategorier och konton",
    description: "Dagens datum, kategorier (per huvudkategori), inkomstkategorier, konton och hur budgetperioderna fungerar. Använd först, innan du söker eller lägger in något.",
    inputSchema: z.object({}),
    annotations: read,
  }, async () => {
    const { state } = await load(supabase);
    const c = makeCalc(state);
    return text({ today: todayISO(), current_period: c.period.current(), ...describe(state) });
  });

  server.registerTool("search_transactions", {
    title: "Sök transaktioner",
    description: "Sök bland transaktionerna. Använd för frågor om enskilda köp, vad något kostade, när något betalades, eller för att hitta id:n innan du ändrar eller tar bort. Alla filter är valfria.",
    inputSchema: z.object({
      text: z.string().optional().describe("Fritext i beskrivning, kategori eller konto"),
      category: z.string().optional(),
      type: z.enum(["expense", "income", "transfer"]).optional(),
      date_from: DATE.optional(),
      date_to: DATE.optional(),
      min_amount: z.number().optional(),
      max_amount: z.number().optional(),
      account: z.string().optional().describe("Kontonamn"),
      limit: z.number().int().optional().describe(`Max antal rader, standard 25, högst ${MAX_ROWS}`),
    }),
    annotations: read,
  }, async (i) => {
    const { state } = await load(supabase);
    const c = makeCalc(state);
    let list = state.transactions;
    if (i.text) { const q = i.text.toLowerCase(); list = list.filter((t) => [t.title, t.category, c.accName(t.accountId)].some((v) => (v || "").toLowerCase().includes(q))); }
    if (i.category) list = list.filter((t) => t.category.toLowerCase() === i.category!.toLowerCase());
    if (i.type) list = list.filter((t) => t.type === i.type);
    if (i.date_from) list = list.filter((t) => t.date >= i.date_from!);
    if (i.date_to) list = list.filter((t) => t.date <= i.date_to!);
    if (i.min_amount != null) list = list.filter((t) => t.amount >= i.min_amount!);
    if (i.max_amount != null) list = list.filter((t) => t.amount <= i.max_amount!);
    if (i.account) {
      const a = accountByName(state, i.account);
      if (!a) return fail(`Inget konto heter "${i.account}".`);
      const def = c.defaultAccount();
      list = list.filter((t) => t.accountId === a.id || t.toAccountId === a.id || (!t.accountId && def?.id === a.id));
    }
    list = [...list].sort((a, b) => b.date.localeCompare(a.date));
    const limit = Math.min(MAX_ROWS, Math.max(1, i.limit || 25));
    return text({ count: list.length, total_amount: round(sum(list.map((t) => t.amount))), shown: Math.min(limit, list.length), transactions: list.slice(0, limit).map((t) => txOut(state, c, t)) });
  });

  server.registerTool("spending_summary", {
    title: "Summera utgifter eller inkomster",
    description: "Summera mellan två datum, grupperat per kategori, huvudkategori, månad eller beskrivning (t.ex. butik). För frågor som \"hur mycket har jag lagt på mat i år\".",
    inputSchema: z.object({
      date_from: DATE, date_to: DATE,
      group_by: z.enum(["category", "parent", "month", "title"]),
      type: z.enum(["expense", "income"]).optional().describe("Standard: expense"),
    }),
    annotations: read,
  }, async (i) => {
    const { state } = await load(supabase);
    const c = makeCalc(state);
    const type = i.type || "expense";
    const list = c.txBetween(i.date_from, i.date_to).filter((t) => t.type === type);
    const keyOf: Record<string, (t: Tx) => string> = {
      category: (t) => t.category,
      parent: (t) => state.categories.find((x) => x.name === t.category)?.parent || OTHER_PARENT,
      month: (t) => t.date.slice(0, 7),
      title: (t) => (t.title || "(utan beskrivning)").trim(),
    };
    const groups: Record<string, { amount: number; count: number }> = {};
    for (const t of list) { const k = keyOf[i.group_by](t); groups[k] ??= { amount: 0, count: 0 }; groups[k].amount += t.amount; groups[k].count++; }
    const rows = Object.entries(groups).map(([name, g]) => ({ name, amount: round(g.amount), count: g.count }));
    rows.sort((a, b) => (i.group_by === "month" ? a.name.localeCompare(b.name) : b.amount - a.amount));
    return text({ type, total: round(sum(list.map((t) => t.amount))), transactions: list.length, groups: rows.slice(0, 60) });
  });

  server.registerTool("budget_status", {
    title: "Budget mot utfall",
    description: "Planerat, faktiskt och kvar per kategori för en budgetperiod, plus inkomster och dagar kvar. För frågor om budgeten och hur mycket som finns kvar att spendera.",
    inputSchema: z.object({ period: z.string().optional().describe("Budgetperiod som YYYY-MM. Utelämna för innevarande.") }),
    annotations: read,
  }, async (i) => {
    const { state } = await load(supabase);
    const c = makeCalc(state);
    const key = /^\d{4}-\d{2}$/.test(i.period || "") ? i.period! : c.period.current();
    const r = c.period.range(key);
    const list = c.txInPeriod(key);
    const plan = c.planned(key);
    const spent = c.byCat(list, "expense"), earned = c.byCat(list, "income");
    const parents = state.parents || [];
    const row = (x: Category, actual: Record<string, number>) => {
      const total = isShared(state, x.name) ? c.sharedTotal(key, x.name) : null;
      return {
        name: x.name, planned: Number(plan[x.name]) || 0, actual: round(actual[x.name] || 0), left: round((Number(plan[x.name]) || 0) - (actual[x.name] || 0)),
        ...(total != null ? { shared: true, planned_total: total, planned_partner_share: round(total - (Number(plan[x.name]) || 0)) } : {}),
      };
    };
    const groups = [
      { group: state.incomeLabel || "Inkomster", kind: "income", categories: state.incomeCategories.map((x) => row(x, earned)) },
      ...[...parents, OTHER_PARENT].map((p) => ({
        group: p, kind: "expense",
        categories: state.categories.filter((x) => (x.parent && parents.includes(x.parent) ? x.parent : OTHER_PARENT) === p).map((x) => row(x, spent)),
      })),
    ].map((g) => ({ ...g, categories: g.categories.filter((x) => x.planned || x.actual) })).filter((g) => g.categories.length);
    const income = sum(list.filter((t) => t.type === "income").map((t) => t.amount));
    const expense = sum(list.filter((t) => t.type === "expense").map((t) => t.amount));
    const isCurrent = key === c.period.current();
    return text({
      period: key, from: r.start, to: r.end, is_current: isCurrent, days_left: isCurrent ? c.period.daysLeft(key) : null,
      budget_taken_from: c.plannedFrom(key), // samma period = egen plan, annan = kopierad från den, null = ingen budget

      planned_income: sum(state.incomeCategories.map((x) => Number(plan[x.name]) || 0)),
      planned_expenses: sum(state.categories.map((x) => Number(plan[x.name]) || 0)),
      actual_income: round(income), actual_expenses: round(expense), left_after_expenses: round(income - expense), groups,
    });
  });

  server.registerTool("financial_overview", {
    title: "Konton, mål och skulder",
    description: "Kontosaldon, sparmål, skulder, nettoförmögenhet och räkningar de närmaste 30 dagarna.",
    inputSchema: z.object({}),
    annotations: read,
  }, async () => {
    const { state } = await load(supabase);
    const c = makeCalc(state);
    const accs = c.accounts();
    const debts = c.debts();
    const assets = sum(accs.filter((a) => a.balance > 0).map((a) => a.balance));
    const totalDebt = sum(debts.map((d) => d.balance)) - sum(accs.filter((a) => a.balance < 0).map((a) => a.balance));
    const from = todayISO();
    const to = iso(new Date(c.today.getFullYear(), c.today.getMonth(), c.today.getDate() + 30));
    const bills = [];
    for (let k = from.slice(0, 7); k <= to.slice(0, 7); k = addMonths(k, 1)) bills.push(...c.billsForMonth(k).filter((b) => b.date >= from && b.date <= to));
    return text({
      accounts: accs.map((a) => ({
        name: a.name, type: a.type, balance: a.balance,
        ...(a.valuation ? { deposited: a.deposited, gain: a.gain, value_last_updated: a.valuation.date } : {}),
      })),
      goals: c.goals().map((g) => ({ name: g.name, saved: g.current, target: g.target, deadline: g.date || null })),
      debts: debts.map((d) => ({ name: d.name, left: d.balance, paid: d.paid })),
      assets: round(assets), total_debt: round(totalDebt), net_worth: round(assets - totalDebt),
      upcoming_bills: bills.sort((a, b) => a.date.localeCompare(b.date)),
    });
  });

  server.registerTool("update_account_value", {
    title: "Uppdatera ett investeringskontos värde",
    description: "Spara vad ett investeringskonto (t.ex. ISK eller fond) är värt enligt banken ett visst datum. Använd när användaren säger vad kontot är värt. Insättningar efter datumet läggs till automatiskt tills nästa uppdatering.",
    inputSchema: z.object({
      account: z.string().describe("Kontonamn (måste vara av typen investering)"),
      value: z.number().describe("Värdet i kronor enligt banken"),
      date: DATE.optional().describe("Utelämna för idag"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (i) => {
    try {
      const out = await modify(supabase, userId, (state) => {
        const a = accountByName(state, i.account);
        if (!a) throw new Error(`Inget konto heter "${i.account}".`);
        if (a.type !== "investment") throw new Error(`"${a.name}" är inte ett investeringskonto. Ändra kontotypen i appen först.`);
        const date = i.date || todayISO();
        if (!isDate(date)) throw new Error("Ogiltigt datum.");
        const value = round(i.value);
        a.valuations = [...(a.valuations || []).filter((v) => v.date !== date), { date, value }];
        const acc = makeCalc(state).accounts().find((x) => x.id === a.id)!;
        return { account: a.name, date, value, deposited: acc.deposited, gain: acc.gain };
      });
      return text({ result: "Värdet är sparat.", ...out });
    } catch (e) { return fail((e as Error).message); }
  });

  server.registerTool("create_transactions", {
    title: "Lägg till transaktioner",
    description: "Lägg till en eller flera transaktioner i budgeten. Kategorin måste vara en befintlig (se budget_info). Utelämna account för standardkontot.",
    inputSchema: z.object({
      transactions: z.array(z.object({
        date: DATE,
        type: z.enum(["expense", "income", "transfer"]),
        amount: z.number().describe("Positivt belopp i kronor. För delade utgifter: HELA beloppet (användarens del räknas ut)."),
        shared: z.boolean().optional().describe("Dela med sambon (bara när användaren ber om det eller det är en delad räkning, t.ex. hyra eller el). Standard: nej."),
        my_share: z.number().optional().describe("Användarens del om den ska avvika från budgetens fördelning/50-50 (bara för delade)."),
        title: z.string().describe("Kort beskrivning, t.ex. butikens namn"),
        category: z.string().optional().describe("Befintlig kategori (behövs inte för överföringar)"),
        account: z.string().optional(),
        to_account: z.string().optional().describe("Mottagande konto, bara för överföringar"),
      })).min(1).max(50),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (i) => {
    try {
      const created = await modify(supabase, userId, (state) => {
        // (amount = hela beloppet för delade utgifter)
        const c = makeCalc(state);
        const txs: Tx[] = i.transactions.map((p, n) => {
          const where = `Rad ${n + 1}: `;
          if (!isDate(p.date)) throw new Error(`${where}ogiltigt datum ${p.date}.`);
          const amount = round(Math.abs(p.amount));
          if (!amount) throw new Error(`${where}beloppet måste vara större än 0.`);
          const acc = p.account ? accountByName(state, p.account) : c.defaultAccount();
          if (p.account && !acc) throw new Error(`${where}inget konto heter "${p.account}".`);
          const tx: Tx = { id: uid(), date: p.date, type: p.type, title: p.title.trim(), accountId: acc?.id || "", amount, recurring: false, category: "" };
          if (p.type === "transfer") {
            const to = accountByName(state, p.to_account);
            if (!to) throw new Error(`${where}överföringar behöver ett mottagande konto som finns.`);
            if (acc && to.id === acc.id) throw new Error(`${where}från- och till-konto kan inte vara samma.`);
            tx.category = "Överföring";
            tx.toAccountId = to.id;
          } else {
            const cat = findCategory(state, p.type, p.category);
            if (!cat) throw new Error(`${where}kategorin "${p.category || ""}" finns inte.`);
            tx.category = cat.name;
            if (p.type === "expense" && p.shared) {
              tx.total = amount;
              tx.amount = p.my_share != null
                ? Math.min(amount, Math.max(0, round(p.my_share)))
                : splitShare(amount, c.shareRatio(c.period.keyOf(p.date), cat.name)).mine;
            }
          }
          return tx;
        });
        state.transactions.push(...txs);
        state.transactions.sort((a, b) => b.date.localeCompare(a.date));
        return txs.map((t) => txOut(state, c, t));
      });
      return text({ result: `${created.length} transaktion(er) tillagda. De syns i appen nästa gång den synkar.`, transactions: created });
    } catch (e) { return fail((e as Error).message); }
  });

  server.registerTool("update_transaction", {
    title: "Ändra en transaktion",
    description: "Ändra datum, belopp, beskrivning, kategori eller konto på en transaktion. Hitta id:t med search_transactions först.",
    inputSchema: z.object({
      id: z.string(),
      date: DATE.optional(),
      amount: z.number().optional().describe("Nytt belopp. För delade transaktioner: hela beloppet."),
      my_share: z.number().optional().describe("Ny del för användaren i en delad transaktion (resten blir sambons)."),
      title: z.string().optional(),
      category: z.string().optional(),
      account: z.string().optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async (i) => {
    try {
      const out = await modify(supabase, userId, (state) => {
        const t = state.transactions.find((x) => x.id === i.id);
        if (!t) throw new Error(`Ingen transaktion med id ${i.id}.`);
        const before = { ...t };
        if (i.date != null) { if (!isDate(i.date)) throw new Error("Ogiltigt datum."); t.date = i.date; }
        if (i.amount != null) {
          const a = round(Math.abs(i.amount));
          if (!a) throw new Error("Ogiltigt belopp.");
          if (t.total != null) { t.total = a; t.amount = splitShare(a, makeCalc(state).shareRatio(makeCalc(state).period.keyOf(t.date), t.category)).mine; } // delad: budgetens fördelning
          else t.amount = a;
        }
        if (i.my_share != null) {
          if (t.total == null) throw new Error("Transaktionen är inte delad.");
          t.amount = Math.min(t.total, Math.max(0, round(i.my_share)));
        }
        if (i.title != null) t.title = i.title.trim();
        if (i.category != null) {
          if (t.type === "transfer") throw new Error("Överföringar har ingen kategori.");
          const cat = findCategory(state, t.type, i.category);
          if (!cat) throw new Error(`Kategorin "${i.category}" finns inte.`);
          t.category = cat.name;
        }
        if (i.account != null) { const a = accountByName(state, i.account); if (!a) throw new Error(`Inget konto heter "${i.account}".`); t.accountId = a.id; }
        state.transactions.sort((a, b) => b.date.localeCompare(a.date));
        const c = makeCalc(state);
        return { before: txOut(state, c, before), after: txOut(state, c, t) };
      });
      return text({ result: "Transaktionen är ändrad.", ...out });
    } catch (e) { return fail((e as Error).message); }
  });

  server.registerTool("delete_transactions", {
    title: "Ta bort transaktioner",
    description: "Ta bort transaktioner med angivna id:n. Hitta id:n med search_transactions först och bekräfta med användaren vad som tas bort.",
    inputSchema: z.object({ ids: z.array(z.string()).min(1).max(50) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async (i) => {
    try {
      const removed = await modify(supabase, userId, (state) => {
        const ids = new Set(i.ids);
        const c = makeCalc(state);
        const list = state.transactions.filter((t) => ids.has(t.id)).map((t) => txOut(state, c, t));
        if (!list.length) throw new Error("Hittade inga transaktioner med de id:na.");
        state.transactions = state.transactions.filter((t) => !ids.has(t.id));
        return list;
      });
      return text({ result: `${removed.length} transaktion(er) borttagna.`, removed });
    } catch (e) { return fail((e as Error).message); }
  });

  return server;
}

// ---------- Ingången ----------
// withOAuthProtectedResource berättar för Claude var man loggar in (Supabase Auth).
// withSupabase släpper bara igenom inloggade och ger en databaskoppling som bara ser
// den inloggades egen rad.
Deno.serve(
  pipeline(
    [withOAuthProtectedResource(), withSupabase({ auth: "user" })],
    async (req, { supabase, userClaims }) => {
      const userId = String(userClaims?.id || "");
      const handler = createMcpHandler(
        () => buildServer(supabase as unknown as Db, userId),
        { onerror: (error) => console.error("MCP-anrop misslyckades", error) },
      );
      return handler.fetch(req);
    },
  ),
);
