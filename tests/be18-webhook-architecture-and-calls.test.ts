import { describe, expect, it } from 'vitest';
import { formatSupportContact, resolveActorAccess } from '../supabase/functions/whatsapp-webhook/context-repository';
import { extractFromGemini, multiResponseJsonSchema } from '../supabase/functions/whatsapp-webhook/gemini';
import {
  cleanDescription,
  downloadWhatsAppMedia,
  formatDraftList,
  isVerifiedOperationalTestSender,
  json,
  parseDeterministicMovements,
  sendWhatsAppText,
  sha256,
  validSignature,
} from '../supabase/functions/whatsapp-webhook/helpers';
import { prepareMessage } from '../supabase/functions/whatsapp-webhook/processor';
import type { Job } from '../supabase/functions/whatsapp-webhook/queue';

function buildJob(body: string, userId: string | null = 'user-1'): Job {
  return {
    id: 'job-1',
    wa_id: '5491112345678',
    user_id: userId,
    payload: {
      id: 'wamid-1',
      from: '5491112345678',
      type: 'text',
      text: { body },
    },
    attempts: 1,
    effect_applied: false,
    parsed_result: null,
    reply_text: null,
  };
}

describe('BE-18: Separación de responsabilidades y reducción de llamadas remotas en el webhook', () => {
  it('mantiene la fachada helpers.ts re-exportando meta-client, gemini y módulos de dominio puro', async () => {
    expect(typeof validSignature).toBe('function');
    expect(typeof sha256).toBe('function');
    expect(typeof sendWhatsAppText).toBe('function');
    expect(typeof downloadWhatsAppMedia).toBe('function');
    expect(typeof isVerifiedOperationalTestSender).toBe('function');
    expect(typeof json).toBe('function');
    expect(typeof extractFromGemini).toBe('function');
    expect(typeof multiResponseJsonSchema).toBe('object');
    expect(typeof cleanDescription).toBe('function');
    expect(typeof parseDeterministicMovements).toBe('function');
    expect(typeof formatDraftList).toBe('function');

    const hash = await sha256('123456');
    expect(hash).toHaveLength(64);
    expect(formatSupportContact('+54 9 11 5555-6666', 'pesito.mp')).toContain('https://wa.me/5491155556666');
    expect(formatSupportContact('+54 9 11 5555-6666', 'pesito.mp')).toContain('*pesito.mp*');
  });

  it('resolveActorAccess ejecuta las 4 lecturas de contexto en paralelo cuando job.user_id está presente y unifica system_config', async () => {
    const tableCounts: Record<string, number> = {};
    let inFlight = 0;
    let maxParallel = 0;

    const delayed = async <T>(table: string, data: T) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      inFlight++;
      if (inFlight > maxParallel) maxParallel = inFlight;
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return { data, error: null };
    };

    const db = {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => {
            if (table === 'whatsapp_links') return delayed(table, { user_id: 'user-1' });
            if (table === 'profiles') {
              return delayed(table, {
                role: 'client',
                subscription_status: 'active',
                subscription_until: null,
              });
            }
            if (table === 'app_settings') {
              return delayed(table, { whatsapp_responses_enabled: true });
            }
            return delayed(table, null);
          },
          in: (_col: string, keys: string[]) => {
            if (table === 'system_config') {
              return delayed(
                table,
                keys.map((k) => ({
                  key: k,
                  value:
                    k === 'bot_active'
                      ? 'true'
                      : k === 'support_phone'
                        ? '5491144445555'
                        : 'mi.alias.mp',
                })),
              );
            }
            return delayed(table, []);
          },
        };
        return chain;
      },
    } as unknown as Parameters<typeof resolveActorAccess>[0];

    const outcome = await resolveActorAccess(db, buildJob('Gasté 1500 en panadería'));
    expect(outcome.allowed).toBe(true);
    if (outcome.allowed) {
      expect(outcome.userId).toBe('user-1');
      expect(outcome.role).toBe('client');
      expect(outcome.supportDetails).toContain('https://wa.me/5491144445555');
      expect(outcome.supportDetails).toContain('*mi.alias.mp*');
    }

    // Se ejecutaron las 4 lecturas simultáneamente en 1 solo round-trip y system_config se leyó 1 sola vez
    expect(maxParallel).toBe(4);
    expect(tableCounts).toEqual({
      whatsapp_links: 1,
      profiles: 1,
      system_config: 1,
      app_settings: 1,
    });
  });

  it('cuando la cuenta está suspendida o es una consulta comercial no hace una segunda consulta a system_config', async () => {
    let systemConfigReads = 0;
    let draftReads = 0;
    let currentStatus: 'active' | 'suspended' | 'expired' = 'suspended';

    const db = {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => {
            if (table === 'whatsapp_links') return Promise.resolve({ data: { user_id: 'user-1' }, error: null });
            if (table === 'profiles') {
              return Promise.resolve({
                data: {
                  role: 'client',
                  subscription_status: currentStatus,
                  subscription_until: null,
                },
                error: null,
              });
            }
            if (table === 'app_settings') {
              return Promise.resolve({ data: { whatsapp_responses_enabled: true }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
          in: () => {
            if (table === 'system_config') {
              systemConfigReads++;
              return Promise.resolve({
                data: [
                  { key: 'bot_active', value: 'true' },
                  { key: 'support_phone', value: '5491133334444' },
                  { key: 'payment_alias', value: 'alias.soporte' },
                ],
                error: null,
              });
            }
            return Promise.resolve({ data: [], error: null });
          },
        };
        return chain;
      },
      rpc: () => {
        draftReads++;
        return Promise.resolve({
          data: { group_id: 'g-1', version: 1, items: [], is_stale: false },
          error: null,
        });
      },
    } as unknown as Parameters<typeof prepareMessage>[0];

    // Caso 1: cuenta suspendida incluye teléfono y alias de soporte con 1 sola lectura a system_config
    const suspendedReply = await prepareMessage(db, buildJob('Gasté 2000 en café'), async () => {});
    expect(suspendedReply).toEqual({
      kind: 'reply',
      text: expect.stringContaining('en pausa ⏸️'),
      clear_summary: true,
    });
    expect(String(suspendedReply.text)).toContain('https://wa.me/5491133334444');
    expect(String(suspendedReply.text)).toContain('*alias.soporte*');
    expect(systemConfigReads).toBe(1);
    expect(draftReads).toBe(0);

    // Caso 2: cuenta activa haciendo consulta comercial reutiliza los datos de soporte con 1 sola lectura
    currentStatus = 'active';
    systemConfigReads = 0;
    const commercialReply = await prepareMessage(
      db,
      buildJob('¿Cómo renuevo mi suscripción?'),
      async () => {},
    );
    expect(commercialReply.kind).toBe('reply');
    expect(String(commercialReply.text)).toContain('https://wa.me/5491133334444');
    expect(String(commercialReply.text)).toContain('*alias.soporte*');
    expect(systemConfigReads).toBe(1);
    expect(draftReads).toBe(0);

    // Caso 3: mensaje sin texto ni multimedia (p. ej. sticker/ubicación) rechaza antes de leer get_active_draft_group
    const stickerJob = buildJob('');
    stickerJob.payload = { id: 'wamid-2', from: '5491112345678', type: 'location' };
    const incompatibleReply = await prepareMessage(db, stickerJob, async () => {});
    expect(incompatibleReply).toEqual({
      kind: 'reply',
      text: 'Este tipo de mensaje no es compatible. Podés enviar texto, audio o una foto.',
    });
    expect(draftReads).toBe(0);
  });

  it('preserva los controles de seguridad: rechaza cambio de vínculo (user_id distinto) y corte global del bot para clientes', async () => {
    let linkUserId = 'otro-usuario';
    let botActiveValue = 'true';
    let role = 'client';

    const db = {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => {
            if (table === 'whatsapp_links') return Promise.resolve({ data: { user_id: linkUserId }, error: null });
            if (table === 'profiles') {
              return Promise.resolve({
                data: { role, subscription_status: 'active', subscription_until: null },
                error: null,
              });
            }
            if (table === 'app_settings') {
              return Promise.resolve({ data: { whatsapp_responses_enabled: true }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
          in: () =>
            Promise.resolve({
              data: [{ key: 'bot_active', value: botActiveValue }],
              error: null,
            }),
        };
        return chain;
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    } as unknown as Parameters<typeof prepareMessage>[0];

    // Cambio de vínculo entre encolado y ejecución
    const mismatchReply = await prepareMessage(db, buildJob('Gasté 500 en pan', 'user-1'), async () => {});
    expect(mismatchReply.kind).toBe('reply');
    expect(String(mismatchReply.text)).toContain('El vínculo de tu cuenta cambió');

    // Corte general del bot bloquea a clientes pero permite a administradores
    linkUserId = 'user-1';
    botActiveValue = 'false';
    const pausedClient = await prepareMessage(db, buildJob('Gasté 500 en pan', 'user-1'), async () => {});
    expect(pausedClient).toEqual({
      kind: 'reply',
      text: 'Pesito: El bot se encuentra temporalmente en pausa por mantenimiento. Intentá nuevamente más tarde.',
      clear_summary: true,
    });

    role = 'admin';
    const allowedAdmin = await prepareMessage(db, buildJob('CONFIRMAR', 'user-1'), async () => {});
    expect(allowedAdmin).toEqual({ kind: 'confirm' });
  });
});
