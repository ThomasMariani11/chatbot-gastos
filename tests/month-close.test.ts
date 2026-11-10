// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildMonthClose,
  closedMonth,
  dismissMonthClose,
  isMonthCloseDismissed,
  loadMonthClose,
  monthLabel,
  shortMonthLabel,
} from '../src/monthCloseRules';

vi.mock('../src/supabase', () => ({ supabase: {} }));

type Row = { amount: number; currency: 'ARS' | 'USD'; kind: 'expense' | 'income'; occurred_on: string };
const row = (amount: number, currency: 'ARS' | 'USD', kind: 'expense' | 'income', occurred_on: string): Row => ({
  amount,
  currency,
  kind,
  occurred_on,
});

describe('closedMonth', () => {
  it('devuelve el mes anterior del día 1 al 7 (hora argentina)', () => {
    expect(closedMonth(Date.parse('2026-12-01T00:30:00-03:00'))).toBe('2026-11');
    expect(closedMonth(Date.parse('2026-12-07T23:59:00-03:00'))).toBe('2026-11');
    expect(closedMonth(Date.parse('2026-12-08T00:00:00-03:00'))).toBeNull();
  });

  it('resuelve el cambio de año', () => {
    expect(closedMonth(Date.parse('2027-01-03T12:00:00-03:00'))).toBe('2026-12');
  });

  it('usa el día argentino, no el UTC', () => {
    // 02:00 UTC del 1/12 es 23:00 del 30/11 en Argentina.
    expect(closedMonth(Date.parse('2026-12-01T02:00:00Z'))).toBeNull();
  });
});

describe('buildMonthClose', () => {
  const rows = [
    row(350000, 'ARS', 'expense', '2026-10-12'),
    row(100000, 'ARS', 'expense', '2026-10-20'),
    row(350000, 'ARS', 'expense', '2026-11-05'),
    row(470000, 'ARS', 'income', '2026-11-01'),
    row(50, 'USD', 'expense', '2026-11-09'),
  ];

  it('arma totales por moneda, comparación y presupuesto, ARS antes que USD', () => {
    const close = buildMonthClose('2026-11', rows, 400000);
    expect(close).toEqual({
      month: '2026-11',
      previousMonth: '2026-10',
      currencies: [
        { currency: 'ARS', expenses: 350000, income: 470000, balance: 120000, expenseChange: -22 },
        { currency: 'USD', expenses: 50, income: 0, balance: -50, expenseChange: null },
      ],
      budget: { amount: 400000, left: 50000 },
    });
  });

  it('marca el aumento respecto del mes anterior', () => {
    const close = buildMonthClose(
      '2026-11',
      [row(100000, 'ARS', 'expense', '2026-10-10'), row(350000, 'ARS', 'expense', '2026-11-10')],
      null,
    );
    expect(close?.currencies[0].expenseChange).toBe(250);
  });

  it('marca la baja respecto del mes anterior', () => {
    const close = buildMonthClose(
      '2026-11',
      [row(100000, 'ARS', 'expense', '2026-10-10'), row(92000, 'ARS', 'expense', '2026-11-10')],
      null,
    );
    expect(close?.currencies[0].expenseChange).toBe(-8);
  });

  it('deja el presupuesto negativo si se excedió y null si no hay presupuesto', () => {
    const over = buildMonthClose('2026-11', [row(450000, 'ARS', 'expense', '2026-11-10')], 400000);
    expect(over?.budget).toEqual({ amount: 400000, left: -50000 });
    const none = buildMonthClose('2026-11', [row(450000, 'ARS', 'expense', '2026-11-10')], null);
    expect(none?.budget).toBeNull();
    const zero = buildMonthClose('2026-11', [row(450000, 'ARS', 'expense', '2026-11-10')], 0);
    expect(zero?.budget).toBeNull();
  });

  it('devuelve null si el mes no tiene filas, aunque haya del mes anterior', () => {
    expect(buildMonthClose('2026-11', [], 400000)).toBeNull();
    expect(buildMonthClose('2026-11', [row(100, 'ARS', 'expense', '2026-10-10')], null)).toBeNull();
  });

  it('no muestra monedas que solo tuvieron movimientos el mes anterior', () => {
    const close = buildMonthClose(
      '2026-11',
      [row(30, 'USD', 'expense', '2026-10-10'), row(1000, 'ARS', 'expense', '2026-11-10')],
      null,
    );
    expect(close?.currencies.map((c) => c.currency)).toEqual(['ARS']);
  });

  it('sin gastos el mes anterior no hay comparación (nunca infinito)', () => {
    const close = buildMonthClose(
      '2026-11',
      [row(5000, 'ARS', 'income', '2026-10-10'), row(1000, 'ARS', 'expense', '2026-11-10')],
      null,
    );
    expect(close?.currencies[0].expenseChange).toBeNull();
  });

  it('solo ingresos: aparece la moneda con gastos en cero', () => {
    const close = buildMonthClose('2026-11', [row(5000, 'ARS', 'income', '2026-11-10')], null);
    expect(close?.currencies).toEqual([
      { currency: 'ARS', expenses: 0, income: 5000, balance: 5000, expenseChange: null },
    ]);
  });

  it('cambio de año: diciembre se compara con noviembre', () => {
    const close = buildMonthClose(
      '2026-12',
      [row(200, 'ARS', 'expense', '2026-11-30'), row(300, 'ARS', 'expense', '2026-12-01')],
      null,
    );
    expect(close?.previousMonth).toBe('2026-11');
    expect(close?.currencies[0].expenseChange).toBe(50);
    expect(buildMonthClose('2027-01', [row(1, 'ARS', 'expense', '2027-01-02')], null)?.previousMonth).toBe('2026-12');
  });
});

type Call = { table: string; select?: string; filters: Array<[string, string, string]> };

// Ids ficticios ordenables como texto (igual que los uuid en minúscula).
const txId = (n: number) => `tx-${String(n).padStart(5, '0')}`;
const withIds = (items: Array<Record<string, unknown>>) => items.map((item, i) => ({ id: txId(i + 1), ...item }));

function fakeClient(opts: {
  settings?: { data: unknown; error: unknown };
  transactions?: { data: unknown; error: unknown };
  budget?: { data: unknown; error: unknown };
}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      let after: string | null = null;
      let pageSize: number | null = null;
      const transactions = () => {
        const base = opts.transactions ?? { data: [], error: null };
        if (!Array.isArray(base.data)) return base;
        // Respeta orden por id, cursor (gt) y límite como PostgREST.
        const sorted = [...(base.data as Array<{ id: string }>)].sort((a, b) => a.id.localeCompare(b.id));
        const rest = after === null ? sorted : sorted.filter((item) => item.id > (after as string));
        return { data: pageSize === null ? rest : rest.slice(0, pageSize), error: base.error };
      };
      const result = () =>
        table === 'app_settings'
          ? (opts.settings ?? { data: { monthly_summary_enabled: true }, error: null })
          : table === 'budgets'
            ? (opts.budget ?? { data: null, error: null })
            : transactions();
      const builder: any = {
        select(columns: string) {
          call.select = columns;
          return builder;
        },
        eq(column: string, value: string) {
          call.filters.push(['eq', column, value]);
          return builder;
        },
        gt(column: string, value: string) {
          call.filters.push(['gt', column, value]);
          after = value;
          return builder;
        },
        gte(column: string, value: string) {
          call.filters.push(['gte', column, value]);
          return builder;
        },
        lte(column: string, value: string) {
          call.filters.push(['lte', column, value]);
          return builder;
        },
        order(column: string, options: { ascending: boolean }) {
          call.filters.push(['order', column, options.ascending ? 'asc' : 'desc']);
          return builder;
        },
        limit(count: number) {
          call.filters.push(['limit', '', String(count)]);
          pageSize = count;
          return builder;
        },
        maybeSingle: () => Promise.resolve(result()),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(result()).then(resolve, reject),
      };
      return builder;
    },
  };
  return { client, calls };
}

describe('loadMonthClose', () => {
  const NOW = Date.parse('2026-12-02T10:00:00-03:00');

  it('devuelve null sin consultar fuera de la ventana del día 1 al 7', async () => {
    const { client, calls } = fakeClient({});
    expect(await loadMonthClose(client, 'u1', Date.parse('2026-12-15T10:00:00-03:00'))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('devuelve null con la preferencia apagada, columna ausente o error', async () => {
    const off = fakeClient({ settings: { data: { monthly_summary_enabled: false }, error: null } });
    expect(await loadMonthClose(off.client, 'u1', NOW)).toBeNull();
    expect(off.calls.map((c) => c.table)).toEqual(['app_settings']);

    const missing = fakeClient({ settings: { data: {}, error: null } });
    expect(await loadMonthClose(missing.client, 'u1', NOW)).toBeNull();

    const failed = fakeClient({ settings: { data: null, error: { message: 'x' } } });
    expect(await loadMonthClose(failed.client, 'u1', NOW)).toBeNull();
  });

  it('devuelve null si fallan las transacciones o el presupuesto', async () => {
    const tx = fakeClient({ transactions: { data: null, error: { message: 'x' } } });
    expect(await loadMonthClose(tx.client, 'u1', NOW)).toBeNull();

    const shape = fakeClient({ transactions: { data: { no: 'lista' }, error: null } });
    expect(await loadMonthClose(shape.client, 'u1', NOW)).toBeNull();

    const budget = fakeClient({
      transactions: { data: withIds([{ amount_ars: '10', currency: 'ARS', kind: 'expense', occurred_on: '2026-11-03' }]), error: null },
      budget: { data: null, error: { message: 'x' } },
    });
    expect(await loadMonthClose(budget.client, 'u1', NOW)).toBeNull();

    const noId = fakeClient({
      transactions: { data: [{ amount_ars: '10', currency: 'ARS', kind: 'expense', occurred_on: '2026-11-03' }], error: null },
    });
    expect(await loadMonthClose(noId.client, 'u1', NOW)).toBeNull();
  });

  it('pagina por id: suma todas las filas aunque superen una página', async () => {
    // 600 gastos de noviembre (3 páginas: 250 + 250 + 100) y 300 de octubre.
    const data = withIds([
      ...Array.from({ length: 600 }, () => ({ amount_ars: '10', currency: 'ARS', kind: 'expense', occurred_on: '2026-11-15' })),
      ...Array.from({ length: 300 }, () => ({ amount_ars: '10', currency: 'ARS', kind: 'expense', occurred_on: '2026-10-15' })),
    ]);
    const { client, calls } = fakeClient({ transactions: { data, error: null } });
    const close = await loadMonthClose(client, 'u1', NOW);
    expect(close?.currencies).toEqual([
      { currency: 'ARS', expenses: 6000, income: 0, balance: -6000, expenseChange: 100 },
    ]);

    const pages = calls.filter((c) => c.table === 'transactions');
    expect(pages).toHaveLength(4);
    const base = [
      ['eq', 'user_id', 'u1'],
      ['eq', 'status', 'confirmed'],
      ['gte', 'occurred_on', '2026-10-01'],
      ['lte', 'occurred_on', '2026-11-30'],
      ['order', 'id', 'asc'],
      ['limit', '', '250'],
    ];
    expect(pages[0].filters).toEqual(base);
    expect(pages[1].filters).toEqual([...base, ['gt', 'id', txId(250)]]);
    expect(pages[2].filters).toEqual([...base, ['gt', 'id', txId(500)]]);
    expect(pages[3].filters).toEqual([...base, ['gt', 'id', txId(750)]]);
  });

  it('devuelve null si una página posterior falla', async () => {
    const data = withIds(
      Array.from({ length: 300 }, () => ({ amount_ars: '10', currency: 'ARS', kind: 'expense', occurred_on: '2026-11-15' })),
    );
    const { client } = fakeClient({ transactions: { data, error: null } });
    let page = 0;
    const from = client.from.bind(client);
    client.from = (table: string) => {
      const builder = from(table);
      if (table !== 'transactions' || page++ === 0) return builder;
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'x' } }).then(resolve);
      return builder;
    };
    expect(await loadMonthClose(client, 'u1', NOW)).toBeNull();
  });

  it('caso feliz: arma el cierre y pide el rango y filtros exactos', async () => {
    const { client, calls } = fakeClient({
      transactions: {
        data: withIds([
          { amount_ars: '100000.00', currency: 'ARS', kind: 'expense', occurred_on: '2026-10-10' },
          { amount_ars: '350000', currency: 'ARS', kind: 'expense', occurred_on: '2026-11-05' },
          { amount_ars: 470000, currency: 'ARS', kind: 'income', occurred_on: '2026-11-01' },
          { amount_ars: '50', currency: 'USD', kind: 'expense', occurred_on: '2026-11-09' },
        ]),
        error: null,
      },
      budget: { data: { amount_ars: '400000' }, error: null },
    });
    const close = await loadMonthClose(client, 'u1', NOW);
    expect(close).toEqual({
      month: '2026-11',
      previousMonth: '2026-10',
      currencies: [
        { currency: 'ARS', expenses: 350000, income: 470000, balance: 120000, expenseChange: 250 },
        { currency: 'USD', expenses: 50, income: 0, balance: -50, expenseChange: null },
      ],
      budget: { amount: 400000, left: 50000 },
    });

    const settings = calls.find((c) => c.table === 'app_settings');
    expect(settings?.select).toBe('monthly_summary_enabled');
    expect(settings?.filters).toEqual([['eq', 'user_id', 'u1']]);

    const tx = calls.find((c) => c.table === 'transactions');
    expect(tx?.select).toBe('id,amount_ars,currency,kind,occurred_on');
    expect(tx?.filters).toEqual([
      ['eq', 'user_id', 'u1'],
      ['eq', 'status', 'confirmed'],
      ['gte', 'occurred_on', '2026-10-01'],
      ['lte', 'occurred_on', '2026-11-30'],
      ['order', 'id', 'asc'],
      ['limit', '', '250'],
    ]);
    // Una página corta alcanza: no se pide otra.
    expect(calls.filter((c) => c.table === 'transactions')).toHaveLength(1);

    const budgets = calls.find((c) => c.table === 'budgets');
    expect(budgets?.select).toBe('amount_ars');
    expect(budgets?.filters).toEqual([
      ['eq', 'user_id', 'u1'],
      ['eq', 'month', '2026-11-01'],
    ]);
  });

  it('cambio de año: el 1/1 pide 2026-11-01 a 2026-12-31', async () => {
    const { client, calls } = fakeClient({
      transactions: { data: withIds([{ amount_ars: '10', currency: 'ARS', kind: 'expense', occurred_on: '2026-12-31' }]), error: null },
    });
    const close = await loadMonthClose(client, 'u1', Date.parse('2027-01-01T11:00:00-03:00'));
    expect(close?.month).toBe('2026-12');
    expect(calls.find((c) => c.table === 'transactions')?.filters.slice(2, 4)).toEqual([
      ['gte', 'occurred_on', '2026-11-01'],
      ['lte', 'occurred_on', '2026-12-31'],
    ]);
  });

  it('sin presupuesto cargado el cierre no tiene línea de presupuesto', async () => {
    const { client } = fakeClient({
      transactions: { data: withIds([{ amount_ars: '10', currency: 'ARS', kind: 'expense', occurred_on: '2026-11-03' }]), error: null },
    });
    expect((await loadMonthClose(client, 'u1', NOW))?.budget).toBeNull();
  });
});

describe('ocultar el cierre', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('se oculta por mes y por cuenta', () => {
    expect(isMonthCloseDismissed('u', '2026-11')).toBe(false);
    dismissMonthClose('u', '2026-11');
    expect(isMonthCloseDismissed('u', '2026-11')).toBe(true);
    expect(isMonthCloseDismissed('u', '2026-12')).toBe(false);
    expect(isMonthCloseDismissed('otra', '2026-11')).toBe(false);
    expect(window.localStorage.getItem('pesito:cierre-mes-oculto:u:2026-11')).not.toBeNull();
  });

  it('no rompe si localStorage lanza', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(() => dismissMonthClose('u', '2026-11')).not.toThrow();
    expect(isMonthCloseDismissed('u', '2026-11')).toBe(false);
  });
});

describe('etiquetas de mes', () => {
  it('devuelve el nombre en español en minúscula', () => {
    expect(monthLabel('2026-11')).toBe('noviembre');
    expect(monthLabel('2026-01')).toBe('enero');
    expect(shortMonthLabel('2026-11')).toBe('nov.');
  });
});
