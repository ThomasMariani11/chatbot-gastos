// Tests de la barrera de Pesito. Solo usan entradas simuladas de PreToolUse y repos git
// temporales en %TEMP%: no ejecutan la CLI de Supabase ni acceden a red o producción.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, decide, evaluate, render, SELFTEST } from './guard-supabase.mjs';

const HOOK = fileURLToPath(new URL('./guard-supabase.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ctx = createContext();
const outcome = (r) => r?.decision ?? 'pass';
const run = (tool, command, cwd = ROOT, context = ctx) => outcome(evaluate({ tool_name: tool, tool_input: { command }, cwd }, context));
const bash = (command, cwd) => run('Bash', command, cwd);
const pwsh = (command, cwd) => run('PowerShell', command, cwd);

const temps = [];
test.after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

// Repo git descartable con un package.json mínimo y datos ficticios.
function makeRepo() {
  const dir = tempDir('pesito-guard-repo-');
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.invalid', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
  const write = (rel, content) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  git('init', '-q');
  write('package.json', JSON.stringify({ scripts: { test: 'vitest run', build: 'vite build' } }, null, 2));
  write('.supabase-version', '2.120.0\n');
  write('config/environments.json', JSON.stringify({ production: { projectRef: 'reffict1c10000000000' } }));
  write('tests/a.test.ts', 'export const ok = 1;\n');
  write('.gitignore', 'tests/*.local.ts\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'inicial');
  return { dir, git, write, ctx: createContext({ repoRoot: dir }) };
}
const npmTest = (repo) => outcome(evaluate({ tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: repo.dir }, repo.ctx));

test('ask: operaciones remotas de Supabase, con o sin --linked', () => {
  for (const command of [
    'npx --yes supabase@2.120.0 db push --linked',
    'npx --yes supabase@2.120.0 db push --linked --dry-run',
    'npx supabase@2.120.0 db push',
    'npx supabase@2.120.0 --workdir .temp/local db push',
    'npx --yes supabase@2.120.0 functions deploy whatsapp-webhook --project-ref reffict1c10000000000 --no-verify-jwt --use-api',
    'npx supabase@2.120.0 secrets list',
    'npx supabase@2.120.0 secrets set CLAVE=valor-ficticio',
    'npm exec --package=supabase@2.120.0 -- supabase migration list',
    'npx supabase@2.120.0 migration list --linked',
    'npx supabase@2.120.0 projects list',
    'npx supabase@2.120.0 inspect db table-sizes',
    'npx supabase@2.120.0 gen types typescript --project-id reffict1c10000000000',
    'supabase db query "select 1"',
    'pnpm dlx supabase@2.120.0 functions deploy x',
    `curl https://${ctx.prodRef}.supabase.co/rest/v1/`,
    'curl https://api.supabase.com/v1/projects',
    'psql "postgresql://postgres:ficticio@db.ejemplo.pooler.supabase.com:6543/postgres"',
    'psql -h db.ejemplo.net -U postgres',
    'node scripts/verify-sql-transport.mjs',
    'vite preview --outDir .temp/pwa-prod-check',
    'node node_modules/vite/bin/vite.js preview --outDir .temp/pwa-prod-check',
  ]) assert.equal(bash(command), 'ask', command);
});

test('deny: operaciones destructivas o que cambian el vínculo', () => {
  for (const command of [
    'npx --yes supabase@2.120.0 db reset --linked',
    'supabase db reset --linked',
    'supabase config push',
    'npx supabase@2.120.0 unlink',
    'supabase link --project-ref reffict1c10000000000',
    'supabase migration repair --status applied 046',
    'supabase migration down',
    'npx supabase@2.120.0 projects delete reffict1c10000000000',
    'npx supabase@2.120.0 secrets unset CLAVE',
    'npm test && npx supabase@2.120.0 config push',
  ]) assert.equal(bash(command), 'deny', command);
});

test('pass: CLI de Supabase local con --workdir descartable', () => {
  const work = join(tmpdir(), 'pesito-rehearsal-ficticio');
  for (const command of [
    'npx supabase@2.120.0 --workdir .temp/local status',
    'npx --yes supabase@2.120.0 --workdir .temp/local start',
    'npx supabase@2.120.0 --workdir .temp/local stop',
    'npx supabase@2.120.0 --workdir .temp/local migration list --local',
    'npx supabase@2.120.0 --workdir .temp/local db reset',
    `npm exec --yes --package=supabase@2.120.0 -- supabase --workdir "${work}" functions serve whatsapp-webhook --no-verify-jwt`,
    'npx supabase@2.120.0 --version',
  ]) assert.equal(bash(command), 'pass', command);
});

test('ask: CLI local sin workdir, con versión distinta o desde la raíz', () => {
  for (const command of [
    'npx supabase@2.120.0 status',
    'npx supabase@2.120.0 start',
    'npx supabase@2.0.0 --workdir .temp/local status',
    'npx supabase --workdir .temp/local status',
    'npx supabase@2.120.0 --workdir supabase status',
    'npx supabase@2.120.0 --workdir .temp/local migration list',
  ]) assert.equal(bash(command), 'ask', command);
});

test('ask: intérpretes, lanzadores y credenciales', () => {
  for (const command of [
    'node -e "process.exit(0)"',
    'node --eval "1"',
    'node',
    'npx otro-paquete',
    'npx vitest run',
    'npm install left-pad',
    'npm ci',
    'cmdkey /list',
    'deno run x.ts',
    'python -c "print(1)"',
    'bash -c "echo hola"',
    'pwsh -EncodedCommand ZQBjAGgAbwA=',
    './script.sh',
    'echo hola | supabase functions deploy x',
  ]) assert.equal(bash(command), 'ask', command);
  for (const command of [
    'Invoke-Expression $codigo',
    'iex (Get-Content x.ps1 -Raw)',
    'Start-Process node -ArgumentList x.mjs',
    'powershell -Command "Get-Date"',
    '[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b))',
    'Get-StoredCredential -Target supabase',
  ]) assert.equal(pwsh(command), 'ask', command);
});

test('ask: node con un script fuera de scripts/ y tests/ que llama a la CLI', () => {
  const dir = tempDir('pesito-guard-script-');
  const file = join(dir, 'tmp.mjs');
  writeFileSync(file, "import { spawnSync } from 'node:child_process';\nspawnSync('npx', ['supabase', 'db', 'push']);\n");
  const result = evaluate({ tool_name: 'Bash', tool_input: { command: `node "${file}"` }, cwd: ROOT }, ctx);
  assert.equal(result?.decision, 'ask');
  assert.match(result.reason, /CLI de Supabase|ejecución de procesos/);
});

test('ask: Edit/Write sobre configuración protegida; pass sobre código normal', () => {
  const write = (tool, file_path) => outcome(evaluate({ tool_name: tool, tool_input: { file_path }, cwd: ROOT }, ctx));
  assert.equal(write('Edit', join(ROOT, '.claude', 'settings.json')), 'ask');
  assert.equal(write('Write', '.claude/settings.local.json'), 'ask');
  assert.equal(write('Edit', '.claude/hooks/guard-supabase.mjs'), 'ask');
  assert.equal(write('Write', 'supabase/.temp/project-ref'), 'ask');
  assert.equal(write('Edit', 'supabase/config.toml'), 'ask');
  assert.equal(write('Edit', 'config/environments.json'), 'ask');
  assert.equal(write('Write', join(homedir(), '.claude', 'settings.json')), 'ask');
  assert.equal(write('Edit', 'src/App.tsx'), 'pass');
  assert.equal(write('Write', 'docs/operaciones/DEPLOY_Y_ROLLBACK.md'), 'pass');
  assert.equal(bash('echo {} > .claude/settings.json'), 'ask');
  assert.equal(bash('git checkout -- .claude/hooks/guard-supabase.mjs'), 'ask');
  assert.equal(bash('cat supabase/config.toml'), 'pass');
  assert.equal(bash('git status'), 'pass');
});

test('git: cambios sin preparar, staged, untracked e ignorados en archivos ejecutables', async (t) => {
  await t.test('repo limpio: npm test pasa sin intervención', () => {
    assert.equal(npmTest(makeRepo()), 'pass');
  });
  await t.test('modificado sin preparar', () => {
    const repo = makeRepo();
    repo.write('tests/a.test.ts', "fetch('https://ejemplo.supabase.co/rest/v1/');\n");
    assert.equal(npmTest(repo), 'ask');
  });
  await t.test('solo staged, con el árbol de trabajo restaurado', () => {
    const repo = makeRepo();
    const original = readFileSync(join(repo.dir, 'tests/a.test.ts'));
    repo.write('tests/a.test.ts', "import { spawn } from 'node:child_process';\nspawn('supabase', ['db', 'push']);\n");
    repo.git('add', 'tests/a.test.ts');
    writeFileSync(join(repo.dir, 'tests/a.test.ts'), original);
    const result = evaluate({ tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: repo.dir }, repo.ctx);
    assert.equal(result?.decision, 'ask');
    assert.match(result.reason, /staged/);
  });
  await t.test('nuevo sin seguimiento', () => {
    const repo = makeRepo();
    repo.write('tests/b.test.ts', "import { spawn } from 'node:child_process';\nspawn('supabase', ['functions', 'deploy']);\n");
    assert.equal(npmTest(repo), 'ask');
  });
  await t.test('nuevo ignorado por .gitignore', () => {
    const repo = makeRepo();
    repo.write('tests/oculto.local.ts', "fetch('https://ejemplo.supabase.co');\n");
    assert.equal(npmTest(repo), 'ask');
  });
  await t.test('archivo binario nuevo', () => {
    const repo = makeRepo();
    repo.write('scripts/x.bin', Buffer.from([0, 1, 2, 3]));
    assert.equal(npmTest(repo), 'ask');
  });
  await t.test('script de package.json modificado', () => {
    const repo = makeRepo();
    repo.write('package.json', JSON.stringify({ scripts: { test: 'vitest run && echo cambiado', build: 'vite build' } }));
    assert.equal(npmTest(repo), 'ask');
  });
  await t.test('script inexistente en HEAD', () => {
    const repo = makeRepo();
    assert.equal(outcome(evaluate({ tool_name: 'Bash', tool_input: { command: 'npm run deploy' }, cwd: repo.dir }, repo.ctx)), 'ask');
  });
  await t.test('cambio inofensivo no bloquea', () => {
    const repo = makeRepo();
    repo.write('tests/a.test.ts', 'export const ok = 2;\n');
    assert.equal(npmTest(repo), 'pass');
  });
  await t.test('directorio sin .git', () => {
    const dir = tempDir('pesito-guard-nogit-');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    const noGit = createContext({ repoRoot: dir });
    assert.equal(outcome(evaluate({ tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: dir }, noGit)), 'ask');
  });
});

test('fail-closed: entradas inválidas o errores internos piden aprobación', () => {
  assert.equal(decide('esto no es JSON')?.decision, 'ask');
  assert.equal(decide('null')?.decision, 'ask');
  // Un BOM inicial (p. ej. al canalizar desde PowerShell) no cambia la decisión.
  assert.equal(decide('﻿' + JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'supabase config push' } }))?.decision, 'deny');
  assert.equal(decide('﻿' + JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' } })), null);
  assert.equal(decide(JSON.stringify({ tool_name: 'Bash', tool_input: {} }))?.decision, 'ask');
  const broken = { ...ctx, get repoRoot() { throw new Error('fallo simulado'); } };
  assert.equal(decide(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' } }), { repoRoot: join(tmpdir(), 'no-existe-pesito', '\0') })?.decision, 'ask');
  assert.throws(() => evaluate({ tool_name: 'Bash', tool_input: { command: 'npm test' } }, broken));
});

test('proceso real del hook: salida JSON de PreToolUse', () => {
  const call = (input) => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 15000 });
  const selftest = call(JSON.stringify({ tool_name: 'Bash', tool_input: { command: `echo ${SELFTEST}` }, cwd: ROOT }));
  assert.equal(selftest.status, 0);
  assert.equal(JSON.parse(selftest.stdout).hookSpecificOutput.permissionDecision, 'ask');
  const invalid = call('{roto');
  assert.equal(JSON.parse(invalid.stdout).hookSpecificOutput.permissionDecision, 'ask');
  const empty = call('');
  assert.equal(JSON.parse(empty.stdout).hookSpecificOutput.permissionDecision, 'ask');
  const destructive = call(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'supabase config push' }, cwd: ROOT }));
  assert.equal(JSON.parse(destructive.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const harmless = call(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: ROOT }));
  assert.equal(harmless.status, 0);
  assert.equal(harmless.stdout, '');
  assert.equal(render(null), '');
});

test('settings.json: hook síncrono con onFailure "block" y forma exec', () => {
  const settings = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8'));
  const groups = settings.hooks?.PreToolUse ?? [];
  assert.ok(groups.length > 0);
  const matcher = groups.map((g) => g.matcher).join('|');
  for (const tool of ['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']) assert.match(matcher, new RegExp(`\\b${tool}\\b`));
  for (const hook of groups.flatMap((g) => g.hooks)) {
    assert.equal(hook.type, 'command');
    assert.equal(hook.command, 'node');
    assert.equal(hook.onFailure, 'block');
    assert.notEqual(hook.async, true);
    assert.notEqual(hook.asyncRewake, true);
    assert.match(hook.args[0], /^\$\{CLAUDE_PROJECT_DIR\}\/\.claude\/hooks\/guard-supabase\.mjs$/);
  }
  assert.equal(settings.permissions?.disableBypassPermissionsMode, 'disable');
  // Si el script no existe o falla, node termina con error: con onFailure "block" Claude Code bloquea.
  const missing = spawnSync(process.execPath, [join(ROOT, '.claude', 'hooks', 'no-existe.mjs')], { input: '{}', encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
});
