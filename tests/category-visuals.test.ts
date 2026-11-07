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

  it('los ingresos siguen usando arrowUpRight', () => {
    expect(movementVisual('Alquileres', 'income').icon).toBe('arrowUpRight');
  });
});
