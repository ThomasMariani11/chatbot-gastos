import { describe,it,expect,beforeAll,afterAll,beforeEach,afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile as readSqlFile,readdir } from 'node:fs/promises';
import { smokeRenewalContract } from '../scripts/release-renewal-contract.mjs';
const readFile=async(path:URL|string,encoding:'utf8')=>(await readSqlFile(path,encoding)).replace(/\r\n/g,'\n');
describe("BE-19: solicitud, pago y código nominativo", () => {
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

    for (const m of migrations.filter((m) => m >= "021" && m < "044")) {
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

  const other='40000000-0000-4000-8000-000000000003';
  let seq=0;
  beforeEach(async()=>{
    await db.exec("begin;update public.whatsapp_queue_control set enabled=true;update public.whatsapp_ops_config set verified_test_sender_digits='1555'||repeat('0',7);insert into public.invitation_codes(code,duration_days)values('OTHER-TEST',30),('GENERIC-TEST',30);");
    await db.query("insert into auth.users(id,email,raw_user_meta_data)values($1,'other@example.invalid','{\"invitation_code\":\"OTHER-TEST\"}')",[other]);
    await db.query("update public.whatsapp_links set linked_at=clock_timestamp() where user_id=$1",[user]);
  });
  afterEach(async()=>{await db.exec('rollback');});
  async function as<T>(actor:string,sql:string,args:unknown[]=[],role='authenticated'):Promise<T>{
    await db.exec('savepoint caller');
    try {await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);await db.exec('set local role '+role);const result=await db.query<{r:T}>(sql,args);await db.exec('reset role;release savepoint caller');return result.rows[0]?.r;}
    catch(error){await db.exec('rollback to savepoint caller;release savepoint caller');throw error;}
  }
  const row=async()=> (await db.query<{id:string;state:string;code_id:string;duration_days:number|null}>('select * from public.subscription_renewal_requests where user_id=$1 and state<>\'redeemed\'',[user])).rows[0];
  const pay=async(days:number|null=30,actor=admin)=>as<{replayed:boolean}>(actor,'select public.admin_confirm_renewal_payment($1,$2) as r',[(await row()).id,days]);
  const code=async()=> (await db.query<{code:string}>('select code from public.invitation_codes where id=$1',[(await row()).code_id])).rows[0].code;
  const redeem=async(value:string,actor=user)=>as<{success:boolean}>(actor,'select public.redeem_invitation_code($1,$2) as r',[value,actor]);
  const notice=async()=> (await db.query<{state:string;attempts:number;id:string}>('select * from public.subscription_renewal_notices')).rows[0];
  const claim=()=>as<{id:string;code:string;duration_days:number}|null>('', 'select public.claim_subscription_renewal_notice($1) as r',[token],'service_role');
  async function request(timestamp=Math.floor(Date.now()/1000).toString()){
    const id=(await db.query<{id:string}>("insert into public.whatsapp_message_queue(wa_message_id,wa_id,user_id,payload,queue_version,status,attempts)values($1,'synthetic-bot',$2,$3,2,'processing',1) returning id",['renewal-'+(++seq),user,JSON.stringify({id:'synthetic-renewal',from:'synthetic-bot',type:'text',text:{body:'RENOVAR'},timestamp})])).rows[0].id;
    await db.query("insert into public.whatsapp_worker_state(wa_id,user_id,lease_token,lease_until)values('synthetic-bot',$1,$2,clock_timestamp()+interval '1 minute')on conflict(wa_id)do update set user_id=excluded.user_id,lease_token=excluded.lease_token,lease_until=excluded.lease_until",[user,token]);
    await db.query("insert into public.whatsapp_user_leases(user_id,lease_token,lease_until)values($1,$2,clock_timestamp()+interval '1 minute')on conflict(user_id)do update set lease_token=excluded.lease_token,lease_until=excluded.lease_until",[user,token]);
    return (await db.query<{r:{reply_text:string}}> ('select public.apply_whatsapp_job($1,$2,$3) as r',[id,token,JSON.stringify({kind:'renewal_request'})])).rows[0].r;
  }
  it('aplica 001–043 y registra solicitudes repetidas sin emitir código ni renovar',async()=>{
    const before=(await db.query('select subscription_until from public.profiles where id=$1',[user])).rows;
    expect((await request()).reply_text).toContain('Registré tu solicitud');await request();
    expect((await db.query<{n:number}>('select count(*)::int n from public.subscription_renewal_requests')).rows[0].n).toBe(1);
    expect((await row()).code_id).toBeNull();expect((await db.query('select subscription_until from public.profiles where id=$1',[user])).rows).toEqual(before);
  });
  it('confirma pago atómico una sola vez; no modifica vencimiento antes del canje',async()=>{
    await request();const before=(await db.query('select subscription_until from public.profiles where id=$1',[user])).rows;
    expect((await pay()).replayed).toBe(false);const value=await code();expect((await pay()).replayed).toBe(true);expect(await code()).toBe(value);
    await expect(pay(15)).rejects.toThrow('otra duración');expect((await db.query<{n:number}>('select count(*)::int n from public.subscription_renewal_notices')).rows[0].n).toBe(1);
    expect((await db.query('select subscription_until from public.profiles where id=$1',[user])).rows).toEqual(before);
    expect((await redeem(value)).success).toBe(true);expect((await db.query<{state:string}>('select state from public.subscription_renewal_requests')).rows[0].state).toBe('redeemed');
    expect((await redeem(value)).success).toBe(false);
    const days=(await db.query<{days:number}>('select extract(epoch from(subscription_until-now()))/86400 as days from public.profiles where id=$1',[user])).rows[0].days;expect(Number(days)).toBeCloseTo(60,3);
  });
  it('rechaza otro cliente y alta nueva con código nominativo; el código general sigue funcionando',async()=>{
    await request();await pay();const value=await code();await expect(redeem(value,other)).rejects.toThrow('no disponible');
    expect(await as(other,'select public.check_invitation_code($1) as r',[value])).toMatchObject({valid:false});
    expect(await as('','select public.check_invitation_code($1) as r',[value],'anon')).toMatchObject({valid:false});
    await db.exec('savepoint signup');await expect(db.query("insert into auth.users(id,email,raw_user_meta_data)values('40000000-0000-4000-8000-000000000099','new@example.invalid',$1)",[JSON.stringify({invitation_code:value})])).rejects.toThrow('REGISTRATION_INITIALIZATION_FAILED');await db.exec('rollback to savepoint signup;release savepoint signup');
    expect((await redeem('GENERIC-TEST',other)).success).toBe(true);expect((await redeem(value)).success).toBe(true);
  });
  it('conserva pago y código si venció la ventana, y RENOVAR la reabre',async()=>{
    await request(Math.floor(Date.now()/1000-24*3600).toString());await pay();expect((await notice()).state).toBe('waiting_window');expect(await claim()).toBeNull();
    await request();expect((await notice()).state).toBe('pending');expect((await claim())?.duration_days).toBe(30);
  });
  it('lease vencido queda incierto y no se reclama automáticamente',async()=>{
    await request();await pay();await claim();await db.exec("update public.subscription_renewal_notices set lease_until=clock_timestamp()-interval '1 second'");
    expect(await claim()).toBeNull();expect((await notice()).state).toBe('uncertain');await request();expect((await notice()).state).toBe('uncertain');
  });
  it('reintenta rechazos explícitos y finalización es idempotente',async()=>{
    await request();await pay();const n=await claim();
    await as('','select public.finish_subscription_renewal_notice($1,$2,$3) as r',[n!.id,token,'failed'],'service_role');expect((await notice()).state).toBe('pending');
    await db.exec('update public.subscription_renewal_notices set available_at=clock_timestamp()');await claim();
    await as('','select public.finish_subscription_renewal_notice($1,$2,$3) as r',[n!.id,token,'sent'],'service_role');
    await as('','select public.finish_subscription_renewal_notice($1,$2,$3) as r',[n!.id,token,'failed'],'service_role');expect((await notice()).state).toBe('sent');expect(await claim()).toBeNull();
  });
  it('no envía a un vínculo cambiado después de confirmar el pago',async()=>{
    await request();await pay();await db.query("update public.whatsapp_links set linked_at=clock_timestamp()+interval '1 second' where user_id=$1",[user]);expect(await claim()).toBeNull();expect((await notice()).state).toBe('blocked');
  });
  it('canje anterior al envío cancela la notificación pendiente',async()=>{await request();await pay();await redeem(await code());expect((await notice()).state).toBe('cancelled');expect(await claim()).toBeNull();});
  it.each(['suspended','preferences','bot','queue'])('revalida %s después del claim y antes de enviar',async reason=>{
    await request();await pay();const n=await claim();
    if(reason==='suspended') await as(admin,"update public.profiles set subscription_status='suspended' where id=$1 returning null as r",[user],'postgres');
    if(reason==='preferences') await db.query("update public.app_settings set whatsapp_responses_enabled=false where user_id=$1",[user]);
    if(reason==='bot') await db.exec("update public.system_config set value='false' where key='bot_active'");
    if(reason==='queue') await db.exec("update public.whatsapp_queue_control set enabled=false");
    expect(await as('','select public.authorize_subscription_renewal_notice($1,$2) as r',[n!.id,token],'service_role')).toBe(false);
    expect((await notice()).state).toBe('blocked');
  });
  it('revalida ventana vencida durante la comprobación de Meta',async()=>{
    await request();await pay();const n=await claim();
    await db.exec("update public.subscription_renewal_requests set last_customer_at=clock_timestamp()-interval '23 hours 56 minutes'");
    expect(await as('','select public.authorize_subscription_renewal_notice($1,$2) as r',[n!.id,token],'service_role')).toBe(false);
    expect((await notice()).state).toBe('waiting_window');await request();expect((await notice()).state).toBe('pending');
  });
  it.each(['','invalid',String(Math.floor(Date.now()/1000)+3600)])('timestamp inválido o futuro no abre la ventana: %s',async timestamp=>{
    await request(timestamp);await pay();expect((await notice()).state).toBe('waiting_window');
  });
  it('permite solicitar con cuenta vencida y evita solicitudes desde cuenta suspendida',async()=>{
    await as(admin,"update public.profiles set subscription_status='expired',subscription_until=now()-interval '1 day' where id=$1 returning null as r",[user],'pesito_subscription_writer');
    expect((await request()).reply_text).toContain('Registré');await pay();expect((await notice()).state).toBe('pending');
    await as(admin,"update public.profiles set subscription_status='suspended' where id=$1 returning null as r",[user],'postgres');
    await expect(redeem(await code())).resolves.toMatchObject({success:false});expect(await claim()).toBeNull();
    expect((await request()).reply_text).toContain('pausada');
  });
  it('código de pago inmutable, sin vencimiento de canje por la ventana de WhatsApp',async()=>{
    await request();await pay(null);const value=await code();
    await db.exec('savepoint immutable');
    await expect(db.query("update public.invitation_codes set duration_days=15 where code=$1",[value])).rejects.toThrow('no puede modificarse');
    await db.exec('rollback to savepoint immutable;release savepoint immutable');
    await db.exec('savepoint delete_code');
    await expect(db.query("delete from public.invitation_codes where code=$1",[value])).rejects.toThrow('corresponde a un pago');
    await db.exec('rollback to savepoint delete_code;release savepoint delete_code');
    await db.exec("update public.subscription_renewal_requests set last_customer_at=clock_timestamp()-interval '3 days'");
    expect((await redeem(value)).success).toBe(true);
    expect((await db.query<{subscription_until:string|null}>('select subscription_until from public.profiles where id=$1',[user])).rows[0].subscription_until).toBeNull();
  });
  it('RENOVAR atraviesa esperas y no confunde descripciones de movimientos',async()=>{
    for(const text of ['RENOVAR','quiero renovar!']) expect((await db.query<{r:boolean}>('select public.whatsapp_can_pass_waiting($1) as r',[JSON.stringify({type:'text',text:{body:text}})])).rows[0].r).toBe(true);
    expect((await db.query<{r:boolean}>('select public.whatsapp_can_pass_waiting($1) as r',[JSON.stringify({type:'text',text:{body:'gasté 50 para renovar'}})]) ).rows[0].r).toBe(false);
  });
  it('pago sin permiso, acceso directo a tablas y RPC worker de cliente están bloqueados',async()=>{
    await request();await expect(pay(30,user)).rejects.toThrow('administrador');
    for(const role of ['anon','authenticated','service_role']) expect((await db.query<{r:boolean}>("select has_table_privilege($1,'public.subscription_renewal_notices','SELECT') as r",[role])).rows[0].r).toBe(false);
    await expect(as(user,'select public.claim_subscription_renewal_notice($1) as r',[token])).rejects.toThrow('permission denied');
    await expect(as(user,'select public.admin_subscription_renewals() as r')).rejects.toThrow('administrador');
    expect(await as(admin,'select public.admin_subscription_renewals() as r')).toMatchObject({total:1});
  });
  it('un fallo al crear outbox revierte pago y código juntos',async()=>{
    await request();const count=(await db.query<{n:number}>('select count(*)::int n from public.invitation_codes')).rows[0].n;
    await db.exec("create function public.break_notice_fixture()returns trigger language plpgsql as $$begin raise exception 'synthetic failure';end$$;create trigger break_notice_fixture before insert on public.subscription_renewal_notices for each row execute function public.break_notice_fixture()");
    await expect(pay()).rejects.toThrow('synthetic failure');expect((await row()).state).toBe('requested');expect((await db.query<{n:number}>('select count(*)::int n from public.invitation_codes')).rows[0].n).toBe(count);
  });
  it('conserva ajuste manual y no crea un aviso de pago',async()=>{
    const requestId='41000000-0000-4000-8000-000000000099';await as(admin,'select public.admin_renew_subscription($1,$2,$3,$4) as r',[requestId,user,'extend',15]);
    expect((await db.query<{n:number}>('select count(*)::int n from public.subscription_renewal_notices')).rows[0].n).toBe(0);
  });
  it('ejecuta el mismo contrato SQL que se ensaya en instalación y rollback de runtime',async()=>{
    await db.exec("select set_config('request.jwt.claim.sub','',true)");
    await smokeRenewalContract((sql:string)=>db.exec(sql),user,{transaction:false});
  });
});

