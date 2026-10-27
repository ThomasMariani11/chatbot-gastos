import { OperationalFailure } from '../supabase/functions/whatsapp-webhook/failures';
import { createLogWriter } from '../supabase/functions/whatsapp-webhook/logging';
import { PGlite } from '@electric-sql/pglite';
import { readFile as readSqlFile, readdir } from 'node:fs/promises';
const readFile=async(path:URL|string,encoding:'utf8')=>(await readSqlFile(path,encoding)).replace(/\r\n/g,'\n');
import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import { readMessages, runActor } from '../supabase/functions/whatsapp-webhook/queue';
import { parseDraftCorrection } from '../supabase/functions/whatsapp-webhook/draft-corrections';
import type { Job, QueueDependencies, IncomingMessage } from '../supabase/functions/whatsapp-webhook/queue';

const db = new PGlite();
const a='30000000-0000-4000-8000-000000000001', b='30000000-0000-4000-8000-000000000002';
const admin='30000000-0000-4000-8000-000000000003';
const t1='31000000-0000-4000-8000-000000000001', t2='31000000-0000-4000-8000-000000000002';
const migrationUrl = new URL('../supabase/migrations/', import.meta.url);
let applyPropertiesBefore: unknown;
const applyPropertiesSql = "select proowner,proacl::text,prosecdef,proconfig from pg_proc where oid='public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure";
const movement = (description='Supermercado', amount=100) => ({kind:'expense',description,totalAmountArs:amount,currency:'ARS',occurredOn:'2026-10-15',installments:1,confidence:1,missingFields:[]});
const message = (id:string, from='synthetic-a', body='Gasté 100 en supermercado') => ({id,from,type:'text',timestamp:String(Math.floor(Date.now()/1000)),text:{body}});

async function rpc<T=Record<string,unknown>>(name:string, args:Record<string,unknown>={}):Promise<T> {
  const entries=Object.entries(args), placeholders=entries.map(([key],i)=>`${key} => $${i+1}`);
  await db.exec('savepoint queue_call');
  try {
    const result=await db.query<{result:T}>(`select public.${name}(${placeholders.join(',')}) as result`,entries.map(([,v])=>typeof v==='object'&&v!==null?JSON.stringify(v):v));
    const value=name==='due_whatsapp_actors'?result.rows.map(row=>row.result):result.rows[0]?.result;
    await db.exec('release savepoint queue_call');
    return value as T;
  } catch(error) {
    await db.exec('rollback to savepoint queue_call; release savepoint queue_call'); throw error;
  }
}
const enqueue=(...messages:IncomingMessage[])=>rpc('enqueue_whatsapp_messages',{p_messages:messages});
const claim=(wa='synthetic-a', token=t1)=>rpc<boolean>('claim_whatsapp_actor',{p_wa_id:wa,p_token:token});
const next=(wa='synthetic-a',token=t1)=>rpc<Job|null>('next_whatsapp_job',{p_wa_id:wa,p_token:token});
const apply=(job:Job,action:Record<string,unknown>,token=t1)=>rpc<Job>('apply_whatsapp_job',{p_id:job.id,p_token:token,p_action:action});
const finish=(job:Job,token=t1)=>rpc('finish_whatsapp_job',{p_id:job.id,p_token:token});
async function add(id:string,items:unknown[]=[movement()]) {
  await enqueue(message(id)); await claim(); const job=(await next())!;
  await apply(job,{kind:'add',items}); await finish(job); return job;
}
async function show() {
  await db.exec("update public.whatsapp_worker_state set last_received_at=clock_timestamp()-interval '4 seconds'");
  const draft=await rpc<{group_id:string;version:number}>('whatsapp_summary_snapshot',{p_wa_id:'synthetic-a',p_token:t1});
  expect(draft).not.toBeNull();
  await rpc('mark_whatsapp_summary_sent',{p_wa_id:'synthetic-a',p_token:t1,p_group_id:draft.group_id,p_version:draft.version});
  await db.exec("update public.whatsapp_worker_state set shown_at=clock_timestamp()-interval '2 seconds'");
  return draft;
}

beforeAll(async()=>{
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  await db.query('insert into auth.users(id,email) values($1,$2)',[admin,'admin@example.invalid']);
  for(const name of (await readdir(migrationUrl)).filter(name=>/^\d+.*\.sql$/.test(name)&&name<'020').sort()) {
    if(name==='002_enable_realtime.sql') continue;
    let sql=await readFile(new URL(name,migrationUrl),'utf8');
    if(name==='001_initial.sql') sql=sql.replace('create extension if not exists pgcrypto;','');
    await db.exec(sql.replace(/^\uFEFF/,''));
  }
  await db.exec("insert into public.invitation_codes(code,duration_days) values('QUEUE-A',30),('QUEUE-B',30)");
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{"invitation_code":"QUEUE-A"}'),($3,$4,'{"invitation_code":"QUEUE-B"}')`,[a,'a@example.invalid',b,'b@example.invalid']);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
  await db.exec('grant all on all tables in schema public to service_role');
  await db.query("update public.whatsapp_links set wa_id=case when user_id=$1 then 'synthetic-a' else 'synthetic-b' end,status='active'",[a]);
  // Reproducir en SQL real que 019 permitía varios borradores abiertos.
  await db.exec('begin');
  await db.query('insert into public.draft_groups(user_id) values($1),($1)',[a]);
  expect((await db.query<{n:number}>('select count(*)::int as n from public.draft_groups where user_id=$1',[a])).rows[0].n).toBe(2);
  await expect(db.exec(await readFile(new URL('020_durable_whatsapp_queue.sql',migrationUrl),'utf8'))).rejects.toThrow('QUEUE_DUPLICATE_OPEN_GROUPS');
  await db.exec('rollback');
  await db.exec(await readFile(new URL('020_durable_whatsapp_queue.sql',migrationUrl),'utf8'));
  // Dobles de extensiones solo para comprobar el contrato SQL del disparador.
  // No simulan el servicio pg_cron/pg_net alojado ni hacen HTTP.
  await db.exec(`create schema cron; create schema net; create schema vault;
    create table net.http_request_queue(id bigint); create table net._http_response(id bigint);
    create table cron.job(jobname text,schedule text,command text);
    create table vault.decrypted_secrets(name text,decrypted_secret text);
    create table public.synthetic_http_requests(url text,headers jsonb,body jsonb);
    create function cron.schedule(text,text,text) returns bigint language plpgsql as $$ begin insert into cron.job values($1,$2,$3); return 1; end $$;
    create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$ begin insert into public.synthetic_http_requests values(url,headers,body); return 1; end $$;`);
  const recovery=(await readFile(new URL('021_whatsapp_queue_recovery.sql',migrationUrl),'utf8')).replace(/^create extension[^\n]+\n/gm,'');
  await db.exec(recovery);
  // Transporte síncrono: no escribe headers en net.http_request_queue.
  await db.exec(`create schema if not exists extensions;
    create function extensions.http_set_curlopt(varchar,varchar) returns boolean language sql as $$ select true $$;
    create function extensions.http_reset_curlopt() returns boolean language sql as $$ select true $$;
    create type extensions.http_header as (field varchar,value varchar);
    create type extensions.http_request as (method varchar,uri varchar,headers extensions.http_header[],content_type varchar,content varchar);
    create function extensions.http_header(varchar,varchar) returns extensions.http_header language sql as $$ select row($1,$2)::extensions.http_header $$;
    create function extensions.http(extensions.http_request) returns table(status integer) language plpgsql as $$ begin
      insert into public.synthetic_http_requests select ($1).uri,jsonb_object_agg(h.field,h.value),($1).content::jsonb from unnest(($1).headers) h;
      return query select coalesce(nullif(current_setting('synthetic.http_status',true),'')::integer,200);
    end $$;`);
  const privateTransport=(await readFile(new URL('022_whatsapp_recovery_private_transport.sql',migrationUrl),'utf8')).replace(/^create extension[^\n]+\n/gm,'');
  await db.exec(privateTransport);
  await db.exec(await readFile(new URL('023_idempotent_whatsapp_delivery.sql',migrationUrl),'utf8'));
  applyPropertiesBefore = (await db.query(applyPropertiesSql)).rows;
  await db.exec(await readFile(new URL('025_cancel_stale_list_preserve_messages.sql',migrationUrl),'utf8'));
  await db.exec(await readFile(new URL('026_nonblocking_manual_review.sql',migrationUrl),'utf8'));
  await db.exec(`alter table cron.job add column jobid bigint generated always as identity, add column active boolean default true;
    create table cron.job_run_details(jobid bigint,status text,start_time timestamptz default clock_timestamp(),end_time timestamptz);`);
  await db.exec(await readFile(new URL('027_whatsapp_observability.sql',migrationUrl),'utf8'));
  await db.exec(await readFile(new URL('028_whatsapp_issue_details.sql',migrationUrl),'utf8'));
  await db.exec(await readFile(new URL('033_require_current_review_for_confirmation.sql',migrationUrl),'utf8'));
  await db.exec(await readFile(new URL('034_incomplete_draft_items.sql',migrationUrl),'utf8'));
  await db.exec(await readFile(new URL('035_shared_ai_quota.sql',migrationUrl),'utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin; update public.whatsapp_queue_control set enabled=true');});
afterEach(async()=>{await db.exec('rollback');});
afterAll(async()=>{await db.close();});

describe('INF-03 / BE-06: persistencia y exclusión reales en PostgreSQL efímero',()=>{
  it('registra todo el payload y deduplica reenvíos sin pisar contenido',async()=>{
    await enqueue(message('one'),message('two'),message('three','synthetic-b'));
    await enqueue(message('one','synthetic-b','no'));
    const rows=await db.query('select wa_message_id,wa_id from public.whatsapp_message_queue order by enqueue_order');
    expect(rows.rows).toEqual([{wa_message_id:'one',wa_id:'synthetic-a'},{wa_message_id:'two',wa_id:'synthetic-a'},{wa_message_id:'three',wa_id:'synthetic-b'}]);
    expect((await db.query('select count(*)::int as n from public.inbound_events')).rows[0]).toEqual({n:3});
  });
  it('revierte TODO el payload si uno de sus mensajes es inválido',async()=>{
    await expect(enqueue(message('one'),message('','synthetic-a'))).rejects.toThrow('QUEUE_INVALID_MESSAGE');
    expect((await db.query('select count(*)::int as n from public.inbound_events')).rows[0]).toEqual({n:0});
  });
  it('no activa la cola hasta habilitar el corte de versión',async()=>{
    await db.exec('update public.whatsapp_queue_control set enabled=false');
    await expect(enqueue(message('one'))).rejects.toThrow('QUEUE_DISABLED');
  });
  it('un segundo worker no puede adquirir el mismo cliente, otros clientes sí',async()=>{
    await enqueue(message('one'),message('other','synthetic-b'));
    expect(await claim()).toBe(true); expect(await claim('synthetic-a',t2)).toBe(false);
    expect(await claim('synthetic-b',t2)).toBe(true);
  });
  it('recupera un lease vencido y rechaza los resultados del worker anterior',async()=>{
    await enqueue(message('one')); await claim(); const job=(await next())!;
    await db.exec("update public.whatsapp_worker_state set lease_until=clock_timestamp()-interval '1 second'; update public.whatsapp_user_leases set lease_until=clock_timestamp()-interval '1 second'");
    expect(await claim('synthetic-a',t2)).toBe(true);
    await expect(apply(job,{kind:'add',items:[movement()]})).rejects.toThrow('QUEUE_LEASE_LOST');
    await apply((await next('synthetic-a',t2))!,{kind:'add',items:[movement()]},t2);
    expect((await db.query('select count(*)::int as n from public.draft_items')).rows[0]).toEqual({n:1});
  });
  it('procesa ráfagas en FIFO sin marcar como procesado el mensaje anterior',async()=>{
    await enqueue(message('one'),message('two')); await claim();
    const first=(await next())!; await apply(first,{kind:'add',items:[movement()]}); await finish(first);
    const second=(await next())!; expect(second.payload.id).toBe('two');
    await apply(second,{kind:'add',items:[movement('Nafta',200)]}); await finish(second);
    expect((await db.query('select position,description from public.draft_items order by position')).rows).toEqual([{position:1,description:'Supermercado'},{position:2,description:'Nafta'}]);
  });
  it('aplica un resultado una sola vez aunque se reintente tras fallar el envío',async()=>{
    await enqueue(message('one')); await claim(); const job=(await next())!;
    await apply(job,{kind:'add',items:[movement(),movement('Nafta',200)]});
    await rpc('fail_whatsapp_job',{p_id:job.id,p_token:t1});
    await db.exec('update public.whatsapp_message_queue set scheduled_for=clock_timestamp()');
    const retried=(await next())!; expect(retried.effect_applied).toBe(true);
    await apply(retried,{kind:'add',items:[movement('No se agrega')]}); await finish(retried);
    expect((await db.query('select count(*)::int as n from public.draft_items')).rows[0]).toEqual({n:2});
  });
  it('una inserción inválida no deja operaciones parciales ni checkpoint de éxito',async()=>{
    await enqueue(message('one')); await claim(); const job=(await next())!;
    await expect(apply(job,{kind:'add',items:[movement(),movement('Inválido',-1)]})).rejects.toThrow();
    expect((await db.query('select count(*)::int as n from public.draft_items')).rows[0]).toEqual({n:0});
    expect((await db.query('select effect_applied from public.whatsapp_message_queue')).rows[0]).toEqual({effect_applied:false});
  });
  it('corrige únicamente el monto del número estable sin agregar un movimiento',async()=>{
    await add('initial',[movement('Uno',101),movement('Dos',202),{...movement('Tres',303),kind:'income',currency:'USD'}]);
    const before=(await db.query<{id:string;position:number;description:string;amount:string;kind:string;currency:string}>('select id,position,description,amount::text as amount,kind,currency from public.draft_items order by position')).rows;
    await enqueue(message('correction','synthetic-a','el 2 fue de 250'));
    const editJob=(await next())!;
    const action=parseDraftCorrection('el 2 fue de 250')!;
    await apply(editJob,action);await apply(editJob,action);await finish(editJob);
    const after=(await db.query('select id,position,description,amount::text as amount,kind,currency from public.draft_items order by position')).rows;
    expect(after).toEqual(before.map((row,index)=>index===1?{...row,amount:'250.00'}:row));
    expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0]).toEqual({n:0});
    await enqueue(message('nonexistent','synthetic-a','el 99 fue de 500'));
    const absent=(await next())!;const outcome=await apply(absent,parseDraftCorrection('el 99 fue de 500')!);await finish(absent);
    expect(outcome.reply_text).toContain('No encontré');
    expect((await db.query('select id,position,description,amount::text as amount,kind,currency from public.draft_items order by position')).rows).toEqual(after);
  });
  it('conserva números estables y permite agregar después de eliminar',async()=>{
    await add('one',Array.from({length:20},(_,n)=>movement(`Operación ${n+1}`)));
    await enqueue(message('remove','synthetic-a','quitá el 2')); const job=(await next())!;
    await apply(job,{kind:'remove',position:2}); await finish(job); await add('two');
    expect((await db.query('select max(position)::int as max,count(*) filter(where status=\'pending\')::int as active from public.draft_items')).rows[0]).toEqual({max:21,active:20});
  });
  it('no guarda una confirmación recibida durante procesamiento ni una versión no mostrada',async()=>{
    await enqueue(message('one'),message('confirm','synthetic-a','confirmar')); await claim();
    const first=(await next())!; await apply(first,{kind:'add',items:[movement()]}); await finish(first);
    const confirm=(await next())!; const result=await apply(confirm,{kind:'confirm'}); await finish(confirm);
    expect(result.reply_text).toContain('nuevamente');
    expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0]).toEqual({n:0});
  });
  it('confirma solo el resumen enviado y no duplica al reintentar la confirmación',async()=>{
    await add('one',[movement(),{...movement('Ingreso USD',80),kind:'income',currency:'USD'}]); await show();
    await enqueue(message('confirm','synthetic-a','confirmar')); const confirm=(await next())!;
    await apply(confirm,{kind:'confirm'}); await apply(confirm,{kind:'confirm'}); await finish(confirm);
    expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0]).toEqual({n:2});
  });
  it('no publica resumen antes del silencio ni mientras queda interpretación pendiente',async()=>{
    await add('one');
    expect(await rpc('whatsapp_summary_snapshot',{p_wa_id:'synthetic-a',p_token:t1})).toBeNull();
    await enqueue(message('two')); await db.exec("update public.whatsapp_worker_state set last_received_at=clock_timestamp()-interval '4 seconds'");
    expect(await rpc('whatsapp_summary_snapshot',{p_wa_id:'synthetic-a',p_token:t1})).toBeNull();
  });
  it('rechaza una confirmación enviada antes del resumen aunque Meta la entregue después',async()=>{
    await add('one'); await show();
    await enqueue({...message('late','synthetic-a','confirmar'),timestamp:'1'});
    const job=(await next())!; expect((await apply(job,{kind:'confirm'})).reply_text).toContain('nuevamente');
    expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0]).toEqual({n:0});
  });
  it('retiene el mensaje nuevo hasta resolver una lista antigua y después lo recupera',async()=>{
    await add('one'); await db.exec("update public.draft_groups set last_activity_at=clock_timestamp()-interval '25 hours'");
    await enqueue(message('two')); const held=(await next())!; await apply(held,{kind:'summary'}); await finish(held);
    expect((await db.query('select status,pause_reason from public.whatsapp_message_queue where id=$1',[held.id])).rows[0]).toEqual({status:'waiting',pause_reason:'stale'});
    await enqueue(message('resume','synthetic-a','retomar')); const resume=(await next())!;
    await apply(resume,{kind:'resume'}); await finish(resume);
    expect((await next())?.payload.id).toBe('two');
  });
  it('CANCELAR ante una lista antigua descarta solo esa lista y recupera el audio retenido',async()=>{
    await add('old');
    const old=(await db.query<{id:string}>("select id from public.draft_groups where status='open'")).rows[0].id;
    await db.exec("update public.draft_groups set last_activity_at=clock_timestamp()-interval '25 hours'");
    await enqueue({id:'new-audio',from:'synthetic-a',type:'audio',timestamp:String(Math.floor(Date.now()/1000)),audio:{id:'synthetic-media'}});
    const held=(await next())!; await apply(held,{kind:'summary'}); await finish(held);
    await enqueue(message('cancel-old','synthetic-a','cancelar'));
    const cancel=(await next())!; expect(cancel.payload.id).toBe('cancel-old');
    const outcome=await apply(cancel,{kind:'cancel'}); await finish(outcome);
    expect(outcome.reply_text).toContain('Lista anterior descartada');
    expect((await db.query("select status from public.draft_groups where id=$1",[old])).rows[0]).toEqual({status:'discarded'});
    expect((await db.query("select status,effect_applied,pause_reason from public.whatsapp_message_queue where id=$1",[held.id])).rows[0]).toEqual({status:'pending',effect_applied:false,pause_reason:null});
    const audio=(await next())!; expect(audio.payload.id).toBe('new-audio');
    await apply(audio,{kind:'add',items:[movement('Audio nuevo',999)]}); await finish(audio);
    expect(await next()).toBeNull(); // CANCELAR no vuelve a ejecutarse después del audio.
    expect((await db.query("select d.description from public.draft_items d join public.draft_groups g on g.id=d.group_id where g.status='open'")).rows).toEqual([{description:'Audio nuevo'}]);
    expect((await db.query<{n:number}>("select count(*)::int as n from public.transactions")).rows[0].n).toBe(0);
  });
  it('CANCELAR una lista reciente sigue descartando todo y no confirma movimientos',async()=>{
    await add('current');
    await enqueue(message('cancel-current','synthetic-a','cancelar'));
    const cancel=(await next())!; const outcome=await apply(cancel,{kind:'cancel'}); await finish(outcome);
    expect(outcome.reply_text).toContain('Se descartaron los movimientos');
    expect((await db.query<{n:number}>("select count(*)::int as n from public.draft_groups where status='open'")).rows[0].n).toBe(0);
    expect((await db.query<{n:number}>("select count(*)::int as n from public.transactions where status='confirmed'")).rows[0].n).toBe(0);
  });

  it('025 conserva propietario, ACL, SECURITY DEFINER y search_path y es idempotente',async()=>{
    expect((await db.query(applyPropertiesSql)).rows).toEqual(applyPropertiesBefore);
    const definition=(await db.query<{body:string}>("select pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure) as body")).rows[0].body;
    const sql=(await readFile(new URL('025_cancel_stale_list_preserve_messages.sql',migrationUrl),'utf8')).replace(/^begin;$/m,'').replace(/^commit;$/m,'');
    await db.exec(sql);
    expect((await db.query<{body:string}>("select pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure) as body")).rows[0].body).toBe(definition);
    expect((await db.query(applyPropertiesSql)).rows).toEqual(applyPropertiesBefore);
  });
  it('025 rechaza una definición inesperada en vez de reemplazarla silenciosamente',async()=>{
    const definition=(await db.query<{body:string}>("select pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure) as body")).rows[0].body;
    const changed=definition.replace("and action not in ('resume','discard','cancel') then","and action not in ('resume','discard','cancel','unexpected') then");
    expect(changed).not.toBe(definition);
    await db.exec(changed);
    const sql=(await readFile(new URL('025_cancel_stale_list_preserve_messages.sql',migrationUrl),'utf8')).replace(/^begin;$/m,'').replace(/^commit;$/m,'');
    await expect(db.exec(sql)).rejects.toThrow('STALE_CANCEL_DEFINITION_UNEXPECTED');
  });
  it('bloquea mutaciones financieras si la cuenta fue suspendida después de interpretar',async()=>{
    await enqueue(message('one')); await claim(); const job=(await next())!;
    await db.query("update public.profiles set subscription_status='suspended' where id=$1",[a]);
    await expect(apply(job,{kind:'add',items:[movement()]})).rejects.toThrow('QUEUE_ACCOUNT_UNAVAILABLE');
  });
  it('no procesa automáticamente los registros heredados',async()=>{
    await db.query("insert into public.whatsapp_message_queue(wa_message_id,wa_id,user_id,payload) values('legacy','synthetic-a',$1,'{}')",[a]);
    await enqueue(message('new')); await claim(); expect((await next())?.payload.id).toBe('new');
    expect((await db.query("select status,queue_version from public.whatsapp_message_queue where wa_message_id='legacy'")).rows[0]).toEqual({status:'pending',queue_version:1});
  });
  it('migra propuestas antiguas a borradores sin confirmar ni cambiar movimientos confirmados',async()=>{
    await db.exec('update public.whatsapp_queue_control set enabled=false');
    await db.query("insert into public.transactions(user_id,kind,description,amount_ars,currency,occurred_on,status,source) values($1,'expense','Propuesta vieja',123,'ARS','2026-10-14','pending','audio'),($1,'income','Confirmado existente',77,'USD','2026-10-14','confirmed','text')",[a]);
    const confirmedBefore=(await db.query("select to_jsonb(t) as row from public.transactions t where status='confirmed'")).rows;
    expect(await rpc('migrate_whatsapp_legacy_proposals')).toBe(1);
    expect(await rpc('migrate_whatsapp_legacy_proposals')).toBe(0);
    expect((await db.query("select description,amount::text as amount,status,legacy_transaction_id is not null as linked from public.draft_items")).rows).toEqual([{description:'Propuesta vieja',amount:'123.00',status:'pending',linked:true}]);
    expect((await db.query("select to_jsonb(t) as row from public.transactions t where status='confirmed'")).rows).toEqual(confirmedBefore);
  });
  it('un mensaje con más de 20 operaciones queda retenido íntegro sin inserciones parciales',async()=>{
    await enqueue(message('one')); await claim(); const job=(await next())!;
    const result=await apply(job,{kind:'add',items:Array.from({length:21},()=>movement())}); await finish(result);
    expect((await db.query('select count(*)::int as n from public.draft_items')).rows[0]).toEqual({n:0});
    expect((await db.query('select status,pause_reason from public.whatsapp_message_queue')).rows[0]).toEqual({status:'waiting',pause_reason:'capacity'});
  });
  it('un intento agotado no desaparece: pasa a revisión y envía un aviso durable',async()=>{
    await enqueue(message('one')); await claim();
    await db.exec('update public.whatsapp_message_queue set attempts=5');
    const job=(await next())!; expect(job.effect_applied).toBe(true); expect(job.reply_text).toContain('conservado'); await finish(job);
    expect((await db.query('select status,pause_reason from public.whatsapp_message_queue')).rows[0]).toEqual({status:'waiting',pause_reason:'manual_review'});
  });
  it('un audio en revisión no bloquea audios ni textos nuevos ni la recuperación',async()=>{
    await enqueue({...message('broken'),type:'audio',text:undefined,audio:{id:'synthetic-media'}}); await claim();
    await db.exec('update public.whatsapp_message_queue set attempts=5');
    const broken=(await next())!; await finish(broken);
    await enqueue({...message('next-audio'),type:'audio',text:undefined,audio:{id:'synthetic-next'}},message('new-text'));
    await rpc('release_whatsapp_actor',{p_wa_id:'synthetic-a',p_token:t1});
    expect(await rpc('due_whatsapp_actors')).toContain('synthetic-a');
    await claim(); const audio=(await next())!; expect(audio.payload.id).toBe('next-audio');
    await apply(audio,{kind:'reply',text:'No interpretado; pasalo en texto'}); await finish(audio);
    const text=(await next())!; expect(text.payload.id).toBe('new-text');
    await apply(text,{kind:'reply',text:'Procesado'}); await finish(text);
    expect((await db.query("select status,pause_reason from public.whatsapp_message_queue where wa_message_id='broken'")).rows[0]).toEqual({status:'waiting',pause_reason:'manual_review'});
    expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0].n).toBe(0);
  });
  it('el aviso agotado explica que no cargó el mensaje, pide texto y permite continuar',async()=>{
    await enqueue(message('broken')); await claim(); await db.exec('update public.whatsapp_message_queue set attempts=5');
    const job=(await next())!;
    expect(job.reply_text).toContain('no lo cargué');
    expect(job.reply_text).toContain('texto');
    expect(job.reply_text).toContain('concepto y el monto');
    expect(job.reply_text).toContain('Podés seguir');
    await finish(job);
  });
  it('confirma solo movimientos revisados sin incluir ni reintentar el mensaje aislado',async()=>{
    await enqueue(message('broken')); await claim(); await db.exec('update public.whatsapp_message_queue set attempts=5');
    const broken=(await next())!; await finish(broken);
    await add('valid',[movement('Completo',250)]); await show();
    await enqueue(message('confirm','synthetic-a','confirmar')); const confirmation=(await next())!;
    await apply(confirmation,{kind:'confirm'}); await finish(confirmation);
    expect((await db.query('select amount_ars::text as amount,status from public.transactions')).rows).toEqual([{amount:'250.00',status:'confirmed'}]);
    expect((await db.query("select status,attempts from public.whatsapp_message_queue where wa_message_id='broken'")).rows).toEqual([{status:'waiting',attempts:6}]);
  });
  it.each(['stale','capacity',null,'unknown'])('conserva la pausa %s y permite un comando para resolverla',async(reason)=>{
    await enqueue(message('held')); await db.query("update public.whatsapp_message_queue set status='waiting',pause_reason=$1,effect_applied=true",[reason]);
    await enqueue(message('ordinary'));
    expect(await rpc('due_whatsapp_actors')).not.toContain('synthetic-a');
    await claim(); expect(await next()).toBeNull();
    await enqueue(message('cancel','synthetic-a','cancelar'));
    expect((await next())?.payload.id).toBe('cancel');
  });
  it('reaplicar la migración conserva mensajes, movimientos y permisos internos',async()=>{
    await enqueue(message('broken')); await claim(); await db.exec('update public.whatsapp_message_queue set attempts=5');
    const broken=(await next())!; await finish(broken); await enqueue(message('pending'));
    const rows=(await db.query('select to_jsonb(q) as row from public.whatsapp_message_queue q order by enqueue_order')).rows;
    const aclSql="select proname,proowner,proacl::text,prosecdef,proconfig from pg_proc where oid in('public.next_whatsapp_job(text,uuid)'::regprocedure,'public.due_whatsapp_actors()'::regprocedure) order by proname";
    const acl=(await db.query(aclSql)).rows;
    // Quitar solo los controles transaccionales del archivo al estar dentro de la transacción del test.
    await db.exec((await readFile(new URL('026_nonblocking_manual_review.sql',migrationUrl),'utf8')).replace(/^begin;|^commit;/gm,''));
    expect((await db.query('select to_jsonb(q) as row from public.whatsapp_message_queue q order by enqueue_order')).rows).toEqual(rows);
    expect((await db.query(aclSql)).rows).toEqual(acl);
    expect((await db.query("select has_function_privilege('anon','public.next_whatsapp_job(text,uuid)','execute') as allowed")).rows[0]).toEqual({allowed:false});
    expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0].n).toBe(0);
  });
  it('las operaciones de otro cliente quedan aisladas',async()=>{
    await add('a'); await enqueue(message('b','synthetic-b')); await claim('synthetic-b',t2);
    const job=(await next('synthetic-b',t2))!; await apply(job,{kind:'add',items:[movement('Solo B',250)]},t2); await finish(job,t2);
    const rows=(await db.query('select user_id,description from public.draft_items order by user_id')).rows;
    expect(rows).toEqual([{user_id:a,description:'Supermercado'},{user_id:b,description:'Solo B'}]);
  });
  it('no permite insertar un pendiente en un grupo ya confirmado',async()=>{
    await add('a'); const draft=await show(); await enqueue(message('confirm','synthetic-a','confirmar')); const job=(await next())!; await apply(job,{kind:'confirm'}); await finish(job);
    await expect(db.query("insert into public.draft_items(group_id,user_id,position,description,amount) values($1,$2,99,'No debe quedar oculto',10)",[draft.group_id,a])).rejects.toThrow('QUEUE_GROUP_CLOSED');
  });
  it('la recuperación programada omite el HTTP cuando la cola está vacía o deshabilitada',async()=>{
    expect(await rpc('dispatch_whatsapp_queue_recovery')).toBeNull();
    await enqueue(message('one')); await db.exec('update public.whatsapp_queue_control set enabled=false');
    expect(await rpc('dispatch_whatsapp_queue_recovery')).toBeNull();
    expect((await db.query('select count(*)::int as n from public.synthetic_http_requests')).rows[0]).toEqual({n:0});
  });
  it('la recuperación usa un secreto de Vault por header y ningún payload del cliente',async()=>{
    await db.exec("insert into vault.decrypted_secrets values('whatsapp_worker_secret','synthetic-worker-secret')");
    await enqueue(message('one')); expect(await rpc('dispatch_whatsapp_queue_recovery')).toBe(200);
    const request=(await db.query<{url:string;headers:Record<string,string>;body:unknown}>('select * from public.synthetic_http_requests')).rows[0];
    expect(request.url).toContain('?action=worker'); expect(request.body).toEqual({}); expect(request.headers['x-worker-secret']).toBe('synthetic-worker-secret');
    expect((await db.query<{command:string}>('select command from cron.job')).rows[0].command).not.toContain('synthetic-worker-secret');
  });
  it('el transporte rechaza HTTP fallido sin guardar headers en pg_net',async()=>{
    await db.exec("insert into vault.decrypted_secrets values('whatsapp_worker_secret','synthetic-worker-secret'); select set_config('synthetic.http_status','401',true)");
    await enqueue(message('one'));
    await expect(rpc('dispatch_whatsapp_queue_recovery')).rejects.toThrow('QUEUE_RECOVERY_HTTP_REJECTED');
    expect((await db.query('select count(*)::int as n from net.http_request_queue')).rows[0]).toEqual({n:0});
  });
  it('cron detecta la falta del secreto y no intenta un worker sin autenticación',async()=>{
    await enqueue(message('one')); await expect(rpc('dispatch_whatsapp_queue_recovery')).rejects.toThrow('QUEUE_RECOVERY_SECRET_MISSING');
  });
  it.each(['anon','authenticated'])('%s no accede a los leases ni a las nuevas RPC',async role=>{
    expect((await db.query('select has_function_privilege($1,\'public.enqueue_whatsapp_messages(jsonb)\',\'execute\') as allowed',[role])).rows[0]).toEqual({allowed:false});
    expect((await db.query('select has_table_privilege($1,\'public.whatsapp_worker_state\',\'select,insert,update,delete\') as allowed',[role])).rows[0]).toEqual({allowed:false});
  });
});

describe('lectura real de payloads de Meta',()=>{
  it('recorre entry/change/messages y ordena por timestamp dentro del payload',()=>{
    const payload={entry:[{changes:[{value:{messages:[{...message('two'),timestamp:'20'}]}},{value:{messages:[{...message('one'),timestamp:'10'}]}}]},{changes:[{value:{messages:[{...message('three'),timestamp:'0'}]}}]}]};
    expect(readMessages(payload).map(m=>m.id)).toEqual(['three','one','two']);
  });
});

describe('trabajador real con fallos simulados',()=>{
  function dependencies() {
    let clock=0;
    const job:Job={id:'job',wa_id:'synthetic-a',payload:message('one'),attempts:1,effect_applied:false,parsed_result:null,reply_text:null};
    const calls:string[]=[];
    const rpcMock=vi.fn(async(name:string)=>{calls.push(name); if(name==='claim_whatsapp_actor') return true; if(name==='next_whatsapp_job') return calls.filter(c=>c===name).length===1?job:null; if(name==='apply_whatsapp_job') return {...job,effect_applied:true,reply_text:'Listo'}; return null;});
    const deps:QueueDependencies={rpc:rpcMock as QueueDependencies['rpc'],prepare:vi.fn(async()=>({kind:'add',items:[movement()]})),send:vi.fn(async()=>{}),format:()=>'',now:()=>clock,sleep:async ms=>{clock+=ms;},token:()=>t1,metric:vi.fn()};
    return {deps,calls,job};
  }
  it('si la entrega falla, conserva el checkpoint y pide reintento sin finalizar',async()=>{
    const {deps,calls}=dependencies(); deps.send=vi.fn(async()=>{throw new Error('synthetic');});
    await runActor('synthetic-a',deps);
    expect(calls).toContain('fail_whatsapp_job'); expect(calls).not.toContain('finish_whatsapp_job'); expect(calls.at(-1)).toBe('release_whatsapp_actor');
  });
  it('una recuperación con efecto aplicado omite la IA y la mutación',async()=>{
    const {deps,calls,job}=dependencies(); job.effect_applied=true; job.reply_text='Guardado anteriormente';
    await runActor('synthetic-a',deps);
    expect(deps.prepare).not.toHaveBeenCalled(); expect(calls).not.toContain('apply_whatsapp_job'); expect(calls).toContain('finish_whatsapp_job');
  });
});

describe('INF-04 / BE-10: trabajador con SQL real y fallos de entrega',()=>{
  async function seed() {
    await add('outbox-seed',[{...movement('Cuotas ARS',100.01),installments:3}, {...movement('Ingreso USD',50.25),kind:'income',currency:'USD'}]);
    await show(); await rpc('release_whatsapp_actor',{p_wa_id:'synthetic-a',p_token:t1});
    await enqueue(message('outbox-confirm','synthetic-a','confirmar'));
  }
  function worker(fault?:{name:string;after?:boolean},deliveryFailures=0,releaseFailure=false) {
    let fired=false, clock=Date.now();
    const calls:string[]=[];
    const deps:QueueDependencies={
      rpc:async<T>(name:string,args:Record<string,unknown>={})=>{
        calls.push(name);
        if(name==='release_whatsapp_actor'&&releaseFailure) throw new Error('synthetic_process_stopped');
        if(fault?.name===name&&!fired&&!fault.after) {fired=true;throw new Error('synthetic_network_before_commit');}
        const result=await rpc<T>(name,args);
        if(fault?.name===name&&!fired&&fault.after) {fired=true;throw new Error('synthetic_response_lost_after_commit');}
        return result;
      },
      prepare:vi.fn(async(_job,checkpoint)=>{await checkpoint({intent:'confirm',movements:[]});return {kind:'confirm'};}),
      send:vi.fn(async()=>{if(deliveryFailures-->0) throw new Error('synthetic_provider_unavailable');}),
      format:()=> 'Resumen sintético',now:()=>clock,sleep:async ms=>{clock+=ms;},token:()=>t1,metric:vi.fn(),
    };
    return {deps,calls};
  }
  async function recover() {
    await db.exec("update public.whatsapp_message_queue set scheduled_for=clock_timestamp() where queue_version=2 and status='failed'; update public.whatsapp_worker_state set lease_until=clock_timestamp()-interval '1 second'; update public.whatsapp_user_leases set lease_until=clock_timestamp()-interval '1 second'");
    expect(await rpc<string[]>('due_whatsapp_actors')).toContain('synthetic-a');
  }
  async function confirmed() {
    return (await db.query('select id,kind,currency,amount_ars::text as amount,installment_number,installment_count from public.transactions order by currency,installment_number')).rows;
  }
  it('reproduce que un fallo tardío no debe reabrir una entrega ya finalizada',async()=>{
    await seed(); const {deps}=worker({name:'finish_whatsapp_job',after:true});
    await runActor('synthetic-a',deps);
    expect((await db.query("select status,reply_sent_at is not null as delivered from public.whatsapp_message_queue where wa_message_id='outbox-confirm'")).rows[0]).toEqual({status:'processed',delivered:true});
    await runActor('synthetic-a',deps);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect((await confirmed()).length).toBe(4);
  });
  it.each([false,true])('recupera fallo de RPC de guardado (commit=%s) sin duplicar monedas ni cuotas',async after=>{
    await seed();const {deps,calls}=worker({name:'apply_whatsapp_job',after});
    await runActor('synthetic-a',deps);
    expect(deps.send).not.toHaveBeenCalled();
    expect((await confirmed()).length).toBe(after?4:0);
    await recover();await runActor('synthetic-a',deps);
    const rows=await confirmed();expect(rows).toHaveLength(4);
    expect((await db.query('select currency,sum(amount_ars)::text as total from public.transactions group by currency order by currency')).rows).toEqual([{currency:'ARS',total:'100.01'},{currency:'USD',total:'50.25'}]);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(calls.filter(name=>name==='apply_whatsapp_job')).toHaveLength(after?1:2);
  });
  it('reenvío de Meta y fallo del proveedor recuperan solo la respuesta aun con más de cinco intentos',async()=>{
    await seed();const {deps,calls}=worker(undefined,1);
    await runActor('synthetic-a',deps);const saved=await confirmed();
    await enqueue(message('outbox-confirm','synthetic-a','confirmar'));
    await db.exec("update public.whatsapp_message_queue set attempts=8 where wa_message_id='outbox-confirm'");
    await recover();await runActor('synthetic-a',deps);
    expect(await confirmed()).toEqual(saved);
    expect(deps.prepare).toHaveBeenCalledTimes(1);expect(calls.filter(name=>name==='apply_whatsapp_job')).toHaveLength(1);
    expect(deps.send).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.send).mock.calls[0][1]).toEqual(vi.mocked(deps.send).mock.calls[1][1]);
    expect((await db.query("select count(*)::int as n from public.whatsapp_message_queue where wa_message_id='outbox-confirm'")).rows[0]).toEqual({n:1});
  });
  it('aceptación de Meta y fallo previo al registro pueden repetir respuesta pero nunca el guardado',async()=>{
    await seed();const {deps}=worker({name:'finish_whatsapp_job'});
    await runActor('synthetic-a',deps);const saved=await confirmed();
    await recover();await runActor('synthetic-a',deps);
    expect(deps.send).toHaveBeenCalledTimes(2);expect(await confirmed()).toEqual(saved);
    expect(vi.mocked(deps.send).mock.calls[0][1]).toEqual(vi.mocked(deps.send).mock.calls[1][1]);
  });
  it('muerte tras guardar y fallo al liberar el lease se recuperan con otro trabajador',async()=>{
    await seed();const stopped=worker({name:'fail_whatsapp_job'},1,true);
    await expect(runActor('synthetic-a',stopped.deps)).rejects.toThrow('synthetic_process_stopped');
    const saved=await confirmed();expect(saved).toHaveLength(4);
    expect(await rpc<string[]>('due_whatsapp_actors')).not.toContain('synthetic-a');
    await recover();const replacement=worker();await runActor('synthetic-a',replacement.deps);
    expect(replacement.deps.prepare).not.toHaveBeenCalled();expect(await confirmed()).toEqual(saved);
    expect(replacement.deps.send).toHaveBeenCalledOnce();
  });
  it('un fallo en la segunda cuota revierte todo y no anuncia éxito',async()=>{
    await seed();
    await db.exec("create function public.synthetic_reject_installment() returns trigger language plpgsql as $$ begin if new.installment_number=2 then raise exception 'SYNTHETIC_INSTALLMENT_FAILURE'; end if; return new; end $$; create trigger synthetic_reject_installment before insert on public.transactions for each row execute function public.synthetic_reject_installment()");
    const {deps}=worker();await runActor('synthetic-a',deps);
    expect(await confirmed()).toHaveLength(0);expect(deps.send).not.toHaveBeenCalled();
    expect((await db.query("select status from public.draft_groups")).rows[0]).toEqual({status:'open'});
    await db.exec('drop trigger synthetic_reject_installment on public.transactions');
    await recover();await runActor('synthetic-a',deps);
    expect(await confirmed()).toHaveLength(4);expect(deps.send).toHaveBeenCalledOnce();
  });
  it('un resumen cuyo envío falla queda recuperable sin volver a interpretar',async()=>{
    await add('summary-seed');
    await db.exec("update public.whatsapp_worker_state set last_received_at=clock_timestamp()-interval '4 seconds'");
    await rpc('release_whatsapp_actor',{p_wa_id:'synthetic-a',p_token:t1});
    const first=worker(undefined,1);
    await expect(runActor('synthetic-a',first.deps)).rejects.toThrow('synthetic_provider_unavailable');
    expect((await db.query('select summary_pending,shown_version from public.whatsapp_worker_state')).rows[0]).toEqual({summary_pending:true,shown_version:null});
    expect(await rpc<string[]>('due_whatsapp_actors')).toContain('synthetic-a');
    const retry=worker();await runActor('synthetic-a',retry.deps);
    expect(retry.deps.prepare).not.toHaveBeenCalled();expect(retry.deps.send).toHaveBeenCalledOnce();
    expect((await db.query('select summary_pending from public.whatsapp_worker_state')).rows[0]).toEqual({summary_pending:false});
    expect(await confirmed()).toHaveLength(0);
  });
  it('un fallo tardío no reabre un aviso de revisión ya entregado ni reprograma dos veces',async()=>{
    await enqueue(message('held'));await claim();
    await db.exec("update public.whatsapp_message_queue set attempts=5");
    const held=(await next())!;await finish(held);
    const before=(await db.query('select status,scheduled_for,reply_sent_at from public.whatsapp_message_queue')).rows;
    await rpc('fail_whatsapp_job',{p_id:held.id,p_token:t1});await finish(held);
    expect((await db.query('select status,scheduled_for,reply_sent_at from public.whatsapp_message_queue')).rows).toEqual(before);
  });
  it('dos confirmaciones con IDs distintos no vuelven a guardar el grupo',async()=>{
    await seed();await enqueue(message('outbox-confirm-again','synthetic-a','confirmar'));
    const {deps}=worker();await runActor('synthetic-a',deps);
    expect(await confirmed()).toHaveLength(4);
    expect(vi.mocked(deps.send).mock.calls.map(call=>call[1]).filter(body=>body.includes('Se guardaron'))).toHaveLength(1);
  });
  it('un fallo del destino de logs no reabre el guardado ni duplica la respuesta',async()=>{
    await seed();const {deps}=worker();deps.metric=createLogWriter(()=>{throw new Error('SYNTHETIC_LOG_SINK_FAILURE');});
    await runActor('synthetic-a',deps);await runActor('synthetic-a',deps);
    expect(await confirmed()).toHaveLength(4);expect(deps.send).toHaveBeenCalledOnce();
    expect((await db.query<{status:string}>("select status from public.whatsapp_message_queue where wa_message_id='outbox-confirm'")).rows[0].status).toBe('processed');
  });
  it('un error crudo del proveedor conserva reintento y fase sin registrar su contenido',async()=>{
    await seed();const {deps}=worker();const lines:string[]=[];deps.metric=createLogWriter(line=>lines.push(line));
    deps.send=vi.fn(async()=>{throw new Error('PRIVATE_PROVIDER_CANARY synthetic-phone synthetic-key synthetic-receipt');});
    await runActor('synthetic-a',deps);
    expect(lines.join('')).not.toContain('PRIVATE_PROVIDER_CANARY');
    expect(lines.map(line=>JSON.parse(line)).find(event=>event.event==='queue_retry')).toMatchObject({stage:'send',attempts:1});
    expect(await confirmed()).toHaveLength(4);
  });
});

describe('audio no interpretado: respuesta durable y reemplazo por texto',()=>{
  it('conserva payload y checkpoint; un fallo de envío reintenta solo la respuesta y permite texto',async()=>{
    const audio:IncomingMessage={id:'fallback-audio',from:'synthetic-a',type:'audio',audio:{id:'synthetic-media'}};
    await enqueue(audio);
    let clock=Date.now(),failSend=true;
    const deps:QueueDependencies={rpc,prepare:vi.fn(async(job,checkpoint)=>{
      if(job.payload.type==='audio') {await checkpoint({intent:'request_text',movements:[]});return {kind:'reply',text:'Escribime el gasto en texto. No cargué el audio.'};}
      await checkpoint({intent:'add_movements',movements:[movement()]});return {kind:'add',items:[movement()]};
    }),send:vi.fn(async()=>{if(failSend){failSend=false;throw Error('synthetic-delivery-failure');}}),format:()=> 'Resumen',now:()=>clock,sleep:async ms=>{clock+=ms;},token:()=>t1,metric:vi.fn()};
    await runActor('synthetic-a',deps);
    const first=(await db.query<{payload:unknown;parsed_result:unknown;effect_applied:boolean}>("select payload,parsed_result,effect_applied from public.whatsapp_message_queue where wa_message_id='fallback-audio'")).rows[0];
    expect(first).toMatchObject({payload:audio,parsed_result:{intent:'request_text',movements:[]},effect_applied:true});
    expect((await db.query<{n:number}>('select count(*)::int as n from public.draft_items')).rows[0].n).toBe(0);
    await db.exec('update public.whatsapp_message_queue set scheduled_for=clock_timestamp()');
    await runActor('synthetic-a',deps);
    expect(deps.prepare).toHaveBeenCalledTimes(1);
    expect((await db.query("select status,pause_reason from public.whatsapp_message_queue where wa_message_id='fallback-audio'")).rows[0]).toEqual({status:'processed',pause_reason:null});
    await enqueue(audio,message('replacement-text')); // Meta reenvía: no reabre el audio.
    await runActor('synthetic-a',deps);
    expect(deps.prepare).toHaveBeenCalledTimes(2);
    expect((await db.query<{n:number}>('select count(*)::int as n from public.draft_items')).rows[0].n).toBe(1);
    expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0].n).toBe(0);
    expect((await db.query<{n:number}>("select count(*)::int as n from public.whatsapp_message_queue where wa_message_id='fallback-audio'")).rows[0].n).toBe(1);
  });
});

describe('INF-12: presupuesto del trabajador y fencing del checkpoint',()=>{
  it('un presupuesto agotado evita checkpoint tardío y permite recuperar el trabajo sin duplicar',async()=>{
    await enqueue(message('budget-exhausted'));
    const controller=new AbortController();const originalTimeout=AbortSignal.timeout;
    const spy=vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>ms===60000?controller.signal:originalTimeout(ms));
    let lateCheckpoint:Promise<void>|undefined,clock=Date.now();
    const deps:QueueDependencies={rpc,prepare:vi.fn(async(_job,checkpoint,signal)=>{
      expect(signal).toBeDefined();controller.abort(new DOMException('synthetic-job-deadline','TimeoutError'));
      lateCheckpoint=checkpoint({intent:'add_movements',movements:[movement()]});
      await expect(lateCheckpoint).rejects.toMatchObject({name:'TimeoutError'});
      return {kind:'add',items:[movement()]};
    }),send:vi.fn(async()=>{}),format:()=> 'Resumen',now:()=>clock,sleep:async ms=>{clock+=ms;},token:()=>t1,metric:vi.fn()};
    try {await runActor('synthetic-a',deps);if(lateCheckpoint)await lateCheckpoint.catch(()=>{});}finally{spy.mockRestore();}
    expect((await db.query("select status,parsed_result,effect_applied from public.whatsapp_message_queue where wa_message_id='budget-exhausted'")).rows[0]).toEqual({status:'failed',parsed_result:null,effect_applied:false});
    expect((await db.query<{n:number}>('select count(*)::int as n from public.draft_items')).rows[0].n).toBe(0);
    expect(deps.send).not.toHaveBeenCalled();
    await db.exec('update public.whatsapp_message_queue set scheduled_for=clock_timestamp()');
    deps.prepare=vi.fn(async(_job,checkpoint)=>{await checkpoint({intent:'add_movements',movements:[movement()]});return {kind:'add',items:[movement()]};});
    await runActor('synthetic-a',deps);
    expect((await db.query<{n:number}>('select count(*)::int as n from public.draft_items')).rows[0].n).toBe(1);
    expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0].n).toBe(0);
  });
});

it('INF-12: la ventana compartida termina el mensaje actual y deja el siguiente para recuperación',async()=>{
  await enqueue(message('window-first'),message('window-second'));const stop=new AbortController();let clock=Date.now();
  const deps:QueueDependencies={rpc,stopStartingSignal:stop.signal,prepare:vi.fn(async(_job,checkpoint)=>{
    await checkpoint({intent:'add_movements',movements:[movement()]});stop.abort();return {kind:'add',items:[movement()]};
  }),send:vi.fn(async()=>{}),format:()=> 'Resumen',now:()=>clock,sleep:async ms=>{clock+=ms;},token:()=>t1,metric:vi.fn()};
  await runActor('synthetic-a',deps);
  expect(deps.prepare).toHaveBeenCalledTimes(1);
  expect((await db.query('select status from public.whatsapp_message_queue order by enqueue_order')).rows).toEqual([{status:'processed'},{status:'pending'}]);
  expect((await db.query<{n:number}>('select count(*)::int as n from public.draft_items')).rows[0].n).toBe(1);
  deps.stopStartingSignal=undefined;await runActor('synthetic-a',deps);
  expect((await db.query<{n:number}>('select count(*)::int as n from public.draft_items')).rows[0].n).toBe(2);
  expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0].n).toBe(0);
});


describe('INF-14: observabilidad y retención sin contenido de clientes',()=>{
  async function healthy(){await db.exec("insert into cron.job_run_details(jobid,status,end_time) select jobid,'succeeded',clock_timestamp() from cron.job where jobname='pesito-whatsapp-queue-recovery'");}
  async function enableNotices(){await db.query("insert into public.whatsapp_links(user_id,wa_id,status) values($1,'synthetic-admin','active') on conflict(user_id) do update set wa_id='synthetic-admin',status='active'",[admin]);await rpc('configure_whatsapp_ops_alerts',{p_enabled:true});await db.exec("update public.whatsapp_ops_config set verified_test_sender_digits='15550000000'");await enqueue(message('ops-admin-window','synthetic-admin','resumen'));await db.exec("update public.whatsapp_message_queue set status='processed',effect_applied=true,processed_at=clock_timestamp() where wa_message_id='ops-admin-window'");}
  it('una demora simulada genera alerta útil, sin textos ni identificadores, y se resuelve al terminar',async()=>{
    await healthy();await enqueue(message('ops-delay'));await db.exec("update public.whatsapp_message_queue set received_at=clock_timestamp()-interval '4 minutes'");
    await rpc('refresh_whatsapp_ops_health');const dashboard=await rpc<{alerts:Array<{code:string;affected:number}>}>('whatsapp_ops_dashboard');
    expect(dashboard.alerts).toEqual([expect.objectContaining({code:'queue_delay',affected:1})]);
    expect(JSON.stringify(dashboard)).not.toContain('synthetic-a');expect(JSON.stringify(dashboard)).not.toContain('Gasté');expect(JSON.stringify(dashboard)).not.toContain('ops-delay');
    await claim();const job=(await next())!;await apply(job,{kind:'reply',text:'Procesado'});await finish(job);await rpc('refresh_whatsapp_ops_health');
    expect((await rpc<{alerts:unknown[]}>('whatsapp_ops_dashboard')).alerts).toEqual([]);
  });
  it('revisión manual alerta sin bloquear; las pausas intencionales y v1 no son una demora operativa',async()=>{
    await healthy();await enqueue(message('held'));await db.exec("update public.whatsapp_message_queue set status='waiting',pause_reason='manual_review',received_at=clock_timestamp()-interval '5 days'");
    await rpc('refresh_whatsapp_ops_health');expect((await rpc<{alerts:Array<{code:string}>}>('whatsapp_ops_dashboard')).alerts.map(a=>a.code)).toEqual(['manual_review']);
    await db.exec("update public.whatsapp_message_queue set pause_reason='stale'");await enqueue(message('held-behind'));await db.exec("update public.whatsapp_message_queue set received_at=clock_timestamp()-interval '5 days'");
    await rpc('refresh_whatsapp_ops_health');expect((await rpc<{alerts:unknown[]}>('whatsapp_ops_dashboard')).alerts).toEqual([]);
  });
  it('conserva avisos, limita frecuencia y no repite el mismo incidente',async()=>{
    await healthy();await enableNotices();await enqueue(message('delay'));await db.exec("update public.whatsapp_message_queue set received_at=clock_timestamp()-interval '4 minutes'");
    await rpc('refresh_whatsapp_ops_health');await rpc('refresh_whatsapp_ops_health');expect((await db.query('select count(*)::int as n from public.whatsapp_ops_notifications')).rows).toEqual([{n:1}]);
    const notice=await rpc<{id:string;to:string}>('claim_whatsapp_ops_notice',{p_token:t1});expect(notice.to).toBe('synthetic-admin');expect(await rpc('claim_whatsapp_ops_notice',{p_token:t2})).toBeNull();
    await rpc('finish_whatsapp_ops_notice',{p_id:notice.id,p_token:t1,p_outcome:'sent'});await db.exec("update public.whatsapp_ops_config set last_notice_created_at=clock_timestamp()-interval '1 hour'");await rpc('refresh_whatsapp_ops_health');
    expect((await db.query('select count(*)::int as n from public.whatsapp_ops_notifications')).rows).toEqual([{n:1}]);
  });
  it('un envío interrumpido queda incierto y no vuelve a reclamarse',async()=>{
    await healthy();await enableNotices();await enqueue(message('delay'));await db.exec("update public.whatsapp_message_queue set received_at=clock_timestamp()-interval '4 minutes'");await rpc('refresh_whatsapp_ops_health');
    await rpc('claim_whatsapp_ops_notice',{p_token:t1});await db.exec("update public.whatsapp_ops_notifications set lease_until=clock_timestamp()-interval '1 second'");await rpc('refresh_whatsapp_ops_health');
    expect((await db.query('select state from public.whatsapp_ops_notifications')).rows).toEqual([{state:'uncertain'}]);expect(await rpc('claim_whatsapp_ops_notice',{p_token:t2})).toBeNull();
  });
  it('fallos definitivos tienen como máximo tres intentos y reconocidos no se envían',async()=>{
    await healthy();await enableNotices();await enqueue(message('delay'));await db.exec("update public.whatsapp_message_queue set received_at=clock_timestamp()-interval '4 minutes'");await rpc('refresh_whatsapp_ops_health');
    for(let i=0;i<3;i++){const n=await rpc<{id:string}>('claim_whatsapp_ops_notice',{p_token:t1});await rpc('finish_whatsapp_ops_notice',{p_id:n.id,p_token:t1,p_outcome:'failed'});await db.exec('update public.whatsapp_ops_notifications set available_at=clock_timestamp()');}
    expect((await db.query('select state,attempts from public.whatsapp_ops_notifications')).rows).toEqual([{state:'failed',attempts:3}]);expect(await rpc('claim_whatsapp_ops_notice',{p_token:t2})).toBeNull();
    await rpc('acknowledge_whatsapp_ops_alert',{p_code:'queue_delay'});await db.exec("update public.whatsapp_ops_config set last_notice_created_at=clock_timestamp()-interval '1 hour'");await rpc('refresh_whatsapp_ops_health');expect((await db.query('select count(*)::int as n from public.whatsapp_ops_notifications')).rows).toEqual([{n:1}]);
  });
  it('registra solo agregados y conserva promedio/máximo/cantidad',async()=>{
    await rpc('record_whatsapp_ops_metrics',{p_samples:[{event:'queue_interpret',duration_ms:20,operations:2,text:'PRIVATE_TEXT'},{event:'queue_interpret',duration_ms:40,operations:1}]});
    expect((await db.query('select samples,duration_total_ms::text as total,duration_max_ms::text as maximum,operations_total from public.whatsapp_ops_metrics')).rows).toEqual([{samples:2,total:'60',maximum:'40',operations_total:3}]);
    expect(JSON.stringify((await db.query('select to_jsonb(m) as value from public.whatsapp_ops_metrics m')).rows)).not.toContain('PRIVATE_TEXT');
    await expect(rpc('record_whatsapp_ops_metrics',{p_samples:[{event:'private-secret'}]})).rejects.toThrow('OPS_INVALID_METRIC');
  });
  it('tres pedidos de texto recientes detectan degradación de interpretación',async()=>{
    await healthy();await rpc('record_whatsapp_ops_metrics',{p_samples:Array.from({length:3},()=>({event:'queue_clarification',source_kind:'audio'}))});await rpc('refresh_whatsapp_ops_health');
    expect((await rpc<{alerts:Array<{code:string}>}>('whatsapp_ops_dashboard')).alerts.map(a=>a.code)).toContain('interpretation_fallback');
  });
  it('cron detenido produce una alerta aunque la cola no tenga mensajes',async()=>{
    await healthy();await db.exec("update cron.job set active=false where jobname='pesito-whatsapp-queue-recovery'");await rpc('refresh_whatsapp_ops_health');
    expect((await rpc<{alerts:Array<{code:string}>}>('whatsapp_ops_dashboard')).alerts.map(a=>a.code)).toContain('recovery_failure');
  });
  it('el dispatch despierta para avisos aunque no existan trabajos financieros',async()=>{
    await healthy();await enableNotices();await db.exec("update cron.job set active=false where jobname='pesito-whatsapp-queue-recovery';insert into vault.decrypted_secrets values('whatsapp_worker_secret','synthetic-secret')");await rpc('refresh_whatsapp_ops_health');
    expect(await rpc('dispatch_whatsapp_queue_recovery')).toBe(200);
  });
  it('la limpieza nace desactivada y preserva pendientes, revisión, v1 y borradores abiertos',async()=>{
    await add('open');await enqueue(message('waiting'),message('legacy'));await db.exec("update public.whatsapp_message_queue set received_at=clock_timestamp()-interval '40 days',processed_at=clock_timestamp()-interval '31 days';update public.whatsapp_message_queue set status='waiting',pause_reason='manual_review' where wa_message_id='waiting';update public.whatsapp_message_queue set queue_version=1,status='processed' where wa_message_id='legacy'");
    const before=(await db.query('select to_jsonb(q) as value from public.whatsapp_message_queue q order by enqueue_order')).rows;
    expect(await rpc('prune_whatsapp_ops_content')).toBe(0);await db.exec('update public.whatsapp_ops_config set retention_enabled=true');expect(await rpc('prune_whatsapp_ops_content')).toBe(0);
    expect((await db.query('select to_jsonb(q) as value from public.whatsapp_message_queue q order by enqueue_order')).rows).toEqual(before);
  });
  it('redacta solo contenido antiguo terminado; conserva finanzas y deduplicación',async()=>{
    const original=await add('finished');await show();await enqueue(message('confirm','synthetic-a','confirmar'));const confirm=(await next())!;await apply(confirm,{kind:'confirm'});await finish(confirm);
    await db.query("update public.whatsapp_message_queue set processed_at=clock_timestamp()-interval '31 days',reply_text='PRIVATE_REPLY',parsed_result='{\"private\":\"PRIVATE_PARSED\"}' where id=$1",[original.id]);
    const financial=(await db.query('select to_jsonb(t) as value from public.transactions t')).rows;
    await db.exec('update public.whatsapp_ops_config set retention_enabled=true');expect(await rpc('prune_whatsapp_ops_content')).toBe(1);
    const row=(await db.query<{payload:Record<string,unknown>;reply_text:null;parsed_result:null}>('select payload,reply_text,parsed_result from public.whatsapp_message_queue where id=$1',[original.id])).rows[0];expect(row.payload).toEqual({id:'finished',from:'synthetic-a',type:'text',redacted:true});expect(row.reply_text).toBeNull();expect(row.parsed_result).toBeNull();
    await enqueue(message('finished'));expect((await db.query('select count(*)::int as n from public.whatsapp_message_queue')).rows).toEqual([{n:2}]);expect((await db.query('select to_jsonb(t) as value from public.transactions t')).rows).toEqual(financial);
  });
  it.each(['anon','authenticated'])('%s no lee tablas ni ejecuta mantenimiento o entregas',async(role)=>{
    expect((await db.query("select has_table_privilege($1,'public.whatsapp_ops_notifications','select') as allowed",[role])).rows).toEqual([{allowed:false}]);
    expect((await db.query("select has_function_privilege($1,'public.prune_whatsapp_ops_content()','execute') as allowed",[role])).rows).toEqual([{allowed:false}]);
    expect((await db.query("select has_function_privilege($1,'public.claim_whatsapp_ops_notice(uuid)','execute') as allowed",[role])).rows).toEqual([{allowed:false}]);
  });
  it('un cliente no puede ver métricas globales, reconocer alertas ni cambiar destinatario',async()=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[a]);
    await expect(rpc('whatsapp_ops_dashboard')).rejects.toThrow('OPS_ADMIN_REQUIRED');await expect(rpc('configure_whatsapp_ops_alerts',{p_enabled:true})).rejects.toThrow('OPS_ADMIN_REQUIRED');await expect(rpc('acknowledge_whatsapp_ops_alert',{p_code:'queue_delay'})).rejects.toThrow('OPS_ADMIN_REQUIRED');
  });
});


describe('INF-14: guardas de ventana, destinatario y política de costos',()=>{
 async function ready(){await db.exec("insert into cron.job_run_details(jobid,status,end_time) select jobid,'succeeded',clock_timestamp() from cron.job where jobname='pesito-whatsapp-queue-recovery'");await db.query("insert into public.whatsapp_links(user_id,wa_id,status) values($1,'synthetic-operator','active') on conflict(user_id) do update set wa_id='synthetic-operator',status='active'",[admin]);await rpc('configure_whatsapp_ops_alerts',{p_enabled:true});await enqueue(message('ops-delayed'));await db.exec("update public.whatsapp_message_queue set received_at=clock_timestamp()-interval '4 minutes'");}
 async function window(){await enqueue(message('operator-message','synthetic-operator','resumen'));await db.exec("update public.whatsapp_message_queue set status='processed' where wa_message_id='operator-message'");}
 it('sin verificar número de prueba conserva alertas del panel sin generar envíos',async()=>{await ready();await window();await rpc('refresh_whatsapp_ops_health');expect((await db.query('select count(*)::int as n from public.whatsapp_ops_notifications')).rows).toEqual([{n:0}]);expect((await rpc<{alerts:unknown[]}>('whatsapp_ops_dashboard')).alerts.length).toBe(1);});
 it('no envía fuera de 24 horas, ni considera un payload demorado como ventana nueva',async()=>{await ready();await db.exec("update public.whatsapp_ops_config set verified_test_sender_digits='15550000000'");await enqueue({...message('old-operator','synthetic-operator','resumen'),timestamp:String(Math.floor(Date.now()/1000)-86401)});await rpc('refresh_whatsapp_ops_health');expect((await db.query('select count(*)::int as n from public.whatsapp_ops_notifications')).rows).toEqual([{n:0}]);});
 it('cambiar la cuenta receptora nunca envía al cliente',async()=>{await ready();await window();await db.exec("update public.whatsapp_ops_config set verified_test_sender_digits='15550000000'");await rpc('refresh_whatsapp_ops_health');await db.query("update public.profiles set role='client' where id=$1",[admin]);expect(await rpc('claim_whatsapp_ops_notice',{p_token:t1})).toBeNull();expect((await db.query('select state from public.whatsapp_ops_notifications')).rows).toEqual([{state:'failed'}]);});
 it('un incidente que cambia antes del envío entrega el resumen actual y no pierde la alerta',async()=>{await ready();await window();await db.exec("update public.whatsapp_ops_config set verified_test_sender_digits='15550000000'");await rpc('refresh_whatsapp_ops_health');await enqueue(message('second-delay'));await db.exec("update public.whatsapp_message_queue set received_at=clock_timestamp()-interval '4 minutes' where wa_message_id='second-delay'");await rpc('refresh_whatsapp_ops_health');const n=await rpc<{snapshot:Array<{affected:number}>}>('claim_whatsapp_ops_notice',{p_token:t1});expect(n.snapshot[0].affected).toBe(2);});
 it('desactivar avisos cancela los pendientes sin tocar la cola de clientes',async()=>{await ready();await window();await db.exec("update public.whatsapp_ops_config set verified_test_sender_digits='15550000000'");await rpc('refresh_whatsapp_ops_health');await rpc('configure_whatsapp_ops_alerts',{p_enabled:false});expect((await db.query('select state from public.whatsapp_ops_notifications')).rows).toEqual([{state:'cancelled'}]);expect((await db.query("select status from public.whatsapp_message_queue where wa_message_id='ops-delayed'")).rows).toEqual([{status:'pending'}]);});
});


describe('diagnóstico de incidentes con cliente y fecha, solo para administración',()=>{
 async function issue(name='detail',from='synthetic-a',token=t1){await enqueue({...message(name,from,'PRIVATE_FINANCIAL_TEXT'),type:'audio',audio:{id:'PRIVATE_MEDIA'}});await claim(from,token);return (await next(from,token))!;}
 const diagnostic={kind:'retry',stage:'interpret',reason:'unavailable',provider:'gemini',status:503};
 it('conserva solo códigos permitidos y el panel muestra identidad, fecha y causa',async()=>{
  await db.query("update public.profiles set first_name='Clienta',last_name='Ficticia' where id=$1",[a]);const q=await issue();await rpc('record_whatsapp_job_issue',{p_id:q.id,p_token:t1,p_issue:{...diagnostic,message:'PRIVATE_ERROR',body:'PRIVATE_FINANCIAL_TEXT',token:'PRIVATE_TOKEN'}});
  await db.query("update public.whatsapp_message_queue set status='waiting',pause_reason='manual_review' where id=$1",[q.id]);await rpc('refresh_whatsapp_ops_health');
  const dashboard=await rpc<{alerts:Array<{code:string;details:Array<Record<string,unknown>>}>;recent_issues:Array<Record<string,unknown>>}>('whatsapp_ops_dashboard');const detail=dashboard.alerts.find(x=>x.code==='manual_review')!.details[0];expect(detail).toMatchObject({client_name:'Clienta Ficticia',source_kind:'audio',reason:'unavailable',provider:'gemini',status:503,time_source:'error',diagnostic_available:true});expect(Number.isFinite(Date.parse(String(detail.occurred_at)))).toBe(true);expect(dashboard.recent_issues).toHaveLength(1);expect(JSON.stringify(dashboard)).not.toContain('PRIVATE_');expect((await db.query<{ops_issue:unknown}>('select ops_issue from public.whatsapp_message_queue where id=$1',[q.id])).rows[0].ops_issue).toEqual(diagnostic);
 });
 it('un lease ajeno no puede adjudicar un error y un callback tardío no reabre un mensaje',async()=>{const q=await issue();await expect(rpc('record_whatsapp_job_issue',{p_id:q.id,p_token:t2,p_issue:diagnostic})).rejects.toThrow('QUEUE_LEASE_LOST');await apply(q,{kind:'reply',text:null});await finish(q);await rpc('record_whatsapp_job_issue',{p_id:q.id,p_token:t1,p_issue:diagnostic});expect((await db.query('select ops_issue,status from public.whatsapp_message_queue where id=$1',[q.id])).rows).toEqual([{ops_issue:null,status:'processed'}]);});
 it.each([{...diagnostic,reason:'PRIVATE_REASON'},{...diagnostic,provider:'PRIVATE_PROVIDER'},{...diagnostic,status:'503'},{...diagnostic,status:999}])('rechaza diagnósticos fuera del contrato',async d=>{const q=await issue();await expect(rpc('record_whatsapp_job_issue',{p_id:q.id,p_token:t1,p_issue:d})).rejects.toThrow('OPS_INVALID_ISSUE');});
 it('identifica los registros históricos como recibidos sin inventar una causa',async()=>{const q=await issue();await db.query("update public.whatsapp_message_queue set status='waiting',pause_reason='manual_review' where id=$1",[q.id]);await rpc('refresh_whatsapp_ops_health');const dash=await rpc<{alerts:Array<{code:string;details:Array<Record<string,unknown>>}>}>('whatsapp_ops_dashboard');expect(dash.alerts.find(a=>a.code==='manual_review')!.details[0]).toMatchObject({diagnostic_available:false,time_source:'received',reason:null,provider:null});});
 it('no atribuye un mensaje sin dueño al usuario que vinculó ese teléfono después',async()=>{const q=await issue();await db.query("update public.whatsapp_message_queue set user_id=null,status='waiting',pause_reason='manual_review' where id=$1",[q.id]);await rpc('refresh_whatsapp_ops_health');const dash=await rpc<{alerts:Array<{code:string;details:Array<Record<string,unknown>>}>}>('whatsapp_ops_dashboard');expect(dash.alerts.find(a=>a.code==='manual_review')!.details[0]).toMatchObject({client_name:'Persona sin vincular',client_reference:null});});
 it('resuelve nombres al reclamar el aviso y no los copia al historial de envíos',async()=>{
  await db.query("update public.profiles set first_name='Clienta',last_name='Privada' where id=$1",[a]);const q=await issue();await rpc('record_whatsapp_job_issue',{p_id:q.id,p_token:t1,p_issue:diagnostic});await db.query("update public.whatsapp_message_queue set status='waiting',pause_reason='manual_review' where id=$1",[q.id]);
  await db.query("insert into public.whatsapp_links(user_id,wa_id,status) values($1,'synthetic-owner','active') on conflict(user_id) do update set wa_id='synthetic-owner',status='active'",[admin]);await rpc('configure_whatsapp_ops_alerts',{p_enabled:true});await db.exec("update public.whatsapp_ops_config set verified_test_sender_digits='15550000000'");await enqueue(message('owner-window','synthetic-owner','resumen'));await db.exec("update public.whatsapp_message_queue set status='processed' where wa_message_id='owner-window'");await rpc('refresh_whatsapp_ops_health');const notice=await rpc<{snapshot:Array<{code:string;details:Array<Record<string,unknown>>}>}>('claim_whatsapp_ops_notice',{p_token:t2});expect(notice.snapshot.find(a=>a.code==='manual_review')!.details[0].client_name).toBe('Clienta Privada');expect(JSON.stringify((await db.query('select snapshot from public.whatsapp_ops_notifications')).rows)).not.toContain('Clienta Privada');
 });
 it.each(['anon','authenticated','service_role'])('%s no accede directamente al detalle privado',async role=>{expect((await db.query("select has_function_privilege($1,'public.whatsapp_ops_issue_details(text,integer)','execute') as allowed",[role])).rows).toEqual([{allowed:false}]);expect((await db.query("select has_function_privilege($1,'public.enrich_whatsapp_ops_snapshot(jsonb)','execute') as allowed",[role])).rows).toEqual([{allowed:false}]);});
 it('un cliente no accede al panel enriquecido ni puede registrar errores',async()=>{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[a]);await expect(rpc('whatsapp_ops_dashboard')).rejects.toThrow('OPS_ADMIN_REQUIRED');expect((await db.query("select has_function_privilege('authenticated','public.record_whatsapp_job_issue(uuid,uuid,jsonb)','execute') as allowed")).rows).toEqual([{allowed:false}]);});
});


describe('diagnóstico de cola de mejor esfuerzo, sin repetir operaciones',()=>{
 function setup(issueRpcFails=false){let calls=0;const sent: string[]=[];const rpc=vi.fn(async(name:string)=>{sent.push(name);if(name==='claim_whatsapp_actor')return true;if(name==='next_whatsapp_job')return ++calls===1?{id:'synthetic-job',wa_id:'synthetic-actor',payload:{id:'synthetic-source',from:'synthetic-actor',type:'audio'},attempts:1,effect_applied:false,parsed_result:null,reply_text:null}:null;if(name==='record_whatsapp_job_issue'&&issueRpcFails)throw Error('PRIVATE_DIAGNOSTIC_ERROR');return null;});const deps:QueueDependencies={rpc:rpc as never,prepare:async()=>{throw new OperationalFailure('unavailable','groq',503)},send:async()=>{},format:()=>'',now:Date.now,sleep:async()=>{},token:()=>t1,metric:vi.fn()};return {rpc,deps,sent};}
 it('registra proveedor, etapa y código antes de conservar el reintento',async()=>{const {rpc,deps,sent}=setup();await runActor('synthetic-actor',deps);expect(rpc).toHaveBeenCalledWith('record_whatsapp_job_issue',expect.objectContaining({p_issue:{reason:'unavailable',provider:'groq',status:503,kind:'retry',stage:'interpret'}}),expect.any(AbortSignal));expect(sent.indexOf('record_whatsapp_job_issue')).toBeLessThan(sent.indexOf('fail_whatsapp_job'));expect(sent).not.toContain('apply_whatsapp_job');});
 it('un fallo de diagnóstico no impide conservar el trabajo ni filtra la excepción',async()=>{const log=vi.spyOn(console,'log').mockImplementation(()=>{});try{const {deps,sent}=setup(true);await expect(runActor('synthetic-actor',deps)).resolves.toBeUndefined();expect(sent).toContain('fail_whatsapp_job');expect(sent.at(-1)).toBe('release_whatsapp_actor');expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_');}finally{log.mockRestore();}});
});


describe('BE-05: aclaración sin mutaciones en SQL real',()=>{
  it.each([false,true])('preserva grupo, ítems, versión y resumen pendiente=%s incluso al reintentar',async pending=>{
    await add('be05-seed',[movement('Pendiente previo',123.45)]);
    await show();
    if(pending) await db.exec("update public.whatsapp_worker_state set summary_pending=true");
    await enqueue(message('be05-mixed','synthetic-a','Gasté 1000 en super; pasame el alias'));
    const current=(await next())!;
    const snapshot=async()=>({
      groups:(await db.query('select * from public.draft_groups order by id')).rows,
      items:(await db.query('select * from public.draft_items order by id')).rows,
      summary:(await db.query('select summary_pending,shown_group_id,shown_version from public.whatsapp_worker_state order by wa_id')).rows,
      transactions:(await db.query('select * from public.transactions order by id')).rows,
    });
    const before=await snapshot();
    const action={kind:'reply',text:'No agregué ni modifiqué movimientos. Mandá el movimiento y la consulta por separado.'};
    const applied=await apply(current,action);
    expect(applied.reply_text).toBe(action.text);
    expect(applied.effect_applied).toBe(true);
    expect(await snapshot()).toEqual(before);
    // Una respuesta perdida no puede convertir el reintento en una alta.
    expect((await apply(current,{kind:'add',items:[movement('No crear',1000)]})).reply_text).toBe(action.text);
    await finish(current);
    expect(await snapshot()).toEqual(before);
  });
});


describe('BE-07: confirmar requiere el resumen vigente',()=>{
  it.each([false,true])('RETOMAR no ejecuta una confirmación retenida; mensaje adicional=%s',async additional=>{
    await add('be07-old',[movement('Lista anterior',101)]);
    await show();
    await db.exec("update public.draft_groups set last_activity_at=clock_timestamp()-interval '25 hours'; update public.whatsapp_worker_state set shown_at=clock_timestamp()-interval '25 hours'");
    await enqueue(message('be07-held-confirm','synthetic-a','confirmar'));
    const held=(await next())!;
    const captured=(await db.query<{confirmation_group_id:string|null;confirmation_version:number|null}>('select confirmation_group_id,confirmation_version from public.whatsapp_message_queue where id=$1',[held.id])).rows[0];
    expect(captured.confirmation_group_id).not.toBeNull();
    await apply(held,{kind:'confirm'});await finish(held);
    expect((await db.query('select status,pause_reason from public.whatsapp_message_queue where id=$1',[held.id])).rows[0]).toEqual({status:'waiting',pause_reason:'stale'});
    if(additional) await enqueue(message('be07-new-expense','synthetic-a','Gasté 202 en nuevo gasto'));
    await enqueue(message('be07-resume','synthetic-a','retomar'));
    const resume=(await next())!;expect(resume.payload.id).toBe('be07-resume');
    await apply(resume,{kind:'resume'});await finish(resume);
    const replayed=(await next())!;expect(replayed.payload.id).toBe('be07-held-confirm');
    const rejected=await apply(replayed,{kind:'confirm'});await finish(replayed);
    expect(rejected.reply_text).toContain('nuevamente');
    expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0].n).toBe(0);
    expect((await db.query<{status:string}>('select status from public.draft_groups')).rows[0].status).toBe('open');
    if(additional){
      const newExpense=(await next())!;expect(newExpense.payload.id).toBe('be07-new-expense');
      await apply(newExpense,{kind:'add',items:[movement('Nuevo gasto',202)]});await finish(newExpense);
    }
    await show();
    await enqueue(message('be07-fresh-confirm','synthetic-a','confirmar'));
    const fresh=(await next())!;const saved=await apply(fresh,{kind:'confirm'});await finish(fresh);
    expect(saved.reply_text).toContain('Se guardaron');
    expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0].n).toBe(additional?2:1);
    expect((await db.query<{n:number}>("select count(*)::int as n from public.draft_items i join public.draft_groups g on g.id=i.group_id where g.status<>'open' and i.status='pending'")).rows[0].n).toBe(0);
  });
});


describe('BE-07: guardas actuales y regresiones de revisión',()=>{
  it.each([
    "summary_pending=true",
    "shown_version=null",
    "shown_group_id=null",
  ])('rechaza una autorización cuya revisión fue revocada: %s',async change=>{
    await add('be07-revoked');await show();
    await enqueue(message('be07-revoked-confirm','synthetic-a','confirmar'));
    const confirm=(await next())!;
    await db.exec('update public.whatsapp_worker_state set '+change);
    const result=await apply(confirm,{kind:'confirm'});await finish(confirm);
    expect(result.reply_text).toContain('nuevamente');
    expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0].n).toBe(0);
    await show();
    await enqueue(message('be07-confirm-after-review','synthetic-a','confirmar'));
    const reviewed=(await next())!;await apply(reviewed,{kind:'confirm'});await finish(reviewed);
    expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0].n).toBe(1);
  });
  it('una respuesta de resumen tardía no habilita la versión anterior tras agregar',async()=>{
    await add('be07-snapshot-one');
    await db.exec("update public.whatsapp_worker_state set last_received_at=clock_timestamp()-interval '4 seconds'");
    const snapshot=await rpc<{group_id:string;version:number}>('whatsapp_summary_snapshot',{p_wa_id:'synthetic-a',p_token:t1});
    await enqueue(message('be07-snapshot-two'));
    await rpc('mark_whatsapp_summary_sent',{p_wa_id:'synthetic-a',p_token:t1,p_group_id:snapshot.group_id,p_version:snapshot.version});
    expect((await db.query('select summary_pending,shown_version from public.whatsapp_worker_state')).rows[0]).toEqual({summary_pending:true,shown_version:null});
    const queued=(await next())!;await apply(queued,{kind:'add',items:[movement('Segundo',202)]});await finish(queued);
    await rpc('mark_whatsapp_summary_sent',{p_wa_id:'synthetic-a',p_token:t1,p_group_id:snapshot.group_id,p_version:snapshot.version});
    expect((await db.query('select summary_pending,shown_version from public.whatsapp_worker_state')).rows[0]).toEqual({summary_pending:true,shown_version:null});
    await enqueue(message('be07-confirm-before-new-summary','synthetic-a','confirmar'));
    const early=(await next())!;expect((await apply(early,{kind:'confirm'})).reply_text).toContain('nuevamente');await finish(early);
    expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0].n).toBe(0);
    await show();await enqueue(message('be07-confirm-new-summary','synthetic-a','confirmar'));
    const reviewed=(await next())!;await apply(reviewed,{kind:'confirm'});await finish(reviewed);
    expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0].n).toBe(2);
  });
  it.each([false,true])('un payload con movimiento y confirmación respeta el orden; confirmar primero=%s',async confirmFirst=>{
    await add('be07-batch-seed',[movement('Ya revisado',101)]);await show();
    const command=message('be07-batch-confirm','synthetic-a','confirmar'),extra=message('be07-batch-extra');
    await enqueue(...(confirmFirst?[command,extra]:[extra,command]));
    for(let i=0;i<2;i++){
      const current=(await next())!;
      await apply(current,current.payload.id===command.id?{kind:'confirm'}:{kind:'add',items:[movement('No revisado',202)]});await finish(current);
    }
    expect((await db.query('select description from public.transactions order by description')).rows).toEqual(confirmFirst?[{description:'Ya revisado'}]:[]);
    expect((await db.query("select i.description from public.draft_items i join public.draft_groups g on g.id=i.group_id where g.status='open' and i.status='pending' order by i.position")).rows).toEqual(confirmFirst?[{description:'No revisado'}]:[{description:'Ya revisado'},{description:'No revisado'}]);
  });
  it.each(['confirm','cancel'])('un grupo cerrado con %s rechaza nuevos ítems pendientes',async kind=>{
    await add('be07-closed');const shown=await show();await enqueue(message('be07-close','synthetic-a',kind==='confirm'?'confirmar':'cancelar'));
    const close=(await next())!;await apply(close,{kind});await finish(close);
    const count=(await db.query<{n:number}>('select count(*)::int as n from public.draft_items')).rows[0].n;
    await db.exec('savepoint be07_closed_insert');
    await expect(db.query("insert into public.draft_items(group_id,user_id,position,description,amount) values($1,$2,99,'No insertar',999)",[shown.group_id,a])).rejects.toThrow('QUEUE_GROUP_CLOSED');
    await db.exec('rollback to savepoint be07_closed_insert; release savepoint be07_closed_insert');
    expect((await db.query<{n:number}>('select count(*)::int as n from public.draft_items')).rows[0].n).toBe(count);
    expect((await db.query<{n:number}>("select count(*)::int as n from public.draft_items i join public.draft_groups g on g.id=i.group_id where g.status<>'open' and i.status='pending'")).rows[0].n).toBe(0);
  });
  it('033 conserva propietario/ACL/atributos, no reescribe datos y es idempotente',async()=>{
    await add('be07-migration');await show();
    const data=async()=>({queue:(await db.query('select * from public.whatsapp_message_queue order by id')).rows,groups:(await db.query('select * from public.draft_groups order by id')).rows,items:(await db.query('select * from public.draft_items order by id')).rows,state:(await db.query('select * from public.whatsapp_worker_state order by wa_id')).rows});
    const before=await data(),properties=(await db.query(applyPropertiesSql)).rows;
    expect(properties).toEqual(applyPropertiesBefore);
    const definition=(await db.query<{body:string}>("select pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure) as body")).rows[0].body;
    const migration=(await readFile(new URL('033_require_current_review_for_confirmation.sql',migrationUrl),'utf8')).replace(/^begin;$/m,'').replace(/^commit;$/m,'');
    await db.exec(migration);
    expect((await db.query<{body:string}>("select pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure) as body")).rows[0].body).toBe(definition);
    expect((await db.query(applyPropertiesSql)).rows).toEqual(properties);
    expect(await data()).toEqual(before);
    for(const role of ['anon','authenticated']) expect((await db.query<{allowed:boolean}>("select has_function_privilege($1,'public.apply_whatsapp_job(uuid,uuid,jsonb)','execute') as allowed",[role])).rows[0].allowed).toBe(false);
  });
  it('033 rechaza un cuerpo SQL inesperado en lugar de sobrescribirlo',async()=>{
    const definition=(await db.query<{body:string}>("select pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure) as body")).rows[0].body;
    const changed=definition.replace('and s.shown_group_id=g.id and s.shown_version=g.version','and s.shown_group_id=g.id and s.shown_version=g.version and false');
    expect(changed).not.toBe(definition);await db.exec(changed);
    const migration=(await readFile(new URL('033_require_current_review_for_confirmation.sql',migrationUrl),'utf8')).replace(/^begin;$/m,'').replace(/^commit;$/m,'');
    await expect(db.exec(migration)).rejects.toThrow('BE07_APPLY_DEFINITION_UNEXPECTED');
  });
});


describe('BE-08: completos, faltantes y completado atómico',()=>{
 it('conserva todas las operaciones, fecha desconocida, dudas y confianza cero',async()=>{
  await add('be08-mixed',[movement('Completo',101),{...movement('Nafta'),totalAmountArs:null,occurredOn:null,missingFields:['amount','date'],confidence:0,clarification:'Indicar importe y fecha'}]);
  const rows=(await db.query<{amount:string|null;occurred_on:string|null;confidence:string;missing_fields:string[];clarification:string}>('select amount::text,occurred_on::text,confidence::text,missing_fields,clarification from public.draft_items order by position')).rows;
  expect(rows).toHaveLength(2);expect(rows[1]).toMatchObject({amount:null,occurred_on:null,confidence:'0.000',missing_fields:['amount','date'],clarification:'Indicar importe y fecha'});
  await show();await enqueue(message('be08-blocked-confirm','synthetic-a','confirmar'));const q=(await next())!;const result=await apply(q,{kind:'confirm'});await finish(q);
  expect(result.reply_text).toContain('datos faltantes');expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0].n).toBe(0);
 });
 it('completa un campo por vez, rechaza versión vieja y guarda todo solo tras nuevo resumen',async()=>{
  await add('be08-fill',[{...movement('Ingreso',20.5),kind:'income',currency:'USD'},{...movement('Concepto pendiente'),totalAmountArs:null,occurredOn:null,missingFields:['amount','date','description'],installments:3,firstInstallmentMonth:null,confidence:0}]);
  const snapshot=async()=> (await rpc<{group_id:string;version:number;items:unknown[]}>('get_active_draft_group',{p_user_id:a}));
  const original=await snapshot();
  const complete=async(id:string,version:number,patch:unknown)=>{await enqueue(message(id));const q=(await next())!;const result=await apply(q,{kind:'complete',position:2,group_id:original.group_id,version,patch});await finish(q);return result;};
  await complete('be08-amount',original.version,{amount:100.01});
  expect((await db.query('select amount::text,missing_fields from public.draft_items where position=2')).rows[0]).toEqual({amount:'100.01',missing_fields:['date','description']});
  await complete('be08-stale',original.version,{occurred_on:'2026-10-26'});
  expect((await db.query('select occurred_on from public.draft_items where position=2')).rows[0]).toEqual({occurred_on:null});
  await complete('be08-date',(await snapshot()).version,{occurred_on:'2026-10-26'});
  await complete('be08-description',(await snapshot()).version,{description:'Farmacia'});
  expect((await db.query('select description,first_installment_month,missing_fields,confidence::text from public.draft_items where position=2')).rows[0]).toEqual({description:'Farmacia',first_installment_month:'2026-10',missing_fields:[],confidence:'0.000'});
  await show();await enqueue(message('be08-save','synthetic-a','confirmar'));const q=(await next())!;await apply(q,{kind:'confirm'});await apply(q,{kind:'confirm'});await finish(q);
  const saved=(await db.query<{currency:string;amount:string}>('select currency,sum(amount_ars)::text as amount from public.transactions group by currency order by currency')).rows;
  expect(saved).toEqual([{currency:'ARS',amount:'100.01'},{currency:'USD',amount:'20.50'}]);
  expect((await db.query<{n:number}>('select count(*)::int as n from public.transactions')).rows[0].n).toBe(4);
 });
 it('quitar el incompleto permite confirmar los completos sin renumerar',async()=>{
  await add('be08-remove',[movement('Completo',101),{...movement('Incompleto'),totalAmountArs:null,missingFields:['amount']}]);
  await enqueue(message('be08-remove-item'));const remove=(await next())!;await apply(remove,{kind:'remove',position:2});await finish(remove);
  await show();await enqueue(message('be08-confirm-after-remove','synthetic-a','confirmar'));const q=(await next())!;await apply(q,{kind:'confirm'});await finish(q);
  expect((await db.query('select position,status from public.draft_items order by position')).rows).toEqual([{position:1,status:'confirmed'},{position:2,status:'removed'}]);
  expect((await db.query('select description from public.transactions')).rows).toEqual([{description:'Completo'}]);
 });
 it('no permite ocultar un importe nulo ni confirmar un ítem incompleto directamente',async()=>{
  await add('be08-null',[{...movement('Sin monto'),totalAmountArs:null,missingFields:[]}]);
  expect((await db.query('select missing_fields from public.draft_items')).rows[0]).toEqual({missing_fields:['amount']});
  await db.exec('savepoint be08_invalid');await expect(db.exec("update public.draft_items set missing_fields='{}',status='confirmed'")).rejects.toThrow('DRAFT_INCOMPLETE');await db.exec('rollback to savepoint be08_invalid;release savepoint be08_invalid');
 });
 it('una operación inválida revierte la inserción de todo el mensaje',async()=>{
  await add('be08-existing');await enqueue(message('be08-invalid'));const q=(await next())!;
  await expect(apply(q,{kind:'add',items:[movement('No parcial'),{...movement('Inválido'),totalAmountArs:null,missingFields:['unexpected']}]})).rejects.toThrow('DRAFT_INVALID_MISSING_FIELDS');
  expect((await db.query('select description from public.draft_items')).rows).toEqual([{description:'Supermercado'}]);
 });
});

describe('BE-08: dudas, aislamiento y capacidad',()=>{
 it('una reformulación explícita resuelve la duda de un solo ítem',async()=>{
  await add('be08-review',[movement('Otro',101),{...movement('Duda',202),missingFields:['review'],clarification:'Aclarar detalle',confidence:0}]);
  const g=await rpc<{group_id:string;version:number}>('get_active_draft_group',{p_user_id:a});
  await enqueue(message('be08-review-replacement'));const q=(await next())!;
  await apply(q,{kind:'complete',position:2,group_id:g.group_id,version:g.version,patch:{movement:{...movement('Trabajo',80),kind:'income',currency:'USD',confidence:0}}});await finish(q);
  expect((await db.query('select position,description,kind,currency,missing_fields,clarification,confidence::text from public.draft_items order by position')).rows).toEqual([{position:1,description:'Otro',kind:'expense',currency:'ARS',missing_fields:[],clarification:null,confidence:'1.000'},{position:2,description:'Trabajo',kind:'income',currency:'USD',missing_fields:[],clarification:null,confidence:'0.000'}]);
 });
 it('las dudas sin faltantes explícitos también bloquean la confirmación',async()=>{
  await add('be08-question',[{...movement('Duda',101),clarification:'Revisar la operación'}]);
  expect((await db.query('select missing_fields,clarification from public.draft_items')).rows[0]).toEqual({missing_fields:['review'],clarification:'Revisar la operación'});
  await show();await enqueue(message('be08-question-confirm','synthetic-a','confirmar'));const q=(await next())!;expect((await apply(q,{kind:'confirm'})).reply_text).toContain('datos faltantes');
 });
 it('no completa el grupo de otra cuenta ni expone la auxiliar como RPC',async()=>{
  await add('be08-own',[{...movement('Propio'),totalAmountArs:null,missingFields:['amount']}]);
  await enqueue(message('be08-other','synthetic-b'));await claim('synthetic-b',t2);const other=(await next('synthetic-b',t2))!;await apply(other,{kind:'add',items:[movement('Ajeno')]},t2);await finish(other,t2);
  const otherGroup=await rpc<{group_id:string;version:number}>('get_active_draft_group',{p_user_id:b});
  await enqueue(message('be08-cross'));const q=(await next())!;await apply(q,{kind:'complete',position:1,group_id:otherGroup.group_id,version:otherGroup.version,patch:{amount:5000}});await finish(q);
  expect((await db.query('select description,amount::text from public.draft_items order by description')).rows).toEqual([{description:'Ajeno',amount:'100.00'},{description:'Propio',amount:null}]);
  for(const role of ['anon','authenticated','service_role']) expect((await db.query<{allowed:boolean}>("select has_function_privilege($1,'public.complete_pending_draft_item(uuid,uuid,integer,integer,jsonb)','execute') as allowed",[role])).rows[0].allowed).toBe(false);
 });
 it('completar no reintenta capacidad; una respuesta numérica pasa y quitar libera el mensaje',async()=>{
  await add('be08-full',Array.from({length:20},(_,i)=>i===0?{...movement('Sin importe'),totalAmountArs:null,missingFields:['amount']}:movement('Otro '+i)));
  const group=await rpc<{group_id:string;version:number}>('get_active_draft_group',{p_user_id:a});
  await enqueue(message('be08-capacity'));const blocked=(await next())!;await apply(blocked,{kind:'add',items:[movement('Retenido')]});await finish(blocked);
  await enqueue(message('be08-number','synthetic-a','5000'));const number=(await next())!;expect(number.payload.id).toBe('be08-number');
  await apply(number,{kind:'complete',position:1,group_id:group.group_id,version:group.version,patch:{amount:5000}});await finish(number);
  expect((await db.query('select status,pause_reason,attempts from public.whatsapp_message_queue where id=$1',[blocked.id])).rows[0]).toEqual({status:'waiting',pause_reason:'capacity',attempts:1});
  await enqueue(message('be08-free','synthetic-a','quitá el 2'));const remove=(await next())!;await apply(remove,{kind:'remove',position:2});await finish(remove);
  const resumed=(await next())!;expect(resumed.payload.id).toBe('be08-capacity');await apply(resumed,{kind:'add',items:[movement('Retenido')]});await finish(resumed);
  expect((await db.query('select position from public.draft_items where description=$1',['Retenido'])).rows[0]).toEqual({position:21});
 });
});


type QuotaReply={allowed:boolean;reason?:string;used?:number;limit?:number;day?:string};
const quota=(job:Job,lane='qwen',token=t1)=>rpc<QuotaReply>('reserve_whatsapp_ai_quota',{p_id:job.id,p_token:token,p_attempt:job.attempts,p_lane:lane});
async function quotaJob(id:string,wa='synthetic-a',token=t1){await enqueue(message(id,wa));await claim(wa,token);return(await next(wa,token))!;}
describe('INF-15: cupo durable compartido y autorización',()=>{
 it('reserva antes de usar y rechaza repetir el mismo intento',async()=>{
  const q=await quotaJob('quota-once');expect(await quota(q)).toMatchObject({allowed:true,used:1,limit:100});expect(await quota(q)).toMatchObject({allowed:false,reason:'already_reserved'});
  expect((await db.query('select reserved from public.ai_quota_days')).rows).toEqual([{reserved:1}]);
 });
 it('comparte exactamente 100 consultas entre dos clientes, sin conceder la 101',async()=>{
  const qa=await quotaJob('quota-a'),qb=await quotaJob('quota-b','synthetic-b',t2);
  for(let i=1;i<=50;i++){await db.query('update public.whatsapp_message_queue set attempts=$1 where id in ($2,$3)',[i,qa.id,qb.id]);qa.attempts=i;qb.attempts=i;expect((await quota(qa)).allowed).toBe(true);expect((await quota(qb,'qwen',t2)).allowed).toBe(true);}
  await db.exec('update public.whatsapp_message_queue set attempts=51');qa.attempts=51;expect(await quota(qa)).toMatchObject({allowed:false,reason:'exhausted',used:100,limit:100});
  expect((await db.query<{n:number}>('select count(*)::int as n from public.ai_quota_reservations')).rows[0].n).toBe(100);
 });
 it('Whisper tiene 200 unidades propias y no consume Qwen',async()=>{
  const q=await quotaJob('quota-audio');expect(await quota(q,'whisper')).toMatchObject({allowed:true,limit:200,used:1});expect(await quota(q)).toMatchObject({allowed:true,limit:100,used:1});
  await db.exec("update public.ai_quota_days set reserved=199 where lane='whisper';update public.whatsapp_message_queue set attempts=2");q.attempts=2;expect(await quota(q,'whisper')).toMatchObject({allowed:true,used:200});
  await db.exec('update public.whatsapp_message_queue set attempts=3');q.attempts=3;expect(await quota(q,'whisper')).toMatchObject({allowed:false,reason:'exhausted',used:200});expect(await quota(q)).toMatchObject({allowed:true,used:2});
 });
 it('otro día no bloquea hoy y el reinicio es medianoche de Argentina',async()=>{
  await db.exec("insert into public.ai_quota_days(day,lane,reserved)values((clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date-1,'qwen',100)");
  const q=await quotaJob('quota-new-day');expect((await quota(q)).used).toBe(1);
  const snap=await rpc<{day:string;resets_at:string;lanes:Array<{used:number;limit:number;level:string}>}>('whatsapp_ai_quota_dashboard');expect(snap.lanes[0]).toMatchObject({used:1,limit:100,level:'ok'});
  expect((await db.query<{t:string}>("select to_char($1::timestamptz at time zone 'America/Argentina/Buenos_Aires','HH24:MI:SS') as t",[snap.resets_at])).rows[0].t).toBe('00:00:00');
 });
 it('el panel marca 75%, 90% y agotado a partir de las reservas',async()=>{
  const q=await quotaJob('quota-levels');await quota(q);
  for(const [used,level]of [[74,'ok'],[75,'warning'],[89,'warning'],[90,'critical'],[100,'exhausted']] as const){await db.query("update public.ai_quota_days set reserved=$1 where lane='qwen'",[used]);const snap=await rpc<{lanes:Array<{lane:string;level:string}>}>('whatsapp_ai_quota_dashboard');expect(snap.lanes.find(r=>r.lane==='qwen')?.level).toBe(level);}
 });
 it('Gemini, proveedores desconocidos y una política pausada no conceden permiso',async()=>{
  const q=await quotaJob('quota-disabled');for(const lane of ['gemini','unknown'])expect(await quota(q,lane)).toMatchObject({allowed:false,reason:'provider_disabled'});
  await db.exec("update public.ai_quota_policy set enabled=false where lane='qwen'");expect(await quota(q)).toMatchObject({allowed:false,reason:'provider_disabled'});expect((await db.query<{n:number}>('select count(*)::int n from public.ai_quota_reservations')).rows[0].n).toBe(0);
 });
 it('rechaza lease ajeno, intento adulterado y un trabajo ya aplicado',async()=>{
  const q=await quotaJob('quota-fence');await expect(quota(q,'qwen',t2)).rejects.toThrow('QUEUE_LEASE_LOST');await expect(quota({...q,attempts:99})).rejects.toThrow('AI_QUOTA_JOB_UNAVAILABLE');
  await apply(q,{kind:'reply',text:null});await expect(quota(q)).rejects.toThrow('AI_QUOTA_JOB_UNAVAILABLE');expect((await db.query<{n:number}>('select count(*)::int n from public.ai_quota_reservations')).rows[0].n).toBe(0);
 });
 it('una suspensión posterior impide consumir',async()=>{
  const q=await quotaJob('quota-suspended');await db.query("update public.profiles set subscription_status='suspended' where id=$1",[a]);await expect(quota(q)).rejects.toThrow('AI_QUOTA_ACCOUNT_UNAVAILABLE');expect((await db.query<{n:number}>('select count(*)::int n from public.ai_quota_reservations')).rows[0].n).toBe(0);
 });
 it('un fallo entre reserva y contador no deja consumo parcial',async()=>{
  const q=await quotaJob('quota-atomic');await db.exec("create function public.quota_fail_fixture()returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_QUOTA_FAILURE';end$$;create trigger quota_fail_fixture before update on public.ai_quota_days for each row execute function public.quota_fail_fixture();");
  await expect(quota(q)).rejects.toThrow('SYNTHETIC_QUOTA_FAILURE');expect((await db.query<{n:number}>('select count(*)::int n from public.ai_quota_reservations')).rows[0].n).toBe(0);expect((await db.query<{n:number}>('select coalesce(sum(reserved),0)::int n from public.ai_quota_days')).rows[0].n).toBe(0);
 });
 it('clientes y backend no pueden escribir tablas ni leer el panel como cliente',async()=>{
  const priv=(await db.query("select has_table_privilege('authenticated','public.ai_quota_days','SELECT') as client_read,has_table_privilege('service_role','public.ai_quota_days','UPDATE') as backend_write,has_function_privilege('anon','public.whatsapp_ai_quota_dashboard()','execute') as anon_dashboard,has_function_privilege('authenticated','public.reserve_whatsapp_ai_quota(uuid,uuid,integer,text)','execute') as client_reserve")).rows[0];expect(priv).toEqual({client_read:false,backend_write:false,anon_dashboard:false,client_reserve:false});
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[a]);await expect(rpc('whatsapp_ai_quota_dashboard')).rejects.toThrow('AI_QUOTA_ADMIN_REQUIRED');
 });
});
it('INF-15: el smoke SQL del ensayo se ejecuta contra el esquema completo aislado',async()=>{
 const release=await readFile(new URL('../scripts/rehearse-release.mjs',import.meta.url),'utf8');
 const sql=release.match(/async function smokeQuotaSql\(id\)[\s\S]*?await sql\(`begin;([\s\S]*?)rollback;`\);/)?.[1];
 expect(sql).toBeDefined();await db.exec(sql!.replaceAll('${id}',a));
 expect((await db.query<{reserved:number}>("select reserved from public.ai_quota_days where lane='qwen'")).rows[0].reserved).toBe(1);
});

// INF-14: limpieza real de 027, solo en esta base efímera con fixtures propias.
describe('INF-14: retención 30/90 y preservación de recuperación',()=>{
 const preview=async()=>(await db.query<Record<string,unknown>>(await readFile(new URL('../ops/sql/whatsapp-retention-preview.sql',import.meta.url),'utf8'))).rows[0];
 async function completed(id:string,age='31 days',type='text'){
  await enqueue({...message(id),type,...(type==='audio'?{audio:{id:'PRIVATE_AUDIO'}}:type==='image'?{image:{id:'PRIVATE_IMAGE'}}:{})});
  await db.query("update public.whatsapp_message_queue set status='processed',effect_applied=true,processed_at=clock_timestamp()-$1::interval,parsed_result='{\"private\":\"PRIVATE_PARSED\"}',reply_text='PRIVATE_REPLY',error_message='PRIVATE_ERROR' where wa_message_id=$2",[age,id]);
  return(await db.query<{id:string}>('select id from public.whatsapp_message_queue where wa_message_id=$1',[id])).rows[0].id;
 }
 async function metrics(age:string){await db.query("insert into public.whatsapp_ops_metrics(bucket,event,samples,duration_total_ms,duration_max_ms,operations_total,attempts_total)values(clock_timestamp()-$1::interval,'queue_worker',1,1,1,0,1)",[age]);}
 async function notice(state:string,age:string){const result=await db.query<{id:string}>("insert into public.whatsapp_ops_notifications(recipient_user_id,snapshot,state,finished_at)values($1,'[]',$2,clock_timestamp()-$3::interval) returning id",[admin,state,age]);return result.rows[0].id;}
 it('apagada no redacta contenido ni elimina métricas/avisos ni modifica la fecha de limpieza',async()=>{
  await completed('retention-disabled');await metrics('91 days');await notice('sent','91 days');
  const before=(await db.query('select to_jsonb(c) as config from public.whatsapp_ops_config c')).rows;
  expect(Number((await preview()).messages_eligible)).toBe(1);expect(await rpc('prune_whatsapp_ops_content')).toBe(0);
  expect((await db.query('select content_redacted_at from public.whatsapp_message_queue')).rows).toEqual([{content_redacted_at:null}]);
  expect((await db.query<{n:number}>('select count(*)::int n from public.whatsapp_ops_metrics')).rows[0].n).toBe(1);
  expect((await db.query<{n:number}>('select count(*)::int n from public.whatsapp_ops_notifications')).rows[0].n).toBe(1);
  expect((await db.query('select to_jsonb(c) as config from public.whatsapp_ops_config c')).rows).toEqual(before);
 });
 it('el corte se basa en procesamiento, no en recepción, y respeta los 30 días',async()=>{
  await completed('older','30 days 1 minute');await completed('recent','29 days 23 hours 59 minutes');
  await completed('recent-processing','1 day');await db.exec("update public.whatsapp_message_queue set received_at=clock_timestamp()-interval '60 days' where wa_message_id='recent-processing'");
  await completed('missing-processing');await db.exec("update public.whatsapp_message_queue set processed_at=null where wa_message_id='missing-processing'");
  expect(Number((await preview()).messages_eligible)).toBe(1);await db.exec('update public.whatsapp_ops_config set retention_enabled=true');expect(await rpc('prune_whatsapp_ops_content')).toBe(1);
  expect((await db.query<{wa_message_id:string}>("select wa_message_id from public.whatsapp_message_queue where content_redacted_at is not null")).rows).toEqual([{wa_message_id:'older'}]);
 });
 it('cada lote redacta 500 como máximo y repetir la limpieza es idempotente',async()=>{
  await db.query("insert into public.whatsapp_message_queue(wa_message_id,wa_id,user_id,payload,queue_version,status,effect_applied,processed_at)select 'batch-'||i,'synthetic-a',$1,jsonb_build_object('id','batch-'||i,'type','text','text','PRIVATE_CONTENT'),2,'processed',true,clock_timestamp()-interval '31 days'-make_interval(secs=>i) from generate_series(1,601)i",[a]);
  const forecast=await preview();expect(Number(forecast.messages_eligible)).toBe(601);expect(Number(forecast.messages_next_batch)).toBe(500);
  await db.exec('update public.whatsapp_ops_config set retention_enabled=true');expect(await rpc('prune_whatsapp_ops_content')).toBe(500);expect(Number((await preview()).messages_eligible)).toBe(101);
  expect(await rpc('prune_whatsapp_ops_content')).toBe(101);expect(await rpc('prune_whatsapp_ops_content')).toBe(0);expect(Number((await preview()).messages_eligible)).toBe(0);
 });
 it.each(['pending','processing','failed','waiting'])('conserva íntegro el trabajo %s aunque tenga fechas antiguas',async status=>{
  await completed('unfinished');await db.query("update public.whatsapp_message_queue set status=$1,pause_reason='manual_review'",[status]);
  const before=(await db.query('select to_jsonb(q) as value from public.whatsapp_message_queue q')).rows;
  await db.exec('update public.whatsapp_ops_config set retention_enabled=true');expect(await rpc('prune_whatsapp_ops_content')).toBe(0);expect(Number((await preview()).unfinished_preserved)).toBe(1);
  expect((await db.query('select to_jsonb(q) as value from public.whatsapp_message_queue q')).rows).toEqual(before);
 });
 it('protege un ítem pendiente aun en grupo cerrado y una lista abierta aun con ítem quitado',async()=>{
  await add('closed-with-pending');await db.exec("update public.draft_groups set status='discarded';update public.whatsapp_message_queue set processed_at=clock_timestamp()-interval '31 days'");
  await add('open-with-removed');await db.exec("update public.draft_items set status='removed' where wa_message_id='open-with-removed';update public.whatsapp_message_queue set processed_at=clock_timestamp()-interval '31 days'");
  const before=(await db.query('select to_jsonb(d) as value from public.draft_items d order by id')).rows;
  expect(Number((await preview()).protected_by_draft)).toBe(2);await db.exec('update public.whatsapp_ops_config set retention_enabled=true');expect(await rpc('prune_whatsapp_ops_content')).toBe(0);
  expect((await db.query('select to_jsonb(d) as value from public.draft_items d order by id')).rows).toEqual(before);
 });
 it.each(['original','original:2'])('protege transacciones pendientes vinculadas por %s',async source=>{
  await completed('original');await db.query("insert into public.transactions(user_id,kind,description,amount_ars,occurred_on,status,source,wa_message_id)values($1,'expense','Solo fixture',123,current_date,'pending','text',$2)",[a,source]);
  const financial=(await db.query('select to_jsonb(t) as value from public.transactions t')).rows;
  expect(Number((await preview()).protected_by_transaction)).toBe(1);await db.exec('update public.whatsapp_ops_config set retention_enabled=true');expect(await rpc('prune_whatsapp_ops_content')).toBe(0);
  expect((await db.query('select to_jsonb(t) as value from public.transactions t')).rows).toEqual(financial);
 });
 it('un prefijo parecido o pendiente de otra cuenta no protege un mensaje ajeno',async()=>{
  await completed('prefix');await db.query("insert into public.transactions(user_id,kind,description,amount_ars,occurred_on,status,source,wa_message_id)values($1,'expense','Otra cuenta',123,current_date,'pending','text','prefix:2'),($2,'expense','Otro prefijo',123,current_date,'pending','text','prefix-other')",[b,a]);
  expect(Number((await preview()).protected_by_transaction)).toBe(0);await db.exec('update public.whatsapp_ops_config set retention_enabled=true');expect(await rpc('prune_whatsapp_ops_content')).toBe(1);
  expect((await db.query<{n:number}>('select count(*)::int n from public.transactions')).rows[0].n).toBe(2);
 });
 it.each(['audio','image'])('redacta el contenido %s y conserva identidad, tipo, diagnóstico y deduplicación',async type=>{
  const id=await completed('private-media','31 days',type);await db.query("update public.whatsapp_message_queue set ops_issue='{\"kind\":\"clarification\",\"reason\":\"rate_limit\",\"provider\":\"groq\",\"stage\":\"interpret\"}',ops_issue_at=clock_timestamp()-interval '31 days' where id=$1",[id]);
  await db.exec('update public.whatsapp_ops_config set retention_enabled=true');expect(await rpc('prune_whatsapp_ops_content')).toBe(1);
  const row=(await db.query<{payload:unknown;parsed_result:null;reply_text:null;error_message:null;ops_issue:unknown}>('select payload,parsed_result,reply_text,error_message,ops_issue from public.whatsapp_message_queue where id=$1',[id])).rows[0];
  expect(row).toEqual({payload:{id:'private-media',from:'synthetic-a',type,redacted:true},parsed_result:null,reply_text:null,error_message:null,ops_issue:{kind:'clarification',reason:'rate_limit',provider:'groq',stage:'interpret'}});
  await enqueue({...message('private-media'),type});expect((await db.query<{n:number}>('select count(*)::int n from public.whatsapp_message_queue')).rows[0].n).toBe(1);
  expect((await db.query<{n:number}>('select count(*)::int n from public.inbound_events')).rows[0].n).toBe(1);
 });
 it('conserva recibos y contadores de IA al redactar el trabajo procesado',async()=>{
  const q=await quotaJob('retention-ai');await quota(q,'qwen');await apply(q,{kind:'reply',text:null});await finish(q);
  await db.query("update public.whatsapp_message_queue set processed_at=clock_timestamp()-interval '31 days' where id=$1",[q.id]);
  const receipts=(await db.query('select to_jsonb(r) as value from public.ai_quota_reservations r')).rows,days=(await db.query('select to_jsonb(d) as value from public.ai_quota_days d')).rows;
  await db.exec('update public.whatsapp_ops_config set retention_enabled=true');expect(await rpc('prune_whatsapp_ops_content')).toBe(1);
  expect((await db.query('select to_jsonb(r) as value from public.ai_quota_reservations r')).rows).toEqual(receipts);expect((await db.query('select to_jsonb(d) as value from public.ai_quota_days d')).rows).toEqual(days);
  expect(Number((await preview()).quota_receipts_preserved)).toBe(1);
 });
 it('90 días: elimina solo métricas antiguas y avisos enviados/cancelados terminados',async()=>{
  await metrics('91 days');await metrics('89 days');
  for(const state of ['sent','cancelled','pending','sending','failed','uncertain','blocked'])await notice(state,'91 days');await notice('sent','89 days');await notice('cancelled','89 days');const noDate=await notice('sent','91 days');await db.query('update public.whatsapp_ops_notifications set finished_at=null where id=$1',[noDate]);
  const forecast=await preview();expect(Number(forecast.metrics_eligible)).toBe(1);expect(Number(forecast.notices_eligible)).toBe(2);
  await db.exec('update public.whatsapp_ops_config set retention_enabled=true');expect(await rpc('prune_whatsapp_ops_content')).toBe(0);
  expect((await db.query<{n:number}>('select count(*)::int n from public.whatsapp_ops_metrics')).rows[0].n).toBe(1);
  expect((await db.query<{n:number}>('select count(*)::int n from public.whatsapp_ops_notifications')).rows[0].n).toBe(8);
 });
 it('un fallo de borrado de métricas revierte también redacción y fecha de limpieza',async()=>{
  await completed('retention-atomic');await metrics('91 days');await db.exec("update public.whatsapp_ops_config set retention_enabled=true;create function public.retention_fail_fixture()returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_RETENTION_FAILURE';end$$;create trigger retention_fail_fixture before delete on public.whatsapp_ops_metrics for each row execute function public.retention_fail_fixture();");
  await expect(rpc('prune_whatsapp_ops_content')).rejects.toThrow('SYNTHETIC_RETENTION_FAILURE');
  expect((await db.query('select content_redacted_at from public.whatsapp_message_queue')).rows).toEqual([{content_redacted_at:null}]);expect((await db.query('select last_retention_at from public.whatsapp_ops_config')).rows).toEqual([{last_retention_at:null}]);expect((await db.query<{n:number}>('select count(*)::int n from public.whatsapp_ops_metrics')).rows[0].n).toBe(1);
 });
 it('mantenimiento queda privado incluso para service_role y no reduce el mínimo de 30 días',async()=>{
  for(const role of ['anon','authenticated','service_role'])expect((await db.query<{allowed:boolean}>("select has_function_privilege($1,'public.prune_whatsapp_ops_content()','EXECUTE') as allowed",[role])).rows[0].allowed).toBe(false);
  await db.exec('savepoint invalid_retention');await expect(db.exec('update public.whatsapp_ops_config set retention_days=29')).rejects.toThrow();await db.exec('rollback to savepoint invalid_retention;release savepoint invalid_retention');
 });
});
it('INF-14: ejecuta el smoke de retención del ensayo sobre el esquema aislado',async()=>{
 const release=await readFile(new URL('../scripts/rehearse-release.mjs',import.meta.url),'utf8');
 const sql=release.match(/async function smokeRetentionSql\(id\)[\s\S]*?await sql\(`begin;([\s\S]*?)rollback;`\);/)?.[1];expect(sql).toBeDefined();
 await db.exec(sql!.replaceAll('${id}',a));expect((await db.query<{n:number}>('select count(*)::int n from public.transactions')).rows[0].n).toBe(0);
});
it('INF-14: la propuesta de activación exige aprobación técnica, fuente vigente y política 30',async()=>{
 const sql=(await readFile(new URL('../ops/sql/whatsapp-retention-enable.sql',import.meta.url),'utf8')).replace(/^begin;$/m,'').replace(/^commit;$/m,'');
 await db.exec('savepoint activation');await expect(db.exec(sql)).rejects.toThrow('INF14_OWNER_APPROVAL_REQUIRED');await db.exec('rollback to savepoint activation;release savepoint activation');
 expect((await db.query('select retention_enabled from public.whatsapp_ops_config')).rows[0]).toEqual({retention_enabled:false});
 await db.exec("select set_config('pesito.retention_approval','30d-content-90d-metrics-v1',true);update public.whatsapp_ops_config set retention_days=31;savepoint policy_changed");await expect(db.exec(sql)).rejects.toThrow('INF14_POLICY_CHANGED');await db.exec('rollback to savepoint policy_changed;release savepoint policy_changed;update public.whatsapp_ops_config set retention_days=30');
 await db.exec(sql);expect((await db.query('select retention_enabled,last_retention_at from public.whatsapp_ops_config')).rows[0]).toEqual({retention_enabled:true,last_retention_at:null});
 expect((await db.query<{n:number}>('select count(*)::int n from public.whatsapp_message_queue')).rows[0].n).toBe(0);
});
