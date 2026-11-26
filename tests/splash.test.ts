import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const doc = () => new JSDOM(html).window.document;

describe('pantalla de inicio en index.html', () => {
  it('se pinta dentro de #root con texto accesible', () => {
    const splash = doc().querySelector('#root > .pesito-splash');
    expect(splash).not.toBeNull();
    expect(splash?.getAttribute('role')).toBe('status');
    expect(splash?.querySelector('.pesito-splash__label')?.textContent).toBe('Abriendo Pesito…');
  });

  it('tiene la moneda que entra en la ranura y la barra de carga', () => {
    const root = doc().querySelector('#root')!;
    expect(root.querySelector('.pesito-splash__coin')).not.toBeNull();
    expect(root.querySelector('.pesito-splash__slot')).not.toBeNull();
    expect(root.querySelector('.pesito-splash__bar')).not.toBeNull();
    expect(root.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('no agrega scripts en línea ni manejadores de eventos', () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('usa el verde de la marca y respeta el movimiento reducido', () => {
    const css = [...doc().querySelectorAll('style')].map((s) => s.textContent).join('\n');
    expect(css).toContain('#20b984');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });
});
