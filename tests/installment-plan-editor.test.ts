import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/supabase', () => ({ supabase: {} }));
import {
  INSTALLMENT_BOUNDS_ERROR,
  isValidInstallmentCount,
  isValidInstallmentSchedule,
  MAX_INSTALLMENT_COUNT,
  MIN_INSTALLMENT_COUNT,
  parseInstallmentCountInput,
  parsePlanSnapshot,
  planPatch,
  type PlanRow,
} from '../src/installmentPlans';

const original: PlanRow = { id:'one',description:'Compra',amount_ars:33.34,currency:'ARS',occurred_on:'2026-03-31',category_id:'cat',kind:'expense',installment_number:3,installment_count:3,installment_group_id:'group' };
const edit = {description:'Compra',amount:33.34,currency:'ARS' as const,categoryId:'cat',date:'2026-03-31',number:3,count:3};

describe('patch del formulario de cuotas y validación FE-10', () => {
  it('renombrar no manda importes, fechas, números ni cantidad', () => { expect(planPatch(original,{...edit,description:'Nombre nuevo'},true)).toEqual({description:'Nombre nuevo'}); });
  it('una categoría nueva no toca centavos', () => { expect(planPatch(original,{...edit,categoryId:'otra'},true)).toEqual({category_id:'otra'}); });
  it('reprograma solo cuando se cambia la referencia y mantiene la fecha individual aislada', () => { expect(planPatch(original,{...edit,date:'2026-04-30'},true)).toEqual({schedule:{date:'2026-04-30',number:3}});expect(planPatch(original,{...edit,date:'2026-04-30'},false)).toEqual({occurred_on:'2026-04-30'}); });
  it('ampliar agrega solo cuotas nuevas sin redistribuir las existentes', () => { expect(planPatch(original,{...edit,count:4},true)).toEqual({installment_count:4,new_installment_amount:33.34}); });
  it('reducir y ajustar automáticamente la referencia no cambia fechas', () => { expect(planPatch(original,{...edit,count:2,number:2},true)).toEqual({installment_count:2}); });
  it('rechaza cambios estructurales o de moneda sobre una sola cuota', () => { expect(()=>planPatch(original,{...edit,currency:'USD'},false)).toThrow();expect(()=>planPatch(original,{...edit,count:4},false)).toThrow(); });
  it('rechaza respuestas malformadas en vez de permitir un guardado sin versión', () => { expect(()=>parsePlanSnapshot({group_id:'group',rows:[]})).toThrow(); });

  it('FE-10: comparte el contrato exacto de 2 a 60 cuotas y acepta los extremos válidos', () => {
    expect(MIN_INSTALLMENT_COUNT).toBe(2);
    expect(MAX_INSTALLMENT_COUNT).toBe(60);
    expect(isValidInstallmentCount(2)).toBe(true);
    expect(isValidInstallmentCount(60)).toBe(true);
    expect(parseInstallmentCountInput('2')).toBe(2);
    expect(parseInstallmentCountInput(' 60 ')).toBe(60);
    expect(parseInstallmentCountInput('08')).toBe(8);
    expect(planPatch(original, { ...edit, count: 2, number: 2 }, true)).toEqual({ installment_count: 2 });
    expect(planPatch(original, { ...edit, count: 60, number: 3 }, true)).toEqual({ installment_count: 60, new_installment_amount: 33.34 });
  });

  it('FE-10: rechaza cantidades fuera de rango, decimales, fraccionarios y textos inválidos', () => {
    for (const invalid of [0, 1, -3, 61, 120, 2.5, 3.14, NaN, Infinity]) {
      expect(isValidInstallmentCount(invalid)).toBe(false);
      expect(parseInstallmentCountInput(invalid)).toBeNull();
      expect(() => planPatch(original, { ...edit, count: invalid, number: 1 }, true)).toThrow(INSTALLMENT_BOUNDS_ERROR);
    }
    for (const invalidStr of ['', '   ', '1', '0', '-5', '61', '120', '3.5', '3,5', '2e1', 'abc', '12cuotas']) {
      expect(parseInstallmentCountInput(invalidStr)).toBeNull();
    }
  });

  it('FE-10: rechaza números de cuota de referencia fuera de rango o fraccionarios en planPatch y snapshot', () => {
    for (const badNumber of [0, -1, 4, 61, 1.5, NaN]) {
      expect(isValidInstallmentSchedule(3, badNumber)).toBe(false);
      expect(() => planPatch(original, { ...edit, count: 3, number: badNumber }, true)).toThrow(INSTALLMENT_BOUNDS_ERROR);
    }
    expect(() =>
      parsePlanSnapshot({
        group_id: 'group',
        version: 'a'.repeat(32),
        rows: [{ ...original, installment_count: 61 }],
      }),
    ).toThrow('Cuota inválida.');
    expect(() =>
      parsePlanSnapshot({
        group_id: 'group',
        version: 'a'.repeat(32),
        rows: [{ ...original, installment_count: 3, installment_number: 4 }],
      }),
    ).toThrow('Cuota inválida.');
  });
});
