import type { IconName } from './Icons';
type CategoryVisual = { icon: IconName; color: string };
const fallback: CategoryVisual = { icon: 'receipt', color: '#596d78' };
// Categorías ampliadas (FE-24): estos valores se copian tal cual a la migración SQL.
export const NEW_CATEGORY_VISUALS: Record<string, CategoryVisual> = {
  'Restaurantes y delivery': { icon: 'utensils', color: '#a25929' },
  Suscripciones: { icon: 'repeat', color: '#7c3aed' },
  Auto: { icon: 'wrench', color: '#475569' },
  Hogar: { icon: 'sofa', color: '#0f766e' },
  Tecnología: { icon: 'laptop', color: '#0e7490' },
  'Cuidado personal': { icon: 'sparkles', color: '#be185d' },
  Deporte: { icon: 'dumbbell', color: '#15803d' },
  Mascotas: { icon: 'paw', color: '#92400e' },
  Hijos: { icon: 'smile', color: '#b45309' },
  Viajes: { icon: 'plane', color: '#0369a1' },
  'Regalos y donaciones': { icon: 'gift', color: '#c026d3' },
  Alquileres: { icon: 'key', color: '#147c5b' },
  Reintegros: { icon: 'refresh', color: '#147c5b' },
  Regalos: { icon: 'gift', color: '#147c5b' },
  'Jubilación y asignaciones': { icon: 'wallet', color: '#147c5b' },
};
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
// Se evalúan antes que las reglas históricas a propósito: las categorías nuevas (p. ej. Auto,
// Deporte, Hogar) tienen visual propio aunque antes resolvieran por alias (Auto -> car, etc.).
// Las categorías sembradas y el resto de los alias conservan su visual.
const newCategories: Array<[RegExp, CategoryVisual]> = Object.entries(NEW_CATEGORY_VISUALS).map(
  ([name, visual]) => [new RegExp('^' + normalize(name) + '$'), visual],
);
const categories: Array<[RegExp, CategoryVisual]> = [
  [/^(compras|ropa|indumentaria)$/, { icon: 'bag', color: '#655ad8' }],
  [/^(supermercado|alimentacion|comida|comidas|super|despensa)$/, { icon: 'cart', color: '#147c5b' }],
  [/^(restaurantes?|gastronomia|delivery)$/, { icon: 'utensils', color: '#a25929' }],
  [/^(transporte|nafta|combustible|auto|vehiculos)$/, { icon: 'car', color: '#956719' }],
  [/^(educacion|estudios|cursos)$/, { icon: 'graduation', color: '#306cc4' }],
  [/^(salud|gimnasio|deporte|farmacia)$/, { icon: 'heart', color: '#b04570' }],
  [/^(sueldo|salario|trabajo|ingresos|honorarios)$/, { icon: 'briefcase', color: '#147c5b' }],
  [/^(servicios|impuestos|internet)$/, { icon: 'bolt', color: '#16738e' }],
  [/^(hogar|vivienda|alquiler)$/, { icon: 'home', color: '#8260b3' }],
  [/^(ocio|entretenimiento|salidas)$/, { icon: 'music', color: '#b55355' }],
];
// Solo presentación: no modifica nombres, categorías guardadas ni agrupación financiera.
export function categoryVisual(category: string): CategoryVisual {
  const normalized = normalize(category);
  return (
    [...newCategories, ...categories].find(([pattern]) => pattern.test(normalized))?.[1] ?? fallback
  );
}
export function movementVisual(category: string, kind: 'expense' | 'income') {
  const visual =
    kind === 'income' ? { icon: 'arrowUpRight' as const, color: '#147c5b' } : categoryVisual(category);
  return { ...visual, background: visual.color + '14' };
}
