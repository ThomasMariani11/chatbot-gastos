import { describe, expect, it, vi } from 'vitest';
import { boundedBytes, boundedJson, bytesToBase64, LIMITS, mediaPolicy, processActorsLimited, withinSignal } from '../supabase/functions/whatsapp-webhook/limits';
import { failureMetadata } from '../supabase/functions/whatsapp-webhook/failures';

const neverAborted=()=>new AbortController().signal;
function stream(chunks:Uint8Array[],headers:Record<string,string>={}) {
  let cancelled=false,pulls=0;
  const response=new Response(new ReadableStream<Uint8Array>({pull(controller){pulls++;const chunk=chunks.shift();if(chunk)controller.enqueue(chunk);else controller.close();},cancel(){cancelled=true;}}),{headers});
  return {response,cancelled:()=>cancelled,pulls:()=>pulls};
}
describe('INF-12: límites reales de streaming y cancelación',()=>{
  it('admite el límite exacto y conserva todos los bytes',async()=>{
    const fixture=stream([new Uint8Array([1,2]),new Uint8Array([3,4])]);
    expect(await boundedBytes(fixture.response,4,neverAborted(),'meta_media')).toEqual(new Uint8Array([1,2,3,4]));
    expect(fixture.cancelled()).toBe(false);
  });
  it('rechaza un Content-Length excesivo antes de almacenar el cuerpo',async()=>{
    const fixture=stream([new Uint8Array([1])],{'content-length':'1000'});
    const failure=await boundedBytes(fixture.response,4,neverAborted(),'meta_media').catch(e=>e);
    expect(failureMetadata(failure)).toEqual({reason:'payload_too_large',provider:'meta_media'});
    expect(fixture.cancelled()).toBe(true);
  });
  it.each([{} as Record<string,string>, {'content-length':'1'}])('corta por bytes reales aun sin tamaño fiable: %j',async headers=>{
    const fixture=stream([new Uint8Array(3),new Uint8Array(3),new Uint8Array(3)],headers);
    const failure=await boundedBytes(fixture.response,4,neverAborted(),'meta_media').catch(e=>e);
    expect(failureMetadata(failure).reason).toBe('payload_too_large');
    expect(fixture.cancelled()).toBe(true);
  });
  it('corta un cuerpo bloqueado aunque los headers ya hayan llegado',async()=>{
    let cancelled=false;const controller=new AbortController();
    const response=new Response(new ReadableStream<Uint8Array>({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}}));
    const pending=boundedBytes(response,4,controller.signal,'meta_media');
    controller.abort(new DOMException('SYNTHETIC_TIMEOUT','TimeoutError'));
    await expect(pending).rejects.toMatchObject({name:'TimeoutError'});
    expect(cancelled).toBe(true);
  });
  it.each(['-1','garbage','9007199254740993'])('no confía en tamaños inválidos: %s',async length=>{
    const response=new Response(new Uint8Array([1]),{headers:{'content-length':length}});
    const failure=await boundedBytes(response,4,neverAborted(),'meta_media').catch(e=>e);
    expect(failureMetadata(failure).reason).toBe('invalid_response');
  });
  it('limita JSON por bytes UTF-8 antes de parsearlo',async()=>{
    const text=JSON.stringify({value:'ñññ'});
    const failure=await boundedJson(new Response(text),text.length,neverAborted(),'gemini').catch(e=>e);
    expect(failureMetadata(failure).reason).toBe('payload_too_large');
  });
  it('retira el listener del presupuesto aun si una promesa nunca responde',async()=>{
    const controller=new AbortController(),remove=vi.spyOn(controller.signal,'removeEventListener');
    const pending=withinSignal(()=>new Promise(()=>{}),controller.signal);
    controller.abort(new DOMException('SYNTHETIC_TIMEOUT','TimeoutError'));
    await expect(pending).rejects.toMatchObject({name:'TimeoutError'});
    expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));
  });
  it('no inicia trabajo después de agotarse el presupuesto',async()=>{
    const controller=new AbortController();controller.abort();const work=vi.fn(async()=>1);
    await expect(withinSignal(work,controller.signal)).rejects.toBeDefined();expect(work).not.toHaveBeenCalled();
  });
  it('codifica por bloques sin alterar datos al cruzar el tamaño del bloque',()=>{
    const bytes=Uint8Array.from({length:65537},(_,i)=>i%256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
  it('normaliza parámetros y separa el tipo esperado de imagen/audio',()=>{
    expect(mediaPolicy(' Audio/OGG; codecs=opus ','audio')).toEqual({mimeType:'audio/ogg',maximum:LIMITS.audioBytes});
    expect(mediaPolicy('image/jpeg','image').maximum).toBe(5*1024*1024);
    expect(()=>mediaPolicy('image/jpeg','audio')).toThrow();
  });
  it.each(['application/pdf','image/svg+xml','text/html','audio/unknown',null])('no admite formatos ajenos: %s',mime=>{
    try {mediaPolicy(mime);throw Error('unexpected');}catch(error){expect(failureMetadata(error).reason).toBe('unsupported_media');}
  });
});

describe('INF-12: concurrencia acotada por invocación',()=>{
  it('nunca inicia más de dos actores juntos y continúa después de un fallo',async()=>{
    let active=0,maximum=0;const seen:number[]=[];
    const result=await processActorsLimited([1,2,3,4,5],async actor=>{
      active++;maximum=Math.max(maximum,active);seen.push(actor);
      await Promise.resolve();active--;if(actor===2)throw Error('PRIVATE_PROVIDER_ERROR');
    });
    expect(maximum).toBe(2);expect(seen).toEqual([1,2,3,4,5]);expect(result).toEqual({failed:1,started:5});
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('deja sin iniciar los actores que ya no entran en la ventana de trabajo',async()=>{
    let clock=0;const seen:number[]=[];
    const result=await processActorsLimited([1,2,3,4],async actor=>{seen.push(actor);await Promise.resolve();clock=LIMITS.workerWindowMs;},()=>clock);
    expect(seen).toEqual([1,2]);expect(result).toEqual({failed:0,started:2});
  });
});
