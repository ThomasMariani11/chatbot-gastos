// FE-25: notificaciones push en este dispositivo (permiso, suscripción y baja).
import { supabase } from './supabase';
import type { resolveEnvironment } from './environment';

declare const __APP_CONFIG__: ReturnType<typeof resolveEnvironment>;

export type PushState =
  | 'unsupported' // el navegador no admite push (o falta configuración)
  | 'needs-install' // iPhone/iPad: solo funciona con la app instalada
  | 'denied' // el permiso fue bloqueado
  | 'off'
  | 'on';

type PushEnvironment = {
  window: Window & typeof globalThis;
  navigator: Navigator;
  vapidPublicKey: string;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
};

function defaultEnvironment(): PushEnvironment {
  return {
    window,
    navigator,
    vapidPublicKey: typeof __APP_CONFIG__ !== 'undefined' ? __APP_CONFIG__.vapidPublicKey ?? '' : '',
    rpc: (name, args) => supabase.rpc(name, args),
  };
}

function isIos(nav: Navigator): boolean {
  return /iPhone|iPad|iPod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

function isStandalone(win: Window): boolean {
  return win.matchMedia?.('(display-mode: standalone)').matches === true
    || (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function supported(env: PushEnvironment): boolean {
  return Boolean(env.vapidPublicKey) && 'serviceWorker' in env.navigator
    && 'PushManager' in env.window && 'Notification' in env.window;
}

async function registration(env: PushEnvironment): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await env.navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

export async function getPushState(env: PushEnvironment = defaultEnvironment()): Promise<PushState> {
  if (!supported(env)) return isIos(env.navigator) && !isStandalone(env.window) && env.vapidPublicKey ? 'needs-install' : 'unsupported';
  if (env.window.Notification.permission === 'denied') return 'denied';
  const reg = await registration(env);
  if (!reg) return 'unsupported';
  const subscription = await reg.pushManager.getSubscription();
  return subscription && env.window.Notification.permission === 'granted' ? 'on' : 'off';
}

function applicationServerKey(key: string): Uint8Array<ArrayBuffer> {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4);
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Pide permiso, suscribe este dispositivo y lo guarda en la cuenta. */
export async function enablePush(env: PushEnvironment = defaultEnvironment()): Promise<PushState> {
  if (!supported(env)) return getPushState(env);
  const permission = await env.window.Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration(env);
  if (!reg) return 'unsupported';
  const subscription = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(env.vapidPublicKey) });
  const json = subscription.toJSON();
  const { error } = await env.rpc('save_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
  });
  if (error) {
    await subscription.unsubscribe().catch(() => undefined);
    throw new Error('PUSH_SAVE_FAILED');
  }
  return 'on';
}

/** Quita la suscripción de este dispositivo. */
export async function disablePush(env: PushEnvironment = defaultEnvironment()): Promise<PushState> {
  const reg = await registration(env);
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription) {
    const { error } = await env.rpc('delete_push_subscription', { p_endpoint: subscription.endpoint });
    if (error) throw new Error('PUSH_DELETE_FAILED');
    await subscription.unsubscribe();
  }
  return 'off';
}
