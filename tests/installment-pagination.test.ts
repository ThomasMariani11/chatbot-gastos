import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/supabase',()=>({supabase:{}}));
import { readDashboardSnapshot } from '../src/dashboardData';
import type { supabase } from '../src/supabase';
const item = (n:number) => ({id:String(n).padStart(6,'0'),description:'Ficticio',amount_ars:10,currency:'ARS',kind:'expense',occurred_on:'2026-10-25',installment_count:3,installment_number:1,installment_group_id:'plan-'+n});
function clientFor(input: { data: ReturnType<typeof item>[]; cap?: number; pageError?: number; missingCount?: boolean; changeCount?: boolean; repeated?: boolean; abort?: AbortController }) {
 let pages=0;
 function query(table:string) {
  let plan=false,month=false,cursor='';const chain={select:()=>chain,eq:()=>chain,gte:()=>{month=true;return chain;},lt:()=>chain,gt:(key:string,value:string)=>{if(key==='id')cursor=value;else plan=true;return chain;},order:()=>chain,limit:()=>chain,abortSignal:()=>chain,maybeSingle:()=>chain,
   then:(done:(value:unknown)=>unknown,fail:(error:unknown)=>unknown)=>{
    if(table==='transactions'&&plan){pages++;const remaining=input.data.filter(row=>row.id>cursor), data=input.repeated&&pages>1?[input.data[0]]:remaining.slice(0,input.cap??250);
      const response=pages===input.pageError?{data:null,error:true}:{data,error:null,...(input.missingCount?{}:{count:remaining.length+(input.changeCount&&pages>1?1:0)})};if(input.abort&&pages===2)input.abort.abort();return Promise.resolve(response).then(done,fail);}
    const data=table==='transactions'?month?[]:[]:table==='budgets'?null:table==='app_settings'?{whatsapp_responses_enabled:true}:table==='whatsapp_links'?{status:'active'}:table==='months'?['2026-10']:null;
    return Promise.resolve({data,error:null}).then(done,fail);
   }};return chain;
 }
 return {client:{from:query,rpc:()=>query('months')} as unknown as typeof supabase,pages:()=>pages};
}
describe('lectura completa de cuotas antes de calcular totales',()=>{
 it('lee más de mil filas sin asumir que una página es el total',async()=>{const input=Array.from({length:1003},(_,i)=>item(i+1));const api=clientFor({data:input});const result=await readDashboardSnapshot('a','2026-10',new AbortController().signal,api.client);expect(result.installments).toEqual(input);expect(api.pages()).toBe(5);});
 it('respeta un límite del servidor menor al tamaño pedido',async()=>{const input=Array.from({length:18},(_,i)=>item(i+1));const api=clientFor({data:input,cap:7});expect((await readDashboardSnapshot('a','2026-10',new AbortController().signal,api.client)).installments).toHaveLength(18);expect(api.pages()).toBe(3);});
 it('un resultado vacío con count cero sí es completo',async()=>{const api=clientFor({data:[]});expect((await readDashboardSnapshot('a','2026-10',new AbortController().signal,api.client)).installments).toEqual([]);});
 it.each([{pageError:2},{missingCount:true},{changeCount:true},{repeated:true},{cap:0}])('no publica subtotales ante fallos/inconsistencias %j',async extra=>{const api=clientFor({data:[item(1),item(2),item(3)],cap:2,...extra});await expect(readDashboardSnapshot('a','2026-10',new AbortController().signal,api.client)).rejects.toThrow('financiera');});
 it('cancela entre páginas sin seguir acumulando ni publicar lo incompleto',async()=>{const abort=new AbortController(),api=clientFor({data:[item(1),item(2),item(3)],cap:1,abort});await expect(readDashboardSnapshot('a','2026-10',abort.signal,api.client)).rejects.toThrow();expect(api.pages()).toBe(2);});
});
