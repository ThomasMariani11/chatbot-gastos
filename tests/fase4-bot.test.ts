import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fase 4, grupo del bot: SEC-20 a SEC-24. Datos ficticios; Deno y fetch simulados, sin red.
const env: Record<string, string> = {
  WHATSAPP_ACCESS_TOKEN: 'token-ficticio',
  WHATSAPP_PHONE_NUMBER_ID: '111111111111111',
};
vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } });

const { sendWhatsAppText, downloadWhatsAppMedia } = await import('../supabase/functions/whatsapp-webhook/meta-client');
const { readMessages } = await import('../supabase/functions/whatsapp-webhook/queue');
const { sameSecret } = await import('../supabase/functions/whatsapp-webhook/secrets');
const { failureMetadata } = await import('../supabase/functions/whatsapp-webhook/failures');
// Motivo del fallo operativo (vive en failureMetadata, no en el error).
const reasonOf = (promise: Promise<unknown>) => promise.then(() => 'ok', (error) => failureMetadata(error).reason);

type Call = { url: string; auth: string | null; to?: string };
let calls: Call[] = [];
function stubFetch(handler: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { to?: string } : undefined;
    calls.push({ url, auth: headers.get('authorization'), to: body?.to });
    return handler(url);
  }));
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
function media(fileUrl: string, mime: string, bytes: Uint8Array<ArrayBuffer>) {
  return (url: string) => url.includes('graph.facebook.com')
    ? new Response(JSON.stringify({ url: fileUrl, mime_type: mime, file_size: bytes.length }), { headers: { 'content-type': 'application/json' } })
    : new Response(bytes, { headers: { 'content-type': mime } });
}

beforeEach(() => { calls = []; });
afterEach(() => { vi.unstubAllGlobals(); vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } }); });

describe('SEC-23: reintento con la variante argentina', () => {
  it('549… fallido se reintenta a 54… (mismo número)', async () => {
    stubFetch(() => new Response('{}', { status: 400 }));
    await expect(sendWhatsAppText('5491100000000', 'Hola ficticio')).rejects.toBeTruthy();
    expect(calls.map((c) => c.to)).toEqual(['5491100000000', '541100000000']);
  });

  it('54… fallido ya no se reintenta a 549… (podría ser otra persona)', async () => {
    stubFetch(() => new Response('{}', { status: 400 }));
    await expect(sendWhatsAppText('541100000000', 'Hola ficticio')).rejects.toBeTruthy();
    expect(calls.map((c) => c.to)).toEqual(['541100000000']);
  });
});

describe('SEC-21 y SEC-22: descarga de multimedia', () => {
  it('un identificador con letras se rechaza sin llamar a Meta', async () => {
    stubFetch(media('https://lookaside.fbsbx.com/x', 'image/jpeg', JPEG));
    await expect(downloadWhatsAppMedia('123/../me', 'image')).rejects.toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('una URL de descarga fuera de Meta se rechaza sin mandarle el token', async () => {
    for (const evil of ['https://evil.example/file', 'https://fbsbx.com.evil.example/file', 'http://lookaside.fbsbx.com/file',
      'https://evilfbsbx.com/file', 'https://lookaside.fbsbx.com:8443/file', 'https://user:pass@lookaside.fbsbx.com/file']) {
      calls = [];
      stubFetch(media(evil, 'image/jpeg', JPEG));
      expect(await reasonOf(downloadWhatsAppMedia('1234567890', 'image')), evil).toBe('unsupported_media');
      expect(calls.some((c) => !c.url.includes('graph.facebook.com')), evil).toBe(false);
    }
  });

  it('una imagen JPEG o PNG real de un dominio de Meta se descarga', async () => {
    stubFetch(media('https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', 'image/jpeg', JPEG));
    expect(await reasonOf(downloadWhatsAppMedia('1234567890', 'image'))).toBe('ok');
    stubFetch(media('https://scontent.whatsapp.net/v/x', 'image/png', PNG));
    await expect(downloadWhatsAppMedia('1234567890', 'image')).resolves.toMatchObject({ mimeType: 'image/png' });
  });

  it('una "imagen" cuyo contenido no es JPEG ni PNG se rechaza', async () => {
    stubFetch(media('https://lookaside.fbsbx.com/x', 'image/jpeg', new TextEncoder().encode('<html>no es una foto</html>')));
    expect(await reasonOf(downloadWhatsAppMedia('1234567890', 'image'))).toBe('unsupported_media');
    stubFetch(media('https://lookaside.fbsbx.com/x', 'image/png', JPEG));
    expect(await reasonOf(downloadWhatsAppMedia('1234567890', 'image'))).toBe('unsupported_media');
  });
});

describe('SEC-24: número de Meta del evento', () => {
  const payload = (phoneNumberId: string, id: string) => ({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id, from: 'wa-ficticio', type: 'text', timestamp: '1' }] } }] }],
  });

  it('descarta los mensajes dirigidos a otro número', () => {
    const both = { entry: [...payload('111111111111111', 'propio').entry, ...payload('999999999999999', 'ajeno').entry] };
    expect(readMessages(both, '111111111111111').map((m) => m.id)).toEqual(['propio']);
  });

  it('deja registro (sin identificadores) cuando descarta mensajes de otro número', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      readMessages(payload('999999999999999', 'ajeno'), '111111111111111');
      const lines = log.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('foreign_number_dropped') && l.includes('"dropped":1'))).toBe(true);
      expect(lines.join('')).not.toContain('999999999999999');
      log.mockClear();
      readMessages(payload('111111111111111', 'propio'), '111111111111111');
      expect(log.mock.calls.some((c) => String(c[0]).includes('foreign_number_dropped'))).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  it('sin número configurado no filtra, como antes', () => {
    expect(readMessages(payload('999999999999999', 'x')).map((m) => m.id)).toEqual(['x']);
  });
});

describe('SEC-20: secretos en tiempo constante', () => {
  it('sameSecret compara bien y rechaza vacíos', async () => {
    expect(await sameSecret('secreto-ficticio', 'secreto-ficticio')).toBe(true);
    expect(await sameSecret('secreto-ficticio', 'otro')).toBe(false);
    expect(await sameSecret(null, 'x')).toBe(false);
    expect(await sameSecret('x', undefined)).toBe(false);
  });

  it('index.ts ya no compara secretos con === o !==', () => {
    const source = readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8');
    expect(source).not.toMatch(/x-worker-secret"\)\s*!==/);
    expect(source).not.toMatch(/hub\.verify_token"\)\s*===/);
    expect(source).toMatch(/sameSecret\(/);
  });
});
