// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../src/Dashboard';
import { ProfileDraft } from '../src/profileDraft';
import { Settings } from '../src/Settings';

const mockConfig = vi.hoisted(() => ({
  whatsapp_bot_phone: '+54 9 11 1234-5678',
  support_phone: '+54 (911) 9999-8888',
  payment_alias: 'pesito.mp',
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

vi.mock('../src/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let inKeys: string[] | null = null;
      let eqKey: string | null = null;
      const exec = () => {
        if (table === 'categories') {
          return {
            data: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Compras', kind: 'expense' }],
            error: null,
          };
        }
        if (table === 'transactions') {
          return { data: [], count: 0, error: null };
        }
        if (table === 'budgets') {
          return { data: null, error: null };
        }
        if (table === 'whatsapp_links') {
          return { data: { status: 'active', wa_id: '5491100001111' }, error: null };
        }
        if (table === 'app_settings') {
          return { data: { whatsapp_responses_enabled: true }, error: null };
        }
        if (table === 'system_config') {
          const map: Record<string, string> = {
            whatsapp_bot_phone: mockConfig.whatsapp_bot_phone,
            support_phone: mockConfig.support_phone,
            payment_alias: mockConfig.payment_alias,
          };
          if (inKeys) {
            return {
              data: inKeys
                .filter((k) => Boolean(map[k]))
                .map((k) => ({ key: k, value: map[k] })),
              error: null,
            };
          }
          if (eqKey) {
            return { data: map[eqKey] ? { value: map[eqKey] } : null, error: null };
          }
          return { data: [], error: null };
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
        gt: () => q,
        order: () => q,
        limit: () => q,
        abortSignal: () => q,
        maybeSingle: () => Promise.resolve(exec()),
        single: () => Promise.resolve(exec()),
        then: (done: (v: unknown) => unknown) => Promise.resolve(exec()).then(done),
      };
      return q;
    },
    channel: () => {
      const ch = {
        on: () => ch,
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: async () => undefined,
    rpc: () => {
      const p = Promise.resolve({ data: ['2026-10'], error: null });
      return Object.assign(p, { abortSignal: () => p });
    },
  },
}));

describe('FE-23: Símbolo de WhatsApp para soporte solo en Dashboard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    window.scrollTo = vi.fn();
    mockConfig.whatsapp_bot_phone = '+54 9 11 1234-5678';
    mockConfig.support_phone = '+54 (911) 9999-8888';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('muestra el símbolo de WhatsApp para soporte en el encabezado del Dashboard con el teléfono sanitizado', async () => {
    await act(async () => {
      root.render(
        h(Dashboard, {
          userId: 'user-support-1',
          userEmail: 'cliente@pesito.test',
          userProfile: {
            id: 'user-support-1',
            email: 'cliente@pesito.test',
            first_name: 'Ana',
            last_name: 'Gómez',
            role: 'client',
            subscription_status: 'active',
            subscription_until: '2026-12-31T00:00:00Z',
            phone_number: '5491100001111',
          },
          onOpenSettings: vi.fn(),
          onSignOut: vi.fn(),
        }),
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    const supportLink = container.querySelector<HTMLAnchorElement>('.top-actions a.support-whatsapp-btn');
    expect(supportLink).not.toBeNull();
    expect(supportLink?.getAttribute('aria-label')).toBe('Contactar a soporte por WhatsApp');
    expect(supportLink?.getAttribute('target')).toBe('_blank');
    expect(supportLink?.getAttribute('rel')).toContain('noopener');
    expect(supportLink?.href).toContain('https://wa.me/5491199998888?text=');
    expect(decodeURIComponent(supportLink?.href ?? '')).toContain('cliente@pesito.test');
    expect(supportLink?.querySelector('svg')).not.toBeNull();
  });

  it('usa whatsapp_bot_phone como fallback si support_phone está vacío y NO muestra el botón en Ajustes', async () => {
    mockConfig.support_phone = '';

    await act(async () => {
      root.render(
        h(Dashboard, {
          userId: 'user-support-fallback',
          userEmail: 'fallback@pesito.test',
          onOpenSettings: vi.fn(),
          onSignOut: vi.fn(),
        }),
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    const supportLink = container.querySelector<HTMLAnchorElement>('.top-actions a.support-whatsapp-btn');
    expect(supportLink).not.toBeNull();
    expect(supportLink?.href).toContain('https://wa.me/5491112345678?text=');

    const draft = new ProfileDraft('user-support-fallback', async () => ({ id: 'user-support-fallback' }));
    // Ahora renderizar Settings y comprobar que .support-whatsapp-btn NO existe en Ajustes
    await act(async () => {
      root.render(
        h(Settings, {
          userId: 'user-support-fallback',
          userEmail: 'fallback@pesito.test',
          userProfile: {
            id: 'user-support-fallback',
            email: 'fallback@pesito.test',
            first_name: 'Ana',
            last_name: 'Gómez',
            role: 'client',
            subscription_status: 'active',
            subscription_until: '2026-12-31T00:00:00Z',
            phone_number: '5491100001111',
          },
          nameDraft: { draft, state: draft.snapshot() },
          onBack: vi.fn(),
        }),
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(container.querySelector('.support-whatsapp-btn')).toBeNull();
    expect(container.querySelector('[aria-label="Contactar a soporte por WhatsApp"]')).toBeNull();
  });
});
