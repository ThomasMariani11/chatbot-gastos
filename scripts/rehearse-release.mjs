// Ensayo real de Supabase local. Sin secretos de proveedores ni llamadas al proyecto alojado.
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, stop, localUrl, localDockerEndpoint, localEnvironment, stampDistribution, digestFiles, validateReleaseContract, assertSharedMigrationHashes, assertSchemaCoverage, assertReleaseMatrix } from './release-tools.mjs';
import { prepareLocal } from './prepare-local.mjs';
import { smokeBusinessContract } from './release-sql-contract.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const env = localEnvironment();
const npmCli = process.env.npm_execpath;
assert.ok(npmCli?.endsWith('npm-cli.js'), 'Ejecutar mediante npm run test:release.');
const tools = JSON.parse(await readFile(join(root, 'config/environments.json'), 'utf8'));
const cliVersion = (await readFile(join(root, '.supabase-version'), 'utf8')).trim();
assert.match(cliVersion, /^\d+\.\d+\.\d+$/);
assert.equal(process.versions.node, (await readFile(join(root, '.node-version'), 'utf8')).trim(), 'Usar Node de .node-version.');
assert.match(tools.release.rollbackCommit, /^[a-f0-9]{40}$/);
assert.equal(await run('git', ['status', '--porcelain'], { cwd: root }), '', 'Se requiere checkout limpio.');
const current = await run('git', ['rev-parse', 'HEAD'], { cwd: root });
const temp = await mkdtemp(join(tmpdir(), 'pesito-release-'));
const work = join(temp, 'stack');
const project = 'pesito-rehearsal';
const evidence = { sourceCommit: current, rollbackCommit: tools.release.rollbackCommit, contract: tools.release, isolated: true, phases: [], matrix: [] };
let serving, stackAttempted = false, phase = 'docker', activeWork = work, inventories;
async function step(name, action) {
  phase = name;
  const started = Date.now();
  const value = await action();
  evidence.phases.push({ name, passed: true, durationMs: Date.now() - started });
  console.log(JSON.stringify({ phase: name, passed: true }));
  return value;
}
const cli = (args, timeout = 480000) => run(process.execPath, [npmCli, 'exec', '--yes', '--package=supabase@' + cliVersion, '--', 'supabase', '--workdir', activeWork, ...args], { cwd: root, env, timeout });
async function archive(commit, directory) {
  // Un squash puede dejar el puente de rollback solo en la historia de la PR.
  // Resolver únicamente el SHA fijado, sin cambiar el checkout ni traer ramas.
  try { await run("git", ["cat-file", "-e", commit + "^{commit}"], {cwd:root,env}); }
  catch { await run("git", ["fetch", "--no-tags", "origin", commit], {cwd:root,env,timeout:60000}); }
  await mkdir(directory);
  const tar = directory + '.tar';
  await run('git', ['archive', '--format=tar', '--output', tar, commit], { cwd: root, env });
  await run('tar', ['-xf', tar, '-C', directory], { env });
}
async function sql(query) {
  return run('docker', ['exec', '-i', 'supabase_db_' + project, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { env, input: query, timeout: 30000 });
}
async function request(api, path, { key, body, headers = {}, method = body === undefined ? 'GET' : 'POST' } = {}) {
  const response = await fetch(localUrl(api) + path, {
    method, headers: { ...(key ? { apikey: key, Authorization: 'Bearer ' + key } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  return response;
}
const metaSecret = randomBytes(32).toString('hex'), workerSecret = randomBytes(32).toString('hex'), syntheticPassword = randomBytes(32).toString('hex');
async function startWorker(api) {
  serving = run(process.execPath, [npmCli, 'exec', '--yes', '--package=supabase@' + cliVersion, '--', 'supabase', '--workdir', activeWork, 'functions', 'serve', 'whatsapp-webhook', '--no-verify-jwt', '--env-file', join(temp, 'synthetic.env')], { cwd: root, env, timeout: 600000, background: true });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (serving.exitCode !== null) throw new Error('No se pudo servir el webhook local.');
    try {
      const response = await request(api, '/functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=synthetic-verify&hub.challenge=local-ok');
      if (response.status === 200 && await response.text() === 'local-ok') return;
    } catch { /* arranque local todavía en curso */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Webhook local no disponible dentro del plazo.');
}
async function stopWorker() {
  await stop(serving);
  if (serving && serving.exitCode === null && !serving.signalCode) {
    await new Promise(resolve => { serving.once('close', resolve); setTimeout(resolve, 10000); });
  }
  serving = undefined;
}
async function smokeWorker(api) {
  const path = '/functions/v1/whatsapp-webhook';
  assert.equal((await request(api, path, { body: '{}' })).status, 401);
  const signature = 'sha256=' + createHmac('sha256', metaSecret).update('{}').digest('hex');
  assert.equal((await request(api, path, { body: '{}', headers: { 'x-hub-signature-256': signature } })).status, 200);
  assert.equal((await request(api, path + '?action=worker', { body: '{}' })).status, 401);
  assert.equal((await request(api, path + '?action=worker', { body: '{}', headers: { 'x-worker-secret': workerSecret } })).status, 200);
}
async function smokeWaitingRecoverySql(id) {
  // Aislado y transaccional; se repite con runtime anterior sobre esquema 038.
  await sql(`begin;
    update public.whatsapp_queue_control set enabled=true;
    update public.whatsapp_links set wa_id='synthetic-release-wait',status='active' where user_id='${id}';
    select public.enqueue_whatsapp_messages('[{"id":"release-wait-fill","from":"synthetic-release-wait","type":"text","text":{"body":"Solo fixture"}}]'::jsonb);
    select public.claim_whatsapp_actor('synthetic-release-wait','65000000-0000-4000-8000-000000000038');
    do $$declare j jsonb;r jsonb;items jsonb;n integer;begin
      select jsonb_agg(jsonb_build_object('kind','expense','description','BE11 fixture','totalAmountArs',i,'currency','ARS','occurredOn','2026-10-28','installments',1,'confidence',1,'missingFields','[]'::jsonb)) into items from generate_series(1,20)i;
      j:=public.next_whatsapp_job('synthetic-release-wait','65000000-0000-4000-8000-000000000038');
      perform public.apply_whatsapp_job((j->>'id')::uuid,'65000000-0000-4000-8000-000000000038',jsonb_build_object('kind','add','items',items));
      perform public.finish_whatsapp_job((j->>'id')::uuid,'65000000-0000-4000-8000-000000000038');
      perform public.enqueue_whatsapp_messages('[{"id":"release-wait-held","from":"synthetic-release-wait","type":"text","text":{"body":"Lote ficticio"}}]'::jsonb);
      j:=public.next_whatsapp_job('synthetic-release-wait','65000000-0000-4000-8000-000000000038');
      perform public.apply_whatsapp_job((j->>'id')::uuid,'65000000-0000-4000-8000-000000000038',jsonb_build_object('kind','add','items',jsonb_build_array(items->0,items->1)));
      perform public.finish_whatsapp_job((j->>'id')::uuid,'65000000-0000-4000-8000-000000000038');
      for n in 1..2 loop
        perform public.enqueue_whatsapp_messages(jsonb_build_array(jsonb_build_object('id','release-wait-remove-'||n,'from','synthetic-release-wait','type','text','text',jsonb_build_object('body','sacame el '||n))));
        j:=public.next_whatsapp_job('synthetic-release-wait','65000000-0000-4000-8000-000000000038');
        if j->>'wa_message_id' is distinct from 'release-wait-remove-'||n then raise exception 'WAITING_ALIAS_BLOCKED';end if;
        perform public.apply_whatsapp_job((j->>'id')::uuid,'65000000-0000-4000-8000-000000000038',jsonb_build_object('kind','remove','position',n));
        perform public.finish_whatsapp_job((j->>'id')::uuid,'65000000-0000-4000-8000-000000000038');
        j:=public.next_whatsapp_job('synthetic-release-wait','65000000-0000-4000-8000-000000000038');
        if j->>'wa_message_id' is distinct from 'release-wait-held' then raise exception 'WAITING_MESSAGE_LOST';end if;
        perform public.apply_whatsapp_job((j->>'id')::uuid,'65000000-0000-4000-8000-000000000038',jsonb_build_object('kind','add','items',jsonb_build_array(items->0,items->1)));
        perform public.finish_whatsapp_job((j->>'id')::uuid,'65000000-0000-4000-8000-000000000038');
      end loop;
      if (select capacity_resumes from public.whatsapp_message_queue where wa_message_id='release-wait-held')<>2 or (select status from public.whatsapp_message_queue where wa_message_id='release-wait-held')<>'processed' then raise exception 'WAITING_RECOVERY_INVALID';end if;
      perform public.enqueue_whatsapp_messages('[{"id":"release-wait-oversized","from":"synthetic-release-wait","type":"text","text":{"body":"Lote grande ficticio"}}]'::jsonb);
      j:=public.next_whatsapp_job('synthetic-release-wait','65000000-0000-4000-8000-000000000038');
      r:=public.apply_whatsapp_job((j->>'id')::uuid,'65000000-0000-4000-8000-000000000038',jsonb_build_object('kind','add','items',items||jsonb_build_array(items->0)));
      if r->>'reply_text' is distinct from public.whatsapp_over_limit_reply(21) or r->>'pause_reason' is not null then raise exception 'WAITING_OVERSIZE_BLOCK';end if;
    end $$;
    rollback;`);
}

async function smokeDraftEditSql(id) {
  // Solo fixtures del stack local; también se ejecuta con runtime rollback/037.
  await sql(`begin;
    update public.whatsapp_queue_control set enabled=true;
    update public.whatsapp_links set wa_id='synthetic-release-edit',status='active' where user_id='${id}';
    select public.enqueue_whatsapp_messages('[{"id":"release-edit-add","from":"synthetic-release-edit","type":"text","text":{"body":"Solo sintético"}}]'::jsonb);
    select public.claim_whatsapp_actor('synthetic-release-edit','65000000-0000-4000-8000-000000000037');
    do $$declare j jsonb;r jsonb;g jsonb;v integer;begin
      j:=public.next_whatsapp_job('synthetic-release-edit','65000000-0000-4000-8000-000000000037');
      perform public.apply_whatsapp_job((j->>'id')::uuid,'65000000-0000-4000-8000-000000000037','{"kind":"add","items":[{"kind":"expense","description":"Fixture","totalAmountArs":100,"currency":"ARS","occurredOn":"2026-10-27","installments":1,"confidence":1,"missingFields":[]}]}'::jsonb);
      perform public.finish_whatsapp_job((j->>'id')::uuid,'65000000-0000-4000-8000-000000000037');
      g:=public.get_active_draft_group('${id}');v:=(g->>'version')::integer;
      perform public.enqueue_whatsapp_messages('[{"id":"release-edit-patch","from":"synthetic-release-edit","type":"text","text":{"body":"El 1 moneda USD"}}]'::jsonb);
      j:=public.next_whatsapp_job('synthetic-release-edit','65000000-0000-4000-8000-000000000037');
      r:=public.apply_whatsapp_job((j->>'id')::uuid,'65000000-0000-4000-8000-000000000037',jsonb_build_object('kind','edit','position',1,'group_id',g->>'group_id','version',v,'patch',jsonb_build_object('currency','USD','amount',123.45,'category','Otros','installments',3,'first_installment_month','2026-11')));
      if r->>'reply_text' is not null then raise exception 'EDIT_RELEASE_REJECTED';end if;
      if not exists(select 1 from public.draft_items where group_id=(g->>'group_id')::uuid and position=1 and amount=123.45 and currency='USD' and installments=3 and first_installment_month='2026-11') then raise exception 'EDIT_RELEASE_MISMATCH';end if;
      if (select version from public.draft_groups where id=(g->>'group_id')::uuid)<>v+1 then raise exception 'EDIT_VERSION_MISMATCH';end if;
      if has_function_privilege('service_role','public.edit_pending_draft_item(uuid,uuid,integer,integer,jsonb)','execute') then raise exception 'EDIT_HELPER_EXPOSED';end if;
    end$$;
    rollback;`);
}

async function smokeQuotaSql(id) {
  // Todo el trabajo se revierte; solo usa el usuario ficticio creado por este ensayo.
  await sql(`begin;
    update public.whatsapp_queue_control set enabled=true;
    update public.whatsapp_links set wa_id='synthetic-release-quota',status='active' where user_id='${id}';
    select public.enqueue_whatsapp_messages('[{"id":"release-quota","from":"synthetic-release-quota","type":"text","text":{"body":"Solo sintético"}}]'::jsonb);
    select public.claim_whatsapp_actor('synthetic-release-quota','65000000-0000-4000-8000-000000000035');
    do $$declare j jsonb;r jsonb;begin
      j:=public.next_whatsapp_job('synthetic-release-quota','65000000-0000-4000-8000-000000000035');
      r:=public.reserve_whatsapp_ai_quota((j->>'id')::uuid,'65000000-0000-4000-8000-000000000035',(j->>'attempts')::integer,'qwen');
      if r->>'allowed' is distinct from 'true' or r->>'used' is distinct from '1' or r->>'limit' is distinct from '100' then raise exception 'QUOTA_RESERVE_FAILED';end if;
      r:=public.reserve_whatsapp_ai_quota((j->>'id')::uuid,'65000000-0000-4000-8000-000000000035',(j->>'attempts')::integer,'qwen');
      if r->>'reason' is distinct from 'already_reserved' then raise exception 'QUOTA_DUPLICATE_ALLOWED';end if;
      r:=public.reserve_whatsapp_ai_quota((j->>'id')::uuid,'65000000-0000-4000-8000-000000000035',(j->>'attempts')::integer,'gemini');
      if r->>'reason' is distinct from 'provider_disabled' then raise exception 'QUOTA_PROVIDER_ENABLED';end if;
    end$$;
    rollback;`);
}
async function smokeRetentionSql(id) {
  // Solo el stack local descartable; la política vuelve a false al hacer ROLLBACK.
  await sql(`begin;
    insert into public.whatsapp_message_queue(wa_message_id,wa_id,user_id,payload,queue_version,status,effect_applied,processed_at)
    values('release-retention','synthetic-retention','${id}','{"id":"release-retention","type":"audio","audio":{"id":"PRIVATE_FIXTURE"}}',2,'processed',true,clock_timestamp()-interval '31 days');
    update public.whatsapp_ops_config set retention_enabled=true;
    do $$declare before_finance jsonb;begin
      select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) into before_finance from public.transactions t;
      if public.prune_whatsapp_ops_content()<>1 then raise exception 'RETENTION_BATCH_FAILED';end if;
      if (select payload->>'redacted' from public.whatsapp_message_queue where wa_message_id='release-retention') is distinct from 'true' then raise exception 'RETENTION_CONTENT_NOT_REDACTED';end if;
      if (select payload ? 'audio' from public.whatsapp_message_queue where wa_message_id='release-retention') then raise exception 'RETENTION_PRIVATE_CONTENT_RETAINED';end if;
      if (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.transactions t) is distinct from before_finance then raise exception 'RETENTION_FINANCIAL_DATA_CHANGED';end if;
      if public.prune_whatsapp_ops_content()<>0 then raise exception 'RETENTION_REPLAY_FAILED';end if;
    end$$;
    rollback;`);
  assert.equal(await sql('select not retention_enabled from public.whatsapp_ops_config where singleton;'), 't');
}
async function buildAndSmoke(directory, commit, api, anon) {
  const buildEnv = { ...env, VITE_APP_ENV: 'local', VITE_SUPABASE_URL: localUrl(api), VITE_SUPABASE_ANON_KEY: anon, GITHUB_SHA: commit };
  await run(process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund'], { cwd: directory, env: buildEnv, timeout: 180000 });
  await run(process.execPath, [npmCli, 'run', 'build'], { cwd: directory, env: buildEnv, timeout: 180000 });
  const dist = join(directory, 'dist');
  await stampDistribution(dist, commit);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const relative = decodeURIComponent(url.pathname).replace(/^\/chatbot-gastos\//, '');
      const file = resolve(dist, relative || 'index.html');
      if (!file.startsWith(dist + sep)) { res.writeHead(404).end(); return; }
      const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
      res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const indexResponse = await fetch(base + '/chatbot-gastos/');
    assert.equal(indexResponse.status, 200);
    assert.equal(indexResponse.headers.get('content-type'), 'text/html');
    const index = await indexResponse.text();
    const script = index.match(/<script\b[^>]*\bsrc="([^"]+)"/)?.[1];
    assert.ok(script, 'Falta bundle de la PWA.');
    const bundleResponse = await fetch(base + script);
    assert.equal(bundleResponse.status, 200);
    assert.equal(bundleResponse.headers.get('content-type'), 'application/javascript');
    const bundle = await bundleResponse.text();
    assert.ok(bundle.includes(localUrl(api)), 'El build del ensayo debe usar el backend local.');
    assert.ok(!bundle.includes(tools.production.publishableKey), 'No se debe insertar la clave de producción en el ensayo.');
    assert.equal((await (await fetch(base + '/chatbot-gastos/version.json')).json()).version, commit);
    assert.ok((await (await fetch(base + '/chatbot-gastos/sw.js')).text()).includes(commit));
  } finally { await new Promise(resolve => server.close(resolve)); }
}
async function seedRuntimeUser(api, status) {
    await sql("insert into public.invitation_codes(code,duration_days) values('INF10-LOCAL',30);");
    const created = await request(api, '/auth/v1/admin/users', { key: status.SERVICE_ROLE_KEY, body: {
      email: 'inf10@example.invalid', password: syntheticPassword, email_confirm: true,
      user_metadata: { invitation_code: 'INF10-LOCAL', first_name: 'Ensayo', last_name: 'Local' },
    } });
    assert.equal(created.status, 200);
    const user = await created.json();
    assert.match(user.id, /^[a-f0-9-]{36}$/);
    const profile = await (await request(api, '/rest/v1/profiles?id=eq.' + user.id + '&select=role,subscription_status,first_name', { key: status.SERVICE_ROLE_KEY })).json();
    assert.deepEqual(profile, [{ role: 'client', subscription_status: 'active', first_name: 'Ensayo' }]);
    assert.equal(await sql("select count(*) from public.categories where user_id='" + user.id + "';"), '16');
    await sql("insert into public.transactions(user_id,kind,description,amount_ars,occurred_on,status,source) values('" + user.id + "','expense','Solo ensayo local',100,current_date,'confirmed','pwa');");
    assert.equal(await sql("select has_function_privilege('anon','public.get_active_draft_group(uuid)','EXECUTE');"), 'f');
    const denied = await request(api, '/rest/v1/rpc/get_active_draft_group', { key: status.ANON_KEY, body: { p_user_id: user.id } });
    assert.ok([401, 403, 404].includes(denied.status), 'La RPC privada no debe estar habilitada a anon.');
    return user.id;
}

async function installedSchema(required) {
  const versions = JSON.parse(await sql('select json_agg(version order by version) from supabase_migrations.schema_migrations;'));
  assert.deepEqual(versions, [...required, '99999999999999'], 'El esquema ensayado debe ser exactamente el anunciado.');
  assertSchemaCoverage(versions, required);
  assert.equal(await sql('select not enabled from public.whatsapp_queue_control;'), 't');
  assert.equal(await sql("select count(*) from cron.job where jobname in ('pesito-whatsapp-queue-recovery','pesito-whatsapp-observability','pesito-whatsapp-retention');"), '0');
}
async function quietQueue() {
  assert.equal(await sql("select count(*) from public.whatsapp_message_queue where status<>'processed';"), '0', 'No cambiar runtime con mensajes o checkpoints en vuelo.');
  assert.equal(await sql('select count(*) from public.whatsapp_user_leases where lease_until>clock_timestamp();'), '0');
  assert.equal(await sql('select count(*) from public.whatsapp_worker_state where lease_until>clock_timestamp();'), '0');
}
async function runtimeProbe(directory, api, status, id, multiple) {
  const result = await run(process.execPath, ['--experimental-strip-types', join(root, 'scripts/release-runtime-probe.mjs'), directory], {
    cwd: directory, env, timeout: 180000,
    input: JSON.stringify({ api, key: status.SERVICE_ROLE_KEY, userId: id, multiple }),
  });
  const proof = JSON.parse(result.split('\n').at(-1));
  assert.equal(proof.passed, true);assert.equal(proof.multiple, multiple);
  return proof;
}

try {
  await step('docker', async () => {
    if (env.DOCKER_HOST) localDockerEndpoint(env.DOCKER_HOST);
    localDockerEndpoint(await run('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { env, timeout: 15000 }));
    evidence.tools = { node: process.versions.node, docker: await run('docker', ['info', '--format', '{{.ServerVersion}}'], { env, timeout: 20000 }), supabase: cliVersion };
    const containers = await run('docker', ['ps', '-a', '--format', '{{.Names}}'], { env, timeout: 15000 });
    assert.ok(!containers.split('\n').some(name => name.endsWith('_' + project)), 'No se reutiliza ni detiene un stack local existente.');
  });
  const candidate = join(temp, 'candidate'), previous = join(temp, 'previous');
  await step('checkout_limpio', async () => {
    await archive(current, candidate);
    await archive(tools.release.rollbackCommit, previous);
    const candidateMigrations = await digestFiles(join(candidate, 'supabase/migrations'), n => n.endsWith('.sql'));
    const rollbackMigrations = await digestFiles(join(previous, 'supabase/migrations'), n => n.endsWith('.sql'));
    inventories = validateReleaseContract(tools.release, candidateMigrations.map(row => row.file.split('_')[0]), rollbackMigrations.map(row => row.file.split('_')[0]));
    assertSharedMigrationHashes(candidateMigrations, rollbackMigrations);
    await prepareLocal(candidate, work);
    await writeFile(join(temp, 'synthetic.env'), 'META_APP_SECRET=' + metaSecret + '\nWHATSAPP_WORKER_SECRET=' + workerSecret + '\nWHATSAPP_VERIFY_TOKEN=synthetic-verify\n', { mode: 0o600 });
  });
  await step('lectores_de_borradores_incompletos', async () => {
    // Ambos lectores se ejecutan sin transporte ni credenciales, no solo se compilan.
    const probe = "import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';const {formatDraftList}=await import(pathToFileURL(process.argv[1]).href);const rows=Array.from({length:20},(_,i)=>({position:i+1,kind:'expense',description:'Concepto ficticio '.repeat(9),amount:i===0?null:999999999999.99,currency:i%2?'USD':'ARS',occurred_on:i===0?null:'2026-10-26',installments:60,first_installment_month:'2026-11',status:'pending',missing_fields:i===0?['amount','date']:['review']}));const body=formatDraftList(rows);assert.ok(body.length<=4096);assert.ok(body.includes('importe pendiente'));assert.ok(body.includes('20.'));assert.ok(!body.includes('$ 0'));assert.equal(rows[0].amount,null);";
    for (const directory of [candidate, previous]) await run(process.execPath, ['--input-type=module', '-e', probe, join(directory, 'supabase/functions/whatsapp-webhook/draft-summary.ts')], { cwd: directory, env });
  });
  await step('corte_ia_en_candidato_y_rollback', async () => {
    // Ejecutar el gate real de ambos commits; no bastan compilar ni comprobar Auth.
    const probe = "import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';const {createAiQuotaGate,AiQuotaExceeded}=await import(pathToFileURL(process.argv[1]).href);let reservations=0;const gate=createAiQuotaGate({token:'lease',rpc:async(name,args)=>{assert.equal(name,'reserve_whatsapp_ai_quota');assert.equal(args.p_id,'fixture');assert.equal(args.p_attempt,1);reservations++;return{allowed:false,reason:'exhausted'};}},{id:'fixture',attempts:1});await assert.rejects(gate('qwen'),AiQuotaExceeded);assert.equal(reservations,1);";
    for (const directory of [candidate, previous]) await run(process.execPath, ['--input-type=module', '-e', probe, join(directory, 'supabase/functions/whatsapp-webhook/ai-quota.ts')], { cwd: directory, env });
  });
  await step('rollback_sobre_minimo_exacto', async () => {
    // Primer stack independiente: solo el esquema distribuido por el rollback.
    activeWork = join(temp, 'rollback-floor');
    await prepareLocal(previous, activeWork);
    stackAttempted = true;
    await cli(['start', '--exclude', 'studio,imgproxy,storage-api,logflare,vector,supavisor']);
    await installedSchema(inventories.rollback);
    const status = JSON.parse(await cli(['status', '-o', 'json']));
    const api = localUrl(status.API_URL);
    assert.ok(status.ANON_KEY && status.SERVICE_ROLE_KEY);
    const id = await seedRuntimeUser(api, status);
    await smokeBusinessContract(sql, id);
    await startWorker(api);await smokeWorker(api);
    await smokeQuotaSql(id);await smokeDraftEditSql(id);await smokeWaitingRecoverySql(id);
    await buildAndSmoke(previous, tools.release.rollbackCommit, api, status.ANON_KEY);
    const runtime = await runtimeProbe(previous, api, status, id, false);
    await quietQueue();
    await stopWorker();
    await cli(['stop', '--no-backup'], 60000);
    stackAttempted = false;
    evidence.matrix.push({ schemaHead: tools.release.rollbackMinimumMigration, runtimeCommit: tools.release.rollbackCommit, passed: true, runtime });
    activeWork = work;
  });
  await step('instalacion_completa', async () => {
    assert.equal(await cli(['--version']), cliVersion);
    stackAttempted = true;
    await cli(['start', '--exclude', 'studio,imgproxy,storage-api,logflare,vector,supavisor']);
    const versions = JSON.parse(await sql('select json_agg(version order by version) from supabase_migrations.schema_migrations;'));
    const expected = (await digestFiles(join(candidate, 'supabase/migrations'), n => n.endsWith('.sql'))).map(f => f.file.split('_')[0]);
    assert.deepEqual(versions, [...expected, '99999999999999']);
    assertSchemaCoverage(versions, inventories.candidate);
    assertSchemaCoverage(versions, inventories.rollback);
    evidence.migrationCount = expected.length;
    evidence.tools.postgres = await sql('show server_version;');
    assert.equal(await sql('select not enabled from public.whatsapp_queue_control;'), 't');
    assert.equal(await sql("select count(*) from cron.job where jobname in ('pesito-whatsapp-queue-recovery','pesito-whatsapp-observability','pesito-whatsapp-retention');"), '0');
  });
  const status = JSON.parse(await cli(['status', '-o', 'json']));
  const api = localUrl(status.API_URL);
  assert.ok(status.ANON_KEY && status.SERVICE_ROLE_KEY, 'Faltan credenciales exclusivamente locales.');
  const id = await step('auth_sql_y_datos_sinteticos', () => seedRuntimeUser(api, status));
  await step('registro_auth_atomico_y_reintento', async () => {
    // API real del stack local, sin SMTP externo ni credenciales productivas.
    const email='be13-signup@example.invalid';
    const authSnapshot=await sql('select count(*) from auth.users;');
    const invitation=await sql("select json_agg(c order by id) from public.invitation_codes c;");
    await sql("insert into public.invitation_codes(code,duration_days)values('BE13-AUTH',30);create function public.be13_signup_fault()returns trigger language plpgsql as $$begin raise exception 'PRIVATE_BE13_CANARY';end$$;create trigger be13_signup_fault before insert on public.categories for each row execute function public.be13_signup_fault();");
    const signup=()=>request(api,'/auth/v1/signup',{key:status.ANON_KEY,body:{email,password:syntheticPassword,data:{invitation_code:'BE13-AUTH',first_name:'Alta',last_name:'Ficticia',role:'admin'}}});
    try {
      const failed=await signup();assert.equal(failed.status,500);const failure=JSON.stringify(await failed.json());
      assert.ok(!failure.includes('PRIVATE_BE13_CANARY'));assert.equal(await sql('select count(*) from auth.users;'),authSnapshot);
      assert.equal(await sql("select is_used from public.invitation_codes where code='BE13-AUTH';"),'f');
    } finally { await sql('drop trigger be13_signup_fault on public.categories;drop function public.be13_signup_fault();'); }
    const created=await signup();assert.equal(created.status,200);const account=await created.json();assert.ok(account.user?.id && account.access_token);
    const uid=account.user.id;assert.match(uid,/^[a-f0-9-]{36}$/);
    assert.equal(await sql("select count(*) from public.profiles where id='"+uid+"' and role='client' and subscription_status='active' and first_name='Alta' and last_name='Ficticia';"),'1');
    assert.equal(await sql("select count(*) from public.app_settings where user_id='"+uid+"';"),'1');
    assert.equal(await sql("select count(*) from public.whatsapp_links where user_id='"+uid+"';"),'1');
    assert.equal(await sql("select count(*) from public.categories where user_id='"+uid+"';"),'16');
    const stale=await request(api,'/auth/v1/signup',{key:status.ANON_KEY,body:{email:'be13-other@example.invalid',password:syntheticPassword,data:{invitation_code:'BE13-AUTH'}}});
    assert.equal(stale.status,500);await stale.body?.cancel();
    assert.equal(await sql("select count(*) from auth.users where email='be13-other@example.invalid';"),'0');
    const duplicate=await signup();assert.ok([200,400,422].includes(duplicate.status));await duplicate.body?.cancel();
    assert.equal(await sql("select count(*) from auth.users where email='"+email+"';"),'1');
    assert.equal(await sql("select used_by from public.invitation_codes where code='BE13-AUTH';"),uid);
    await sql("delete from auth.users where id='"+uid+"';delete from public.invitation_codes where code='BE13-AUTH';");
    assert.equal(await sql('select count(*) from auth.users;'),authSnapshot);
    assert.equal(await sql('select json_agg(c order by id) from public.invitation_codes c;'),invitation);
    evidence.signup={realLocalAuth:true,atomicFailure:true,sanitizedResponse:true,retrySameCode:true,usedCodeRejected:true,oneAccount:true,metadataRoleIgnored:true};
  });
  await step('resumen_mensual_por_api_sin_truncar', async () => {
    // El límite 1000 es exclusivamente del stack local, fijado en ops/local/config.toml.
    await sql("insert into public.transactions(user_id,kind,description,amount_ars,currency,occurred_on,status,source) select '" + id + "','expense','BE09 local bulk',0.01,'ARS','2024-02-29','confirmed','pwa' from generate_series(1,1501);insert into public.transactions(user_id,kind,description,amount_ars,currency,occurred_on,status,source) values('"+id+"','expense','BE09 local USD',1.01,'USD','2024-02-15','confirmed','pwa'),('"+id+"','income','BE09 local USD',2.02,'USD','2024-02-15','confirmed','pwa');insert into public.budgets(user_id,month,amount_ars)values('"+id+"','2024-02-01',100);");
    try {
      const raw=await request(api,'/rest/v1/transactions?select=id&user_id=eq.'+id+'&status=eq.confirmed&currency=eq.ARS&occurred_on=gte.2024-02-01&occurred_on=lt.2024-03-01',{key:status.SERVICE_ROLE_KEY,headers:{Prefer:'count=exact'}});
      assert.ok([200,206].includes(raw.status));assert.equal((await raw.json()).length,1000);assert.equal(raw.headers.get('content-range'),'0-999/1501');
      const result=await request(api,'/rest/v1/rpc/whatsapp_monthly_summary',{key:status.SERVICE_ROLE_KEY,body:{p_user_id:id,p_month:'2024-02-15'}});assert.equal(result.status,200);const summary=await result.json();
      assert.equal(summary.month,'2024-02');assert.equal(summary.remaining_budget_ars,'84.99');assert.deepEqual(summary.currencies,[{currency:'ARS',expenses:'15.01',income:'0',balance:'-15.01',operations:'1501'},{currency:'USD',expenses:'1.01',income:'2.02',balance:'1.01',operations:'2'}]);
      const login=await request(api,'/auth/v1/token?grant_type=password',{key:status.ANON_KEY,body:{email:'inf10@example.invalid',password:syntheticPassword}});assert.equal(login.status,200);const session=await login.json();assert.equal(typeof session.access_token,'string');
      for(const headers of [{},{Authorization:'Bearer '+session.access_token}]){
        const denied=await request(api,'/rest/v1/rpc/whatsapp_monthly_summary',{key:status.ANON_KEY,headers,body:{p_user_id:id,p_month:'2024-02-01'}});assert.ok([401,403,404].includes(denied.status));await denied.body?.cancel();
      }
      const old=await request(api,'/rest/v1/rpc/monthly_summary',{key:status.ANON_KEY,headers:{Authorization:'Bearer '+session.access_token},body:{target_month:'2024-02-15'}});assert.equal(old.status,200);assert.deepEqual(await old.json(),[{expenses:15.01,income:0,balance:-15.01}]);
      evidence.monthlySummary={configuredLocalRowCap:1000,underlyingArsRows:1501,untruncatedAggregate:true,legacyArsOnly:true,clientBackendRpcDenied:true};
    } finally {
      await sql("delete from public.transactions where user_id='"+id+"' and description in('BE09 local bulk','BE09 local USD');delete from public.budgets where user_id='"+id+"' and month='2024-02-01';");
    }
  });
  await step('retencion_aislada_con_finanzas_preservadas', async () => { await smokeRetentionSql(id); });
  await step('candidato_webhook_y_pwa', async () => {
    await startWorker(api);
    await smokeWorker(api);
    await smokeQuotaSql(id);
    await smokeDraftEditSql(id);
    await smokeWaitingRecoverySql(id);
    await smokeBusinessContract(sql, id);
    await buildAndSmoke(candidate, current, api, status.ANON_KEY);
    const runtime = await runtimeProbe(candidate, api, status, id, true);
    await quietQueue();
    evidence.matrix.push({ schemaHead: tools.release.minimumMigration, runtimeCommit: current, passed: true, runtime });
  });
  await step('rollback_compatible_sin_restaurar_datos', async () => {
    await quietQueue();
    await stopWorker();
    // Borrar solo la función generada en nuestro directorio temporal, nunca el checkout.
    const target = resolve(work, 'supabase/functions/whatsapp-webhook');
    assert.ok(target.startsWith(resolve(temp) + sep));
    await rm(target, { recursive: true, force: true });
    await cp(join(previous, 'supabase/functions/whatsapp-webhook'), target, { recursive: true });
    await startWorker(api);
    await smokeWorker(api);
    await smokeQuotaSql(id);
    await smokeDraftEditSql(id);
    await smokeWaitingRecoverySql(id);
    await smokeBusinessContract(sql, id);
    await buildAndSmoke(previous, tools.release.rollbackCommit, api, status.ANON_KEY);
    const runtime = await runtimeProbe(previous, api, status, id, false);
    await quietQueue();
    evidence.matrix.push({ schemaHead: tools.release.minimumMigration, runtimeCommit: tools.release.rollbackCommit, passed: true, runtime });
    assert.equal(await sql("select count(*) from public.transactions where user_id='" + id + "' and amount_ars=100 and status='confirmed';"), '1');
    assert.equal(await sql('select count(*) from public.whatsapp_message_queue;'), '0');
    const versions = JSON.parse(await sql('select json_agg(version order by version) from supabase_migrations.schema_migrations;'));
    assertSchemaCoverage(versions, inventories.candidate);
    assertSchemaCoverage(versions, inventories.rollback);
  });
  assertReleaseMatrix(evidence.matrix, current, tools.release);
  evidence.completedAt = new Date().toISOString();
  evidence.externalMessages = 0;
  evidence.databaseRestore = false;

} catch {
  console.error(JSON.stringify({ phase, passed: false, reason: 'Consultar requisitos/herramientas del runbook; se omiten credenciales y logs crudos.' }));
  process.exitCode = 1;
} finally {
  try { await stopWorker(); } catch { process.exitCode = 1; console.error('No se pudo detener el worker local propio.'); }
  if (stackAttempted) {
    try { await cli(['stop', '--no-backup'], 60000); }
    catch { console.error('No se pudo detener el stack local pesito-rehearsal; revisar antes de repetir.'); process.exitCode = 1; }
  }
  if (evidence.completedAt && process.exitCode !== 1) {
    evidence.cleanupPassed = true;
    await mkdir(join(root, '.temp'), { recursive: true });
    await writeFile(join(root, '.temp/release-rehearsal.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
  // Conservar directorio temporal fuera del repo para diagnóstico privado; no publicar status ni synthetic.env.
}
