import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/supabase',()=>({supabase:{}}));
import { EntrySender, readEntryAttempt, validateDraft, entryError, type EntryStorage, type EntryDraft, type EntryResult, type EntryAttempt } from '../src/pwaEntries';
const user='00000000-0000-4000-8000-000000000001';
const entity='00000000-0000-4000-8000-000000000099';
const draft:EntryDraft={type:'movement',payload:{description:'Prueba ficticia',amount:123.45,currency:'ARS',category_id:entity,kind:'expense',occurred_on:'2026-10-23'}};
const saved:EntryResult={state:'saved',entity_id:entity,entry_type:'movement',replayed:false};
function storage(){const data=new Map<string,string>();return {data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
describe('envíos PWA persistentes',()=>{
 it('excluye doble clic/Enter antes de que React deshabilite el botón',async()=>{
  const wait=deferred<EntryResult>(),send=vi.fn(()=>wait.promise),store=storage(),sender=new EntrySender(user,store,send);
  const first=sender.run(draft);expect(sender.busy).toBe(true);expect(sender.pending()?.requestId).toBeTruthy();expect(await sender.run(draft)).toBeNull();expect(send).toHaveBeenCalledTimes(1);
  wait.resolve(saved);await first;expect(sender.busy).toBe(false);expect(sender.pending()).toBeNull();
 });
 it('tras guardar y perder la respuesta, una recarga reutiliza el UUID y payload',async()=>{
  const store=storage(),send=vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({...saved,replayed:true});
  const one=new EntrySender(user,store,send);await expect(one.run(draft)).rejects.toThrow('timeout');const pending=one.pending()!;
  const reloaded=new EntrySender(user,store,send);expect(reloaded.pending()).toEqual(pending);const retry=await reloaded.run();expect(retry?.result.replayed).toBe(true);
  expect(send.mock.calls.map(call=>call[0].requestId)).toEqual([pending.requestId,pending.requestId]);expect(store.data.size).toBe(0);
 });
 it('salir durante el envío conserva el intento para recuperar al volver',async()=>{
  const wait=deferred<EntryResult>(),store=storage(),sender=new EntrySender(user,store,()=>wait.promise);const sending=sender.run(draft);const id=sender.pending()!.requestId;sender.deactivate();wait.resolve(saved);expect(await sending).toBeNull();expect(sender.pending()!.requestId).toBe(id);
  const reloaded=new EntrySender(user,store,async()=>({...saved,replayed:true}));expect((await reloaded.run())?.attempt.requestId).toBe(id);expect(reloaded.pending()).toBeNull();
 });
 it('el ciclo setup/cleanup de StrictMode permite usar el gestor nuevamente',async()=>{const sender=new EntrySender(user,storage(),async()=>saved);sender.activate();sender.deactivate();sender.activate();expect((await sender.run(draft))?.result.state).toBe('saved');});
 it('otro envío intencional igual obtiene otro UUID después de confirmar el anterior',async()=>{
  const send=vi.fn(async(_attempt:EntryAttempt)=>saved),sender=new EntrySender(user,storage(),send);await sender.run(draft);await sender.run(draft);expect(send.mock.calls).toHaveLength(2);expect(send.mock.calls[0][0].requestId).not.toBe(send.mock.calls[1][0].requestId);
 });
 it('no transmite si el almacenamiento rechaza escribir o guardar realmente',async()=>{
  for(const store of [{...storage(),setItem:()=>{throw Error('quota');}},{...storage(),setItem:()=>{}}]){const send=vi.fn(async()=>saved);await expect(new EntrySender(user,store,send).run(draft)).rejects.toThrow('navegador');expect(send).not.toHaveBeenCalled();}
 });
 it('una respuesta inválida o fallo al limpiar conserva la identidad del envío',async()=>{
  const store=storage();const bad=new EntrySender(user,store,vi.fn(async()=>({}) as EntryResult));await expect(bad.run(draft)).rejects.toThrow('resultado');const id=bad.pending()!.requestId;
  const cannotClear:EntryStorage={...store,removeItem:()=>{throw Error('blocked');}};await expect(new EntrySender(user,cannotClear,async()=>saved).run()).rejects.toThrow('cerrar el envío');expect(bad.pending()!.requestId).toBe(id);
  const done=new EntrySender(user,store,async()=>({...saved,replayed:true}));await done.run();expect(done.pending()).toBeNull();
 });
 it('una respuesta de otro tipo no descarta el intento pendiente',async()=>{const sender=new EntrySender(user,storage(),async()=>({...saved,entry_type:'plan'}));await expect(sender.run(draft)).rejects.toThrow('resultado');expect(sender.pending()?.type).toBe('movement');});
 it('no cambia silenciosamente los datos de un envío pendiente',async()=>{
  const store=storage(),send=vi.fn().mockRejectedValue(new Error('network'));const sender=new EntrySender(user,store,send);await expect(sender.run(draft)).rejects.toThrow();
  await expect(sender.run({...draft,payload:{...draft.payload,amount:999}})).rejects.toThrow('pendiente');expect(send).toHaveBeenCalledTimes(1);
 });
 it('aísla usuarios y no descarta una identidad corrupta como si no hubiera envío',async()=>{
  const store=storage(),send=vi.fn().mockRejectedValue(new Error('network'));await expect(new EntrySender(user,store,send).run(draft)).rejects.toThrow();
  expect(readEntryAttempt(store,entity)).toBeNull();const k=[...store.data.keys()][0];store.data.set(k,'{broken');await expect(new EntrySender(user,store,send).run(draft)).rejects.toThrow('recuperar');expect(store.data.get(k)).toBe('{broken');expect(send).toHaveBeenCalledTimes(1);
 });
 it('cancelar un envío incierto pregunta al servidor sin enviar otro payload',async()=>{
  const send=vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({...saved,replayed:true});const sender=new EntrySender(user,storage(),send);await expect(sender.run(draft)).rejects.toThrow();const before=sender.pending()!.requestId;
  const result=await sender.run(undefined,true);expect(send.mock.calls[1][0].requestId).toBe(before);expect(send.mock.calls[1][1]).toBe(true);expect(result?.result.state).toBe('saved');expect(sender.pending()).toBeNull();
 });
 it('cancelar antes del guardado resuelve el intento y permite otra intención',async()=>{
  const send=vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({state:'cancelled',entity_id:null,entry_type:'movement',replayed:false});const sender=new EntrySender(user,storage(),send);await expect(sender.run(draft)).rejects.toThrow();expect((await sender.run(undefined,true))?.result.state).toBe('cancelled');expect(sender.pending()).toBeNull();
 });
 it('conserva planes y clona el payload antes de transmitir',async()=>{
  const plan:EntryDraft={type:'plan',payload:{description:'Cuotas',amount:100,currency:'USD',category_id:entity,amount_mode:'total',installment_count:3,reference_date:'2026-01-31',reference_number:1}};
  const wait=deferred<EntryResult>(),store=storage(),sender=new EntrySender(user,store,()=>wait.promise);const operation=sender.run(plan);plan.payload.amount=900;expect(sender.pending()?.payload.amount).toBe(100);wait.resolve({...saved,entry_type:'plan'});await operation;
 });
 it('valida datos antes de persistir y no filtra errores técnicos',()=>{
  for(const patch of [{amount:0},{amount:NaN},{amount:1.001},{occurred_on:'2026-02-30'},{currency:'EUR'},{description:''}])expect(()=>validateDraft({...draft,payload:{...draft.payload,...patch}})).toThrow();
  expect(()=>validateDraft({...draft,payload:{...draft.payload,occurred_on:'2028-02-29'}})).not.toThrow();expect(entryError({code:'XX000',message:'PRIVATE_BODY'})).not.toContain('PRIVATE');
 });
});