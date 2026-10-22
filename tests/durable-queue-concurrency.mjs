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
const evidence={postgres:(await execute('show server_version;')).output,isolated_database:true,concurrent_sessions:2,exclusive_lease:true,expired_worker_fenced:true,concurrent_apply_idempotent:true,concurrent_enqueue_deduplicated:true,late_delivery_retry_idempotent:true,duration_ms:Date.now()-started};
if(process.env.PESITO_TEST_EVIDENCE) await writeFile(process.env.PESITO_TEST_EVIDENCE,JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence));
