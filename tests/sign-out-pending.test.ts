// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// SEC-07: mientras se dan de baja los avisos y se cierra la sesión (hasta unos
// segundos), la app muestra "Cerrando sesión…" y no deja tocar nada; así no se
// puede, por ejemplo, volver a activar las notificaciones a mitad del cierre.
// Datos ficticios; se usa la pantalla de error de perfil, que tiene "Cerrar sesión".
const mocks = vi.hoisted(() => ({
  finish: null as null | (() => void),
  signOutDevice: vi.fn(),
}));

vi.mock('../src/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 't', user: { id: 'u-ficticio' } } }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn(),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'x' } }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock('../src/pushNotifications', () => ({
  signOutDevice: mocks.signOutDevice,
  unsubscribeBrowserPush: vi.fn(async () => undefined),
}));

import { App } from '../src/App';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.signOutDevice.mockImplementation(() => new Promise<void>((resolve) => { mocks.finish = resolve; }));
});
afterEach(() => { vi.unstubAllGlobals(); });

it('muestra "Cerrando sesión…" y oculta la app hasta que termina el cierre', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(h(App)));
  const open = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Cerrar sesión')!;
  await act(async () => open.click());
  const confirm = container.querySelector('.danger-button') as HTMLButtonElement;
  await act(async () => confirm.click());

  expect(mocks.signOutDevice).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Cerrando sesión…');
  expect(container.querySelectorAll('button')).toHaveLength(0);

  await act(async () => mocks.finish!());
  expect(container.textContent).not.toContain('Cerrando sesión…');
  await act(async () => root.unmount());
  container.remove();
});
