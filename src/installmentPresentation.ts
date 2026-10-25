export type InstallmentMovement = {
  id: string; title: string; amount: number; currency: 'ARS' | 'USD'; date: string;
  category: string; categoryId?: string; kind: 'expense';
  installmentNumber: number; installmentCount: number; installmentGroupId: string | null;
};
export type InstallmentPlanView = {
  groupId: string; description: string; currency: 'ARS' | 'USD'; installmentCount: number;
  totalAmount: number; scheduledFrom: string; scheduledCount: number; scheduledTotal: number;
  earlierCount: number; activeCount: number; progressPercent: number;
  nextScheduled?: InstallmentMovement; currentMovement: InstallmentMovement;
};
type Row = Record<string, unknown>;
function isoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T12:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function cents(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') throw new Error('Importe de cuota inválido.');
  const amount = Number(value), result = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(result) || Math.abs(result / 100 - amount) > 0.000001) throw new Error('Importe de cuota inválido.');
  return result;
}
function sum(rows: readonly InstallmentMovement[]): number {
  const total = rows.reduce((value, row) => {
    const result = value + cents(row.amount);
    if (!Number.isSafeInteger(result)) throw new Error('El total de cuotas excede el rango seguro.');
    return result;
  }, 0);
  return total / 100;
}
/** Fechas programadas, nunca pagos inferidos. Incluye la siguiente cuota y conserva números/IDs. */
export function presentInstallmentPlans(input: readonly Row[], month: string, today: string): InstallmentPlanView[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !isoDate(today)) throw new Error('Período de cuotas inválido.');
  const from = month > today.slice(0, 7) ? month + '-01' : today;
  const groups = new Map<string, InstallmentMovement[]>(), ids = new Set<string>();
  for (const row of input) {
    if (row.kind !== 'expense' || (row.status !== undefined && row.status !== 'confirmed')) continue;
    const number = Number(row.installment_number), count = Number(row.installment_count);
    if (typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.description !== 'string' || !isoDate(row.occurred_on)
      || !['ARS', 'USD'].includes(String(row.currency)) || !Number.isInteger(count) || count < 2 || count > 60 || !Number.isInteger(number) || number < 1 || number > count) throw new Error('Los datos de las cuotas están incompletos.');
    ids.add(row.id);
    const group = typeof row.installment_group_id === 'string' && row.installment_group_id ? row.installment_group_id : null;
    const item: InstallmentMovement = {
      id: row.id, title: row.description, amount: cents(row.amount_ars) / 100,
      currency: row.currency as 'ARS' | 'USD', date: row.occurred_on,
      category: typeof (row.categories as { name?: unknown } | null)?.name === 'string' ? (row.categories as { name: string }).name : 'Compras',
      categoryId: typeof row.category_id === 'string' ? row.category_id : undefined,
      kind: 'expense', installmentNumber: number, installmentCount: count, installmentGroupId: group,
    };
    // Un registro antiguo sin grupo queda aislado por ID; nunca agrupar compras por su nombre.
    const key = group ?? row.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  const plans: InstallmentPlanView[] = [];
  for (const [groupId, rows] of groups) {
    const first = rows[0];
    if (rows.some(row => row.currency !== first.currency || row.installmentCount !== first.installmentCount)
      || new Set(rows.map(row => row.installmentNumber)).size !== rows.length) throw new Error('El plan tiene cuotas incompatibles.');
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.installmentNumber - b.installmentNumber || a.id.localeCompare(b.id));
    const periodRows = rows.filter(row => row.date >= month + '-01');
    if (!periodRows.length) continue;
    const scheduled = rows.filter(row => row.date >= from), earlierCount = rows.length - scheduled.length;
    const current = periodRows.find(row => row.date.startsWith(month + '-')) ?? periodRows[0];
    plans.push({ groupId, description: current.title, currency: first.currency, installmentCount: first.installmentCount,
      totalAmount: sum(rows), scheduledFrom: from, scheduledCount: scheduled.length, scheduledTotal: sum(scheduled),
      earlierCount, activeCount: rows.length, progressPercent: Math.round(earlierCount / rows.length * 100),
      nextScheduled: scheduled[0], currentMovement: current });
  }
  return plans.sort((a, b) => (a.nextScheduled?.date ?? a.currentMovement.date).localeCompare(b.nextScheduled?.date ?? b.currentMovement.date) || a.groupId.localeCompare(b.groupId));
}
