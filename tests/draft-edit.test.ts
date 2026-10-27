import {describe,it,expect} from 'vitest';
import {parsePendingEdit,buildPendingEdit} from '../supabase/functions/whatsapp-webhook/draft-edit';
import {parseDraftCompletion} from '../supabase/functions/whatsapp-webhook/draft-completion';
const item={position:2,kind:'expense' as const,description:'Farmacia',amount:100.01,currency:'ARS',status:'pending',occurred_on:'2026-10-27'};
const context={group_id:'fixture-group',version:3,items:[item]};
describe('BE-12: correcciones locales explícitas y versionadas',()=>{
 it.each([
 ['El 2 fue de 1.234,50',{amount:1234.5}],['Cambiá el 2 a 5 mil',{amount:5000}],
 ['El 2 concepto Farmacia del Centro',{description:'Farmacia del Centro'}],['La operación 2 descripción Café',{description:'Café'}],
 ['El 2 categoría Salud',{category:'Salud'}],['El 2 moneda dólares',{currency:'USD'}],['El 2 moneda pesos',{currency:'ARS'}],
 ['El 2 fecha 2024-02-29',{occurred_on:'2024-02-29'}],['El 2 cuotas 3 desde 2026-11',{installments:3,first_installment_month:'2026-11'}],
 ['El 2 cuotas 1',{installments:1}],['El 2 tipo ingreso',{kind:'income'}],
 ['El 2: importe 250,25; moneda USD; concepto Café',{amount:250.25,currency:'USD',description:'Café'}]
 ])('interpreta %s sin alterar campos no indicados',(raw,patch)=>expect(parsePendingEdit(raw as string,context)).toEqual({kind:'edit',position:2,group_id:context.group_id,version:3,patch}));
 it.each(['El 2 fecha 2026-02-29','El 2 moneda EUR','El 2 cuotas 0','El 2 cuotas 61','El 2 cuotas 1 desde 2026-11','El 2 cuotas 3 desde 0000-11','El 2 importe 0','El 2 importe 123.456,789','El 2: importe 250; importe 300','El 2: importe 250; campo desconocido','El 2 concepto Café y el 3 monto 100','El 2: importe 100;','El 2 concepto '+ 'a'.repeat(161),'El 2 categoría '+'a'.repeat(41)])('pide aclaración sin cambios: %s',raw=>expect(parsePendingEdit(raw,context)?.kind).toBe('reply'));
 it('no inventa un destino si falta o fue quitado',()=>{expect(parsePendingEdit('El 1 moneda USD',context)?.kind).toBe('reply');expect(parsePendingEdit('El 2 moneda USD',{...context,items:[{...item,status:'removed'}]})?.kind).toBe('reply');expect(parsePendingEdit('El 2 moneda USD',{})?.kind).toBe('reply');});
 it('deja los gastos nuevos fuera de la ruta de edición',()=>expect(parsePendingEdit('Gasté 123 en farmacia',context)).toBeNull());
 it('un incompleto no impide editar otro completo',()=>{const ctx={...context,items:[item,{...item,position:3,amount:null,missing_fields:['amount']}]};expect(parseDraftCompletion('El 2 concepto Café',ctx,'2026-10-27')).toBeNull();expect(parsePendingEdit('El 2 concepto Café',ctx)).toMatchObject({kind:'edit',position:2});});
 it.each([{amount:1.001},{amount:0},{amount:NaN},{description:''},{category:''},{occurred_on:'2026-02-30'},{installments:1.5},{currency:'EUR'},{kind:'other'},{}])('valida también contratos de extractor/checkpoint: %o',patch=>expect(buildPendingEdit(2,patch as never,context).kind).toBe('reply'));
});
