// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PushNotificationsRow } from '../src/PushNotificationsRow';
import { disablePush, enablePush, getPushState } from '../src/pushNotifications';

vi.mock('../src/supabase', () => ({ supabase: {} }));

const KEY = 'B' + 'a'.repeat(86);

function environment(options: { permission?: NotificationPermission; subscribed?: boolean; ios?: boolean; standalone?: boolean; push?: boolean; rpcError?: boolean } = {}) {
  let subscribed = options.subscribed ?? false;
  const subscription = {
    endpoint: 'https://push.example.test/1',
    toJSON: () => ({ endpoint: 'https://push.example.test/1', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => { subscribed = false; return true; }),
  };
  const pushManager = {
    getSubscription: vi.fn(async () => (subscribed ? subscription : null)),
    subscribe: vi.fn(async () => { subscribed = true; return subscription; }),
  };
  const notification = { permission: options.permission ?? 'default', requestPermission: vi.fn(async () => 'granted' as NotificationPermission) };
  const win = {
    Notification: notification,
    matchMedia: () => ({ matches: options.standalone ?? false }),
    navigator: { standalone: options.standalone ?? false },
    ...(options.push === false ? {} : { PushManager: function PushManager() {} }),
  } as unknown as Window & typeof globalThis;
  const nav = {
    userAgent: options.ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' : 'Mozilla/5.0 (Linux; Android 14)',
    platform: options.ios ? 'iPhone' : 'Linux',
    maxTouchPoints: 5,
    serviceWorker: { getRegistration: vi.fn(async () => ({ pushManager })) },
  } as unknown as Navigator;
  const rpc = vi.fn(async () => ({ error: options.rpcError ? { message: 'x' } : null }));
  return { env: { window: win, navigator: nav, vapidPublicKey: KEY, rpc }, rpc, pushManager, notification, subscription };
}

describe('FE-25 · suscripción push', () => {
  it('detecta iPhone sin instalar, falta de soporte y permiso bloqueado', async () => {
    expect(await getPushState(environment({ ios: true, push: false }).env)).toBe('needs-install');
    expect(await getPushState(environment({ push: false }).env)).toBe('unsupported');
    expect(await getPushState({ ...environment().env, vapidPublicKey: '' })).toBe('unsupported');
    expect(await getPushState(environment({ permission: 'denied' }).env)).toBe('denied');
    expect(await getPushState(environment({ permission: 'granted', subscribed: true }).env)).toBe('on');
    expect(await getPushState(environment().env)).toBe('off');
  });

  it('activar pide permiso, suscribe y guarda; desactivar borra y desuscribe', async () => {
    const t = environment();
    expect(await enablePush(t.env)).toBe('on');
    expect(t.notification.requestPermission).toHaveBeenCalled();
    expect(t.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(t.rpc).toHaveBeenCalledWith('save_push_subscription', { p_endpoint: 'https://push.example.test/1', p_p256dh: 'p', p_auth: 'a' });
    expect(await disablePush(t.env)).toBe('off');
    expect(t.rpc).toHaveBeenLastCalledWith('delete_push_subscription', { p_endpoint: 'https://push.example.test/1' });
    expect(t.subscription.unsubscribe).toHaveBeenCalled();
  });

  it('si no se puede guardar en la cuenta, deshace la suscripción del navegador', async () => {
    const t = environment({ rpcError: true });
    await expect(enablePush(t.env)).rejects.toThrow('PUSH_SAVE_FAILED');
    expect(t.subscription.unsubscribe).toHaveBeenCalled();
  });
});

describe('FE-25 · fila de Ajustes', () => {
  let root: Root;
  let node: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    node = document.createElement('div');
    document.body.append(node);
    root = createRoot(node);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  });

  it('activa y desactiva con el interruptor', async () => {
    const enable = vi.fn(async () => 'on' as const), disable = vi.fn(async () => 'off' as const);
    const getState = async () => 'off' as const;
    await act(async () => root.render(h(PushNotificationsRow, { getState, enable, disable })));
    const sw = node.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await act(async () => sw.click());
    expect(enable).toHaveBeenCalled();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await act(async () => sw.click());
    expect(disable).toHaveBeenCalled();
  });

  it('en iPhone sin instalar explica cómo hacerlo y no muestra interruptor', async () => {
    const getState = async () => 'needs-install' as const;
    await act(async () => root.render(h(PushNotificationsRow, { getState })));
    expect(node.textContent).toContain('Agregar a inicio');
    expect(node.querySelector('[role="switch"]')).toBeNull();
  });

  it('muestra un error sin detalles técnicos si falla', async () => {
    const getState = async () => 'off' as const;
    const enable = vi.fn(async () => { throw new Error('PRIVATE_DETAIL'); });
    await act(async () => root.render(h(PushNotificationsRow, { getState, enable })));
    await act(async () => node.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(node.querySelector('[role="alert"]')?.textContent).toContain('No pudimos actualizar');
    expect(node.textContent).not.toContain('PRIVATE_DETAIL');
  });
});
