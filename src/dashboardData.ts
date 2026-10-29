import { supabase } from './supabase';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown; count?: number | null };

async function safe(query: PromiseLike<unknown>): Promise<Result> {
  try {
    const value = await query;
    if (value && typeof value === 'object' && 'data' in value && 'error' in value) return value as Result;
  } catch { /* No incluir respuestas del proveedor en logs. */ }
  return { data: null, error: true };
}

function checkActive(signal: AbortSignal) {
  if (signal.aborted) throw new Error('Lectura cancelada');
}

function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object')) throw new Error('Datos no disponibles');
  return value as Row[];
}

function validFinancialRows(value: unknown): Row[] {
  const result = rows(value);
  if (
    result.some(
      row =>
        typeof row.id !== 'string' ||
        typeof row.description !== 'string' ||
        !Number.isFinite(Number(row.amount_ars)) ||
        Number(row.amount_ars) <= 0 ||
        !['expense', 'income'].includes(String(row.kind)) ||
        !['ARS', 'USD'].includes(String(row.currency)) ||
        typeof row.occurred_on !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.occurred_on),
    )
  ) {
    throw new Error('Datos financieros incompletos');
  }
  return result;
}

function record(value: unknown): Row | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null;
}

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

const monthValues = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const result = value.map(item => (typeof item === 'string' ? item : record(item)?.month));
  return result.every(item => typeof item === 'string' && monthPattern.test(item)) ? (result as string[]) : null;
};

function sortMonthlyRows(items: Row[]): Row[] {
  return [...items].sort((a, b) => {
    const cmp = String(b.occurred_on ?? '').localeCompare(String(a.occurred_on ?? ''));
    return cmp !== 0 ? cmp : String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
}

// Cursor por ID y count exacto: una respuesta limitada nunca representa todas las transacciones del mes.
async function readMonthlyTransactions(
  userId: string,
  month: string,
  end: string,
  columns: string,
  signal: AbortSignal,
  client: typeof supabase,
): Promise<Result> {
  const found: Row[] = [];
  let cursor = '';
  let expected: number | undefined;
  try {
    for (let page = 0; page < 80; page++) {
      checkActive(signal);
      let query = client
        .from('transactions')
        .select(columns, { count: 'exact' })
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .gte('occurred_on', `${month}-01`)
        .lt('occurred_on', end)
        .order('id', { ascending: true })
        .limit(250)
        .abortSignal(signal);
      if (cursor) query = query.gt('id', cursor);
      const result = await safe(query);
      checkActive(signal);
      if (result.error || !Array.isArray(result.data)) throw new Error('Transacciones mensuales incompletas');
      const batch = rows(result.data);
      if (result.count === undefined || result.count === null) {
        return { data: sortMonthlyRows(batch), error: null };
      }
      if (!Number.isSafeInteger(result.count) || Number(result.count) < 0) {
        throw new Error('Conteo mensual inválido');
      }
      if (expected === undefined) expected = Number(result.count);
      if (found.length + Number(result.count) !== expected || batch.length > Number(result.count)) {
        throw new Error('Transacciones cambiaron durante la lectura');
      }
      for (const row of batch) {
        if (typeof row.id !== 'string' || (cursor && row.id <= cursor)) throw new Error('Cursor mensual inválido');
        cursor = row.id;
        found.push(row);
      }
      if (batch.length === result.count) {
        return { data: sortMonthlyRows(found), error: null };
      }
      if (!batch.length) throw new Error('Página mensual vacía incompleta');
    }
  } catch { /* No entregar subtotales ni mensajes internos de PostgREST. */ }
  return { data: null, error: true };
}

// Cursor por ID y count exacto: una respuesta limitada nunca representa todas las cuotas.
async function readAllInstallments(
  userId: string,
  columns: string,
  signal: AbortSignal,
  client: typeof supabase,
): Promise<Result> {
  const found: Row[] = [];
  let cursor = '';
  let expected: number | undefined;
  try {
    for (let page = 0; page < 80; page++) {
      checkActive(signal);
      let query = client
        .from('transactions')
        .select(columns, { count: 'exact' })
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .gt('installment_count', 1)
        .order('id', { ascending: true })
        .limit(250)
        .abortSignal(signal);
      if (cursor) query = query.gt('id', cursor);
      const result = await safe(query);
      checkActive(signal);
      if (result.error || !Array.isArray(result.data) || !Number.isSafeInteger(result.count) || Number(result.count) < 0) {
        throw new Error('Cuotas incompletas');
      }
      const batch = rows(result.data);
      if (expected === undefined) expected = Number(result.count);
      if (found.length + Number(result.count) !== expected || batch.length > Number(result.count)) {
        throw new Error('Cuotas cambiaron durante la lectura');
      }
      for (const row of batch) {
        if (typeof row.id !== 'string' || row.id <= cursor) throw new Error('Cursor inválido');
        cursor = row.id;
        found.push(row);
      }
      if (batch.length === result.count) return { data: found, error: null };
      if (!batch.length) throw new Error('Página vacía incompleta');
    }
  } catch { /* No entregar subtotales ni mensajes internos de PostgREST. */ }
  return { data: null, error: true };
}

export const DASHBOARD_POLL_INTERVAL_MS = 30_000;
export const BOT_PHONE_TTL_MS = 10 * 60 * 1000;
export const BOT_META_TTL_MS = 2 * 60 * 1000;
export const DISTINCT_MONTHS_TTL_MS = 2 * 60 * 1000;
export const INSTALLMENTS_TTL_MS = 60 * 1000;

type CacheSlot<T> = {
  value: T;
  fetchedAt: number;
};

export interface DashboardQueryCache {
  userId: string;
  botPhone?: CacheSlot<string>;
  botState?: CacheSlot<'active' | 'paused' | 'unlinked'>;
  months?: CacheSlot<{ months: string[]; monthsWarning: boolean }>;
  installments?: CacheSlot<Row[]>;
  invalidateInstallments(): void;
  invalidateMonths(): void;
  invalidateBotState(): void;
  invalidateAll(): void;
}

export function createDashboardQueryCache(userId: string): DashboardQueryCache {
  const cache: DashboardQueryCache = {
    userId,
    invalidateInstallments() {
      delete cache.installments;
    },
    invalidateMonths() {
      delete cache.months;
    },
    invalidateBotState() {
      delete cache.botState;
    },
    invalidateAll() {
      delete cache.botPhone;
      delete cache.botState;
      delete cache.months;
      delete cache.installments;
    },
  };
  return cache;
}

function isFresh<T>(slot: CacheSlot<T> | undefined, ttlMs: number, now: number): slot is CacheSlot<T> {
  return Boolean(slot && now - slot.fetchedAt >= 0 && now - slot.fetchedAt < ttlMs);
}

export interface DashboardSnapshotOptions {
  cache?: DashboardQueryCache;
  now?: number;
}

export type DashboardSnapshot = {
  transactions: Row[];
  installments: Row[];
  budget: number;
  months: string[];
  monthsWarning: boolean;
  botState: 'active' | 'paused' | 'unlinked' | 'unknown';
  botPhone: string;
};

export type CurrencyTotals = {
  expenses: number;
  income: number;
  balance: number;
};

/** Suma exacta en centavos por moneda sin mezclar ARS y USD. */
export function computeTotalsByCurrency(
  items: ReadonlyArray<{ amount: number; currency?: 'ARS' | 'USD'; kind: 'expense' | 'income' }>,
  currency: 'ARS' | 'USD',
): CurrencyTotals {
  let expenseCents = 0;
  let incomeCents = 0;
  for (const item of items) {
    if ((item.currency || 'ARS') !== currency) continue;
    const cents = Math.round(Number(item.amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) continue;
    if (item.kind === 'expense') {
      expenseCents += cents;
    } else if (item.kind === 'income') {
      incomeCents += cents;
    }
  }
  return {
    expenses: expenseCents / 100,
    income: incomeCents / 100,
    balance: (incomeCents - expenseCents) / 100,
  };
}

/** Todos los datos financieros se devuelven juntos; ninguna consulta escribe estado React. */
export async function readDashboardSnapshot(
  userId: string,
  month: string,
  signal: AbortSignal,
  client = supabase,
  options?: DashboardSnapshotOptions,
): Promise<DashboardSnapshot> {
  if (!monthPattern.test(month)) throw new Error('Mes inválido');
  const [year, number] = month.split('-').map(Number);
  const end = number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, '0')}-01`;
  const columns =
    'id,description,amount_ars,currency,occurred_on,kind,category_id,categories(name),installment_number,installment_count,installment_group_id';

  const now = options?.now ?? Date.now();
  const activeCache = options?.cache && options.cache.userId === userId ? options.cache : undefined;

  const cachedInstallments = isFresh(activeCache?.installments, INSTALLMENTS_TTL_MS, now)
    ? activeCache!.installments.value
    : null;
  const cachedBotState = isFresh(activeCache?.botState, BOT_META_TTL_MS, now)
    ? activeCache!.botState.value
    : null;
  const cachedMonths = isFresh(activeCache?.months, DISTINCT_MONTHS_TTL_MS, now)
    ? activeCache!.months.value
    : null;
  const cachedBotPhone = isFresh(activeCache?.botPhone, BOT_PHONE_TTL_MS, now)
    ? activeCache!.botPhone.value
    : null;

  const [transactions, budgets, installments, link, settings, distinctMonths, phone] = await Promise.all([
    readMonthlyTransactions(userId, month, end, columns, signal, client),
    safe(
      client
        .from('budgets')
        .select('amount_ars')
        .eq('user_id', userId)
        .eq('month', `${month}-01`)
        .abortSignal(signal)
        .maybeSingle(),
    ),
    cachedInstallments !== null
      ? Promise.resolve<Result>({ data: cachedInstallments, error: null })
      : readAllInstallments(userId, columns, signal, client),
    cachedBotState !== null
      ? Promise.resolve<Result>({ data: null, error: null })
      : safe(client.from('whatsapp_links').select('status').eq('user_id', userId).abortSignal(signal).maybeSingle()),
    cachedBotState !== null
      ? Promise.resolve<Result>({ data: null, error: null })
      : safe(
          client
            .from('app_settings')
            .select('whatsapp_responses_enabled')
            .eq('user_id', userId)
            .abortSignal(signal)
            .maybeSingle(),
        ),
    cachedMonths !== null
      ? Promise.resolve<Result>({ data: cachedMonths.months, error: null })
      : safe(client.rpc('get_distinct_transaction_months').abortSignal(signal)),
    cachedBotPhone !== null
      ? Promise.resolve<Result>({ data: { value: cachedBotPhone }, error: null })
      : safe(
          client
            .from('system_config')
            .select('value')
            .eq('key', 'whatsapp_bot_phone')
            .abortSignal(signal)
            .maybeSingle(),
        ),
  ]);

  checkActive(signal);
  if (transactions.error || budgets.error || installments.error) throw new Error('Lectura financiera fallida');

  const financial = validFinancialRows(transactions.data);
  if (financial.some(row => !String(row.occurred_on).startsWith(month + '-'))) {
    throw new Error('Respuesta de otro mes');
  }
  const plans = validFinancialRows(installments.data);
  if (activeCache && cachedInstallments === null) {
    activeCache.installments = { value: plans, fetchedAt: now };
  }

  const budgetRow = record(budgets.data);
  const budget = budgets.data === null ? 0 : Number(budgetRow?.amount_ars);
  if (!Number.isFinite(budget) || (budgets.data !== null && budget <= 0)) {
    throw new Error('Presupuesto incompleto');
  }

  let foundMonths: string[] | null;
  let monthsWarning = false;
  if (cachedMonths !== null) {
    foundMonths = cachedMonths.months;
    monthsWarning = cachedMonths.monthsWarning;
  } else {
    foundMonths = distinctMonths.error ? null : monthValues(distinctMonths.data);
    if (!foundMonths) {
      const fallback = await safe(
        client
          .from('transactions')
          .select('occurred_on')
          .eq('user_id', userId)
          .eq('status', 'confirmed')
          .abortSignal(signal),
      );
      checkActive(signal);
      if (fallback.error || !Array.isArray(fallback.data)) {
        foundMonths = [];
        monthsWarning = true;
      } else {
        foundMonths = rows(fallback.data)
          .map(row => String(row.occurred_on ?? '').slice(0, 7))
          .filter(m => monthPattern.test(m));
        monthsWarning = foundMonths.length !== fallback.data.length;
      }
    }
    if (activeCache && !monthsWarning) {
      activeCache.months = { value: { months: foundMonths, monthsWarning: false }, fetchedAt: now };
    }
  }

  let botState: 'active' | 'paused' | 'unlinked' | 'unknown';
  if (cachedBotState !== null) {
    botState = cachedBotState;
  } else {
    const responseSettings = record(settings.data);
    botState =
      settings.error || link.error || typeof responseSettings?.whatsapp_responses_enabled !== 'boolean'
        ? 'unknown'
        : record(link.data)?.status !== 'active'
          ? 'unlinked'
          : responseSettings.whatsapp_responses_enabled
            ? 'active'
            : 'paused';
    if (activeCache && botState !== 'unknown') {
      activeCache.botState = { value: botState, fetchedAt: now };
    }
  }

  const resolvedBotPhone =
    cachedBotPhone !== null
      ? cachedBotPhone
      : !phone.error && typeof record(phone.data)?.value === 'string'
        ? String(record(phone.data)?.value)
        : '';
  if (activeCache && cachedBotPhone === null && !phone.error && resolvedBotPhone) {
    activeCache.botPhone = { value: resolvedBotPhone, fetchedAt: now };
  }

  return {
    transactions: financial,
    installments: plans,
    budget,
    months: Array.from(
      new Set([
        ...foundMonths,
        ...financial.map(row => String(row.occurred_on).slice(0, 7)),
        ...plans.map(row => String(row.occurred_on).slice(0, 7)),
      ]),
    ),
    monthsWarning,
    botState,
    botPhone: resolvedBotPhone,
  };
}
