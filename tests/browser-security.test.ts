import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  browserContentSecurityPolicy,
  injectBrowserSecurity,
  SECURITY_POLICY_MARKER,
} from '../src/browser-security';
import environments from '../config/environments.json';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const production = environments.production.supabaseUrl;
const directives = (policy: string) =>
  Object.fromEntries(
    policy.split('; ').map((part) => {
      const [name, ...sources] = part.split(' ');
      return [name, sources];
    }),
  );

describe('INF-13 / FE-19: política del navegador', () => {
  it('permite solo el backend configurado, Realtime y las consultas al mismo origen', () => {
    const rules = directives(browserContentSecurityPolicy(production));
    expect(rules['connect-src']).toEqual(["'self'", production, production.replace('https:', 'wss:')]);
    expect(Object.values(rules).flat()).not.toContain('*');
    expect(Object.values(rules).flat()).not.toContain('https:');
  });
  it('bloquea scripts inline, eval, objetos, bases y frames sin falsos headers meta', () => {
    const rules = directives(browserContentSecurityPolicy(production));
    expect(rules['default-src']).toEqual(["'none'"]);
    expect(rules['script-src']).toEqual(["'self'"]);
    for (const directive of ['script-src-attr', 'object-src', 'base-uri', 'frame-src', 'media-src'])
      expect(rules[directive]).toEqual(["'none'"]);
    expect(rules['worker-src']).toEqual(["'self'"]);
    expect(rules['manifest-src']).toEqual(["'self'"]);
    expect(rules['form-action']).toEqual(["'self'"]);
    expect(rules).not.toHaveProperty('frame-ancestors');
    expect(rules).not.toHaveProperty('report-uri');
    expect(Object.values(rules).flat()).not.toContain("'unsafe-eval'");
  });
  it('mantiene fuentes, imágenes locales y estilos React/Recharts sin autorizar scripts externos', () => {
    const rules = directives(browserContentSecurityPolicy(production));
    expect(rules['style-src']).toEqual(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']);
    expect(rules['font-src']).toEqual(["'self'", 'https://fonts.gstatic.com']);
    expect(rules['img-src']).toEqual(["'self'", 'data:']);
    expect(rules['script-src']).not.toContain("'unsafe-inline'");
  });
  it('el ensayo con Supabase local usa solo sus orígenes HTTP y WS', () => {
    expect(directives(browserContentSecurityPolicy('http://127.0.0.1:54321'))['connect-src']).toEqual([
      "'self'",
      'http://127.0.0.1:54321',
      'ws://127.0.0.1:54321',
    ]);
  });
  it.each([
    'http://backend.invalid',
    'http://127.0.0.1.evil.invalid:54321',
    'https://user:password@backend.invalid',
    'https://backend.invalid/?key=canary',
    'https://backend.invalid/path',
    'https://backend.invalid/#canary',
    'data:text/html,test',
    'https://backend.invalid;script-src%20*',
  ])('rechaza destinos inesperados en la política: %s', (url) => {
    expect(() => browserContentSecurityPolicy(url)).toThrow();
  });
  it('el build entrega una sola CSP temprana y política de referencia sin dependencias inline', () => {
    const built = injectBrowserSecurity(html, production);
    expect(built).not.toContain(SECURITY_POLICY_MARKER);
    expect(built.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
    expect(built.indexOf('charset=')).toBeLessThan(built.indexOf('http-equiv="Content-Security-Policy"'));
    expect(built.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(built.indexOf('<link'));
    expect(built).toContain('<meta name="referrer" content="no-referrer" />');
    expect(built).not.toMatch(/http-equiv="(?:X-Frame-Options|X-Content-Type-Options|Referrer-Policy)"/i);
  });
  it('el build se detiene si falta la política, está duplicada o aparece después de cargar recursos', () => {
    for (const invalid of [
      html.replace(SECURITY_POLICY_MARKER, ''),
      html + SECURITY_POLICY_MARKER,
      html.replace(SECURITY_POLICY_MARKER, '') + SECURITY_POLICY_MARKER,
      html.replace(SECURITY_POLICY_MARKER, '</head>' + SECURITY_POLICY_MARKER + '<head>'),
      html.replace(SECURITY_POLICY_MARKER, '<link href="/test.css">' + SECURITY_POLICY_MARKER),
    ])
      expect(() => injectBrowserSecurity(invalid, production)).toThrow('una sola vez');
  });
});
