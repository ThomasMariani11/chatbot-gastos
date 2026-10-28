// @vitest-environment jsdom
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_PAGE_SIZE, AdminPanel } from '../src/AdminPanel';
import { Dashboard, MOVEMENTS_PAGE_SIZE } from '../src/Dashboard';
import {
  computeTotalsByCurrency,
  createDashboardQueryCache,
  DASHBOARD_POLL_INTERVAL_MS,
  readDashboardSnapshot,
} from '../src/dashboardData';
import type { supabase as supabaseClient } from '../src/supabase';

const catId = '00000000-0000-4000-8000-000000000099';

const mockState = vi.hoisted(() => ({
  monthlyTransactions: [] as Record<string, unknown>[],
  installmentTransactions: [] as Record<string, unknown>[],
  profiles: [] as Record<string, unknown>[],
  codes: [] as Record<string, unknown>[],
  systemConfig: {
    whatsapp_bot_phone: '5491112345678',
    bot_active: 'true',
    support_phone: '5491199998888',
    payment_alias: 'pesito.mp',
  } as Record<string, string>,
  queryCounts: {
    monthly: 0,
    installments: 0,
    budgets: 0,
    whatsapp_links: 0,
    app_settings: 0,
    distinct_months: 0,
    system_config: 0,
    categories: 0,
    profiles: 0,
    invitation_codes: 0,
  },
  realtimeHandlers: {} as Record<string, () => void>,
}));

vi.mock('../src/usePwaInstall', () => ({
  usePwaInstall: () => ({
    canInstall: false,
    showIosModal: false,
    showDesktopModal: false,
    triggerInstall: vi.fn(),
    setShowIosModal: vi.fn(),
    setShowDesktopModal: vi.fn(),
  }),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => h('div', null, children),
  PieChart: ({ children }: { children: ReactNode }) => h('div', null, children),
  Pie: () => null,
  Cell: () => null,
}));

vi.mock('../src/BotOperations', () => ({
  BotOperations: () => h('div', { 'data-testid': 'bot-operations-stub' }, 'Bot ops'),
}));

vi.mock('../src/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let isInstallmentQuery = false;
      let cursor = '';
      let rangeStart: number | null = null;
      let rangeEnd: number | null = null;
      let inKeys: string[] | null = null;
      let eqKey: string | null = null;

      const execute = () => {
        if (table === 'categories') {
          mockState.queryCounts.categories++;
          return { data: [{ id: catId, name: 'Compras', kind: 'expense' }], error: null };
        }
        if (table === 'transactions') {
          if (isInstallmentQuery) {
            mockState.queryCounts.installments++;
            const after = cursor
              ? mockState.installmentTransactions.filter((r) => String(r.id) > cursor)
              : mockState.installmentTransactions;
            return {
              data: after.slice(0, 250),
              count: after.length,
              error: null,
            };
          }
          mockState.queryCounts.monthly++;
          const after = cursor
            ? mockState.monthlyTransactions.filter((r) => String(r.id) > cursor)
            : mockState.monthlyTransactions;
          return {
            data: after.slice(0, 250),
            count: after.length,
            error: null,
          };
        }
        if (table === 'budgets') {
          mockState.queryCounts.budgets++;
          return { data: { amount_ars: 200000 }, error: null };
        }
        if (table === 'whatsapp_links') {
          mockState.queryCounts.whatsapp_links++;
          return { data: { status: 'active' }, error: null };
        }
        if (table === 'app_settings') {
          mockState.queryCounts.app_settings++;
          return { data: { whatsapp_responses_enabled: true }, error: null };
        }
        if (table === 'system_config') {
          mockState.queryCounts.system_config++;
          if (inKeys) {
            return {
              data: inKeys
                .filter((k) => mockState.systemConfig[k] !== undefined)
                .map((k) => ({ key: k, value: mockState.systemConfig[k] })),
              error: null,
            };
          }
          if (eqKey) {
            const val = mockState.systemConfig[eqKey];
            return { data: val !== undefined ? { value: val } : null, error: null };
          }
          return { data: null, error: null };
        }
        if (table === 'profiles') {
          mockState.queryCounts.profiles++;
          const total = mockState.profiles.length;
          const slice =
            rangeStart !== null && rangeEnd !== null
              ? mockState.profiles.slice(rangeStart, rangeEnd + 1)
              : mockState.profiles;
          return { data: slice, count: total, error: null };
        }
        if (table === 'invitation_codes') {
          mockState.queryCounts.invitation_codes++;
          const total = mockState.codes.length;
          const slice =
            rangeStart !== null && rangeEnd !== null
              ? mockState.codes.slice(rangeStart, rangeEnd + 1)
              : mockState.codes;
          return { data: slice, count: total, error: null };
        }
        return { data: null, error: null };
      };

      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          if (table === 'system_config' && col === 'key') eqKey = String(val);
          return q;
        },
        in: (col: string, vals: string[]) => {
          if (table === 'system_config' && col === 'key') inKeys = vals;
          return q;
        },
        gte: () => q,
        lt: () => q,
        gt: (col: string, val: unknown) => {
          if (col === 'installment_count') isInstallmentQuery = true;
          if (col === 'id') cursor = String(val);
          return q;
        },
        order: () => q,
        limit: () => q,
        range: (from: number, to: number) => {
          rangeStart = from;
          rangeEnd = to;
          return q;
        },
        abortSignal: () => q,
        maybeSingle: () => Promise.resolve(execute()),
        single: () => Promise.resolve(execute()),
        then: (done: (value: unknown) => unknown) => Promise.resolve(execute()).then(done),
      };
      return q;
    },
    channel: () => {
      const channel = {
        on: (_type: string, opts: { table?: string }, cb: () => void) => {
          if (opts?.table) mockState.realtimeHandlers[opts.table] = cb;
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: async () => undefined,
    rpc: (name: string) => {
      const run = async () => {
        if (name === 'get_distinct_transaction_months') {
          mockState.queryCounts.distinct_months++;
          return { data: ['2026-09', '2026-10'], error: null };
        }
        return { data: null, error: null };
      };
      const p = run();
      return Object.assign(p, { abortSignal: () => p });
    },
  },
}));

function resetCounts() {
  for (const key of Object.keys(mockState.queryCounts) as Array<keyof typeof mockState.queryCounts>) {
    mockState.queryCounts[key] = 0;
  }
}

describe('FE-18: Reducir consultas y paginar resultados', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    window.scrollTo = vi.fn();
    resetCounts();
    mockState.realtimeHandlers = {};
    mockState.monthlyTransactions = [];
    mockState.installmentTransactions = [];
    mockState.profiles = [];
    mockState.codes = [];
    window.location.hash = '#resumen';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('pagina transacciones mensuales > 1.000 filas sin truncar totales ARS/USD ni mezclar monedas', async () => {
    const allRows = Array.from({ length: 620 }, (_, index) => {
      const n = index + 1;
      const isUsd = n % 5 === 0;
      const isIncome = n % 10 === 0;
      return {
        id: `tx-${String(n).padStart(4, '0')}`,
        description: `Operación ${n}`,
        amount_ars: isUsd ? 10.25 : 100.1,
        currency: isUsd ? 'USD' : 'ARS',
        occurred_on: `2026-10-${String((index % 28) + 1).padStart(2, '0')}`,
        kind: isIncome ? 'income' : 'expense',
        category_id: catId,
        categories: { name: 'Compras' },
        installment_number: null,
        installment_count: null,
        installment_group_id: null,
      };
    });

    let monthlyPageCalls = 0;
    const customClient = {
      from: (table: string) => {
        let cursor = '';
        let isInstallments = false;
        const exec = () => {
          if (table === 'transactions') {
            if (isInstallments) return { data: [], count: 0, error: null };
            monthlyPageCalls++;
            const remaining = cursor ? allRows.filter((r) => r.id > cursor) : allRows;
            return {
              data: remaining.slice(0, 250),
              count: remaining.length,
              error: null,
            };
          }
          if (table === 'budgets') return { data: { amount_ars: 500000 }, error: null };
          if (table === 'whatsapp_links') return { data: { status: 'active' }, error: null };
          if (table === 'app_settings') return { data: { whatsapp_responses_enabled: true }, error: null };
          if (table === 'system_config') return { data: { value: '5491112345678' }, error: null };
          return { data: null, error: null };
        };
        const q = {
          select: () => q,
          eq: () => q,
          gte: () => q,
          lt: () => q,
          gt: (col: string, val: unknown) => {
            if (col === 'installment_count') isInstallments = true;
            if (col === 'id') cursor = String(val);
            return q;
          },
          order: () => q,
          limit: () => q,
          abortSignal: () => q,
          maybeSingle: () => Promise.resolve(exec()),
          then: (done: (value: unknown) => unknown) => Promise.resolve(exec()).then(done),
        };
        return q;
      },
      rpc: () => {
        const p = Promise.resolve({ data: ['2026-10'], error: null });
        return Object.assign(p, { abortSignal: () => p });
      },
    } as unknown as typeof supabaseClient;

    const snapshot = await readDashboardSnapshot(
      'user-1',
      '2026-10',
      new AbortController().signal,
      customClient,
    );

    expect(monthlyPageCalls).toBe(3); // 250 + 250 + 120 = 620
    expect(snapshot.transactions).toHaveLength(620);

    const mapped = snapshot.transactions.map((r) => ({
      amount: Number(r.amount_ars),
      currency: (r.currency === 'USD' ? 'USD' : 'ARS') as 'ARS' | 'USD',
      kind: r.kind as 'expense' | 'income',
    }));

    const arsTotals = computeTotalsByCurrency(mapped, 'ARS');
    const usdTotals = computeTotalsByCurrency(mapped, 'USD');

    // De 620 filas: 124 son USD (n % 5 === 0) y 496 son ARS (todas gastos porque n % 10 === 0 también es múltiplo de 5)
    expect(arsTotals.expenses).toBeCloseTo(496 * 100.1, 2);
    expect(arsTotals.income).toBe(0);
    // De las 124 USD: 62 son ingresos (n % 10 === 0) y 62 son gastos (terminados en 5)
    expect(usdTotals.expenses).toBeCloseTo(62 * 10.25, 2);
    expect(usdTotals.income).toBeCloseTo(62 * 10.25, 2);
    expect(usdTotals.balance).toBe(0);
  });

  it('reutiliza caché de configuración, meses y cuotas al cambiar de mes e invalida selectivamente', async () => {
    const cache = createDashboardQueryCache('user-1');
    const now = 1_700_000_000_000;

    mockState.monthlyTransactions = [
      {
        id: 'tx-oct-1',
        description: 'Supermercado',
        amount_ars: 15000,
        currency: 'ARS',
        occurred_on: '2026-10-10',
        kind: 'expense',
        category_id: catId,
        categories: { name: 'Compras' },
      },
    ];
    mockState.installmentTransactions = [
      {
        id: 'inst-1',
        description: 'Heladera',
        amount_ars: 50000,
        currency: 'ARS',
        occurred_on: '2026-10-15',
        kind: 'expense',
        category_id: catId,
        categories: { name: 'Compras' },
        installment_number: 1,
        installment_count: 3,
        installment_group_id: 'grp-1',
      },
    ];

    const { supabase } = await import('../src/supabase');

    // Primera lectura (2026-10): consulta los 7 dominios
    await readDashboardSnapshot('user-1', '2026-10', new AbortController().signal, supabase, {
      cache,
      now,
    });
    expect(mockState.queryCounts.monthly).toBe(1);
    expect(mockState.queryCounts.budgets).toBe(1);
    expect(mockState.queryCounts.installments).toBe(1);
    expect(mockState.queryCounts.whatsapp_links).toBe(1);
    expect(mockState.queryCounts.app_settings).toBe(1);
    expect(mockState.queryCounts.distinct_months).toBe(1);
    expect(mockState.queryCounts.system_config).toBe(1);

    // Segunda lectura cambiando de mes (2026-09): solo consulta monthly y budgets (2 consultas en vez de 7)
    mockState.monthlyTransactions = [
      {
        id: 'tx-sep-1',
        description: 'Alquiler',
        amount_ars: 120000,
        currency: 'ARS',
        occurred_on: '2026-09-05',
        kind: 'expense',
        category_id: catId,
        categories: { name: 'Compras' },
      },
    ];

    await readDashboardSnapshot('user-1', '2026-09', new AbortController().signal, supabase, {
      cache,
      now: now + 5_000,
    });
    expect(mockState.queryCounts.monthly).toBe(2);
    expect(mockState.queryCounts.budgets).toBe(2);
    expect(mockState.queryCounts.installments).toBe(1);
    expect(mockState.queryCounts.whatsapp_links).toBe(1);
    expect(mockState.queryCounts.app_settings).toBe(1);
    expect(mockState.queryCounts.distinct_months).toBe(1);
    expect(mockState.queryCounts.system_config).toBe(1);

    // Invalidar cuotas y estado del bot refresca únicamente esos dominios
    cache.invalidateInstallments();
    cache.invalidateBotState();

    await readDashboardSnapshot('user-1', '2026-09', new AbortController().signal, supabase, {
      cache,
      now: now + 10_000,
    });
    expect(mockState.queryCounts.installments).toBe(2);
    expect(mockState.queryCounts.whatsapp_links).toBe(2);
    expect(mockState.queryCounts.app_settings).toBe(2);
    // system_config (teléfono del bot) y meses siguen en caché
    expect(mockState.queryCounts.system_config).toBe(1);
    expect(mockState.queryCounts.distinct_months).toBe(1);
  });

  it('pausa el polling en segundo plano cuando la pestaña está oculta y pagina el listado de movimientos (>50)', async () => {
    vi.useFakeTimers();
    const currentMonth = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
    })
      .format(new Date())
      .slice(0, 7);

    mockState.monthlyTransactions = Array.from({ length: 65 }, (_, idx) => {
      const n = idx + 1;
      return {
        id: `mov-${String(n).padStart(3, '0')}`,
        description: `Compra paginada ${n}`,
        amount_ars: 1000 + n,
        currency: 'ARS',
        occurred_on: `${currentMonth}-${String((idx % 25) + 1).padStart(2, '0')}`,
        kind: 'expense',
        category_id: catId,
        categories: { name: 'Compras' },
      };
    });

    window.location.hash = '#movimientos';

    await act(async () => {
      root.render(
        h(
          StrictMode,
          null,
          h(Dashboard, {
            userId: 'user-poll',
            userEmail: 'test@example.com',
            onOpenSettings: () => {},
            onSignOut: () => {},
          }),
        ),
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const initialMonthlyCalls = mockState.queryCounts.monthly;
    const initialCategoryCalls = mockState.queryCounts.categories;
    expect(initialMonthlyCalls).toBeGreaterThanOrEqual(1);

    // Verificar paginación en #movimientos (65 operaciones -> página 1 muestra 50, página 2 muestra 15)
    expect(MOVEMENTS_PAGE_SIZE).toBe(50);
    const paginationNav = container.querySelector('nav[aria-label="Paginación de movimientos"]');
    expect(paginationNav).not.toBeNull();
    expect(paginationNav?.textContent).toContain('Página 1 de 2');
    expect(container.querySelectorAll('.movements-day-groups .movement')).toHaveLength(50);

    const buttons = paginationNav!.querySelectorAll('button');
    const prevBtn = buttons[0] as HTMLButtonElement;
    const nextBtn = buttons[1] as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
    expect(nextBtn.disabled).toBe(false);

    await act(async () => {
      nextBtn.click();
    });

    expect(paginationNav?.textContent).toContain('Página 2 de 2');
    expect(container.querySelectorAll('.movements-day-groups .movement')).toHaveLength(15);

    // Ocultar la pestaña: avanzar varios intervalos de polling no debe ejecutar ninguna consulta
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    const callsBeforeHiddenPoll = mockState.queryCounts.monthly;
    await act(async () => {
      vi.advanceTimersByTime(DASHBOARD_POLL_INTERVAL_MS * 3);
    });
    expect(mockState.queryCounts.monthly).toBe(callsBeforeHiddenPoll);

    // Volver a hacer visible la pestaña dispara un único refresco sin recargar categorías fijas
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockState.queryCounts.monthly).toBeGreaterThan(callsBeforeHiddenPoll);
    expect(mockState.queryCounts.categories).toBe(initialCategoryCalls);
  });

  it('AdminPanel unifica system_config en 1 consulta, lee múltiples páginas de perfiles y pagina tablas de Clientes e Invitaciones', async () => {
    mockState.profiles = Array.from({ length: 55 }, (_, idx) => {
      const n = idx + 1;
      return {
        id: `client-${String(n).padStart(3, '0')}`,
        email: `cliente${n}@example.test`,
        first_name: `Cliente`,
        last_name: `Número ${n}`,
        role: 'client',
        subscription_status: 'active',
        subscription_until: '2027-01-01T00:00:00Z',
        phone_number: `549110000${String(n).padStart(4, '0')}`,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
    });

    mockState.codes = Array.from({ length: 25 }, (_, idx) => {
      const n = idx + 1;
      return {
        id: `code-${String(n).padStart(3, '0')}`,
        code: `PESO-C${String(n).padStart(3, '0')}-2026`,
        duration_days: 30,
        is_used: false,
        used_by: null,
        used_at: null,
        created_by: 'admin-1',
        notes: `Nota ${n}`,
        created_at: '2026-01-01T00:00:00Z',
      };
    });

    await act(async () => {
      root.render(
        h(AdminPanel, {
          userId: 'admin-1',
          onBack: () => {},
          onSignOut: () => {},
        }),
      );
    });

    await vi.waitFor(() => {
      expect(container.querySelector('.admin-clients-table')).not.toBeNull();
    });

    // Las 4 claves de system_config se leyeron en una sola consulta .in(...)
    expect(mockState.queryCounts.system_config).toBe(1);

    // Las métricas reflejan el total real (55 clientes y 25 invitaciones), pero la tabla muestra ADMIN_PAGE_SIZE (20)
    expect(ADMIN_PAGE_SIZE).toBe(20);
    const overviewStrong = Array.from(container.querySelectorAll('.admin-overview strong')).map(
      (el) => el.textContent,
    );
    expect(overviewStrong).toEqual(['55', '55', '0', '25']);

    const clientRowsPage1 = container.querySelectorAll('.admin-clients-table tbody tr');
    expect(clientRowsPage1).toHaveLength(20);

    const clientsNav = container.querySelector('nav[aria-label="Paginación de clientes"]');
    expect(clientsNav).not.toBeNull();
    expect(clientsNav?.textContent).toContain('1–20');
    expect(clientsNav?.textContent).toContain('Página 1 de 3');

    const [, nextClientsBtn] = Array.from(clientsNav!.querySelectorAll('button'));
    await act(async () => {
      (nextClientsBtn as HTMLButtonElement).click();
    });
    expect(clientsNav?.textContent).toContain('21–40');
    expect(clientsNav?.textContent).toContain('Página 2 de 3');

    await act(async () => {
      (nextClientsBtn as HTMLButtonElement).click();
    });
    expect(clientsNav?.textContent).toContain('41–55');
    expect(clientsNav?.textContent).toContain('Página 3 de 3');
    expect(container.querySelectorAll('.admin-clients-table tbody tr')).toHaveLength(15);

    // Al buscar un cliente se reinicia a la página 1
    const searchInput = container.querySelector<HTMLInputElement>('#admin-client-search');
    expect(searchInput).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        searchInput,
        'cliente1@example.test',
      );
      searchInput!.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelectorAll('.admin-clients-table tbody tr')).toHaveLength(1);
    expect(container.querySelector('nav[aria-label="Paginación de clientes"]')).toBeNull();

    // Cambiar a la pestaña Invitaciones y verificar paginación de códigos (25 -> 20 en pág 1, 5 en pág 2)
    const codesTabBtn = Array.from(
      container.querySelectorAll('.admin-workspace-nav button'),
    ).find((b) => b.textContent?.includes('Invitaciones')) as HTMLButtonElement;
    await act(async () => {
      codesTabBtn.click();
    });

    expect(container.querySelectorAll('.admin-codes-table tbody tr')).toHaveLength(20);
    const codesNav = container.querySelector('nav[aria-label="Paginación de invitaciones"]');
    expect(codesNav).not.toBeNull();
    expect(codesNav?.textContent).toContain('Página 1 de 2');

    const [, nextCodesBtn] = Array.from(codesNav!.querySelectorAll('button'));
    await act(async () => {
      (nextCodesBtn as HTMLButtonElement).click();
    });
    expect(codesNav?.textContent).toContain('Página 2 de 2');
    expect(container.querySelectorAll('.admin-codes-table tbody tr')).toHaveLength(5);
  });
});
