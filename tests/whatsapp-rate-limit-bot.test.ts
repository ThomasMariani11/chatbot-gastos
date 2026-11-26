import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BOT_MESSAGES } from '../supabase/functions/whatsapp-webhook/bot-messages';
import { prepareMessage } from '../supabase/functions/whatsapp-webhook/processor';
import type { IncomingMessage, Job } from '../supabase/functions/whatsapp-webhook/queue';

// SEC-06: la recepción (migración 056) marca el payload; el bot responde según la marca.
// Datos ficticios; sin red ni IA.
function db(linkedUser: string | null, opts: { responses?: boolean; botActive?: string } = {}) {
  return {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => {
          if (table === 'whatsapp_links') return Promise.resolve({ data: linkedUser ? { user_id: linkedUser } : null, error: null });
          if (table === 'profiles') return Promise.resolve({ data: { role: 'client', subscription_status: 'active', subscription_until: null }, error: null });
          if (table === 'app_settings') return Promise.resolve({ data: { whatsapp_responses_enabled: opts.responses ?? true }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        in: () => Promise.resolve({ data: table === 'system_config' ? [{ key: 'bot_active', value: opts.botActive ?? 'true' }] : [], error: null }),
      };
      return chain;
    },
    rpc: vi.fn(() => Promise.resolve({ data: { group_id: 'g-ficticio', version: 1, items: [], is_stale: false }, error: null })),
  } as unknown as Parameters<typeof prepareMessage>[0];
}

function job(body: string, marks: Partial<IncomingMessage>, userId: string | null): Job {
  return {
    id: 'job-ficticio',
    wa_id: 'wa-ficticio',
    user_id: userId,
    payload: { id: 'wamid-ficticio', from: 'wa-ficticio', type: 'text', text: { body }, ...marks } as IncomingMessage,
    attempts: 1,
    effect_applied: false,
    parsed_result: null,
    reply_text: null,
  };
}

const run = (j: Job, linkedUser: string | null, opts: { responses?: boolean; botActive?: string } = {}) => {
  const gate = vi.fn();
  return { result: prepareMessage(db(linkedUser, opts), j, async () => {}, undefined, gate), gate };
};

describe('SEC-06: respuestas del bot según las marcas de la recepción', () => {
  it('el aviso de muchos mensajes es el acordado', () => {
    expect(BOT_MESSAGES.rateLimited).toBe('Recibí muchos mensajes seguidos 🙏\nEsperá un minuto y mandame de nuevo los que falten.');
  });

  it('un mensaje marcado por exceso responde el aviso, sin IA', async () => {
    const r = run(job('Gasté 100 en súper', { pesito_rate_limited: true }, 'user-ficticio'), 'user-ficticio');
    expect(await r.result).toEqual({ kind: 'reply', text: BOT_MESSAGES.rateLimited });
    expect(r.gate).not.toHaveBeenCalled();
  });

  it('el aviso por exceso respeta las respuestas apagadas por el cliente y el bot en mantenimiento', async () => {
    const marked = () => job('Gasté 100 en súper', { pesito_rate_limited: true }, 'user-ficticio');
    expect(await run(marked(), 'user-ficticio', { responses: false }).result).toMatchObject({ kind: 'reply', text: null });
    const maintenance = await run(marked(), 'user-ficticio', { botActive: 'false' }).result;
    expect(maintenance.kind).toBe('reply');
    expect(maintenance.text).not.toBe(BOT_MESSAGES.rateLimited);
  });

  it('sin vínculo y sin marca responde que el número no está vinculado', async () => {
    expect(await run(job('hola', {}, null), null).result).toEqual({ kind: 'reply', text: BOT_MESSAGES.notLinked });
  });

  it('sin vínculo y marcado como silencioso no responde nada', async () => {
    expect(await run(job('hola', { pesito_quiet_not_linked: true }, null), null).result).toEqual({ kind: 'reply', text: null });
  });

  it('un intento de vinculación se procesa aunque esté marcado como silencioso', async () => {
    const hash = createHash('sha256').update('K7QMX3RT9PZD', 'utf8').digest('hex');
    expect(await run(job('vincular K7QM-X3RT-9PZD', { pesito_quiet_not_linked: true }, null), null).result).toEqual({ kind: 'link', hash });
  });
});
