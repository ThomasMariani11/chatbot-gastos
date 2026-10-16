import environments from '../config/environments.json';

type EnvironmentInput = { MODE?: string; VITE_APP_ENV?: string; VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string };

function publicKey(key: string): boolean {
  if (key.startsWith('sb_publishable_')) return true;
  try {
    const payload = key.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
    return JSON.parse(atob(payload)).role === 'anon';
  } catch { return false; }
}

// El build habitual sigue apuntando a producción. Desarrollo nunca hereda ese destino.
export function resolveEnvironment(env: EnvironmentInput) {
  const target = env.VITE_APP_ENV || (env.MODE === 'production' ? 'production' : 'local');
  if (target !== 'local' && target !== 'production') throw new Error('Entorno de Pesito desconocido.');
  if (target === 'production' && env.MODE !== 'production') throw new Error('Usá un build de producción explícito; desarrollo requiere Supabase local.');
  const production = environments.production;
  const url = env.VITE_SUPABASE_URL || (target === 'production' ? production.supabaseUrl : '');
  const key = env.VITE_SUPABASE_ANON_KEY || (target === 'production' ? production.publishableKey : '');
  if (!url || !key) throw new Error('Configurá VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY del entorno local.');
  const parsed = new URL(url);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) throw new Error('URL de Supabase inválida.');
  if (target === 'local' && (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.port)) throw new Error('El entorno local solo admite Supabase en loopback.');
  if (target === 'production' && (parsed.origin !== production.supabaseUrl || key !== production.publishableKey)) throw new Error('El destino no coincide con la configuración pública de producción.');
  if (!publicKey(key)) throw new Error('El navegador solo admite una clave pública; nunca una service role.');
  return { target, supabaseUrl: parsed.origin, supabaseAnonKey: key };
}
