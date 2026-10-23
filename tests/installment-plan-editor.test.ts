import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/supabase', () => ({ supabase: {} }));
import { planPatch, parsePlanSnapshot, type PlanRow } from '../src/installmentPlans';
const original: PlanRow = { id:'one',description:'Compra',amount_ars:33.34,currency:'ARS',occurred_on:'2026-03-31',category_id:'cat',kind:'expense',installment_number:3,installment_count:3,installment_group_id:'group' };
const edit = {description:'Compra',amount:33.34,currency:'ARS' as const,categoryId:'cat',date:'2026-03-31',number:3,count:3};
describe('patch del formulario de cuotas', () => {
 it('renombrar no manda importes, fechas, números ni cantidad', () => { expect(planPatch(original,{...edit,description:'Nombre nuevo'},true)).toEqual({description:'Nombre nuevo'}); });
 it('una categoría nueva no toca centavos', () => { expect(planPatch(original,{...edit,categoryId:'otra'},true)).toEqual({category_id:'otra'}); });
 it('reprograma solo cuando se cambia la referencia y mantiene la fecha individual aislada', () => { expect(planPatch(original,{...edit,date:'2026-04-30'},true)).toEqual({schedule:{date:'2026-04-30',number:3}});expect(planPatch(original,{...edit,date:'2026-04-30'},false)).toEqual({occurred_on:'2026-04-30'}); });
 it('ampliar agrega solo cuotas nuevas sin redistribuir las existentes', () => { expect(planPatch(original,{...edit,count:4},true)).toEqual({installment_count:4,new_installment_amount:33.34}); });
 it('reducir y ajustar automáticamente la referencia no cambia fechas', () => { expect(planPatch(original,{...edit,count:2,number:2},true)).toEqual({installment_count:2}); });
 it('rechaza cambios estructurales o de moneda sobre una sola cuota', () => { expect(()=>planPatch(original,{...edit,currency:'USD'},false)).toThrow();expect(()=>planPatch(original,{...edit,count:4},false)).toThrow(); });
 it('rechaza respuestas malformadas en vez de permitir un guardado sin versión', () => { expect(()=>parsePlanSnapshot({group_id:'group',rows:[]})).toThrow(); });
});