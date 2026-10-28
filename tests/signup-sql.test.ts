import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect } from 'vitest';
const db = new PGlite(), root = new URL('../supabase/migrations/', import.meta.url);
const owner = '13000000-0000-4000-8000-000000000001', fresh = '13000000-0000-4000-8000-000000000002';
let legacyOrphan = false;
const query = (sql: string, values: unknown[] = []) => db.query<Record<string, unknown>>(sql, values);
async function insert(code: string | null = 'SIGNUP-TEST', extra: object = {}) {
  await query("insert into auth.users(id,email,raw_user_meta_data) values($1,'signup@example.invalid',$2::jsonb)", [fresh, JSON.stringify({ invitation_code: code, first_name: ' Ficticio ', last_name: ' Prueba ', ...extra })]);
}
async function attempt(code: string | null = 'SIGNUP-TEST') {
  await db.exec('savepoint signup');
  try { await insert(code); await db.exec('release savepoint signup'); return null; }
  catch (error) { await db.exec('rollback to savepoint signup;release savepoint signup'); return error as Error & { detail?: string; hint?: string }; }
}
async function counts() {
  return (await query("select (select count(*)::int from auth.users where id='" + fresh + "') users,(select count(*)::int from public.profiles where id='" + fresh + "') profiles,(select count(*)::int from public.app_settings where user_id='" + fresh + "') settings,(select count(*)::int from public.whatsapp_links where user_id='" + fresh + "') links,(select count(*)::int from public.categories where user_id='" + fresh + "') categories,(select is_used from public.invitation_codes where code='SIGNUP-TEST') used")).rows[0];
}
async function fixture(table: string, operation: string, body: string) {
  await db.exec(`create function public.signup_fault() returns trigger language plpgsql as $$begin ${body} end$$;create trigger signup_fault before ${operation} on public.${table} for each row execute function public.signup_fault();`);
}
beforeAll(async () => {
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;");
  for (const name of (await readdir(root)).filter(n => /^\d+.*\.sql$/.test(n) && n < '018' && n !== '002_enable_realtime.sql').sort()) await db.exec((await readFile(new URL(name, root), 'utf8')).replace('create extension if not exists pgcrypto;', '').replace(/^\uFEFF/, ''));
  await db.exec(await readFile(new URL('024_private_bootstrap_warning.sql', root), 'utf8'));
  await db.exec('begin');
  await fixture('profiles', 'insert', "raise exception 'PRIVATE_CANARY';"); await insert(null);
  legacyOrphan = (await counts()).users === 1 && (await counts()).profiles === 0;
  await db.exec('rollback');
  await db.exec("insert into auth.users(id,email)values('" + owner + "','owner@example.invalid');alter table public.profiles disable trigger tr_protect_profile_system_fields;update public.profiles set role='admin' where id='" + owner + "';alter table public.profiles enable trigger tr_protect_profile_system_fields;");
  await db.exec(await readFile(new URL('031_atomic_subscription_renewals.sql', root), 'utf8'));
  await db.exec(await readFile(new URL('032_subscription_identity_bridge.sql', root), 'utf8'));
  const before = (await query('select row_to_json(p) p from public.profiles p where id=$1', [owner])).rows;
  await db.exec(await readFile(new URL('039_atomic_user_signup.sql', root), 'utf8'));
  expect((await query('select row_to_json(p) p from public.profiles p where id=$1', [owner])).rows).toEqual(before);
}, 30000);
beforeEach(async () => { await db.exec("begin;insert into public.invitation_codes(code,duration_days)values('SIGNUP-TEST',30),('SIGNUP-LIFE',null);"); });
afterEach(async () => { await db.exec('rollback'); }); afterAll(async () => { await db.close(); });
describe('BE-13 alta atómica con las migraciones reales', () => {
  it('reproduce el usuario huérfano histórico de 016/024', () => expect(legacyOrphan).toBe(true));
  it.each(['SIGNUP-TEST', ' signup-test '])('crea todos los componentes y consume %s una vez', async code => {
    await insert(code); expect(await counts()).toEqual({ users: 1, profiles: 1, settings: 1, links: 1, categories: 16, used: true });
    const p = (await query("select role,first_name,last_name,subscription_status,round(extract(epoch from(subscription_until-now()))/86400)::int days from public.profiles where id=$1", [fresh])).rows[0];
    expect(p).toEqual({ role: 'client', first_name: 'Ficticio', last_name: 'Prueba', subscription_status: 'active', days: 30 });
    expect((await query('select used_by,used_at=now() timely from public.invitation_codes where code=$1', ['SIGNUP-TEST'])).rows[0]).toEqual({ used_by: fresh, timely: true });
  });
  it('conserva la licencia vitalicia', async () => { await insert('SIGNUP-LIFE'); expect((await query('select subscription_status,subscription_until from public.profiles where id=$1', [fresh])).rows[0]).toEqual({ subscription_status: 'active', subscription_until: null }); });
  it.each([null, '', '   '])('conserva el alta administrada sin código (%s) como pendiente', async code => { await insert(code); expect((await query('select role,subscription_status,subscription_until from public.profiles where id=$1', [fresh])).rows[0]).toEqual({ role: 'client', subscription_status: 'pending_code', subscription_until: null }); expect((await counts()).categories).toBe(16); expect((await counts()).used).toBe(false); });
  it('ignora el rol y el vencimiento proporcionados por metadata', async () => { await insert('SIGNUP-TEST', { role: 'admin', subscription_until: '2099-01-01', subscription_status: 'active' }); expect((await query('select role from public.profiles where id=$1', [fresh])).rows[0].role).toBe('client'); expect((await query("select count(*)::int n from public.profiles where role='admin'")).rows[0].n).toBe(1); });
  it.each(['INVALID', 'SIGNUP-TEST'])('rechaza un código inexistente o ya usado sin alta parcial (%s)', async code => { if (code === 'SIGNUP-TEST') await db.exec("update public.invitation_codes set is_used=true where code='SIGNUP-TEST'"); expect((await attempt(code))?.message).toBe('REGISTRATION_INITIALIZATION_FAILED'); expect((await counts()).users).toBe(0); expect((await counts()).profiles).toBe(0); });
  it('rechaza códigos normalizados ambiguos', async () => { await db.exec("insert into public.invitation_codes(code,duration_days)values('signup-test',15)"); expect(await attempt()).not.toBeNull(); expect((await counts()).users).toBe(0); expect((await counts()).used).toBe(false); });
  it.each(['app_settings', 'whatsapp_links', 'profiles', 'categories', 'invitation_codes'])('fallo en %s revierte Auth, perfil, configuración y código; el reintento funciona', async table => {
    await fixture(table, table === 'invitation_codes' ? 'update' : 'insert', "raise exception 'PRIVATE_CANARY email@example.invalid token-secret';");
    const error = await attempt(); expect(error?.message).toBe('REGISTRATION_INITIALIZATION_FAILED'); expect(error?.detail || '').toBe(''); expect(error?.hint || '').toBe('');
    expect(await counts()).toEqual({ users: 0, profiles: 0, settings: 0, links: 0, categories: 0, used: false });
    await db.exec(`drop trigger signup_fault on public.${table};drop function public.signup_fault();`);
    expect(await attempt()).toBeNull(); expect((await counts()).categories).toBe(16); expect((await counts()).used).toBe(true);
  });
  it.each(['app_settings', 'whatsapp_links', 'profiles', 'categories', 'invitation_codes'])('no anuncia éxito si un trigger omite silenciosamente %s', async table => { await fixture(table, table === 'invitation_codes' ? 'update' : 'insert', 'return null;'); expect(await attempt()).not.toBeNull(); expect(await counts()).toEqual({ users: 0, profiles: 0, settings: 0, links: 0, categories: 0, used: false }); });
  it('comprueba el perfil efectivamente insertado', async () => { await fixture('profiles', 'insert', "new.subscription_status:='pending_code';return new;"); expect(await attempt()).not.toBeNull(); expect((await counts()).used).toBe(false); });
  it('no consume un segundo código al repetir un Auth ya existente', async () => { await insert(); expect(await attempt('SIGNUP-LIFE')).not.toBeNull(); expect((await counts()).categories).toBe(16); expect((await query("select is_used from public.invitation_codes where code='SIGNUP-LIFE'")).rows[0].is_used).toBe(false); });
  it('la función no es una RPC accesible a roles de API', async () => { for (const role of ['anon', 'authenticated', 'service_role']) expect((await query("select has_function_privilege($1,'public.bootstrap_user()','EXECUTE') allowed", [role])).rows[0].allowed).toBe(false); expect((await query("select prosecdef,array_to_string(proconfig,',') config from pg_proc where oid='public.bootstrap_user()'::regprocedure")).rows[0]).toEqual({ prosecdef: true, config: 'search_path=pg_catalog, public' }); });
  it('no usa SQLERRM ni identificadores en el diagnóstico', async () => { const text = await readFile(new URL('039_atomic_user_signup.sql', root), 'utf8'); expect(text).toContain("json_build_object('event','bootstrap_user_failed','sqlstate',SQLSTATE)"); expect(text).not.toMatch(/raise warning[^;]*(new\.|sqlerrm)/i); });
});
