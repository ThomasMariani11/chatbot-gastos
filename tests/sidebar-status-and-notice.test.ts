import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/supabase', () => ({ supabase: {} }));
import { botServiceFromConfig, sidebarStatus } from '../src/sidebarStatus';
import { ENTRY_NOTICE_TTL_MS, isTransientEntryNotice } from '../src/entryNotice';
import { readDashboardSnapshot } from '../src/dashboardData';
import type { supabase } from '../src/supabase';

describe('estado del bot (configuración global)', () => {
  it('bot_active "false" pausa el bot; ausente u otro valor lo deja funcionando, igual que el panel admin', () => {
    expect(botServiceFromConfig([{ key: 'bot_active', value: 'false' }])).toBe('paused');
    expect(botServiceFromConfig([{ key: 'bot_active', value: 'true' }])).toBe('running');
    expect(botServiceFromConfig([{ key: 'whatsapp_bot_phone', value: '5491100000000' }])).toBe('running');
    expect(botServiceFromConfig([])).toBe('running');
  });
  it('una respuesta ilegible no inventa un estado', () => {
    expect(botServiceFromConfig(null)).toBe('unknown');
    expect(botServiceFromConfig({ value: 'false' })).toBe('unknown');
  });
});

describe('barra lateral: bot y WhatsApp por separado', () => {
  it('cuenta sin vincular: el bot puede funcionar, pero WhatsApp no figura activo', () => {
    const [bot, whatsapp] = sidebarStatus('running', 'unlinked');
    expect(bot).toMatchObject({ tone: 'active', title: 'Bot funcionando' });
    expect(whatsapp).toMatchObject({ tone: 'unlinked', title: 'WhatsApp sin vincular' });
    expect(`${whatsapp.title} ${whatsapp.detail}`).not.toMatch(/activo/i);
  });
  it('bot pausado globalmente con WhatsApp vinculado', () => {
    const [bot, whatsapp] = sidebarStatus('paused', 'active');
    expect(bot).toMatchObject({ tone: 'paused', title: 'Bot en pausa' });
    expect(whatsapp).toMatchObject({ tone: 'active', title: 'WhatsApp vinculado' });
  });
  it('respuestas desactivadas por la cuenta se muestran en la línea de WhatsApp, no como falla del bot', () => {
    const [bot, whatsapp] = sidebarStatus('running', 'paused');
    expect(bot.title).toBe('Bot funcionando');
    expect(whatsapp).toMatchObject({ tone: 'paused', title: 'WhatsApp vinculado', detail: 'Respuestas desactivadas' });
  });
  it('carga y error muestran estados neutros en ambas líneas', () => {
    expect(sidebarStatus('loading', 'loading').map(s => s.tone)).toEqual(['loading', 'loading']);
    expect(sidebarStatus('unknown', 'unknown').map(s => s.tone)).toEqual(['unknown', 'unknown']);
  });
  it('valores inesperados no rompen la barra', () => {
    const odd = sidebarStatus(undefined as never, 'otro' as never);
    expect(odd.map(s => s.tone)).toEqual(['unknown', 'unknown']);
  });
});

describe('aviso "Movimiento guardado."', () => {
  it('los avisos de éxito son transitorios; los errores no', () => {
    for (const ok of ['Movimiento guardado.', 'Envío comprobado. Se guardó una sola vez.', 'El envío ya estaba guardado. Lo comprobamos sin duplicarlo.', 'Ese envío ya se había guardado y después se eliminó. No lo volvimos a crear.']) {
      expect(isTransientEntryNotice(ok)).toBe(true);
    }
    expect(isTransientEntryNotice('No pudimos guardar el movimiento.')).toBe(false);
    expect(isTransientEntryNotice('')).toBe(false);
    expect(ENTRY_NOTICE_TTL_MS).toBeGreaterThanOrEqual(3000);
    expect(ENTRY_NOTICE_TTL_MS).toBeLessThanOrEqual(8000);
  });
});

describe('snapshot del dashboard incluye el estado global del bot en la misma lectura de system_config', () => {
  function client(config: Array<{ key: string; value: string }> | null, error = false) {
    const calls: string[] = [];
    const from = (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain, eq: (k: string, v: unknown) => { filters[k] = v; return chain; },
        in: (k: string, v: unknown) => { filters[`in:${k}`] = v; return chain; },
        gte: () => { filters.month = true; return chain; }, lt: () => chain, gt: () => { filters.plan = true; return chain; },
        order: () => chain, limit: () => chain, abortSignal: () => chain, maybeSingle: () => chain,
        then: (done: (v: unknown) => unknown, fail: (e: unknown) => unknown) => {
          const name = table === 'transactions' ? (filters.month ? 'monthly' : 'plans') : table;
          calls.push(name);
          const data = name === 'monthly' ? [] : name === 'plans' ? [] : name === 'budgets' ? null
            : name === 'whatsapp_links' ? { status: 'active' } : name === 'app_settings' ? { whatsapp_responses_enabled: true }
            : name === 'system_config' ? config : name === 'months' ? [] : null;
          const keys = filters['in:key'];
          if (name === 'system_config') expect(keys).toEqual(expect.arrayContaining(['whatsapp_bot_phone', 'support_phone', 'bot_active']));
          return Promise.resolve({ data, error: name === 'system_config' && error ? { message: 'x' } : null, ...(name === 'plans' ? { count: 0 } : {}) }).then(done, fail);
        },
      };
      return chain;
    };
    return { calls, client: { from, rpc: () => from('months') } as unknown as typeof supabase };
  }
  it('pausado', async () => {
    const { client: c, calls } = client([{ key: 'whatsapp_bot_phone', value: '5491100000000' }, { key: 'bot_active', value: 'false' }]);
    const snap = await readDashboardSnapshot('u', '2026-11', new AbortController().signal, c);
    expect(snap.botService).toBe('paused');
    expect(calls.filter(n => n === 'system_config')).toHaveLength(1);
  });
  it('funcionando y error de lectura', async () => {
    expect((await readDashboardSnapshot('u', '2026-11', new AbortController().signal, client([{ key: 'bot_active', value: 'true' }]).client)).botService).toBe('running');
    expect((await readDashboardSnapshot('u', '2026-11', new AbortController().signal, client(null, true).client)).botService).toBe('unknown');
  });
});
