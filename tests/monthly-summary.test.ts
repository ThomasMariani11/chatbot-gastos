import { describe, expect, it } from 'vitest';
import { formatMonthlySnapshot, parseMonthlySnapshot } from '../supabase/functions/whatsapp-webhook/monthly-summary';
import { failureMetadata } from '../supabase/functions/whatsapp-webhook/failures';
const sample=(): {version:number;month:string;budget_ars:string|null;remaining_budget_ars:string|null;currencies:Array<{currency:string;expenses:string;income:string;balance:string;operations:string}>}=>({version:1,month:'2026-02',budget_ars:'1000.00',remaining_budget_ars:'874.50',currencies:[{currency:'ARS',expenses:'125.50',income:'500.00',balance:'374.50',operations:'2'},{currency:'USD',expenses:'10.01',income:'20.02',balance:'10.01',operations:'2'}]});
describe('BE-09: respuesta exacta por moneda y contrato inválido cerrado',()=>{
 it('formatea saldos y disponible de presupuesto identificando ARS/USD',()=>{
  const body=formatMonthlySnapshot(sample(),'2026-02');expect(body).toContain('Pesos (ARS)');expect(body).toContain('Dólares (USD)');expect(body).toContain('Disponible del presupuesto (ARS): $ 874,50');expect(body).toContain('Balance neto: US$ 10,01');
 });
 it('no convierte sumas grandes a Number ni pierde un centavo',()=>{
  const v=sample();v.budget_ars=null;v.remaining_budget_ars=null;v.currencies[1]={currency:'USD',expenses:'0.01',income:'9007199254740993.01',balance:'9007199254740993.00',operations:'2'};
  const body=formatMonthlySnapshot(v,'2026-02');expect(body).toContain('US$ 9.007.199.254.740.993,01');expect(body).toContain('Balance neto: US$ 9.007.199.254.740.993');
 });
 it('presupuesto y balance negativos no se mezclan entre monedas',()=>{
  const v=sample();v.currencies[0]={currency:'ARS',expenses:'1001.01',income:'0',balance:'-1001.01',operations:'1'};v.remaining_budget_ars='-1.01';const body=formatMonthlySnapshot(v,'2026-02');expect(body).toContain('Balance neto: $ -1.001,01');expect(body).toContain('Disponible del presupuesto (ARS): $ -1,01');
 });
 it('cero real no equivale a ausencia de respuesta y oculta una moneda sin movimientos',()=>{
  const v=sample();v.budget_ars=null;v.remaining_budget_ars=null;v.currencies=v.currencies.map(r=>({...r,expenses:'0',income:'0',balance:'0',operations:'0'}));const body=formatMonthlySnapshot(v,'2026-02');expect(body).toContain('Balance neto: $ 0');expect(body).not.toContain('Dólares (USD)');expect(body).toContain('presupuesto mensual en pesos');
 });
 it.each([null,{},[],{...sample(),version:2},{...sample(),month:'2026-03'},{...sample(),currencies:[]},{...sample(),budget_ars:undefined},{...sample(),remaining_budget_ars:'0'}])('rechaza contrato parcial o incompatible %j',value=>{
  let failure:unknown;try{parseMonthlySnapshot(value,'2026-02');}catch(error){failure=error;}expect(failureMetadata(failure)).toEqual({reason:'database_read',provider:'database',operation:'QUEUE_BALANCE_READ'});
 });
 it.each(['NaN','Infinity','1e3','0.001','1,50','01.00','PRIVATE_SQL_DETAIL'])('rechaza importe no canónico %s sin filtrar el valor en el error',value=>{
  const v=sample();v.currencies[0].expenses=value;let error:unknown;try{parseMonthlySnapshot(v,'2026-02');}catch(e){error=e;}expect(String(error)).toBe('Error: OPERATIONAL_FAILURE');expect(String(error)).not.toContain(value);
 });
 it('rechaza números JSON que ya podrían haber perdido precisión',()=>{
  const v=sample();v.currencies[0].income=500 as never;expect(()=>parseMonthlySnapshot(v,'2026-02')).toThrow('OPERATIONAL_FAILURE');
 });
 it('rechaza duplicados y saldos inconsistentes aunque parezcan valores válidos',()=>{
  const duplicate=sample();duplicate.currencies[1]=duplicate.currencies[0];expect(()=>parseMonthlySnapshot(duplicate,'2026-02')).toThrow();const wrong=sample();wrong.currencies[0].balance='0';expect(()=>parseMonthlySnapshot(wrong,'2026-02')).toThrow();
 });
});
