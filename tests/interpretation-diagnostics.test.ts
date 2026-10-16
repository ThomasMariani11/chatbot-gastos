import { describe, expect, it } from 'vitest';
import { failureMetadata, httpFailure, OperationalFailure, providerFailure } from '../supabase/functions/whatsapp-webhook/failures';
import { createLogWriter } from '../supabase/functions/whatsapp-webhook/logging';

describe('diagnóstico seguro de interpretación',()=>{
  it('clasifica estados HTTP y timeout sin conservar errores crudos',()=>{
    expect(failureMetadata(httpFailure(429,'gemini'))).toEqual({reason:'rate_limit',provider:'gemini',status:429});
    expect(failureMetadata(httpFailure(403,'meta_media'))).toEqual({reason:'authentication',provider:'meta_media',status:403});
    expect(failureMetadata(providerFailure(new DOMException('PRIVATE_BODY','TimeoutError'),'gemini','network'))).toEqual({reason:'timeout',provider:'gemini'});
    expect(failureMetadata(providerFailure(new SyntaxError('PRIVATE_BODY'),'gemini','network')).reason).toBe('invalid_response');
  });
  it('no lee getters, mensajes o metadatos falsificados del error',()=>{
    const fake={get reason(){throw Error('PRIVATE_BODY')},provider:'gemini',message:'PRIVATE_BODY',status:429};
    expect(failureMetadata(fake)).toEqual({reason:'unknown'});
    const actual=new OperationalFailure('database_read','database',undefined,'QUEUE_DRAFT_READ');
    Object.assign(actual,{reason:'PRIVATE_BODY',provider:'PRIVATE_BODY',status:999});
    expect(failureMetadata(actual)).toEqual({reason:'database_read',provider:'database',operation:'QUEUE_DRAFT_READ'});
  });
  it('solo publica diagnóstico permitido, sin cuerpos, URLs, tokens ni modelos arbitrarios',()=>{
    const lines:string[]=[];const log=createLogWriter(line=>lines.push(line));
    log('ai_attempt',{...failureMetadata(httpFailure(429,'gemini')),model:'flash_lite',result:'failure',duration_ms:11,body:'PRIVATE_BODY',key:'PRIVATE_KEY',url:'https://example.invalid/?key=PRIVATE_KEY'});
    expect(JSON.parse(lines[0])).toEqual({event:'ai_attempt',reason:'rate_limit',provider:'gemini',status:429,model:'flash_lite',result:'failure',duration_ms:11});
    log('queue_retry',{reason:'PRIVATE_BODY',provider:'PRIVATE_BODY',operation:'PRIVATE_BODY',status:999,stage:'interpret',attempts:2});
    expect(JSON.parse(lines[1])).toEqual({event:'queue_retry',stage:'interpret',attempts:2});
    expect(lines.join('')).not.toContain('PRIVATE');
  });
});
