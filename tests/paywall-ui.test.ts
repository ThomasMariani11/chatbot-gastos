// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Paywall } from '../src/Paywall';

// FE-21: pantalla de bloqueo por suscripción. Datos ficticios; el cliente de Supabase está simulado.
const api = vi.hoisted(() => ({
  rpc: vi.fn(),
  config: [] as Array<{ key: string; value: string }>,
}));
vi.mock('../src/supabase', () => ({
  supabase: {
    rpc: api.rpc,
    from: () => {
      const query = { select: () => query, in: () => Promise.resolve({ data: api.config, error: null }) };
      return query;
    },
  },
}));
vi.mock('../src/PwaUpdates', () => ({ useUpdateBlocker: vi.fn() }));

type Status = 'active' | 'expired' | 'suspended' | 'pending_code';
let root: Root;
let container: HTMLDivElement;
const onSuccess = vi.fn();
const onSignOut = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  api.rpc.mockReset();
  api.config = [];
  onSuccess.mockReset();
  onSignOut.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function render(status: Status = 'expired', until: string | null = null) {
  await act(async () => {
    root.render(createElement(Paywall, {
      userId: 'usuario-prueba',
      userEmail: 'cliente@example.test',
      subscriptionStatus: status,
      subscriptionUntil: until,
      onSuccess,
      onSignOut,
    }));
  });
}
async function type(value: string) {
  const input = container.querySelector('input.invite-code-input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
const button = () => container.querySelector('button[type="submit"]') as HTMLButtonElement;

describe('FE-21 · Paywall', () => {
  it('muestra el encabezado de cada estado de la cuenta', async () => {
    await render('suspended');
    expect(container.textContent).toContain('Acceso suspendido');
    await render('pending_code');
    expect(container.textContent).toContain('Activá tu cuenta');
    await render('expired', '2026-10-31T12:00:00-03:00');
    expect(container.textContent).toContain('Tu plan ha vencido');
    expect(container.textContent).toContain('finalizó el 31 de octubre de 2026');
  });

  it('código vacío avisa sin llamar al servidor', async () => {
    await render();
    await submit();
    expect(container.textContent).toContain('Ingresá un código de renovación o invitación.');
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it('normaliza el código a mayúsculas y sin espacios antes de verificarlo', async () => {
    api.rpc.mockResolvedValueOnce({ data: { valid: false }, error: null });
    await render();
    await type(' peso-ab 12 ');
    await submit();
    expect(api.rpc).toHaveBeenCalledWith('check_invitation_code', { p_code: 'PESO-AB12' });
  });

  it('código inválido o usado muestra el motivo y no activa la cuenta', async () => {
    api.rpc.mockResolvedValueOnce({ data: { valid: false, error: 'El código ya fue utilizado.' }, error: null });
    await render();
    await type('PESO-USADO');
    await submit();
    expect(container.textContent).toContain('El código ya fue utilizado.');
    expect(api.rpc).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
  });

  it('error del servidor al verificar deja el botón listo para reintentar', async () => {
    api.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } });
    await render();
    await type('PESO-RED');
    await submit();
    expect(container.textContent).toContain('El código no es válido o ya fue utilizado.');
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe('Activar membresía');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('si el canje falla, informa el error y no llama onSuccess', async () => {
    api.rpc
      .mockResolvedValueOnce({ data: { valid: true }, error: null })
      .mockResolvedValueOnce({ data: { success: false, error: 'Código vencido.' }, error: null });
    await render();
    await type('PESO-VENCIDO');
    await submit();
    expect(api.rpc).toHaveBeenLastCalledWith('redeem_invitation_code', { p_code: 'PESO-VENCIDO', p_user_id: 'usuario-prueba' });
    expect(container.textContent).toContain('No se pudo activar el código: Código vencido.');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
  });

  it('canje exitoso confirma la duración y llama onSuccess una sola vez', async () => {
    vi.useFakeTimers();
    api.rpc
      .mockResolvedValueOnce({ data: { valid: true }, error: null })
      .mockResolvedValueOnce({ data: { success: true, duration_days: 30 }, error: null });
    await render();
    await type('PESO-OK30');
    await submit();
    expect(container.textContent).toContain('¡Membresía activada con éxito (por 30 días)!');
    expect(onSuccess).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('ofrece renovar por WhatsApp al soporte, muestra el alias y permite cerrar sesión', async () => {
    api.config = [
      { key: 'support_phone', value: '+54 9 11 0000-0000' },
      { key: 'payment_alias', value: 'pesito.prueba' },
    ];
    await render();
    const link = container.querySelector('a.whatsapp-request-btn') as HTMLAnchorElement;
    expect(link.href).toContain('https://wa.me/5491100000000?text=');
    expect(decodeURIComponent(link.href)).toContain('cliente@example.test');
    expect(container.textContent).toContain('pesito.prueba');
    const signOut = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Cerrar sesión'))!;
    await act(async () => signOut.click());
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
