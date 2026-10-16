// Solo lectura del repo; genera metadata pública en .temp, nunca consulta cloud.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digestFiles, run } from './release-tools.mjs';

const root = resolve(import.meta.dirname, '..');
const target = process.argv[2];
if (!['local', 'production'].includes(target)) throw new Error('Uso: npm run release:manifest -- local|production');
const clean = await run('git', ['status', '--porcelain'], { cwd: root });
if (clean) throw new Error('El checkout debe estar limpio; no se genera una release de cambios sin commit.');
const commit = await run('git', ['rev-parse', 'HEAD'], { cwd: root });
const config = JSON.parse(await readFile(resolve(root, 'config/environments.json'), 'utf8'));
const manifest = {
  generatedAt: new Date().toISOString(), sourceCommit: commit, target,
  tools: { node: (await readFile(resolve(root, '.node-version'), 'utf8')).trim(), supabase: (await readFile(resolve(root, '.supabase-version'), 'utf8')).trim(), deno: '2.9.6' },
  contract: config.release,
  migrations: await digestFiles(resolve(root, 'supabase/migrations'), name => name.endsWith('.sql')),
  webhook: await digestFiles(resolve(root, 'supabase/functions/whatsapp-webhook'), name => name.endsWith('.ts') && !name.endsWith('_test.ts')),
  observedDeployment: { edgeVersion: null, migrationHead: null, ciRun: null, smokePassed: false },
};
await mkdir(resolve(root, '.temp'), { recursive: true });
await writeFile(resolve(root, '.temp/release-' + target + '.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ sourceCommit: commit, target, migrations: manifest.migrations.length, output: '.temp/release-' + target + '.json', deployed: false }));
