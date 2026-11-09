import { describe, expect, it } from 'vitest';
import { formatDraftList, friendlyDate } from '../supabase/functions/whatsapp-webhook/draft-summary';
import { BOT_MESSAGES } from '../supabase/functions/whatsapp-webhook/bot-messages';
const TODAY='2026-11-09';
const row={position:1,kind:'expense' as const,description:'Super',amount:123.45,currency:'ARS',status:'pending'};
describe('resumen real compatible con borradores incompletos',()=>{
 it('conserva completos y describe los faltantes sin inventar cero',()=>{
  const body=formatDraftList([row,{...row,position:3,description:'Nafta',amount:null,occurred_on:null,missing_fields:['amount','date']}],TODAY);
  expect(body).toContain('123,45');expect(body).toContain('3. *Gasto* Nafta — importe pendiente');expect(body).toContain('⚠️ Falta: importe, fecha');
  expect(body).toContain('Me faltan algunos datos');expect(body).toContain('"el 3 fue de 5000"');expect(body).not.toContain('$ 0');
 });
 it('mantiene USD, cuotas y fecha, sin sumar monedas',()=>{
  const body=formatDraftList([row,{...row,position:2,amount:10.01,currency:'USD',installments:3,first_installment_month:'2026-11',occurred_on:'2026-10-26'}],TODAY);
  expect(body).toContain('2. *Gasto* Super — US$ 10,01 en 3 cuotas desde nov. · 26/10');expect(body).not.toContain('[USD]');expect(body).not.toContain('Total');
 });
 it('arma un renglón por movimiento con tipo escrito, categoría y fecha amigable',()=>{
  const body=formatDraftList([
   {...row,description:'Súper',amount:1500,occurred_on:TODAY,category_name:'Alimentación'},
   {...row,position:2,kind:'income' as const,description:'Diseño logo',amount:200,currency:'USD',occurred_on:'2026-11-07',category_name:'Freelance'},
  ],TODAY);
  expect(body.startsWith('📝 Tenés 2 movimientos para guardar:\n\n')).toBe(true);
  expect(body).toContain('1. *Gasto* Súper — $ 1.500 · Alimentación · hoy\n');
  expect(body).toContain('2. *Ingreso* Diseño logo — US$ 200 · Freelance · 07/11\n');
  expect(body).toContain('Respondé *CONFIRMAR* para guardarlos ✅');expect(body).toContain('"quitá el 1"');
  expect(body).not.toContain('Cat:');expect(body).not.toContain('🔴');expect(body).not.toContain('🟢');
 });
 it('cuotas que empiezan el mismo mes no repiten "desde"',()=>{
  const body=formatDraftList([{...row,installments:12,first_installment_month:'2026-11',occurred_on:'2026-11-02'}],TODAY);
  expect(body).toContain('en 12 cuotas · 02/11');expect(body).not.toContain('desde');
 });
 it('fechas: hoy, ayer, día/mes y año solo si es otro',()=>{
  expect(friendlyDate('2026-11-09',TODAY)).toBe('hoy');expect(friendlyDate('2026-11-08',TODAY)).toBe('ayer');
  expect(friendlyDate('2026-10-31','2026-11-01')).toBe('ayer');expect(friendlyDate('2025-12-31','2026-01-01')).toBe('ayer');
  expect(friendlyDate('2026-03-05',TODAY)).toBe('05/03');expect(friendlyDate('2025-03-05',TODAY)).toBe('05/03/2025');
 });
 it('lista vacía usa el texto nuevo',()=>{expect(formatDraftList([],TODAY)).toBe(BOT_MESSAGES.emptyList);});
 it('acota veinte conceptos largos sin perder posiciones, cifras ni cuotas',()=>{
  const rows=Array.from({length:20},(_,i)=>({...row,position:i+1,description:'💰'.repeat(80),amount:999999999999.99,currency:i%2?'USD':'ARS',occurred_on:'2026-10-26',installments:60,first_installment_month:'2026-11',category_name:'Restaurantes y delivery',missing_fields:['review']}));
  const body=formatDraftList(rows,TODAY);expect(body.length).toBeLessThanOrEqual(4096);
  expect(body).toContain(BOT_MESSAGES.abbreviated);expect(body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  for(let i=1;i<=20;i++)expect(body).toContain(i+'. *Gasto* ');
  expect(body.match(/999\.999\.999\.999,99/g)).toHaveLength(20);expect(body.match(/60 cuotas desde nov\./g)).toHaveLength(20);
  expect(rows[0].description).toHaveLength(160);
 });
 it('veinte ítems sin datos caben completos y una capacidad inválida no se anuncia como mostrada',()=>{
  const rows=Array.from({length:20},(_,i)=>({...row,position:i+1,description:'',amount:null,occurred_on:null,missing_fields:['amount','date','description','review']}));
  const body=formatDraftList(rows,TODAY);expect(body.length).toBeLessThanOrEqual(4096);expect(body.match(/Falta: importe, fecha, concepto, aclaración/g)).toHaveLength(20);
  expect(()=>formatDraftList([...rows,{...rows[0],position:21}],TODAY)).toThrow('DRAFT_SUMMARY_CAPACITY');
 });
 it('no expone preguntas libres del proveedor y conserva posiciones',()=>{
  const body=formatDraftList([{...row,status:'removed'},{...row,position:4,missing_fields:['review'],clarification:'PRIVATE_PROVIDER_QUESTION'}],TODAY);
  expect(body).toContain('4. *Gasto*');expect(body).toContain('aclaración');expect(body).not.toContain('PRIVATE_');expect(body).not.toContain('1. *Gasto*');
 });
});
