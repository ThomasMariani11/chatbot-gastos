import { describe, expect, it } from 'vitest';
import { formatDraftList } from '../supabase/functions/whatsapp-webhook/draft-summary';
const row={position:1,kind:'expense' as const,description:'Super',amount:123.45,currency:'ARS',status:'pending'};
describe('resumen real compatible con borradores incompletos',()=>{
 it('conserva completos y describe los faltantes sin inventar cero',()=>{
  const body=formatDraftList([row,{...row,position:3,description:'Nafta',amount:null,occurred_on:null,missing_fields:['amount','date']}]);
  expect(body).toContain('123,45');expect(body).toContain('3. 🔴 Nafta');expect(body).toContain('importe pendiente');expect(body).toContain('fecha pendiente');expect(body).toContain('No se guarda nada');expect(body).not.toContain('$ 0');
 });
 it('mantiene USD, cuotas y fecha, sin sumar monedas',()=>{
  const body=formatDraftList([row,{...row,position:2,amount:10.01,currency:'USD',installments:3,first_installment_month:'2026-11',occurred_on:'2026-10-26'}]);
  expect(body).toContain('US$ 10,01 [USD]');expect(body).toContain('3 cuotas desde 2026-11');expect(body).toContain('2026-10-26');expect(body).not.toContain('Total');
 });
 it('no expone preguntas libres del proveedor y conserva posiciones',()=>{
  const body=formatDraftList([{...row,status:'removed'},{...row,position:4,missing_fields:['review'],clarification:'PRIVATE_PROVIDER_QUESTION'}]);
  expect(body).toContain('4.');expect(body).toContain('aclaración');expect(body).not.toContain('PRIVATE_');expect(body).not.toContain('1. 🔴');
 });
});
