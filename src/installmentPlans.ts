import { supabase } from './supabase';

export const MIN_INSTALLMENT_COUNT = 2;
export const MAX_INSTALLMENT_COUNT = 60;
export const PRESET_INSTALLMENT_COUNTS = [2, 3, 4, 5, 6, 9, 10, 12, 18, 24, 36, 48] as const;
export const INSTALLMENT_BOUNDS_ERROR = 'Revisá la cantidad y referencia de cuotas (2 a 60).';

export function isValidInstallmentCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_INSTALLMENT_COUNT &&
    value <= MAX_INSTALLMENT_COUNT
  );
}

export function isValidInstallmentSchedule(count: unknown, referenceNumber: unknown): boolean {
  return (
    isValidInstallmentCount(count) &&
    typeof referenceNumber === 'number' &&
    Number.isInteger(referenceNumber) &&
    referenceNumber >= 1 &&
    referenceNumber <= count
  );
}

export function parseInstallmentCountInput(raw: string | number): number | null {
  if (typeof raw === 'number') {
    return isValidInstallmentCount(raw) ? raw : null;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return isValidInstallmentCount(parsed) ? parsed : null;
}

export type PlanRow = {
  id: string; description: string; amount_ars: number; currency: 'ARS' | 'USD';
  occurred_on: string; category_id: string | null; kind: 'expense';
  installment_number: number; installment_count: number; installment_group_id: string;
};
export type PlanSnapshot = { group_id: string; version: string; rows: PlanRow[] };
export type PlanEditor = { description: string; amount: number; currency: 'ARS' | 'USD'; categoryId: string; date: string; number: number; count: number };
export function parsePlanSnapshot(value: unknown): PlanSnapshot {
  if (!value || typeof value !== 'object') throw new Error('La respuesta del plan no es válida.');
  const data = value as Record<string, unknown>;
  if (typeof data.group_id !== 'string' || typeof data.version !== 'string' || !/^[a-f0-9]{32}$/.test(data.version) || !Array.isArray(data.rows)) throw new Error('La respuesta del plan no es válida.');
  const rows = data.rows.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Cuota inválida.');
    const row = value as PlanRow;
    if (typeof row.id !== 'string' || typeof row.description !== 'string' || !Number.isFinite(Number(row.amount_ars)) || Number(row.amount_ars) <= 0 || !['ARS','USD'].includes(row.currency) || typeof row.occurred_on !== 'string' || !isValidInstallmentSchedule(row.installment_count, row.installment_number)) throw new Error('Cuota inválida.');
    return { ...row, amount_ars: Number(row.amount_ars) };
  });
  return { group_id: data.group_id, version: data.version, rows };
}
export function planPatch(original: PlanRow, edited: PlanEditor, all: boolean): Record<string, unknown> {
  if (!isValidInstallmentSchedule(edited.count, edited.number)) {
    throw new Error(INSTALLMENT_BOUNDS_ERROR);
  }
  const patch: Record<string, unknown> = {};
  if (edited.description.trim() !== original.description) patch.description = edited.description.trim();
  if (Math.round(edited.amount * 100) !== Math.round(original.amount_ars * 100)) patch.amount = edited.amount;
  if (edited.categoryId !== original.category_id) patch.category_id = edited.categoryId;
  if (edited.currency !== original.currency) {
    if (!all) throw new Error('Para cambiar la moneda, aplicá el cambio a todo el plan.');
    patch.currency = edited.currency;
  }
  if (!all && (edited.count !== original.installment_count || edited.number !== original.installment_number)) throw new Error('Para reprogramar o cambiar la cantidad, aplicá el cambio a todo el plan.');
  if (all && edited.count !== original.installment_count) {
    patch.installment_count = edited.count;
    if (edited.count > original.installment_count) patch.new_installment_amount = edited.amount;
  }
  // El clamp automático de la referencia al reducir cantidad no reprograma fechas.
  if (all && (edited.date !== original.occurred_on || (edited.number !== original.installment_number && edited.count === original.installment_count))) patch.schedule = { date: edited.date, number: edited.number };
  if (!all && edited.date !== original.occurred_on) patch.occurred_on = edited.date;
  return patch;
}
export function planError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === '40001') return 'El plan cambió desde que lo abriste. Cerrá y volvé a abrir para revisar los cambios.';
  if (code === '42501') return 'No tenés acceso a ese plan, categoría o cuenta activa.';
  if (code === 'PGRST202' || code === '42883') return 'La edición segura de cuotas todavía no está disponible. Intentá más tarde.';
  if (code === '22023' || code === '22P02' || code === '22008' || code === '22003') return 'Revisá los datos. Si reintentaste un guardado anterior, mantené sus valores para comprobarlo sin duplicar.';
  return error instanceof Error ? error.message : 'No pudimos comprobar el guardado. Reintentá con los mismos datos; no vuelvas a crear la compra.';
}
export async function readInstallmentPlan(groupId: string): Promise<PlanSnapshot> {
  const { data, error } = await supabase.rpc('get_installment_plan', { p_group_id: groupId });
  if (error) throw error;
  return parsePlanSnapshot(data);
}
export async function mutateInstallmentPlan(input: {
  requestId: string; action: 'create' | 'edit' | 'delete_plan' | 'delete_installment';
  groupId?: string; version?: string; itemId?: string; payload?: Record<string, unknown>; all?: boolean;
}): Promise<PlanSnapshot> {
  const { data, error } = await supabase.rpc('mutate_installment_plan', {
    p_request_id: input.requestId, p_action: input.action, p_group_id: input.groupId ?? null,
    p_expected_version: input.version ?? null, p_item_id: input.itemId ?? null,
    p_payload: input.payload ?? {}, p_apply_all: input.all ?? true,
  });
  if (error) throw error;
  return parsePlanSnapshot(data);
}
