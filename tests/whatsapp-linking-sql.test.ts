import { PGlite } from '@electric-sql/pglite';
import { readFile as readSqlFile, readdir } from 'node:fs/promises';
import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

const readFile = async (path: URL | string, encoding: 'utf8') =>
  (await readSqlFile(path, encoding)).replace(/\r\n/g, '\n');

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

const db = new PGlite();
const migrationUrl = new URL('../supabase/migrations/', import.meta.url);

const userA = '40000000-0000-4000-8000-000000000001';
const userB = '40000000-0000-4000-8000-000000000002';
const adminUser = '40000000-0000-4000-8000-000000000003';
const token1 = '41000000-0000-4000-8000-000000000001';
const token2 = '41000000-0000-4000-8000-000000000002';

const applyPropertiesSql = "select proowner,proacl::text,prosecdef,proconfig from pg_proc where oid='public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure";
let applyPropertiesBefore: unknown;

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

async function actAs(userId: string | null) {
  if (userId) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  } else {
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
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

  // Migraciones 001 a 019
  for (const name of (await readdir(migrationUrl)).filter(name => /^\d+.*\.sql$/.test(name) && name < '020').sort()) {
    if (name === '002_enable_realtime.sql') continue;
    let sql = await readFile(new URL(name, migrationUrl), 'utf8');
    if (name === '001_initial.sql') sql = sql.replace('create extension if not exists pgcrypto;', '');
    await db.exec(sql.replace(/^\uFEFF/, ''));
  }

  await db.exec("insert into public.invitation_codes(code, duration_days) values('INV-A', 30), ('INV-B', 30)");
  await db.query(`
    insert into auth.users(id, email, raw_user_meta_data) values
      ($1, 'a@example.invalid', '{"invitation_code":"INV-A"}'),
      ($2, 'b@example.invalid', '{"invitation_code":"INV-B"}')
  `, [userA, userB]);

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [adminUser]);
  await db.exec('grant all on all tables in schema public to service_role');

  // Cargar migración 020
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

  applyPropertiesBefore = (await db.query(applyPropertiesSql)).rows;

  // Aplicar migración 040
  await db.exec(await readFile(new URL('040_atomic_whatsapp_linking.sql', migrationUrl), 'utf8'));
}, 30000);

beforeEach(async () => {
  await db.exec('begin; update public.whatsapp_queue_control set enabled=true');
});

afterEach(async () => {
  await db.exec('rollback');
});

afterAll(async () => {
  await db.close();
});

describe('BE-14: Vinculación atómica y límites de intentos', () => {
  it('conserva el propietario, permisos y opciones de apply_whatsapp_job', async () => {
    const after = (await db.query(applyPropertiesSql)).rows;
    expect(after).toEqual(applyPropertiesBefore);
  });

  describe('check_invitation_code', () => {
    it('valida un código existente no utilizado y calcula días', async () => {
      await db.exec("insert into public.invitation_codes(code, duration_days) values('CHECK-VALID', 45)");
      const res = await rpc<{ valid: boolean; duration_days: number }>('check_invitation_code', { p_code: 'check-valid' });
      expect(res.valid).toBe(true);
      expect(res.duration_days).toBe(45);
    });

    it('devuelve error genérico y seguro para código inexistente sin revelar detalles', async () => {
      const res = await rpc<{ valid: boolean; error: string }>('check_invitation_code', { p_code: 'NON-EXISTENT' });
      expect(res.valid).toBe(false);
      expect(res.error).toBe('Código de invitación inválido o no disponible.');
    });

    it('devuelve el MISMO error genérico para código ya utilizado', async () => {
      await db.exec("insert into public.invitation_codes(code, duration_days, is_used) values('CHECK-USED', 30, true)");
      const res = await rpc<{ valid: boolean; error: string }>('check_invitation_code', { p_code: 'CHECK-USED' });
      expect(res.valid).toBe(false);
      expect(res.error).toBe('Código de invitación inválido o no disponible.');
    });

    it('devuelve error para código vencido en servidor', async () => {
      await db.exec("insert into public.invitation_codes(code, duration_days, expires_at) values('CHECK-EXPIRED', 30, clock_timestamp() - interval '1 day')");
      const res = await rpc<{ valid: boolean; error: string }>('check_invitation_code', { p_code: 'CHECK-EXPIRED' });
      expect(res.valid).toBe(false);
      expect(res.error).toBe('Código de invitación inválido o no disponible.');
    });

    it('bloquea por exceso de intentos tras 15 consultas en 1 minuto', async () => {
      // Simular IP ficticia en headers
      await db.query("select set_config('request.headers', '{\"x-forwarded-for\":\"192.0.2.1\"}', true)");
      for (let i = 0; i < 15; i++) {
        await rpc('check_invitation_code', { p_code: `TEST-TRY-${i}` });
      }
      const lockedRes = await rpc<{ valid: boolean; error: string }>('check_invitation_code', { p_code: 'ANY-CODE' });
      expect(lockedRes.valid).toBe(false);
      expect(lockedRes.error).toBe('Demasiados intentos. Esperá unos minutos antes de volver a probar.');
    });
  });

  describe('redeem_invitation_code y bootstrap_user con expires_at', () => {
    it('redeem_invitation_code rechaza un código vencido y no lo consume', async () => {
      await db.exec("insert into public.invitation_codes(code, duration_days, expires_at) values('RENEW-EXP', 30, clock_timestamp() - interval '1 hour')");
      await actAs(userA);
      const res = await rpc<{ success: boolean; error: string }>('redeem_invitation_code', { p_code: 'RENEW-EXP', p_user_id: userA });
      expect(res.success).toBe(false);
      expect(res.error).toBe('Código de invitación inválido o no disponible.');
      const codeRow = (await db.query<{ is_used: boolean }>("select is_used from public.invitation_codes where code='RENEW-EXP'")).rows[0];
      expect(codeRow.is_used).toBe(false);
    });

    it('bootstrap_user rechaza el alta con un código vencido y revierte todo', async () => {
      await db.exec("insert into public.invitation_codes(code, duration_days, expires_at) values('SIGNUP-EXP', 30, clock_timestamp() - interval '1 hour')");
      const freshUser = '40000000-0000-4000-8000-000000000099';
      await db.exec('savepoint test_signup');
      let failed = false;
      try {
        await db.query(
          "insert into auth.users(id, email, raw_user_meta_data) values($1, 'fresh@example.invalid', $2::jsonb)",
          [freshUser, JSON.stringify({ invitation_code: 'SIGNUP-EXP', first_name: 'Test', last_name: 'Exp' })]
        );
      } catch (err: unknown) {
        failed = true;
        await db.exec('rollback to savepoint test_signup');
      }
      expect(failed).toBe(true);
      const profileCount = (await db.query<{ n: number }>("select count(*)::int as n from public.profiles where id='40000000-0000-4000-8000-000000000099'")).rows[0].n;
      expect(profileCount).toBe(0);
    });
  });

  describe('apply_whatsapp_job: vinculación atómica de WhatsApp', () => {
    const waSender = '5491100001111';

    async function generateCodeForUser(userId: string): Promise<string> {
      await actAs(userId);
      const res = await rpc<{ code: string; expires_at: string }>('request_whatsapp_link_code');
      return res.code;
    }

    async function enqueueAndClaimJob(sender: string, actionJson: Record<string, unknown>, token = token1) {
      await db.query(
        "insert into public.whatsapp_worker_state(wa_id) values($1) on conflict do nothing",
        [sender]
      );
      await rpc('claim_whatsapp_actor', { p_wa_id: sender, p_token: token });

      const msgId = 'msg-' + Math.random().toString(36).substring(2, 9);
      await db.query(`
        insert into public.whatsapp_message_queue(wa_message_id, wa_id, payload, queue_version, status, attempts)
        values($1, $2, '{"type":"text"}', 2, 'processing', 1)
      `, [msgId, sender]);

      const jobRow = (await db.query<{ id: string }>(
        "select id from public.whatsapp_message_queue where wa_message_id=$1",
        [msgId]
      )).rows[0];

      return await rpc<{ reply_text: string }>(
        'apply_whatsapp_job',
        { p_id: jobRow.id, p_token: token, p_action: actionJson }
      );
    }

    it('vincula exitosamente con código válido y asocia teléfono a perfil y whatsapp_links', async () => {
      const code = await generateCodeForUser(userA);
      const hash = sha256(code);

      const job = await enqueueAndClaimJob(waSender, { kind: 'link', hash });
      expect(job.reply_text).toBe('¡Listo! Tu WhatsApp quedó vinculado con Pesito ✅');

      const link = (await db.query<{ status: string; wa_id: string; link_code_hash: string | null }>(
        "select status, wa_id, link_code_hash from public.whatsapp_links where user_id=$1",
        [userA]
      )).rows[0];
      expect(link.status).toBe('active');
      expect(link.wa_id).toBe(waSender);
      expect(link.link_code_hash).toBeNull();

      const profile = (await db.query<{ phone_number: string }>(
        "select phone_number from public.profiles where id=$1",
        [userA]
      )).rows[0];
      expect(profile.phone_number).toBe(waSender);

      const worker = (await db.query<{ user_id: string; link_attempts: number; link_locked_until: string | null }>(
        "select user_id, link_attempts, link_locked_until from public.whatsapp_worker_state where wa_id=$1",
        [waSender]
      )).rows[0];
      expect(worker.user_id).toBe(userA);
      expect(worker.link_attempts).toBe(0);
      expect(worker.link_locked_until).toBeNull();
    });

    it('desvincula atómicamente a un propietario previo del mismo teléfono', async () => {
      // Primero vincular a userA
      const codeA = await generateCodeForUser(userA);
      await enqueueAndClaimJob(waSender, { kind: 'link', hash: sha256(codeA) });

      // Ahora vincular el mismo waSender a userB
      const codeB = await generateCodeForUser(userB);
      const jobB = await enqueueAndClaimJob(waSender, { kind: 'link', hash: sha256(codeB) });
      expect(jobB.reply_text).toBe('¡Listo! Tu WhatsApp quedó vinculado con Pesito ✅');

      // userA ya no tiene waSender
      const linkA = (await db.query<{ status: string; wa_id: string | null }>(
        "select status, wa_id from public.whatsapp_links where user_id=$1",
        [userA]
      )).rows[0];
      expect(linkA.status).toBe('pending');
      expect(linkA.wa_id).toBeNull();

      const profileA = (await db.query<{ phone_number: string | null }>(
        "select phone_number from public.profiles where id=$1",
        [userA]
      )).rows[0];
      expect(profileA.phone_number).toBeNull();

      // userB tiene waSender activo
      const linkB = (await db.query<{ status: string; wa_id: string }>(
        "select status, wa_id from public.whatsapp_links where user_id=$1",
        [userB]
      )).rows[0];
      expect(linkB.status).toBe('active');
      expect(linkB.wa_id).toBe(waSender);
    });

    it('rechaza código vencido en servidor e incrementa intentos', async () => {
      const code = await generateCodeForUser(userA);
      // Vencer el código artificialmente
      await db.query("update public.whatsapp_links set link_code_expires_at = clock_timestamp() - interval '1 second' where user_id=$1", [userA]);

      const job = await enqueueAndClaimJob(waSender, { kind: 'link', hash: sha256(code) });
      expect(job.reply_text).toBe('El código de vinculación no es válido o ya venció. Generá uno nuevo desde la app.');

      const worker = (await db.query<{ link_attempts: number }>(
        "select link_attempts from public.whatsapp_worker_state where wa_id=$1",
        [waSender]
      )).rows[0];
      expect(worker.link_attempts).toBe(1);
    });

    it('bloquea por fuerza bruta al 5to intento fallido y rechaza intentos durante el bloqueo', async () => {
      const validCode = await generateCodeForUser(userA);
      const validHash = sha256(validCode);
      const invalidHash = sha256('999999');

      for (let attempt = 1; attempt <= 4; attempt++) {
        const job = await enqueueAndClaimJob(waSender, { kind: 'link', hash: invalidHash });
        expect(job.reply_text).toBe('El código de vinculación no es válido o ya venció. Generá uno nuevo desde la app.');
      }

      // 5to intento fallido activa el bloqueo
      const fifthJob = await enqueueAndClaimJob(waSender, { kind: 'link', hash: invalidHash });
      expect(fifthJob.reply_text).toBe('Demasiados intentos fallidos de vinculación. Por seguridad, esperá 15 minutos antes de volver a intentar.');

      const worker = (await db.query<{ link_attempts: number; link_locked_until: string | null }>(
        "select link_attempts, link_locked_until from public.whatsapp_worker_state where wa_id=$1",
        [waSender]
      )).rows[0];
      expect(worker.link_attempts).toBe(5);
      expect(worker.link_locked_until).not.toBeNull();

      // Durante el bloqueo, incluso un código correcto es rechazado
      const blockedJob = await enqueueAndClaimJob(waSender, { kind: 'link', hash: validHash });
      expect(blockedJob.reply_text).toBe('Demasiados intentos fallidos de vinculación. Por seguridad, esperá 15 minutos antes de volver a intentar.');

      // Comprobar que userA NO fue vinculado
      const link = (await db.query<{ status: string }>(
        "select status from public.whatsapp_links where user_id=$1",
        [userA]
      )).rows[0];
      expect(link.status).not.toBe('active');
    });

    it('permite vincular nuevamente luego de transcurrido el tiempo de bloqueo', async () => {
      // Establecer worker en estado bloqueado pero con tiempo ya transcurrido
      await db.query(`
        insert into public.whatsapp_worker_state(wa_id, link_attempts, link_locked_until)
        values($1, 5, clock_timestamp() - interval '1 second')
        on conflict (wa_id) do update set
          link_attempts = 5,
          link_locked_until = clock_timestamp() - interval '1 second'
      `, [waSender]);

      const code = await generateCodeForUser(userA);
      const job = await enqueueAndClaimJob(waSender, { kind: 'link', hash: sha256(code) });
      expect(job.reply_text).toBe('¡Listo! Tu WhatsApp quedó vinculado con Pesito ✅');

      const worker = (await db.query<{ link_attempts: number; link_locked_until: string | null }>(
        "select link_attempts, link_locked_until from public.whatsapp_worker_state where wa_id=$1",
        [waSender]
      )).rows[0];
      expect(worker.link_attempts).toBe(0);
      expect(worker.link_locked_until).toBeNull();
    });

    it('revierte toda la operación si el usuario tiene concesión ocupada (QUEUE_LINK_BUSY)', async () => {
      const code = await generateCodeForUser(userA);

      // Simular que otro worker tiene concesión activa sobre userA
      await db.query(`
        insert into public.whatsapp_user_leases(user_id, lease_token, lease_until)
        values($1, $2, clock_timestamp() + interval '60 seconds')
        on conflict (user_id) do update set lease_token=$2, lease_until=clock_timestamp() + interval '60 seconds'
      `, [userA, token2]);

      await expect(
        enqueueAndClaimJob(waSender, { kind: 'link', hash: sha256(code) }, token1)
      ).rejects.toThrow('QUEUE_LINK_BUSY');

      // Verificar que el código NO fue consumido tras el fallo
      const link = (await db.query<{ link_code_hash: string | null; status: string }>(
        "select link_code_hash, status from public.whatsapp_links where user_id=$1",
        [userA]
      )).rows[0];
      expect(link.link_code_hash).not.toBeNull();
      expect(link.status).not.toBe('active');
    });

    it('dos llamadas con el mismo código no duplican la vinculación: solo la primera tiene éxito', async () => {
      const code = await generateCodeForUser(userA);
      const hash = sha256(code);
      const waSender2 = '5491100002222';

      // Primera llamada vincula waSender a userA
      const job1 = await enqueueAndClaimJob(waSender, { kind: 'link', hash }, token1);
      expect(job1.reply_text).toBe('¡Listo! Tu WhatsApp quedó vinculado con Pesito ✅');

      // Segunda llamada concurrente o posterior con el mismo código es rechazada
      const job2 = await enqueueAndClaimJob(waSender2, { kind: 'link', hash }, token2);
      expect(job2.reply_text).toBe('El código de vinculación no es válido o ya venció. Generá uno nuevo desde la app.');

      // Comprobar que waSender2 NO quedó vinculado y sus intentos aumentaron
      const linkA = (await db.query<{ wa_id: string }>(
        "select wa_id from public.whatsapp_links where user_id=$1",
        [userA]
      )).rows[0];
      expect(linkA.wa_id).toBe(waSender);

      const worker2 = (await db.query<{ link_attempts: number }>(
        "select link_attempts from public.whatsapp_worker_state where wa_id=$1",
        [waSender2]
      )).rows[0];
      expect(worker2.link_attempts).toBe(1);
    });
  });
});
