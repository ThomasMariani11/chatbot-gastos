import { PGlite } from '@electric-sql/pglite';
import { readFile as readSqlFile, readdir } from 'node:fs/promises';
import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import { runActor, type QueueDependencies, type Job } from '../supabase/functions/whatsapp-webhook/queue';
import { extractFromGemini } from '../supabase/functions/whatsapp-webhook/helpers';
import { OperationalFailure } from '../supabase/functions/whatsapp-webhook/failures';
import { smokeBusinessContract } from '../scripts/release-sql-contract.mjs';

const readFile = async (path: URL | string, encoding: 'utf8') =>
  (await readSqlFile(path, encoding)).replace(/\r\n/g, '\n');

const db = new PGlite();
const migrationUrl = new URL('../supabase/migrations/', import.meta.url);

const userA = '50000000-0000-4000-8000-000000000001';
const adminUser = '50000000-0000-4000-8000-000000000003';
const token1 = '51000000-0000-4000-8000-000000000001';

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

describe('BE-16: Errores seguros, persistencia y envío', () => {
  it('el smoke de release verifica 040/041, expiración, permisos y ausencia de guardado parcial', async () => {
    await smokeBusinessContract((query: string) => db.exec(query), userA, { transaction: false });
  });
  describe('confirm_draft_group y discard_draft_group seguros', () => {
    it('informa listas ya confirmadas o descartadas sin mezclar enums en inglés ni sqlerrm', async () => {
      const groupRes = await db.query<{ id: string }>(
        "insert into public.draft_groups(user_id, status) values($1, 'confirmed') returning id",
        [userA]
      );
      const res = await rpc<{ success: boolean; error: string }>('confirm_draft_group', {
        p_group_id: groupRes.rows[0].id,
        p_user_id: userA,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe('Esta lista ya fue confirmada anteriormente.');
      expect(res.error).not.toContain('confirmed');
      expect(res.error).not.toContain('SQLERRM');

      await db.query("update public.draft_groups set status='discarded' where id=$1", [groupRes.rows[0].id]);
      const resDiscarded = await rpc<{ success: boolean; error: string }>('confirm_draft_group', {
        p_group_id: groupRes.rows[0].id,
        p_user_id: userA,
      });
      expect(resDiscarded.success).toBe(false);
      expect(resDiscarded.error).toBe('Esta lista ya fue descartada.');
    });

    it('un fallo de persistencia inyectado no expone SQLERRM ni nombres de columnas o tablas al usuario', async () => {
      // Crear borrador abierto con un ítem pendiente
      const groupRes = await db.query<{ id: string }>(
        "insert into public.draft_groups(user_id, status) values($1, 'open') returning id",
        [userA]
      );
      const gId = groupRes.rows[0].id;
      await db.query(`
        insert into public.draft_items(group_id, user_id, position, kind, description, amount, currency, occurred_on, status, installments)
        values($1, $2, 1, 'expense', 'Supermercado', 100, 'ARS', current_date, 'pending', 1)
      `, [gId, userA]);

      // Inyectar un fallo en transactions con un trigger temporal que lance error interno
      await db.exec(`
        create function public.trigger_fail_tx() returns trigger language plpgsql as $$
        begin
          raise exception 'DATABASE_INTERNAL_CANARY: foreign key or disk error';
        end;
        $$;
        create trigger tr_fail_tx before insert on public.transactions
          for each row execute function public.trigger_fail_tx();
      `);

      const res = await rpc<{ success: boolean; error: string }>('confirm_draft_group', {
        p_group_id: gId,
        p_user_id: userA,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('hubo un problema técnico al registrar las operaciones');
      expect(res.error).not.toContain('DATABASE_INTERNAL_CANARY');
      expect(res.error).not.toContain('SQLSTATE');
      expect(res.error).not.toContain('sqlerrm');
      expect(res.error).not.toContain('foreign key');

      // Limpiar trigger
      await db.exec('drop trigger tr_fail_tx on public.transactions; drop function public.trigger_fail_tx();');
    });

    it('discard_draft_group ante un error imprevisto devuelve mensaje genérico sin filtrar sqlerrm', async () => {
      const groupRes = await db.query<{ id: string }>(
        "insert into public.draft_groups(user_id, status) values($1, 'open') returning id",
        [userA]
      );
      const gId = groupRes.rows[0].id;

      await db.exec(`
        create function public.trigger_fail_discard() returns trigger language plpgsql as $$
        begin
          raise exception 'DISCARD_INTERNAL_CANARY';
        end;
        $$;
        create trigger tr_fail_discard before update on public.draft_groups
          for each row execute function public.trigger_fail_discard();
      `);

      const res = await rpc<{ success: boolean; error: string }>('discard_draft_group', {
        p_group_id: gId,
        p_user_id: userA,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('No se pudo descartar el lote pendiente por un error técnico.');
      expect(res.error).not.toContain('DISCARD_INTERNAL_CANARY');

      await db.exec('drop trigger tr_fail_discard on public.draft_groups; drop function public.trigger_fail_discard();');
    });
  });

  describe('fail_whatsapp_job y separación de fallos de envío', () => {
    const waId = '5491122334455';

    it('clasifica error_message como QUEUE_SEND_RETRY cuando el efecto ya fue aplicado', async () => {
      await db.query("insert into public.whatsapp_worker_state(wa_id) values($1) on conflict do nothing", [waId]);
      await rpc('claim_whatsapp_actor', { p_wa_id: waId, p_token: token1 });

      const msgId = 'msg-send-retry-test';
      await db.query(`
        insert into public.inbound_events(wa_message_id, wa_id, status)
        values($1, $2, 'processing')
      `, [msgId, waId]);
      await db.query(`
        insert into public.whatsapp_message_queue(wa_message_id, wa_id, payload, queue_version, status, effect_applied, attempts)
        values($1, $2, '{"type":"text"}', 2, 'processing', true, 1)
      `, [msgId, waId]);

      const jobRow = (await db.query<{ id: string }>(
        "select id from public.whatsapp_message_queue where wa_message_id=$1",
        [msgId]
      )).rows[0];

      await rpc('fail_whatsapp_job', { p_id: jobRow.id, p_token: token1 });

      const queueRow = (await db.query<{ status: string; error_message: string }>(
        "select status, error_message from public.whatsapp_message_queue where id=$1",
        [jobRow.id]
      )).rows[0];

      expect(queueRow.status).toBe('failed');
      expect(queueRow.error_message).toBe('QUEUE_SEND_RETRY');

      const inboundRow = (await db.query<{ status: string; error_code: string }>(
        "select status, error_code from public.inbound_events where wa_message_id=$1",
        [msgId]
      )).rows[0];
      expect(inboundRow.status).toBe('failed');
      expect(inboundRow.error_code).toBe('QUEUE_SEND_RETRY');
    });

    it('clasifica error_message como QUEUE_RETRY_REQUIRED cuando el efecto NO fue aplicado', async () => {
      await db.query("insert into public.whatsapp_worker_state(wa_id) values($1) on conflict do nothing", [waId]);
      await rpc('claim_whatsapp_actor', { p_wa_id: waId, p_token: token1 });

      const msgId = 'msg-interpret-retry-test';
      await db.query(`
        insert into public.inbound_events(wa_message_id, wa_id, status)
        values($1, $2, 'processing')
      `, [msgId, waId]);
      await db.query(`
        insert into public.whatsapp_message_queue(wa_message_id, wa_id, payload, queue_version, status, effect_applied, attempts)
        values($1, $2, '{"type":"text"}', 2, 'processing', false, 1)
      `, [msgId, waId]);

      const jobRow = (await db.query<{ id: string }>(
        "select id from public.whatsapp_message_queue where wa_message_id=$1",
        [msgId]
      )).rows[0];

      await rpc('fail_whatsapp_job', { p_id: jobRow.id, p_token: token1 });

      const queueRow = (await db.query<{ status: string; error_message: string }>(
        "select status, error_message from public.whatsapp_message_queue where id=$1",
        [jobRow.id]
      )).rows[0];

      expect(queueRow.status).toBe('failed');
      expect(queueRow.error_message).toBe('QUEUE_RETRY_REQUIRED');
    });

    it('un trabajo con effect_applied=true reporta stage: "send" y no "interpret" si falla la entrega', async () => {
      const recordedIssues: unknown[] = [];
      const recordedMetrics: unknown[] = [];

      const mockJob: Job = {
        id: '99000000-0000-4000-8000-000000000001',
        wa_id: waId,
        user_id: userA,
        payload: { id: 'wamid-retry-test', from: waId, type: 'text', text: { body: 'Gasto 500' } },
        attempts: 2,
        effect_applied: true, // Efecto ya aplicado en intento anterior
        reply_text: 'Guardado con éxito',
        parsed_result: null,
      };

      const deps: QueueDependencies = {
        rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
          if (name === 'claim_whatsapp_actor') return true;
          if (name === 'next_whatsapp_job') return mockJob;
          if (name === 'record_whatsapp_job_issue') {
            recordedIssues.push(args?.p_issue);
            return;
          }
          if (name === 'fail_whatsapp_job') return;
          if (name === 'release_whatsapp_actor') return;
          return null;
        }) as never,
        prepare: vi.fn(), // No debe ser invocado porque effect_applied es true
        send: vi.fn().mockRejectedValue(new OperationalFailure('network', 'meta_send')),
        format: vi.fn(),
        now: () => Date.now(),
        sleep: vi.fn(),
        token: () => token1,
        metric: vi.fn((event, data) => {
          recordedMetrics.push({ event, data });
        }),
      };

      await runActor(waId, deps);

      // Verificaciones:
      // 1. prepare NUNCA fue llamado (no se reinterpreta)
      expect(deps.prepare).not.toHaveBeenCalled();

      // 2. recordIssue registró stage = "send", NUNCA "interpret"
      expect(recordedIssues).toHaveLength(1);
      expect(recordedIssues[0]).toMatchObject({
        kind: 'retry',
        stage: 'send',
        provider: 'meta_send',
      });

      // 3. metric registró stage = "send"
      const retryMetric = recordedMetrics.find(m => (m as { event: string }).event === 'queue_retry') as { data: { stage: string } } | undefined;
      expect(retryMetric?.data.stage).toBe('send');
    });
  });

  describe('Privacidad de credenciales en llamadas remotas', () => {
    it('extractFromGemini no incluye la API key en la query string de la URL', async () => {
      (globalThis as unknown as { Deno: { env: { get: (k: string) => string | undefined } } }).Deno = {
        env: { get: (k: string) => (k === 'GEMINI_API_KEY' ? 'SECRET_API_KEY_12345' : undefined) },
      };

      const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: 'confirm', movements: [] }) }] } }]
      }), { status: 200 }));

      vi.stubGlobal('fetch', fetchSpy);
      try {
        await extractFromGemini({
          text: 'confirmar',
        });

        expect(fetchSpy).toHaveBeenCalled();
        const calledUrl = fetchSpy.mock.calls[0][0] as string;
        const calledOptions = fetchSpy.mock.calls[0][1] as RequestInit;

        // La URL no debe tener el query param ?key=
        expect(calledUrl).not.toContain('key=SECRET_API_KEY_12345');
        expect(calledUrl).not.toContain('?key=');

        // La API key debe viajar de forma segura en el header x-goog-api-key
        expect((calledOptions.headers as Record<string, string>)['x-goog-api-key']).toBe('SECRET_API_KEY_12345');
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
