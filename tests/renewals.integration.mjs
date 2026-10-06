// Base PostgreSQL efímera en memoria. Nunca conecta con Supabase.
// npm install --prefix node_modules/.renewal-validation --no-audit --no-fund @electric-sql/pglite
// node tests/renewals.integration.mjs
import { PGlite } from '../node_modules/.renewal-validation/node_modules/@electric-sql/pglite/dist/index.js';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
const uid = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
let passed = 0;
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  const schema = await readFile(new URL('../supabase/migrations/005_admin_and_invitations.sql', import.meta.url), 'utf8');
  await db.exec(schema.slice(0, schema.indexOf('-- Índices')));
  await db.exec(`alter table public.profiles drop constraint profiles_subscription_status_check;
    alter table public.profiles add check (subscription_status in ('active','expired','suspended','pending_code'));
    insert into auth.users values ('${uid}'), ('${other}');`);
  await db.exec(await readFile(new URL('../supabase/migrations/013_secure_subscription_renewals.sql', import.meta.url), 'utf8'));

  async function scenario(name, { status = 'active', until = "now() + interval '20 days'", role = 'client', days = 30, actor = uid, target = uid, missing = false } = {}, verify) {
    await db.exec('begin');
    try {
      if (!missing) await db.query(`insert into public.profiles(id, role, subscription_status, subscription_until)
        values ($1, $2, $3, ${until})`, [uid, role, status]);
      await db.query("insert into public.invitation_codes(code,duration_days) values ('PESO-TEST', $1)", [days]);
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [actor]);
      const redeem = async (code = 'PESO-TEST') => (await db.query('select public.redeem_invitation_code($1,$2) as result', [code, target])).rows[0].result;
      const result = await redeem();
      const code = (await db.query("select * from public.invitation_codes where code='PESO-TEST'")).rows[0];
      const profile = (await db.query("select *, extract(epoch from (subscription_until-now())) / 86400 as days_left from public.profiles where id=$1", [uid])).rows[0];
      await verify({ result, code, profile, redeem });
      passed++;
      console.log(`PASS ${name}`);
    } finally { await db.exec('rollback'); }
  }
  const daysAre = (expected) => ({ result, code, profile }) => {
    assert.equal(result.success, true);
    assert.equal(code.is_used, true);
    assert.equal(code.used_by, uid);
    assert.equal(profile.subscription_status, 'active');
    assert.equal(Number(profile.days_left), expected);
  };
  const denied = ({ result, code }) => {
    assert.equal(result.success, false);
    assert.equal(code.is_used, false);
  };
  await scenario('vigente conserva 20 días y suma 30', {}, daysAre(50));
  await scenario('vencido renueva desde hoy', { status: 'expired', until: "now()-interval '10 days'" }, daysAre(30));
  await scenario('pendiente sin fecha activa un plan temporal', { status: 'pending_code', until: 'null' }, daysAre(30));
  await scenario('vitalicio conserva acceso y código', { until: 'null' }, (value) => {
    denied(value); assert.equal(value.profile.subscription_until, null);
  });
  await scenario('código vitalicio elimina vencimiento', { days: null }, ({ result, profile }) => {
    assert.equal(result.success, true); assert.equal(profile.subscription_until, null);
  });
  await scenario('suspendido no se reactiva', { status: 'suspended' }, (value) => {
    denied(value); assert.equal(value.profile.subscription_status, 'suspended');
  });
  await scenario('administrador no consume código', { role: 'admin', until: 'null' }, denied);
  await scenario('rechaza otro destinatario', { target: other }, denied);
  await scenario('rechaza identidad ausente', { actor: '' }, denied);
  await scenario('rechaza perfil ausente', { missing: true }, denied);
  await scenario('no reutiliza el mismo código', {}, async ({ redeem }) => {
    assert.equal((await redeem()).success, false);
    assert.equal((await redeem('NO-EXISTE')).success, false);
  });
  await scenario('dos códigos acumulan días', {}, async ({ redeem }) => {
    await db.exec("insert into public.invitation_codes(code,duration_days) values ('PESO-SECOND',30)");
    assert.equal((await redeem('PESO-SECOND')).success, true);
    const result = await db.query('select extract(epoch from (subscription_until-now()))/86400 as days from public.profiles where id=$1', [uid]);
    assert.equal(Number(result.rows[0].days), 80);
  });
  const privileges = await db.query(`select
    has_function_privilege('anon','public.redeem_invitation_code(text,uuid)','execute') as anon,
    has_function_privilege('authenticated','public.redeem_invitation_code(text,uuid)','execute') as authenticated`);
  assert.deepEqual(privileges.rows[0], { anon: false, authenticated: true });
  console.log(`${passed} escenarios SQL aprobados; permisos anon/authenticated correctos.`);
} finally {
  await db.close();
}
