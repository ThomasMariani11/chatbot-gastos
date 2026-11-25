// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Splash } from '../src/Splash';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const classesOf = (root: Element) =>
  [...root.querySelectorAll('[class]')].map((el) => el.getAttribute('class')).sort();

describe('Splash', () => {
  let root: Root, container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('anuncia la carga a lectores de pantalla', async () => {
    await act(async () => root.render(h(Splash)));
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Abriendo Pesito…');
  });

  it('continúa la barra desde donde iba la de index.html', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(1500.4);
    await act(async () => root.render(h(Splash)));
    const bar = container.querySelector<HTMLElement>('.pesito-splash__bar');
    expect(bar?.style.animationDelay).toBe('-1500ms');
  });

  it('usa el mismo marcado que index.html', async () => {
    await act(async () => root.render(h(Splash)));
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(classesOf(container)).toEqual(classesOf(parsed.querySelector('#root')!));
  });
});
