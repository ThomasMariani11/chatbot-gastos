// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPLASH_LEAVE_MS, SPLASH_MIN_MS, useSplashHold, type SplashPhase } from '../src/useSplashHold';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let phase: SplashPhase | undefined;
function Probe({ now }: { now: () => number }) {
  phase = useSplashHold(now);
  return null;
}

describe('useSplashHold: tiempo mínimo de la pantalla de inicio', () => {
  let root: Root, container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
  });

  it('dura 2 segundos y se desvanece en menos de medio segundo', () => {
    expect(SPLASH_MIN_MS).toBe(2000);
    expect(SPLASH_LEAVE_MS).toBeLessThanOrEqual(500);
  });

  it('cuenta desde que se abrió la página, no desde que montó React', async () => {
    await act(async () => root.render(h(Probe, { now: () => 1500 })));
    expect(phase).toBe('show');
    await act(async () => vi.advanceTimersByTime(499));
    expect(phase).toBe('show');
    await act(async () => vi.advanceTimersByTime(1));
    expect(phase).toBe('leaving');
    await act(async () => vi.advanceTimersByTime(SPLASH_LEAVE_MS));
    expect(phase).toBe('done');
  });

  it('si la carga ya tardó más del mínimo, solo se desvanece', async () => {
    await act(async () => root.render(h(Probe, { now: () => 5000 })));
    await act(async () => vi.advanceTimersByTime(0));
    expect(phase).toBe('leaving');
    await act(async () => vi.advanceTimersByTime(SPLASH_LEAVE_MS));
    expect(phase).toBe('done');
  });
});
