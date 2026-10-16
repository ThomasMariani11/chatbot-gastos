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
  return Object.fromEntries(Object.entries(source).filter(([key]) => !/^(SUPABASE_|VITE_|GEMINI_|WHATSAPP_|META_|PG)/i.test(key)));
}

export async function stampDistribution(directory, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Se requiere un commit Git completo.');
  const file = join(directory, 'sw.js');
  const source = await readFile(file, 'utf8');
  if (!source.includes('__BUILD_VERSION__')) throw new Error('El service worker ya fue identificado o cambió su contrato.');
  await writeFile(file, source.replaceAll('__BUILD_VERSION__', commit));
  await writeFile(join(directory, 'version.json'), JSON.stringify({ version: commit }) + '\n');
}
