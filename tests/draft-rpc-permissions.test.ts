import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// PostgreSQL efímero, sin URL, credenciales, red ni conexión a Supabase.
const db = new PGlite();
const migrationsUrl = new URL('../supabase/migrations/', import.meta.url);
const migrationName = '017_restrict_draft_rpc_execution.sql';
const userA = '00000000-0000-4000-8000-000000000001';
const userB = '00000000-0000-4000-8000-000000000002';
const admin = '00000000-0000-4000-8000-000000000003';
const groupA = '10000000-0000-4000-8000-000000000001';
const groupB = '10000000-0000-4000-8000-000000000002';
const signatures = [
  'public.get_active_draft_group(uuid)',
  'public.confirm_draft_group(uuid,uuid,integer)',
  'public.discard_draft_group(uuid,uuid)',
];
type Role = 'anon' | 'authenticated' | 'service_role';

async function snapshot() {
  const result = await db.query(`select
    (select coalesce(jsonb_agg(to_jsonb(g) order by id), '[]') from public.draft_groups g) as groups,
    (select coalesce(jsonb_agg(to_jsonb(i) order by id), '[]') from public.draft_items i) as items,
    (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]') from public.transactions t) as transactions`);
  return result.rows[0];
}

async function definitions() {
  const result = await db.query(`select oid::regprocedure::text as signature, pg_get_functiondef(oid) as body
    from pg_proc where oid = any($1::regprocedure[]) order by 1`, [signatures]);
  return result.rows;
}

async function call<T>(role: Role, sql: string, args: unknown[], actor = '', claim = role) {
  await db.exec('savepoint rpc_call');
  try {
    // Roles elegidos exclusivamente del tipo local; valores de usuario parametrizados.
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)", [actor, claim]);
    const result = await db.query<{ result: T }>(sql, args);
    await db.exec('reset role; release savepoint rpc_call');
    return result.rows[0].result;
  } catch (error) {
    // El error 42501 aborta la sentencia: recuperar antes de inspeccionar datos.
    await db.exec('rollback to savepoint rpc_call; release savepoint rpc_call');
    throw error;
  }
}

beforeAll(async () => {
  await db.exec(`
    create role anon nologin nosuperuser nobypassrls;
    create role authenticated nologin nosuperuser nobypassrls;
    create role service_role nologin nosuperuser bypassrls;
    create role untrusted_probe nologin nosuperuser nobypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    insert into auth.users(id, email) values ('${admin}', 'admin@example.invalid');
  `);
  const files = (await readdir(migrationsUrl)).filter(name => /^\d+.*\.sql$/.test(name) && name < migrationName).sort();
  for (const name of files) {
    // Realtime es infraestructura de Supabase, no participa de estas RPC.
    if (name === '002_enable_realtime.sql') continue;
    let sql = (await readFile(new URL(name, migrationsUrl), 'utf8')).replace(/^\uFEFF/, '');
    // PGlite incluye gen_random_uuid; no distribuye la extensión pgcrypto.
    if (name === '001_initial.sql') sql = sql.replace('create extension if not exists pgcrypto;', '');
    await db.exec(sql);
  }
  // Alta real a través del bootstrap de 016, con invitaciones ficticias.
  await db.exec(`
    insert into public.invitation_codes(code, duration_days) values ('TEST-A', 30), ('TEST-B', 30);
    insert into auth.users(id, email, raw_user_meta_data) values
      ('${userA}', 'a@example.invalid', '{"invitation_code":"TEST-A"}'),
      ('${userB}', 'b@example.invalid', '{"invitation_code":"TEST-B"}');
    insert into public.draft_groups(id, user_id) values ('${groupA}', '${userA}'), ('${groupB}', '${userB}');
    insert into public.draft_items(group_id,user_id,position,kind,description,amount,currency,occurred_on,installments,wa_message_id) values
      ('${groupA}','${userA}',1,'expense','Supermercado',15000,'ARS','2026-10-14',1,'test-a'),
      ('${groupA}','${userA}',2,'income','Diseño',80,'USD','2026-10-14',1,'test-a'),
      ('${groupA}','${userA}',3,'expense','Compra en cuotas',100,'ARS','2026-10-14',3,'test-a'),
      ('${groupB}','${userB}',1,'expense','Transporte',4000,'ARS','2026-10-14',1,'test-b');
  `);

  // Reproducir el defecto original antes de aplicar el arreglo.
  await db.exec('begin');
  try {
    expect(await call<{ found: boolean }>('anon', 'select public.get_active_draft_group($1) as result', [userB])).toMatchObject({ found: true });
    expect(await call<{ success: boolean }>('authenticated', 'select public.confirm_draft_group($1,$2,1) as result', [groupB, userB], userA)).toMatchObject({ success: true });
  } finally {
    await db.exec('rollback');
  }

  const before = await snapshot();
  const bodies = await definitions();
  const migration = await readFile(new URL(migrationName, migrationsUrl), 'utf8');
  await db.exec(migration);
  expect(await snapshot()).toEqual(before);
  expect(await definitions()).toEqual(bodies);
  // También debe ser seguro volver a ejecutar el archivo de permisos.
  await db.exec(migration);
  expect(await snapshot()).toEqual(before);
}, 30000);

beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });
afterAll(async () => { await db.close(); });

describe('INF-01 / BE-01: RPC exclusivas del backend', () => {
  it.each(signatures)('restringe ACL efectiva y PUBLIC de %s', async signature => {
    const result = await db.query(`select
      has_function_privilege('anon', $1, 'execute') as anon,
      has_function_privilege('authenticated', $1, 'execute') as authenticated,
      has_function_privilege('untrusted_probe', $1, 'execute') as public_probe,
      has_function_privilege('service_role', $1, 'execute') as service_role`, [signature]);
    expect(result.rows[0]).toEqual({ anon: false, authenticated: false, public_probe: false, service_role: true });
  });

  const operations = [
    ['leer', 'select public.get_active_draft_group($1) as result', [userB]],
    ['confirmar', 'select public.confirm_draft_group($1,$2,1) as result', [groupB, userB]],
    ['confirmar sin versión', 'select public.confirm_draft_group($1,$2) as result', [groupB, userB]],
    ['descartar', 'select public.discard_draft_group($1,$2) as result', [groupB, userB]],
  ] as const;

  for (const role of ['anon', 'authenticated'] as const) {
    for (const [name, sql, args] of operations) {
      it(`${role} no puede ${name} datos ajenos ni alterarlos`, async () => {
        const before = await snapshot();
        await expect(call(role, sql, [...args], role === 'anon' ? '' : userA)).rejects.toMatchObject({ code: '42501' });
        expect(await snapshot()).toEqual(before);
      });
    }
  }

  it('una sesión cliente tampoco puede invocar sus propios borradores', async () => {
    for (const [, sql, args] of operations) {
      await expect(call('authenticated', sql, [...args], userB)).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('un administrador de la PWA tampoco recibe permisos del backend', async () => {
    for (const [, sql, args] of operations) {
      await expect(call('authenticated', sql, [...args], admin)).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('cambiar el claim a service_role no cambia el rol PostgreSQL autorizado', async () => {
    await expect(call('authenticated', operations[1][1], [groupB, userB], userA, 'service_role')).rejects.toMatchObject({ code: '42501' });
  });

  it('el backend lee solo el grupo del usuario solicitado', async () => {
    const result = await call<{ found: boolean; group_id: string; items: unknown[] }>('service_role', operations[0][1], [userA]);
    expect(result).toMatchObject({ found: true, group_id: groupA });
    expect(result.items).toHaveLength(3);
  });

  it('el backend confirma monedas y cuotas sin tocar el otro cliente', async () => {
    const beforeB = await db.query('select * from public.draft_items where user_id=$1 order by id', [userB]);
    const result = await call('service_role', operations[1][1], [groupA, userA]);
    expect(result).toMatchObject({ success: true, confirmed_movements: 3, created_transactions: 5 });
    const totals = await db.query('select currency, sum(amount_ars)::text as total from public.transactions where user_id=$1 group by currency order by currency', [userA]);
    expect(totals.rows).toEqual([{ currency: 'ARS', total: '15100.00' }, { currency: 'USD', total: '80.00' }]);
    expect((await db.query('select * from public.draft_items where user_id=$1 order by id', [userB])).rows).toEqual(beforeB.rows);
    expect(await call('service_role', operations[1][1], [groupA, userA])).toMatchObject({ success: false });
    expect((await db.query('select count(*)::int as count from public.transactions')).rows[0]).toEqual({ count: 5 });
  });

  it('el backend descarta únicamente el grupo solicitado', async () => {
    expect(await call('service_role', operations[3][1], [groupA, userA])).toMatchObject({ success: true });
    const groups = await db.query('select id,status from public.draft_groups order by id');
    expect(groups.rows).toEqual([{ id: groupA, status: 'discarded' }, { id: groupB, status: 'open' }]);
    expect((await db.query<{ status: string }>('select status from public.draft_items where group_id=$1', [groupA])).rows.every(row => row.status === 'removed')).toBe(true);
    expect((await db.query('select count(*)::int as count from public.transactions')).rows[0]).toEqual({ count: 0 });
  });

  it('el backend no opera un grupo con otro propietario o versión', async () => {
    const before = await snapshot();
    expect(await call('service_role', operations[1][1], [groupB, userA])).toMatchObject({ success: false });
    expect(await call('service_role', operations[3][1], [groupB, userA])).toMatchObject({ success: false });
    expect(await call('service_role', 'select public.confirm_draft_group($1,$2,99) as result', [groupA, userA])).toMatchObject({ success: false });
    expect(await snapshot()).toEqual(before);
  });

  it.each(['suspended', 'expired', 'pending_code', 'past_due'])('conserva el bloqueo de confirmación para %s', async status => {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [admin]);
    await db.query(`update public.profiles set subscription_status=$1,
      subscription_until=case when $2 then now()-interval '1 day' else subscription_until end where id=$3`, [status === 'past_due' ? 'active' : status, status === 'past_due', userA]);
    const before = await snapshot();
    expect(await call('service_role', operations[1][1], [groupA, userA])).toMatchObject({ success: false });
    expect(await snapshot()).toEqual(before);
  });

  it('no bloquea las RPC públicas de invitación ni las de sesión', async () => {
    expect(await call('anon', "select public.check_invitation_code('MISSING-CODE') as result", [])).toMatchObject({ valid: false });
    expect(await call('authenticated', 'select public.get_my_role() as result', [], userA)).toBe('client');
    const privileges = await db.query("select has_function_privilege('authenticated','public.redeem_invitation_code(text,uuid)','execute') as allowed");
    expect(privileges.rows[0]).toEqual({ allowed: true });
  });
});
