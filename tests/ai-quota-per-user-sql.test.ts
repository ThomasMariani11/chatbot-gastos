import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile as readSqlFile, readdir } from 'node:fs/promises';

// SEC-04 (Fase 1.4): cupo diario de IA por cliente y edición de límites desde el panel (migración 055).
// Datos ficticios. Esquema con las migraciones reales 001–054; la 055 se aplica al final.
const readFile = async (path: URL | string) => (await readSqlFile(path, 'utf8')).replace(/\r\n/g, '\n');

type QuotaReply = { allowed: boolean; reason?: string; used?: number; limit?: number; day?: string };
type Job = { id: string; attempts: number };
type TopUser = { user_id: string; name: string; used: number };
type Lane = { lane: string; used: number; limit: number; per_user_limit: number; top_users: TopUser[] };

describe('SEC-04: cupo de IA por cliente (migración 055)', { timeout: 120_000 }, () => {
  const db = new PGlite();
  const migrationUrl = new URL('../supabase/migrations/', import.meta.url);
  const admin = '55000000-0000-4000-8000-000000000001';
  const clients = [2, 3, 4, 5, 6, 7].map((n) => `55000000-0000-4000-8000-00000000000${n}`);
  const [userA, userB] = clients;
  const tokenA = '55100000-0000-4000-8000-000000000001';
  const tokenB = '55100000-0000-4000-8000-000000000002';
  const tokenAdmin = '55100000-0000-4000-8000-000000000003';
  const FUNCTIONS = ['reserve_whatsapp_ai_quota', 'whatsapp_ai_quota_dashboard'];
  const propertiesSql = `select p.proname, pg_get_userbyid(p.proowner) as owner, p.proacl::text as proacl, p.prosecdef, p.proconfig
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1) order by p.proname`;
  const today = "(clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date";
  let propertiesBefore: unknown[];

  beforeAll(async () => {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
    `);
    // Un usuario existente antes de 005 queda promovido a admin.
    await db.query("insert into auth.users(id, email) values($1, 'admin@example.invalid')", [admin]);
    const migrations = (await readdir(migrationUrl)).filter((m) => /^\d+.*\.sql$/.test(m)).sort();
    for (const m of migrations.filter((m) => m < '021')) {
      if (m === '002_enable_realtime.sql') continue;
      let sql = await readFile(new URL(m, migrationUrl));
      if (m === '001_initial.sql') sql = sql.replace('create extension if not exists pgcrypto;', '');
      await db.exec(sql.replace(/^﻿/, ''));
    }
    await db.exec(`
      create schema cron; create schema net; create schema vault;
      create table net.http_request_queue(id bigint); create table net._http_response(id bigint);
      create table cron.job(jobname text, schedule text, command text);
      create table vault.decrypted_secrets(name text, decrypted_secret text);
      create function cron.schedule(text, text, text) returns bigint language plpgsql as $$ begin insert into cron.job values($1,$2,$3); return 1; end $$;
      create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) returns bigint language sql as $$ select 1::bigint $$;
      create schema if not exists extensions;
      create function extensions.http_set_curlopt(varchar, varchar) returns boolean language sql as $$ select true $$;
      create function extensions.http_reset_curlopt() returns boolean language sql as $$ select true $$;
      create type extensions.http_header as (field varchar, value varchar);
      create type extensions.http_request as (method varchar, uri varchar, headers extensions.http_header[], content_type varchar, content varchar);
      create function extensions.http_header(varchar, varchar) returns extensions.http_header language sql as $$ select row($1,$2)::extensions.http_header $$;
      create function extensions.http(extensions.http_request) returns table(status integer) language sql as $$ select 200 $$;
    `);
    for (const m of migrations.filter((m) => m >= '021' && m < '055')) {
      let sql = await readFile(new URL(m, migrationUrl));
      if (m === '021_whatsapp_queue_recovery.sql' || m === '022_whatsapp_recovery_private_transport.sql') {
        sql = sql.replace(/^create extension[^\n]+\n/gm, '');
      }
      if (m === '027_whatsapp_observability.sql') {
        await db.exec(`alter table cron.job add column if not exists jobid bigint generated always as identity, add column if not exists active boolean default true;
          create table if not exists cron.job_run_details(jobid bigint, status text, start_time timestamptz default clock_timestamp(), end_time timestamptz);`);
      }
      if (m === '052_admin_requires_mfa.sql') {
        await db.exec('create table auth.mfa_factors(user_id uuid, factor_type text, status text)');
        await db.query("insert into auth.mfa_factors values($1, 'totp', 'verified')", [admin]);
      }
      await db.exec(sql);
    }
    // Seis clientes activos por el alta real (códigos de invitación ficticios).
    for (const [i, id] of clients.entries()) {
      await db.query('insert into public.invitation_codes(code, duration_days) values($1, 30)', [`PESO-Q${i}-2026`]);
      await db.query('insert into auth.users(id, email, raw_user_meta_data) values($1, $2, $3)',
        [id, `c${i}@example.invalid`, JSON.stringify({ invitation_code: `PESO-Q${i}-2026`, first_name: `Cliente${i}`, last_name: 'Prueba' })]);
    }
    for (const [user, wa] of [[userA, 'synthetic-q-a'], [userB, 'synthetic-q-b'], [admin, 'synthetic-q-admin']]) {
      await db.query(`insert into public.whatsapp_links(user_id, wa_id, status) values($1, $2, 'active')
        on conflict(user_id) do update set wa_id = excluded.wa_id, status = 'active'`, [user, wa]);
    }
    propertiesBefore = (await db.query(propertiesSql, [FUNCTIONS])).rows;
    await db.exec(await readFile(new URL('055_ai_quota_per_user.sql', migrationUrl)));
  }, 120_000);

  afterAll(async () => { await db.close(); });
  beforeEach(async () => { await db.exec('begin; update public.whatsapp_queue_control set enabled = true'); });
  afterEach(async () => { await db.exec('rollback'); });

  async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const entries = Object.entries(args);
    const placeholders = entries.map(([key], i) => `${key} => $${i + 1}`);
    await db.exec('savepoint call');
    try {
      const result = await db.query<{ r: T }>(`select public.${name}(${placeholders.join(',')}) as r`,
        entries.map(([, v]) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v)));
      await db.exec('release savepoint call');
      return result.rows[0]?.r;
    } catch (error) {
      await db.exec('rollback to savepoint call; release savepoint call');
      throw error;
    }
  }

  // Ejecuta como usuario de la PWA (rol y nivel de sesión indicados).
  async function as<T>(role: 'authenticated' | 'anon', actor: string, aal: '' | 'aal1' | 'aal2', sql: string, args: unknown[] = []): Promise<T> {
    await db.exec('savepoint caller');
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.aal', $2, true), set_config('request.jwt.claims', '', true)", [actor, aal]);
      await db.exec(`set local role ${role}`);
      const result = await db.query<{ r: T }>(sql, args);
      await db.exec('reset role; release savepoint caller');
      return result.rows[0]?.r;
    } catch (error) {
      await db.exec('rollback to savepoint caller; release savepoint caller');
      throw error;
    }
  }

  let seq = 0;
  // Trabajo en processing con lease vigente: enqueue → claim_whatsapp_actor → next_whatsapp_job.
  async function job(wa: string, token: string): Promise<Job> {
    const id = `msg-sec04-${++seq}`;
    await rpc('enqueue_whatsapp_messages', { p_messages: [{ id, from: wa, type: 'text', timestamp: String(Math.floor(Date.now() / 1000)), text: { body: 'Gasté 100 en supermercado' } }] });
    await rpc('claim_whatsapp_actor', { p_wa_id: wa, p_token: token });
    const next = await rpc<Job | null>('next_whatsapp_job', { p_wa_id: wa, p_token: token });
    expect(next).not.toBeNull();
    return next!;
  }
  const jobA = () => job('synthetic-q-a', tokenA);
  const jobB = () => job('synthetic-q-b', tokenB);
  const jobAdmin = () => job('synthetic-q-admin', tokenAdmin);

  // Nuevo intento del mismo trabajo (la reserva es idempotente por trabajo, intento y carril).
  async function attempt(q: Job, n: number) {
    await db.query('update public.whatsapp_message_queue set attempts = $1 where id = $2', [n, q.id]);
    q.attempts = n;
  }
  const reserve = (q: Job, token: string, lane = 'qwen') =>
    rpc<QuotaReply>('reserve_whatsapp_ai_quota', { p_id: q.id, p_token: token, p_attempt: q.attempts, p_lane: lane });
  const globalUsed = async (lane = 'qwen') => (await db.query<{ n: number }>(
    `select coalesce(sum(reserved), 0)::int as n from public.ai_quota_days where lane = $1 and day = ${today}`, [lane])).rows[0].n;
  const userUsed = async (user: string, lane = 'qwen') => (await db.query<{ n: number }>(
    `select coalesce(sum(reserved), 0)::int as n from public.ai_quota_user_days where user_id = $1 and lane = $2 and day = ${today}`, [user, lane])).rows[0].n;
  const reservations = async () => (await db.query<{ n: number }>('select count(*)::int as n from public.ai_quota_reservations')).rows[0].n;
  const setPerUser = (lane: string, n: number) => db.query('update public.ai_quota_policy set per_user_daily_limit = $2 where lane = $1', [lane, n]);
  const updatePolicy = (role: 'authenticated' | 'anon', actor: string, aal: '' | 'aal1' | 'aal2', lane: string, global: number, perUser: number) =>
    as<Record<string, unknown>>(role, actor, aal, 'select public.admin_update_ai_quota_policy($1, $2, $3) as r', [lane, global, perUser]);
  const dashboard = (actor: string, aal: '' | 'aal1' | 'aal2') =>
    as<{ lanes: Lane[] }>('authenticated', actor, aal, 'select public.whatsapp_ai_quota_dashboard() as r');

  it('valores iniciales: qwen 100/15, whisper 200/25', async () => {
    expect((await db.query('select lane, daily_limit, per_user_daily_limit, enabled from public.ai_quota_policy order by lane')).rows).toEqual([
      { lane: 'qwen', daily_limit: 100, per_user_daily_limit: 15, enabled: true },
      { lane: 'whisper', daily_limit: 200, per_user_daily_limit: 25, enabled: true },
    ]);
  });

  it('un cliente que llega a su límite recibe user_exhausted y otro cliente sigue allowed', async () => {
    await setPerUser('qwen', 2);
    const qa = await jobA();
    expect(await reserve(qa, tokenA)).toMatchObject({ allowed: true, used: 1, limit: 100 });
    await attempt(qa, 2);
    expect(await reserve(qa, tokenA)).toMatchObject({ allowed: true, used: 2 });
    await attempt(qa, 3);
    const rejected = await reserve(qa, tokenA);
    expect(rejected).toMatchObject({ allowed: false, reason: 'user_exhausted', used: 2, limit: 2 });
    expect(rejected.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const qb = await jobB();
    expect(await reserve(qb, tokenB)).toMatchObject({ allowed: true, used: 3, limit: 100 });
    // El otro carril del mismo cliente sigue disponible.
    expect(await reserve(qa, tokenA, 'whisper')).toMatchObject({ allowed: true, used: 1, limit: 200 });
    expect(await userUsed(userA)).toBe(2);
    expect(await userUsed(userB)).toBe(1);
  });

  it('un rechazo por cliente no suma al global ni al cliente', async () => {
    await setPerUser('qwen', 2);
    const qa = await jobA();
    await reserve(qa, tokenA); await attempt(qa, 2); await reserve(qa, tokenA);
    const before = { global: await globalUsed(), user: await userUsed(userA), receipts: await reservations() };
    for (const n of [3, 4, 5]) {
      await attempt(qa, n);
      expect(await reserve(qa, tokenA)).toMatchObject({ allowed: false, reason: 'user_exhausted' });
    }
    expect({ global: await globalUsed(), user: await userUsed(userA), receipts: await reservations() }).toEqual(before);
  });

  it('el admin no tiene límite por cliente pero sí global, y no aparece en top_users', async () => {
    await setPerUser('qwen', 1);
    const q = await jobAdmin();
    for (const n of [1, 2, 3]) {
      if (n > 1) await attempt(q, n);
      expect(await reserve(q, tokenAdmin)).toMatchObject({ allowed: true, used: n });
    }
    expect(await userUsed(admin)).toBe(0);
    expect((await db.query<{ n: number }>('select count(*)::int as n from public.ai_quota_user_days where user_id = $1', [admin])).rows[0].n).toBe(0);
    await db.exec(`update public.ai_quota_days set reserved = 100 where lane = 'qwen' and day = ${today}`);
    await attempt(q, 4);
    expect(await reserve(q, tokenAdmin)).toMatchObject({ allowed: false, reason: 'exhausted', used: 100, limit: 100 });
    const snap = await dashboard(admin, 'aal2');
    expect(snap.lanes.find((l) => l.lane === 'qwen')!.top_users.map((u) => u.user_id)).not.toContain(admin);
  });

  it('el global sigue siendo el techo: exhausted antes que user_exhausted', async () => {
    const qa = await jobA();
    await db.exec(`insert into public.ai_quota_days(day, lane, reserved) values(${today}, 'qwen', 100)`);
    await db.query(`insert into public.ai_quota_user_days(day, lane, user_id, reserved) values(${today}, 'qwen', $1, 15)`, [userA]);
    expect(await reserve(qa, tokenA)).toMatchObject({ allowed: false, reason: 'exhausted', used: 100, limit: 100 });
    expect(await userUsed(userA)).toBe(15);
    expect(await globalUsed()).toBe(100);
  });

  it('la misma reserva repetida devuelve already_reserved sin sumar', async () => {
    const qa = await jobA();
    expect(await reserve(qa, tokenA)).toMatchObject({ allowed: true, used: 1 });
    expect(await reserve(qa, tokenA)).toEqual({ allowed: false, reason: 'already_reserved' });
    expect(await userUsed(userA)).toBe(1);
    expect(await globalUsed()).toBe(1);
    expect(await reservations()).toBe(1);
  });

  it('el contador del cliente se reinicia al cambiar de día (la fila de ayer no cuenta)', async () => {
    await db.query(`insert into public.ai_quota_user_days(day, lane, user_id, reserved) values(${today} - 1, 'qwen', $1, 15)`, [userA]);
    const qa = await jobA();
    expect(await reserve(qa, tokenA)).toMatchObject({ allowed: true, used: 1 });
    expect(await userUsed(userA)).toBe(1);
  });

  it('bajar el límite por debajo del uso rechaza sin error', async () => {
    await db.query(`insert into public.ai_quota_user_days(day, lane, user_id, reserved) values(${today}, 'qwen', $1, 5)`, [userA]);
    expect(await updatePolicy('authenticated', admin, 'aal2', 'qwen', 100, 3)).toMatchObject({ per_user_daily_limit: 3 });
    const qa = await jobA();
    expect(await reserve(qa, tokenA)).toMatchObject({ allowed: false, reason: 'user_exhausted', used: 5, limit: 3 });
    expect(await userUsed(userA)).toBe(5);
  });

  // PGlite tiene una sola conexión: no hay concurrencia real. Se valida la serialización
  // secuencial en el último lugar y que la fila del cliente se bloquee con FOR UPDATE
  // (la concurrencia real con dos sesiones queda para el ensayo local con Docker).
  it('dos reservas en el último lugar: pasa una sola (fila del cliente bloqueada con FOR UPDATE)', async () => {
    await setPerUser('qwen', 2);
    await db.query(`insert into public.ai_quota_user_days(day, lane, user_id, reserved) values(${today}, 'qwen', $1, 1)`, [userA]);
    const first = await jobA();
    const results = [await reserve(first, tokenA)];
    await attempt(first, 2);
    results.push(await reserve(first, tokenA));
    expect(results.filter((r) => r.allowed)).toHaveLength(1);
    expect(results.filter((r) => r.reason === 'user_exhausted')).toHaveLength(1);
    expect(await userUsed(userA)).toBe(2);
    const definition = (await db.query<{ d: string }>("select pg_get_functiondef('public.reserve_whatsapp_ai_quota(uuid,uuid,integer,text)'::regprocedure) as d")).rows[0].d;
    expect(definition).toMatch(/from public\.ai_quota_user_days\s+where[^;]*for update/i);
  });

  describe('admin_update_ai_quota_policy', () => {
    it('un admin con AAL2 actualiza y recibe la fila', async () => {
      expect(await updatePolicy('authenticated', admin, 'aal2', 'whisper', 300, 40))
        .toEqual({ lane: 'whisper', daily_limit: 300, per_user_daily_limit: 40, enabled: true });
      expect((await db.query("select daily_limit, per_user_daily_limit from public.ai_quota_policy where lane = 'whisper'")).rows[0])
        .toEqual({ daily_limit: 300, per_user_daily_limit: 40 });
    });

    it('AAL1, cliente y anon → 42501', async () => {
      await expect(updatePolicy('authenticated', admin, 'aal1', 'qwen', 50, 5)).rejects.toMatchObject({ code: '42501' });
      await expect(updatePolicy('authenticated', admin, '', 'qwen', 50, 5)).rejects.toMatchObject({ code: '42501' });
      await expect(updatePolicy('authenticated', userA, 'aal2', 'qwen', 50, 5)).rejects.toMatchObject({ code: '42501' });
      await expect(updatePolicy('anon', '', '', 'qwen', 50, 5)).rejects.toMatchObject({ code: '42501' });
      expect((await db.query("select daily_limit, per_user_daily_limit from public.ai_quota_policy where lane = 'qwen'")).rows[0])
        .toEqual({ daily_limit: 100, per_user_daily_limit: 15 });
    });

    it('rangos, por cliente > global y carril inexistente → 22023', async () => {
      for (const [lane, global, perUser] of [['qwen', 0, 1], ['qwen', 10001, 10], ['qwen', 100, 0], ['qwen', 50, 60], ['gemini', 10, 5], ['', 10, 5]] as const) {
        await expect(updatePolicy('authenticated', admin, 'aal2', lane, global, perUser)).rejects.toMatchObject({ code: '22023' });
      }
      await expect(as('authenticated', admin, 'aal2', 'select public.admin_update_ai_quota_policy($1, null, 5) as r', ['qwen'])).rejects.toMatchObject({ code: '22023' });
      expect(await updatePolicy('authenticated', admin, 'aal2', 'qwen', 10000, 10000)).toMatchObject({ daily_limit: 10000, per_user_daily_limit: 10000 });
    });
  });

  it('el dashboard incluye per_user_limit y top_users (máx. 5, orden) solo para admin', async () => {
    const counts = [3, 9, 1, 7, 5, 2];
    for (const [i, id] of clients.entries()) {
      await db.query(`insert into public.ai_quota_user_days(day, lane, user_id, reserved) values(${today}, 'qwen', $1, $2)`, [id, counts[i]]);
    }
    // Ayer no cuenta, ni el otro carril.
    await db.query(`insert into public.ai_quota_user_days(day, lane, user_id, reserved) values(${today} - 1, 'qwen', $1, 50), (${today}, 'whisper', $1, 4)`, [clients[2]]);
    const snap = await dashboard(admin, 'aal2');
    const qwen = snap.lanes.find((l) => l.lane === 'qwen')!;
    const whisper = snap.lanes.find((l) => l.lane === 'whisper')!;
    expect(qwen).toMatchObject({ limit: 100, per_user_limit: 15 });
    expect(qwen.top_users).toEqual([
      { user_id: clients[1], name: 'Cliente1 Prueba', used: 9 },
      { user_id: clients[3], name: 'Cliente3 Prueba', used: 7 },
      { user_id: clients[4], name: 'Cliente4 Prueba', used: 5 },
      { user_id: clients[0], name: 'Cliente0 Prueba', used: 3 },
      { user_id: clients[5], name: 'Cliente5 Prueba', used: 2 },
    ]);
    expect(whisper).toMatchObject({ limit: 200, per_user_limit: 25, top_users: [{ user_id: clients[2], name: 'Cliente2 Prueba', used: 4 }] });
    await db.exec(`delete from public.ai_quota_user_days where lane = 'whisper'`);
    expect((await dashboard(admin, 'aal2')).lanes.find((l) => l.lane === 'whisper')!.top_users).toEqual([]);
    await expect(dashboard(admin, 'aal1')).rejects.toThrow('AI_QUOTA_ADMIN_REQUIRED');
    await expect(dashboard(userA, 'aal2')).rejects.toThrow('AI_QUOTA_ADMIN_REQUIRED');
    await expect(as('anon', '', '', 'select public.whatsapp_ai_quota_dashboard() as r')).rejects.toMatchObject({ code: '42501' });
  });

  it('dueño, SECURITY DEFINER, search_path y grants sin cambios en reserve y dashboard; la RPC nueva no es ejecutable por anon', async () => {
    expect((await db.query(propertiesSql, [FUNCTIONS])).rows).toEqual(propertiesBefore);
    const fn = 'public.admin_update_ai_quota_policy(text,integer,integer)';
    const props = (await db.query<{ prosecdef: boolean; proconfig: string[] }>(`select prosecdef, proconfig from pg_proc where oid = '${fn}'::regprocedure`)).rows[0];
    expect(props).toEqual({ prosecdef: true, proconfig: ['search_path=pg_catalog, public'] });
    const priv = (await db.query(`select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as authenticated,
      has_function_privilege('anon', 'public.reserve_whatsapp_ai_quota(uuid,uuid,integer,text)', 'execute') as anon_reserve,
      has_function_privilege('authenticated', 'public.reserve_whatsapp_ai_quota(uuid,uuid,integer,text)', 'execute') as client_reserve,
      has_function_privilege('service_role', 'public.reserve_whatsapp_ai_quota(uuid,uuid,integer,text)', 'execute') as backend_reserve`, [fn])).rows[0];
    expect(priv).toEqual({ anon: false, authenticated: true, anon_reserve: false, client_reserve: false, backend_reserve: true });
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect((await db.query(`select has_table_privilege($1, 'public.ai_quota_user_days', 'select') as s, has_table_privilege($1, 'public.ai_quota_user_days', 'insert') as i,
        has_table_privilege($1, 'public.ai_quota_user_days', 'update') as u, has_table_privilege($1, 'public.ai_quota_policy', 'update') as p`, [role])).rows[0])
        .toEqual({ s: false, i: false, u: false, p: false });
    }
    expect((await db.query("select relrowsecurity from pg_class where oid = 'public.ai_quota_user_days'::regclass")).rows[0]).toEqual({ relrowsecurity: true });
  });
});
