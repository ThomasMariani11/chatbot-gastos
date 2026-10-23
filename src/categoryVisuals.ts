import type { IconName } from './Icons';
type CategoryVisual = { icon: IconName; color: string };
const fallback: CategoryVisual = { icon: 'receipt', color: '#596d78' };
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
  const normalized = category.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return categories.find(([pattern]) => pattern.test(normalized))?.[1] ?? fallback;
}
export function movementVisual(category: string, kind: 'expense' | 'income') {
  const visual = kind === 'income' ? { icon: 'arrowUpRight' as const, color: '#147c5b' } : categoryVisual(category);
  return { ...visual, background: visual.color + '14' };
}
