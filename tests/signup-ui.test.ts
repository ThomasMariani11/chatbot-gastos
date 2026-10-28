// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Login } from '../src/Login';
import { registrationErrorMessage } from '../src/registration';
const api = vi.hoisted(() => ({ rpc: vi.fn(), signup: vi.fn(), from: vi.fn() }));
vi.mock('../src/supabase', () => ({ supabase: { rpc: api.rpc, from: api.from, auth: { signUp: api.signup } } }));
vi.mock('../src/PwaUpdates', () => ({ useUpdateBlocker: vi.fn() }));
let root: Root, node: HTMLDivElement;
async function input(selector: string, value: string) { const el = node.querySelector<HTMLInputElement>(selector)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function submit() { await act(async () => { node.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetAllMocks();
  api.rpc.mockResolvedValue({ data: { valid: true, duration_days: 30 }, error: null });
  api.signup.mockResolvedValue({ data: { user: { id: 'synthetic', identities: [{}] }, session: { access_token: 'synthetic' } }, error: null });
  node = document.createElement('div'); document.body.append(node); root = createRoot(node); await act(async () => root.render(h(Login)));
  await act(async () => [...node.querySelectorAll('button')].find(b => b.textContent === 'Crear cuenta')!.click());
  await input('input.invite-code-input', 'TEST-CODE'); await input('input[autocomplete="given-name"]', ' Nombre '); await input('input[autocomplete="family-name"]', ' Apellido ');
  await input('input[type="email"]', 'ficticia@example.invalid');
  const passwords = node.querySelectorAll<HTMLInputElement>('input[type="password"]');
  for (const field of passwords) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'test-password'); field.dispatchEvent(new Event('input', { bubbles: true })); }); }
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); });
describe('registro real del cliente', () => {
  it('envía metadata una vez y confía en la creación atómica sin una actualización posterior', async () => { await submit(); expect(api.signup).toHaveBeenCalledTimes(1); expect(api.signup.mock.calls[0][0].options.data).toEqual({ first_name: 'Nombre', last_name: 'Apellido', full_name: 'Nombre Apellido', invitation_code: 'TEST-CODE' }); expect(api.from).not.toHaveBeenCalled(); expect(node.textContent).toContain('¡Cuenta creada!'); });
  it('sin sesión pide confirmar sin prometer activación ni entrega del correo', async () => { api.signup.mockResolvedValue({ data: { user: { id: 'synthetic', identities: [{}] }, session: null }, error: null }); await submit(); expect(node.textContent).toContain('Revisá tu correo'); expect(node.textContent).not.toContain('licencia activada'); });
  it('respuesta ofuscada de cuenta existente no anuncia un alta', async () => { api.signup.mockResolvedValue({ data: { user: { id: 'synthetic', identities: [] }, session: null }, error: null }); await submit(); expect(node.textContent).toContain('No uses otro código'); expect(node.textContent).not.toContain('¡Cuenta creada!'); });
  it('un fallo SQL visible es seguro y permite un reintento con el formulario conservado', async () => { api.signup.mockResolvedValueOnce({ data: {}, error: { message: 'Database error saving new user PRIVATE_CANARY' } }); await submit(); expect(node.textContent).toContain('No se consumió tu invitación'); expect(node.textContent).not.toContain('PRIVATE_CANARY'); expect(node.querySelector<HTMLInputElement>('input[autocomplete="given-name"]')!.value).toBe(' Nombre '); await submit(); expect(api.signup).toHaveBeenCalledTimes(2); expect(node.textContent).toContain('¡Cuenta creada!'); });
  it.each([new Error('Failed to fetch PRIVATE_CANARY'), new Error('SIGNUP_RESPONSE_MISSING')])('no promete fallo o éxito si se perdió la respuesta y desbloquea el envío (%s)', async error => { api.signup.mockRejectedValueOnce(error); await submit(); expect(node.textContent).toContain('Antes de repetir, probá iniciar sesión'); expect(node.textContent).not.toContain('PRIVATE_CANARY'); expect(node.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false); });
  it('preflight inválido no llama Auth y orienta el reintento de una cuenta ya creada', async () => { api.rpc.mockResolvedValue({ data: { valid: false }, error: null }); await submit(); expect(api.signup).not.toHaveBeenCalled(); expect(node.textContent).toContain('Si ya intentaste crear esta cuenta'); });
  it.each(['reject', 'error'])('el fallo de preflight %s se distingue de código inválido', async kind => { if (kind === 'reject') api.rpc.mockRejectedValue(new Error('PRIVATE_CANARY')); else api.rpc.mockResolvedValue({ data: null, error: { message: 'PRIVATE_CANARY' } }); await submit(); expect(api.signup).not.toHaveBeenCalled(); expect(node.textContent).toContain('No pudimos verificar'); expect(node.textContent).not.toContain('PRIVATE_CANARY'); expect(node.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false); });
  it('dos submits en el mismo turno no duplican Auth ni consumen otro código', async () => { const wait = pending<unknown>(); api.signup.mockReturnValue(wait.promise); await act(async () => { for (let n = 0; n < 2; n++) node.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); expect(api.signup).toHaveBeenCalledTimes(1); await act(async () => wait.resolve({ data: { user: { id: 'synthetic' }, session: {} }, error: null })); });
  it('una respuesta de código anterior no pinta válido sobre el código nuevo', async () => { const old = pending<unknown>(); api.rpc.mockReturnValueOnce(old.promise); await act(async () => node.querySelector<HTMLInputElement>('.invite-code-input')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))); await input('.invite-code-input', 'NUEVO-CODIGO'); await act(async () => old.resolve({ data: { valid: true }, error: null })); expect(node.textContent).not.toContain('Código válido'); });
  it('FE-13: una respuesta tardía de código inválido no invalida el código nuevo válido ni bloquea el envío', async () => {
    const pSlow = pending<{ data: unknown; error: unknown }>();
    const pFast = pending<{ data: unknown; error: unknown }>();
    // Primera llamada (lenta) para CODE-A
    api.rpc.mockReturnValueOnce(pSlow.promise);
    await input('.invite-code-input', 'CODE-A');
    await act(async () => node.querySelector<HTMLInputElement>('.invite-code-input')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

    // Segunda llamada (rápida) para CODE-B
    api.rpc.mockReturnValueOnce(pFast.promise);
    await input('.invite-code-input', 'CODE-B');
    await act(async () => node.querySelector<HTMLInputElement>('.invite-code-input')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

    // Resuelve CODE-B como válido
    await act(async () => pFast.resolve({ data: { valid: true, duration_days: 30 }, error: null }));
    expect(node.textContent).toContain('Código válido');
    expect(node.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);

    // Resuelve tardíamente CODE-A como inválido
    await act(async () => pSlow.resolve({ data: { valid: false, error: 'Código inválido o ya utilizado.' }, error: null }));

    // El resultado tardío debe ser descartado: CODE-B sigue válido y botón habilitado
    expect(node.textContent).toContain('Código válido');
    expect(node.textContent).not.toContain('Código inválido');
    expect(node.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });
  it('FE-13: borrar el código de invitación descarta cualquier respuesta previa y no muestra mensajes residuales', async () => {
    const pWait = pending<{ data: unknown; error: unknown }>();
    api.rpc.mockReturnValueOnce(pWait.promise);
    await input('.invite-code-input', 'CODE-WAIT');
    await act(async () => node.querySelector<HTMLInputElement>('.invite-code-input')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

    // Usuario borra el código
    await input('.invite-code-input', '');

    // Resuelve la petición en vuelo
    await act(async () => pWait.resolve({ data: { valid: false, error: 'Código inválido o ya utilizado.' }, error: null }));

    expect(node.textContent).not.toContain('Código inválido');
    expect(node.textContent).not.toContain('Código válido');
    expect(node.querySelector('.code-feedback-badge')).toBeNull();
  });
  it('FE-13: cambiar a la pestaña de login cancela la validación y no aplica la respuesta resuelta mientras estaba oculta', async () => {
    const pWait = pending<{ data: unknown; error: unknown }>();
    api.rpc.mockReturnValueOnce(pWait.promise);
    await input('.invite-code-input', 'CODE-TAB');
    await act(async () => node.querySelector<HTMLInputElement>('.invite-code-input')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

    // Usuario cambia a iniciar sesión
    const loginTab = [...node.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Iniciar sesión')!;
    await act(async () => loginTab.click());

    // Resuelve la petición vieja mientras estamos en login
    await act(async () => pWait.resolve({ data: { valid: true, duration_days: 30 }, error: null }));

    // Si volvemos a registro pero la nueva validación queda pendiente
    const pNew = pending<{ data: unknown; error: unknown }>();
    api.rpc.mockReturnValueOnce(pNew.promise);
    const registerTab = [...node.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Crear cuenta')!;
    await act(async () => registerTab.click());

    // No debe mostrar la respuesta vieja que llegó mientras estaba en login
    expect(node.textContent).not.toContain('Código válido');
    expect(node.textContent).toContain('Verificando código…');
  });
  it.each(['already registered', 'email rate limit exceeded', 'Password too weak', 'INTERNAL_PRIVATE'])('sanea los errores de Auth (%s)', error => { expect(registrationErrorMessage({ message: error }, true)).not.toContain(error); });
});
