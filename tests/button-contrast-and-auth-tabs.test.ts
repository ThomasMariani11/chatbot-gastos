// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: { valid: true, duration_days: 30 }, error: null })),
  from: vi.fn(),
  signup: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
}));

vi.mock('../src/supabase', () => ({
  supabase: {
    rpc: api.rpc,
    from: api.from,
    auth: {
      signUp: api.signup,
      signInWithPassword: api.signInWithPassword,
      signInWithOtp: api.signInWithOtp,
    },
  },
}));

vi.mock('../src/PwaUpdates', () => ({
  useUpdateBlocker: vi.fn(),
}));

import { Login } from '../src/Login';

function parseHexChannel(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, '');
  const expanded =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexChannel(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function readCss(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

function extractRootVar(css: string, varName: string): string | null {
  const regex = new RegExp(`${varName}\\s*:\\s*(#[0-9a-fA-F]{3,6})`, 'g');
  let match: RegExpExecArray | null = null;
  let last: string | null = null;
  while ((match = regex.exec(css)) !== null) {
    last = match[1];
  }
  return last;
}

describe('FE-16 y FE-22: Contraste de botones y especificidad de pestañas de acceso', () => {
  let container: HTMLDivElement;
  let root: Root;
  let styleEl: HTMLStyleElement;

  const combinedCss = [
    'app/globals.css',
    'app/forms.css',
    'app/interactions.css',
    'app/movements.css',
    'src/styles.css',
    'src/ui.css',
  ]
    .map(readCss)
    .join('\n');

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    styleEl = document.createElement('style');
    styleEl.textContent = combinedCss;
    document.head.appendChild(styleEl);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    styleEl.remove();
    vi.clearAllMocks();
  });

  it('FE-16: todas las variantes activas de botones superan el umbral WCAG AA de 4.5:1 para texto normal', () => {
    const primaryBg = extractRootVar(combinedCss, '--button-primary-bg');
    const primaryInk = extractRootVar(combinedCss, '--button-primary-ink');
    const primaryHover = extractRootVar(combinedCss, '--button-primary-hover');
    const secondaryBg = extractRootVar(combinedCss, '--button-secondary-bg');
    const secondaryInk = extractRootVar(combinedCss, '--button-secondary-ink');
    const dangerBg = extractRootVar(combinedCss, '--button-danger-bg');
    const dangerInk = extractRootVar(combinedCss, '--button-danger-ink');
    const mintDark = extractRootVar(combinedCss, '--mint-dark');
    const muted = extractRootVar(combinedCss, '--muted');

    expect(primaryBg).toBe('#047857');
    expect(primaryInk).toBe('#ffffff');
    expect(primaryHover).toBe('#065f46');
    expect(mintDark).toBe('#047857');

    // Contraste primario normal y hover (reemplaza el antiguo #ffffff sobre #20b984 de 2.52:1)
    expect(contrastRatio(primaryInk!, primaryBg!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(primaryInk!, primaryHover!)).toBeGreaterThanOrEqual(4.5);

    // Contraste secundario y peligro
    expect(contrastRatio(secondaryInk!, secondaryBg!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dangerInk!, dangerBg!)).toBeGreaterThanOrEqual(4.5);

    // Pestañas de acceso (inactiva sobre #eef3f0 y activa sobre #ffffff)
    expect(contrastRatio(muted!, '#eef3f0')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(mintDark!, '#ffffff')).toBeGreaterThanOrEqual(4.5);

    // Botones de modales (Cancelar, Eliminar, Guardar y Admin Danger)
    expect(contrastRatio('#3b4e47', '#f2f5f3')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#a82e2b', '#fdf4f3')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#b91c1c', '#fee2e2')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#b91c1c', '#fff5f5')).toBeGreaterThanOrEqual(4.5);

    // Pastillas de moneda y modo de cuotas
    expect(contrastRatio('#475852', '#edf3ef')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#475569', '#f5f8f6')).toBeGreaterThanOrEqual(4.5);
  });

  it('FE-22: acota el selector de botones en auth-card a submit y da especificidad coherente a .auth-tabs .auth-tab sin !important', () => {
    const formsCss = readCss('app/forms.css');
    const stylesCss = readCss('src/styles.css');

    expect(formsCss).not.toContain('.auth-card button,');
    expect(formsCss).toContain('.auth-card form button[type="submit"],.primary-button');

    expect(stylesCss).toContain('.auth-tabs .auth-tab');
    expect(stylesCss).toContain('.auth-tabs .auth-tab.active');

    // Extraer el bloque de .auth-tabs .auth-tab y verificar que no dependa de !important
    const authTabBlock = stylesCss.slice(
      stylesCss.indexOf('.auth-tabs {'),
      stylesCss.indexOf('.invite-code-input {'),
    );
    expect(authTabBlock).not.toContain('!important');
  });

  it('FE-22: alterna correctamente la pestaña activa e inactiva al hacer clic y con el teclado sin afectar al botón de envío', async () => {
    await act(async () => {
      root.render(h(Login));
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('.auth-tabs .auth-tab[role="tab"]');
    expect(tabs).toHaveLength(2);
    const [loginTab, registerTab] = [tabs[0]!, tabs[1]!];

    // Estado inicial: Iniciar sesión activo, Crear cuenta inactivo
    expect(loginTab.getAttribute('aria-selected')).toBe('true');
    expect(loginTab.classList.contains('active')).toBe(true);
    expect(registerTab.getAttribute('aria-selected')).toBe('false');
    expect(registerTab.classList.contains('active')).toBe(false);

    // Al seleccionar Crear cuenta, Iniciar sesión pasa a inactivo y Crear cuenta a activo
    await act(async () => {
      registerTab.click();
    });

    expect(loginTab.getAttribute('aria-selected')).toBe('false');
    expect(loginTab.classList.contains('active')).toBe(false);
    expect(registerTab.getAttribute('aria-selected')).toBe('true');
    expect(registerTab.classList.contains('active')).toBe(true);

    const submitBtn = container.querySelector<HTMLButtonElement>('.auth-card form button[type="submit"]');
    expect(submitBtn).not.toBeNull();
    expect(submitBtn?.textContent).toContain('Crear cuenta y comenzar');

    // Navegación por teclado (ArrowLeft vuelve a Iniciar sesión y enfoca la pestaña)
    const tablist = container.querySelector<HTMLElement>('.auth-tabs[role="tablist"]')!;
    await act(async () => {
      tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });

    expect(loginTab.getAttribute('aria-selected')).toBe('true');
    expect(loginTab.classList.contains('active')).toBe(true);
    expect(registerTab.getAttribute('aria-selected')).toBe('false');
    expect(document.activeElement).toBe(loginTab);

    // ArrowRight cambia a Crear cuenta y enfoca la pestaña
    await act(async () => {
      tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });

    expect(registerTab.getAttribute('aria-selected')).toBe('true');
    expect(registerTab.classList.contains('active')).toBe(true);
    expect(loginTab.getAttribute('aria-selected')).toBe('false');
    expect(document.activeElement).toBe(registerTab);

    // Home vuelve a la primera pestaña (Iniciar sesión)
    await act(async () => {
      tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(loginTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(loginTab);

    // End va a la última pestaña (Crear cuenta)
    await act(async () => {
      tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(registerTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(registerTab);
  });
});
