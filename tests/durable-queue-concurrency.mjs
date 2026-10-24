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
const evidence={postgres:(await execute('show server_version;')).output,isolated_database:true,concurrent_sessions:2,exclusive_lease:true,pwa_create_idempotent:true,pwa_cancel_save_race_consistent:true,pwa_deleted_not_recreated:true,installment_create_idempotent:true,installment_stale_version_rejected:true,installment_failure_atomic:true,ops_exclusive_notice_claim:true,ops_uncertain_not_retried:true,expired_worker_fenced:true,concurrent_apply_idempotent:true,concurrent_enqueue_deduplicated:true,late_delivery_retry_idempotent:true,duration_ms:Date.now()-started};
if(process.env.PESITO_TEST_EVIDENCE) await writeFile(process.env.PESITO_TEST_EVIDENCE,JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence));
