import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile as readSqlFile, readdir } from 'node:fs/promises';

// SEC-06 (Fase 2.2): límite de mensajes por número en la recepción (migración 056).
// Datos ficticios. Esquema con las migraciones reales 001–055; la 056 se aplica al final.
const readFile = async (path: URL | string) => (await readSqlFile(path, 'utf8')).replace(/\r\n/g, '\n');

type Queued = { payload: Record<string, unknown> };

describe('SEC-06: límite de mensajes por número (migración 056)', { timeout: 120_000 }, () => {
  const db = new PGlite();
  const migrationUrl = new URL('../supabase/migrations/', import.meta.url);
  const admin = '56000000-0000-4000-8000-000000000001';
  const client = '56000000-0000-4000-8000-000000000002';
  const linked = 'synthetic-l-linked';
  const propertiesSql = `select pg_get_userbyid(p.proowner) as owner, p.proacl::text as proacl, p.prosecdef, p.proconfig
    from pg_proc p where p.oid = 'public.enqueue_whatsapp_messages(jsonb)'::regprocedure`;
  let propertiesBefore: unknown;

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
    for (const m of migrations.filter((m) => m >= '021' && m < '056')) {
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
    await db.query('insert into public.invitation_codes(code, duration_days) values($1, 30)', ['PESO-L1-2026']);
    await db.query('insert into auth.users(id, email, raw_user_meta_data) values($1, $2, $3)',
      [client, 'l1@example.invalid', JSON.stringify({ invitation_code: 'PESO-L1-2026', first_name: 'Cliente', last_name: 'Prueba' })]);
    await db.query(`insert into public.whatsapp_links(user_id, wa_id, status) values($1, $2, 'active')
      on conflict(user_id) do update set wa_id = excluded.wa_id, status = 'active'`, [client, linked]);
    propertiesBefore = (await db.query(propertiesSql)).rows[0];
    // Emula los privilegios por defecto de Supabase sobre funciones nuevas de public.
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;');
    await db.exec(await readFile(new URL('056_whatsapp_rate_limit.sql', migrationUrl)));
  }, 120_000);

  afterAll(async () => { await db.close(); });
  beforeEach(async () => { await db.exec('begin; update public.whatsapp_queue_control set enabled = true'); });
  afterEach(async () => { await db.exec('rollback'); });

  let seq = 0;
  const message = (from: string, extra: Record<string, unknown> = {}) =>
    ({ id: `msg-sec06-${++seq}`, from, type: 'text', text: { body: 'Gasté 100 en súper' }, ...extra });
  const enqueue = async (messages: unknown[]) =>
    (await db.query<{ r: { actors: string[] } }>('select public.enqueue_whatsapp_messages($1) as r', [JSON.stringify(messages)])).rows[0].r;
  const burst = (from: string, n: number) => enqueue(Array.from({ length: n }, () => message(from)));
  const queued = async (from: string) =>
    (await db.query<Queued>(
      `select q.payload from public.whatsapp_message_queue q where q.wa_id = $1
       order by (regexp_replace(q.wa_message_id, '\\D', '', 'g'))::int`, [from])).rows;
  const accepted = async (from: string) =>
    (await db.query<{ n: number }>('select count(*)::int as n from public.inbound_events where wa_id = $1', [from])).rows[0].n;
  // Saca de la ventana lo ya recibido (las filas de esta transacción tienen received_at = now()).
  const age = (from: string, interval: string) =>
    db.query(`update public.inbound_events set received_at = received_at - interval '${interval}' where wa_id = $1`, [from]);
  const flag = (q: Queued, key: string) => q.payload[key] === true;

  it('número no vinculado: 5 por minuto, el resto se descarta sin guardarse', async () => {
    await burst('synthetic-u-1', 6);
    expect(await accepted('synthetic-u-1')).toBe(5);
    expect(await queued('synthetic-u-1')).toHaveLength(5);
  });

  it('número no vinculado: 30 en 24 horas aunque respete el minuto', async () => {
    for (let i = 0; i < 6; i++) {
      await burst('synthetic-u-2', 5);
      await age('synthetic-u-2', '2 minutes');
    }
    expect(await accepted('synthetic-u-2')).toBe(30);
    await burst('synthetic-u-2', 1);
    expect(await accepted('synthetic-u-2')).toBe(30);
    await age('synthetic-u-2', '24 hours');
    await burst('synthetic-u-2', 1);
    expect(await accepted('synthetic-u-2')).toBe(31);
  });

  it('aviso de no vinculado: el primero sin marca, los siguientes en 24 horas marcados; después otra vez sin marca', async () => {
    await burst('synthetic-u-3', 3);
    expect((await queued('synthetic-u-3')).map((q) => flag(q, 'pesito_quiet_not_linked'))).toEqual([false, true, true]);
    await db.query("update public.whatsapp_worker_state set not_linked_notice_at = now() - interval '25 hours' where wa_id = 'synthetic-u-3'");
    await age('synthetic-u-3', '2 minutes');
    await burst('synthetic-u-3', 1);
    expect(flag((await queued('synthetic-u-3'))[3], 'pesito_quiet_not_linked')).toBe(false);
  });

  it('cliente vinculado: 20 por minuto normales, el 21.º marcado para avisar y el 22.º descartado', async () => {
    await burst(linked, 22);
    const rows = await queued(linked);
    expect(rows).toHaveLength(21);
    expect(rows.slice(0, 20).some((q) => flag(q, 'pesito_rate_limited'))).toBe(false);
    expect(flag(rows[20], 'pesito_rate_limited')).toBe(true);
    expect(rows.some((q) => flag(q, 'pesito_quiet_not_linked'))).toBe(false);
  });

  it('cliente vinculado: un solo aviso por hora aunque siga la ráfaga en otro minuto', async () => {
    await burst(linked, 21);
    await age(linked, '2 minutes');
    await burst(linked, 21);
    expect(await accepted(linked)).toBe(41);
    await db.query("update public.whatsapp_worker_state set rate_notice_at = now() - interval '61 minutes' where wa_id = $1", [linked]);
    await age(linked, '2 minutes');
    await burst(linked, 21);
    expect((await queued(linked)).filter((q) => flag(q, 'pesito_rate_limited'))).toHaveLength(2);
  });

  it('un reintento de Meta con el mismo id no cuenta ni consume el aviso', async () => {
    const first = message('synthetic-u-4');
    await enqueue([first]);
    await enqueue([first]);
    await enqueue([first]);
    expect(await accepted('synthetic-u-4')).toBe(1);
    await burst('synthetic-u-4', 4);
    expect(await accepted('synthetic-u-4')).toBe(5);
    expect((await queued('synthetic-u-4')).map((q) => flag(q, 'pesito_quiet_not_linked'))).toEqual([false, true, true, true, true]);
  });

  it('las marcas que vengan en el mensaje entrante se quitan', async () => {
    await enqueue([message(linked, { pesito_rate_limited: true, pesito_quiet_not_linked: true })]);
    const [row] = await queued(linked);
    expect(row.payload).not.toHaveProperty('pesito_rate_limited');
    expect(row.payload).not.toHaveProperty('pesito_quiet_not_linked');
  });

  // Regresión de la 020: lo que la función hacía antes se conserva.
  it('un CONFIRMAR posterior al resumen mostrado guarda el grupo y la versión, como en la 020', async () => {
    const group = (await db.query<{ id: string }>(
      "insert into public.draft_groups(user_id, status, version) values($1, 'open', 3) returning id", [client])).rows[0].id;
    await db.query(`insert into public.whatsapp_worker_state(wa_id, summary_pending, shown_group_id, shown_version, shown_at)
      values($1, false, $2, 3, now() - interval '1 minute')
      on conflict(wa_id) do update set summary_pending = false, shown_group_id = $2, shown_version = 3, shown_at = now() - interval '1 minute'`,
      [linked, group]);
    await enqueue([message(linked, { text: { body: 'CONFIRMAR' }, timestamp: String(Math.floor(Date.now() / 1000)) })]);
    const row = (await db.query<{ confirmation_group_id: string; confirmation_version: number }>(
      'select confirmation_group_id, confirmation_version from public.whatsapp_message_queue where wa_id = $1', [linked])).rows[0];
    expect(row).toEqual({ confirmation_group_id: group, confirmation_version: 3 });
  });

  it('un mensaje repetido dentro del mismo payload se guarda una vez y el actor se devuelve una vez', async () => {
    const same = message('synthetic-u-7');
    const result = await enqueue([same, same, message('synthetic-u-8')]);
    expect(await accepted('synthetic-u-7')).toBe(1);
    expect(result.actors).toEqual(['synthetic-u-7', 'synthetic-u-8']);
  });

  it('dos números no se afectan entre sí', async () => {
    await burst('synthetic-u-5', 6);
    await burst('synthetic-u-6', 2);
    expect(await accepted('synthetic-u-5')).toBe(5);
    expect(await accepted('synthetic-u-6')).toBe(2);
  });

  it('dueño, SECURITY DEFINER, search_path y permisos sin cambios; solo service_role ejecuta', async () => {
    expect((await db.query(propertiesSql)).rows[0]).toEqual(propertiesBefore);
    const can = async (role: string) => (await db.query<{ ok: boolean }>(
      "select has_function_privilege($1, 'public.enqueue_whatsapp_messages(jsonb)', 'execute') as ok", [role])).rows[0].ok;
    expect(await can('anon')).toBe(false);
    expect(await can('authenticated')).toBe(false);
    expect(await can('service_role')).toBe(true);
  });
});
