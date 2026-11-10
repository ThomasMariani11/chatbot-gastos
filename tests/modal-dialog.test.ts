// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalDialog, getFocusableControls } from '../src/ModalDialog';

// FE-21: componente de diálogos reutilizado por toda la PWA.
let root: Root;
let host: HTMLDivElement;
let sibling: HTMLDivElement;
let trigger: HTMLButtonElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sibling = document.createElement('div');
  sibling.id = 'fondo';
  trigger = document.createElement('button');
  trigger.textContent = 'Abrir';
  sibling.append(trigger);
  host = document.createElement('div');
  document.body.append(sibling, host);
  root = createRoot(host);
  trigger.focus();
});
afterEach(async () => {
  await act(async () => root.unmount());
  sibling.remove();
  host.remove();
  document.body.style.overflow = '';
});

function dialogChildren(): ReactNode[] {
  return [
    h('h2', { id: 'titulo', key: 't' }, 'Título de prueba'),
    h('p', { id: 'detalle', key: 'd' }, 'Detalle'),
    h('button', { type: 'button', className: 'modal-close-x', key: 'x' }, '×'),
    h('input', { name: 'monto', key: 'i' }),
    h('button', { type: 'button', key: 'c' }, 'Cancelar'),
    h('button', { type: 'submit', key: 'g' }, 'Guardar'),
  ];
}
type Props = Parameters<typeof ModalDialog>[0];
// Como en la app: el contenido de la pantalla y el diálogo comparten el mismo contenedor.
async function render(props: Partial<Props> = {}, open = true) {
  const onClose = props.onClose ?? vi.fn();
  const dialogProps = { open, onClose, titleId: 'titulo', descriptionId: 'detalle', ...props, children: dialogChildren() } as Props;
  await act(async () => {
    root.render(h('div', { id: 'pantalla' }, h('section', { id: 'contenido' }, 'Resumen'), h(ModalDialog, dialogProps)));
  });
  return onClose;
}
const content = () => document.getElementById('contenido') as HTMLElement;
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
const key = (k: string, shift = false) =>
  act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true })); });

describe('FE-21 · ModalDialog', () => {
  it('expone la semántica de diálogo modal y deja el fondo inerte', async () => {
    await render();
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().getAttribute('aria-labelledby')).toBe('titulo');
    expect(dialog().getAttribute('aria-describedby')).toBe('detalle');
    expect(content().getAttribute('aria-hidden')).toBe('true');
    expect(content().hasAttribute('inert')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('enfoca el primer control útil, salteando la X de cerrar', async () => {
    await render();
    expect((document.activeElement as HTMLElement).getAttribute('name')).toBe('monto');
  });

  it('respeta initialFocusSelector y, en formularios, enfoca el primer campo', async () => {
    await render({ initialFocusSelector: 'button[type="submit"]' });
    expect(document.activeElement?.textContent).toBe('Guardar');
    await render({}, false);
    await render({ as: 'form' });
    expect((document.activeElement as HTMLElement).getAttribute('name')).toBe('monto');
  });

  it('Tab y Shift+Tab quedan dentro del diálogo', async () => {
    await render();
    const controls = getFocusableControls(dialog());
    expect(controls.map((c) => c.textContent || c.getAttribute('name'))).toEqual(['×', 'monto', 'Cancelar', 'Guardar']);
    controls[controls.length - 1].focus();
    await key('Tab');
    expect(document.activeElement).toBe(controls[0]);
    await key('Tab', true);
    expect(document.activeElement).toBe(controls[controls.length - 1]);
  });

  it('Escape y el fondo cierran, salvo mientras está ocupado', async () => {
    const onClose = await render();
    await key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => (document.querySelector('[role="presentation"]') as HTMLElement).click());
    expect(onClose).toHaveBeenCalledTimes(2);
    await act(async () => dialog().click());
    expect(onClose).toHaveBeenCalledTimes(2);

    const busyClose = await render({ busy: true, onClose: vi.fn() });
    await key('Escape');
    await act(async () => (document.querySelector('[role="presentation"]') as HTMLElement).click());
    expect(busyClose).not.toHaveBeenCalled();
  });

  it('al cerrarse restaura el fondo y devuelve el foco al disparador', async () => {
    await render();
    expect(document.activeElement).not.toBe(trigger);
    await render({}, false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(content().hasAttribute('inert')).toBe(false);
    expect(content().hasAttribute('aria-hidden')).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });

  it('como formulario entrega el submit', async () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    await render({ as: 'form', onSubmit: onSubmit as never });
    await act(async () => { dialog().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
