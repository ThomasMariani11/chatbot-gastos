import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function run(command, args, { cwd, env = process.env, input, timeout = 120000, background = false } = {}) {
  const child = spawn(command, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  // Los comandos locales pueden devolver claves: jamás volcar stderr/stdout al fallar.
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', () => {});
  const completion = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { void stop(child); reject(new Error('Comando excedió el tiempo permitido.')); }, timeout);
    child.once('error', () => { clearTimeout(timer); reject(new Error('No se pudo iniciar la herramienta requerida.')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error('Herramienta falló (código ' + code + '); no se imprimen credenciales ni logs crudos.'));
    });
  });
  child.stdin.end(input);
  if (background) { completion.catch(() => {}); return child; }
  return completion;
}

export async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  if (process.platform === 'win32') {
    await run('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 15000 }).catch(() => {});
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
}

export async function digestFiles(directory, filter = () => true) {
  const entries = (await readdir(directory, { withFileTypes: true })).filter(e => e.isFile() && filter(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(entries.map(async entry => ({ file: entry.name, sha256: createHash('sha256').update(await readFile(join(directory, entry.name))).digest('hex') })));
}

// Política conservadora del paquete: todo SQL distribuido exige revisar el mínimo.
// El inventario no prueba compatibilidad funcional; esa evidencia viene del ensayo.
export function migrationVersions(versions) {
  if (!Array.isArray(versions) || versions.length === 0 ||
      versions.some(v => typeof v !== 'string' || v.length !== 3 || !/^\d{3}$/.test(v))) {
    throw new Error('Inventario de migraciones inválido.');
  }
  const sorted = [...versions].sort();
  if (sorted.some((v, i) => v !== String(i + 1).padStart(3, '0'))) {
    throw new Error('Inventario con migraciones duplicadas o faltantes.');
  }
  return sorted;
}

export function validateReleaseContract(contract, candidateVersions, rollbackVersions) {
  const candidate = migrationVersions(candidateVersions), rollback = migrationVersions(rollbackVersions);
  if (!contract || typeof contract.rollbackCommit !== 'string' || contract.rollbackCommit.length !== 40 || !/^[a-f0-9]{40}$/.test(contract.rollbackCommit)) {
    throw new Error('Se requiere un SHA completo de rollback.');
  }
  if (contract.minimumMigration !== candidate.at(-1)) {
    throw new Error('El mínimo del candidato no coincide con su snapshot.');
  }
  if (contract.rollbackMinimumMigration !== rollback.at(-1)) {
    throw new Error('El mínimo de rollback no coincide con su snapshot.');
  }
  if (rollback.length > candidate.length) throw new Error('El rollback exige un esquema posterior al candidato.');
  return { candidate, rollback };
}

export function assertSharedMigrationHashes(candidate, rollback) {
  const valid = rows => Array.isArray(rows) && rows.length > 0 && rows.every(row =>
    row && typeof row.file === 'string' && /^\d{3}_[^/\\\r\n]+\.sql$/.test(row.file) && typeof row.sha256 === 'string' && row.sha256.length === 64 && /^[a-f0-9]{64}$/.test(row.sha256));
  if (!valid(candidate) || !valid(rollback)) throw new Error('Inventario de hashes inválido.');
  migrationVersions(candidate.map(row => row.file.slice(0, 3)));
  migrationVersions(rollback.map(row => row.file.slice(0, 3)));
  const byName = new Map(candidate.map(row => [row.file, row.sha256]));
  if (rollback.some(row => byName.get(row.file) !== row.sha256)) {
    throw new Error('El SQL compartido con el rollback cambió o falta.');
  }
}

export function assertSchemaCoverage(applied, requiredVersions) {
  const required = migrationVersions(requiredVersions);
  if (!Array.isArray(applied) || applied.some(v => typeof v !== 'string' || !/^\d+$/.test(v)) ||
      new Set(applied).size !== applied.length || required.some(v => !applied.includes(v))) {
    throw new Error('El esquema no cubre todas las migraciones requeridas por el runtime.');
  }
}

export function assertReleaseMatrix(rows, sourceCommit, contract) {
  const expected = [
    [contract.rollbackMinimumMigration, contract.rollbackCommit],
    [contract.minimumMigration, sourceCommit],
    [contract.minimumMigration, contract.rollbackCommit],
  ];
  if (!Array.isArray(rows) || rows.length !== expected.length ||
      rows.some((row, i) => row?.schemaHead !== expected[i][0] || row.runtimeCommit !== expected[i][1] || row.passed !== true)) {
    throw new Error('La matriz de compatibilidad está incompleta o no coincide con los runtimes.');
  }
}

export function localUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Este ensayo solo admite loopback.');
  return url.origin;
}

export function localDockerEndpoint(value) {
  if (!/^(unix|npipe):\/\//.test(value)) throw new Error('El ensayo requiere un motor Docker local mediante socket o named pipe.');
  return value;
}

export function localEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !/^(SUPABASE_|VITE_|GEMINI_|GROQ_|WHATSAPP_|META_|PG)/i.test(key)));
}

export async function stampDistribution(directory, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Se requiere un commit Git completo.');
  const file = join(directory, 'sw.js');
  const source = await readFile(file, 'utf8');
  if (!source.includes('__BUILD_VERSION__')) throw new Error('El service worker ya fue identificado o cambió su contrato.');
  await writeFile(file, source.replaceAll('__BUILD_VERSION__', commit));
  await writeFile(join(directory, 'version.json'), JSON.stringify({ version: commit }) + '\n');
}
