// @vitest-environment jsdom
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dismissNotice,
  isNoticeDismissed,
  loadReminderState,
  noticeDay,
  registrationReminder,
  subscriptionNotice,
} from '../src/clientNoticeRules';
import { ClientNotices } from '../src/ClientNotices';

vi.mock('../src/supabase', () => ({ supabase: {} }));

const NOW = Date.parse('2026-11-05T15:00:00-03:00');
const DAY = 86_400_000;
const client = (until: string | null, extra: Partial<{ role: string; subscription_status: string }> = {}) => ({
  role: 'client',
  subscription_status: 'active',
  subscription_until: until,
  ...extra,
});
const iso = (ms: number) => new Date(ms).toISOString();

describe('FE-25 · aviso de vencimiento', () => {
  it('avisa a 7 días o menos y marca urgente a 1 día o menos', () => {
    expect(subscriptionNotice(client(iso(NOW + 8 * DAY)), NOW)).toBeNull();
    expect(subscriptionNotice(client(iso(NOW + 7 * DAY)), NOW)).toMatchObject({ id: 'subscription-7', level: 'warning', daysLeft: 7 });
    expect(subscriptionNotice(client(iso(NOW + 2 * DAY)), NOW)).toMatchObject({ level: 'warning', daysLeft: 2 });
    expect(subscriptionNotice(client(iso(NOW + 1 * DAY)), NOW)).toMatchObject({ id: 'subscription-1', level: 'urgent', daysLeft: 1 });
    expect(subscriptionNotice(client(iso(NOW + 60_000)), NOW)).toMatchObject({ level: 'urgent', daysLeft: 1 });
  });

  it('no avisa a admin, sin vencimiento, vencidos, suspendidos ni fechas inválidas', () => {
    expect(subscriptionNotice(client(iso(NOW + DAY), { role: 'admin' }), NOW)).toBeNull();
    expect(subscriptionNotice(client(null), NOW)).toBeNull();
    expect(subscriptionNotice(client(iso(NOW - 1)), NOW)).toBeNull();
    expect(subscriptionNotice(client(iso(NOW + DAY), { subscription_status: 'suspended' }), NOW)).toBeNull();
    expect(subscriptionNotice(client('no-es-fecha'), NOW)).toBeNull();
    expect(subscriptionNotice(null, NOW)).toBeNull();
  });
});

describe('FE-25 · recordatorio de registro', () => {
  it('solo aparece con preferencia activa y 3 días o más sin movimientos confirmados', () => {
    expect(registrationReminder(true, iso(NOW - 2 * DAY), NOW)).toBeNull();
    expect(registrationReminder(true, iso(NOW - 3 * DAY), NOW)).toEqual({ id: 'registration', kind: 'stale', days: 3 });
    expect(registrationReminder(true, null, NOW)).toEqual({ id: 'registration', kind: 'never', days: 0 });
  });

  it('no afirma nada si la preferencia está apagada, es desconocida o la lectura falló', () => {
    expect(registrationReminder(false, iso(NOW - 10 * DAY), NOW)).toBeNull();
    expect(registrationReminder(null, iso(NOW - 10 * DAY), NOW)).toBeNull();
    expect(registrationReminder(true, undefined, NOW)).toBeNull();
  });
});

type Result = { data: unknown; error: unknown };
function fakeClient(settings: Result, latest: Result) {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(table);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => settings,
            eq: () => ({ order: () => ({ limit: async () => latest }) }),
          }),
        }),
      };
    },
  };
}

describe('FE-25 · lectura de preferencia y último movimiento', () => {
  it('sin migración 045 (columna ausente) no consulta movimientos ni muestra recordatorio', async () => {
    const api = fakeClient({ data: null, error: { code: '42703' } }, { data: [], error: null });
    expect(await loadReminderState(api, 'u1')).toEqual({ enabled: null, lastMovementAt: undefined });
    expect(api.calls).toEqual(['app_settings']);
  });

  it('con recordatorios apagados no consulta movimientos', async () => {
    const api = fakeClient({ data: { client_reminders_enabled: false }, error: null }, { data: [], error: null });
    expect(await loadReminderState(api, 'u1')).toEqual({ enabled: false, lastMovementAt: undefined });
    expect(api.calls).toEqual(['app_settings']);
  });

  it('con recordatorios activos devuelve el último movimiento, o null si no hay', async () => {
    const withRow = fakeClient({ data: { client_reminders_enabled: true }, error: null }, { data: [{ created_at: '2026-11-01T10:00:00Z' }], error: null });
    expect(await loadReminderState(withRow, 'u1')).toEqual({ enabled: true, lastMovementAt: '2026-11-01T10:00:00Z' });
    const empty = fakeClient({ data: { client_reminders_enabled: true }, error: null }, { data: [], error: null });
    expect(await loadReminderState(empty, 'u1')).toEqual({ enabled: true, lastMovementAt: null });
    const failed = fakeClient({ data: { client_reminders_enabled: true }, error: null }, { data: null, error: { message: 'x' } });
    expect(await loadReminderState(failed, 'u1')).toEqual({ enabled: true, lastMovementAt: undefined });
  });
});

describe('FE-25 · ocultar por hoy', () => {
  beforeEach(() => window.localStorage.clear());
  it('se oculta solo durante el día argentino en curso y por cuenta', () => {
    dismissNotice('u1', 'registration', NOW);
    expect(isNoticeDismissed('u1', 'registration', NOW)).toBe(true);
    expect(isNoticeDismissed('u2', 'registration', NOW)).toBe(false);
    expect(isNoticeDismissed('u1', 'registration', NOW + DAY)).toBe(false);
    expect(noticeDay(Date.parse('2026-11-05T23:30:00-03:00'))).toBe('2026-11-05');
  });
});

describe('FE-25 · componente en el resumen', () => {
  let root: Root;
  let node: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    window.localStorage.clear();
    node = document.createElement('div');
    document.body.append(node);
    root = createRoot(node);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  });

  async function render(props: Partial<Parameters<typeof ClientNotices>[0]> = {}) {
    const api = fakeClient({ data: { client_reminders_enabled: true }, error: null }, { data: [{ created_at: iso(NOW - 5 * DAY) }], error: null });
    const handlers = { onOpenSettings: vi.fn(), onAddMovement: vi.fn() };
    await act(async () => {
      root.render(h(ClientNotices, {
        userId: 'u1',
        profile: client(iso(NOW + 3 * DAY)),
        botPhone: '+54 9 11 0000-0000',
        botLinked: true,
        refreshKey: 0,
        client: api,
        now: () => NOW,
        ...handlers,
        ...props,
      }));
    });
    return handlers;
  }

  it('muestra vencimiento con RENOVAR al bot y el recordatorio de registro', async () => {
    const handlers = await render();
    expect(node.textContent).toContain('Tu membresía vence en 3 días');
    const renew = node.querySelector<HTMLAnchorElement>('a[href^="https://wa.me/"]');
    expect(renew?.href).toBe('https://wa.me/5491100000000?text=RENOVAR');
    expect(node.textContent).toContain('Hace 5 días que no registrás movimientos');
    const add = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Cargar movimiento');
    await act(async () => add!.click());
    expect(handlers.onAddMovement).toHaveBeenCalledTimes(1);
  });

  it('sin bot vinculado lleva a Ajustes en lugar de abrir WhatsApp', async () => {
    const handlers = await render({ botLinked: false });
    expect(node.querySelector('a[href^="https://wa.me/"]')).toBeNull();
    const button = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Ver cómo renovar');
    await act(async () => button!.click());
    expect(handlers.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('urgente a menos de 24 horas usa role=alert y se puede ocultar por hoy', async () => {
    await render({ profile: client(iso(NOW + 3_600_000)) });
    const alert = node.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('vence en menos de 24 horas');
    const hide = alert!.querySelector<HTMLButtonElement>('.text-button')!;
    await act(async () => hide.click());
    expect(node.querySelector('[role="alert"]')).toBeNull();
    expect(isNoticeDismissed('u1', 'subscription-1', NOW)).toBe(true);
  });

  it('no renderiza nada para admin sin recordatorio pendiente', async () => {
    const api = fakeClient({ data: { client_reminders_enabled: false }, error: null }, { data: [], error: null });
    await render({ profile: client(iso(NOW + DAY), { role: 'admin' }), client: api });
    expect(node.querySelector('.client-notices')).toBeNull();
  });
});

describe('FE-25 · migración 045', () => {
  it('agrega la preferencia activada por defecto y respeta la política de fila propia', async () => {
    const db = new PGlite();
    await db.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    `);
    const sql = (name: string) => readFile(join(process.cwd(), 'supabase', 'migrations', name), 'utf8');
    await db.exec((await sql('001_initial.sql')).replace('create extension if not exists pgcrypto;', ''));
    const a = '50000000-0000-4000-8000-000000000001', b = '50000000-0000-4000-8000-000000000002';
    // El trigger de alta de 001 crea la fila de app_settings: A existe antes de 045 y B después.
    await db.query('insert into auth.users(id) values($1)', [a]);
    await db.exec(await sql('045_client_reminder_preferences.sql'));
    await db.query('insert into auth.users(id) values($1)', [b]);
    const rows = await db.query<{ client_reminders_enabled: boolean }>('select client_reminders_enabled from public.app_settings order by user_id');
    expect(rows.rows.map((r) => r.client_reminders_enabled)).toEqual([true, true]);

    await db.exec('grant usage on schema public to authenticated; grant select, update on public.app_settings to authenticated;');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [a]);
    await db.exec('set role authenticated');
    await db.query('update public.app_settings set client_reminders_enabled = false');
    await db.exec('reset role');
    const after = await db.query<{ user_id: string; client_reminders_enabled: boolean }>('select user_id, client_reminders_enabled from public.app_settings order by user_id');
    expect(after.rows).toEqual([
      { user_id: a, client_reminders_enabled: false },
      { user_id: b, client_reminders_enabled: true },
    ]);
    await db.close();
  }, 60_000);
});
