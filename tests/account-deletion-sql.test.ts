import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile as readSqlFile, readdir } from 'node:fs/promises';

// 3.2 (LEG-01): borrado de cuenta por el propio cliente (migración 057).
// Datos ficticios. Esquema con las migraciones reales 001–056; la 057 se aplica al final.
const readFile = async (path: URL | string) => (await readSqlFile(path, 'utf8')).replace(/\r\n/g, '\n');

describe('3.2: borrado de cuenta (migración 057)', { timeout: 120_000 }, () => {
  const db = new PGlite();
  const migrationUrl = new URL('../supabase/migrations/', import.meta.url);
  const admin = '57000000-0000-4000-8000-000000000001';
  const clientA = '57000000-0000-4000-8000-000000000002';
  const clientB = '57000000-0000-4000-8000-000000000003';
  const [waA, waB, waMoved] = ['synthetic-del-a', 'synthetic-del-b', 'synthetic-del-moved'];
  // Funciones existentes que la 057 no debe alterar.
  const propertiesSql = `select p.proname, pg_get_userbyid(p.proowner) as owner, p.proacl::text as proacl, p.prosecdef, p.proconfig
    from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('enqueue_whatsapp_messages', 'apply_whatsapp_job', 'redeem_invitation_code') order by p.proname, p.oid`;
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
    for (const m of migrations.filter((m) => m >= '021' && m < '057')) {
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
    // Clientes A y B por el alta real; A tiene de todo, B debe quedar intacto.
    for (const [i, id] of [clientA, clientB].entries()) {
      await db.query('insert into public.invitation_codes(code, duration_days) values($1, 30)', [`PESO-D${i}-2026`]);
      await db.query('insert into auth.users(id, email, raw_user_meta_data) values($1, $2, $3)',
        [id, `d${i}@example.invalid`, JSON.stringify({ invitation_code: `PESO-D${i}-2026`, first_name: `Cliente${i}`, last_name: 'Prueba' })]);
    }
    propertiesBefore = (await db.query(propertiesSql)).rows;
    // Emula los privilegios por defecto de Supabase sobre funciones nuevas de public.
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;');
    await db.exec(await readFile(new URL('057_account_deletion.sql', migrationUrl)));
  }, 120_000);

  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.exec('begin; update public.whatsapp_queue_control set enabled = true');
    await seed();
  });
  afterEach(async () => { await db.exec('rollback'); });

  let seq = 0;
  const enqueue = (from: string) => db.query('select public.enqueue_whatsapp_messages($1)',
    [JSON.stringify([{ id: `msg-del-${++seq}`, from, type: 'text', text: { body: 'Gasté 100 en súper' } }])]);
  const link = (user: string, wa: string) => db.query(`insert into public.whatsapp_links(user_id, wa_id, status) values($1, $2, 'active')
    on conflict(user_id) do update set wa_id = excluded.wa_id, status = 'active'`, [user, wa]);

  // Datos ficticios de ambos clientes; todo dentro de la transacción del test.
  async function seed() {
    await enqueue(waA); // antes de vincular: queda solo con el teléfono
    for (const [user, wa] of [[clientA, waA], [clientB, waB]]) {
      await link(user, wa);
      await enqueue(wa);
      await db.query(`insert into public.transactions(user_id, kind, description, amount_ars, occurred_on, status, source)
        values($1, 'expense', 'Súper ficticio', 1000, '2026-11-20', 'confirmed', 'pwa')`, [user]);
      await db.query(`insert into public.push_subscriptions(user_id, endpoint, p256dh, auth) values($1, $2, $3, $4)`,
        [user, `https://push.example.test/${user}`, 'p'.repeat(87), 'a'.repeat(22)]);
    }
    // Número que A usó antes y hoy está vinculado a otra cuenta (el admin): sus restos no se tocan.
    await link(admin, waMoved);
    await db.query(`insert into public.whatsapp_worker_state(wa_id, user_id) values($1, $2)
      on conflict(wa_id) do update set user_id = excluded.user_id`, [waMoved, clientA]);
    await db.query("insert into public.inbound_events(wa_message_id, wa_id, status) values('moved-1', $1, 'processed')", [waMoved]);
    // Pagos de A: renovación pagada con código nominativo (el bloqueo de hoy) y renovación manual del admin.
    const code = (await db.query<{ id: string }>(`insert into public.invitation_codes(code, duration_days, created_by, renewal_user_id, is_used, used_by, used_at)
      values('PESO-R1-2026', 30, $1, $2, true, $2, now()) returning id`, [admin, clientA])).rows[0].id;
    await db.query(`insert into public.subscription_renewal_requests(user_id, wa_id, state, paid_at, paid_by, duration_days, code_id, redeemed_at)
      values($1, $2, 'redeemed', now(), $3, 30, $4, now())`, [clientA, waA, admin, code]);
    await db.query(`insert into public.admin_subscription_requests(admin_id, request_id, client_id, request_hash, days_added)
      values($1, gen_random_uuid(), $2, 'hash-ficticio', 15)`, [admin, clientA]);
  }

  // Ejecuta como usuario de la PWA.
  async function as<T>(role: 'authenticated' | 'anon', actor: string, sql: string): Promise<T> {
    await db.exec('savepoint caller');
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [actor]);
      await db.exec(`set local role ${role}`);
      const result = await db.query<{ r: T }>(sql);
      await db.exec('reset role; release savepoint caller');
      return result.rows[0]?.r;
    } catch (error) {
      await db.exec('rollback to savepoint caller; release savepoint caller');
      throw error;
    }
  }
  const deleteAs = (actor: string, role: 'authenticated' | 'anon' = 'authenticated') =>
    as<{ deleted: boolean }>(role, actor, 'select public.delete_my_account() as r');
  const count = async (sql: string, args: unknown[] = []) => (await db.query<{ n: number }>(`select (${sql})::int as n`, args)).rows[0].n;
  const footprint = async (user: string, wa: string) => ({
    user: await count('select count(*) from auth.users where id = $1', [user]),
    profile: await count('select count(*) from public.profiles where id = $1', [user]),
    transactions: await count('select count(*) from public.transactions where user_id = $1', [user]),
    categories: await count('select count(*) from public.categories where user_id = $1', [user]),
    link: await count('select count(*) from public.whatsapp_links where user_id = $1', [user]),
    push: await count('select count(*) from public.push_subscriptions where user_id = $1', [user]),
    queue: await count('select count(*) from public.whatsapp_message_queue where wa_id = $1', [wa]),
    inbound: await count('select count(*) from public.inbound_events where wa_id = $1', [wa]),
    state: await count('select count(*) from public.whatsapp_worker_state where wa_id = $1', [wa]),
  });

  it('borra todo lo del cliente, incluidos los restos por teléfono, y devuelve deleted', async () => {
    expect(await deleteAs(clientA)).toEqual({ deleted: true });
    expect(await footprint(clientA, waA)).toEqual({ user: 0, profile: 0, transactions: 0, categories: 0, link: 0, push: 0, queue: 0, inbound: 0, state: 0 });
    expect(await count('select count(*) from public.subscription_renewal_requests')).toBe(0);
    expect(await count('select count(*) from public.admin_subscription_requests')).toBe(0);
  });

  it('no toca los datos de otro cliente ni un número que hoy está vinculado a otra cuenta', async () => {
    const before = await footprint(clientB, waB);
    await link(clientB, waB);
    await deleteAs(clientA);
    expect(await footprint(clientB, waB)).toEqual(before);
    expect(await count('select count(*) from public.inbound_events where wa_id = $1', [waMoved])).toBe(1);
  });

  it('un número viejo de la cuenta que no está vinculado a nadie también se limpia', async () => {
    await deleteAs(clientA);
    expect(await count('select count(*) from public.whatsapp_worker_state where wa_id = $1', [waMoved])).toBe(1);
    await db.exec('rollback; begin; update public.whatsapp_queue_control set enabled = true');
    await seed();
    await db.query("update public.whatsapp_links set status = 'revoked' where user_id = $1", [admin]);
    await deleteAs(clientA);
    expect(await count('select count(*) from public.whatsapp_worker_state where wa_id = $1', [waMoved])).toBe(0);
    expect(await count('select count(*) from public.inbound_events where wa_id = $1', [waMoved])).toBe(0);
  });

  it('guarda los pagos anonimizados, sin identificadores de la cuenta', async () => {
    await deleteAs(clientA);
    const rows = (await db.query<Record<string, unknown>>('select kind, duration_days, state from public.payment_archive order by kind')).rows;
    expect(rows).toEqual([
      { kind: 'admin_renewal', duration_days: 15, state: 'applied' },
      { kind: 'invitation_redeemed', duration_days: 30, state: 'redeemed' },
      { kind: 'renewal_request', duration_days: 30, state: 'redeemed' },
    ]);
    const columns = (await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'payment_archive' order by 1")).rows.map((r) => r.column_name);
    expect(columns).toEqual(['archived_at', 'duration_days', 'id', 'kind', 'occurred_at', 'state']);
    expect(await count("select count(*) from public.invitation_codes where code = 'PESO-R1-2026' and renewal_user_id is null and used_by is null")).toBe(1);
  });

  it('fuera del borrado, el código de pago sigue protegido (sin marca o con la marca de otra cuenta)', async () => {
    const anonymize = "update public.invitation_codes set renewal_user_id = null, used_by = null where code = 'PESO-R1-2026'";
    await db.exec('savepoint guard');
    await expect(db.query(anonymize)).rejects.toThrow(/no puede modificarse/);
    await db.exec('rollback to savepoint guard');
    await db.query("select set_config('pesito.account_deletion', $1, true)", [clientB]);
    await expect(db.query(anonymize)).rejects.toThrow(/no puede modificarse/);
    await db.exec('rollback to savepoint guard');
    await db.query("select set_config('pesito.account_deletion', $1, true)", [clientA]);
    await expect(db.query("update public.invitation_codes set duration_days = 365, renewal_user_id = null, used_by = null where code = 'PESO-R1-2026'"))
      .rejects.toThrow(/no puede modificarse/);
    await db.exec('rollback to savepoint guard; release savepoint guard');
  });

  it('si algo falla a mitad, no se borra nada', async () => {
    await db.exec(`create function public.test_block_delete() returns trigger language plpgsql as $$ begin raise exception 'fallo ficticio'; end $$;
      create trigger zz_test_block_delete before delete on auth.users for each row execute function public.test_block_delete();`);
    const before = await footprint(clientA, waA);
    await expect(deleteAs(clientA)).rejects.toThrow(/fallo ficticio/);
    expect(await footprint(clientA, waA)).toEqual(before);
    expect(await count('select count(*) from public.payment_archive')).toBe(0);
  });

  it('el administrador no puede borrarse y anon no puede ejecutar', async () => {
    await expect(deleteAs(admin)).rejects.toMatchObject({ code: '42501' });
    expect(await count('select count(*) from auth.users where id = $1', [admin])).toBe(1);
    await expect(deleteAs(clientA, 'anon')).rejects.toMatchObject({ code: '42501' });
    expect(await count('select count(*) from auth.users where id = $1', [clientA])).toBe(1);
  });

  it('sin sesión no borra nada', async () => {
    await expect(deleteAs('')).rejects.toMatchObject({ code: '42501' });
  });

  it('permisos: solo authenticated ejecuta; payment_archive sin acceso para ningún rol', async () => {
    const can = async (role: string) => (await db.query<{ ok: boolean }>(
      "select has_function_privilege($1, 'public.delete_my_account()', 'execute') as ok", [role])).rows[0].ok;
    expect(await can('anon')).toBe(false);
    expect(await can('service_role')).toBe(false);
    expect(await can('authenticated')).toBe(true);
    const props = (await db.query<{ prosecdef: boolean; proconfig: string[] }>(
      "select prosecdef, proconfig from pg_proc where oid = 'public.delete_my_account()'::regprocedure")).rows[0];
    expect(props).toEqual({ prosecdef: true, proconfig: ['search_path=pg_catalog, public'] });
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const any = (await db.query<{ ok: boolean }>(
        "select has_any_column_privilege($1, 'public.payment_archive', 'select') or has_table_privilege($1, 'public.payment_archive', 'insert') as ok", [role])).rows[0].ok;
      expect(any, role).toBe(false);
    }
    expect((await db.query(propertiesSql)).rows).toEqual(propertiesBefore);
  });
});
