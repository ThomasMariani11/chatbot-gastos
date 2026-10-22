import { createLogWriter } from '../supabase/functions/whatsapp-webhook/logging';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
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
async function add(id:string,items=[movement()]) {
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
