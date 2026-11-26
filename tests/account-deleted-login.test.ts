// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn(), auth: {} } }));
vi.mock('../src/PwaUpdates', () => ({ useUpdateBlocker: vi.fn() }));
import { Login } from '../src/Login';
import { ACCOUNT_DELETED_FLAG, ACCOUNT_DELETED_MESSAGE } from '../src/accountDeletedNotice';

// 3.2 (LEG-01): después de borrar la cuenta, el ingreso lo confirma una sola vez.
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); sessionStorage.clear(); window.history.replaceState(null, '', '/chatbot-gastos/'); });
afterEach(() => { vi.unstubAllGlobals(); });

async function mount() {
  const node = document.createElement('div');
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => root.render(h(Login)));
  return { node, unmount: async () => { await act(async () => root.unmount()); node.remove(); } };
}

it('muestra "Tu cuenta fue borrada" una vez y no la repite al volver', async () => {
  sessionStorage.setItem(ACCOUNT_DELETED_FLAG, '1');
  const first = await mount();
  expect(first.node.querySelector('[role="status"]')?.textContent).toBe(ACCOUNT_DELETED_MESSAGE);
  expect(sessionStorage.getItem(ACCOUNT_DELETED_FLAG)).toBeNull();
  await first.unmount();
  const second = await mount();
  expect(second.node.textContent).not.toContain(ACCOUNT_DELETED_MESSAGE);
  await second.unmount();
});
