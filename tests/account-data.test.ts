import { describe, expect, it, vi } from 'vitest';
import { deleteAccount, fetchMovements, movementsCsv, type MovementRow } from '../src/accountData';

// 3.2 (LEG-01): exportación de movimientos y borrado de cuenta. Datos ficticios; cliente de Supabase simulado.
const row = (over: Partial<MovementRow> = {}): MovementRow => ({
  id: '00000000-0000-4000-8000-000000000001', occurred_on: '2026-11-20', kind: 'expense', description: 'Súper', amount_ars: 1234.5,
  currency: 'ARS', installment_number: null, installment_count: 1, status: 'confirmed', categories: { name: 'Supermercado' }, ...over,
});

describe('movementsCsv', () => {
  it('arma un CSV para Excel en español: BOM, punto y coma, coma decimal y encabezado', () => {
    const csv = movementsCsv([row()]);
    expect(csv.startsWith('﻿')).toBe(true);
    const [header, line] = csv.slice(1).split('\r\n');
    expect(header).toBe('"Fecha";"Tipo";"Concepto";"Categoría";"Monto";"Moneda";"Cuota";"Estado"');
    expect(line).toBe('"2026-11-20";"Gasto";"Súper";"Supermercado";"1234,50";"ARS";"";"Confirmado"');
  });

  it('mantiene las monedas separadas, muestra la cuota y traduce tipo y estado', () => {
    const [, ...lines] = movementsCsv([
      row({ kind: 'income', currency: 'USD', amount_ars: 10, status: 'pending', categories: null }),
      row({ installment_number: 2, installment_count: 6, status: 'cancelled' }),
    ]).slice(1).split('\r\n');
    expect(lines[0]).toBe('"2026-11-20";"Ingreso";"Súper";"";"10,00";"USD";"";"Pendiente"');
    expect(lines[1]).toContain('"2 de 6";"Cancelado"');
  });

  it('escapa comillas y neutraliza fórmulas en el concepto', () => {
    const [, line] = movementsCsv([row({ description: '=HYPERLINK("x")' })]).slice(1).split('\r\n');
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    for (const start of ['+', '-', '@']) expect(movementsCsv([row({ description: `${start}1` })])).toContain(`"'${start}1"`);
  });

  it('también neutraliza tabulación y retorno de carro al inicio, y un monto negativo sale como número', () => {
    expect(movementsCsv([row({ description: '\t=1' })])).toContain(`"'\t=1"`);
    expect(movementsCsv([row({ description: '\r=1' })])).toContain(`"'\r=1"`);
    const [, line] = movementsCsv([row({ amount_ars: -50 })]).slice(1).split('\r\n');
    expect(line).toContain('"-50,00"');
  });

  it('sin movimientos deja solo el encabezado', () => {
    expect(movementsCsv([]).slice(1).split('\r\n')).toHaveLength(1);
  });
});

describe('fetchMovements', () => {
  it('trae todas las páginas de la cuenta, ordenadas por id', async () => {
    const pages = [Array.from({ length: 1000 }, (_, i) => row({ id: `id-${String(i).padStart(4, '0')}` })), [row({ id: 'id-9999' })]];
    const calls: Array<{ user: string; after: string | null }> = [];
    let page = 0;
    const client = {
      from: () => {
        const state = { user: '', after: null as string | null };
        const q = {
          select: () => q,
          eq: (_c: string, v: string) => { state.user = v; return q; },
          gt: (_c: string, v: string) => { state.after = v; return q; },
          order: () => q,
          limit: () => { calls.push({ ...state }); return Promise.resolve({ data: pages[page++] ?? [], error: null }); },
        };
        return q;
      },
    } as never;
    const rows = await fetchMovements(client, 'user-ficticio');
    expect(rows).toHaveLength(1001);
    expect(calls).toEqual([{ user: 'user-ficticio', after: null }, { user: 'user-ficticio', after: 'id-0999' }]);
  });

  it('un error de lectura no devuelve una exportación incompleta', async () => {
    const q = { select: () => q, eq: () => q, gt: () => q, order: () => q, limit: () => Promise.resolve({ data: null, error: { message: 'x' } }) };
    await expect(fetchMovements({ from: () => q } as never, 'user-ficticio')).rejects.toThrow('EXPORT_READ');
  });
});

describe('deleteAccount', () => {
  function deps(over: { password?: boolean; authError?: { code?: string; status?: number }; rpcError?: string; rpcMessage?: string } = {}) {
    const order: string[] = [];
    const client = {
      auth: {
        signInWithPassword: vi.fn(async () => {
          order.push('password');
          return { error: over.authError ?? (over.password === false ? { code: 'invalid_credentials', status: 400 } : null) };
        }),
        signOut: vi.fn(async () => { order.push('signOut'); return { error: null }; }),
      },
      rpc: vi.fn(async () => {
        order.push('rpc');
        return { data: over.rpcError ? null : { deleted: true }, error: over.rpcError ? { code: over.rpcError, message: over.rpcMessage ?? '' } : null };
      }),
    };
    const unsubscribe = vi.fn(async () => { order.push('push'); });
    return { client, unsubscribe, order };
  }
  const run = (d: ReturnType<typeof deps>) =>
    deleteAccount({ client: d.client as never, email: 'ficticia@example.test', password: 'Clave1234', unsubscribe: d.unsubscribe });

  it('verifica la contraseña, borra, desuscribe el navegador y cierra la sesión local, en ese orden', async () => {
    const d = deps();
    expect(await run(d)).toBe('deleted');
    expect(d.order).toEqual(['password', 'rpc', 'push', 'signOut']);
    expect(d.client.rpc).toHaveBeenCalledWith('delete_my_account');
    expect(d.client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('con la contraseña equivocada no borra nada', async () => {
    const d = deps({ password: false });
    expect(await run(d)).toBe('wrong_password');
    expect(d.order).toEqual(['password']);
  });

  it('un error de Auth que no es la contraseña (red, límite de intentos) no se informa como contraseña equivocada', async () => {
    expect(await run(deps({ authError: { status: 429 } }))).toBe('auth_failed');
    expect(await run(deps({ authError: { status: 0 } }))).toBe('auth_failed');
    expect(await run(deps({ authError: { code: 'invalid_credentials', status: 400 } }))).toBe('wrong_password');
  });

  it('si la sesión no es reciente, pide la contraseña de nuevo sin cerrar la sesión', async () => {
    const d = deps({ rpcError: '28000', rpcMessage: 'REAUTH_REQUIRED' });
    expect(await run(d)).toBe('reauth');
    expect(d.order).toEqual(['password', 'rpc']);
  });

  it('si la cuenta ya no existe (otra pestaña o un reintento), cierra la sesión local como si se hubiera borrado', async () => {
    const d = deps({ rpcError: '42501', rpcMessage: 'ACCOUNT_NOT_FOUND' });
    expect(await run(d)).toBe('deleted');
    expect(d.order).toEqual(['password', 'rpc', 'push', 'signOut']);
  });

  it('si la base rechaza el borrado, no cierra la sesión', async () => {
    const denied = deps({ rpcError: '42501', rpcMessage: 'ACCOUNT_DELETION_ADMIN' });
    expect(await run(denied)).toBe('denied');
    const failed = deps({ rpcError: 'XX000' });
    expect(await run(failed)).toBe('failed');
    expect(failed.order).toEqual(['password', 'rpc']);
  });
});
