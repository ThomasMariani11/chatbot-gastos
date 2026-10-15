import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertCapacity, assertDriveConfig, assertSource, buildManifest, copyCounts, LIMITS, makeDumpScript } from './backup-drive.mjs';

const source = { PGHOST:'aws-0-us-east-2.pooler.supabase.com', PGPORT:'5432', PGUSER:'postgres.ystyatotldslfmucvgsq', PGDATABASE:'postgres', PGPASSWORD:'synthetic' };
const dumpScript = '#!/usr/bin/env bash\nset -euo pipefail\nexport PGHOST="127.0.0.1"\nexport PGPORT="6543"\nexport PGUSER="postgres"\nexport PGPASSWORD="synthetic"\nexport PGDATABASE="postgres"\npg_dump --exclude-schema "pg_*|vault|supabase_migrations|realtime"\n';
const tables = ['public.transactions','public.profiles','public.draft_groups','public.draft_items','public.whatsapp_message_queue','public.whatsapp_links','public.inbound_events','public.categories','public.budgets','public.app_settings','public.invitation_codes','public.system_config','auth.users','storage.objects','supabase_migrations.schema_migrations'];
const data = tables.map(table => `COPY "${table.split('.')[0]}"."${table.split('.')[1]}" ("id", "value") FROM stdin;\n${table === 'storage.objects' ? '' : 'synthetic-id\tTexto\\ncon salto escapado\n'}\\.\n`).join('\n');
const folderId = 'synthetic-folder-12345';
const config = `[backupdrive]\ntype = drive\nscope = drive.file\nclient_id = synthetic.apps.googleusercontent.com\nclient_secret = synthetic\nroot_folder_id = ${folderId}\ntoken = {"refresh_token":"synthetic"}\n`;

test('Acepta únicamente origen del proyecto, conexión de sesión y contraseña presente', () => {
  assertSource(source);
  assertSource({...source,PGHOST:'db.ystyatotldslfmucvgsq.supabase.co',PGUSER:'postgres'});
  for (const patch of [{PGHOST:'localhost'},{PGHOST:'attacker.example'},{PGUSER:'postgres.otherproject'},{PGPORT:'6543'},{PGPASSWORD:''},{PGDATABASE:'other'}]) assert.throws(() => assertSource({...source,...patch}),/BACKUP_INVALID_SOURCE/);
});

test('El script ejecutable hereda credenciales; nunca ejecuta exports de la URL ficticia', () => {
  const result = makeDumpScript(dumpScript);
  assert.doesNotMatch(result,/synthetic|127\.0\.0\.1|export PG/);
  assert.match(result,/supabase_migrations/);
  const withHistory = makeDumpScript(dumpScript,true);
  assert.doesNotMatch(withHistory,/supabase_migrations/);
  assert.match(withHistory,/vault\|realtime/);
});

test('Cambios del contrato de la CLI fallan antes de exportar o omitir historia', () => {
  for (const script of [dumpScript.replace('export PGHOST','PGHOST'), dumpScript.replace('#!/usr/bin/env bash','#!/bin/sh'),dumpScript+'export PGHOST="extra"\n']) assert.throws(() => makeDumpScript(script),/BACKUP_UNEXPECTED/);
  assert.throws(() => makeDumpScript(dumpScript.replace('|supabase_migrations',''),true),/BACKUP_UNEXPECTED_HISTORY_FILTER/);
});

test('El remoto debe ser Drive, único y con una carpeta raíz explícita coincidente', () => {
  assertDriveConfig(config,folderId);
  for (const text of [config.replace('drive.file','drive.readonly'),config.replace('drive.file','drive'),config.replace('type = drive','type = s3'),config.replace(folderId,'another-folder-12345'),config+'[other]\ntype=drive\n',config+'service_account_file = /secret.json\n',config+'root_folder_id = duplicate\n',config.replace('token =','missing ='),config.replace('synthetic"}','"}')]) assert.throws(() => assertDriveConfig(text,folderId),/BACKUP_INVALID_DRIVE/);
});

test('Frena ante cuota desconocida, poco espacio, carpeta llena y tamaños inválidos', () => {
  assertCapacity({free:LIMITS.driveReserveBytes+1},[]);
  for (const quota of [{},{free:'1000000000'},{free:0}]) assert.throws(() => assertCapacity(quota,[]),/BACKUP_DRIVE_FREE_SPACE/);
  assert.throws(() => assertCapacity({free:1e9},[{Size:LIMITS.driveFolderBytes}]),/BACKUP_DRIVE_BUDGET/);
  for (const object of [{Size:-1},{Size:3,IsDir:true},{Size:NaN}]) assert.throws(() => assertCapacity({free:1e9},[object]),/BACKUP_INVALID_DRIVE_LIST/);
});

test('Cuenta filas del propio dump, incluidas Auth e historia, sin interpretar sus textos', () => {
  const counts = copyCounts(data);
  assert.equal(Object.keys(counts).length,15);
  assert.equal(counts['auth.users'],1);
  assert.equal(counts['storage.objects'],0);
  assert.equal(copyCounts(data.replaceAll('synthetic-id\tTexto\\ncon salto escapado\n',''))['auth.users'],0);
});

test('Rechaza COPY truncado, tablas duplicadas y exportaciones parciales', () => {
  assert.throws(() => copyCounts(data.slice(0,-3)),/BACKUP_INCOMPLETE_COPY/);
  assert.throws(() => copyCounts(data+data),/BACKUP_DUPLICATE_COPY_TABLE/);
  assert.throws(() => copyCounts(data.replace('"auth"."users"','"auth"."other"')),/BACKUP_MISSING_REQUIRED_TABLE/);
  assert.throws(() => copyCounts(data.replace('"storage"."objects" ("id", "value") FROM stdin;\n','"storage"."objects" ("id", "value") FROM stdin;\nnew-object\tcontent\n')),/BACKUP_UNSUPPORTED_SOURCE_COVERAGE/);
});

test('Manifiesto exige todos los componentes y limita tamaño antes de cargarlo en memoria', () => {
  const dir = mkdtempSync(join(tmpdir(),'pesito-backup-test-'));
  try {
    for (const name of ['roles.sql','schema.sql','history_schema.sql','auth_catalog.sql','storage_catalog.sql']) writeFileSync(join(dir,name),'-- synthetic\n');
    writeFileSync(join(dir,'coverage.json'),'{}');
    writeFileSync(join(dir,'data.sql'),data);
    const manifest = buildManifest(dir,'2026-10-15T00:00:00Z');
    assert.equal(manifest.files.length,7);
    assert.ok(manifest.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
    assert.equal(manifest.restore_verified,false);
    writeFileSync(join(dir,'schema.sql'),Buffer.alloc(LIMITS.exportBytes));
    assert.throws(() => buildManifest(dir,'synthetic'),/BACKUP_EXPORT_BUDGET/);
    rmSync(join(dir,'schema.sql'));
    assert.throws(() => buildManifest(dir,'synthetic'),/BACKUP_MISSING_PAYLOAD_FILE/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
