// 3.2 (LEG-01): exportación de movimientos y borrado de la cuenta por el propio cliente.
import type { supabase } from './supabase';

type Client = typeof supabase;

export type MovementRow = {
  id: string;
  occurred_on: string | null;
  kind: 'expense' | 'income';
  description: string;
  amount_ars: number | string | null;
  currency: 'ARS' | 'USD' | string;
  installment_number: number | null;
  installment_count: number | null;
  status: 'pending' | 'confirmed' | 'cancelled' | string;
  categories: { name: string } | null;
};

const PAGE = 1000;
const COLUMNS = 'id,occurred_on,kind,description,amount_ars,currency,installment_number,installment_count,status,categories(name)';

/** Todos los movimientos de la cuenta (RLS limita a los propios), por páginas ordenadas por id. */
export async function fetchMovements(client: Client, userId: string): Promise<MovementRow[]> {
  const all: MovementRow[] = [];
  let after: string | null = null;
  for (;;) {
    let query = client.from('transactions').select(COLUMNS).eq('user_id', userId);
    if (after) query = query.gt('id', after);
    const { data, error } = await query.order('id', { ascending: true }).limit(PAGE);
    if (error || !Array.isArray(data)) throw new Error('EXPORT_READ');
    const rows = data as unknown as MovementRow[];
    all.push(...rows);
    if (rows.length < PAGE) return all;
    after = rows[rows.length - 1].id;
  }
}

const KIND: Record<string, string> = { expense: 'Gasto', income: 'Ingreso' };
const STATUS: Record<string, string> = { confirmed: 'Confirmado', pending: 'Pendiente', cancelled: 'Cancelado' };

// Comillas siempre; un texto que empieza como fórmula se neutraliza para que Excel no lo ejecute.
function cell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function amount(value: MovementRow['amount_ars']): string {
  const n = Number(value);
  return value === null || value === '' || !Number.isFinite(n) ? '' : n.toFixed(2).replace('.', ',');
}

/** CSV para Excel en español: BOM, separador punto y coma y coma decimal. Las monedas no se suman ni se convierten. */
export function movementsCsv(rows: MovementRow[]): string {
  const header = ['Fecha', 'Tipo', 'Concepto', 'Categoría', 'Monto', 'Moneda', 'Cuota', 'Estado'];
  const lines = rows.map((r) => [
    r.occurred_on ?? '',
    KIND[r.kind] ?? r.kind,
    r.description,
    r.categories?.name ?? '',
    amount(r.amount_ars),
    r.currency,
    r.installment_number && (r.installment_count ?? 1) > 1 ? `${r.installment_number} de ${r.installment_count}` : '',
    STATUS[r.status] ?? r.status,
  ].map(cell).join(';'));
  return '﻿' + [header.map(cell).join(';'), ...lines].join('\r\n');
}

/** Descarga el CSV en el navegador; no pasa por ningún servidor. */
export async function downloadMovements(client: Client, userId: string, today: string, doc: Document = document): Promise<void> {
  const csv = movementsCsv(await fetchMovements(client, userId));
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  try {
    const link = doc.createElement('a');
    link.href = url;
    link.download = `pesito-movimientos-${today}.csv`;
    doc.body.append(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export type DeleteResult = 'deleted' | 'wrong_password' | 'denied' | 'failed';

/**
 * Verifica la contraseña, borra la cuenta en la base (delete_my_account, 057), desuscribe este
 * navegador de las notificaciones y cierra la sesión local. Si la base no borra, no se cierra nada.
 */
export async function deleteAccount(input: {
  client: Client;
  email: string;
  password: string;
  unsubscribe: () => Promise<void>;
}): Promise<DeleteResult> {
  const { client, email, password, unsubscribe } = input;
  const check = await client.auth.signInWithPassword({ email, password });
  if (check.error) return 'wrong_password';
  const { error } = await client.rpc('delete_my_account');
  if (error) return (error as { code?: string }).code === '42501' ? 'denied' : 'failed';
  await unsubscribe().catch(() => undefined);
  await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  return 'deleted';
}
