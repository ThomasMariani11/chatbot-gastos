import { PGlite } from '@electric-sql/pglite';
import { readFile as readSqlFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

const readFile = async (path: URL | string, encoding: 'utf8') =>
  (await readSqlFile(path, encoding)).replace(/\r\n/g, '\n');

const db = new PGlite();
let aclBefore: unknown[];
const aclSql = "select p.proname, p.proacl::text acl, p.prosecdef, p.proconfig::text cfg, p.proowner from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('apply_whatsapp_job','confirm_draft_group','register_subscription_renewal') order by 1";
const migrationUrl = new URL('../supabase/migrations/', import.meta.url);

const userA = '50000000-0000-4000-8000-000000000001';
const adminUser = '50000000-0000-4000-8000-000000000003';

async function rpc<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const entries = Object.entries(args), placeholders = entries.map(([key], i) => `${key} => $${i + 1}`);
  await db.exec('savepoint rpc_call');
  try {
    const result = await db.query<{ result: T }>(
      `select public.${name}(${placeholders.join(',')}) as result`,
      entries.map(([, v]) => typeof v === 'object' && v !== null ? JSON.stringify(v) : v)
    );
    await db.exec('release savepoint rpc_call');
    return result.rows[0]?.result as T;
  } catch (error) {
    await db.exec('rollback to savepoint rpc_call; release savepoint rpc_call');
    throw error;
  }
}

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

  // Migraciones 001 a 040
  for (const name of (await readdir(migrationUrl)).filter(name => /^\d+.*\.sql$/.test(name) && name < '020').sort()) {
    if (name === '002_enable_realtime.sql') continue;
    let sql = await readFile(new URL(name, migrationUrl), 'utf8');
    if (name === '001_initial.sql') sql = sql.replace('create extension if not exists pgcrypto;', '');
    await db.exec(sql.replace(/^\uFEFF/, ''));
  }

  await db.exec("insert into public.invitation_codes(code, duration_days) values('SAFE-A', 30)");
  await db.query(`
    insert into auth.users(id, email, raw_user_meta_data) values
      ($1, 'safe-a@example.invalid', '{"invitation_code":"SAFE-A"}')
  `, [userA]);

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [adminUser]);
  await db.exec('grant all on all tables in schema public to service_role');

  await db.exec(await readFile(new URL('020_durable_whatsapp_queue.sql', migrationUrl), 'utf8'));

  // Mocks de cron y net requeridos para 021-023
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
      return query select coalesce(nullif(current_setting('synthetic.http_status', true), '')::integer, 200);
    end $$;
  `);

  const recovery = (await readFile(new URL('021_whatsapp_queue_recovery.sql', migrationUrl), 'utf8')).replace(/^create extension[^\n]+\n/gm, '');
  await db.exec(recovery);
  const privateTransport = (await readFile(new URL('022_whatsapp_recovery_private_transport.sql', migrationUrl), 'utf8')).replace(/^create extension[^\n]+\n/gm, '');
  await db.exec(privateTransport);
  await db.exec(await readFile(new URL('023_idempotent_whatsapp_delivery.sql', migrationUrl), 'utf8'));
  await db.exec(await readFile(new URL('025_cancel_stale_list_preserve_messages.sql', migrationUrl), 'utf8'));
  await db.exec(await readFile(new URL('026_nonblocking_manual_review.sql', migrationUrl), 'utf8'));
  await db.exec(`alter table cron.job add column jobid bigint generated always as identity, add column active boolean default true;
    create table cron.job_run_details(jobid bigint, status text, start_time timestamptz default clock_timestamp(), end_time timestamptz);`);
  await db.exec(await readFile(new URL('027_whatsapp_observability.sql', migrationUrl), 'utf8'));
  await db.exec(await readFile(new URL('028_whatsapp_issue_details.sql', migrationUrl), 'utf8'));
  await db.exec(await readFile(new URL('031_atomic_subscription_renewals.sql', migrationUrl), 'utf8'));
  await db.exec(await readFile(new URL('032_subscription_identity_bridge.sql', migrationUrl), 'utf8'));
  await db.exec(await readFile(new URL('033_require_current_review_for_confirmation.sql', migrationUrl), 'utf8'));
  await db.exec(await readFile(new URL('034_incomplete_draft_items.sql', migrationUrl), 'utf8'));
  await db.exec(await readFile(new URL('035_shared_ai_quota.sql', migrationUrl), 'utf8'));
  await db.exec(await readFile(new URL('037_versioned_draft_edits.sql', migrationUrl), 'utf8'));
  await db.exec(await readFile(new URL('038_waiting_queue_recovery.sql', migrationUrl), 'utf8'));
  await db.exec(await readFile(new URL('039_atomic_user_signup.sql', migrationUrl), 'utf8'));
  await db.exec(await readFile(new URL('040_atomic_whatsapp_linking.sql', migrationUrl), 'utf8'));

  // Aplicar migración 041
  await db.exec(await readFile(new URL('041_safe_business_errors.sql', migrationUrl), 'utf8'));
  await db.exec(await readFile(new URL('042_bulk_draft_actions.sql', migrationUrl), 'utf8'));
  await db.exec(await readFile(new URL('043_subscription_payment_codes.sql', migrationUrl), 'utf8'));
  await db.exec(await readFile(new URL('049_friendlier_bot_messages.sql', migrationUrl), 'utf8'));
  aclBefore = (await db.query(aclSql)).rows;
  await db.exec(await readFile(new URL('050_friendlier_bot_messages_2.sql', migrationUrl), 'utf8'));
}, 60000);

afterAll(async () => {
  await db.close();
});

const OLD_TEXTS = [
  'Se guardaron', 'No pudimos guardar', 'Se descartaron los movimientos pendientes', 'No tenés movimientos pendientes para guardar.',
  'La lista cambió o había mensajes en procesamiento', 'Tenés una lista de hace más de 24 horas', 'Retomamos tu lista.',
  'Lista anterior descartada.', 'El código de vinculación no es válido', 'No encontré esa categoría activa',
  'El grupo de movimientos pendiente no existe.', 'Esta lista ya fue confirmada anteriormente.', 'actualizado concurrentemente',
  'Por favor completalos o quitalos', 'hubo un problema técnico al registrar', 'Contactá al administrador antes de renovar.',
  'Tu cuenta ya tiene acceso sin vencimiento.', 'El bot está temporalmente pausado.', 'Registré tu solicitud de renovación',
  'Alias para transferencias', 'volvé a escribir RENOVAR para habilitar el envío',
];
const TARGETS = ['apply_whatsapp_job', 'confirm_draft_group', 'register_subscription_renewal'];
const body = async (name: string) => (await db.query<{ src: string }>("select prosrc src from pg_proc where proname=$1 and pronamespace='public'::regnamespace", [name])).rows[0].src;

describe('050: segunda tanda de textos del bot', () => {
  it('las funciones afectadas ya no tienen los textos anteriores', async () => {
    for (const name of TARGETS) {
      const src = await body(name);
      for (const text of OLD_TEXTS) expect(src, name + ': ' + text).not.toContain(text);
    }
  });
  it('apply_whatsapp_job usa los textos nuevos, con singular al guardar uno', async () => {
    const src = await body('apply_whatsapp_job');
    for (const text of ['¡Listo! Guardé 1 movimiento ✅', ' movimientos ✅', 'No pude guardar la lista 😕', 'Listo, descarté la lista 🗑️',
      'No tenés nada para guardar 👌', 'Tenés una lista de hace más de un día 🕒', '¡Retomamos tu lista! 👍', 'Listo, descarté la lista anterior 🗑️',
      'Ya podés mandarme tus gastos e ingresos', 'Ese código no es válido o ya venció 🤔', 'No encontré esa categoría 🤔']) expect(src).toContain(text);
  });
  it('confirmar un grupo inexistente devuelve el motivo nuevo', async () => {
    await db.exec('begin');
    const outcome = await rpc<{ success: boolean; error: string }>('confirm_draft_group', { p_group_id: '59000000-0000-4000-8000-000000000009', p_user_id: userA, p_expected_version: 1 });
    await db.exec('rollback');
    expect(outcome).toMatchObject({ success: false, error: 'No encontré tu lista. Escribí RESUMEN para verla.' });
  });
  it('la renovación usa los textos nuevos', async () => {
    const src = await body('register_subscription_renewal');
    for (const text of ['Registré tu pedido de renovación 👍', '💳 Alias para transferir: ', '💬 Soporte: https://wa.me/', 'escribí RENOVAR de nuevo.',
      'Tu cuenta no tiene vencimiento 🙌', 'El bot está en mantenimiento por un rato 🛠️', 'Tu pago ya está confirmado ✅']) expect(src).toContain(text);
  });
  it('no cambian dueño, seguridad ni permisos de las funciones', async () => {
    expect((await db.query(aclSql)).rows).toEqual(aclBefore);
  });
  it('si la definición vigente no es la esperada, aborta sin cambios', async () => {
    const before = await body('confirm_draft_group');
    await expect(db.exec(await readFile(new URL('050_friendlier_bot_messages_2.sql', migrationUrl), 'utf8'))).rejects.toThrow(/BOT_MESSAGES_2_TEXT_MISSING/);
    await db.exec('rollback');
    expect(await body('confirm_draft_group')).toBe(before);
  });
});
