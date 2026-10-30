import { parsePendingEdit } from '../supabase/functions/whatsapp-webhook/draft-edit';
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseDraftMovements } from "../supabase/functions/whatsapp-webhook/local-movements";
import { parseLocalCommand } from "../supabase/functions/whatsapp-webhook/local-commands";
import { PGlite } from "@electric-sql/pglite";
import { readFile as readSqlFile, readdir } from "node:fs/promises";

const readFile = async (path: URL | string, encoding: "utf8") =>
  (await readSqlFile(path, encoding)).replace(/\r\n/g, "\n");

describe("BOT-01: Lenguaje natural, eliminaciones y correcciones sin fricción", () => {
  const today = "2026-10-29";

  it("prohíbe estrictamente convertir comandos de cancelación o borrado en gastos ficticios", () => {
    expect(parseDraftMovements("Cancela el 6", today)).toBeNull();
    expect(parseDraftMovements("cancela el 5 y el 6", today)).toBeNull();
    expect(parseDraftMovements("Quitá el 2", today)).toBeNull();
    expect(parseDraftMovements("borra el gasto 3", today)).toBeNull();
    expect(parseDraftMovements("eliminame el 1", today)).toBeNull();
    expect(parseDraftMovements("descartar todo", today)).toBeNull();
  });

  it("reconoce comandos de eliminación individuales y múltiples con números estables", () => {
    expect(parseLocalCommand("Cancela el 6")).toEqual({
      kind: "remove",
      position: 6,
    });
    expect(parseLocalCommand("Cancela el 5 y el 6")).toEqual({
      kind: "remove",
      position: 5,
      positions: [5, 6],
    });
    expect(parseLocalCommand("Cancela 4.5.6")).toEqual({
      kind: "remove",
      position: 4,
      positions: [4, 5, 6],
    });
    expect(parseLocalCommand("borrá 1, 2 y 3")).toEqual({
      kind: "remove",
      position: 1,
      positions: [1, 2, 3],
    });
  });
});

describe("BOT-01: Migración 042 y ejecución de bajas y ediciones múltiples en PostgreSQL", () => {
  const db = new PGlite();
  const user = "40000000-0000-4000-8000-000000000001";
  const admin = "40000000-0000-4000-8000-000000000002";
  const token = "41000000-0000-4000-8000-000000000001";
  const migrationUrl = new URL("../supabase/migrations/", import.meta.url);

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

    await db.query("insert into auth.users(id, email) values($1, $2)", [admin, "admin@example.invalid"]);

    const migrations = (await readdir(migrationUrl)).filter((m) => /^\d+.*\.sql$/.test(m)).sort();
    for (const m of migrations.filter((m) => m < "020")) {
      if (m === "002_enable_realtime.sql") continue;
      let sql = await readFile(new URL(m, migrationUrl), "utf8");
      if (m === "001_initial.sql") sql = sql.replace("create extension if not exists pgcrypto;", "");
      await db.exec(sql.replace(/^\uFEFF/, ""));
    }

    await db.exec("insert into public.invitation_codes(code, duration_days) values('BOT-A', 30)");
    await db.query(`insert into auth.users(id, email, raw_user_meta_data) values($1, 'bota@example.invalid', '{"invitation_code":"BOT-A"}')`, [user]);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    await db.exec("grant all on all tables in schema public to service_role");
    await db.query("update public.whatsapp_links set wa_id='synthetic-bot', status='active' where user_id=$1", [user]);

    await db.exec(await readFile(new URL("020_durable_whatsapp_queue.sql", migrationUrl), "utf8"));

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

    for (const m of migrations.filter((m) => m >= "021" && m <= "043")) {
      let sql = await readFile(new URL(m, migrationUrl), "utf8");
      if (m === "021_whatsapp_queue_recovery.sql" || m === "022_whatsapp_recovery_private_transport.sql") {
        sql = sql.replace(/^create extension[^\n]+\n/gm, "");
      }
      if (m === "027_whatsapp_observability.sql") {
        await db.exec(`alter table cron.job add column if not exists jobid bigint generated always as identity, add column if not exists active boolean default true;
          create table if not exists cron.job_run_details(jobid bigint, status text, start_time timestamptz default clock_timestamp(), end_time timestamptz);`);
      }
      await db.exec(sql);
    }
  }, 35000);

  afterAll(async () => {
    await db.close();
  });

  it("elimina múltiples posiciones concurrentemente y actualiza el borrador", async () => {
    await db.exec("begin; update public.whatsapp_queue_control set enabled=true;");
    try {
      // 1. Crear borrador con 6 items
      const groupRes = await db.query<{ id: string }>(
        "insert into public.draft_groups(user_id, status, version) values($1, 'open', 1) returning id",
        [user]
      );
      const groupId = groupRes.rows[0].id;

      for (let pos = 1; pos <= 6; pos++) {
        await db.query(
          "insert into public.draft_items(group_id, user_id, position, kind, description, amount, currency, status, occurred_on) values($1, $2, $3, 'expense', $4, $5, 'ARS', 'pending', '2026-10-29')",
          [groupId, user, pos, `Gasto ${pos}`, pos * 100]
        );
      }

      // Encolar mensaje de remove múltiple [5, 6]
      const msgRes = await db.query<{ id: string }>(
        `insert into public.whatsapp_message_queue(wa_message_id, wa_id, user_id, payload, queue_version, status, attempts, effect_applied)
         values('msg-remove-5-6', 'synthetic-bot', $1, '{}'::jsonb, 2, 'processing', 1, false) returning id`,
        [user]
      );
      const jobId = msgRes.rows[0].id;

      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
      await db.query(
        "insert into public.whatsapp_worker_state(wa_id, lease_token, lease_until, user_id) values('synthetic-bot', $1, clock_timestamp() + interval '1 minute', $2) on conflict (wa_id) do update set lease_token=excluded.lease_token, lease_until=excluded.lease_until, user_id=excluded.user_id",
        [token, user]
      );
      await db.query(
        "insert into public.whatsapp_user_leases(user_id, lease_token, lease_until) values($1, $2, clock_timestamp() + interval '1 minute') on conflict (user_id) do update set lease_token=excluded.lease_token, lease_until=excluded.lease_until",
        [user, token]
      );

      // Aplicar acción de remove múltiple
      const removeAction = {
        kind: "remove",
        position: 5,
        positions: [5, 6],
      };

      const outcome = await db.query<{ result: { effect_applied: boolean; reply_text: string | null } }>(
        "select public.apply_whatsapp_job($1, $2, $3) as result",
        [jobId, token, JSON.stringify(removeAction)]
      );

      expect(outcome.rows[0].result.effect_applied).toBe(true);

      // Verificar que 5 y 6 quedaron 'removed' y 1..4 siguen 'pending'
      const items = await db.query<{ position: number; status: string }>(
        "select position, status from public.draft_items where group_id=$1 order by position",
        [groupId]
      );
      const statuses = items.rows.map((r) => [r.position, r.status]);
      expect(statuses).toEqual([
        [1, "pending"],
        [2, "pending"],
        [3, "pending"],
        [4, "pending"],
        [5, "removed"],
        [6, "removed"],
      ]);
    } finally {
      await db.exec("rollback;");
    }
  });

  it("aplica ediciones múltiples en un solo mensaje actualizando las descripciones y categorías", async () => {
    await db.exec("begin; update public.whatsapp_queue_control set enabled=true;");
    try {
      const groupRes = await db.query<{ id: string }>(
        "insert into public.draft_groups(user_id, status, version) values($1, 'open', 1) returning id",
        [user]
      );
      const groupId = groupRes.rows[0].id;

      for (let pos = 1; pos <= 3; pos++) {
        await db.query(
          "insert into public.draft_items(group_id, user_id, position, kind, description, amount, currency, status, occurred_on) values($1, $2, $3, 'expense', $4, $5, 'ARS', 'pending', '2026-10-29')",
          [groupId, user, pos, `Ticket ${pos}`, pos * 1000]
        );
      }

      const msgRes = await db.query<{ id: string }>(
        `insert into public.whatsapp_message_queue(wa_message_id, wa_id, user_id, payload, queue_version, status, attempts, effect_applied)
         values('msg-edit-1-2-3', 'synthetic-bot', $1, '{}'::jsonb, 2, 'processing', 1, false) returning id`,
        [user]
      );
      const jobId = msgRes.rows[0].id;

      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
      await db.query(
        "insert into public.whatsapp_worker_state(wa_id, lease_token, lease_until, user_id) values('synthetic-bot', $1, clock_timestamp() + interval '1 minute', $2) on conflict (wa_id) do update set lease_token=excluded.lease_token, lease_until=excluded.lease_until, user_id=excluded.user_id",
        [token, user]
      );
      await db.query(
        "insert into public.whatsapp_user_leases(user_id, lease_token, lease_until) values($1, $2, clock_timestamp() + interval '1 minute') on conflict (user_id) do update set lease_token=excluded.lease_token, lease_until=excluded.lease_until",
        [user, token]
      );

      // Aplicar acción de edición múltiple
      const editAction = {
        kind: "edit",
        position: 1,
        group_id: groupId,
        version: 1,
        edits: [
          { position: 1, patch: { description: "Comida", category: "Alimentación" } },
          { position: 2, patch: { description: "Gaseosa", category: "Alimentación" } },
          { position: 3, patch: { description: "Gaseosa", category: "Alimentación" } },
        ],
      };

      const outcome = await db.query<{ result: { effect_applied: boolean } }>(
        "select public.apply_whatsapp_job($1, $2, $3) as result",
        [jobId, token, JSON.stringify(editAction)]
      );

      expect(outcome.rows[0].result.effect_applied).toBe(true);

      const items = await db.query<{ position: number; description: string }>(
        "select position, description from public.draft_items where group_id=$1 order by position",
        [groupId]
      );
      expect(items.rows.map((r) => [r.position, r.description])).toEqual([
        [1, "Comida"],
        [2, "Gaseosa"],
        [3, "Gaseosa"],
      ]);
    } finally {
      await db.exec("rollback;");
    }
  });
  it("aplica el mensaje real de corrección doble y conserva el tercer importe sin guardar movimientos", async () => {
    await db.exec("begin; update public.whatsapp_queue_control set enabled=true;");
    try {
      const group = (await db.query<{ id: string }>(
        "insert into public.draft_groups(user_id,status,version) values($1,'open',1) returning id", [user],
      )).rows[0].id;
      for (let position = 1; position <= 3; position++) {
        await db.query(
          "insert into public.draft_items(group_id,user_id,position,kind,description,amount,currency,status,occurred_on) values($1,$2,$3,'expense',$4,$5,'ARS','pending','2026-10-30')",
          [group, user, position, ['Prueba alfa', 'Prueba beta', 'Prueba gamma'][position - 1], position * 101],
        );
      }
      const beforeCount = (await db.query<{ n: number }>("select count(*)::int n from public.transactions")).rows[0].n;
      const jobId = (await db.query<{ id: string }>(
        "insert into public.whatsapp_message_queue(wa_message_id,wa_id,user_id,payload,queue_version,status,attempts,effect_applied) values('synthetic-double-amount','synthetic-bot',$1,'{}',2,'processing',1,false) returning id", [user],
      )).rows[0].id;
      await db.query("insert into public.whatsapp_worker_state(wa_id,lease_token,lease_until,user_id) values('synthetic-bot',$1,clock_timestamp()+interval '1 minute',$2) on conflict(wa_id) do update set lease_token=excluded.lease_token,lease_until=excluded.lease_until,user_id=excluded.user_id", [token, user]);
      await db.query("insert into public.whatsapp_user_leases(user_id,lease_token,lease_until) values($1,$2,clock_timestamp()+interval '1 minute') on conflict(user_id) do update set lease_token=excluded.lease_token,lease_until=excluded.lease_until", [user, token]);
      const draft = (await db.query<{ draft: Parameters<typeof parsePendingEdit>[1] }>("select public.get_active_draft_group($1) as draft", [user])).rows[0].draft;
      const action = parsePendingEdit("El 1 fue de 150 y el 2 fue de 250", draft);
      expect(action?.kind).toBe('edit');
      const apply = () => db.query<{ result: { effect_applied: boolean } }>("select public.apply_whatsapp_job($1,$2,$3) as result", [jobId, token, JSON.stringify(action)]);
      expect((await apply()).rows[0].result.effect_applied).toBe(true);
      await apply(); // Reintento del mismo trabajo, sin repetir efectos ni crear movimientos.
      const items = (await db.query<{ position: number; amount: string; description: string; currency: string }>("select position,amount,description,currency from public.draft_items where group_id=$1 order by position", [group])).rows;
      expect(items.map(i => [i.position, Number(i.amount), i.description, i.currency])).toEqual([
        [1, 150, 'Prueba alfa', 'ARS'], [2, 250, 'Prueba beta', 'ARS'], [3, 303, 'Prueba gamma', 'ARS'],
      ]);
      expect((await db.query<{ n: number }>("select count(*)::int n from public.transactions")).rows[0].n).toBe(beforeCount);
    } finally { await db.exec('rollback;'); }
  });

});
