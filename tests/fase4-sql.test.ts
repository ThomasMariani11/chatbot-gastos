import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile as readSqlFile, readdir } from 'node:fs/promises';

// Fase 4, grupo de base de datos (migración 058): SEC-12, 13, 14, 15, 16, 18, 19 y pendientes de 3.2.
// Datos ficticios. Emula los privilegios por defecto de Supabase sobre tablas y funciones de public,
// para que "permitido" y "rechazado" se prueben por la razón correcta. Migraciones reales 001–057; la 058 al final.
const readFile = async (path: URL | string) => (await readSqlFile(path, 'utf8')).replace(/\r\n/g, '\n');

describe('Fase 4 SQL (migración 058)', { timeout: 120_000 }, () => {
  const db = new PGlite();
  const migrationUrl = new URL('../supabase/migrations/', import.meta.url);
  const admin = '58000000-0000-4000-8000-000000000001';
  const clientA = '58000000-0000-4000-8000-000000000002';
  const clientB = '58000000-0000-4000-8000-000000000003';
  const sessions: Record<string, string> = {
    [clientA]: '58100000-0000-4000-8000-000000000002',
    [clientB]: '58100000-0000-4000-8000-000000000003',
    [admin]: '58100000-0000-4000-8000-000000000001',
  };
  const APPLE = 'https://web.push.apple.com/QFicticio';
  const keys = { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) };
  // Funciones existentes que la 058 no debe alterar.
  const propertiesSql = `select p.oid::regprocedure::text as fn, pg_get_userbyid(p.proowner) as owner, p.proacl::text as proacl, p.prosecdef, p.proconfig
    from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('enqueue_whatsapp_messages', 'apply_whatsapp_job', 'redeem_invitation_code', 'submit_pwa_entry', 'reserve_whatsapp_ai_quota', 'guard_renewal_code') order by 1`;
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
      -- Privilegios por defecto de Supabase sobre lo que se crea en public.
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    `);
    await db.query("insert into auth.users(id, email) values($1, 'admin@example.invalid')", [admin]);
    const migrations = (await readdir(migrationUrl)).filter((m) => /^\d+.*\.sql$/.test(m)).sort();
    for (const m of migrations.filter((m) => m < '021')) {
      if (m === '002_enable_realtime.sql') continue;
      let sql = await readFile(new URL(m, migrationUrl));
      if (m === '001_initial.sql') sql = sql.replace('create extension if not exists pgcrypto;', '');
      await db.exec(sql.replace(/^﻿/, ''));
    }
    // 002 (realtime) no corre en PGlite: se crea la publicación equivalente.
    await db.exec('create publication supabase_realtime for table public.transactions, public.budgets, public.whatsapp_links, public.app_settings');
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
    for (const m of migrations.filter((m) => m >= '021' && m < '058')) {
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
      if (m === '057_account_deletion.sql') {
        await db.exec(`create table auth.sessions(id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now());
          create table auth.audit_log_entries(instance_id uuid, id uuid primary key default gen_random_uuid(), payload json, created_at timestamptz default now(), ip_address varchar(64) not null default '');`);
      }
      await db.exec(sql);
    }
    for (const [i, id] of [clientA, clientB].entries()) {
      await db.query('insert into public.invitation_codes(code, duration_days) values($1, 30)', [`PESO-F${i}-2026`]);
      await db.query('insert into auth.users(id, email, raw_user_meta_data) values($1, $2, $3)',
        [id, `f${i}@example.invalid`, JSON.stringify({ invitation_code: `PESO-F${i}-2026`, first_name: `Cliente${i}`, last_name: 'Prueba' })]);
    }
    propertiesBefore = (await db.query(propertiesSql)).rows;
    await db.exec(await readFile(new URL('058_fase4_sql_hardening.sql', migrationUrl)));
  }, 120_000);

  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.exec('begin');
    for (const [user, session] of Object.entries(sessions)) await db.query('insert into auth.sessions(id, user_id) values($1, $2)', [session, user]);
  });
  afterEach(async () => { await db.exec('rollback'); });

  // Ejecuta como un rol de la PWA (con o sin sesión) y devuelve filas o el error.
  async function as(role: 'authenticated' | 'anon', actor: string | null, sql: string, args: unknown[] = []) {
    await db.exec('savepoint caller');
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.aal', 'aal2', true), set_config('request.jwt.claims', $2, true)",
        [actor ?? '', JSON.stringify({ sub: actor, session_id: actor ? sessions[actor] : null, aal: 'aal2' })]);
      await db.exec(`set local role ${role}`);
      const result = await db.query<Record<string, unknown>>(sql, args);
      await db.exec('reset role; release savepoint caller');
      return { rows: result.rows, error: null as null | { code?: string; message: string } };
    } catch (error) {
      await db.exec('rollback to savepoint caller; release savepoint caller');
      return { rows: [], error: error as { code?: string; message: string } };
    }
  }
  // Sesión de administrador con MFA para lo que se ejecuta directo (como postgres) en el test.
  const adminClaims = () => db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.aal', 'aal2', true), set_config('request.jwt.claims', $2, true)",
    [admin, JSON.stringify({ sub: admin, aal: 'aal2' })]);
  const one = async (sql: string, args: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, args)).rows[0];
  const movement = async (user: string) => (await one(`insert into public.transactions(user_id, kind, description, amount_ars, occurred_on, status, source)
    values($1, 'expense', 'Súper ficticio', 1000, '2026-11-20', 'confirmed', 'pwa') returning id`, [user])).id as string;

  describe('SEC-12: perfil', () => {
    it('el cliente edita nombre y apellido, pero no correo, fecha de alta, teléfono ni rol', async () => {
      expect((await as('authenticated', clientA, "update public.profiles set first_name = 'Ana', last_name = 'Ficticia', updated_at = now() where id = $1", [clientA])).error).toBeNull();
      for (const set of ["email = 'otro@example.invalid'", "created_at = now() - interval '1 year'", "phone_number = '5490000000000'", "role = 'admin'"]) {
        expect((await as('authenticated', clientA, `update public.profiles set ${set} where id = $1`, [clientA])).error?.code, set).toBe('42501');
      }
      expect(await one('select first_name, email from public.profiles where id = $1', [clientA])).toEqual({ first_name: 'Ana', email: 'f0@example.invalid' });
    });
  });

  describe('Compatibilidad con el panel de administración', () => {
    it('el admin (con MFA) pausa y reactiva a un cliente como hace el panel; el cliente no puede cambiar su estado', async () => {
      for (const status of ['suspended', 'active']) {
        expect((await as('authenticated', admin, 'update public.profiles set subscription_status = $1, updated_at = now() where id = $2 returning id', [status, clientA])).error, status).toBeNull();
        expect(await one('select subscription_status from public.profiles where id = $1', [clientA])).toEqual({ subscription_status: status });
      }
      expect((await as('authenticated', clientA, "update public.profiles set subscription_status = 'suspended' where id = $1", [clientA])).error?.code).toBe('42501');
      expect((await as('authenticated', clientA, "update public.profiles set subscription_until = now() + interval '1 year' where id = $1", [clientA])).error?.code).toBe('42501');
    });
  });

  describe('SEC-13: escrituras directas', () => {
    it('movimientos: no se crean directo ni se cambia estado u origen; sí se edita lo que edita la app y se borra', async () => {
      const id = await movement(clientA);
      expect((await as('authenticated', clientA, `insert into public.transactions(user_id, kind, description, amount_ars, status, source)
        values($1, 'expense', 'Inventado', 1, 'confirmed', 'text')`, [clientA])).error?.code).toBe('42501');
      for (const set of ["status = 'pending'", "source = 'text'", "wa_message_id = 'falso'", 'installment_count = 3']) {
        expect((await as('authenticated', clientA, `update public.transactions set ${set} where id = $1`, [id])).error?.code, set).toBe('42501');
      }
      expect((await as('authenticated', clientA, `update public.transactions set description = 'Verdulería', amount_ars = 250, currency = 'USD', kind = 'income',
        occurred_on = '2026-11-21', updated_at = now() where id = $1`, [id])).error).toBeNull();
      expect((await as('authenticated', clientA, 'delete from public.transactions where id = $1', [id])).error).toBeNull();
      expect(await one('select count(*)::int as n from public.transactions where id = $1', [id])).toEqual({ n: 0 });
    });

    it('ajustes: solo los tres interruptores; categorías sin escritura; presupuestos siguen', async () => {
      expect((await as('authenticated', clientA, `update public.app_settings set whatsapp_responses_enabled = false, client_reminders_enabled = false,
        monthly_summary_enabled = false, updated_at = now() where user_id = $1`, [clientA])).error).toBeNull();
      expect((await as('authenticated', clientA, 'update public.app_settings set paid_service_messages_authorized = true where user_id = $1', [clientA])).error?.code).toBe('42501');
      expect((await as('authenticated', clientA, 'delete from public.app_settings where user_id = $1', [clientA])).error?.code).toBe('42501');
      expect((await as('authenticated', clientA, "update public.categories set name = 'Otra' where user_id = $1", [clientA])).error?.code).toBe('42501');
      expect((await as('authenticated', clientA, "insert into public.categories(user_id, kind, name) values($1, 'expense', 'Nueva')", [clientA])).error?.code).toBe('42501');
      expect((await as('authenticated', clientA, `insert into public.budgets(user_id, month, amount_ars) values($1, '2026-11-01', 5000)
        on conflict (user_id, month) do update set amount_ars = excluded.amount_ars`, [clientA])).error).toBeNull();
    });
  });

  describe('SEC-14 y SEC-16: sin sesión', () => {
    it('la configuración no se lee sin sesión (vacío, sin error) y sí con sesión', async () => {
      await db.query("insert into public.system_config(key, value) values('payment_alias', 'alias.ficticio') on conflict (key) do update set value = excluded.value");
      expect(await as('anon', null, 'select key from public.system_config')).toEqual({ rows: [], error: null });
      expect((await as('authenticated', clientA, "select value from public.system_config where key = 'payment_alias'")).rows).toEqual([{ value: 'alias.ficticio' }]);
    });

    it('sin sesión: get_my_role y los meses quedan cerrados; el chequeo de invitación y las políticas siguen sin error', async () => {
      expect((await as('anon', null, 'select public.get_my_role()')).error?.code).toBe('42501');
      expect((await as('anon', null, 'select public.get_distinct_transaction_months()')).error?.code).toBe('42501');
      expect((await as('anon', null, "select public.check_invitation_code('PESO-NO-EXISTE')")).error).toBeNull();
      expect(await as('anon', null, 'select id from public.transactions')).toEqual({ rows: [], error: null });
      expect((await as('authenticated', clientA, 'select public.get_distinct_transaction_months()')).error).toBeNull();
    });

    it('las funciones SECURITY DEFINER señaladas tienen pg_catalog en el search_path', async () => {
      const rows = (await db.query<{ fn: string; proconfig: string[] }>(`select p.oid::regprocedure::text as fn, p.proconfig from pg_proc p
        where p.oid in ('public.get_active_draft_group(uuid)'::regprocedure, 'public.get_my_role()'::regprocedure,
        'public.has_active_subscription()'::regprocedure)`)).rows;
      // next_gemini_model_slot() solo existe en producción (deriva): la migración la endurece si está.
      expect(rows).toHaveLength(3);
      for (const r of rows) expect(r.proconfig, r.fn).toEqual(['search_path=pg_catalog, public']);
    });
  });

  it('SEC-15: el tiempo real publica altas y cambios, no borrados', async () => {
    expect(await one("select pubinsert, pubupdate, pubdelete from pg_publication where pubname = 'supabase_realtime'"))
      .toEqual({ pubinsert: true, pubupdate: true, pubdelete: false });
  });

  describe('SEC-18: administración', () => {
    it('registra cambios de rol, de configuración y códigos borrados, con quién lo hizo', async () => {
      expect((await as('authenticated', admin, "insert into public.system_config(key, value) values('support_phone', '5490000000001') on conflict (key) do update set value = excluded.value")).error).toBeNull();
      await db.query("insert into public.invitation_codes(code, duration_days) values('PESO-BORRAR-2026', 30)");
      expect((await as('authenticated', admin, "delete from public.invitation_codes where code = 'PESO-BORRAR-2026'")).error).toBeNull();
      // Cambiar un rol exige ser admin con MFA (trigger de 031); queda registrado con su actor.
      await adminClaims();
      await db.query("update public.profiles set role = 'admin' where id = $1", [clientB]);
      const log =(await db.query<{ action: string; actor: string | null; target: string }>(
        'select action, actor, target from public.admin_audit_log order by id')).rows;
      expect(log).toEqual([
        { action: 'system_config.upsert', actor: admin, target: 'support_phone' },
        { action: 'invitation_code.delete', actor: admin, target: 'PESO-BORRAR-2026' },
        { action: 'profile.role', actor: admin, target: clientB },
      ]);
      expect((await as('authenticated', clientA, 'select id from public.admin_audit_log')).rows).toEqual([]);
      expect((await as('authenticated', admin, 'select id from public.admin_audit_log')).rows).toHaveLength(3);
      expect((await as('authenticated', admin, "insert into public.admin_audit_log(action, target) values('falso', 'x')")).error?.code).toBe('42501');
    });

    it('el último administrador no pierde el rol ni se borra; con otro admin, sí', async () => {
      await adminClaims();
      await db.exec('savepoint last');
      await expect(db.query("update public.profiles set role = 'client' where id = $1", [admin])).rejects.toThrow(/LAST_ADMIN/);
      await db.exec('rollback to savepoint last');
      await expect(db.query('delete from auth.users where id = $1', [admin])).rejects.toThrow(/LAST_ADMIN/);
      await db.exec('rollback to savepoint last; release savepoint last');
      await db.query("update public.profiles set role = 'admin' where id = $1", [clientB]);
      await db.query("update public.profiles set role = 'client' where id = $1", [admin]);
      expect(await one('select role from public.profiles where id = $1', [admin])).toEqual({ role: 'client' });
    });
  });

  describe('SEC-19: notificaciones', () => {
    const save = (user: string, endpoint: string) =>
      as('authenticated', user, 'select public.save_push_subscription($1, $2, $3) as ok', [endpoint, keys.p256dh, keys.auth]);

    it('una suscripción no pasa a otra cuenta', async () => {
      expect((await save(clientA, APPLE)).error).toBeNull();
      expect((await save(clientB, APPLE)).error?.message).toMatch(/PUSH_ENDPOINT_IN_USE/);
      expect(await one('select user_id from public.push_subscriptions where endpoint = $1', [APPLE])).toEqual({ user_id: clientA });
      expect((await save(clientA, APPLE)).error).toBeNull();
    });

    it('solo se aceptan servicios de notificación conocidos', async () => {
      for (const ok of [APPLE, 'https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x']) {
        expect((await save(clientA, ok)).error, ok).toBeNull();
      }
      for (const bad of ['https://evil.example/x', 'https://web.push.apple.com.evil.example/x', 'http://fcm.googleapis.com/x', 'https://notify.windows.com.evil/x']) {
        expect((await save(clientB, bad)).error?.message, bad).toMatch(/PUSH_ENDPOINT_HOST/);
      }
    });
  });

  describe('3.2: borrado de cuenta', () => {
    it('limpia el registro de reclasificación, las notas de sus códigos y los números de la cola', async () => {
      const tx = await movement(clientA);
      const cat = (await one('select id from public.categories where user_id = $1 limit 1', [clientA])).id;
      await db.query('insert into public.category_reclass_log(run_id, transaction_id, user_id, from_category_id, to_category_id) values(gen_random_uuid(), $1, $2, $3, $3)', [tx, clientA, cat]);
      await db.query("update public.invitation_codes set notes = 'Cliente ficticio, pagó en efectivo' where code = 'PESO-F0-2026'");
      await db.query(`insert into public.whatsapp_message_queue(wa_message_id, wa_id, user_id, payload, queue_version)
        values('viejo-1', 'synthetic-old-number', $1, '{"id":"viejo-1","from":"synthetic-old-number","type":"text"}', 2)`, [clientA]);
      await db.query("insert into public.inbound_events(wa_message_id, wa_id, status) values('viejo-1', 'synthetic-old-number', 'processed')");
      expect((await as('authenticated', clientA, 'select public.delete_my_account() as r')).error).toBeNull();
      expect(await one('select count(*)::int as n from public.category_reclass_log where user_id = $1', [clientA])).toEqual({ n: 0 });
      expect(await one("select notes from public.invitation_codes where code = 'PESO-F0-2026'")).toEqual({ notes: null });
      expect(await one("select count(*)::int as n from public.inbound_events where wa_id = 'synthetic-old-number'")).toEqual({ n: 0 });
      expect(await one('select count(*)::int as n from auth.users where id = $1', [clientB])).toEqual({ n: 1 });
    });
  });

  it('propiedades de funciones existentes sin cambios; las nuevas con permisos mínimos', async () => {
    expect((await db.query(propertiesSql)).rows).toEqual(propertiesBefore);
    const can = async (role: string, fn: string) => (await one('select has_function_privilege($1, $2, $3) as ok', [role, fn, 'execute'])).ok;
    expect(await can('anon', 'public.save_push_subscription(text,text,text)')).toBe(false);
    expect(await can('authenticated', 'public.save_push_subscription(text,text,text)')).toBe(true);
    expect(await can('anon', 'public.delete_my_account()')).toBe(false);
    expect(await can('service_role', 'public.delete_my_account()')).toBe(false);
  });
});
