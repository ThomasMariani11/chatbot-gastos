import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildStrictSchema,
  extractWithGroq,
  normalizeGroqOutput,
  resetGroqBudgetForTests,
  validateAgainstSchema,
} from '../supabase/functions/whatsapp-webhook/groq';
import { multiResponseJsonSchema } from '../supabase/functions/whatsapp-webhook/gemini';
import { failureMetadata } from '../supabase/functions/whatsapp-webhook/failures';

// BE-17: extracción con IA (Groq/Qwen y Whisper). Todas las respuestas de IA son simuladas:
// ninguna prueba sale a la red. La clave tiene formato válido pero es ficticia.
const KEY = 'gsk_prueba_ficticia_0000';
const TODAY = '2026-11-10';
const schema = multiResponseJsonSchema as Parameters<typeof buildStrictSchema>[0];

const movement = {
  kind: 'expense',
  description: 'Súper',
  totalAmountArs: 1500,
  currency: 'ARS',
  occurredOn: TODAY,
  category: 'Alimentación',
  installments: 1,
  firstInstallmentMonth: null,
  confidence: 0.9,
  missingFields: [],
};
const chat = (content: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetGroqBudgetForTests();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function extract(overrides: Partial<Parameters<typeof extractWithGroq>[0]> = {}) {
  return extractWithGroq({
    apiKey: KEY,
    today: TODAY,
    text: 'pagué el súper con tarjeta',
    baseSchema: schema,
    strictSchema: buildStrictSchema(schema),
    buildPrompt: (text) => `Extraé movimientos de: ${text}`,
    cleanDescription: (desc) => desc.trim(),
    ...overrides,
  });
}
const reason = (error: unknown) => failureMetadata(error).reason;

describe('BE-17 · esquema estricto de Groq', () => {
  it('buildStrictSchema exige todas las claves, admite null en las opcionales y prohíbe extras', () => {
    const strict = buildStrictSchema(schema);
    expect(strict.additionalProperties).toBe(false);
    expect(strict.required).toEqual(Object.keys(schema.properties!));
    expect(strict.properties!.clarification.type).toEqual(['string', 'null']);
    expect(strict.properties!.edit.type).toEqual(['object', 'null']);
    // No modifica el esquema original.
    expect(schema.additionalProperties).toBeUndefined();
  });

  it('validateAgainstSchema acepta una salida válida y señala tipo, enum, rango, faltantes y extras', () => {
    const strictMovement = buildStrictSchema(schema).properties!.movements.items!;
    expect(validateAgainstSchema({ intent: 'add_movements', movements: [movement] }, schema)).toEqual([]);
    expect(validateAgainstSchema({ intent: 'otra', movements: [] }, schema)).toEqual(['/intent:enum']);
    expect(validateAgainstSchema({ intent: 'summary', movements: 'no' }, schema)).toEqual(['/movements:type']);
    expect(validateAgainstSchema({ ...movement, installments: 61 }, schema.properties!.movements.items!)).toEqual(['/installments:range']);
    expect(validateAgainstSchema({ ...movement, installments: 2.5 }, schema.properties!.movements.items!)).toEqual(['/installments:type']);
    const { currency: _omitida, ...sinMoneda } = movement;
    expect(validateAgainstSchema(sinMoneda, schema.properties!.movements.items!)).toEqual(['/currency:missing']);
    expect(validateAgainstSchema({ ...movement, clarification: null, extra: 1 }, strictMovement)).toEqual(['/extra:extra']);
  });

  it('normalizeGroqOutput rechaza lo que no es un objeto y quita edit nulo fuera de edit_item', () => {
    for (const bad of [null, [], 'texto', 3]) {
      expect(() => normalizeGroqOutput(bad, TODAY)).toThrow();
      try { normalizeGroqOutput(bad, TODAY); } catch (error) { expect(reason(error)).toBe('invalid_response'); }
    }
    expect(normalizeGroqOutput({ intent: 'summary', movements: [], edit: null }, TODAY)).toEqual({ intent: 'summary', movements: [] });
  });
});

describe('BE-17 · extractWithGroq con respuestas simuladas', () => {
  it('clave con formato inválido falla por configuración sin llamar a la red', async () => {
    await expect(extract({ apiKey: 'clave-invalida' })).rejects.toSatisfy((e) => reason(e) === 'configuration');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('una señal ya abortada corta antes de llamar a la red', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(extract({ signal: controller.signal })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('texto: reserva cuota de qwen, llama una vez y devuelve los movimientos normalizados', async () => {
    const before = vi.fn(async (_lane: string) => undefined);
    const clean = vi.fn((desc: string) => desc.toUpperCase());
    fetchMock.mockResolvedValueOnce(chat({ intent: 'add_movements', movements: [movement] }));
    const result = await extract({ beforeAiRequest: before, cleanDescription: clean });
    expect(before).toHaveBeenCalledTimes(1);
    expect(before.mock.calls[0][0]).toBe('qwen');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(init.body)).response_format.json_schema.strict).toBe(true);
    expect(result.output?.intent).toBe('add_movements');
    expect(result.output?.movements).toHaveLength(1);
    expect(result.output?.movements[0]).toMatchObject({ kind: 'expense', description: 'SÚPER', totalAmountArs: 1500, currency: 'ARS' });
    expect(clean).toHaveBeenCalledWith('Súper', 'expense');
  });

  it('si la cuota rechaza, no se llama a la IA', async () => {
    const quota = Object.assign(new Error('cuota'), {});
    await expect(extract({ beforeAiRequest: async () => { throw quota; } })).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('JSON roto, contenido vacío o fuera de esquema se rechazan como respuesta inválida', async () => {
    const casos = [
      chat('{"intent": "add_movements", '),
      chat(''),
      chat({ intent: 'otra', movements: [] }),
      chat({ intent: 'summary', movements: [movement] }),
      chat({ intent: 'edit_item', movements: [], edit: { targetPosition: 0, amount: 10, description: null, category: null } }),
      chat({ intent: 'edit_item', movements: [], edit: { targetPosition: 2, amount: null, description: null, category: null } }),
    ];
    for (const response of casos) {
      fetchMock.mockResolvedValueOnce(response);
      await expect(extract()).rejects.toSatisfy((e) => reason(e) === 'invalid_response');
    }
  });

  it('errores HTTP se clasifican sin devolver salida', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(extract()).rejects.toSatisfy((e) => reason(e) === 'unavailable');
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(extract()).rejects.toSatisfy((e) => reason(e) === 'authentication');
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(extract()).rejects.toSatisfy((e) => reason(e) === 'network');
  });

  it('un 429 con espera larga bloquea el siguiente intento sin volver a llamar', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '30' } }));
    await expect(extract()).rejects.toSatisfy((e) => reason(e) === 'rate_limit');
    await expect(extract()).rejects.toSatisfy((e) => reason(e) === 'rate_limit');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('audio: transcribe con Whisper y, si el texto se entiende localmente, no usa Qwen', async () => {
    const before = vi.fn(async (_lane: string) => undefined);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ text: 'Gasté 1500 en súper' }), { status: 200 }));
    const result = await extract({
      text: undefined,
      mediaBase64: Buffer.from('audio-ficticio').toString('base64'),
      mimeType: 'audio/ogg; codecs=opus',
      beforeAiRequest: before,
    });
    expect(before.mock.calls.map((call) => call[0])).toEqual(['whisper']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(result.transcribedText).toBe('Gasté 1500 en súper');
    expect(result.output?.intent).toBe('add_movements');
    expect(result.output?.movements[0]).toMatchObject({ kind: 'expense', totalAmountArs: 1500 });
  });

  it('audio vacío devuelve intención desconocida sin llamar a Qwen', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ text: '   ' }), { status: 200 }));
    const result = await extract({ text: undefined, mediaBase64: Buffer.from('x').toString('base64'), mimeType: 'audio/ogg' });
    expect(result).toEqual({ output: { intent: 'unknown', movements: [] }, transcribedText: '' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
