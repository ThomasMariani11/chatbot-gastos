// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiQuotaUsage, AiQuotaView, parseAiQuotaSnapshot, type AiQuotaSnapshot } from '../src/AiQuotaUsage';
const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../src/supabase', () => ({ supabase: { rpc: (name: string) => ({ abortSignal: (signal: AbortSignal) => api.read(name, signal) }) } }));
const snapshot = (used = 0): AiQuotaSnapshot => ({ day: '2026-10-26', resets_at: '2026-10-27T03:00:00Z', lanes: [{ lane: 'qwen', used, limit: 100, enabled: true, level: 'ok' }, { lane: 'whisper', used: 0, limit: 200, enabled: true, level: 'ok' }] });
let node: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  api.read.mockResolvedValue({ data: snapshot(), error: null });
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.clearAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
for (const [used, role, text] of [[74, null, null], [75, 'status', '75%'], [89, 'status', '75%'], [90, 'alert', '90%'], [100, 'alert', 'Cupo alcanzado']] as const) {
  it(`aviso visible al umbral ${used}, sin depender de level suministrado`, async () => {
    await act(async () => root.render(h(AiQuotaView, { snapshot: snapshot(used) })));
    expect(node.textContent).toContain(`${used} / 100`); expect(node.textContent).toContain('0 / 200');
    const warning = node.querySelector('.bot-ops-warning');
    expect(warning?.getAttribute('role') ?? null).toBe(role); if (text) expect(warning?.textContent).toContain(text);
    expect(node.querySelector('progress')?.value).toBe(used);
  });
}
it('rechaza respuesta inválida o incompleta en vez de mostrar cupo cero', () => {
  for (const value of [null, {}, { ...snapshot(), lanes: [] }, { ...snapshot(), lanes: [snapshot().lanes[0], snapshot().lanes[0]] }, { ...snapshot(), lanes: [{ ...snapshot().lanes[0], used: -1 }, snapshot().lanes[1]] }]) expect(() => parseAiQuotaSnapshot(value)).toThrow();
  expect(parseAiQuotaSnapshot(snapshot())).toEqual(snapshot());
});
it('fallo oculta el dato anterior, muestra reintento sin detalles SQL y recupera', async () => {
  await act(async () => root.render(h(AiQuotaUsage)));
  expect(node.textContent).toContain('0 / 100');
  api.read.mockResolvedValueOnce({ data: null, error: { message: 'PRIVATE_SQL_DETAIL' } });
  await act(async () => vi.advanceTimersByTime(30000));
  expect(node.textContent).toContain('No pude actualizar'); expect(node.textContent).not.toContain('0 / 100'); expect(node.textContent).not.toContain('PRIVATE_SQL_DETAIL');
  await act(async () => node.querySelector('button')!.click()); expect(node.textContent).toContain('0 / 100');
});
it('no solapa lecturas ni sigue sondeando después de desmontar', async () => {
  let resolve!: (value: unknown) => void;
  api.read.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await act(async () => root.render(h(AiQuotaUsage)));
  const signal = api.read.mock.calls[0][1] as AbortSignal;
  await act(async () => vi.advanceTimersByTime(90000)); expect(api.read).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
  await act(async () => { resolve({ data: snapshot(90), error: null }); await vi.advanceTimersByTimeAsync(90000); });
  expect(node.textContent).toBe(''); expect(api.read).toHaveBeenCalledTimes(1);
});
