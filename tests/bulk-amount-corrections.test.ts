import { describe, expect, it, vi } from 'vitest';
import { parsePendingEdit } from '../supabase/functions/whatsapp-webhook/draft-edit';
import { prepareMessage } from '../supabase/functions/whatsapp-webhook/processor';
import type { Job } from '../supabase/functions/whatsapp-webhook/queue';

const context = {
  group_id: 'synthetic-group', version: 7,
  items: [1, 2, 3, 21].map(position => ({
    position, kind: 'expense' as const, description: 'Prueba', amount: position * 101,
    currency: 'ARS', status: 'pending', occurred_on: '2026-10-30',
  })),
};

describe('BE-22: regresión de correcciones dobles de importes', () => {
  it.each([
    ['El 1 fue de 150 y el 2 fue de 250', [1, 2], [150, 250]],
    ['El 1 fue de 150,50, el 2 fue de 250,25', [1, 2], [150.5, 250.25]],
    ['El 1 fue de 1.500,50; el 2 fue de 2 mil', [1, 2], [1500.5, 2000]],
    ['El 1 fue de 150\nEl 2 fue de 250', [1, 2], [150, 250]],
    ['El 1 fue de 150\r\nEl 2 fue de 250', [1, 2], [150, 250]],
    ['El 21 fue de 150 y el 2 fue de 250', [21, 2], [150, 250]],
  ])('interpreta todos los cambios de %s', (raw, positions, amounts) => {
    const action = parsePendingEdit(raw as string, context);
    expect(action).toMatchObject({kind: 'edit', group_id: context.group_id, version: 7});
    if (action?.kind !== 'edit') throw Error('Falta la acción múltiple');
    expect(action.edits).toEqual((positions as number[]).map((position, i) => ({position, patch: {amount: (amounts as number[])[i]}})));
    expect(context.items.map(i => i.amount)).toEqual([101, 202, 303, 2121]);
  });

  it.each([
    'El 1 fue de 150 y el 2 fue de 0',
    'El 1 fue de 150 y el 2 fue de -250',
    'El 1 fue de 150 y el 2 fue de 250,123',
    'El 1 fue de 150 y el 2 fue de 1000000000000',
    'El 1 fue de 150 y el 99 fue de 250',
    'El 1 fue de 150 y el 1 fue de 250',
    'El 1 fue de 150 y el 2 de 250',
    'El 1 fue de 150 y el 2 fue de 250 y confirmá',
    'El 1 fue de 150 y el 2 moneda EUR',
  ])('rechaza el mensaje completo sin editar parcialmente: %s', raw => {
    expect(parsePendingEdit(raw, context)?.kind).toBe('reply');
    expect(context.items.map(i => i.amount)).toEqual([101, 202, 303, 2121]);
  });

  it('rechaza destinos quitados, sin grupo o sin versión', () => {
    const text = 'El 1 fue de 150 y el 2 fue de 250';
    for (const ctx of [{...context, group_id: undefined}, {...context, version: undefined}, {...context, items: context.items.map(i => i.position === 2 ? {...i, status: 'removed'} : i)}]) {
      expect(parsePendingEdit(text, ctx)?.kind).toBe('reply');
    }
  });

  it('el procesador real devuelve ambas ediciones sin red, cuota IA ni checkpoint de alta', async () => {
    const reads: string[] = [];
    const db = {
      from(table: string) {
        reads.push(table);
        const data = table === 'whatsapp_links' ? {user_id: 'synthetic-user'}
          : table === 'profiles' ? {role: 'client', subscription_status: 'active', subscription_until: null}
          : table === 'app_settings' ? {whatsapp_responses_enabled: true} : null;
        const chain = {select: () => chain, eq: () => chain, maybeSingle: async () => ({data, error: null}), in: async () => ({data: [{key: 'bot_active', value: 'true'}], error: null})};
        return chain;
      },
      rpc: async () => ({data: {...context, is_stale: false}, error: null}),
    } as unknown as Parameters<typeof prepareMessage>[0];
    const checkpoint = vi.fn(async () => {});
    const beforeAiRequest = vi.fn(async () => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {throw Error('La corrección no debe usar red');});
    const job = {id: 'synthetic-job', wa_id: 'synthetic-sender', user_id: 'synthetic-user', payload: {id: 'synthetic-message', from: 'synthetic-sender', type: 'text', text: {body: 'El 1 fue de 150 y el 2 fue de 250'}}, attempts: 1, effect_applied: false, parsed_result: null, reply_text: null} as Job;
    try {
      const result = await prepareMessage(db, job, checkpoint, undefined, beforeAiRequest);
      expect(result).toMatchObject({kind: 'edit', group_id: context.group_id, version: 7, edits: [{position: 1, patch: {amount: 150}}, {position: 2, patch: {amount: 250}}]});
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(beforeAiRequest).not.toHaveBeenCalled();
      expect(checkpoint).not.toHaveBeenCalled();
      expect(reads).not.toContain('transactions');
    } finally { fetchSpy.mockRestore(); }
  });
});
