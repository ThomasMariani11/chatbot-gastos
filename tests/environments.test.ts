import { describe, expect, it } from 'vitest';
import { resolveEnvironment } from '../src/environment';
import environments from '../config/environments.json';

const anon = 'header.' + btoa(JSON.stringify({ role: 'anon' })) + '.signature';
const local = { MODE: 'development', VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: anon };
describe('INF-10: destinos separados', () => {
  it('el desarrollo sin configurar se detiene sin heredar producción', () => {
    expect(() => resolveEnvironment({ MODE: 'development' })).toThrow('Configurá');
    expect(() => resolveEnvironment({ MODE: 'test' })).toThrow('Configurá');
  });
  it('el build habitual conserva el destino público de producción', () => {
    expect(resolveEnvironment({ MODE: 'production' }).supabaseUrl).toBe(environments.production.supabaseUrl);
  });
  it('desarrollo y ensayo compilado admiten solo el backend local', () => {
    expect(resolveEnvironment(local).target).toBe('local');
    expect(resolveEnvironment({ ...local, MODE: 'production', VITE_APP_ENV: 'local' }).target).toBe('local');
    expect(() => resolveEnvironment({ ...local, VITE_SUPABASE_URL: environments.production.supabaseUrl })).toThrow('loopback');
    expect(() => resolveEnvironment({ ...local, VITE_APP_ENV: 'production' })).toThrow('build');
  });
  it('rechaza claves privadas y URLs engañosas sin incluir sus valores en errores', () => {
    for (const key of ['sb_secret_canary', 'h.' + btoa('{"role":"service_role"}') + '.s', 'bad-key']) {
      expect(() => resolveEnvironment({ ...local, VITE_SUPABASE_ANON_KEY: key })).toThrow('clave pública');
    }
    for (const url of ['https://localhost:54321', 'http://127.0.0.1.evil.invalid:54321', 'http://user@localhost:54321', 'http://localhost:54321/?token=canary']) {
      expect(() => resolveEnvironment({ ...local, VITE_SUPABASE_URL: url })).toThrow();
    }
  });
  it('evita un destino productivo parcial o distinto y entornos no declarados', () => {
    expect(() => resolveEnvironment({ MODE: 'production', VITE_SUPABASE_URL: local.VITE_SUPABASE_URL })).toThrow('no coincide');
    expect(() => resolveEnvironment({ ...local, VITE_APP_ENV: 'staging' })).toThrow('desconocido');
  });
});
