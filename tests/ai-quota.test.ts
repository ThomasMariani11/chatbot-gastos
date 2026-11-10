import { describe, expect, it, vi } from 'vitest';
import { AiQuotaExceeded, createAiQuotaGate } from '../supabase/functions/whatsapp-webhook/ai-quota';
import { failureMetadata } from '../supabase/functions/whatsapp-webhook/failures';

// BE-17: reserva de cuota de IA antes de cada llamada a un proveedor.
const job = { id: 'job-prueba', attempts: 2 };
function gate(result: unknown) {
  const rpc = vi.fn(async () => result);
  return { rpc, before: createAiQuotaGate({ token: 'token-prueba', rpc: rpc as never }, job) };
}

describe('BE-17 · cuota de IA', () => {
  it('reserva con el trabajo, el token, el intento y la línea, y deja pasar si hay cupo', async () => {
    const { rpc, before } = gate({ allowed: true });
    const controller = new AbortController();
    await expect(before('qwen', controller.signal)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      'reserve_whatsapp_ai_quota',
      { p_id: 'job-prueba', p_token: 'token-prueba', p_attempt: 2, p_lane: 'qwen' },
      controller.signal,
    );
  });

  it('cuota agotada es un límite de uso, distinto de un error de configuración', async () => {
    const exhausted = gate({ allowed: false, reason: 'exhausted' });
    const error = await exhausted.before('whisper').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiQuotaExceeded);
    expect(failureMetadata(error)).toMatchObject({ reason: 'rate_limit', provider: 'groq' });

    for (const result of [{ allowed: false, reason: 'disabled' }, null, { allowed: 'true' }]) {
      const other = await gate(result).before('qwen').catch((e: unknown) => e);
      expect(other).not.toBeInstanceOf(AiQuotaExceeded);
      expect(failureMetadata(other)).toMatchObject({ reason: 'configuration', provider: 'groq' });
    }
    const gemini = await gate({ allowed: false }).before('gemini').catch((e: unknown) => e);
    expect(failureMetadata(gemini)).toMatchObject({ reason: 'configuration', provider: 'gemini' });
  });

  it('una señal abortada corta antes de reservar', async () => {
    const { rpc, before } = gate({ allowed: true });
    const controller = new AbortController();
    controller.abort();
    await expect(before('qwen', controller.signal)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('si se aborta mientras reserva, no deja pasar la llamada', async () => {
    const controller = new AbortController();
    const rpc = vi.fn(async () => { controller.abort(); return { allowed: true }; });
    const before = createAiQuotaGate({ token: 'token-prueba', rpc: rpc as never }, job);
    await expect(before('qwen', controller.signal)).rejects.toThrow();
  });
});
