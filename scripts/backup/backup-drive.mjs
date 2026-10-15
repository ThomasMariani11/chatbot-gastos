import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMITS = Object.freeze({ exportBytes: 2 * 1024 * 1024, driveFolderBytes: 256 * 1024 * 1024, driveReserveBytes: 256 * 1024 * 1024 });
export const POSTGRES_IMAGE = 'postgres:17-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826';
const project = 'ystyatotldslfmucvgsq';
const fakeUrl = 'postgresql://postgres:synthetic@127.0.0.1:6543/postgres';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };

export function makeDumpScript(source, includeHistory = false) {
  if (!source.startsWith('#!/usr/bin/env bash\n')) fail('BACKUP_UNEXPECTED_DUMP_SCRIPT');
  const variables = [...source.matchAll(/^export (PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)=.*$/gm)].map(m => m[1]);
  if (variables.length !== 5 || new Set(variables).size !== 5) fail('BACKUP_UNEXPECTED_PG_EXPORTS');
  let result = source.replace(/^export (PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)=.*\n/gm, '');
  if (includeHistory) {
    if ((result.match(/\|supabase_migrations/g) ?? []).length !== 1) fail('BACKUP_UNEXPECTED_HISTORY_FILTER');
    result = result.replace('|supabase_migrations', '');
  }
  return result;
}

export function assertSource(env) {
  const direct = env.PGHOST === `db.${project}.supabase.co` && env.PGUSER === 'postgres';
  const pooled = /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(env.PGHOST ?? '') && env.PGUSER === `postgres.${project}`;
  if ((!direct && !pooled) || env.PGPORT !== '5432' || env.PGDATABASE !== 'postgres' || !env.PGPASSWORD) fail('BACKUP_INVALID_SOURCE');
}

export function assertDriveConfig(text, folderId) {
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(folderId ?? '')) fail('BACKUP_INVALID_DRIVE_FOLDER');
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#') && !s.startsWith(';'));
  const sections = lines.filter(s => s.startsWith('['));
  if (sections.length !== 1 || sections[0] !== '[backupdrive]') fail('BACKUP_INVALID_DRIVE_CONFIG');
  const pairs = lines.slice(1).map(s => { const p = s.indexOf('='); if (p < 1) fail('BACKUP_INVALID_DRIVE_CONFIG'); return [s.slice(0, p).trim(), s.slice(p + 1).trim()]; });
  if (new Set(pairs.map(([key]) => key)).size !== pairs.length) fail('BACKUP_INVALID_DRIVE_CONFIG');
  const fields = Object.fromEntries(pairs);
  if (fields.type !== 'drive' || fields.root_folder_id !== folderId || !fields.token) fail('BACKUP_INVALID_DRIVE_CONFIG');
  // A root folder is a path restriction, not a restriction of the OAuth grant.
  if (fields.scope !== 'drive.file' || !/\.apps\.googleusercontent\.com$/.test(fields.client_id ?? '') || !fields.client_secret) fail('BACKUP_INVALID_DRIVE_SCOPE');
  if (fields.service_account_file || fields.service_account_credentials || fields.team_drive || fields.shared_with_me === 'true') fail('BACKUP_INVALID_DRIVE_CONFIG');
  try { if (!JSON.parse(fields.token).refresh_token) fail('BACKUP_INVALID_DRIVE_CONFIG'); } catch { fail('BACKUP_INVALID_DRIVE_CONFIG'); }
}

export function assertCapacity(quota, objects) {
  if (!Number.isSafeInteger(quota.free) || quota.free < LIMITS.driveReserveBytes) fail('BACKUP_DRIVE_FREE_SPACE');
  if (!Array.isArray(objects)) fail('BACKUP_INVALID_DRIVE_LIST');
  let used = 0;
  for (const object of objects) {
    if (object.IsDir || !Number.isSafeInteger(object.Size) || object.Size < 0) fail('BACKUP_INVALID_DRIVE_LIST');
    used += object.Size;
  }
  if (used + LIMITS.exportBytes >= LIMITS.driveFolderBytes) fail('BACKUP_DRIVE_BUDGET');
}

export function copyCounts(sql) {
  const counts = {};
  let table = null;
  for (const line of sql.split('\n')) {
    if (table !== null) {
      if (line === '\\.') table = null;
      else counts[table] += 1;
    } else if (line.startsWith('COPY ')) {
      const match = /^COPY "([a-zA-Z0-9_]+)"\."([a-zA-Z0-9_]+)" \(.+\) FROM stdin;$/.exec(line);
      if (!match) fail('BACKUP_UNSUPPORTED_COPY_HEADER');
      table = `${match[1]}.${match[2]}`;
      if (Object.hasOwn(counts, table)) fail('BACKUP_DUPLICATE_COPY_TABLE');
      counts[table] = 0;
    }
  }
  if (table !== null) fail('BACKUP_INCOMPLETE_COPY');
  for (const required of ['public.transactions', 'public.profiles', 'public.draft_groups', 'public.draft_items', 'public.whatsapp_message_queue', 'public.whatsapp_links', 'public.inbound_events', 'public.categories', 'public.budgets', 'public.app_settings', 'public.invitation_codes', 'public.system_config', 'auth.users', 'storage.objects', 'supabase_migrations.schema_migrations']) {
    if (!Object.hasOwn(counts, required)) fail('BACKUP_MISSING_REQUIRED_TABLE');
  }
  if (counts['storage.objects'] !== 0) fail('BACKUP_UNSUPPORTED_SOURCE_COVERAGE');
  return counts;
}

export function buildManifest(folder, snapshotNotBefore) {
  const entries = readdirSync(folder).sort();
  if (entries.reduce((sum,name) => sum + statSync(join(folder,name)).size,0) > LIMITS.exportBytes) fail('BACKUP_EXPORT_BUDGET');
  for (const required of ['roles.sql','schema.sql','history_schema.sql','auth_catalog.sql','storage_catalog.sql','data.sql','coverage.json']) {
    if (!entries.includes(required)) fail('BACKUP_MISSING_PAYLOAD_FILE');
  }
  const files = entries.map(name => {
    if (!/^[a-z0-9_-]+\.(sql|json)$/.test(name)) fail('BACKUP_UNEXPECTED_PAYLOAD_FILE');
    const path = join(folder, name);
    if (!statSync(path).isFile()) fail('BACKUP_UNEXPECTED_PAYLOAD_FILE');
    const bytes = readFileSync(path);
    return { name, bytes: bytes.length, sha256: digest(bytes) };
  });
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (!bytes || bytes > LIMITS.exportBytes) fail('BACKUP_EXPORT_BUDGET');
  return { format: 1, project, snapshot_not_before_utc: snapshotNotBefore, completed_at_utc: new Date().toISOString(), postgres_image: POSTGRES_IMAGE, source_cli: '2.120.0', files, bytes, copy_table_counts: copyCounts(readFileSync(join(folder, 'data.sql'), 'utf8')), coverage: { storage_bytes: false, edge_secret_values: false, auth_configuration: false, vault_keys: false, auth_storage_catalogs_require_review_before_restore: true }, restore_verified: false };
}

function main() {
  const env = process.env;
  if (env.PESITO_BACKUP_ENABLED !== 'true') fail('BACKUP_DISABLED');
  assertSource(env);
  assertDriveConfig(env.PESITO_BACKUP_RCLONE_CONFIG ?? '', env.PESITO_BACKUP_DRIVE_FOLDER);
  if (!env.PESITO_BACKUP_DB_CA_PEM?.includes('BEGIN CERTIFICATE')) fail('BACKUP_TLS_CA_REQUIRED');
  if (!env.PESITO_BACKUP_PUBLIC_KEY?.includes('BEGIN PGP PUBLIC KEY BLOCK') || env.PESITO_BACKUP_PUBLIC_KEY.includes('PRIVATE KEY')) fail('BACKUP_PUBLIC_KEY_REQUIRED');
  if (!/^[A-F0-9]{40}$/.test(env.PESITO_BACKUP_KEY_FINGERPRINT ?? '')) fail('BACKUP_FINGERPRINT_REQUIRED');
  if (env.PESITO_BACKUP_FREE_LIMITS_VERIFIED !== 'true') fail('BACKUP_FREE_LIMITS_NOT_VERIFIED');
  const work = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'pesito-backup-'));
  chmodSync(work, 0o700);
  const started = Date.now();
  const payload = join(work, 'payload');
  mkdirSync(payload, { mode: 0o700 });
  const errors = join(work, 'commands.log');
  const logFd = openSync(errors, 'a', 0o600);
  const safeEnv = { ...env, RCLONE_CONFIG: join(work, 'rclone.conf'), GNUPGHOME: join(work, 'gnupg') };
  const run = (command, args, outFile = null) => {
    const outFd = outFile ? openSync(outFile, 'w', 0o600) : null;
    try {
      const result = spawnSync(command, args, { env: safeEnv, stdio: ['ignore', outFd ?? 'pipe', logFd], timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
      if (result.error || result.status !== 0) fail('BACKUP_COMMAND_FAILED');
      return result.stdout?.toString('utf8') ?? '';
    } finally { if (outFd !== null) closeSync(outFd); }
  };
  const pgRun = (args, outFile) => run('docker', ['run', '--rm', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=256m', '--cpus=1', '--pids-limit=64', '--user', `${process.getuid()}:${process.getgid()}`, '-v', `${work}:/work`, ...['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT','PGOPTIONS','PGTZ'].flatMap(key => ['-e', key]), POSTGRES_IMAGE, ...args], outFile);
  const exportSql = (name, flags, history = false) => {
    const script = makeDumpScript(run('supabase', ['db','dump','--dry-run','--db-url',fakeUrl,'--agent','yes',...flags]), history);
    const file = join(work, 'generated.sh');
    writeFileSync(file, script, { mode: 0o600 });
    if (!/^[a-z_]+\.sql$/.test(name)) fail('BACKUP_INVALID_EXPORT_NAME');
    // A regular file inside the container lets the kernel cap each export, including failures.
    pgRun(['bash','-c',`ulimit -f 2048; exec bash /work/generated.sh > /work/payload/${name}`]);
  };
  try {
    writeFileSync(safeEnv.RCLONE_CONFIG, env.PESITO_BACKUP_RCLONE_CONFIG, { mode: 0o600 });
    mkdirSync(safeEnv.GNUPGHOME, { mode: 0o700 });
    writeFileSync(join(work, 'public.asc'), env.PESITO_BACKUP_PUBLIC_KEY, { mode: 0o600 });
    writeFileSync(join(work, 'ca.pem'), env.PESITO_BACKUP_DB_CA_PEM, { mode: 0o600 });
    Object.assign(safeEnv, { PGSSLMODE: 'verify-full', PGSSLROOTCERT: '/work/ca.pem', PGCONNECT_TIMEOUT: '10', PGTZ: 'UTC', PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=90000 -c lock_timeout=5000' });
    const rclone = args => run('rclone', [...args,'--config',safeEnv.RCLONE_CONFIG,'--contimeout','10s','--timeout','60s','--retries','2','--low-level-retries','2']);
    assertCapacity(JSON.parse(rclone(['about','backupdrive:','--json'])), JSON.parse(rclone(['lsjson','backupdrive:','--files-only','--max-depth','1'])));
    run('gpg', ['--batch','--import',join(work,'public.asc')]);
    const keys = run('gpg', ['--batch','--with-colons','--fingerprint']).split('\n').filter(l => l.startsWith('fpr:')).map(l => l.split(':')[9]);
    if (!keys.includes(env.PESITO_BACKUP_KEY_FINGERPRINT)) fail('BACKUP_FINGERPRINT_MISMATCH');
    if (run('gpg',['--batch','--with-colons','--list-secret-keys']).split('\n').some(l => l.startsWith('sec:'))) fail('BACKUP_PRIVATE_KEY_IN_RUNNER');
    const preflight = "begin read only; select json_build_object('storage_objects',(select count(*) from storage.objects),'vault_secrets',(select count(*) from vault.secrets),'postgres_major',current_setting('server_version_num')::integer/10000); rollback;";
    const metadata = JSON.parse(pgRun(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',preflight]));
    if (metadata.storage_objects !== 0 || metadata.vault_secrets !== 0 || metadata.postgres_major !== 17) fail('BACKUP_UNSUPPORTED_SOURCE_COVERAGE');
    writeFileSync(join(payload,'coverage.json'), JSON.stringify(metadata), { mode: 0o600 });
    exportSql('roles.sql',['--role-only']);
    exportSql('schema.sql',[]);
    exportSql('history_schema.sql',['--schema','supabase_migrations']);
    // Catalogs preserve customizations, but are NOT blindly executed on a managed target.
    exportSql('auth_catalog.sql',['--schema','auth']);
    exportSql('storage_catalog.sql',['--schema','storage']);
    const snapshotNotBefore = new Date().toISOString();
    exportSql('data.sql',['--data-only','--use-copy'],true);
    const sourceSchema = readFileSync(join(payload,'schema.sql'));
    exportSql('schema_check.sql',[]);
    if (digest(sourceSchema) !== digest(readFileSync(join(payload,'schema_check.sql')))) fail('BACKUP_SCHEMA_CHANGED_DURING_EXPORT');
    rmSync(join(payload,'schema_check.sql'));
    const manifest = buildManifest(payload,snapshotNotBefore);
    writeFileSync(join(payload,'manifest.json'),JSON.stringify(manifest,null,2),{ mode:0o600 });
    const archive = join(work,'backup.tar.gz');
    run('tar',['-czf',archive,'-C',payload,...readdirSync(payload).sort()]);
    const cipher = join(work,'backup.tar.gz.gpg');
    run('gpg',['--batch','--yes','--trust-model','always','--recipient',env.PESITO_BACKUP_KEY_FINGERPRINT,'--output',cipher,'--encrypt',archive]);
    if (statSync(cipher).size > LIMITS.exportBytes) fail('BACKUP_EXPORT_BUDGET');
    const key = `pesito-${snapshotNotBefore.replace(/[-:.]/g,'')}-${env.GITHUB_RUN_ID || Date.now()}.tar.gz.gpg`;
    rclone(['copyto',cipher,`backupdrive:${key}`]);
    const downloaded = join(work,'downloaded.gpg');
    rclone(['copyto',`backupdrive:${key}`,downloaded]);
    if (digest(readFileSync(cipher)) !== digest(readFileSync(downloaded))) fail('BACKUP_CLOUD_ROUNDTRIP_MISMATCH');
    // No deletion: retention is not enabled before a real restore has passed.
    console.log(JSON.stringify({event:'backup_uploaded_and_read_back',bytes:statSync(cipher).size,export_bytes:manifest.bytes,tables:Object.keys(manifest.copy_table_counts).length,duration_ms:Date.now()-started,restore_verified:false}));
  } finally {
    closeSync(logFd);
    rmSync(work,{recursive:true,force:true});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(/^(BACKUP_[A-Z_]+)$/.test(error.message) ? error.message : 'BACKUP_FAILED'); process.exitCode=1; }
}
