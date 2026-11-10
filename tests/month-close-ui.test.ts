// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatMoney } from '../lib/finance';
import { MonthCloseCard } from '../src/MonthCloseCard';
import { isMonthCloseDismissed } from '../src/monthCloseRules';
import { Settings, type UserProfile } from '../src/Settings';
import { useProfileDraft } from '../src/useProfileDraft';

// Cliente falso para Ajustes (la tarjeta recibe su propio cliente inyectado).
const db = vi.hoisted(() => ({ row: {} as Record<string, unknown>, updates: [] as Array<Record<string, unknown>> }));
vi.mock('../src/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: db.row, error: null }) }),
        in: async () => ({ data: [], error: null }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async () => {
          db.updates.push(values);
          return { error: null };
        },
      }),
    }),
  },
}));
vi.mock('../src/usePwaInstall', () => ({ usePwaInstall: () => ({ canInstall: false, showIosModal: false, showDesktopModal: false, triggerInstall: vi.fn(), setShowIosModal: vi.fn(), setShowDesktopModal: vi.fn() }) }));
vi.mock('../src/useSwipeBack', () => ({ useSwipeBack: () => ({ dragOffset: 0, isSwiping: false }) }));

const DEC_2 = Date.parse('2026-12-01T10:00:00-03:00');
const DEC_8 = Date.parse('2026-12-08T10:00:00-03:00');

type Result = { data: unknown; error: unknown };
type Tx = { amount_ars: string | number; currency: 'ARS' | 'USD'; kind: 'expense' | 'income'; occurred_on: string };

function fakeClient(opts: { settings?: Result; transactions?: Tx[]; budget?: number | null }) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(table);
      const result = (): Result =>
        table === 'app_settings'
          ? (opts.settings ?? { data: { monthly_summary_enabled: true }, error: null })
          : table === 'budgets'
            ? { data: opts.budget == null ? null : { amount_ars: String(opts.budget) }, error: null }
            : { data: opts.transactions ?? [], error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        lte: () => builder,
        maybeSingle: () => Promise.resolve(result()),
        then: ((onfulfilled, onrejected) => Promise.resolve(result()).then(onfulfilled, onrejected)) as Promise<Result>['then'],
      };
      return builder;
    },
  };
  return { client, calls };
}

// Caso feliz de Task 3: pesos con suba de 250% y presupuesto con sobrante; dólares sin comparación.
const happy: Tx[] = [
  { amount_ars: '100000.00', currency: 'ARS', kind: 'expense', occurred_on: '2026-10-10' },
  { amount_ars: '350000', currency: 'ARS', kind: 'expense', occurred_on: '2026-11-05' },
  { amount_ars: 470000, currency: 'ARS', kind: 'income', occurred_on: '2026-11-01' },
  { amount_ars: '50', currency: 'USD', kind: 'expense', occurred_on: '2026-11-09' },
];

let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.localStorage.clear();
  db.row = {};
  db.updates = [];
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

// La tarjeta carga una vez por cuenta al montarse: cada escenario nuevo se monta de cero.
async function remount() {
  await act(async () => root.unmount());
  root = createRoot(node);
}

const buttonByText =(text: string) => [...node.querySelectorAll('button')].find((b) => b.textContent === text);

describe('NOTIF-02 · tarjeta de cierre del mes', () => {
  async function render(opts: Parameters<typeof fakeClient>[0] = { transactions: happy, budget: 400000 }, now = DEC_2) {
    const api = fakeClient(opts);
    const onViewMonth = vi.fn();
    await act(async () => {
      root.render(h(MonthCloseCard, { userId: 'u1', onViewMonth, client: api.client, now }));
    });
    return { onViewMonth, calls: api.calls };
  }

  it('muestra el cierre por moneda con comparación y presupuesto', async () => {
    await render();
    const card = node.querySelector('section[aria-label="Cierre del mes"]');
    expect(card).not.toBeNull();
    const text = card!.textContent ?? '';
    expect(text).toContain('Cerraste noviembre');
    expect(text).toContain('Pesos');
    expect(text).toContain('Dólares');
    expect(text).toContain('Gastos');
    expect(text).toContain('Ingresos');
    expect(text).toContain('Balance');
    expect(text).toContain(formatMoney(350000, 'ARS'));
    expect(text).toContain(formatMoney(470000, 'ARS'));
    expect(text).toContain(formatMoney(120000, 'ARS'));
    expect(text).toContain(formatMoney(50, 'USD'));
    expect(text).toContain('▲ 250% vs oct.');
    expect(text).toContain(`Te sobraron ${formatMoney(50000, 'ARS')} del presupuesto`);
    // Las monedas nunca se suman: no aparece un total combinado.
    expect(text).not.toContain(formatMoney(350050, 'ARS'));
  });

  it('presupuesto excedido dice "Te pasaste"; sin presupuesto no hay línea', async () => {
    await render({ transactions: happy, budget: 300000 });
    expect(node.textContent).toContain(`Te pasaste ${formatMoney(50000, 'ARS')} del presupuesto`);
    expect(node.textContent).not.toContain('Te sobraron');

    await remount();
    await render({ transactions: happy, budget: null });
    expect(node.querySelector('section[aria-label="Cierre del mes"]')).not.toBeNull();
    expect(node.textContent).not.toContain('presupuesto');
  });

  it('una baja de gastos se muestra con ▼', async () => {
    await render({
      transactions: [
        { amount_ars: 100000, currency: 'ARS', kind: 'expense', occurred_on: '2026-10-10' },
        { amount_ars: 92000, currency: 'ARS', kind: 'expense', occurred_on: '2026-11-10' },
      ],
    });
    expect(node.textContent).toContain('▼ 8% vs oct.');
    expect(node.textContent).not.toContain('Dólares');
  });

  it('"Ver noviembre" lleva al mes; "Cerrar" la oculta para ese mes y no vuelve al montar', async () => {
    const { onViewMonth } = await render();
    await act(async () => buttonByText('Ver noviembre')!.click());
    expect(onViewMonth).toHaveBeenCalledWith('2026-11');

    await act(async () => buttonByText('Cerrar')!.click());
    expect(node.querySelector('section[aria-label="Cierre del mes"]')).toBeNull();
    expect(isMonthCloseDismissed('u1', '2026-11')).toBe(true);

    await remount();
    const again = await render();
    expect(node.querySelector('section[aria-label="Cierre del mes"]')).toBeNull();
    expect(again.calls).toEqual([]);
  });

  it('fuera de la primera semana o sin datos no renderiza nada', async () => {
    const late = await render(undefined, DEC_8);
    expect(node.innerHTML).toBe('');
    expect(late.calls).toEqual([]);

    await remount();
    await render({ settings: { data: { monthly_summary_enabled: false }, error: null }, transactions: happy });
    expect(node.innerHTML).toBe('');

    await remount();
    await render({ settings: { data: null, error: { code: '42703' } }, transactions: happy });
    expect(node.innerHTML).toBe('');
  });
});

describe('NOTIF-02 · interruptor en Ajustes', () => {
  const profile: UserProfile = { id: 'account-a', email: 'ficticia@example.test', first_name: 'Ana', last_name: 'Prueba', role: 'client', subscription_status: 'active', subscription_until: null, phone_number: null };
  function Harness() {
    const nameDraft = useProfileDraft(profile.id, profile);
    return h(Settings, { userId: profile.id, userProfile: profile, nameDraft, onBack: () => undefined });
  }
  async function renderSettings() {
    await act(async () => root.render(h(Harness)));
  }
  const summarySwitch = () => node.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Resumen del mes"]');
  const remindersSwitch = () => node.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Recordatorios para registrar movimientos"]');

  it('muestra el interruptor activo y al tocarlo guarda el apagado', async () => {
    db.row = { whatsapp_responses_enabled: true, client_reminders_enabled: true, monthly_summary_enabled: true };
    await renderSettings();
    expect(summarySwitch()?.getAttribute('aria-checked')).toBe('true');
    expect(node.textContent).toContain('El día 1 te avisamos que tu resumen del mes anterior está listo y lo ves arriba del Resumen durante la primera semana.');

    await act(async () => summarySwitch()!.click());
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({ monthly_summary_enabled: false });
    expect(typeof db.updates[0].updated_at).toBe('string');
    expect(summarySwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(node.textContent).toContain('Resumen del mes desactivado.');
  });

  it('sin la columna (051 sin aplicar) no aparece; el de recordatorios sigue igual', async () => {
    db.row = { whatsapp_responses_enabled: true, client_reminders_enabled: true };
    await renderSettings();
    expect(summarySwitch()).toBeNull();
    expect(remindersSwitch()?.getAttribute('aria-checked')).toBe('true');
  });

  it('con solo la columna nueva el grupo Avisos se muestra sin el de recordatorios', async () => {
    db.row = { whatsapp_responses_enabled: true, monthly_summary_enabled: false };
    await renderSettings();
    expect(summarySwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(remindersSwitch()).toBeNull();
  });
});
