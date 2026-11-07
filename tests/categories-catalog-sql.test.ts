import { PGlite } from '@electric-sql/pglite';
import { readFile as readSqlFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { NEW_CATEGORY_VISUALS } from '../src/categoryVisuals';
import { CATEGORY_NAMES } from '../supabase/functions/whatsapp-webhook/category-rules';

const readFile = async (path: URL, encoding: 'utf8') =>
  (await readSqlFile(path, encoding)).replace(/\r\n/g, '\n').replace(/^﻿/, '');

const db = new PGlite();
const migrationUrl = new URL('../supabase/migrations/', import.meta.url);
const adminUser = '50000000-0000-4000-8000-000000000003';
const userA = '50000000-0000-4000-8000-000000000001';
const userB = '50000000-0000-4000-8000-000000000002';
const fresh = '50000000-0000-4000-8000-000000000004';
const failing = '50000000-0000-4000-8000-000000000005';
const query = (sql: string, values: unknown[] = []) => db.query<Record<string, any>>(sql, values);
const expected = [
  ...CATEGORY_NAMES.expense.map(name => `expense|${name}`),
  ...CATEGORY_NAMES.income.map(name => `income|${name}`),
].sort();
let before: Record<string, Record<string, unknown>> = {};
let mascotasId = '';

async function catalog(userId: string) {
  return (await query('select id,kind,name,color,icon,active from public.categories where user_id=$1', [userId])).rows;
}
const keys = (rows: Record<string, any>[]) => rows.map(r => `${r.kind}|${r.name}`).sort();

beforeAll(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
  `);
  await db.query('insert into auth.users(id, email) values($1, $2)', [adminUser, 'admin@example.invalid']);
  for (const name of (await readdir(migrationUrl)).filter(n => /^\d+.*\.sql$/.test(n) && n < '020').sort()) {
    if (name === '002_enable_realtime.sql') continue;
    let sql = await readFile(new URL(name, migrationUrl), 'utf8');
    if (name === '001_initial.sql') sql = sql.replace('create extension if not exists pgcrypto;', '');
    await db.exec(sql);
  }
  await db.exec("insert into public.invitation_codes(code, duration_days) values('INV-A', 30), ('INV-B', 30)");
  await db.query(`
    insert into auth.users(id, email, raw_user_meta_data) values
      ($1, 'a@example.invalid', '{"invitation_code":"INV-A"}'),
      ($2, 'b@example.invalid', '{"invitation_code":"INV-B"}')
  `, [userA, userB]);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [adminUser]);
  await db.exec('grant all on all tables in schema public to service_role');
  await db.exec(await readFile(new URL('020_durable_whatsapp_queue.sql', migrationUrl), 'utf8'));
  await db.exec(`
    create schema cron; create schema net; create schema vault;
    create table net.http_request_queue(id bigint); create table net._http_response(id bigint);
    create table cron.job(jobname text, schedule text, command text);
    create table vault.decrypted_secrets(name text, decrypted_secret text);
    create table public.synthetic_http_requests(url text, headers jsonb, body jsonb);
    create function cron.schedule(text, text, text) returns bigint language plpgsql as $$ begin insert into cron.job values($1,$2,$3); return 1; end $$;
    create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) returns bigint language plpgsql as $$ begin insert into public.synthetic_http_requests values(url,headers,body); return 1; end $$;
    create schema if not exists extensions;
    create function extensions.http_set_curlopt(varchar, varchar) returns boolean language sql as $$ select true $$;
    create function extensions.http_reset_curlopt() returns boolean language sql as $$ select true $$;
    create type extensions.http_header as (field varchar, value varchar);
    create type extensions.http_request as (method varchar, uri varchar, headers extensions.http_header[], content_type varchar, content varchar);
    create function extensions.http_header(varchar, varchar) returns extensions.http_header language sql as $$ select row($1,$2)::extensions.http_header $$;
    create function extensions.http(extensions.http_request) returns table(status integer) language plpgsql as $$ begin
      insert into public.synthetic_http_requests select ($1).uri, jsonb_object_agg(h.field, h.value), ($1).content::jsonb from unnest(($1).headers) h;
      return query select 200;
    end $$;
  `);
  const strip = (s: string) => s.replace(/^create extension[^\n]+\n/gm, '');
  await db.exec(strip(await readFile(new URL('021_whatsapp_queue_recovery.sql', migrationUrl), 'utf8')));
  await db.exec(strip(await readFile(new URL('022_whatsapp_recovery_private_transport.sql', migrationUrl), 'utf8')));
  for (const f of ['023_idempotent_whatsapp_delivery', '025_cancel_stale_list_preserve_messages', '026_nonblocking_manual_review']) {
    await db.exec(await readFile(new URL(`${f}.sql`, migrationUrl), 'utf8'));
  }
  await db.exec(`alter table cron.job add column jobid bigint generated always as identity, add column active boolean default true;
    create table cron.job_run_details(jobid bigint, status text, start_time timestamptz default clock_timestamp(), end_time timestamptz);`);
  for (const f of ['027_whatsapp_observability', '028_whatsapp_issue_details', '031_atomic_subscription_renewals',
    '032_subscription_identity_bridge', '033_require_current_review_for_confirmation', '034_incomplete_draft_items',
    '035_shared_ai_quota', '037_versioned_draft_edits', '038_waiting_queue_recovery', '039_atomic_user_signup',
    '040_atomic_whatsapp_linking']) {
    await db.exec(await readFile(new URL(`${f}.sql`, migrationUrl), 'utf8'));
  }

  // Estado previo a 047: 16 categorías por usuario y una Mascotas manual en userB.
  expect((await catalog(userA)).length).toBe(16);
  await query("insert into public.categories(user_id,kind,name,color,icon) values($1,'expense','Mascotas','#123456','circle')", [userB]);
  mascotasId = (await query("select id from public.categories where user_id=$1 and name='Mascotas'", [userB])).rows[0].id;
  before = Object.fromEntries((await catalog(userA)).map(r => [`${r.kind}|${r.name}`, r]));
  await db.exec(await readFile(new URL('047_extended_categories.sql', migrationUrl), 'utf8'));
}, 60000);
afterAll(async () => { await db.close(); });

describe('BE-20 migración 047: catálogo ampliado', () => {
  it('cada usuario previo queda con las 31 categorías activas del catálogo', async () => {
    expect(expected).toHaveLength(31);
    for (const id of [userA, userB]) {
      const rows = await catalog(id);
      expect(rows.length).toBe(31);
      expect(keys(rows)).toEqual(expected);
      expect(rows.every(r => r.active)).toBe(true);
    }
  });
  it('conserva la fila Mascotas previa sin duplicarla', async () => {
    const rows = (await catalog(userB)).filter(r => r.name === 'Mascotas');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(mascotasId);
    expect(rows[0].color).toBe('#123456');
  });
  it('las 15 filas nuevas usan los visuales compartidos y las 16 previas no cambian', async () => {
    const rows = await catalog(userA);
    const added = rows.filter(r => !(`${r.kind}|${r.name}` in before));
    expect(added).toHaveLength(15);
    for (const r of added) expect({ icon: r.icon, color: r.color }, r.name).toEqual(NEW_CATEGORY_VISUALS[r.name]);
    for (const [k, old] of Object.entries(before)) {
      expect(rows.find(r => `${r.kind}|${r.name}` === k)).toEqual(old);
    }
  });
  it('es idempotente', async () => {
    const total = async () => (await query('select count(*)::int n from public.categories')).rows[0].n;
    const n = await total();
    await db.exec(await readFile(new URL('047_extended_categories.sql', migrationUrl), 'utf8'));
    expect(await total()).toBe(n);
    expect((await catalog(userA)).length).toBe(31);
  });
});

describe('BE-20 migración 047: alta con 31 categorías', () => {
  it('un alta nueva crea 31 categorías, perfil, ajustes y vínculo', async () => {
    await db.exec("insert into public.invitation_codes(code,duration_days) values('INV-NEW',30)");
    await query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'n@example.invalid','{"invitation_code":"INV-NEW"}')`, [fresh]);
    const rows = await catalog(fresh);
    expect(keys(rows)).toEqual(expected);
    for (const r of rows.filter(r => !(`${r.kind}|${r.name}` in before))) {
      expect({ icon: r.icon, color: r.color }, r.name).toEqual(NEW_CATEGORY_VISUALS[r.name]);
    }
    const n = (await query(`select (select count(*)::int from public.profiles where id=$1) p,
      (select count(*)::int from public.app_settings where user_id=$1) s,
      (select count(*)::int from public.whatsapp_links where user_id=$1) l`, [fresh])).rows[0];
    expect(n).toEqual({ p: 1, s: 1, l: 1 });
  });
  it('una falla forzada en categories revierte todo con REGISTRATION_INITIALIZATION_FAILED', async () => {
    await db.exec("insert into public.invitation_codes(code,duration_days) values('INV-FAIL',30)");
    await db.exec(`create function public.signup_fault() returns trigger language plpgsql as $$begin raise exception 'PRIVATE_CANARY'; end$$;
      create trigger signup_fault before insert on public.categories for each row execute function public.signup_fault();`);
    let error: Error | null = null;
    try {
      await query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'f@example.invalid','{"invitation_code":"INV-FAIL"}')`, [failing]);
    } catch (e) { error = e as Error; }
    await db.exec('drop trigger signup_fault on public.categories; drop function public.signup_fault();');
    expect(error?.message).toBe('REGISTRATION_INITIALIZATION_FAILED');
    const n = (await query(`select (select count(*)::int from auth.users where id=$1) u,
      (select count(*)::int from public.profiles where id=$1) p,
      (select count(*)::int from public.categories where user_id=$1) c,
      (select is_used from public.invitation_codes where code='INV-FAIL') used`, [failing])).rows[0];
    expect(n).toEqual({ u: 0, p: 0, c: 0, used: false });
  });
  it('bootstrap_user sigue sin ser ejecutable por roles de API', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect((await query("select has_function_privilege($1,'public.bootstrap_user()','execute') ok", [role])).rows[0].ok).toBe(false);
    }
    expect((await query("select prosecdef,array_to_string(proconfig,',') config from pg_proc where oid='public.bootstrap_user()'::regprocedure")).rows[0])
      .toEqual({ prosecdef: true, config: 'search_path=pg_catalog, public' });
  });
});
