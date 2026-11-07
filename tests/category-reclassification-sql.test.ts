import { PGlite } from '@electric-sql/pglite';
import { readFile as readSqlFile } from 'node:fs/promises';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  CATEGORY_RULES,
  reclassTarget,
  sqlPatternFor,
  type CategoryKind,
} from '../supabase/functions/whatsapp-webhook/category-rules';

// BE-20 migración 048: reclasificación reversible. Solo datos ficticios en PGlite.
const readFile = async (path: URL, encoding: 'utf8') =>
  (await readSqlFile(path, encoding)).replace(/\r\n/g, '\n').replace(/^﻿/, '');

const db = new PGlite();
const migrationUrl = new URL('../supabase/migrations/', import.meta.url);
const adminUser = '60000000-0000-4000-8000-000000000003';
const userA = '60000000-0000-4000-8000-000000000001';
const userB = '60000000-0000-4000-8000-000000000002';
const query = (sql: string, values: unknown[] = []) => db.query<Record<string, any>>(sql, values);
const migration048 = () => readFile(new URL('048_category_reclassification.sql', migrationUrl), 'utf8');

async function categoryId(user: string, kind: CategoryKind, name: string): Promise<string> {
  const rows = (await query('select id from public.categories where user_id=$1 and kind=$2 and name=$3', [user, kind, name])).rows;
  if (rows.length !== 1) throw new Error(`categoría ficticia ausente: ${kind}|${name}`);
  return rows[0].id;
}

type TxOptions = {
  status?: 'pending' | 'confirmed' | 'cancelled';
  group?: string | null;
  number?: number | null;
  count?: number;
};
async function tx(user: string, kind: CategoryKind, description: string, category: string, o: TxOptions = {}): Promise<string> {
  const cat = await categoryId(user, kind, category);
  const rows = (await query(`
    insert into public.transactions(user_id,kind,description,amount_ars,occurred_on,category_id,status,source,
      installment_group_id,installment_number,installment_count)
    values($1,$2,$3,1000,date '2026-10-01',$4,$5,'pwa',$6,$7,$8) returning id`,
  [user, kind, description, cat, o.status ?? 'confirmed', o.group ?? null, o.number ?? null, o.count ?? 1])).rows;
  return rows[0].id;
}

const txHash = async () =>
  (await query("select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) h from public.transactions t")).rows[0].h;
const categoryOf = async (id: string) =>
  (await query('select c.name from public.transactions t join public.categories c on c.id=t.category_id where t.id=$1', [id])).rows[0]?.name;
const preview = async () =>
  (await query('select kind::text, from_category, to_category, movements::int from public.category_reclass_preview() order by 1,2,3')).rows;
const candidates = async () =>
  (await query('select transaction_id, user_id, kind::text, from_category_id, to_category_id from public.category_reclass_candidates()')).rows;

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
  const { readdir } = await import('node:fs/promises');
  for (const name of (await readdir(migrationUrl)).filter(n => /^\d+.*\.sql$/.test(n) && n < '020').sort()) {
    if (name === '002_enable_realtime.sql') continue;
    let sql = await readFile(new URL(name, migrationUrl), 'utf8');
    if (name === '001_initial.sql') sql = sql.replace('create extension if not exists pgcrypto;', '');
    await db.exec(sql);
  }
  await db.exec("insert into public.invitation_codes(code, duration_days) values('INV-RA', 30), ('INV-RB', 30)");
  await db.query(`
    insert into auth.users(id, email, raw_user_meta_data) values
      ($1, 'ra@example.invalid', '{"invitation_code":"INV-RA"}'),
      ($2, 'rb@example.invalid', '{"invitation_code":"INV-RB"}')
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
    '040_atomic_whatsapp_linking', '047_extended_categories']) {
    await db.exec(await readFile(new URL(`${f}.sql`, migrationUrl), 'utf8'));
  }
  await db.exec(await migration048());
}, 60000);
afterAll(async () => { await db.close(); });

describe('BE-20 migración 048: reglas y paridad TS ↔ SQL', () => {
  it('las reglas SQL son las del catálogo compartido, byte a byte', async () => {
    const expected = CATEGORY_RULES.filter(r => r.keywords.length)
      .map(r => ({ kind: r.kind, name: r.name, is_new: r.isNew, pattern: sqlPatternFor(r) }))
      .sort((a, b) => `${a.kind}|${a.name}`.localeCompare(`${b.kind}|${b.name}`));
    const rows = (await query('select kind::text, name, is_new, pattern from public.category_reclass_rules')).rows
      .sort((a, b) => `${a.kind}|${a.name}`.localeCompare(`${b.kind}|${b.name}`));
    expect(rows).toEqual(expected);
    expect(rows[0].pattern.startsWith('\\y(')).toBe(true);
  });

  it('category_reclass_target da el mismo resultado final que reclassTarget', async () => {
    const concepts = ['Netflix', 'PedidosYa', 'Super y café', 'Nafta y lavadero', 'Supermercado', 'Varios',
      'Creatina', 'Cochera', 'Veterinaria', 'Alquiler', 'CAFÉ con leche', 'Peluquería', 'Pañales', 'Devolución'];
    for (const description of concepts) {
      for (const kind of ['expense', 'income'] as const) {
        const sql = (await query('select public.category_reclass_target($1,$2) t', [kind, description])).rows[0].t;
        expect(sql, `${kind}|${description}`).toBe(reclassTarget(description, kind));
      }
    }
    // Controles explícitos de la lista del plan.
    expect(reclassTarget('Netflix', 'expense')).toBe('Suscripciones');
    expect(reclassTarget('Super y café', 'expense')).toBeNull();
    expect(reclassTarget('Alquiler', 'income')).toBe('Alquileres');
  });
});

describe('BE-20 migración 048: vista previa, cuotas y aislamiento', () => {
  const ids: Record<string, string> = {};

  it('la vista previa agrega por origen → destino y no modifica transactions', async () => {
    ids.netflixOcio = await tx(userA, 'expense', 'Netflix', 'Ocio');
    ids.cafe = await tx(userA, 'expense', 'Café', 'Alimentación');
    ids.creatina = await tx(userA, 'expense', 'Creatina', 'Salud');
    ids.ambiguo = await tx(userA, 'expense', 'Super y café', 'Alimentación');
    ids.netflixServicios = await tx(userA, 'expense', 'Netflix', 'Servicios');
    ids.netflixPending = await tx(userA, 'expense', 'Netflix', 'Ocio', { status: 'pending' });
    ids.alquiler = await tx(userA, 'income', 'Alquiler', 'Otros');
    const before = await txHash();
    expect(await preview()).toEqual([
      { kind: 'expense', from_category: 'Alimentación', to_category: 'Restaurantes y delivery', movements: 1 },
      { kind: 'expense', from_category: 'Ocio', to_category: 'Suscripciones', movements: 1 },
      { kind: 'expense', from_category: 'Salud', to_category: 'Deporte', movements: 1 },
      { kind: 'income', from_category: 'Otros', to_category: 'Alquileres', movements: 1 },
    ]);
    expect(await txHash()).toBe(before);
  });

  it('volver a aplicar 048 no mueve datos ni duplica reglas', async () => {
    const before = await txHash();
    const rules = (await query('select count(*)::int n from public.category_reclass_rules')).rows[0].n;
    await db.exec(await migration048());
    expect(await txHash()).toBe(before);
    expect((await query('select count(*)::int n from public.category_reclass_rules')).rows[0].n).toBe(rules);
    expect((await query('select count(*)::int n from public.category_reclass_log')).rows[0].n).toBe(0);
  });

  it('un plan en cuotas se mueve entero (cabecera incluida) o no se mueve', async () => {
    // Plan PWA: cabecera cancelled (id = grupo) + 3 cuotas confirmed.
    const header = await tx(userA, 'expense', 'Notebook', 'Compras', { status: 'cancelled', count: 3 });
    const plan = [header];
    for (const n of [1, 2, 3]) plan.push(await tx(userA, 'expense', 'Notebook', 'Compras', { group: header, number: n, count: 3 }));
    // Plan con una cuota editada a "Varios": no se mueve ninguna fila.
    const mixedHeader = await tx(userA, 'expense', 'Monitor', 'Compras', { status: 'cancelled', count: 3 });
    const mixed = [mixedHeader];
    for (const n of [1, 2, 3]) {
      mixed.push(await tx(userA, 'expense', n === 2 ? 'Varios' : 'Monitor', 'Compras', { group: mixedHeader, number: n, count: 3 }));
    }
    // Plan cuyas cuotas apuntan a destinos nuevos distintos: no se mueve.
    const splitHeader = await tx(userA, 'expense', 'Tablet', 'Compras', { status: 'cancelled', count: 2 });
    mixed.push(splitHeader, await tx(userA, 'expense', 'Tablet', 'Compras', { group: splitHeader, number: 1, count: 2 }),
      await tx(userA, 'expense', 'Juguete', 'Compras', { group: splitHeader, number: 2, count: 2 }));
    // Plan WhatsApp sin cabecera: las cuotas apuntan a la primera fila.
    const first = await tx(userA, 'expense', 'Auriculares', 'Compras', { number: 1, count: 2 });
    const wa = [first, await tx(userA, 'expense', 'Auriculares', 'Compras', { group: first, number: 2, count: 2 })];
    // Cancelada que no es cabecera: excluida.
    ids.cancelled = await tx(userA, 'expense', 'Netflix', 'Ocio', { status: 'cancelled' });
    Object.assign(ids, { header, mixedHeader, first });

    const c = await candidates();
    const tecnologia = await categoryId(userA, 'expense', 'Tecnología');
    const byId = new Map(c.map(r => [r.transaction_id, r]));
    for (const id of [...plan, ...wa]) expect(byId.get(id)?.to_category_id, id).toBe(tecnologia);
    for (const id of [...mixed, ids.cancelled, ids.netflixPending, ids.netflixServicios, ids.ambiguo]) {
      expect(byId.has(id), id).toBe(false);
    }
    expect((await preview()).find(r => r.from_category === 'Compras')).toEqual(
      { kind: 'expense', from_category: 'Compras', to_category: 'Tecnología', movements: 6 });
  });

  it('el destino siempre es una categoría activa del mismo usuario', async () => {
    ids.vetB = await tx(userB, 'expense', 'Veterinaria', 'Otros');
    ids.spotifyB = await tx(userB, 'expense', 'Spotify', 'Ocio');
    await query("update public.categories set active=false where user_id=$1 and kind='expense' and name='Suscripciones'", [userB]);
    const c = await candidates();
    const vet = c.find(r => r.transaction_id === ids.vetB);
    expect(vet?.to_category_id).toBe(await categoryId(userB, 'expense', 'Mascotas'));
    expect(vet?.user_id).toBe(userB);
    expect(c.some(r => r.transaction_id === ids.spotifyB)).toBe(false);
    const foreign = (await query(`
      select count(*)::int n from public.category_reclass_candidates() c
      join public.categories t on t.id=c.to_category_id
      join public.categories f on f.id=c.from_category_id
      where t.user_id<>c.user_id or f.user_id<>c.user_id or t.kind<>c.kind or not t.active`)).rows[0].n;
    expect(foreign).toBe(0);
  });

  it('apply mueve lo previsto, registra el lote y es idempotente', async () => {
    const expectedMoved = (await preview()).reduce((n, r) => n + r.movements, 0);
    const planned = await candidates();
    expect(expectedMoved).toBe(planned.length);
    const first = (await query('select run_id, moved::int from public.category_reclass_apply()')).rows[0];
    expect(first.moved).toBe(expectedMoved);
    ids.run = first.run_id;
    for (const p of planned) {
      const row = (await query('select category_id from public.transactions where id=$1', [p.transaction_id])).rows[0];
      expect(row.category_id).toBe(p.to_category_id);
    }
    const log = (await query('select count(*)::int n from public.category_reclass_log where run_id=$1 and reverted_at is null and applied_at is not null', [ids.run])).rows[0].n;
    expect(log).toBe(expectedMoved);
    expect(await categoryOf(ids.netflixOcio)).toBe('Suscripciones');
    expect(await categoryOf(ids.netflixPending)).toBe('Ocio');
    expect(await categoryOf(ids.netflixServicios)).toBe('Servicios');
    expect(await categoryOf(ids.ambiguo)).toBe('Alimentación');
    expect(await preview()).toEqual([]);
    const second = (await query('select run_id, moved::int from public.category_reclass_apply()')).rows[0];
    expect(second.moved).toBe(0);
    expect(second.run_id).not.toBe(ids.run);
  });

  it('revert restaura todo menos lo que el cliente editó después', async () => {
    const moved = (await query('select count(*)::int n from public.category_reclass_log where run_id=$1', [ids.run])).rows[0].n;
    // El cliente devolvió uno a Ocio y cambió otro a Servicios.
    await query('update public.transactions set category_id=$2 where id=$1', [ids.netflixOcio, await categoryId(userA, 'expense', 'Ocio')]);
    await query('update public.transactions set category_id=$2 where id=$1', [ids.cafe, await categoryId(userA, 'expense', 'Servicios')]);
    const restored = (await query('select public.category_reclass_revert($1)::int n', [ids.run])).rows[0].n;
    expect(restored).toBe(moved - 2);
    expect(await categoryOf(ids.netflixOcio)).toBe('Ocio');
    expect(await categoryOf(ids.cafe)).toBe('Servicios');
    expect(await categoryOf(ids.creatina)).toBe('Salud');
    expect(await categoryOf(ids.alquiler)).toBe('Otros');
    expect(await categoryOf(ids.header)).toBe('Compras');
    expect(await categoryOf(ids.first)).toBe('Compras');
    expect(await categoryOf(ids.vetB)).toBe('Otros');
    const pending = (await query('select transaction_id from public.category_reclass_log where run_id=$1 and reverted_at is null', [ids.run])).rows
      .map(r => r.transaction_id).sort();
    expect(pending).toEqual([ids.netflixOcio, ids.cafe].sort());
    expect((await query('select public.category_reclass_revert($1)::int n', [ids.run])).rows[0].n).toBe(0);
  });
});

describe('BE-20 migración 048: permisos', () => {
  const fns = ['public.category_reclass_target(public.transaction_kind,text)', 'public.category_reclass_candidates()',
    'public.category_reclass_preview()', 'public.category_reclass_apply()', 'public.category_reclass_revert(uuid)'];

  it('las funciones no son ejecutables por roles de API y son security definer con search_path fijo', async () => {
    for (const fn of fns) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        expect((await query('select has_function_privilege($1,$2,$3) ok', [role, fn, 'execute'])).rows[0].ok, `${role} ${fn}`).toBe(false);
      }
      expect((await query('select prosecdef,array_to_string(proconfig,\',\') config from pg_proc where oid=$1::regprocedure', [fn])).rows[0])
        .toEqual({ prosecdef: true, config: 'search_path=pg_catalog, public' });
    }
    expect((await query("select has_function_privilege('authenticated','public.category_reclass_apply()','execute') ok")).rows[0].ok).toBe(false);
    expect((await query("select has_function_privilege('anon','public.category_reclass_apply()','execute') ok")).rows[0].ok).toBe(false);
  });

  it('las tablas son privadas y tienen RLS', async () => {
    for (const table of ['public.category_reclass_log', 'public.category_reclass_rules']) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          expect((await query('select has_table_privilege($1,$2,$3) ok', [role, table, priv])).rows[0].ok, `${role} ${priv} ${table}`).toBe(false);
        }
      }
      expect((await query('select relrowsecurity from pg_class where oid=$1::regclass', [table])).rows[0].relrowsecurity).toBe(true);
    }
  });
});
