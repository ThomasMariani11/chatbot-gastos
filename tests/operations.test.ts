import { describe,it,expect,vi } from 'vitest';
import { createOperationalMetrics,deliverOperationalNotice } from '../supabase/functions/whatsapp-webhook/operations';
import { OperationalFailure } from '../supabase/functions/whatsapp-webhook/failures';
const free=async()=>true;
const notice={test_sender_digits:'15550000000',id:'synthetic-notice',to:'synthetic-admin',snapshot:[{code:'queue_delay',affected:2,oldest_seconds:180}]};
describe('INF-14: telemetría y avisos independientes de las operaciones',()=>{
 it('guarda solo campos permitidos y un solo lote de métricas',async()=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});
  try{const buffer=createOperationalMetrics();buffer.metric('queue_wait',{duration_ms:20,text:'PRIVATE'} as never);const rpc=vi.fn(async()=>null);await buffer.flush(rpc as never);await buffer.flush(rpc as never);expect(rpc).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[0]).toEqual(['record_whatsapp_ops_metrics',{p_samples:[{event:'queue_wait',duration_ms:20}]}]);}finally{log.mockRestore();}
 });
 it('métricas caídas no arrojan ni se reintentan',async()=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});try{const buffer=createOperationalMetrics();buffer.metric('queue_worker',{duration_ms:10});const rpc=vi.fn(async()=>{throw Error('PRIVATE_ERROR')});await expect(buffer.flush(rpc as never)).resolves.toBeUndefined();await buffer.flush(rpc as never);expect(rpc).toHaveBeenCalledTimes(1);expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_ERROR');}finally{log.mockRestore();}
 });
 it('limita memoria a 256 muestras y avisa del descarte de telemetría',async()=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});try{const buffer=createOperationalMetrics();for(let i=0;i<300;i++)buffer.metric('queue_worker',{duration_ms:1});const rpc=vi.fn(async()=>null);await buffer.flush(rpc as never);expect((rpc.mock.calls[0] as unknown as [string,{p_samples:unknown[]}])[1].p_samples).toHaveLength(256);expect(log.mock.calls.map(([line])=>JSON.parse(String(line))).find(e=>e.event==='ops_error')).toMatchObject({dropped:44});}finally{log.mockRestore();}
 });
 it('un aviso técnico contiene solo etiquetas y conteos y se confirma al enviar',async()=>{
  const send=vi.fn(async()=>{});const rpc=vi.fn(async(name:string)=>name==='claim_whatsapp_ops_notice'?notice:null);await deliverOperationalNotice(rpc as never,send,free);expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0]).toEqual([notice.to,expect.stringContaining('Mensajes demorados')]);expect(rpc.mock.calls.map(c=>c[0])).toEqual(['claim_whatsapp_ops_notice','finish_whatsapp_ops_notice']);
 });
 it('sin aviso pendiente no intenta enviar',async()=>{const send=vi.fn(async()=>{});await deliverOperationalNotice((async()=>null) as never,send,free);expect(send).not.toHaveBeenCalled();});
 it.each([{error:new OperationalFailure('request_rejected','meta_send',400),outcome:'failed'},{error:new OperationalFailure('timeout','meta_send'),outcome:'uncertain'}])('un fallo registra el estado $outcome sin duplicar ni filtrar contenido',async({error,outcome})=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});try{const send=vi.fn(async()=>{throw error});const rpc=vi.fn(async(name:string)=>name==='claim_whatsapp_ops_notice'?notice:null);await deliverOperationalNotice(rpc as never,send,free);expect(send).toHaveBeenCalledTimes(1);expect(rpc).toHaveBeenLastCalledWith('finish_whatsapp_ops_notice',expect.objectContaining({p_outcome:outcome}));expect(JSON.stringify(log.mock.calls)).not.toContain(notice.to);}finally{log.mockRestore();}
 });
 it('un ack perdido después de enviar no provoca otro envío',async()=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});try{const send=vi.fn(async()=>{});const rpc=vi.fn(async(name:string)=>{if(name==='claim_whatsapp_ops_notice')return notice;throw Error('PRIVATE_ACK_ERROR')});await expect(deliverOperationalNotice(rpc as never,send,free)).resolves.toBeUndefined();expect(send).toHaveBeenCalledTimes(1);}finally{log.mockRestore();}
 });
});


it('un emisor no verificado se bloquea sin enviar ni usar plantillas pagas',async()=>{const send=vi.fn(async()=>{});const rpc=vi.fn(async(name:string)=>name==='claim_whatsapp_ops_notice'?notice:null);await deliverOperationalNotice(rpc as never,send,async()=>false);expect(send).not.toHaveBeenCalled();expect(rpc).toHaveBeenLastCalledWith('finish_whatsapp_ops_notice',expect.objectContaining({p_outcome:'blocked'}));});

const detailedIssue={id:'synthetic-issue',client_name:'Clienta Ficticia',client_reference:'00000001',occurred_at:'2026-10-22T17:05:06Z',time_source:'error' as const,source_kind:'audio',state:'waiting',attempts:3,diagnostic_available:true,stage:'interpret',reason:'unavailable',provider:'gemini',status:503,operation:null};
it('el aviso identifica cliente, fecha y causa, sin datos financieros ni logs con identidad',async()=>{
 const log=vi.spyOn(console,'log').mockImplementation(()=>{});
 try{const send=vi.fn(async()=>{});const rpc=vi.fn(async(name:string)=>name==='claim_whatsapp_ops_notice'?{...notice,snapshot:[{code:'manual_review',affected:1,oldest_seconds:20,details:[{...detailedIssue,payload:'PRIVATE_FINANCIAL_TEXT',error_message:'PRIVATE_SECRET'}]}]}:null);await deliverOperationalNotice(rpc as never,send,free);const body=(send.mock.calls[0] as unknown as [string,string])[1];expect(body).toContain('Clienta Ficticia');expect(body).toContain('22/10/2026');expect(body).toContain('14:05:06');expect(body).toContain('Gemini');expect(body).toContain('HTTP 503');expect(body).not.toContain('PRIVATE_');expect(JSON.stringify(log.mock.calls)).not.toContain('Clienta Ficticia');}finally{log.mockRestore();}
});
it('el aviso limita su tamaño e informa que quedan casos en el panel',async()=>{
 const send=vi.fn(async()=>{});const rpc=vi.fn(async(name:string)=>name==='claim_whatsapp_ops_notice'?{...notice,snapshot:[{code:'manual_review',affected:50,oldest_seconds:20,details:Array.from({length:50},()=>({...detailedIssue,client_name:'Nombre ficticio largo '.repeat(12)}))}]}:null);await deliverOperationalNotice(rpc as never,send,free);const body=(send.mock.calls[0] as unknown as [string,string])[1];expect(body.length).toBeLessThanOrEqual(4096);expect(body).toContain('más casos');expect(send).toHaveBeenCalledTimes(1);
});
it('una caída global no atribuye el fallo a un cliente inventado',async()=>{const send=vi.fn(async()=>{});const rpc=vi.fn(async(name:string)=>name==='claim_whatsapp_ops_notice'?{...notice,snapshot:[{code:'recovery_failure',affected:1,oldest_seconds:0,details:[]}]}:null);await deliverOperationalNotice(rpc as never,send,free);expect((send.mock.calls[0] as unknown as [string,string])[1]).toContain('Sin un cliente individual asociado');});
