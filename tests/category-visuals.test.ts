import { describe, expect, it } from 'vitest';
import { NEW_CATEGORY_VISUALS, categoryVisual, movementVisual } from '../src/categoryVisuals';

const NEW_EXPENSE = [
  'Restaurantes y delivery',
  'Suscripciones',
  'Auto',
  'Hogar',
  'Tecnología',
  'Cuidado personal',
  'Deporte',
  'Mascotas',
  'Hijos',
  'Viajes',
  'Regalos y donaciones',
];
// Las 11 categorías de gasto sembradas (Otros cae en el fallback).
const SEEDED_EXPENSE = [
  'Alimentación', 'Transporte', 'Vivienda', 'Servicios', 'Salud', 'Educación',
  'Ocio', 'Compras', 'Impuestos', 'Deudas', 'Otros',
];
const FALLBACK = { icon: 'receipt', color: '#596d78' };
// Visuales previos a esta tarea de las 16 sembradas y de alias heredados.
const LEGACY: Array<[string, { icon: string; color: string }]> = [
  ['Alimentación', { icon: 'cart', color: '#147c5b' }],
  ['Transporte', { icon: 'car', color: '#956719' }],
  ['Vivienda', { icon: 'home', color: '#8260b3' }],
  ['Servicios', { icon: 'bolt', color: '#16738e' }],
  ['Salud', { icon: 'heart', color: '#b04570' }],
  ['Educación', { icon: 'graduation', color: '#306cc4' }],
  ['Ocio', { icon: 'music', color: '#b55355' }],
  ['Compras', { icon: 'bag', color: '#655ad8' }],
  ['Impuestos', { icon: 'bolt', color: '#16738e' }],
  ['Deudas', FALLBACK],
  ['Otros', FALLBACK],
  ['Sueldo', { icon: 'briefcase', color: '#147c5b' }],
  ['Freelance', FALLBACK],
  ['Ventas', FALLBACK],
  ['Rendimientos', FALLBACK],
  ['Gimnasio', { icon: 'heart', color: '#b04570' }],
  ['Farmacia', { icon: 'heart', color: '#b04570' }],
  ['Nafta', { icon: 'car', color: '#956719' }],
  ['Supermercado', { icon: 'cart', color: '#147c5b' }],
  ['Internet', { icon: 'bolt', color: '#16738e' }],
];
const pair = (v: { icon: string; color: string }) => `${v.icon}|${v.color}`;

describe('visuales de categorías', () => {
  it('cada gasto nuevo tiene visual propio y coincide con NEW_CATEGORY_VISUALS', () => {
    for (const name of NEW_EXPENSE) {
      const v = categoryVisual(name);
      expect(v.icon !== 'receipt' || v.color !== '#596d78', name).toBe(true);
      expect(v, name).toEqual(NEW_CATEGORY_VISUALS[name]);
    }
  });

  it('los pares icono+color son distintos entre sí y de las categorías existentes', () => {
    const pairs = NEW_EXPENSE.map((n) => pair(categoryVisual(n)));
    expect(new Set(pairs).size).toBe(NEW_EXPENSE.length);
    for (const name of SEEDED_EXPENSE) expect(pairs).not.toContain(pair(categoryVisual(name)));
    expect(pairs).not.toContain(pair(FALLBACK));
  });

  it('las categorías sembradas y alias heredados conservan su visual', () => {
    for (const [name, visual] of LEGACY) expect(categoryVisual(name), name).toEqual(visual);
  });

  it('exporta las 15 categorías nuevas con color hex', () => {
    expect(Object.keys(NEW_CATEGORY_VISUALS)).toHaveLength(15);
    for (const v of Object.values(NEW_CATEGORY_VISUALS)) expect(v.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('las categorías de ingreso nuevas resuelven su visual', () => {
    for (const name of ['Alquileres', 'Reintegros', 'Regalos', 'Jubilación y asignaciones'])
      expect(categoryVisual(name)).toEqual(NEW_CATEGORY_VISUALS[name]);
  });

  // La dona de gastos pinta solo `.color`: un color nuevo debe distinguirse a simple vista.
  // CIE76 ΔE ≥ 20 en Lab (D65): la diferencia apenas perceptible es ~2,3 y los pares casi
  // idénticos de la revisión final medían ~1 (Tecnología vs Servicios); 20 deja margen claro.
  it('los colores de gasto nuevos se distinguen de los sembrados y entre sí (ΔE76 ≥ 20, contraste ≥ 3:1)', () => {
    const SEEDED_COLORS = ['#147c5b', '#956719', '#8260b3', '#16738e', '#b04570', '#306cc4', '#b55355', '#655ad8', '#596d78'];
    for (const name of SEEDED_EXPENSE) expect(SEEDED_COLORS, name).toContain(categoryVisual(name).color);
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const luminance = (hex: string) => {
      const [r, g, b] = rgb(hex).map(lin);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const lab = (hex: string) => {
      const [r, g, b] = rgb(hex).map(lin);
      const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
      const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
      const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
      return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
    };
    const deltaE = (a: string, b: string) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
    const fresh = NEW_EXPENSE.map((name) => [name, NEW_CATEGORY_VISUALS[name].color] as const);
    for (const [name, color] of fresh) {
      expect(1.05 / (luminance(color) + 0.05), `${name} contraste`).toBeGreaterThanOrEqual(3);
      for (const seeded of SEEDED_COLORS) expect(deltaE(color, seeded), `${name} vs ${seeded}`).toBeGreaterThanOrEqual(20);
      for (const [other, otherColor] of fresh)
        if (other !== name) expect(deltaE(color, otherColor), `${name} vs ${other}`).toBeGreaterThanOrEqual(20);
    }
    // Control: el par casi idéntico anterior no pasaría.
    expect(deltaE('#0e7490', '#16738e')).toBeLessThan(20);
  });

  it('los ingresos siguen usando arrowUpRight', () => {
    expect(movementVisual('Alquileres', 'income').icon).toBe('arrowUpRight');
  });
});
