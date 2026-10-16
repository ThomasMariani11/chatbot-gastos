import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { localUrl, localEnvironment, stampDistribution, run } from './release-tools.mjs';
import { prepareLocal } from './prepare-local.mjs';

test('el ensayo rechaza todo destino remoto y URLs con credenciales', () => {
  assert.equal(localUrl('http://127.0.0.1:54321'), 'http://127.0.0.1:54321');
  for (const value of ['https://project.supabase.co', 'http://127.0.0.1.evil.invalid:54321', 'http://user@localhost:54321', 'http://localhost:54321/?secret=x']) {
    assert.throws(() => localUrl(value));
  }
});
test('no hereda secretos ni variables públicas del entorno del operador', () => {
  assert.deepEqual(localEnvironment({ PATH: 'safe-path', SUPABASE_ACCESS_TOKEN: 'canary', META_APP_SECRET: 'canary', VITE_SUPABASE_URL: 'canary', GEMINI_API_KEY: 'canary', PGPASSWORD: 'canary', WHATSAPP_ACCESS_TOKEN: 'canary' }), { PATH: 'safe-path' });
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
