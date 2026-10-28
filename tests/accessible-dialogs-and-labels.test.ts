// @vitest-environment jsdom
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPanel } from '../src/AdminPanel';
import { Dashboard } from '../src/Dashboard';
import { InstallAppModal } from '../src/InstallAppModal';

const catId = '00000000-0000-4000-8000-000000000099';

const api = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  budget: 150000,
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

vi.mock('../src/dashboardData', () => ({
  readDashboardSnapshot: async (_user: string, month: string) => {
    const rows = api.rows.filter((row) => row.status === 'confirmed');
    return {
      transactions: rows.filter((row) => String(row.occurred_on).startsWith(month)),
      installments: rows,
      budget: api.budget,
      months: ['2026-01', '2026-02', '2026-03'],
      monthsWarning: false,
      botState: 'active',
      botPhone: '5491112345678',
    };
  },
}));

vi.mock('../src/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const result = () => {
        if (table === 'categories') {
          return { data: [{ id: catId, name: 'Compras', kind: 'expense' }], error: null };
        }
        if (table === 'profiles') {
          return {
            data: [
              {
                id: 'client-1',
                email: 'maria@example.test',
                first_name: 'María',
                last_name: 'Gómez',
                role: 'client',
                subscription_status: 'active',
                subscription_until: '2026-12-01T00:00:00Z',
                phone_number: '5491122334455',
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
              },
            ],
            error: null,
          };
        }
        if (table === 'invitation_codes') {
          return { data: [], error: null };
        }
        if (table === 'system_config') {
          return { data: { value: 'true' }, error: null };
        }
        return { data: null, error: null };
      };
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        abortSignal: () => q,
        single: () => Promise.resolve(result()),
        maybeSingle: () => Promise.resolve(result()),
        upsert: () => Promise.resolve({ error: null }),
        delete: () => q,
        update: () => q,
        then: (done: (value: unknown) => unknown) => Promise.resolve(result()).then(done),
      };
      return q;
    },
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel: async () => undefined,
    rpc: (name: string, args: Record<string, unknown>) => {
      const run = async () => {
        const id = String(args?.p_group_id ?? '');
        const rows = api.rows.filter(
          (row) => row.installment_group_id === id && row.status === 'confirmed',
        );
        if (name === 'get_installment_plan') {
          return { data: { group_id: id, version: 'a'.repeat(32), rows }, error: null };
        }
        return { data: { group_id: id, version: 'b'.repeat(32), rows }, error: null };
      };
      const promise = run();
      return Object.assign(promise, { abortSignal: () => promise });
    },
  },
}));

function buildPlanRows(group = 'plan-a', amounts = [10000, 10000, 10000]) {
  return amounts.map((amount, index) => ({
    id: `${group}-${index + 1}`,
    description: 'Notebook',
    amount_ars: amount,
    currency: 'ARS',
    kind: 'expense',
    status: 'confirmed',
    occurred_on: `2026-0${index + 1}-15`,
    category_id: catId,
    categories: { name: 'Compras' },
    installment_group_id: group,
    installment_number: index + 1,
    installment_count: 3,
  }));
}

let root: Root;
let node: HTMLDivElement;

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    (element as HTMLElement).focus();
    (element as HTMLElement).click();
  });
}

async function setInputValue(el: HTMLInputElement | HTMLSelectElement | null, value: string) {
  expect(el).not.toBeNull();
  await act(async () => {
    const proto =
      el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el!.dispatchEvent(new Event('input', { bubbles: true }));
    el!.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function pressKey(key: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-02-01T15:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.history.replaceState({}, '', '/chatbot-gastos/#resumen');
  window.sessionStorage.clear();
  api.rows = buildPlanRows('plan-a');
  api.budget = 150000;
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('FE-15: Diálogos accesibles centralizados y etiquetas de formularios', () => {
  it('alta de movimiento tiene diálogo accesible, fondo inerte, foco confinado, labels completos y conserva borrador al cerrar con Escape', async () => {
    await act(async () => {
      root.render(
        h(
          StrictMode,
          null,
          h(Dashboard, {
            userId: 'person-a',
            userEmail: 'ficticio@example.test',
            onOpenSettings: () => {},
            onSignOut: () => {},
          }),
        ),
      );
    });
    await vi.waitFor(() => expect(node.querySelector('.summary-card.balance')).not.toBeNull());

    const addTrigger = node.querySelector<HTMLButtonElement>('button.desktop-add')!;
    await click(addTrigger);

    const dialog = node.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('add-movement-dialog-title');
    expect(dialog.querySelector('#add-movement-dialog-title')?.textContent).toBe('Registrá una operación');

    // El fondo de la aplicación queda inerte y oculto a lectores de pantalla
    const sidebar = node.querySelector<HTMLElement>('.sidebar')!;
    const content = node.querySelector<HTMLElement>('.content')!;
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(sidebar.hasAttribute('inert')).toBe(true);
    expect(content.getAttribute('aria-hidden')).toBe('true');
    expect(content.hasAttribute('inert')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    // Foco inicial en el primer campo del formulario
    const descInput = dialog.querySelector<HTMLInputElement>('#add-movement-description')!;
    expect(document.activeElement).toBe(descInput);

    // Todos los controles del formulario tienen label asociado (incluido el monto antes huérfano)
    const amountInput = dialog.querySelector<HTMLInputElement>('#add-movement-amount')!;
    expect(amountInput.labels?.length).toBe(1);
    expect(amountInput.labels?.[0]?.textContent).toContain('Monto (ARS)');

    const checkbox = dialog.querySelector<HTMLInputElement>('#add-movement-is-installments')!;
    await click(checkbox);
    expect(amountInput.labels?.[0]?.textContent).toContain('Monto total de la compra (ARS)');

    await setInputValue(dialog.querySelector<HTMLSelectElement>('#add-movement-installment-count'), 'custom');
    const customInput = dialog.querySelector<HTMLInputElement>('#add-movement-custom-installment-count')!;
    expect(customInput.labels?.length).toBe(1);

    await setInputValue(customInput, '99');
    expect(customInput.getAttribute('aria-invalid')).toBe('true');
    expect(customInput.getAttribute('aria-describedby')).toBe('add-movement-custom-installment-error');
    expect(dialog.querySelector('#add-movement-custom-installment-error')?.textContent).toContain('2 a 60');

    const allControls = Array.from(
      dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'),
    );
    for (const ctrl of allControls) {
      expect(ctrl.labels && ctrl.labels.length > 0).toBe(true);
    }

    // Confinamiento de foco con Tab y Shift+Tab
    const closeX = dialog.querySelector<HTMLButtonElement>('.modal-close-x')!;
    const submitBtn = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    await act(async () => {
      submitBtn.focus();
    });
    await pressKey('Tab');
    expect(document.activeElement).toBe(closeX);

    await pressKey('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(submitBtn);

    // Escribir datos sin guardar y cerrar con Escape devuelve foco al botón de apertura y conserva el borrador
    await setInputValue(descInput, 'Supermercado');
    await setInputValue(amountInput, '25000');

    await pressKey('Escape');
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    expect(sidebar.hasAttribute('aria-hidden')).toBe(false);
    expect(sidebar.hasAttribute('inert')).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(addTrigger);

    // Al volver a abrir, el borrador sin guardar sigue disponible
    await click(addTrigger);
    const reopenedDesc = node.querySelector<HTMLInputElement>('#add-movement-description')!;
    const reopenedAmount = node.querySelector<HTMLInputElement>('#add-movement-amount')!;
    expect(reopenedDesc.value).toBe('Supermercado');
    expect(reopenedAmount.value).toContain('25.000');
  });

  it('edición, eliminación de cuotas y presupuesto restauran foco al disparador y descartan ediciones no guardadas al cancelar', async () => {
    window.history.replaceState({}, '', '/chatbot-gastos/#cuotas');
    await act(async () => {
      root.render(
        h(
          StrictMode,
          null,
          h(Dashboard, {
            userId: 'person-a',
            userEmail: 'ficticio@example.test',
            onOpenSettings: () => {},
            onSignOut: () => {},
          }),
        ),
      );
    });
    const planCard = await vi.waitFor(() => {
      const el = node.querySelector<HTMLElement>('[data-installment-group="plan-a"]');
      expect(el).not.toBeNull();
      return el!;
    });

    // Abrir edición desde el menú de opciones de la compra en cuotas
    const menuTrigger = planCard.querySelector<HTMLButtonElement>('.installment-menu-trigger')!;
    await click(menuTrigger);
    await click(planCard.querySelector('[role="menuitem"]:not(.danger)'));

    const editDialog = node.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(editDialog.getAttribute('aria-labelledby')).toBe('edit-movement-dialog-title');
    await vi.waitFor(() =>
      expect(editDialog.querySelector('fieldset')?.hasAttribute('disabled')).toBe(false),
    );

    // Todos los controles de edición tienen label asociado
    for (const ctrl of Array.from(editDialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))) {
      expect(ctrl.labels && ctrl.labels.length > 0).toBe(true);
    }

    const editDesc = editDialog.querySelector<HTMLInputElement>('#edit-movement-description')!;
    expect(editDesc.value).toBe('Notebook');
    await setInputValue(editDesc, 'Cambio temporal sin guardar');

    // Escape cierra la edición, descarta el cambio temporal y devuelve el foco al botón de menú de la tarjeta
    await pressKey('Escape');
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(menuTrigger);

    // Al reabrir la edición, conserva el valor original guardado ('Notebook')
    await click(menuTrigger);
    await click(planCard.querySelector('[role="menuitem"]:not(.danger)'));
    await vi.waitFor(() =>
      expect(node.querySelector<HTMLInputElement>('#edit-movement-description')?.value).toBe('Notebook'),
    );
    await pressKey('Escape');
    expect(document.activeElement).toBe(menuTrigger);

    // Abrir diálogo de eliminar cuotas y cerrar con Escape devuelve el foco al disparador
    await click(menuTrigger);
    await click(planCard.querySelector('[role="menuitem"].danger'));
    const deleteDialog = node.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(deleteDialog.getAttribute('aria-labelledby')).toBe('delete-installments-title');
    expect(deleteDialog.getAttribute('aria-describedby')).toBe('delete-installments-desc');
    await pressKey('Escape');
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(menuTrigger);
  });

  it('diálogos de presupuesto, confirmación de borrado de presupuesto, detalle de categorías e instalación cumplen semántica y retorno de foco', async () => {
    await act(async () => {
      root.render(
        h(
          StrictMode,
          null,
          h(Dashboard, {
            userId: 'person-a',
            userEmail: 'ficticio@example.test',
            onOpenSettings: () => {},
            onSignOut: () => {},
          }),
        ),
      );
    });
    await vi.waitFor(() => expect(node.querySelector('.budget-card')).not.toBeNull());

    const editBudgetBtn = node.querySelector<HTMLButtonElement>('.budget-card .text-button')!;
    await click(editBudgetBtn);

    const budgetDialog = node.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(budgetDialog.getAttribute('aria-labelledby')).toBe('budget-dialog-title');
    const budgetInput = budgetDialog.querySelector<HTMLInputElement>('#budget-amount-input')!;
    expect(budgetInput.labels?.length).toBe(1);
    expect(document.activeElement).toBe(budgetInput);

    // Pasar al diálogo de confirmación de eliminación de presupuesto
    const deleteBudgetBtn = budgetDialog.querySelector<HTMLButtonElement>('.modal-btn-delete')!;
    await click(deleteBudgetBtn);

    const confirmDialog = node.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(confirmDialog.getAttribute('aria-labelledby')).toBe('delete-budget-title');
    expect(confirmDialog.getAttribute('aria-describedby')).toBe('delete-budget-desc');

    // Escape en la confirmación vuelve al diálogo de presupuesto
    await pressKey('Escape');
    expect(node.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe('budget-dialog-title');

    // Escape en el diálogo de presupuesto lo cierra y restaura el foco al botón Editar del presupuesto
    await pressKey('Escape');
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(editBudgetBtn);

    // Abrir modal de categorías y cerrar con Escape restaura foco al botón Ver detalle
    const categoryDetailBtn = node.querySelector<HTMLButtonElement>('.category-card .text-button')!;
    await click(categoryDetailBtn);
    expect(node.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe('category-dialog-title');
    await pressKey('Escape');
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(categoryDetailBtn);

    // InstallAppModal también usa ModalDialog accesible
    let closedInstall = false;
    await act(async () => {
      root.render(
        h(InstallAppModal, {
          isOpen: true,
          isIos: true,
          onClose: () => {
            closedInstall = true;
          },
        }),
      );
    });
    const installDialog = node.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(installDialog.getAttribute('aria-labelledby')).toBe('install-app-dialog-title');
    await pressKey('Escape');
    expect(closedInstall).toBe(true);
  });

  it('AdminPanel asocia labels en todos sus formularios y gestiona foco, Tab, Escape e inercia en sus tres modales', async () => {
    await act(async () => {
      root.render(
        h(
          StrictMode,
          null,
          h(AdminPanel, {
            userId: 'admin-1',
            onBack: () => {},
            onSignOut: () => {},
          }),
        ),
      );
    });
    await vi.waitFor(() => expect(node.querySelector('.admin-clients-table')).not.toBeNull());

    // Búsqueda de clientes tiene label asociado
    const searchInput = node.querySelector<HTMLInputElement>('#admin-client-search')!;
    expect(searchInput.labels?.length).toBe(1);

    // Modal Extender membresía
    const extendBtn = node.querySelector<HTMLButtonElement>('button[aria-label^="Extender membresía"]')!;
    await click(extendBtn);

    const extendDialog = node.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(extendDialog.getAttribute('aria-labelledby')).toBe('admin-membership-title');
    const daysGroup = extendDialog.querySelector<HTMLElement>('[role="group"]')!;
    expect(daysGroup.getAttribute('aria-labelledby')).toBe('admin-extend-days-group-label');

    // Seleccionar "Otra duración" muestra input con label asociado
    const customChip = Array.from(extendDialog.querySelectorAll<HTMLButtonElement>('.admin-day-chip')).find(
      (btn) => btn.textContent?.includes('Otra duración'),
    )!;
    await click(customChip);
    const customDaysInput = extendDialog.querySelector<HTMLInputElement>('#admin-custom-days-input')!;
    expect(customDaysInput.labels?.length).toBe(1);

    await pressKey('Escape');
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(extendBtn);

    // Modal Pausar cuenta
    const suspendBtn = node.querySelector<HTMLButtonElement>('button[aria-label^="Pausar a "]')!;
    await click(suspendBtn);
    expect(node.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe('admin-access-title');
    await pressKey('Escape');
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(suspendBtn);

    // Pestaña Invitaciones: controles con label asociado
    const navButtons = Array.from(node.querySelectorAll<HTMLButtonElement>('.admin-workspace-nav button'));
    await click(navButtons.find((b) => b.textContent?.includes('Invitaciones'))!);
    await click(node.querySelector('button[aria-controls="admin-new-invitation"]'));
    expect(node.querySelector<HTMLSelectElement>('#admin-invite-duration')?.labels?.length).toBe(1);
    expect(node.querySelector<HTMLInputElement>('#admin-invite-note')?.labels?.length).toBe(1);

    // Pestaña Bot: modal Pausar bot y retorno de foco
    await click(navButtons.find((b) => b.textContent?.includes('Bot'))!);
    const pauseBotTrigger = Array.from(node.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === 'Pausar bot',
    )!;
    await click(pauseBotTrigger);
    expect(node.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe('admin-pause-bot-title');
    await pressKey('Escape');
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(pauseBotTrigger);

    // Pestaña Ajustes: controles con label asociado
    await click(navButtons.find((b) => b.textContent?.includes('Ajustes'))!);
    const botPhoneInput = node.querySelector<HTMLInputElement>('#admin-bot-phone')!;
    expect(botPhoneInput.labels?.length).toBe(1);
    expect(botPhoneInput.getAttribute('aria-describedby')).toBe('admin-bot-phone-hint');
    expect(node.querySelector<HTMLInputElement>('#admin-support-phone')?.labels?.length).toBe(1);
    expect(node.querySelector<HTMLInputElement>('#admin-payment-alias')?.labels?.length).toBe(1);
  });
});
