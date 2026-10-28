import {describe,it,expect} from 'vitest';
import {normalizeDraftMovements} from '../supabase/functions/whatsapp-webhook/draft-normalization';
import {parseDraftCompletion} from '../supabase/functions/whatsapp-webhook/draft-completion';
import {parseDraftMovements,parseDeterministicMovements} from '../supabase/functions/whatsapp-webhook/local-movements';
const today='2026-10-26';
const complete={kind:'expense',description:'Super',totalAmountArs:123.45,currency:'ARS',occurredOn:today,category:'Otros',installments:1,firstInstallmentMonth:null,confidence:0,missingFields:[]};
const pending={position:2,kind:'expense' as const,description:'Nafta',amount:null,currency:'ARS',status:'pending',missing_fields:['amount']};
const context={group_id:'synthetic-group',version:2,items:[pending]};
describe('BE-08: normalización productiva',()=>{
 it('conserva lista completa, faltantes, dudas y confianza cero',()=>{
  const rows=normalizeDraftMovements([complete,{...complete,totalAmountArs:null,occurredOn:null,missingFields:['amount','date']}],today,'Indicar datos');
  expect(rows).toHaveLength(2);expect(rows[0].confidence).toBe(0);expect(rows[0].totalAmountArs).toBe(123.45);
  expect(rows[1]).toMatchObject({totalAmountArs:null,occurredOn:null,missingFields:['amount','date'],clarification:'Indicar datos'});
 });
 it('predetermina ARS/fecha/Otros únicamente donde corresponde',()=>{
  const rows=normalizeDraftMovements([{kind:'income',description:'Diseño',totalAmountArs:50,missingFields:['category'],category:null,occurredOn:null}],today,'¿Qué categoría?');
  expect(rows[0]).toMatchObject({currency:'ARS',occurredOn:today,category:'Otros',missingFields:[]});
 });
 it('conserva una duda global sin omitir ninguna propuesta',()=>{
  const rows=normalizeDraftMovements([complete,{...complete,kind:'income',currency:'USD'}],today,'Necesito aclarar');
  expect(rows).toHaveLength(2);expect(rows.every(m=>m.missingFields.includes('review'))).toBe(true);
 });
 it.each([{totalAmountArs:-1},{totalAmountArs:0},{totalAmountArs:1.001},{totalAmountArs:'5000'},{totalAmountArs:NaN},{currency:'EUR'},{occurredOn:'2026-02-31'},{confidence:1.01},{missingFields:['unknown']},{kind:'unknown'},{installments:0},{firstInstallmentMonth:'2026-13'}])('rechaza datos inválidos sin truncar la lista: %j',patch=>{
  expect(()=>normalizeDraftMovements([complete,{...complete,...patch}],today)).toThrow('INVALID_DRAFT_EXTRACTION');
 });
 it('una duda propia bloquea el ítem, salvo la categoría predeterminada',()=>{
  const review=normalizeDraftMovements([{...complete,clarification:'Aclarar operación'}],today);
  expect(review[0]).toMatchObject({missingFields:['review'],clarification:'Aclarar operación'});
  const defaults=normalizeDraftMovements([{...complete,missingFields:['category'],clarification:'¿Qué categoría?'}],today);
  expect(defaults[0].missingFields).toEqual([]);expect(defaults[0].clarification).toBeUndefined();
  expect(normalizeDraftMovements(defaults,today)).toEqual(defaults);
 });
 it('un concepto desconocido queda pendiente y no se inventa',()=>{
  expect(normalizeDraftMovements([{...complete,description:''}],today)[0]).toMatchObject({description:'Concepto pendiente',missingFields:['description']});
 });
});
describe('BE-08: parser local de borradores',()=>{
 it.each(['Gasté 101 en super y pagué alquiler','Gasté en nafta','Cobré por diseño','Gasté 100,50 en super y cobré por diseño'])('conserva lo comprendido y lo incompleto: %s',text=>{
  const rows=parseDraftMovements(text,today)!;expect(rows?.some(m=>m.totalAmountArs===null&&m.missingFields.includes('amount'))).toBe(true);
  expect(parseDeterministicMovements(text,today)).toBeNull();
 });
 it.each(['No gasté en nafta','Creo que pagué alquiler','Gasté dos millones en super','¿Pagué alquiler?','Compré iPhone 15'])('no amplía la vía conservadora ante ambigüedad: %s',text=>{
  expect(parseDraftMovements(text,today)).toBeNull();
 });
});
describe('BE-08: resolver datos, no agregar por accidente',()=>{
 it.each(['5000','El 2 fue de 5000'])('un único importe pendiente: %s',text=>{
  expect(parseDraftCompletion(text,context,today)).toMatchObject({kind:'complete',position:2,version:2,patch:{amount:5000}});
 });
 it('dos importes faltantes requieren posición explícita',()=>{
  expect(parseDraftCompletion('5000',{...context,items:[pending,{...pending,position:4}]},today)?.kind).toBe('reply');
  expect(parseDraftCompletion('El 4 fue de 5000',{...context,items:[pending,{...pending,position:4}]},today)).toMatchObject({kind:'complete',position:4});
 });
 it('no interpreta un gasto nuevo como completar',()=>{
  expect(parseDraftCompletion('Gasté 5000 en farmacia',context,today)).toBeNull();
 });
 it('fecha/concepto requieren un pendiente de ese campo',()=>{
  const both={...context,items:[{...pending,missing_fields:['date','description'],amount:50,occurred_on:null}]};
  expect(parseDraftCompletion('El 2 fecha 2026-10-26',both,today)).toMatchObject({kind:'complete',patch:{occurred_on:today}});
  expect(parseDraftCompletion('El 2 concepto Farmacia',both,today)).toMatchObject({kind:'complete',patch:{description:'Farmacia'}});
  expect(parseDraftCompletion('El 2 fecha 2026-02-31',both,today)?.kind).toBe('reply');
  expect(parseDraftCompletion('El 2 concepto farmacia',context,today)).toBeNull(); // Campo conocido: delegar al editor versionado.
 });
 it('una duda requiere reformulación explícita completa o quitar',()=>{
  const review={...context,items:[{...pending,amount:50,missing_fields:['review']}]};
  expect(parseDraftCompletion('5000',review,today)?.kind).toBe('reply');
  expect(parseDraftCompletion('El 2: gasté 5000 en farmacia',review,today)).toMatchObject({kind:'complete',patch:{movement:{totalAmountArs:5000,description:'Farmacia',missingFields:[]}}});
  expect(parseDraftCompletion('El 2: gasté 5000 en farmacia y cobré 1000',review,today)?.kind).toBe('reply');
 });
});
