// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// SEC-07: el cierre de sesión es global; los otros dispositivos de la cuenta quedan
// deslogueados por onAuthStateChange sin pasar por el botón. Al recibir SIGNED_OUT,
// la PWA desuscribe el navegador de ese dispositivo. Datos ficticios.
const mocks = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: unknown) => void),
  unsubscribeBrowserPush: vi.fn(async () => undefined),
}));

vi.mock('../src/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        mocks.listener = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signOut: vi.fn(),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock('../src/pushNotifications', () => ({
  signOutDevice: vi.fn(),
  unsubscribeBrowserPush: mocks.unsubscribeBrowserPush,
}));

import { App } from '../src/App';

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(() => { vi.unstubAllGlobals(); });

it('al recibir SIGNED_OUT desuscribe el navegador; otros eventos no', async () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(h(App)));
  expect(mocks.listener).not.toBeNull();
  await act(async () => mocks.listener!('TOKEN_REFRESHED', null));
  expect(mocks.unsubscribeBrowserPush).not.toHaveBeenCalled();
  await act(async () => mocks.listener!('SIGNED_OUT', null));
  expect(mocks.unsubscribeBrowserPush).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});
