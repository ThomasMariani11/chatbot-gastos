// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiQuotaUsage, AiQuotaView, parseAiQuotaSnapshot, type AiQuotaSnapshot } from '../src/AiQuotaUsage';
const api = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn() }));
vi.mock('../src/supabase', () => ({ supabase: { rpc: (name: string, args?: unknown) => name === 'admin_update_ai_quota_policy' ? api.update(name, args) : ({ abortSignal: (signal: AbortSignal) => api.read(name, signal) }) } }));
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

const withUsers = (): AiQuotaSnapshot => {
  const s = snapshot(40);
  s.lanes[0] = { ...s.lanes[0], per_user_limit: 15, top_users: [{ user_id: 'u1', name: 'Ana Pérez', used: 15 }, { user_id: 'u2', name: 'Luis Gómez', used: 7 }] };
  s.lanes[1] = { ...s.lanes[1], per_user_limit: 25, top_users: [] };
  return s;
};
const setValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const field = (name: string) => node.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const save = async (lane: string) => { await act(async () => node.querySelector<HTMLFormElement>(`form[data-lane="${lane}"]`)!.requestSubmit()); };

it('parseAiQuotaSnapshot acepta per_user_limit y top_users', () => {
  expect(parseAiQuotaSnapshot(withUsers())).toEqual(withUsers());
});
it('acepta la respuesta anterior sin esos campos', () => {
  expect(parseAiQuotaSnapshot(snapshot())).toEqual(snapshot());
});
it('rechaza top_users con used negativo o más de 5 filas, o per_user_limit inválido', () => {
  const bad = (patch: object) => { const s = withUsers(); s.lanes[0] = { ...s.lanes[0], ...patch } as never; return s; };
  const six = Array.from({ length: 6 }, (_, i) => ({ user_id: `u${i}`, name: `N${i}`, used: 1 }));
  for (const s of [bad({ top_users: [{ user_id: 'u1', name: 'A', used: -1 }] }), bad({ top_users: six }), bad({ per_user_limit: 0 }), bad({ per_user_limit: 10001 }), bad({ top_users: 'x' })]) expect(() => parseAiQuotaSnapshot(s)).toThrow();
});
it('la vista muestra "Por cliente: N por día" y la lista "Nombre Apellido — N"', async () => {
  await act(async () => root.render(h(AiQuotaView, { snapshot: withUsers() })));
  expect(node.textContent).toContain('Por cliente: 15 por día'); expect(node.textContent).toContain('Por cliente: 25 por día');
  const items = [...node.querySelectorAll('.bot-ops-top li')].map(li => li.textContent);
  expect(items).toEqual(['Ana Pérez — 15', 'Luis Gómez — 7']);
});
it('sin campos nuevos no muestra límite por cliente ni lista', async () => {
  await act(async () => root.render(h(AiQuotaView, { snapshot: snapshot() })));
  expect(node.textContent).not.toContain('Por cliente'); expect(node.querySelector('.bot-ops-top')).toBeNull();
});
it('el formulario envía admin_update_ai_quota_policy con los valores y recarga', async () => {
  api.read.mockResolvedValue({ data: withUsers(), error: null });
  api.update.mockResolvedValue({ data: { lane: 'qwen', daily_limit: 120, per_user_daily_limit: 20, enabled: true }, error: null });
  await act(async () => root.render(h(AiQuotaUsage)));
  await act(async () => { setValue(field('qwen-daily'), '120'); setValue(field('qwen-per-user'), '20'); });
  const before = api.read.mock.calls.length;
  await save('qwen');
  expect(api.update).toHaveBeenCalledWith('admin_update_ai_quota_policy', { p_lane: 'qwen', p_daily_limit: 120, p_per_user_daily_limit: 20 });
  expect(api.read.mock.calls.length).toBe(before + 1);
});
it('no envía si un valor está fuera de 1–10000 o por cliente > global, y explica el motivo', async () => {
  await act(async () => root.render(h(AiQuotaView, { snapshot: withUsers(), onSave: async (...a) => api.update(...a) })));
  for (const [g, p] of [['0', '1'], ['100', '10001'], ['10', '11'], ['', '5'], ['1.5', '1']]) {
    await act(async () => { setValue(field('qwen-daily'), g); setValue(field('qwen-per-user'), p); });
    await save('qwen');
    expect(node.querySelector('form[data-lane="qwen"] [role="alert"]')?.textContent).toContain('entre 1 y 10000');
  }
  expect(api.update).not.toHaveBeenCalled();
});
it('un error de la RPC se muestra sin romper la vista ni filtrar detalles SQL', async () => {
  api.read.mockResolvedValue({ data: withUsers(), error: null });
  api.update.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'PRIVATE_SQL_DETAIL' } });
  await act(async () => root.render(h(AiQuotaUsage)));
  await save('whisper');
  expect(node.textContent).toContain('entre 1 y 10000'); expect(node.textContent).not.toContain('PRIVATE_SQL_DETAIL'); expect(node.textContent).toContain('0 / 100');
  api.update.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
  await save('whisper');
  expect(node.querySelector('form[data-lane="whisper"] [role="alert"]')?.textContent).toContain('No pude guardar'); expect(node.textContent).toContain('0 / 100');
  api.update.mockRejectedValueOnce(Error('red'));
  await save('whisper');
  expect(node.querySelector('form[data-lane="whisper"] [role="alert"]')?.textContent).toContain('No pude guardar');
});
it('con el SQL anterior (sin per_user_limit) no hay formulario y avisa que la edición no está disponible', async () => {
  await act(async () => root.render(h(AiQuotaView, { snapshot: snapshot(), onSave: async () => null })));
  expect(node.querySelector('form')).toBeNull(); expect(node.querySelector('input')).toBeNull();
  expect(node.textContent).toContain('La edición de límites todavía no está disponible.');
});
