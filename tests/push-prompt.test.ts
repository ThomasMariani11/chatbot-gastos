// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PushPrompt } from '../src/PushPrompt';
import type { PushState } from '../src/pushNotifications';
import {
  declinePushPrompt,
  PUSH_PROMPT_SNOOZE_MS,
  pushPromptVariant,
  readPushPromptMemory,
} from '../src/pushPromptRules';

vi.mock('../src/supabase', () => ({ supabase: {} }));

const NOW = Date.parse('2026-11-10T15:00:00-03:00');
const OLD = '2026-09-01T12:00:00Z';
const NEW = '2026-11-08T12:00:00Z';
const none = { declines: 0, until: 0 };
const base = { memory: none, accountCreatedAt: NEW, onboardingPending: false, now: NOW };

describe('FE-26 · cuándo aparece la invitación', () => {
  it('solo con notificaciones apagadas o iPhone sin instalar', () => {
    expect(pushPromptVariant({ ...base, state: 'off' })).toBe('new');
    expect(pushPromptVariant({ ...base, state: 'needs-install' })).toBe('install');
    for (const state of ['on', 'denied', 'unsupported', null] as const) {
      expect(pushPromptVariant({ ...base, state })).toBeNull();
    }
  });

  it('a cuentas anteriores al lanzamiento se presenta como novedad', () => {
    expect(pushPromptVariant({ ...base, state: 'off', accountCreatedAt: OLD })).toBe('announcement');
    expect(pushPromptVariant({ ...base, state: 'off', accountCreatedAt: null })).toBe('new');
  });

  it('cede el lugar a la bienvenida de WhatsApp', () => {
    expect(pushPromptVariant({ ...base, state: 'off', onboardingPending: true })).toBeNull();
  });

  it('"Ahora no" la pospone 7 días y al tercer rechazo no vuelve', () => {
    expect(pushPromptVariant({ ...base, state: 'off', memory: { declines: 1, until: NOW + 1 } })).toBeNull();
    expect(pushPromptVariant({ ...base, state: 'off', memory: { declines: 2, until: NOW - 1 } })).toBe('new');
    expect(pushPromptVariant({ ...base, state: 'off', memory: { declines: 3, until: 0 } })).toBeNull();
  });
});

describe('FE-26 · memoria por cuenta y dispositivo', () => {
  beforeEach(() => window.localStorage.clear());
  it('acumula rechazos por cuenta y tolera datos corruptos', () => {
    expect(declinePushPrompt('u1', NOW)).toEqual({ declines: 1, until: NOW + PUSH_PROMPT_SNOOZE_MS });
    expect(declinePushPrompt('u1', NOW + 1)).toMatchObject({ declines: 2 });
    expect(readPushPromptMemory('u2')).toEqual(none);
    window.localStorage.setItem('pesito:push-invitacion:u3', '{roto');
    expect(readPushPromptMemory('u3')).toEqual(none);
  });
});

describe('FE-26 · tarjeta en el resumen', () => {
  let root: Root;
  let node: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    window.localStorage.clear();
    node = document.createElement('div');
    document.body.append(node);
    root = createRoot(node);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  });

  async function render(state: PushState, props: Record<string, unknown> = {}) {
    const enable = vi.fn(async () => 'on' as PushState);
    const getState = async () => state;
    await act(async () => {
      root.render(h(PushPrompt, { userId: 'u1', accountCreatedAt: OLD, onboardingPending: false, getState, enable, now: () => NOW, ...props }));
    });
    return enable;
  }
  const button = (label: string) => [...node.querySelectorAll('button')].find((b) => b.textContent === label);

  it('"Activar" pide el permiso con el toque y confirma', async () => {
    const enable = await render('off');
    expect(node.textContent).toContain('Nuevo: ahora Pesito te avisa en el celular');
    await act(async () => button('Activar')!.click());
    expect(enable).toHaveBeenCalledTimes(1);
    expect(node.textContent).toContain('Listo, te vamos a avisar en este celular.');
    await act(async () => button('Cerrar')!.click());
    expect(node.querySelector('.client-notice')).toBeNull();
  });

  it('no pide permiso sola al mostrarse', async () => {
    const enable = await render('off');
    expect(enable).not.toHaveBeenCalled();
  });

  it('"Ahora no" la oculta y queda recordado', async () => {
    await render('off');
    await act(async () => button('Ahora no')!.click());
    expect(node.querySelector('.client-notice')).toBeNull();
    expect(readPushPromptMemory('u1').declines).toBe(1);
  });

  it('en iPhone sin instalar explica cómo instalar, sin botón Activar', async () => {
    await render('needs-install');
    expect(node.textContent).toContain('Agregar a inicio');
    expect(button('Activar')).toBeUndefined();
  });

  it('si el permiso queda bloqueado lo explica sin detalles técnicos', async () => {
    const enable = vi.fn(async () => { throw new Error('PRIVATE_DETAIL'); });
    await render('off', { enable });
    await act(async () => button('Activar')!.click());
    expect(node.textContent).toContain('Ajustes → Avisos');
    expect(node.textContent).not.toContain('PRIVATE_DETAIL');
  });

  it('no aparece con notificaciones ya activas', async () => {
    await render('on');
    expect(node.querySelector('.client-notice')).toBeNull();
  });
});
