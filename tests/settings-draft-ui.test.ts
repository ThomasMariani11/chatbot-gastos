// @vitest-environment jsdom
import { act, createElement as h, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings, type UserProfile } from '../src/Settings';
import { useProfileDraft } from '../src/useProfileDraft';
import { PwaUpdates, useUpdateBlocker } from '../src/PwaUpdates';
import { PwaUpdater } from '../src/pwaUpdateCoordinator';
const api = vi.hoisted(() => ({ write: vi.fn(), get: vi.fn() }));
vi.mock('../src/supabase', () => ({ supabase: { from: (table: string) => ({
  select: () => ({ eq: () => ({ single: async () => ({ data: { whatsapp_responses_enabled: true }, error: null }) }), in: async () => ({ data: [], error: null }) }),
  update: (names: object) => ({ eq: (_key: string, id: string) => ({ select: () => ({ abortSignal: () => ({ single: () => api.write(id, names) }) }) }) }),
  table,
}) } }));
vi.mock('../src/usePwaInstall', () => ({ usePwaInstall: () => ({ canInstall: false, showIosModal: false, showDesktopModal: false, triggerInstall: vi.fn(), setShowIosModal: vi.fn(), setShowDesktopModal: vi.fn() }) }));
vi.mock('../src/useSwipeBack', () => ({ useSwipeBack: () => ({ dragOffset: 0, isSwiping: false }) }));
const profile: UserProfile = { id: 'account-a', email: 'ficticia@example.test', first_name: 'Ana', last_name: 'Prueba', role: 'client', subscription_status: 'active', subscription_until: null, phone_number: null };
let root: Root, node: HTMLDivElement, updater: PwaUpdater;
let activeProfile = profile;
function Harness() {
  const nameDraft = useProfileDraft(activeProfile.id, activeProfile), [open, setOpen] = useState(true);
  useUpdateBlocker(nameDraft.state.dirty || nameDraft.state.saving, 'Guardá o descartá tus cambios en Ajustes para actualizar.');
  return h('div', {}, h('button', { onClick: () => setOpen(!open), 'data-test': 'navigate' }, 'Otra pantalla'),
    open ? h(Settings, { userId: activeProfile.id, userProfile: activeProfile, nameDraft, onBack: () => setOpen(false) }) : h('p', {}, 'Inicio'));
}
async function render() { await act(async () => root.render(h(StrictMode, null, h(PwaUpdates, { updater, children: h(Harness) })))); }
async function input(selector: string, value: string) {
  const field = node.querySelector<HTMLInputElement>(selector)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function click(text: string) { const button = [...node.querySelectorAll('button')].find(el => el.textContent === text); expect(button).toBeDefined(); await act(async () => button!.click()); }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); activeProfile = { ...profile };
  api.write.mockImplementation(async (id, names) => ({ data: { id, ...names }, error: null }));
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  updater = new PwaUpdater({ window, document, fetch: vi.fn(async () => new Response(JSON.stringify({ version: 'bbbbbbb' }), { headers: { 'content-type': 'application/json' } })) as typeof fetch, base: '/chatbot-gastos/', version: 'aaaaaaa', reload: vi.fn() });
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); updater.stop(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('Ajustes real y aviso global', () => {
  it('refrescar perfil y volver del foco conserva lo escrito y muestra un solo aviso', async () => {
    await input('input[autocomplete="given-name"]', 'Anita'); activeProfile = { ...profile, subscription_until: '2027-01-01T00:00:00Z' };
    await render(); await act(async () => window.dispatchEvent(new Event('focus')));
    expect(node.querySelector<HTMLInputElement>('input[autocomplete="given-name"]')!.value).toBe('Anita');
    expect(node.querySelectorAll('.pwa-update-notice')).toHaveLength(1); expect(node.querySelector<HTMLButtonElement>('.pwa-update-notice button')!.disabled).toBe(true);
  });
  it('cerrar y reabrir Ajustes conserva el borrador en la misma sesión', async () => {
    await input('input[autocomplete="given-name"]', 'Anita'); await click('Otra pantalla'); await click('Otra pantalla');
    expect(node.querySelector<HTMLInputElement>('input[autocomplete="given-name"]')!.value).toBe('Anita');
  });
  it('un cambio remoto avisa sin sobrescribir; usar datos actualizados desbloquea', async () => {
    await input('input[autocomplete="given-name"]', 'Anita'); activeProfile = { ...profile, last_name: 'Remoto' }; await render();
    expect(node.textContent).toContain('Conservamos lo que estabas escribiendo'); await click('Usar datos actualizados');
    expect(node.querySelector<HTMLInputElement>('input[autocomplete="family-name"]')!.value).toBe('Remoto'); expect(node.querySelector<HTMLButtonElement>('.pwa-update-notice button')!.disabled).toBe(false);
  });
  it('fallo de guardado conserva entradas y luego permite guardar la fila confirmada', async () => {
    await input('input[autocomplete="given-name"]', 'Anita'); api.write.mockResolvedValueOnce({ data: null, error: { message: 'PRIVATE_DATABASE_DETAIL' } });
    await act(async () => node.querySelector('form.settings-profile-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(node.querySelector<HTMLInputElement>('input[autocomplete="given-name"]')!.value).toBe('Anita'); expect(node.textContent).toContain('Conservamos tus cambios'); expect(node.textContent).not.toContain('PRIVATE_DATABASE_DETAIL');
    await act(async () => node.querySelector('form.settings-profile-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(node.textContent).toContain('Datos personales guardados.'); expect(node.querySelector<HTMLButtonElement>('.pwa-update-notice button')!.disabled).toBe(false);
  });
  it('cambiar de usuario limpia nombres y no conserva el borrador ajeno', async () => {
    await input('input[autocomplete="given-name"]', 'Anita'); activeProfile = { ...profile, id: 'account-b', first_name: 'Bea' }; await render();
    expect(node.querySelector<HTMLInputElement>('input[autocomplete="given-name"]')!.value).toBe('Bea'); expect(node.textContent).not.toContain('Anita');
  });
});
