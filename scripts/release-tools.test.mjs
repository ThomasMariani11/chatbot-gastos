import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { localUrl, localDockerEndpoint, localEnvironment, stampDistribution, run, migrationVersions, validateReleaseContract, assertSharedMigrationHashes, assertSchemaCoverage, assertReleaseMatrix, digestFiles } from './release-tools.mjs';
import { prepareLocal } from './prepare-local.mjs';

test('el ensayo rechaza todo destino remoto y URLs con credenciales', () => {
  assert.equal(localUrl('http://127.0.0.1:54321'), 'http://127.0.0.1:54321');
  for (const value of ['https://project.supabase.co', 'http://127.0.0.1.evil.invalid:54321', 'http://user@localhost:54321', 'http://localhost:54321/?secret=x']) {
    assert.throws(() => localUrl(value));
  }
});
test('no hereda secretos ni variables públicas del entorno del operador', () => {
  assert.deepEqual(localEnvironment({ PATH: 'safe-path', SUPABASE_ACCESS_TOKEN: 'canary', META_APP_SECRET: 'canary', VITE_SUPABASE_URL: 'canary', GEMINI_API_KEY: 'canary', GROQ_API_KEY: 'canary', PGPASSWORD: 'canary', WHATSAPP_ACCESS_TOKEN: 'canary' }), { PATH: 'safe-path' });
});
test('un comando fallido no imprime su respuesta ni stderr', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'console.error("PRIVATE_CANARY"); console.log("PRIVATE_CANARY"); process.exit(1)']), error => !error.message.includes('PRIVATE_CANARY'));
});
test('versionar PWA exige SHA y cambia juntos SW y version.json', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pesito-release-guard-'));
  try {
    await writeFile(join(directory, 'sw.js'), "const v='__BUILD_VERSION__';");
    await assert.rejects(stampDistribution(directory, 'main'));
    const sha = 'a'.repeat(40);
    await stampDistribution(directory, sha);
    assert.ok((await readFile(join(directory, 'sw.js'), 'utf8')).includes(sha));
    assert.equal(JSON.parse(await readFile(join(directory, 'version.json'), 'utf8')).version, sha);
    await assert.rejects(stampDistribution(directory, sha));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('preparar local no sobrescribe un entorno ni el config de producción', async () => {
  const root = resolve(import.meta.dirname, '..'), directory = await mkdtemp(join(tmpdir(), 'pesito-release-guard-'));
  try {
    await assert.rejects(prepareLocal(root, root));
    await mkdir(join(directory, 'supabase'));
    await writeFile(join(directory, 'supabase/config.toml'), 'do-not-overwrite');
    await assert.rejects(prepareLocal(root, directory), /ya existe/);
    assert.equal(await readFile(join(directory, 'supabase/config.toml'), 'utf8'), 'do-not-overwrite');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('el motor Docker debe ser local; rechaza contextos TCP o SSH remotos', () => {
  assert.equal(localDockerEndpoint('unix:///var/run/docker.sock'), 'unix:///var/run/docker.sock');
  assert.ok(localDockerEndpoint('npipe:////./pipe/dockerDesktopLinuxEngine'));
  for (const endpoint of ['ssh://server', 'tcp://server:2376', 'tcp://127.0.0.1:2375']) assert.throws(() => localDockerEndpoint(endpoint));
});

const migrationRange = count => Array.from({ length: count }, (_, i) => String(i + 1).padStart(3, '0'));
const contract = { minimumMigration: '043', rollbackCommit: '7dd418e367a797e8406c6cfe1acedeeba22c5258', rollbackMinimumMigration: '042' };

test('el contrato exige los mínimos exactos de candidato y rollback', () => {
  assert.deepEqual(validateReleaseContract(contract, migrationRange(43), migrationRange(42)), { candidate: migrationRange(43), rollback: migrationRange(42) });
  for (const minimumMigration of ['039', '041', '042', 43, null]) {
    assert.throws(() => validateReleaseContract({ ...contract, minimumMigration }, migrationRange(43), migrationRange(42)));
  }
  for (const rollbackMinimumMigration of ['038', '040', '041', null]) {
    assert.throws(() => validateReleaseContract({ ...contract, rollbackMinimumMigration }, migrationRange(43), migrationRange(42)));
  }
});

test('rechaza rollback no fijado y mínimos con inventario posterior al candidato', () => {
  for (const rollbackCommit of ['main', 'a'.repeat(39), 'a'.repeat(40) + '\n', null, {}, 'A'.repeat(40)]) {
    assert.throws(() => validateReleaseContract({ ...contract, rollbackCommit }, migrationRange(43), migrationRange(42)));
  }
  assert.throws(() => validateReleaseContract({ ...contract, rollbackMinimumMigration: '044' }, migrationRange(43), migrationRange(44)));
});

test('rechaza huecos, duplicados y versiones inválidas sin modificar el inventario', () => {
  for (const versions of [[], null, ['000'], ['001', '001'], ['1'], ['001', '003'], ['001', 2], ['001', '002\n']]) {
    assert.throws(() => migrationVersions(versions));
  }
  const input = ['002', '001'];
  assert.deepEqual(migrationVersions(input), ['001', '002']);
  assert.deepEqual(input, ['002', '001']);
});

test('042 no habilita el candidato 043 y una fila final no sustituye el historial completo', () => {
  assert.throws(() => assertSchemaCoverage(migrationRange(42), migrationRange(43)));
  assert.throws(() => assertSchemaCoverage(['043'], migrationRange(43)));
  assert.throws(() => assertSchemaCoverage(migrationRange(43).filter(v => v !== '040'), migrationRange(43)));
  assert.throws(() => assertSchemaCoverage([...migrationRange(43), '041'], migrationRange(42)));
  assert.doesNotThrow(() => assertSchemaCoverage(migrationRange(42), migrationRange(42)));
  assert.doesNotThrow(() => assertSchemaCoverage([...migrationRange(43), '99999999999999'], migrationRange(42)));
});

test('no se acepta SQL compartido alterado ni renombrado para el rollback', () => {
  const a = { file: '001_fixture.sql', sha256: 'a'.repeat(64) };
  const b = { file: '002_fixture.sql', sha256: 'b'.repeat(64) };
  assert.doesNotThrow(() => assertSharedMigrationHashes([a, b], [a]));
  assert.throws(() => assertSharedMigrationHashes([a, b], [{ ...a, sha256: 'c'.repeat(64) }]));
  assert.throws(() => assertSharedMigrationHashes([a, b], [{ ...a, file: '001_renamed.sql' }]));
  assert.throws(() => assertSharedMigrationHashes([a, a], [a]));
  assert.throws(() => assertSharedMigrationHashes([a], [{ ...a, sha256: null }]));
});

test('la configuración real cubre las migraciones distribuidas y fija el rollback revisado', async () => {
  const root = resolve(import.meta.dirname, '..');
  const configured = JSON.parse(await readFile(join(root, 'config/environments.json'), 'utf8')).release;
  const files = await digestFiles(join(root, 'supabase/migrations'), n => n.endsWith('.sql'));
  assert.equal(configured.rollbackCommit, contract.rollbackCommit);
  assert.equal(configured.rollbackMinimumMigration, contract.rollbackMinimumMigration);
  assert.doesNotThrow(() => validateReleaseContract(configured, files.map(row => row.file.split('_')[0]), migrationRange(42)));
});

test('no se declara compatibilidad si falta una fila o el runtime/esquema no coincide', () => {
  const source = 'a'.repeat(40);
  const rows = [
    { schemaHead: '042', runtimeCommit: contract.rollbackCommit, passed: true },
    { schemaHead: '043', runtimeCommit: source, passed: true },
    { schemaHead: '043', runtimeCommit: contract.rollbackCommit, passed: true },
  ];
  assert.doesNotThrow(() => assertReleaseMatrix(rows, source, contract));
  assert.throws(() => assertReleaseMatrix(rows.slice(1), source, contract));
  assert.throws(() => assertReleaseMatrix(rows.map((r, i) => i === 0 ? { ...r, schemaHead: '043' } : r), source, contract));
  assert.throws(() => assertReleaseMatrix(rows.map((r, i) => i === 2 ? { ...r, passed: false } : r), source, contract));
  assert.throws(() => assertReleaseMatrix(rows.map((r, i) => i === 2 ? { ...r, runtimeCommit: source } : r), source, contract));
});

test('el probe de runtime rechaza una API remota antes de usar credenciales', async () => {
  const root = resolve(import.meta.dirname, '..');
  await assert.rejects(run(process.execPath, [join(root, 'scripts/release-runtime-probe.mjs'), root], {
    env: localEnvironment(), input: JSON.stringify({ api: 'https://remote.invalid', key: 'PRIVATE_CANARY', userId: '50000000-0000-4000-8000-000000000001' }),
  }), error => !error.message.includes('PRIVATE_CANARY'));
});
