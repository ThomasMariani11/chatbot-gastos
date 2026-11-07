// Barrera local del agente para Pesito (hook PreToolUse de Claude Code).
//
// Analiza Bash, PowerShell, Edit, Write, MultiEdit y NotebookEdit antes de que se ejecuten.
// Nunca concede permisos: solo puede pedir aprobación explícita al propietario ("ask") o bloquear
// ("deny"). No existe variable, flag ni texto en el comando que convierta una decisión en "allow".
//
// Es una heurística sobre texto, no una barrera absoluta. Ver
// docs/operaciones/DEPLOY_Y_ROLLBACK.md, sección "Barreras locales del agente".
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SELFTEST = 'PESITO_GUARD_SELFTEST';
const FALLBACK_REF = 'ystyatotldslfmucvgsq';
const MAX_SCAN_BYTES = 1024 * 1024;
const WIN = process.platform === 'win32';

// Archivos que, al cambiar, alteran lo que ejecutan `npm run`, `node scripts/…` o `node --test`.
export const EXEC_SCOPE = ['package.json', 'package-lock.json', 'scripts', 'tests', 'src', 'supabase/functions', 'vite.config.ts', 'vitest.config.ts', 'eslint.config.mjs', '.claude'];
const IGNORED_SCAN_SCOPE = ['scripts', 'tests', '.claude/hooks'];

// ---------------------------------------------------------------- decisiones
const ask = (reason) => ({ decision: 'ask', reason });
const deny = (reason) => ({ decision: 'deny', reason });
const RANK = { deny: 2, ask: 1 };
function worst(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return RANK[b.decision] > RANK[a.decision] ? b : a;
}

// ---------------------------------------------------------------- contexto
export function createContext({ repoRoot } = {}) {
  const root = resolve(repoRoot ?? fileURLToPath(new URL('../..', import.meta.url)));
  let prodRef = FALLBACK_REF;
  const envFile = join(root, 'config', 'environments.json');
  if (existsSync(envFile)) prodRef = JSON.parse(readFileSync(envFile, 'utf8'))?.production?.projectRef || FALLBACK_REF;
  const versionFile = join(root, '.supabase-version');
  const supabaseVersion = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : null;
  const tempDirs = [...new Set([tmpdir(), process.env.TEMP, process.env.TMP].filter(Boolean).map((d) => resolve(d)))];
  return { repoRoot: root, prodRef, supabaseVersion, tempDirs, home: homedir() };
}

// ---------------------------------------------------------------- rutas
function toNative(p) {
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(p);
  return WIN && m ? `${m[1].toUpperCase()}:/${m[2]}` : p;
}
const absPath = (p, base) => resolve(base, toNative(p));
const norm = (p) => (WIN ? resolve(p).toLowerCase() : resolve(p));
function inside(child, parent) {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}
const relPosix = (root, abs) => relative(root, abs).split(sep).join('/');

const PROTECTED_REL = [/^\.claude\/settings[^/]*\.json$/i, /^\.claude\/hooks(\/|$)/i, /^supabase\/\.temp(\/|$)/i, /^supabase\/config\.toml$/i, /^config\/environments\.json$/i];
const PROTECTED_TEXT = /\.claude[\\/](settings[^\\/\s'"]*\.json|hooks\b)|supabase[\\/]\.temp\b|supabase[\\/]config\.toml|config[\\/]environments\.json|disableAllHooks/i;

function protectedFile(abs, ctx) {
  if (inside(abs, ctx.repoRoot)) {
    const rel = relPosix(ctx.repoRoot, abs);
    if (PROTECTED_REL.some((re) => re.test(rel))) return rel;
  }
  // La configuración global puede desactivar hooks (disableAllHooks).
  if (inside(abs, join(ctx.home, '.claude')) && /^settings[^\\/]*\.json$/i.test(basename(abs))) return abs;
  return null;
}

// ---------------------------------------------------------------- patrones
function remotePattern(ctx) {
  return new RegExp(String.raw`supabase\.(co|com|in|net)\b|` + ctx.prodRef, 'i');
}
const CREDENTIAL = /\b(cmdkey|vaultcmd|CredRead\w*|CredEnumerate\w*|Get-StoredCredential|keytar|PasswordVault)\b|[\\/]\.supabase([\\/]|\b)|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD/i;
const INDIRECT = /\b(Invoke-Expression|iex|Start-Process|saps|Start-Job|Invoke-Command|icm|EncodedCommand|FromBase64String)\b/i;
const NON_LOOPBACK_PG = /postgres(ql)?:\/\/[^\s'"]*@(?!(127\.0\.0\.1|localhost|\[::1\])[:/]?)/i;

function suspiciousPatterns(ctx) {
  return [
    ['CLI de Supabase', /\bsupabase(@[\w.^~-]+)?['"]?\s*[,\s]\s*['"]?(db|functions|secrets|link|unlink|migration|projects|config|inspect|storage|gen|branches|orgs|sso|domains|vanity-subdomains|postgres-config|network-restrictions|ssl-enforcement|snippets|backups|services)\b/i],
    ['paquete de la CLI de Supabase', /['"]supabase(@[\w.^~-]+)?['"]|--package=supabase/i],
    ['destino remoto de Supabase o ref de producción', remotePattern(ctx)],
    ['ejecución de procesos', /child_process|\bspawn(Sync)?\s*\(|(?<![.\w$])exec(Sync|File|FileSync)?\s*\(|Deno\.(Command|run)\b|Bun\.spawn/],
    ['acceso a credenciales', CREDENTIAL],
    ['código dinámico', /(?<![.\w$])eval\s*\(|new\s+Function\s*\(/],
    ['vínculo productivo de Supabase', /supabase[\\/]\.temp|pooler-url|project-ref/i],
  ];
}

function scanBuffer(buf, ctx) {
  if (buf.length > MAX_SCAN_BYTES) return 'archivo demasiado grande para revisarlo';
  if (buf.includes(0)) return 'archivo binario';
  const text = buf.toString('utf8');
  const hit = suspiciousPatterns(ctx).find(([, re]) => re.test(text));
  return hit ? hit[0] : null;
}

// ---------------------------------------------------------------- tokenizador
// Divide en segmentos por ; & | && || saltos de línea, subshells y redirecciones. Respeta comillas.
export function splitSegments(command) {
  const segments = [];
  let current = [];
  let token = '';
  let hasToken = false;
  let quote = null;
  const pushToken = () => {
    if (hasToken) current.push(token);
    token = '';
    hasToken = false;
  };
  const pushSegment = () => {
    pushToken();
    if (current.length) segments.push(current);
    current = [];
  };
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else token += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (';&|\n\r()`{}<>'.includes(ch)) {
      pushSegment();
    } else if (/\s/.test(ch)) {
      pushToken();
    } else {
      token += ch;
      hasToken = true;
    }
  }
  pushSegment();
  return segments;
}

const programName = (token) => basename(token.replace(/\\/g, '/')).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
const isFlag = (t) => t.startsWith('-');

const READ_ONLY = new Set(['cat', 'type', 'get-content', 'gc', 'ls', 'dir', 'get-childitem', 'gci', 'rg', 'grep', 'select-string', 'sls', 'head', 'tail', 'wc', 'less', 'more', 'test-path', 'get-item', 'gi', 'resolve-path', 'measure-object', 'select-object', 'sort-object', 'where-object', 'foreach-object', 'format-table', 'format-list', 'out-string', 'cd', 'set-location', 'pwd', 'get-location', 'echo', 'write-output', 'write-host']);
const GIT_READ_ONLY = new Set(['status', 'diff', 'log', 'show', 'add', 'ls-files', 'rev-parse', 'commit', 'blame', 'grep', 'branch', 'fetch', 'push', 'switch', 'remote']);
const ALWAYS_ASK = {
  deno: 'deno ejecuta código arbitrario', bun: 'bun ejecuta código arbitrario', python: 'Python ejecuta código arbitrario', python3: 'Python ejecuta código arbitrario', py: 'Python ejecuta código arbitrario', pip: 'instalación de paquetes Python', uv: 'uv ejecuta código arbitrario',
  pwsh: 'PowerShell anidado', powershell: 'PowerShell anidado', bash: 'shell anidado', sh: 'shell anidado', zsh: 'shell anidado', cmd: 'cmd anidado', wsl: 'WSL', start: 'start lanza programas', 'start-process': 'Start-Process lanza programas', saps: 'Start-Process lanza programas',
  iex: 'Invoke-Expression', 'invoke-expression': 'Invoke-Expression', 'invoke-command': 'Invoke-Command', icm: 'Invoke-Command', 'start-job': 'Start-Job', ruby: 'intérprete', perl: 'intérprete', php: 'intérprete',
};
const NPM_READ_ONLY = new Set(['-v', '--version', 'version', 'ls', 'list', 'view', 'info', 'outdated', 'help', 'why', 'explain', 'doctor', 'ping', 'root', 'prefix', 'bin']);
const NPM_RUN = new Set(['run', 'run-script', 'rum', 'urn']);
const NPM_LIFECYCLE = { test: 'test', t: 'test', tst: 'test', start: 'start', stop: 'stop', restart: 'restart' };

// ---------------------------------------------------------------- Supabase CLI
const VALUE_FLAGS = new Set(['--workdir', '--project-ref', '--db-url', '--env-file', '--output', '-o', '--schema', '-s', '--profile', '--password', '-p', '--network-id', '--import-map', '--project-id', '--file', '-f', '--level', '--exclude', '-x', '--dns-resolver', '--inspect-mode']);
const REMOTE_FLAGS = ['--linked', '--project-ref', '--db-url', '--project-id'];
const LOCAL_SUBCOMMANDS = new Set(['start', 'stop', 'status', 'functions serve', 'db reset', 'db start', 'db lint', 'migration list', 'test db', 'test new']);
const NEEDS_LOCAL_FLAG = new Set(['db lint', 'migration list']);

export function classifySupabase(args, ctx, cwd) {
  const words = [];
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (isFlag(a)) {
      const [name, inline] = a.split(/=(.*)/s);
      if (inline !== undefined) flags.set(name, inline);
      else if (VALUE_FLAGS.has(name) && i + 1 < args.length && !isFlag(args[i + 1])) flags.set(name, args[++i]);
      else flags.set(name, true);
    } else words.push(a.toLowerCase());
  }
  const [w0 = '', w1 = ''] = words;
  const sub = `${w0} ${w1}`.trim();
  const remote = REMOTE_FLAGS.some((f) => flags.has(f));
  const workdir = typeof flags.get('--workdir') === 'string' ? absPath(flags.get('--workdir'), cwd) : null;
  const localWorkdir = workdir !== null && (inside(workdir, join(ctx.repoRoot, '.temp')) || ctx.tempDirs.some((t) => inside(workdir, t)));

  if (['link', 'unlink'].includes(w0)) return deny(`supabase ${w0} cambiaría el vínculo con producción; si hace falta, lo ejecuta el propietario a mano.`);
  if (sub === 'config push' || sub === 'projects delete' || sub === 'branches delete' || sub === 'secrets unset') return deny(`supabase ${sub} es destructivo; si hace falta, lo ejecuta el propietario a mano.`);
  if (w0 === 'migration' && ['repair', 'down', 'squash'].includes(w1) && !(localWorkdir && !remote)) return deny(`supabase migration ${w1} fuera de un workdir local; si hace falta, lo ejecuta el propietario a mano.`);
  if (sub === 'db reset' && remote) return deny('supabase db reset contra un proyecto remoto está prohibido.');

  if (!w0 && (flags.has('--version') || flags.has('-v') || flags.has('--help') || flags.has('-h'))) return null;
  const localSub = LOCAL_SUBCOMMANDS.has(sub) || LOCAL_SUBCOMMANDS.has(w0);
  const localFlagOk = !NEEDS_LOCAL_FLAG.has(sub) || flags.has('--local');
  if (localSub && localFlagOk && localWorkdir && !remote) return null;
  const why = remote ? 'usa un destino remoto' : !localWorkdir ? 'no usa --workdir dentro de .temp/ o %TEMP%' : 'no es un subcomando local permitido';
  return ask(`Operación de la CLI de Supabase que puede llegar a producción (supabase ${sub || '(sin subcomando)'}: ${why}). Requiere tu aprobación.`);
}

function analyzePackageRunner(args, ctx, cwd) {
  // npx / npm exec / pnpm dlx / yarn dlx / bunx
  let pkg = null;
  let rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      rest = args.slice(i + 1);
      break;
    }
    if (a.startsWith('--package=')) pkg = a.slice('--package='.length);
    else if ((a === '--package' || a === '-p') && i + 1 < args.length) pkg = args[++i];
    else if (!isFlag(a)) {
      if (!pkg) pkg = a;
      rest = args.slice(i);
      break;
    }
  }
  if (!pkg) return ask('Ejecución de un paquete con npx/npm exec sin paquete identificable.');
  const m = /^supabase(?:@(.+))?$/i.exec(pkg);
  if (!m) return ask(`npx/npm exec de "${pkg}": solo se permite supabase@${ctx.supabaseVersion} en modo local; el resto requiere tu aprobación.`);
  if (m[1] !== ctx.supabaseVersion) return ask(`supabase@${m[1] ?? '(sin versión)'} no coincide con la versión fijada ${ctx.supabaseVersion}.`);
  const idx = rest.findIndex((t) => /^supabase(@.+)?$/i.test(t));
  return classifySupabase(idx >= 0 ? rest.slice(idx + 1) : rest, ctx, cwd);
}

// ---------------------------------------------------------------- cambios en archivos ejecutables
function git(ctx, args) {
  return execFileSync('git', ['-C', ctx.repoRoot, ...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
}
const zList = (buf) => buf.toString('utf8').split('\0').filter(Boolean);

export function checkExecutableChanges(ctx) {
  let top;
  try {
    top = git(ctx, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  } catch {
    return ask('No se pudo comprobar con git si cambiaron scripts o tests; se pide aprobación.');
  }
  if (norm(toNative(top)) !== norm(ctx.repoRoot)) return ask('El repositorio git no coincide con la raíz de Pesito; se pide aprobación.');

  const found = []; // [ruta, origen, buffer]
  const unstaged = zList(git(ctx, ['diff', '--name-only', '-z', '--diff-filter=d', '--', ...EXEC_SCOPE]));
  const staged = zList(git(ctx, ['diff', '--cached', '--name-only', '-z', '--diff-filter=d', '--', ...EXEC_SCOPE]));
  const untracked = zList(git(ctx, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...EXEC_SCOPE]));
  const ignored = zList(git(ctx, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', ...IGNORED_SCAN_SCOPE]));

  const fromDisk = (rel, origin) => {
    const abs = join(ctx.repoRoot, rel);
    if (!existsSync(abs)) return;
    if (statSync(abs).size > MAX_SCAN_BYTES) found.push([rel, origin, Buffer.alloc(MAX_SCAN_BYTES + 1)]);
    else found.push([rel, origin, readFileSync(abs)]);
  };
  for (const rel of unstaged) fromDisk(rel, 'sin preparar');
  for (const rel of untracked) fromDisk(rel, 'nuevo sin seguimiento');
  for (const rel of ignored) fromDisk(rel, 'nuevo ignorado por .gitignore');
  for (const rel of staged) {
    found.push([rel, 'preparado (staged)', git(ctx, ['show', `:${rel}`])]);
    fromDisk(rel, 'preparado (árbol de trabajo)');
  }

  const hits = [];
  for (const [rel, origin, buf] of found) {
    const why = scanBuffer(buf, ctx);
    if (why) hits.push(`${rel} [${origin}: ${why}]`);
  }
  if (hits.length) return ask(`Hay cambios no confirmados en archivos ejecutables con patrones sensibles: ${hits.slice(0, 5).join('; ')}${hits.length > 5 ? '…' : ''}. Requiere tu aprobación.`);
  return null;
}

function headScripts(ctx) {
  try {
    return JSON.parse(git(ctx, ['show', 'HEAD:package.json']).toString('utf8')).scripts ?? {};
  } catch {
    return null;
  }
}

function analyzeNpmScript(name, ctx, cwd) {
  if (!inside(cwd, ctx.repoRoot)) return ask('npm run fuera del repositorio de Pesito.');
  const head = headScripts(ctx);
  if (!head) return ask('No se pudo leer package.json de HEAD; se pide aprobación.');
  if (!Object.hasOwn(head, name)) return ask(`El script npm "${name}" no existe en package.json confirmado.`);
  let current;
  try {
    current = JSON.parse(readFileSync(join(ctx.repoRoot, 'package.json'), 'utf8')).scripts?.[name];
  } catch {
    return ask('No se pudo leer package.json; se pide aprobación.');
  }
  if (current !== head[name]) return ask(`El script npm "${name}" fue modificado respecto de HEAD.`);
  let result = checkExecutableChanges(ctx);
  if (name === 'preview') result = worst(result, checkPreviewDir(join(ctx.repoRoot, 'dist'), ctx));
  return result;
}

function checkPreviewDir(dir, ctx) {
  if (/pwa-prod-check/i.test(dir)) return ask('Servir .temp/pwa-prod-check es servir un build de producción.');
  const assets = join(dir, 'assets');
  if (!existsSync(assets)) return null;
  const ref = remotePattern(ctx);
  for (const f of readdirSync(assets)) {
    if (!f.endsWith('.js')) continue;
    const p = join(assets, f);
    if (statSync(p).size <= 8 * MAX_SCAN_BYTES && ref.test(readFileSync(p, 'utf8'))) return ask(`El build en ${relPosix(ctx.repoRoot, dir)} apunta a producción.`);
  }
  return null;
}

// ---------------------------------------------------------------- node
const NODE_INLINE = new Set(['-e', '--eval', '-p', '--print', '--input-type', '-r', '--require', '--import', '--loader', '--experimental-loader', '-i', '--interactive']);

function analyzeNode(args, ctx, cwd) {
  if (args.some((a) => NODE_INLINE.has(a.split('=')[0]))) return ask('node con código en línea, precarga o REPL.');
  if (args.some((a) => a === '--version' || a === '-v' || a === '--help' || a === '-h')) return null;
  const positional = args.filter((a) => !isFlag(a));
  if (args.includes('--test')) {
    const allowedDirs = ['scripts', 'tests', '.claude/hooks'].map((d) => join(ctx.repoRoot, d));
    if (!inside(cwd, ctx.repoRoot)) return ask('node --test fuera del repositorio de Pesito.');
    for (const p of positional) {
      const abs = absPath(p, cwd);
      if (!allowedDirs.some((d) => inside(abs, d))) return ask(`node --test sobre ${p}, fuera de scripts/, tests/ o .claude/hooks/.`);
    }
    return checkExecutableChanges(ctx);
  }
  if (!positional.length) return ask('node sin script (REPL o stdin).');
  const script = absPath(positional[0], cwd);
  if (basename(script) === 'verify-sql-transport.mjs') return ask('verify-sql-transport.mjs usa el vínculo productivo de Supabase.');
  const allowed = ['scripts', 'tests'].map((d) => join(ctx.repoRoot, d));
  if (allowed.some((d) => inside(script, d))) return checkExecutableChanges(ctx);
  let detail = '';
  try {
    const why = scanBuffer(readFileSync(script), ctx);
    if (why) detail = ` Contiene: ${why}.`;
  } catch {
    detail = ' No se pudo leer el archivo.';
  }
  return ask(`node ${positional[0]}: script fuera de scripts/ o tests/.${detail}`);
}

// ---------------------------------------------------------------- segmentos
function analyzeSegment(tokens, ctx, cwd) {
  let i = 0;
  while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || ['call', 'time', 'command', 'env', 'exec', 'nohup'].includes(tokens[i].toLowerCase()))) i++;
  if (i >= tokens.length) return null;
  const raw = tokens[i];
  if (raw.startsWith('$')) return null; // asignación o expresión de PowerShell; los patrones globales ya se aplicaron
  const prog = programName(raw);
  const args = tokens.slice(i + 1);
  const readOnly = READ_ONLY.has(prog) || (prog === 'git' && GIT_READ_ONLY.has((args.find((a) => !isFlag(a)) ?? '').toLowerCase()));
  let result = null;

  const joined = tokens.join(' ');
  if (!readOnly && PROTECTED_TEXT.test(joined) && !(prog === 'node' && args.includes('--test'))) {
    result = worst(result, ask('El comando toca configuración protegida (hooks, settings, vínculo de Supabase o entornos). Requiere tu aprobación.'));
  }

  if (ALWAYS_ASK[prog]) return worst(result, ask(`${ALWAYS_ASK[prog]}: requiere tu aprobación.`));
  if (/[\\/]/.test(raw) && !['node', 'git', 'npm', 'npx', 'docker'].includes(prog) && !READ_ONLY.has(prog)) {
    if (/[\\/]node_modules[\\/](\.bin[\\/])?supabase/i.test(raw)) return worst(result, classifySupabase(args, ctx, cwd));
    return worst(result, ask(`Ejecución directa de ${raw}: requiere tu aprobación.`));
  }
  if (/\.(sh|ps1|bat|cmd|mjs|js|ts|py)$/i.test(raw)) return worst(result, ask(`Ejecución directa de ${raw}: requiere tu aprobación.`));

  switch (prog) {
    case 'supabase':
      return worst(result, classifySupabase(args, ctx, cwd));
    case 'npx':
    case 'bunx':
      return worst(result, analyzePackageRunner(args, ctx, cwd));
    case 'pnpm':
    case 'yarn': {
      const sub = (args.find((a) => !isFlag(a)) ?? '').toLowerCase();
      if (sub === 'dlx' || sub === 'exec') return worst(result, analyzePackageRunner(args.slice(args.indexOf(sub) + 1), ctx, cwd));
      return worst(result, ask(`${prog} no es el gestor del proyecto; requiere tu aprobación.`));
    }
    case 'npm': {
      const sub = (args.find((a) => !isFlag(a)) ?? '').toLowerCase();
      const after = args.slice(args.findIndex((a) => !isFlag(a)) + 1);
      if (!sub) return result;
      if (NPM_READ_ONLY.has(sub)) return result;
      if (sub === 'exec' || sub === 'x') return worst(result, analyzePackageRunner(after, ctx, cwd));
      if (NPM_RUN.has(sub)) {
        const name = after.find((a) => !isFlag(a));
        return name ? worst(result, analyzeNpmScript(name, ctx, cwd)) : result;
      }
      if (NPM_LIFECYCLE[sub]) return worst(result, analyzeNpmScript(NPM_LIFECYCLE[sub], ctx, cwd));
      return worst(result, ask(`npm ${sub} puede instalar dependencias o ejecutar código arbitrario; requiere tu aprobación.`));
    }
    case 'node':
      return worst(result, analyzeNode(args, ctx, cwd));
    case 'vite':
      if (args.includes('preview')) {
        const inline = args.find((a) => a.startsWith('--outDir='));
        const idx = args.indexOf('--outDir');
        const out = inline ? inline.slice('--outDir='.length) : idx >= 0 ? args[idx + 1] : 'dist';
        return worst(result, checkPreviewDir(absPath(out ?? 'dist', cwd), ctx));
      }
      return result;
    case 'psql':
    case 'pg_dump':
    case 'pg_dumpall':
    case 'pg_restore': {
      const hostIdx = args.findIndex((a) => a === '-h' || a === '--host');
      const host = hostIdx >= 0 ? args[hostIdx + 1] : args.find((a) => a.startsWith('--host='))?.slice(7);
      const uri = args.find((a) => /^postgres(ql)?:\/\//i.test(a));
      const loopback = (h) => ['127.0.0.1', 'localhost', '::1'].includes((h ?? '').toLowerCase());
      if (uri && !NON_LOOPBACK_PG.test(uri)) return result;
      if (!uri && loopback(host)) return result;
      return worst(result, ask(`${prog} sin un host loopback explícito; requiere tu aprobación.`));
    }
    default:
      break;
  }

  // Invocación indirecta de la CLI (p. ej. otro lanzador con "supabase" como argumento).
  if (!readOnly && prog !== 'git' && prog !== 'docker' && args.some((a) => /^supabase(@.+)?$/i.test(a))) {
    return worst(result, ask(`Invocación indirecta de la CLI de Supabase mediante ${prog}; requiere tu aprobación.`));
  }
  return result;
}

export function analyzeCommand(command, ctx, cwd) {
  if (command.includes(SELFTEST)) return ask('Autoprueba de la barrera de Pesito: el hook está activo. Este comando es inofensivo; podés rechazarlo.');
  let result = null;
  if (remotePattern(ctx).test(command)) result = worst(result, ask('El comando menciona un destino remoto de Supabase o el ref de producción. Requiere tu aprobación.'));
  if (CREDENTIAL.test(command)) result = worst(result, ask('El comando accede a credenciales o tokens. Requiere tu aprobación.'));
  if (INDIRECT.test(command)) result = worst(result, ask('El comando ejecuta código de forma indirecta o codificada. Requiere tu aprobación.'));
  if (NON_LOOPBACK_PG.test(command)) result = worst(result, ask('Conexión PostgreSQL a un host no local. Requiere tu aprobación.'));
  for (const segment of splitSegments(command)) result = worst(result, analyzeSegment(segment, ctx, cwd));
  return result;
}

export function analyzeFileWrite(filePath, ctx, cwd) {
  if (typeof filePath !== 'string' || !filePath) return ask('Escritura sin ruta identificable.');
  const hit = protectedFile(absPath(filePath, cwd), ctx);
  return hit ? ask(`Modificar ${hit} puede desactivar la barrera o cambiar el vínculo/entorno. Requiere tu aprobación.`) : null;
}

export function evaluate(input, ctx) {
  if (!input || typeof input !== 'object') return ask('Entrada del hook inválida.');
  const tool = input.tool_name;
  const ti = input.tool_input ?? {};
  const cwd = typeof input.cwd === 'string' && input.cwd ? absPath(input.cwd, ctx.repoRoot) : ctx.repoRoot;
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) return analyzeFileWrite(ti.file_path ?? ti.notebook_path, ctx, cwd);
  if (tool === 'Bash' || tool === 'PowerShell') {
    if (typeof ti.command !== 'string') return ask('Comando sin texto identificable.');
    return analyzeCommand(ti.command, ctx, cwd);
  }
  return null;
}

// Punto de entrada testeable: cualquier error se convierte en "ask" (fail-closed).
export function decide(raw, options) {
  try {
    return evaluate(JSON.parse(String(raw).replace(/^﻿/, '')), createContext(options));
  } catch (error) {
    return ask(`La barrera no pudo analizar la acción (${error?.message ?? 'error desconocido'}); se pide aprobación.`);
  }
}

export function render(decision) {
  if (!decision) return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision.decision, permissionDecisionReason: `[Barrera Pesito] ${decision.reason}` } });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    process.stdout.write(render(decide(Buffer.concat(chunks).toString('utf8'))));
  });
  process.stdin.on('error', () => process.stdout.write(render(ask('No se pudo leer la entrada del hook.'))));
}
