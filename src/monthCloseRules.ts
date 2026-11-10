// NOTIF-02: resumen de fin de mes en la PWA.
// Lógica pura + lectura acotada. Las monedas nunca se suman entre sí; el presupuesto es solo en pesos.
import { computeTotalsByCurrency } from './dashboardData';

const TIME_ZONE = 'America/Argentina/Buenos_Aires';
const CURRENCIES = ['ARS', 'USD'] as const;
const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const SHORT_MONTH_NAMES = [
  'ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.',
  'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.',
];

export type CurrencyClose = {
  currency: 'ARS' | 'USD';
  expenses: number;
  income: number;
  balance: number;
  /** Variación de gastos en % entero con signo; null si el mes anterior no tuvo gastos en esa moneda. */
  expenseChange: number | null;
};

export type MonthClose = {
  month: string;
  previousMonth: string;
  currencies: CurrencyClose[];
  /** `left` = presupuesto menos gastos en pesos; negativo si se pasó. */
  budget: { amount: number; left: number } | null;
};

type CloseRow = { amount: number; currency: 'ARS' | 'USD'; kind: 'expense' | 'income'; occurred_on: string };

const pad = (n: number) => String(n).padStart(2, '0');

/** Mes anterior de 'YYYY-MM' (diciembre cuando el mes es enero). */
function previousOf(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return mon === 1 ? `${year - 1}-12` : `${year}-${pad(mon - 1)}`;
}

/** Último día ('YYYY-MM-DD') de 'YYYY-MM'. */
function lastDayOf(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return `${month}-${pad(new Date(Date.UTC(year, mon, 0)).getUTCDate())}`;
}

/** 'YYYY-MM' del mes anterior si hoy (hora argentina) es del 1 al 7; si no, null. */
export function closedMonth(now = Date.now()): string | null {
  const day = new Date(now).toLocaleDateString('en-CA', { timeZone: TIME_ZONE }); // YYYY-MM-DD
  const dayOfMonth = Number(day.slice(8, 10));
  if (!(dayOfMonth >= 1 && dayOfMonth <= 7)) return null;
  return previousOf(day.slice(0, 7));
}

export function buildMonthClose(month: string, rows: CloseRow[], budgetArs: number | null): MonthClose | null {
  const previousMonth = previousOf(month);
  const current = rows.filter((row) => row.occurred_on.slice(0, 7) === month);
  if (current.length === 0) return null;
  const previous = rows.filter((row) => row.occurred_on.slice(0, 7) === previousMonth);

  const currencies: CurrencyClose[] = [];
  for (const currency of CURRENCIES) {
    if (!current.some((row) => row.currency === currency)) continue;
    const totals = computeTotalsByCurrency(current, currency);
    const before = computeTotalsByCurrency(previous, currency);
    currencies.push({
      currency,
      expenses: totals.expenses,
      income: totals.income,
      balance: totals.balance,
      expenseChange: before.expenses > 0 ? Math.round(((totals.expenses - before.expenses) / before.expenses) * 100) : null,
    });
  }

  const arsExpenses = currencies.find((c) => c.currency === 'ARS')?.expenses ?? 0;
  const hasBudget = typeof budgetArs === 'number' && Number.isFinite(budgetArs) && budgetArs > 0;
  const budget = hasBudget ? { amount: budgetArs, left: Math.round((budgetArs - arsExpenses) * 100) / 100 } : null;
  return { month, previousMonth, currencies, budget };
}

type QueryResult = { data: unknown; error: unknown };
type Query = PromiseLike<QueryResult> & {
  eq(column: string, value: string): Query;
  gt(column: string, value: string): Query;
  gte(column: string, value: string): Query;
  lte(column: string, value: string): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
  maybeSingle(): PromiseLike<QueryResult>;
};
type MonthCloseClient = { from(table: string): { select(columns: string): Query } };

const PAGE_SIZE = 250;
const MAX_PAGES = 80;

/**
 * Movimientos confirmados del mes anterior al cerrado y del cerrado, paginados por id como
 * `readMonthlyTransactions` del Resumen: PostgREST corta las respuestas largas y un total
 * truncado no coincidiría con el Resumen. Cualquier error, forma inesperada o cursor inválido devuelve null.
 */
async function readCloseRows(client: MonthCloseClient, userId: string, from: string, to: string): Promise<CloseRow[] | null> {
  const rows: CloseRow[] = [];
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    let query = client
      .from('transactions')
      .select('id,amount_ars,currency,kind,occurred_on')
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .gte('occurred_on', from)
      .lte('occurred_on', to)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (cursor) query = query.gt('id', cursor);
    const result = await query;
    if (result.error || !Array.isArray(result.data)) return null;
    const batch = result.data as Array<Record<string, unknown>>;
    if (batch.length > PAGE_SIZE) return null;
    for (const item of batch) {
      const { id, currency, kind, occurred_on } = item;
      const amount = Number(item.amount_ars);
      if (typeof id !== 'string' || (cursor && id <= cursor)) return null;
      if (!Number.isFinite(amount)) return null;
      if (currency !== 'ARS' && currency !== 'USD') return null;
      if (kind !== 'expense' && kind !== 'income') return null;
      if (typeof occurred_on !== 'string') return null;
      cursor = id;
      rows.push({ amount, currency, kind, occurred_on });
    }
    if (batch.length < PAGE_SIZE) return rows;
  }
  // Más de MAX_PAGES páginas: no mostrar un cierre parcial.
  return null;
}

/**
 * Lee la preferencia y, solo si está activa y estamos del 1 al 7, los movimientos del mes
 * cerrado y del anterior más el presupuesto. Cualquier error o forma inesperada devuelve null
 * (sin tarjeta, nunca un error visible).
 */
export async function loadMonthClose(client: MonthCloseClient, userId: string, now = Date.now()): Promise<MonthClose | null> {
  const month = closedMonth(now);
  if (!month) return null;
  try {
    const settings = await client.from('app_settings').select('monthly_summary_enabled').eq('user_id', userId).maybeSingle();
    const enabled = (settings.data as { monthly_summary_enabled?: unknown } | null)?.monthly_summary_enabled;
    if (settings.error || enabled !== true) return null;

    const rows = await readCloseRows(client, userId, `${previousOf(month)}-01`, lastDayOf(month));
    if (!rows) return null;

    const budgets = await client.from('budgets').select('amount_ars').eq('user_id', userId).eq('month', `${month}-01`).maybeSingle();
    if (budgets.error) return null;
    const rawBudget = (budgets.data as { amount_ars?: unknown } | null)?.amount_ars;
    const budgetArs = rawBudget === null || rawBudget === undefined ? null : Number(rawBudget);

    return buildMonthClose(month, rows, budgetArs !== null && Number.isFinite(budgetArs) ? budgetArs : null);
  } catch {
    return null;
  }
}

const dismissKey = (userId: string, month: string) => `pesito:cierre-mes-oculto:${userId}:${month}`;

export function isMonthCloseDismissed(userId: string, month: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(userId, month)) === '1';
  } catch {
    return false;
  }
}

export function dismissMonthClose(userId: string, month: string): void {
  try {
    window.localStorage.setItem(dismissKey(userId, month), '1');
  } catch {
    // Sin almacenamiento: la tarjeta se oculta solo en esta vista.
  }
}

/** 'YYYY-MM' → 'noviembre'. */
export function monthLabel(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}

/** 'YYYY-MM' → 'nov.'. */
export function shortMonthLabel(month: string): string {
  return SHORT_MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}
