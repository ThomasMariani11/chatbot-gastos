import { describe, expect, it, vi } from 'vitest';
import { deliverRenewalNotices, formatRenewalReceipt, isRenewalRequest } from '../supabase/functions/whatsapp-webhook/renewals';
import { httpFailure, OperationalFailure } from '../supabase/functions/whatsapp-webhook/failures';
import { prepareMessage } from '../supabase/functions/whatsapp-webhook/processor';
import type { Job } from '../supabase/functions/whatsapp-webhook/queue';
import { sendWhatsAppText } from '../supabase/functions/whatsapp-webhook/meta-client';

describe('BE-19: despacho sin IA, plantillas o exposición del código', () => {
  it.each(['RENOVAR','quiero renovar',' Quiero   renovar! '])('reconoce solicitud explícita %s', text => expect(isRenewalRequest(text)).toBe(true));
  it.each(['Gasté 5000 para renovar Netflix','Cobré 100 por renovar un servicio','¿Cuánto sale renovar?','RENOVAR y gasté 500'])('no intercepta movimiento o consulta mixta: %s', text => expect(isRenewalRequest(text)).toBe(false));
  it('el recibo confirma pago y días, sin declarar activación ni fecha ficticia', () => {
    const body = formatRenewalReceipt('SYNTHETIC-CODE',30);
    expect(body).toContain('Pago confirmado');expect(body).toContain('30 días');expect(body).toContain('SYNTHETIC-CODE');expect(body).toContain('después del canje');
    expect(body).not.toContain('renovación confirmada');expect(formatRenewalReceipt('SYNTHETIC-CODE',null)).toContain('sin vencimiento');
  });
  it('el procesador deriva RENOVAR a la cola antes de bloquear por vencimiento, sin red ni lecturas', async () => {
    const from=vi.fn(),rpc=vi.fn(),checkpoint=vi.fn(),gate=vi.fn();
    const db={from,rpc} as unknown as Parameters<typeof prepareMessage>[0];
    const job={payload:{type:'text',text:{body:'QUIERO RENOVAR'}}} as Job;
    expect(await prepareMessage(db,job,checkpoint,undefined,gate)).toEqual({kind:'renewal_request'});
    expect(from).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();expect(checkpoint).not.toHaveBeenCalled();expect(gate).not.toHaveBeenCalled();
  });
  const fixture = {id:'synthetic-notice',to:'synthetic-recipient',code:'PRIVATE_SYNTHETIC_CODE',test_sender_digits:'synthetic-sender',duration_days:30};
  function setup(sendError?:unknown, verified=true, authorized=true) {
    let claimed=false;
    const rpc=vi.fn(async(name:string)=> name==='claim_subscription_renewal_notice' ? claimed ? null : (claimed=true,fixture) : name==='authorize_subscription_renewal_notice' ? authorized : null);
    const send=vi.fn(async()=>{if(sendError)throw sendError;});
    const verify=vi.fn(async()=>verified);
    return {rpc:rpc as unknown as Parameters<typeof deliverRenewalNotices>[0], spy:rpc,send,verify};
  }
  it('verifica emisor y autorización antes de enviar y termina sent',async()=>{
    const s=setup();await deliverRenewalNotices(s.rpc,s.send,s.verify);
    expect(s.send).toHaveBeenCalledOnce();expect(s.spy.mock.calls.map(c=>c[0]).slice(0,3)).toEqual(['claim_subscription_renewal_notice','authorize_subscription_renewal_notice','finish_subscription_renewal_notice']);
    expect(s.spy).toHaveBeenCalledWith('finish_subscription_renewal_notice',expect.objectContaining({p_outcome:'sent'}));
  });
  it('emisor distinto queda bloqueado sin enviar',async()=>{const s=setup(undefined,false);await deliverRenewalNotices(s.rpc,s.send,s.verify);expect(s.send).not.toHaveBeenCalled();expect(s.spy).toHaveBeenCalledWith('finish_subscription_renewal_notice',expect.objectContaining({p_outcome:'blocked'}));});
  it('revalidación rechazada no envía',async()=>{const s=setup(undefined,true,false);await deliverRenewalNotices(s.rpc,s.send,s.verify);expect(s.send).not.toHaveBeenCalled();});
  it.each([400,429])('rechazo explícito %s permite recuperación sin emitir otro código',async status=>{const s=setup(httpFailure(status,'meta_send'));await deliverRenewalNotices(s.rpc,s.send,s.verify);expect(s.spy).toHaveBeenCalledWith('finish_subscription_renewal_notice',expect.objectContaining({p_outcome:'failed'}));});
  it.each(['timeout','network'] as const)('resultado %s después de iniciar envío queda incierto y no se reenvía',async reason=>{
    const s=setup(new OperationalFailure(reason,'meta_send'));await deliverRenewalNotices(s.rpc,s.send,s.verify);expect(s.send).toHaveBeenCalledOnce();expect(s.spy).toHaveBeenCalledWith('finish_subscription_renewal_notice',expect.objectContaining({p_outcome:'uncertain'}));
  });
  it.each([408,500,503])('HTTP %s después de enviar queda incierto',async status=>{const s=setup(httpFailure(status,'meta_send'));await deliverRenewalNotices(s.rpc,s.send,s.verify);expect(s.spy).toHaveBeenCalledWith('finish_subscription_renewal_notice',expect.objectContaining({p_outcome:'uncertain'}));});
  it('un fallo al finalizar no provoca un segundo envío',async()=>{
    const s=setup();s.spy.mockImplementation(async(name:string)=>{if(name==='finish_subscription_renewal_notice')throw Error('PRIVATE_FAILURE');return name==='claim_subscription_renewal_notice'?fixture:true;});
    await deliverRenewalNotices(s.rpc,s.send,s.verify);expect(s.send).toHaveBeenCalledOnce();
  });
  it('los logs no contienen destinatario, código o errores crudos',async()=>{
    const logger=vi.spyOn(console,'log').mockImplementation(()=>{});
    try {const s=setup(Error('PRIVATE_FAILURE'));await deliverRenewalNotices(s.rpc,s.send,s.verify);const logs=JSON.stringify(logger.mock.calls);expect(logs).not.toMatch(/PRIVATE|synthetic-recipient|synthetic-sender/);}finally{logger.mockRestore();}
  });
  it('el transporte exacto no prueba otra variante del destino ante 503',async()=>{
    vi.stubGlobal('Deno',{env:{get:(key:string)=>key==='WHATSAPP_GRAPH_API_VERSION'?'v26.0':'synthetic-credential'}});
    const fetch=vi.fn(async(_url:string,_init:RequestInit)=>new Response('{}',{status:503}));vi.stubGlobal('fetch',fetch);
    try {
      await expect(sendWhatsAppText('54'+'90000000000','ficticio',undefined,{exactRecipient:true})).rejects.toBeInstanceOf(OperationalFailure);
      expect(fetch).toHaveBeenCalledOnce();
      expect(JSON.parse(String(fetch.mock.calls[0][1].body)).to).toBe('54'+'90000000000');
    } finally { vi.unstubAllGlobals(); }
  });
});
