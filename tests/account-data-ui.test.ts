// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/supabase', () => ({ supabase: {} }));
import { AccountDataCard } from '../src/AccountDataCard';
import { ACCOUNT_DELETED_FLAG } from '../src/accountDeletedNotice';
import type { DeleteResult } from '../src/accountData';

// 3.2 (LEG-01): tarjeta "Tus datos" en Ajustes. Datos ficticios; descarga y borrado simulados.
let root: Root, node: HTMLDivElement;
const download = vi.fn(async () => undefined);
const remove = vi.fn(async (_email: string, _password: string): Promise<DeleteResult> => 'deleted');

async function render(isAdmin = false) {
  await act(async () => root.render(h(AccountDataCard, { userId: 'user-ficticio', email: 'ficticia@example.test', isAdmin, download, remove })));
}
const button = (text: string) => [...node.querySelectorAll('button')].find((b) => b.textContent === text);
async function click(text: string) { await act(async () => button(text)!.click()); }
async function type(value: string) {
  const field = node.querySelector<HTMLInputElement>('input[type="password"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  download.mockClear(); remove.mockReset(); remove.mockResolvedValue('deleted');
  sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); });

describe('Tus datos', () => {
  it('descarga los movimientos de la cuenta', async () => {
    await render();
    await click('Descargar mis movimientos');
    expect(download).toHaveBeenCalledWith('user-ficticio');
  });

  it('si falla la descarga lo explica sin romper la pantalla', async () => {
    download.mockRejectedValueOnce(new Error('EXPORT_READ'));
    await render();
    await click('Descargar mis movimientos');
    expect(node.querySelector('[role="alert"]')?.textContent).toContain('No pude preparar el archivo');
  });

  it('el administrador no ve la opción de borrar', async () => {
    await render(true);
    expect(button('Borrar mi cuenta')).toBeUndefined();
    expect(node.textContent).toContain('La cuenta de administrador no se borra desde la app');
  });

  it('el aviso explica qué se borra y no deja confirmar sin contraseña', async () => {
    await render();
    await click('Borrar mi cuenta');
    const dialog = node.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('No se puede deshacer');
    expect(dialog.textContent).toContain('pagos');
    expect(dialog.textContent).toContain('días de suscripción');
    expect(button('Borrar definitivamente')!.disabled).toBe(true);
  });

  it('con la contraseña equivocada avisa y no marca la cuenta como borrada', async () => {
    remove.mockResolvedValueOnce('wrong_password');
    await render();
    await click('Borrar mi cuenta');
    await type('Equivocada1');
    await click('Borrar definitivamente');
    expect(remove).toHaveBeenCalledWith('ficticia@example.test', 'Equivocada1');
    expect(node.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('La contraseña no es correcta');
    expect(sessionStorage.getItem(ACCOUNT_DELETED_FLAG)).toBeNull();
  });

  it('un fallo sin confirmación no afirma que no se borró nada', async () => {
    remove.mockResolvedValueOnce('failed');
    await render();
    await click('Borrar mi cuenta');
    await type('Clave1234');
    await click('Borrar definitivamente');
    const alert = node.querySelector('[role="dialog"] [role="alert"]')?.textContent;
    expect(alert).toContain('No pude confirmar el borrado');
    expect(alert).not.toContain('No se borró nada');
  });

  it('al borrar deja el aviso para la pantalla de ingreso', async () => {
    await render();
    await click('Borrar mi cuenta');
    await type('Clave1234');
    await click('Borrar definitivamente');
    expect(sessionStorage.getItem(ACCOUNT_DELETED_FLAG)).toBe('1');
  });

  it('el aviso lleva el foco a la contraseña y se cierra con Escape', async () => {
    await render();
    await click('Borrar mi cuenta');
    expect(document.activeElement).toBe(node.querySelector('input[type="password"]'));
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it('al borrar quita #settings de la dirección para que el próximo ingreso no abra Ajustes', async () => {
    window.history.replaceState(null, '', '/chatbot-gastos/#settings');
    await render();
    await click('Borrar mi cuenta');
    await type('Clave1234');
    await click('Borrar definitivamente');
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/chatbot-gastos/');
  });

  it('cancelar cierra el aviso sin borrar', async () => {
    await render();
    await click('Borrar mi cuenta');
    await click('Cancelar');
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });
});
