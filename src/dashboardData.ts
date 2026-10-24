import { supabase } from './supabase';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };
async function safe(query: PromiseLike<unknown>): Promise<Result> {
  try {
    const value = await query;
    if (value && typeof value === 'object' && 'data' in value && 'error' in value) return value as Result;
  } catch { /* No incluir respuestas del proveedor en logs. */ }
  return { data: null, error: true };
}
function checkActive(signal: AbortSignal) { if (signal.aborted) throw new Error('Lectura cancelada'); }
function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object')) throw new Error('Datos no disponibles');
  return value as Row[];
}
function validFinancialRows(value: unknown): Row[] {
  const result = rows(value);
  if (result.some(row => typeof row.id !== 'string' || typeof row.description !== 'string' || !Number.isFinite(Number(row.amount_ars)) || Number(row.amount_ars) <= 0
    || !['expense','income'].includes(String(row.kind)) || !['ARS','USD'].includes(String(row.currency)) || typeof row.occurred_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.occurred_on))) throw new Error('Datos financieros incompletos');
  return result;
}
function record(value: unknown): Row | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null; }
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthValues = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const result = value.map(item => typeof item === 'string' ? item : record(item)?.month);
  return result.every(item => typeof item === 'string' && monthPattern.test(item)) ? result as string[] : null;
};
export type DashboardSnapshot = {
  transactions: Row[]; installments: Row[]; budget: number; months: string[]; monthsWarning: boolean;
  botState: 'active' | 'paused' | 'unlinked' | 'unknown'; botPhone: string;
};

/** Todos los datos financieros se devuelven juntos; ninguna consulta escribe estado React. */
export async function readDashboardSnapshot(userId: string, month: string, signal: AbortSignal, client = supabase): Promise<DashboardSnapshot> {
  if (!monthPattern.test(month)) throw new Error('Mes inválido');
  const [year, number] = month.split('-').map(Number);
  const end = number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2,'0')}-01`;
  const columns = 'id,description,amount_ars,currency,occurred_on,kind,category_id,categories(name),installment_number,installment_count,installment_group_id';
  const [transactions, budgets, installments, link, settings, distinctMonths, phone] = await Promise.all([
    safe(client.from('transactions').select(columns).eq('user_id',userId).eq('status','confirmed').gte('occurred_on',`${month}-01`).lt('occurred_on',end).order('occurred_on',{ascending:false}).abortSignal(signal)),
    safe(client.from('budgets').select('amount_ars').eq('user_id',userId).eq('month',`${month}-01`).abortSignal(signal).maybeSingle()),
    safe(client.from('transactions').select(columns).eq('user_id',userId).eq('status','confirmed').gt('installment_count',1).order('occurred_on',{ascending:true}).abortSignal(signal)),
    safe(client.from('whatsapp_links').select('status').eq('user_id',userId).abortSignal(signal).maybeSingle()),
    safe(client.from('app_settings').select('whatsapp_responses_enabled').eq('user_id',userId).abortSignal(signal).maybeSingle()),
    safe(client.rpc('get_distinct_transaction_months').abortSignal(signal)),
    safe(client.from('system_config').select('value').eq('key','whatsapp_bot_phone').abortSignal(signal).maybeSingle()),
  ]);
  checkActive(signal);
  if (transactions.error || budgets.error || installments.error) throw new Error('Lectura financiera fallida');
  const financial = validFinancialRows(transactions.data);
  if (financial.some(row => !String(row.occurred_on).startsWith(month + '-'))) throw new Error('Respuesta de otro mes');
  const plans = validFinancialRows(installments.data);
  const budgetRow = record(budgets.data);
  const budget = budgets.data === null ? 0 : Number(budgetRow?.amount_ars);
  if (!Number.isFinite(budget) || (budgets.data !== null && budget <= 0)) throw new Error('Presupuesto incompleto');
  let foundMonths = distinctMonths.error ? null : monthValues(distinctMonths.data);
  let monthsWarning = false;
  if (!foundMonths) {
    const fallback = await safe(client.from('transactions').select('occurred_on').eq('user_id',userId).eq('status','confirmed').abortSignal(signal));
    checkActive(signal);
    if (fallback.error || !Array.isArray(fallback.data)) { foundMonths = []; monthsWarning = true; }
    else {
      foundMonths = rows(fallback.data).map(row => String(row.occurred_on ?? '').slice(0,7)).filter(m => monthPattern.test(m));
      monthsWarning = foundMonths.length !== fallback.data.length;
    }
  }
  const responseSettings = record(settings.data);
  const botState = settings.error || link.error || typeof responseSettings?.whatsapp_responses_enabled !== 'boolean'
    ? 'unknown' : record(link.data)?.status !== 'active' ? 'unlinked' : responseSettings.whatsapp_responses_enabled ? 'active' : 'paused';
  return { transactions: financial, installments: plans, budget, months: Array.from(new Set([...foundMonths,...financial.map(row=>String(row.occurred_on).slice(0,7)),...plans.map(row=>String(row.occurred_on).slice(0,7))])),
    monthsWarning, botState, botPhone: !phone.error && typeof record(phone.data)?.value === 'string' ? String(record(phone.data)?.value) : '' };
}