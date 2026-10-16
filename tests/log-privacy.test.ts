import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it } from 'vitest';
import { createLogWriter } from '../supabase/functions/whatsapp-webhook/logging';

const privateData = { text: 'PRIVATE_FINANCIAL_CANARY', phone: '5490000000000', token: 'synthetic-private-token', receipt: 'synthetic-receipt-base64' };

describe('logs operativos sin contenido sensible', () => {
  it('conserva métricas y descarta mensajes, identificadores, errores y credenciales', () => {
    const lines: string[] = [];
    const log = createLogWriter(line => lines.push(line));
    log('queue_interpret', { duration_ms: 123, operations: 3, ...privateData, wa_id: privateData.phone, error: new Error(privateData.token), nested: privateData, toJSON: () => privateData });
    expect(JSON.parse(lines[0])).toEqual({ event: 'queue_interpret', duration_ms: 123, operations: 3 });
    for (const canary of Object.values(privateData)) expect(lines.join('')).not.toContain(canary);
  });
  it('rechaza texto en campos numéricos, cifras fuera de rango y valores no finitos', () => {
    const lines: string[] = [];
    const log = createLogWriter(line => lines.push(line));
    log('queue_interpret', { duration_ms: privateData.phone, operations: 21 });
    log('queue_message', { duration_ms: Infinity, attempts: Number(privateData.phone) });
    log('queue_retry', { attempts: -1, stage: privateData.text });
    expect(lines.map(line => JSON.parse(line))).toEqual([{event:'queue_interpret'},{event:'queue_message'},{event:'queue_retry'}]);
  });
  it('solo acepta rutas, fases y estados definidos, sin URLs ni mensajes de error', () => {
    const lines: string[] = [];
    const log = createLogWriter(line => lines.push(line));
    log('queue_retry', { attempts: 2, stage: 'send' });
    log('http_request', { duration_ms: 5, status: 401, route: 'webhook', url: 'https://example.invalid/?key='+privateData.token });
    log('http_request_failed', { status: 503, route: privateData.token, duration_ms: NaN });
    expect(lines.map(line => JSON.parse(line))).toEqual([{event:'queue_retry',attempts:2,stage:'send'},{event:'http_request',duration_ms:5,status:401,route:'webhook'},{event:'http_request_failed',status:503}]);
  });
  it('no admite eventos inyectados ni propiedades heredadas del prototipo', () => {
    const lines: string[] = [];
    const log = createLogWriter(line => lines.push(line));
    type Event = Parameters<typeof log>[0];
    for (const event of ['constructor','__proto__',privateData.text,'queue_retry\n'+privateData.phone]) expect(log(event as Event, privateData)).toBe(false);
    expect(lines).toHaveLength(0);
    log('queue_worker', Object.create({ duration_ms: 99 }));
    expect(JSON.parse(lines[0])).toEqual({event:'queue_worker'});
  });
  it('no ejecuta getters o toJSON y no propaga fallos del destino', () => {
    const lines: string[] = [];
    const log = createLogWriter(line => lines.push(line));
    const metadata = { get duration_ms() { throw new Error(privateData.token); }, toJSON() { throw new Error(privateData.text); } };
    expect(log('queue_wait',metadata)).toBe(true);
    expect(JSON.parse(lines[0])).toEqual({event:'queue_wait'});
    expect(createLogWriter(() => { throw new Error(privateData.token); })('queue_worker',{duration_ms:1})).toBe(false);
  });
});

const db = new PGlite();
const migrations = new URL('../supabase/migrations/', import.meta.url);
const id = '60000000-0000-4000-8000-000000000001';
const email = 'private-canary@example.invalid';
let migration: string;
let originalDefinition: string;
let originalProperties: unknown;
const unsafeWarning = "raise warning 'Error en bootstrap_user para %: %', new.id, sqlerrm;";
const safeWarning = "raise warning '%', json_build_object('event', 'bootstrap_user_failed', 'sqlstate', SQLSTATE)::text;";
const notices: string[] = [];

beforeAll(async () => {
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const name of (await readdir(migrations)).filter(n => /^\d+.*\.sql$/.test(n) && n < '020').sort()) {
    if (name === '002_enable_realtime.sql') continue;
    let sql = (await readFile(new URL(name,migrations),'utf8')).replace(/^\uFEFF/,'');
    if (name === '001_initial.sql') sql = sql.replace('create extension if not exists pgcrypto;','');
    await db.exec(sql);
  }
  originalDefinition = (await db.query<{definition:string}>("select pg_get_functiondef('public.bootstrap_user()'::regprocedure) as definition")).rows[0].definition;
  originalProperties = (await db.query("select proowner,prosecdef,proconfig,proacl::text from pg_proc where oid='public.bootstrap_user()'::regprocedure")).rows[0];
  // Solo retirar BEGIN/COMMIT para usar el rollback exterior de cada caso.
  migration = (await readFile(new URL('024_private_bootstrap_warning.sql',migrations),'utf8')).replace(/^begin;$/m,'').replace(/^commit;$/m,'');
},30000);
beforeEach(async () => { notices.length=0; await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });
afterAll(async () => { await db.close(); });

async function rejectProfile() {
  await db.exec(`create function public.synthetic_reject_profile() returns trigger language plpgsql as $$ begin raise exception '%',new.email||' PRIVATE_FINANCIAL_CANARY'; end $$;
    create trigger synthetic_profile_failure before insert on public.profiles for each row execute function public.synthetic_reject_profile();`);
}
async function signup() {
  await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,email,JSON.stringify({first_name:'Synthetic',last_name:'Private'})],{onNotice:n => notices.push(JSON.stringify(n))});
}

describe('advertencia SQL del alta real', () => {
  it('reproduce la exposición histórica sin imprimir los datos sintéticos',async () => {
    await rejectProfile(); await signup();
    expect(notices.join('')).toContain(id);
    expect(notices.join('')).toContain(email);
    expect(notices.join('')).toContain(privateData.text);
  });
  it('registra solo evento y SQLSTATE al fallar, conservando el comportamiento anterior',async () => {
    await db.exec(migration); await rejectProfile(); await signup();
    expect(notices).toHaveLength(1);
    const warning = JSON.parse(notices[0]);
    expect(JSON.parse(warning.message)).toEqual({event:'bootstrap_user_failed',sqlstate:'P0001'});
    for (const canary of [id,email,...Object.values(privateData)]) expect(notices.join('')).not.toContain(canary);
    expect((await db.query('select (select count(*)::int from auth.users) as users,(select count(*)::int from public.profiles) as profiles')).rows[0]).toEqual({users:1,profiles:0});
  });
  it('modifica únicamente el aviso y conserva privilegios, propietario y search_path',async () => {
    await db.exec(migration);
    expect((await db.query<{definition:string}>("select pg_get_functiondef('public.bootstrap_user()'::regprocedure) as definition")).rows[0].definition).toBe(originalDefinition.replace(unsafeWarning,safeWarning));
    expect((await db.query("select proowner,prosecdef,proconfig,proacl::text from pg_proc where oid='public.bootstrap_user()'::regprocedure")).rows[0]).toEqual(originalProperties);
    await db.exec(migration);
  });
  it('conserva alta con nombres, invitación y categorías después de aplicar 024',async () => {
    await db.exec(migration);
    await db.exec("insert into public.invitation_codes(code,duration_days) values('INF09-TEST',30)");
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,email,JSON.stringify({first_name:'Synthetic',last_name:'Private',invitation_code:'INF09-TEST'})]);
    expect((await db.query('select first_name,last_name,subscription_status from public.profiles where id=$1',[id])).rows[0]).toEqual({first_name:'Synthetic',last_name:'Private',subscription_status:'active'});
    expect((await db.query<{n:number}>('select count(*)::int as n from public.categories where user_id=$1',[id])).rows[0].n).toBe(16);
    expect((await db.query<{is_used:boolean}>("select is_used from public.invitation_codes where code='INF09-TEST'")).rows[0].is_used).toBe(true);
  });
  it('se detiene si la definición cambió, sin reemplazar lógica desconocida',async () => {
    await db.exec(originalDefinition.replace(unsafeWarning,"raise warning 'SYNTHETIC_DIFFERENT_DEFINITION';"));
    await expect(db.exec(migration)).rejects.toThrow('INF09_BOOTSTRAP_DEFINITION_UNEXPECTED');
  });
});
