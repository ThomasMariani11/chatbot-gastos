// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PushNotificationsRow } from '../src/PushNotificationsRow';
import { disablePush, enablePush, getPushState, releasePushOnSignOut, signOutDevice, unsubscribeBrowserPush } from '../src/pushNotifications';

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

describe('SEC-07 · baja de notificaciones al cerrar sesión', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('borra la suscripción en la cuenta y desuscribe el navegador', async () => {
    const t = environment({ permission: 'granted', subscribed: true });
    await releasePushOnSignOut(t.env);
    expect(t.rpc).toHaveBeenCalledWith('delete_push_subscription', { p_endpoint: 'https://push.example.test/1' });
    expect(t.subscription.unsubscribe).toHaveBeenCalled();
  });

  it('si la cuenta no responde con éxito, igual desuscribe el navegador y no lanza', async () => {
    const t = environment({ permission: 'granted', subscribed: true, rpcError: true });
    await expect(releasePushOnSignOut(t.env)).resolves.toBeUndefined();
    expect(t.subscription.unsubscribe).toHaveBeenCalled();
  });

  it('sin conexión no traba: resuelve al vencer el tope y el navegador quedó desuscripto', async () => {
    vi.useFakeTimers();
    const t = environment({ permission: 'granted', subscribed: true });
    t.rpc.mockImplementation(() => new Promise(() => {}));
    let done = false;
    const pending = releasePushOnSignOut(t.env, 50).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(60);
    await pending;
    expect(done).toBe(true);
    expect(t.subscription.unsubscribe).toHaveBeenCalled();
  });

  it('sin suscripción no llama a la cuenta; sin service worker resuelve igual', async () => {
    const t = environment();
    await releasePushOnSignOut(t.env);
    expect(t.rpc).not.toHaveBeenCalled();
    const noWorker = { ...t.env, navigator: {} as Navigator };
    await expect(releasePushOnSignOut(noWorker)).resolves.toBeUndefined();
  });

  it('sesión cerrada desde otro dispositivo: desuscribe solo el navegador, sin llamar a la cuenta', async () => {
    const t = environment({ permission: 'granted', subscribed: true });
    await unsubscribeBrowserPush(t.env);
    expect(t.subscription.unsubscribe).toHaveBeenCalled();
    expect(t.rpc).not.toHaveBeenCalled();
    const broken = environment({ permission: 'granted', subscribed: true });
    broken.pushManager.getSubscription.mockRejectedValue(new Error('roto'));
    await expect(unsubscribeBrowserPush(broken.env)).resolves.toBeUndefined();
  });

  it('cierra la sesión después de la baja, y la cierra aunque la baja falle', async () => {
    const order: string[] = [];
    const t = environment({ permission: 'granted', subscribed: true });
    t.subscription.unsubscribe.mockImplementation(async () => { order.push('baja'); return true; });
    await signOutDevice(async () => { order.push('signOut'); }, t.env);
    expect(order).toEqual(['baja', 'signOut']);

    const broken = environment({ permission: 'granted', subscribed: true });
    broken.pushManager.getSubscription.mockRejectedValue(new Error('roto'));
    const signOut = vi.fn(async () => undefined);
    await signOutDevice(signOut, broken.env);
    expect(signOut).toHaveBeenCalledTimes(1);
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
