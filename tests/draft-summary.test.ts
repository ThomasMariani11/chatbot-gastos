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
 it('acota veinte conceptos largos sin perder posiciones, cifras ni cuotas',()=>{
  const rows=Array.from({length:20},(_,i)=>({...row,position:i+1,description:'💰'.repeat(80),amount:999999999999.99,currency:i%2?'USD':'ARS',occurred_on:'2026-10-26',installments:60,first_installment_month:'2026-11',missing_fields:['review']}));
  const body=formatDraftList(rows);expect(body.length).toBeLessThanOrEqual(4096);
  expect(body).toContain('Conceptos o categorías abreviados');expect(body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  for(let i=1;i<=20;i++)expect(body).toContain(i+'. 🔴');
  expect(body.match(/999\.999\.999\.999,99/g)).toHaveLength(20);expect(body.match(/60 cuotas desde 2026-11/g)).toHaveLength(20);
  expect(rows[0].description).toHaveLength(160);
 });
 it('veinte ítems sin datos caben completos y una capacidad inválida no se anuncia como mostrada',()=>{
  const rows=Array.from({length:20},(_,i)=>({...row,position:i+1,description:'',amount:null,occurred_on:null,missing_fields:['amount','date','description','review']}));
  const body=formatDraftList(rows);expect(body.length).toBeLessThanOrEqual(4096);expect(body.match(/Falta: importe, fecha, concepto, aclaración/g)).toHaveLength(20);
  expect(()=>formatDraftList([...rows,{...rows[0],position:21}])).toThrow('DRAFT_SUMMARY_CAPACITY');
 });
 it('no expone preguntas libres del proveedor y conserva posiciones',()=>{
  const body=formatDraftList([{...row,status:'removed'},{...row,position:4,missing_fields:['review'],clarification:'PRIVATE_PROVIDER_QUESTION'}]);
  expect(body).toContain('4.');expect(body).toContain('aclaración');expect(body).not.toContain('PRIVATE_');expect(body).not.toContain('1. 🔴');
 });
});

it('BE-12: categorías largas y Unicode no ocultan cifras, fecha ni cuotas',()=>{
 const rows=Array.from({length:20},(_,i)=>({...row,position:2147483600+i,category_name:'💰'.repeat(20),description:'💰'.repeat(80),amount:999999999999.99,currency:'USD',occurred_on:'2026-10-26',installments:60,first_installment_month:'2026-11',missing_fields:['review']}));
 const body=formatDraftList(rows);expect(body.length).toBeLessThanOrEqual(4096);expect(body.match(/Cat:/g)).toHaveLength(20);expect(body.match(/999\.999\.999\.999,99/g)).toHaveLength(20);expect(body.match(/60 cuotas desde 2026-11/g)).toHaveLength(20);expect(body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});
