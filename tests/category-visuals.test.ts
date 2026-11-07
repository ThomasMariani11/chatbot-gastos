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
const EXISTING = ['Alimentación', 'Transporte', 'Compras', 'Ocio', 'Salud'];
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
    for (const name of EXISTING) expect(pairs).not.toContain(pair(categoryVisual(name)));
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
