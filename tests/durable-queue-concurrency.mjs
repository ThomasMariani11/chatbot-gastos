// PostgreSQL nativo, aislado y descartable. Nunca acepta una URL de producción.
// PGHOST=127.0.0.1 PGDATABASE=inf03_queue_test PGPORT=<puerto local>
// PESITO_TEST_PSQL=<psql oficial>; autenticación en el entorno, no en argumentos.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';

assert.equal(process.env.PGHOST, '127.0.0.1', 'Este ensayo solo admite localhost');
assert.equal(process.env.PGDATABASE, 'inf03_queue_test', 'Se requiere una base descartable identificada');
assert.match(process.env.PGPORT ?? '', /^\d{4,5}$/);
assert.ok(process.env.PESITO_TEST_PSQL, 'Falta psql');

function execute(sql, allowError = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PESITO_TEST_PSQL, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { env: process.env, windowsHide: true });
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0 && !allowError) reject(new Error(`SQL sintético falló: ${error}`));
      else resolve({ code, output: output.trim(), error });
    });
    child.stdin.end(sql);
  });
}
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const a='50000000-0000-4000-8000-000000000001', admin='50000000-0000-4000-8000-000000000003';
const tokens=['51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000003'];
await execute(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema public,auth to anon,authenticated,service_role;
  insert into auth.users(id,email) values('${admin}','admin@example.invalid');`);
const migrations = new URL('../supabase/migrations/', import.meta.url);
for (const name of (await readdir(migrations)).filter(name => /^\d+.*\.sql$/.test(name) && name < '021').sort()) {
  if (name === '002_enable_realtime.sql') continue;
  await execute((await readFile(new URL(name, migrations), 'utf8')).replace(/^\uFEFF/, ''));
}
await execute(await readFile(new URL('023_idempotent_whatsapp_delivery.sql', migrations),'utf8'));
await execute(await readFile(new URL('024_private_bootstrap_warning.sql', migrations),'utf8'));
await execute(await readFile(new URL('025_cancel_stale_list_preserve_messages.sql', migrations),'utf8'));
await execute(await readFile(new URL('026_nonblocking_manual_review.sql', migrations),'utf8'));
await execute(`insert into public.invitation_codes(code,duration_days) values('NATIVE-QUEUE',30);
  insert into auth.users(id,email,raw_user_meta_data) values('${a}','a@example.invalid','{"invitation_code":"NATIVE-QUEUE"}');
  update public.whatsapp_links set wa_id='synthetic-native',status='active' where user_id='${a}';
  update public.whatsapp_queue_control set enabled=true;`);
const payload = id => JSON.stringify([{ id, from:'synthetic-native', type:'text', text:{body:'Mensaje sintético'}, timestamp:String(Math.floor(Date.now()/1000)) }]);
await execute(`select public.enqueue_whatsapp_messages(${quote(payload('native-first'))}::jsonb);`);

const started=Date.now();
const claims = await Promise.all(tokens.slice(0,2).map(token=>execute(`
  with claimed as materialized (select public.claim_whatsapp_actor('synthetic-native','${token}') as acquired)
  select jsonb_build_object('acquired',acquired,'hold',pg_sleep(case when acquired then 2 else 0 end)) from claimed;`)));
assert.equal(claims.filter(result=>JSON.parse(result.output).acquired).length,1,'Dos sesiones adquirieron el mismo lease');
const winner=tokens[claims.findIndex(result=>JSON.parse(result.output).acquired)];
const job=JSON.parse((await execute(`select public.next_whatsapp_job('synthetic-native','${winner}');`)).output);
await execute(`update public.whatsapp_worker_state set lease_until=clock_timestamp()-interval '1 second';
  update public.whatsapp_user_leases set lease_until=clock_timestamp()-interval '1 second';`);
assert.equal((await execute(`select public.claim_whatsapp_actor('synthetic-native','${tokens[2]}');`)).output,'t');
const action=JSON.stringify({kind:'add',items:[{kind:'expense',description:'Solo fixture',totalAmountArs:100,currency:'ARS',occurredOn:'2026-10-15',installments:1,confidence:1,missingFields:[]}]});
const stale=await execute(`select public.apply_whatsapp_job('${job.id}','${winner}',${quote(action)}::jsonb);`,true);
assert.notEqual(stale.code,0); assert.match(stale.error,/QUEUE_LEASE_LOST/);
const current=JSON.parse((await execute(`select public.next_whatsapp_job('synthetic-native','${tokens[2]}');`)).output);
await Promise.all([0,1].map(()=>execute(`select public.apply_whatsapp_job('${current.id}','${tokens[2]}',${quote(action)}::jsonb);`)));
assert.equal((await execute('select count(*) from public.draft_items;')).output,'1','Aplicación concurrente duplicada');
await execute(`select public.finish_whatsapp_job('${current.id}','${tokens[2]}');`);
await Promise.all(['native-a','native-b','native-a'].map(id=>execute(`select public.enqueue_whatsapp_messages(${quote(payload(id))}::jsonb);`)));
assert.equal((await execute('select count(*) from public.whatsapp_message_queue;')).output,'3','Recepción concurrente perdida o duplicada');
await Promise.all([execute(`select public.finish_whatsapp_job('${current.id}','${tokens[2]}');`),execute(`select public.fail_whatsapp_job('${current.id}','${tokens[2]}');`)]);
assert.equal((await execute(`select status from public.whatsapp_message_queue where id='${current.id}';`)).output,'processed','Una respuesta tardía reabrió la entrega');
const financialCountBeforeOps=(await execute('select count(*) from public.transactions;')).output;
// INF-14: transporte y agenda sintéticos; concurrencia en PostgreSQL real, sin HTTP.
await execute(`create schema cron;
 create table cron.job(jobname text,schedule text,command text,jobid bigint generated always as identity,active boolean default true);
 create table cron.job_run_details(jobid bigint,status text,start_time timestamptz default clock_timestamp(),end_time timestamptz);
 create function cron.schedule(text,text,text) returns bigint language plpgsql as $$ begin insert into cron.job(jobname,schedule,command) values($1,$2,$3);return 1;end $$;
 create function public.dispatch_whatsapp_queue_recovery() returns bigint language plpgsql as $$ begin if not (select enabled from public.whatsapp_queue_control where singleton) or not exists(select 1 from public.due_whatsapp_actors()) then return null;end if;return 200;end $$;
 insert into cron.job(jobname,schedule,command) values('pesito-whatsapp-queue-recovery','* * * * *','synthetic');
 insert into cron.job_run_details(jobid,status,end_time) select jobid,'succeeded',clock_timestamp() from cron.job;`);
await execute(await readFile(new URL('027_whatsapp_observability.sql',migrations),'utf8'));
await execute(await readFile(new URL('028_whatsapp_issue_details.sql',migrations),'utf8'));
await execute(`insert into public.whatsapp_links(user_id,wa_id,status) values('${admin}','synthetic-ops-admin','active') on conflict(user_id) do update set wa_id='synthetic-ops-admin',status='active';
 update public.whatsapp_ops_config set whatsapp_enabled=true,notification_user_id='${admin}',verified_test_sender_digits='15550000000';
 update public.whatsapp_message_queue set received_at=clock_timestamp()-interval '4 minutes';
 select public.enqueue_whatsapp_messages(jsonb_build_array(jsonb_build_object('id','ops-window','from','synthetic-ops-admin','type','text','text',jsonb_build_object('body','resumen'),'timestamp',floor(extract(epoch from clock_timestamp()))::text)));
 update public.whatsapp_message_queue set status='processed' where wa_message_id='ops-window';
 select public.refresh_whatsapp_ops_health();`);
const noticeClaims=await Promise.all(tokens.slice(0,2).map(token=>execute(`select public.claim_whatsapp_ops_notice('${token}') is not null;`)));
assert.equal(noticeClaims.filter(c=>c.output==='t').length,1,'Dos sesiones reclamaron el mismo aviso');
assert.equal((await execute("select count(*) from public.whatsapp_ops_notifications where state='sending' and attempts=1;")).output,'1');
await execute("update public.whatsapp_ops_notifications set lease_until=clock_timestamp()-interval '1 second';select public.refresh_whatsapp_ops_health();");
assert.equal((await execute(`select public.claim_whatsapp_ops_notice('${tokens[2]}') is null;`)).output,'t','Se repitió un aviso de resultado incierto');
assert.equal((await execute("select count(*) from public.transactions;")).output,financialCountBeforeOps,'El monitoreo modificó las finanzas');
// Se ejecuta dentro del ensayo PostgreSQL ya aislado y descartable.
await execute(await readFile(new URL('029_atomic_installment_plans.sql', migrations), 'utf8'));
const planCategory=(await execute(`select id from public.categories where user_id='${a}' and kind='expense' and active limit 1;`)).output;
assert.match(planCategory,/^[a-f0-9-]{36}$/);
const planPayload=quote(JSON.stringify({description:'Plan sintético nativo',category_id:planCategory,currency:'ARS',amount:100,amount_mode:'total',installment_count:3,reference_date:'2026-01-31',reference_number:1}));
const asClient=sql=>`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${a}',true);${sql};commit;`;
const planRequest='59000000-0000-4000-8000-000000000001';
// Dormir exclusivamente en el fixture hace que ambas sesiones disputen el mismo intento.
await execute(`create function public.slow_plan_fixture() returns trigger language plpgsql as $$begin if new.description='Plan sintético nativo' then perform pg_sleep(0.2);end if;return new;end$$;
 create trigger slow_plan_fixture before insert on public.transactions for each row execute function public.slow_plan_fixture();`);
const created=await Promise.all([0,1].map(()=>execute(asClient(`select public.mutate_installment_plan('${planRequest}','create',null,null,null,${planPayload}::jsonb,true)`))));
const decodePlan=result=>JSON.parse(result.output.split('\n').find(line=>line.startsWith('{')));
const nativePlan=decodePlan(created[0]);
assert.deepEqual(decodePlan(created[1]),nativePlan,'El reintento simultáneo devolvió otro plan');
assert.equal((await execute(`select count(*) from public.transactions where id='${nativePlan.group_id}' or installment_group_id='${nativePlan.group_id}';`)).output,'4','Alta simultánea duplicada');
await execute('drop trigger slow_plan_fixture on public.transactions;drop function public.slow_plan_fixture();');
const changeArgs=`'edit','${nativePlan.group_id}','${nativePlan.version}','${nativePlan.rows[0].id}'`;
const edits=await Promise.all([2,3].map(n=>execute(asClient(`select public.mutate_installment_plan('59000000-0000-4000-8000-${String(n).padStart(12,'0')}',${changeArgs},'{"description":"Versión ${n}"}',true)`),true)));
assert.equal(edits.filter(r=>r.code===0).length,1,'Dos versiones incompatibles se guardaron');
assert.match(edits.find(r=>r.code!==0).error,/El plan cambió/);
const afterRace=decodePlan(await execute(asClient(`select public.get_installment_plan('${nativePlan.group_id}')`)));
assert.deepEqual(afterRace.rows.map(r=>Number(r.amount_ars)),[33.33,33.33,33.34]);
// Un fallo después de iniciar escrituras no confirma ninguna cuota ni recibo.
await execute(`create function public.fail_plan_fixture() returns trigger language plpgsql as $$begin if new.description='Fallo nativo' and new.installment_number=2 then raise exception 'Fallo nativo controlado';end if;return new;end$$;
 create trigger fail_plan_fixture before update on public.transactions for each row execute function public.fail_plan_fixture();`);
const failedRequest='59000000-0000-4000-8000-000000000004';
const failure=await execute(asClient(`select public.mutate_installment_plan('${failedRequest}','edit','${afterRace.group_id}','${afterRace.version}','${afterRace.rows[0].id}','{"description":"Fallo nativo","amount":200}',true)`),true);
assert.notEqual(failure.code,0);assert.match(failure.error,/Fallo nativo controlado/);
assert.deepEqual(decodePlan(await execute(asClient(`select public.get_installment_plan('${afterRace.group_id}')`))),afterRace);
assert.equal((await execute(`select count(*) from public.installment_plan_requests where request_id='${failedRequest}';`)).output,'0');
await execute('drop trigger fail_plan_fixture on public.transactions;drop function public.fail_plan_fixture();');
// FE-04: mismo intento en dos conexiones y cancelación frente a un guardado tardío.
await execute(await readFile(new URL('030_idempotent_pwa_entries.sql',migrations),'utf8'));
const pwaPayload=quote(JSON.stringify({kind:'expense',description:'PWA synthetic native',amount:12.34,currency:'ARS',category_id:planCategory,occurred_on:'2026-10-23'}));
await execute(`create function public.slow_pwa_fixture() returns trigger language plpgsql as $$begin if new.description='PWA synthetic native' then perform pg_sleep(0.4);end if;return new;end$$;create trigger slow_pwa_fixture before insert on public.transactions for each row execute function public.slow_pwa_fixture();`);
const pwaId='59000000-0000-4000-8000-000000000005';
const pwaCreated=await Promise.all([0,1].map(()=>execute(asClient(`select public.submit_pwa_entry('${pwaId}','movement',${pwaPayload}::jsonb,false)`))));
const pwaOne=decodePlan(pwaCreated[0]),pwaTwo=decodePlan(pwaCreated[1]);
assert.equal(pwaOne.entity_id,pwaTwo.entity_id);assert.equal(pwaOne.state,'saved');assert.equal(pwaTwo.state,'saved');
assert.equal((await execute(`select count(*) from public.transactions where id='${pwaOne.entity_id}';`)).output,'1');
const pwaRaceId='59000000-0000-4000-8000-000000000006';
const pwaRace=await Promise.all([
 execute(asClient(`select public.submit_pwa_entry('${pwaRaceId}','movement',${pwaPayload}::jsonb,false)`)),
 execute(asClient(`select public.submit_pwa_entry('${pwaRaceId}','movement','{}',true)`)),
]);
const pwaRaceResults=pwaRace.map(decodePlan);
assert.equal(pwaRaceResults[0].state,pwaRaceResults[1].state,'Cancelar informó un resultado incompatible con el guardado');
assert.equal(pwaRaceResults[0].entity_id,pwaRaceResults[1].entity_id);
assert.ok(['cancelled','saved'].includes(pwaRaceResults[0].state));
assert.equal((await execute(`select count(*) from public.pwa_entry_requests where user_id='${a}' and request_id='${pwaRaceId}';`)).output,'1');
await execute(`delete from public.transactions where id='${pwaOne.entity_id}';drop trigger slow_pwa_fixture on public.transactions;drop function public.slow_pwa_fixture();`);
assert.equal(decodePlan(await execute(asClient(`select public.submit_pwa_entry('${pwaId}','movement',${pwaPayload}::jsonb,false)`))).state,'removed');
// FE-06/BE-02: renovaciones de dos admins y canje comparten el bloqueo del cliente.
const secondAdmin='50000000-0000-4000-8000-000000000004';
await execute(`insert into auth.users(id,email)values('${secondAdmin}','second-admin@example.invalid');alter table public.profiles disable trigger tr_protect_profile_system_fields;update public.profiles set role='admin' where id='${secondAdmin}';update public.profiles set subscription_status='active',subscription_until=clock_timestamp()+interval '20 days' where id='${a}';alter table public.profiles enable trigger tr_protect_profile_system_fields;insert into public.invitation_codes(code,duration_days)values('NATIVE-RENEWAL',15);`);
await execute(await readFile(new URL('031_atomic_subscription_renewals.sql',migrations),'utf8'));
await execute('revoke usage on schema auth from pesito_subscription_writer;');
await execute(await readFile(new URL('032_subscription_identity_bridge.sql',migrations),'utf8'));
const subscriptionActor=(actor,sql)=>`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${actor}',true);${sql};commit;`;
await execute(`create function public.slow_subscription_fixture()returns trigger language plpgsql as $$begin if new.id='${a}' then perform pg_sleep(0.2);end if;return new;end$$;create trigger slow_subscription_fixture before update on public.profiles for each row execute function public.slow_subscription_fixture();`);
const subResults=await Promise.all([
 execute(subscriptionActor(admin,`select public.admin_renew_subscription('59000000-0000-4000-8000-000000000031','${a}','extend',30)`)),
 execute(subscriptionActor(secondAdmin,`select public.admin_renew_subscription('59000000-0000-4000-8000-000000000032','${a}','extend',60)`)),
 execute(subscriptionActor(a,`select public.redeem_invitation_code('NATIVE-RENEWAL','${a}')`)),
]);
assert.equal(decodePlan(subResults[2]).success,true);
const nativeDays=Number((await execute(`select extract(epoch from(subscription_until-clock_timestamp()))/86400 from public.profiles where id='${a}';`)).output);
assert.ok(Math.abs(nativeDays-125)<0.001,'Se perdieron días entre dos administradores y un canje');
const duplicateRenewal=`select public.admin_renew_subscription('59000000-0000-4000-8000-000000000033','${a}','extend',7)`;
const subDuplicate=await Promise.all([0,1].map(()=>execute(subscriptionActor(admin,duplicateRenewal))));
assert.equal(subDuplicate.map(decodePlan).filter(r=>r.replayed).length,1);
const nativeAfterRetry=Number((await execute(`select extract(epoch from(subscription_until-clock_timestamp()))/86400 from public.profiles where id='${a}';`)).output);
assert.ok(Math.abs(nativeAfterRetry-132)<0.001,'Se sumaron dos veces los días del mismo intento');
await execute('drop trigger slow_subscription_fixture on public.profiles;drop function public.slow_subscription_fixture();');
// BE-07: el mismo contrato se verifica con dos conexiones PostgreSQL reales.
await execute(await readFile(new URL('033_require_current_review_for_confirmation.sql',migrations),'utf8'));
assert.equal((await execute(`select public.claim_whatsapp_actor('synthetic-native','${tokens[2]}');`)).output,'t');
const be07Next=async()=>JSON.parse((await execute(`select public.next_whatsapp_job('synthetic-native','${tokens[2]}');`)).output||'null');
const be07Apply=(job,action)=>execute(`select public.apply_whatsapp_job('${job.id}','${tokens[2]}',${quote(JSON.stringify(action))}::jsonb);`);
const be07Finish=job=>execute(`select public.finish_whatsapp_job('${job.id}','${tokens[2]}');`);
const be07Enqueue=(id,body)=>execute(`select public.enqueue_whatsapp_messages(${quote(JSON.stringify([{id,from:'synthetic-native',type:'text',text:{body},timestamp:String(Math.floor(Date.now()/1000))}]))}::jsonb);`);
// Finalizar únicamente los dos mensajes sintéticos de la prueba anterior.
for(let i=0;i<2;i++){
 const queued=await be07Next();assert.ok(['native-a','native-b'].includes(queued.payload.id));
 await be07Apply(queued,{kind:'reply',text:null});await be07Finish(queued);
}
assert.equal(await be07Next(),null);
const be07Show=async()=>{
 await execute("update public.whatsapp_worker_state set last_received_at=clock_timestamp()-interval '4 seconds' where wa_id='synthetic-native';");
 const shown=JSON.parse((await execute(`select public.whatsapp_summary_snapshot('synthetic-native','${tokens[2]}');`)).output);
 assert.equal(shown.found,true);assert.equal(shown.items.length,1);
 await execute(`select public.mark_whatsapp_summary_sent('synthetic-native','${tokens[2]}','${shown.group_id}',${shown.version});update public.whatsapp_worker_state set shown_at=clock_timestamp()-interval '2 seconds' where wa_id='synthetic-native';`);
 return shown;
};
const be07Shown=await be07Show();
const be07CountBefore=Number((await execute('select count(*) from public.transactions;')).output);
await execute(`update public.draft_groups set last_activity_at=clock_timestamp()-interval '25 hours' where id='${be07Shown.group_id}';update public.whatsapp_worker_state set shown_at=clock_timestamp()-interval '25 hours' where wa_id='synthetic-native';`);
await be07Enqueue('be07-native-held','confirmar');
const be07Held=await be07Next();assert.equal(be07Held.confirmation_group_id,be07Shown.group_id);
await be07Apply(be07Held,{kind:'confirm'});await be07Finish(be07Held);
assert.equal((await execute(`select status from public.whatsapp_message_queue where id='${be07Held.id}';`)).output,'waiting');
await be07Enqueue('be07-native-resume','retomar');
const be07Resume=await be07Next();assert.equal(be07Resume.payload.id,'be07-native-resume');
await be07Apply(be07Resume,{kind:'resume'});await be07Finish(be07Resume);
const be07Replayed=await be07Next();assert.equal(be07Replayed.payload.id,'be07-native-held');
assert.equal(be07Replayed.confirmation_group_id,null);assert.equal(be07Replayed.confirmation_version,null);
const be07Rejected=await Promise.all([0,1].map(()=>be07Apply(be07Replayed,{kind:'confirm'})));
for(const result of be07Rejected)assert.match(JSON.parse(result.output).reply_text,/nuevamente/);
assert.equal(Number((await execute('select count(*) from public.transactions;')).output),be07CountBefore,'La confirmación retenida guardó sin nueva revisión');
await be07Finish(be07Replayed);await be07Show();
await be07Enqueue('be07-native-reviewed','confirmar');await be07Enqueue('be07-native-again','confirmar');
const be07Reviewed=await be07Next();assert.equal(be07Reviewed.payload.id,'be07-native-reviewed');
const be07Saved=await Promise.all([0,1].map(()=>be07Apply(be07Reviewed,{kind:'confirm'})));
for(const result of be07Saved)assert.match(JSON.parse(result.output).reply_text,/Se guardaron/);
await be07Finish(be07Reviewed);
const be07Again=await be07Next();await be07Apply(be07Again,{kind:'confirm'});await be07Finish(be07Again);
assert.equal(Number((await execute('select count(*) from public.transactions;')).output),be07CountBefore+1,'La confirmación concurrente duplicó el guardado');
assert.equal((await execute(`select count(*) from public.draft_items i join public.draft_groups g on g.id=i.group_id where i.user_id='${a}' and g.status<>'open' and i.status='pending';`)).output,'0','Quedó un ítem pendiente en un grupo cerrado');


// BE-08: el esquema nullable conserva el lote y bloquea confirmación parcial.
await execute((await readFile(new URL('034_incomplete_draft_items.sql',migrations),'utf8')).replace(/\r\n/g,'\n'));
const be08Before=Number((await execute('select count(*) from public.transactions;')).output);
const be08Items=[{kind:'expense',description:'Completo nativo',totalAmountArs:101,currency:'ARS',occurredOn:'2026-10-26',confidence:0,installments:1,missingFields:[]},{kind:'income',description:'Pendiente nativo',totalAmountArs:null,currency:'USD',occurredOn:'2026-10-26',confidence:0,installments:1,missingFields:['amount'],clarification:'Importe pendiente'}];
await be07Enqueue('be08-native-add','Gastos sintéticos');
const be08Add=await be07Next();await be07Apply(be08Add,{kind:'add',items:be08Items});await be07Finish(be08Add);
const be08Show=async()=>{
 await execute("update public.whatsapp_worker_state set last_received_at=clock_timestamp()-interval '4 seconds' where wa_id='synthetic-native';");
 const shown=JSON.parse((await execute(`select public.whatsapp_summary_snapshot('synthetic-native','${tokens[2]}');`)).output);
 assert.equal(shown.items.length,2);
 await execute(`select public.mark_whatsapp_summary_sent('synthetic-native','${tokens[2]}','${shown.group_id}',${shown.version});update public.whatsapp_worker_state set shown_at=clock_timestamp()-interval '2 seconds' where wa_id='synthetic-native';`);
 return shown;
};
const be08Shown=await be08Show();
assert.equal(be08Shown.items[1].amount,null);assert.deepEqual(be08Shown.items[1].missing_fields,['amount']);
assert.equal((await execute(`select confidence from public.draft_items where group_id='${be08Shown.group_id}' and position=2;`)).output,'0.000');
await be07Enqueue('be08-native-blocked','confirmar');
const be08Blocked=await be07Next();assert.match(JSON.parse((await be07Apply(be08Blocked,{kind:'confirm'})).output).reply_text,/datos faltantes/);await be07Finish(be08Blocked);
assert.equal(Number((await execute('select count(*) from public.transactions;')).output),be08Before);
await be07Enqueue('be08-native-fill','el 2 fue de 5000');await be07Enqueue('be08-native-stale','el 2 fue de 6000');
const be08Fill=await be07Next();
const be08Action={kind:'complete',position:2,group_id:be08Shown.group_id,version:be08Shown.version,patch:{amount:5000}};
await Promise.all([0,1].map(()=>be07Apply(be08Fill,be08Action)));await be07Finish(be08Fill);
const be08Stale=await be07Next();await be07Apply(be08Stale,{...be08Action,patch:{amount:6000}});await be07Finish(be08Stale);
assert.equal((await execute(`select amount from public.draft_items where group_id='${be08Shown.group_id}' and position=2;`)).output,'5000.00');
assert.equal((await execute(`select version from public.draft_groups where id='${be08Shown.group_id}';`)).output,String(be08Shown.version+1));
await be08Show();await be07Enqueue('be08-native-confirm','confirmar');
const be08Confirm=await be07Next();await be07Apply(be08Confirm,{kind:'confirm'});await be07Finish(be08Confirm);
assert.equal(Number((await execute('select count(*) from public.transactions;')).output),be08Before+2);

// INF-15: dos clientes en conexiones reales compiten por la última unidad global.
await execute(await readFile(new URL('035_shared_ai_quota.sql',migrations),'utf8'));
await execute("update public.ai_quota_policy set daily_limit=1 where lane='qwen';");
await execute(`update public.whatsapp_links set wa_id='synthetic-quota-admin',status='active' where user_id='${admin}';`);
const quotaActors=[['synthetic-native',tokens[2]],['synthetic-quota-admin',tokens[0]]];
const quotaJobs=[];
for(const [wa,token]of quotaActors){
 await execute(`select public.enqueue_whatsapp_messages(${quote(JSON.stringify([{id:'quota-'+wa,from:wa,type:'text',text:{body:'Solo sintético'},timestamp:String(Math.floor(Date.now()/1000))}]))}::jsonb);select public.claim_whatsapp_actor('${wa}','${token}');`);
 quotaJobs.push(JSON.parse((await execute(`select public.next_whatsapp_job('${wa}','${token}');`)).output));
}
const reserve=(q,token)=>execute(`select public.reserve_whatsapp_ai_quota('${q.id}','${token}',${q.attempts},'qwen');`);
const quotaRace=(await Promise.all(quotaJobs.map((q,i)=>reserve(q,quotaActors[i][1])))).map(decodePlan);
assert.equal(quotaRace.filter(r=>r.allowed).length,1,'Se superó el cupo compartido entre clientes');
assert.equal(quotaRace.filter(r=>r.reason==='exhausted').length,1);
const quotaWinner=quotaRace.findIndex(r=>r.allowed);
assert.equal(decodePlan(await reserve(quotaJobs[quotaWinner],quotaActors[quotaWinner][1])).reason,'already_reserved');
assert.equal((await execute('select count(*) from public.ai_quota_reservations;')).output,'1');
assert.equal((await execute('select sum(reserved) from public.ai_quota_days;')).output,'1');

// INF-14: contenido terminado bloqueado por otra sesión se omite, luego se limpia.
// Solo en inf03_queue_test/127.0.0.1, sin cron ni proveedores reales.
for(let i=0;i<quotaJobs.length;i++){
 const q=quotaJobs[i],token=quotaActors[i][1];
 await execute(`select public.claim_whatsapp_actor('${quotaActors[i][0]}','${token}');`);
 await execute(`select public.apply_whatsapp_job('${q.id}','${token}','{"kind":"reply","text":null}');select public.finish_whatsapp_job('${q.id}','${token}');`);
}
await execute(`select public.claim_whatsapp_actor('synthetic-native','${tokens[2]}');`);
const retentionJobs=[];
for(const id of ['retention-native-a','retention-native-b']){await be07Enqueue(id,'Contenido ficticio');const q=await be07Next();await be07Apply(q,{kind:'reply',text:'Solo fixture'});await be07Finish(q);retentionJobs.push(q);}
await execute(`update public.whatsapp_message_queue set processed_at=clock_timestamp()-interval '31 days' where id in ('${retentionJobs[0].id}','${retentionJobs[1].id}');update public.whatsapp_ops_config set retention_enabled=true;`);
const retentionSnapshot=async()=>JSON.parse((await execute("select jsonb_build_object('finance',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.transactions t),'drafts',(select coalesce(jsonb_agg(to_jsonb(d) order by id),'[]') from public.draft_items d),'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by job_id,attempt,lane),'[]') from public.ai_quota_reservations r),'days',(select coalesce(jsonb_agg(to_jsonb(c) order by day,lane),'[]') from public.ai_quota_days c));")).output);
const retentionBefore=await retentionSnapshot();
const held=execute(`begin;select id from public.whatsapp_message_queue where id='${retentionJobs[0].id}' for update;select pg_advisory_xact_lock(7140027);select pg_sleep(3);commit;`);
let retentionLock=false;
for(let n=0;n<50;n++){
 if((await execute("select exists(select 1 from pg_locks where locktype='advisory' and objid=7140027 and granted);")).output==='t'){retentionLock=true;break;}
 await new Promise(resolve=>setTimeout(resolve,10));
}
assert.ok(retentionLock,'No se adquirió el lock de la fixture');
assert.equal((await execute('select public.prune_whatsapp_ops_content();')).output,'1','No omitió el mensaje bloqueado');
await held;
assert.equal((await execute('select public.prune_whatsapp_ops_content();')).output,'1','No recuperó el mensaje después de liberar su lock');
const retentionRace=await Promise.all([0,1].map(()=>execute('select public.prune_whatsapp_ops_content();')));
assert.deepEqual(retentionRace.map(r=>r.output),['0','0']);
await be07Enqueue('retention-native-a','Contenido ficticio repetido');
assert.equal((await execute("select count(*) from public.whatsapp_message_queue where wa_message_id like 'retention-native-%';")).output,'2','El reenvío revivió un mensaje redactado');
assert.deepEqual(await retentionSnapshot(),retentionBefore,'La limpieza modificó finanzas/borradores/recibos de IA');
await execute('update public.whatsapp_ops_config set retention_enabled=false;');

// BE-09: contrato de solo lectura también con PostgreSQL nativo.
await execute(await readFile(new URL('036_monthly_financial_summary.sql',migrations),'utf8'));
const financeBeforeRead=await retentionSnapshot();
const financeRead=await Promise.all([0,1].map(()=>execute(`select public.whatsapp_monthly_summary('${a}','2026-10-15');`)));
assert.deepEqual(JSON.parse(financeRead[0].output),JSON.parse(financeRead[1].output));
assert.equal(JSON.parse(financeRead[0].output).currencies.length,2);
assert.deepEqual(await retentionSnapshot(),financeBeforeRead,'Consultar el resumen modificó datos');

// BE-12: dos aplicaciones concurrentes del mismo patch solo incrementan una vez.
await execute((await readFile(new URL('037_versioned_draft_edits.sql',migrations),'utf8')).replace(/\r\n/g,'\n'));
const be12FinanceBefore=await retentionSnapshot();
await execute(`select public.claim_whatsapp_actor('synthetic-native','${tokens[2]}');`);
await be07Enqueue('be12-native-add','Gasto ficticio');const be12Add=await be07Next();
await be07Apply(be12Add,{kind:'add',items:[{kind:'expense',description:'Original',totalAmountArs:123.45,currency:'ARS',occurredOn:'2026-10-27',installments:3,firstInstallmentMonth:'2026-11',confidence:1,missingFields:[]}]});await be07Finish(be12Add);
const be12Group=JSON.parse((await execute(`select public.get_active_draft_group('${a}');`)).output);
await be07Enqueue('be12-native-edit','Corrección ficticia');await be07Enqueue('be12-native-stale','Corrección antigua');const be12Job=await be07Next();
const be12Action={kind:'edit',group_id:be12Group.group_id,version:be12Group.version,position:1,patch:{description:'Editado',amount:250.01,currency:'USD',category:'Otros'}};
await Promise.all([0,1].map(()=>be07Apply(be12Job,be12Action)));await be07Finish(be12Job);
const be12After=JSON.parse((await execute(`select public.get_active_draft_group('${a}');`)).output);
assert.equal(be12After.version,be12Group.version+1);assert.equal(be12After.items[0].amount,250.01);assert.equal(be12After.items[0].currency,'USD');assert.equal(be12After.items[0].installments,3);
const be12Stale=await be07Next();assert.match(JSON.parse((await be07Apply(be12Stale,{...be12Action,patch:{amount:999}})).output).reply_text,/La lista cambió/);await be07Finish(be12Stale);
assert.deepEqual(JSON.parse((await execute(`select public.get_active_draft_group('${a}');`)).output),be12After);
assert.deepEqual((await retentionSnapshot()).finance,be12FinanceBefore.finance,'Una edición de borrador escribió finanzas');
const evidence={draft_edit_concurrent_idempotent:true,draft_edit_stale_version_rejected:true,draft_edit_preserves_finance:true,monthly_summary_concurrent_readonly:true,retention_skip_locked:true,retention_repeat_idempotent:true,retention_preserves_finance_drafts_ai:true,retention_reenqueue_deduplicated:true,ai_quota_shared_concurrent:true,ai_quota_duplicate_denied:true,postgres:(await execute('show server_version;')).output,isolated_database:true,incomplete_batch_confirmation_blocked:true,completion_concurrent_idempotent:true,completion_stale_version_rejected:true,concurrent_sessions:2,retained_confirmation_requires_fresh_review:true,confirmation_apply_concurrent_idempotent:true,exclusive_lease:true,subscription_concurrent_admins_and_redemption:true,subscription_retry_idempotent:true,pwa_create_idempotent:true,pwa_cancel_save_race_consistent:true,pwa_deleted_not_recreated:true,installment_create_idempotent:true,installment_stale_version_rejected:true,installment_failure_atomic:true,ops_exclusive_notice_claim:true,ops_uncertain_not_retried:true,expired_worker_fenced:true,concurrent_apply_idempotent:true,concurrent_enqueue_deduplicated:true,late_delivery_retry_idempotent:true,duration_ms:Date.now()-started};
if(process.env.PESITO_TEST_EVIDENCE) await writeFile(process.env.PESITO_TEST_EVIDENCE,JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence));
