import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// NOTIF-02: la migración 051 agrega el resumen de fin de mes a la bandeja de avisos push.
describe('Migración 051', { timeout: 60_000 }, () => {
  const db = new PGlite();
  const sql = (name: string) => readFile(join(process.cwd(), 'supabase', 'migrations', name), 'utf8');
  const id = (n: number) => `61000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const sub = (n: number) => ({ endpoint: `https://push.example.test/m${n}`, p256dh: 'B' + 'a'.repeat(86), auth: 'a'.repeat(22) });
  const FUNCTIONS = ['enqueue_client_notifications', 'claim_client_notifications', 'finish_client_notification'];

  async function asUser(uid: string, fn: () => Promise<unknown>) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
    await db.exec('set role authenticated');
    try { return await fn(); } finally { await db.exec('reset role'); }
  }
  const enqueue = async (at: string) => (await db.query<{ n: number }>('select public.enqueue_client_notifications($1) as n', [at])).rows[0].n;
  const monthly = async (uid?: string) => (await db.query<{ user_id: string; period_key: string }>(
    "select user_id, period_key from public.client_notifications where kind = 'monthly_summary' and ($1::uuid is null or user_id = $1) order by user_id, period_key", [uid ?? null],
  )).rows;
  async function addUser(n: number, email: string) {
    await db.query('insert into auth.users(id, email) values($1,$2)', [id(n), email]);
    await db.query("update public.profiles set created_at = '2026-10-01T00:00:00Z' where id = $1", [id(n)]);
  }
  async function addDevice(uid: string, n: number) {
    const s = sub(n);
    await asUser(uid, () => db.query('select public.save_push_subscription($1,$2,$3)', [s.endpoint, s.p256dh, s.auth]));
  }
  const addTx = (uid: string, occurredOn: string, status = 'confirmed') => db.query(
    "insert into public.transactions(user_id, kind, description, amount_ars, occurred_on, status, source, created_at) values ($1,'expense','Prueba',100,$2,$3,'pwa','2026-10-01T00:00:00Z')",
    [uid, occurredOn, status],
  );
  const privileges = async () => (await db.query<{ proname: string; proacl: string | null; prosecdef: boolean; proconfig: string[] | null; owner: string }>(
    `select p.proname, p.proacl::text as proacl, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1) order by p.proname`, [FUNCTIONS],
  )).rows;

  let before: Awaited<ReturnType<typeof privileges>>;

  beforeAll(async () => {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public to anon, authenticated, service_role;
      create schema cron; create table cron.job(jobname text, schedule text, command text);
      create function cron.schedule(text, text, text) returns bigint language plpgsql as $$ begin insert into cron.job values($1,$2,$3); return 1; end $$;
    `);
    await db.exec((await sql('001_initial.sql')).replace('create extension if not exists pgcrypto;', ''));
    await db.exec(await sql('005_admin_and_invitations.sql'));
    await db.exec(await sql('045_client_reminder_preferences.sql'));
    await db.exec(await sql('046_client_push_notifications.sql'));
    before = await privileges();
    await db.exec('grant select, insert, update on public.app_settings to authenticated');
    await db.exec(await sql('051_monthly_summary_notifications.sql'));
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it('encola el resumen solo el día 1 a las 10 u 11, del mes anterior y una vez', async () => {
    await addUser(1, 'u1@example.test');
    await addDevice(id(1), 1);
    await addTx(id(1), '2026-11-14');
    expect(await enqueue('2026-12-01T09:30:00-03:00')).toBe(0);
    expect(await monthly(id(1))).toEqual([]);
    expect(await enqueue('2026-12-01T10:07:00-03:00')).toBe(1);
    expect(await monthly(id(1))).toEqual([{ user_id: id(1), period_key: '2026-11' }]);
    expect(await enqueue('2026-12-01T11:30:00-03:00')).toBe(0);
    expect(await enqueue('2026-12-02T10:07:00-03:00')).toBe(0);
    expect(await monthly(id(1))).toHaveLength(1);
  });

  it('cambio de año: el resumen de enero corresponde a diciembre', async () => {
    await addUser(2, 'u2@example.test');
    await addDevice(id(2), 2);
    await addTx(id(2), '2026-12-20');
    expect(await enqueue('2027-01-01T10:07:00-03:00')).toBe(1);
    expect(await monthly(id(2))).toEqual([{ user_id: id(2), period_key: '2026-12' }]);
  });

  it('no encola sin movimientos del mes, sin dispositivo, vencidos, pausados ni con el interruptor apagado', async () => {
    // 10: sin movimientos en el mes anterior (solo uno del mes en curso y otro pendiente)
    // 11: sin dispositivo; 12: suscripción vencida; 13: pausado; 14: interruptor apagado; 15: control que sí recibe.
    for (let n = 10; n <= 15; n++) {
      await addUser(n, `u${n}@example.test`);
      if (n !== 11) await addDevice(id(n), n);
      if (n !== 10) await addTx(id(n), '2027-02-10');
    }
    await addTx(id(10), '2027-03-02');
    await addTx(id(10), '2027-02-12', 'pending');
    await db.query("update public.profiles set role = 'client', subscription_status = 'active', subscription_until = '2027-01-01T00:00:00Z' where id = any($1::uuid[])", [[id(10), id(11), id(12), id(13), id(14), id(15)]]);
    await db.query("update public.profiles set subscription_until = '2027-02-20T00:00:00Z' where id = $1", [id(12)]);
    await db.query("update public.profiles set subscription_until = '2027-12-31T00:00:00Z' where id = any($1::uuid[])", [[id(10), id(11), id(13), id(14), id(15)]]);
    await db.query("update public.profiles set subscription_status = 'suspended' where id = $1", [id(13)]);
    await db.query('update public.app_settings set monthly_summary_enabled = false where user_id = $1', [id(14)]);
    expect(await enqueue('2027-03-01T10:07:00-03:00')).toBe(1);
    expect(await monthly()).toEqual(expect.arrayContaining([{ user_id: id(15), period_key: '2027-02' }]));
    for (const n of [10, 11, 12, 13, 14]) expect(await monthly(id(n))).toEqual([]);
  });

  it('reclamar omite el resumen si se apagó el interruptor y devuelve period_key', async () => {
    await addUser(20, 'u20@example.test');
    await addUser(21, 'u21@example.test');
    for (const n of [20, 21]) { await addDevice(id(n), n); await addTx(id(n), '2027-07-15'); }
    expect(await enqueue('2027-08-01T10:07:00-03:00')).toBe(2);
    await db.query('update public.app_settings set monthly_summary_enabled = false where user_id = $1', [id(21)]);
    await db.exec('set role service_role');
    const claimed = (await db.query<{ r: Array<{ id: string; kind: string; days: number | null; period_key: string; subscriptions: unknown[] }> }>(
      "select public.claim_client_notifications('71000000-0000-4000-8000-000000000001', 100) as r",
    )).rows[0].r;
    await db.exec('reset role');
    const mine = claimed.filter((n) => n.kind === 'monthly_summary' && n.period_key === '2027-07');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ days: null, period_key: '2027-07' });
    expect(mine[0].subscriptions).toHaveLength(1);
    const states = (await db.query<{ user_id: string; state: string }>(
      "select user_id, state from public.client_notifications where kind = 'monthly_summary' and period_key = '2027-07' order by user_id",
    )).rows;
    expect(states).toEqual([{ user_id: id(20), state: 'sending' }, { user_id: id(21), state: 'skipped' }]);
  });

  it('los avisos de 046 siguen iguales', async () => {
    const user = id(30), other = id(31), admin = id(32);
    for (const [n, e] of [[30, 'u30'], [31, 'u31'], [32, 'u32']] as const) await addUser(n, `${e}@example.test`);
    await db.query("update public.profiles set role = 'admin' where id = $1", [admin]);
    const NOON = '2026-11-05T12:00:00-03:00';
    await db.query("update public.profiles set subscription_until = $2::timestamptz + interval '5 days' where id = $1", [user, NOON]);
    await addDevice(user, 30);
    await addDevice(admin, 32);
    await addDevice(other, 31);
    await db.query("insert into public.transactions(user_id, kind, description, amount_ars, occurred_on, status, source, created_at) values ($1,'expense','Hoy',100,'2026-11-05','confirmed','pwa','2026-11-05T09:00:00-03:00')", [other]);
    // Los usuarios de otros casos ya tienen avisos o no cumplen: se miden solo los de este caso.
    const ours = (kind: string) => db.query<{ n: number }>(
      'select count(*)::int as n from public.client_notifications where kind = $1 and user_id = any($2::uuid[])', [kind, [user, other, admin]],
    );
    await enqueue('2026-11-05T10:00:00-03:00');
    expect((await ours('subscription_7')).rows[0].n).toBe(1);
    await enqueue(NOON);
    expect((await ours('registration_noon')).rows[0].n).toBe(2); // user y admin; other ya registró hoy
    await enqueue('2026-11-05T13:30:00-03:00');
    expect((await ours('registration_noon')).rows[0].n).toBe(2); // margen sin duplicar
    await enqueue('2026-11-05T21:07:00-03:00');
    expect((await ours('registration_night')).rows[0].n).toBe(2);
    expect((await ours('monthly_summary')).rows[0].n).toBe(0);
  });

  it('permisos sin cambios', async () => {
    expect(await privileges()).toEqual(before);
    await expect(asUser(id(1), () => db.query('select public.claim_client_notifications(gen_random_uuid(), 10)'))).rejects.toThrow();
    await expect(asUser(id(1), () => db.query('select public.enqueue_client_notifications()'))).rejects.toThrow();
  });

  it('el cliente puede leer y cambiar solo su preferencia', async () => {
    await asUser(id(1), () => db.query('update public.app_settings set monthly_summary_enabled = false'));
    const rows = (await db.query<{ user_id: string; monthly_summary_enabled: boolean }>(
      'select user_id, monthly_summary_enabled from public.app_settings where user_id = any($1::uuid[]) order by user_id', [[id(1), id(2), id(15)]],
    )).rows;
    expect(rows).toEqual([
      { user_id: id(1), monthly_summary_enabled: false },
      { user_id: id(2), monthly_summary_enabled: true },
      { user_id: id(15), monthly_summary_enabled: true },
    ]);
    const own = await asUser(id(1), () => db.query<{ monthly_summary_enabled: boolean }>('select monthly_summary_enabled from public.app_settings')) as { rows: Array<{ monthly_summary_enabled: boolean }> };
    expect(own.rows).toEqual([{ monthly_summary_enabled: false }]);
  });
});
