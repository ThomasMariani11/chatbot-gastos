// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSwipeBack } from '../src/useSwipeBack';

type TouchPoint = { clientX: number; clientY: number };

function dispatchTouchEvent(
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  options: {
    touches?: TouchPoint[];
    changedTouches?: TouchPoint[];
    target?: EventTarget;
  } = {},
) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperty(event, 'touches', {
    value: options.touches ?? [],
    configurable: true,
  });
  Object.defineProperty(event, 'changedTouches', {
    value: options.changedTouches ?? options.touches ?? [],
    configurable: true,
  });
  const target = options.target ?? document.body;
  target.dispatchEvent(event);
}

interface FixtureProps {
  onBack: () => void;
  enabled?: boolean;
  threshold?: number;
  edgeThreshold?: number;
  trackDrag?: boolean;
}

function SwipeBackFixture(props: FixtureProps) {
  const { dragOffset, isSwiping } = useSwipeBack(props);
  return h(
    'div',
    {
      'data-testid': 'swipe-surface',
      'data-drag-offset': String(dragOffset),
      'data-is-swiping': String(isSwiping),
    },
    h('input', { 'data-testid': 'text-input', type: 'text' }),
    h('div', { 'data-testid': 'no-swipe-zone', 'data-no-swipe': 'true' }),
  );
}

describe('useSwipeBack (FE-20)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, 'innerWidth', {
      value: 390,
      configurable: true,
      writable: true,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function getSurface() {
    const el = container.querySelector('[data-testid="swipe-surface"]');
    if (!el) throw new Error('Surface not found');
    return el;
  }

  it('ejecuta onBack una sola vez tras completar la animación de un swipe legítimo', async () => {
    const onBack = vi.fn();

    await act(async () => {
      root.render(h(SwipeBackFixture, { onBack }));
    });

    await act(async () => {
      dispatchTouchEvent('touchstart', { touches: [{ clientX: 24, clientY: 200 }] });
      dispatchTouchEvent('touchmove', { touches: [{ clientX: 60, clientY: 202 }] });
    });

    expect(getSurface().getAttribute('data-is-swiping')).toBe('true');
    expect(getSurface().getAttribute('data-drag-offset')).toBe('36');

    await act(async () => {
      dispatchTouchEvent('touchmove', { touches: [{ clientX: 110, clientY: 204 }] });
    });
    expect(getSurface().getAttribute('data-drag-offset')).toBe('86');

    await act(async () => {
      dispatchTouchEvent('touchend', { changedTouches: [{ clientX: 110, clientY: 204 }] });
    });

    // Durante los 140ms de salida se desliza al ancho de la pantalla y aún no invoca onBack
    expect(getSurface().getAttribute('data-drag-offset')).toBe('390');
    expect(getSurface().getAttribute('data-is-swiping')).toBe('false');
    expect(onBack).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(140);
    });

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(getSurface().getAttribute('data-drag-offset')).toBe('0');
    expect(getSurface().getAttribute('data-is-swiping')).toBe('false');
  });

  it('cancela el temporizador al desmontar durante la animación y no invoca onBack', async () => {
    const onBack = vi.fn();

    await act(async () => {
      root.render(h(SwipeBackFixture, { onBack }));
    });

    await act(async () => {
      dispatchTouchEvent('touchstart', { touches: [{ clientX: 20, clientY: 180 }] });
      dispatchTouchEvent('touchmove', { touches: [{ clientX: 100, clientY: 182 }] });
      dispatchTouchEvent('touchend', { changedTouches: [{ clientX: 100, clientY: 182 }] });
    });

    expect(getSurface().getAttribute('data-drag-offset')).toBe('390');
    expect(onBack).not.toHaveBeenCalled();

    // Desmontaje antes de que se cumplan los 140ms
    await act(async () => {
      root.unmount();
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(onBack).not.toHaveBeenCalled();
  });

  it('cancela el temporizador y restablece el estado si recibe touchcancel durante la animación', async () => {
    const onBack = vi.fn();

    await act(async () => {
      root.render(h(SwipeBackFixture, { onBack }));
    });

    await act(async () => {
      dispatchTouchEvent('touchstart', { touches: [{ clientX: 18, clientY: 160 }] });
      dispatchTouchEvent('touchmove', { touches: [{ clientX: 95, clientY: 162 }] });
      dispatchTouchEvent('touchend', { changedTouches: [{ clientX: 95, clientY: 162 }] });
    });

    expect(getSurface().getAttribute('data-drag-offset')).toBe('390');

    await act(async () => {
      dispatchTouchEvent('touchcancel');
    });

    expect(getSurface().getAttribute('data-drag-offset')).toBe('0');
    expect(getSurface().getAttribute('data-is-swiping')).toBe('false');

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(onBack).not.toHaveBeenCalled();
  });

  it('cancela el temporizador y limpia la animación si el hook se deshabilita antes de los 140ms', async () => {
    const onBack = vi.fn();

    await act(async () => {
      root.render(h(SwipeBackFixture, { onBack, enabled: true }));
    });

    await act(async () => {
      dispatchTouchEvent('touchstart', { touches: [{ clientX: 25, clientY: 140 }] });
      dispatchTouchEvent('touchmove', { touches: [{ clientX: 110, clientY: 142 }] });
      dispatchTouchEvent('touchend', { changedTouches: [{ clientX: 110, clientY: 142 }] });
    });

    expect(getSurface().getAttribute('data-drag-offset')).toBe('390');

    // Se abre un modal y deshabilita el hook antes de que venza el timeout
    await act(async () => {
      root.render(h(SwipeBackFixture, { onBack, enabled: false }));
    });

    expect(getSurface().getAttribute('data-drag-offset')).toBe('0');
    expect(getSurface().getAttribute('data-is-swiping')).toBe('false');

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(onBack).not.toHaveBeenCalled();
  });

  it('no acumula callbacks cuando se realizan múltiples gestos rápidos antes de que venza el temporizador', async () => {
    const onBack = vi.fn();

    await act(async () => {
      root.render(h(SwipeBackFixture, { onBack }));
    });

    // Primer swipe completo
    await act(async () => {
      dispatchTouchEvent('touchstart', { touches: [{ clientX: 20, clientY: 150 }] });
      dispatchTouchEvent('touchmove', { touches: [{ clientX: 100, clientY: 152 }] });
      dispatchTouchEvent('touchend', { changedTouches: [{ clientX: 100, clientY: 152 }] });
    });

    await act(async () => {
      vi.advanceTimersByTime(70);
    });

    // Segundo swipe antes de los 140ms del primero
    await act(async () => {
      dispatchTouchEvent('touchstart', { touches: [{ clientX: 20, clientY: 150 }] });
      dispatchTouchEvent('touchmove', { touches: [{ clientX: 105, clientY: 152 }] });
      dispatchTouchEvent('touchend', { changedTouches: [{ clientX: 105, clientY: 152 }] });
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('cancela el gesto y el temporizador si entra un segundo dedo (multi-touch) y registra listeners pasivos', async () => {
    const addListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener');
    const onBack = vi.fn();

    await act(async () => {
      root.render(h(SwipeBackFixture, { onBack }));
    });

    const touchListeners = addListenerSpy.mock.calls.filter(([eventName]) =>
      ['touchstart', 'touchmove', 'touchend', 'touchcancel'].includes(String(eventName)),
    );
    expect(touchListeners).toHaveLength(4);
    for (const [, , options] of touchListeners) {
      expect(options).toEqual({ passive: true });
    }

    // Inicia swipe con un dedo y luego apoya un segundo dedo
    await act(async () => {
      dispatchTouchEvent('touchstart', { touches: [{ clientX: 20, clientY: 150 }] });
      dispatchTouchEvent('touchmove', { touches: [{ clientX: 80, clientY: 152 }] });
    });
    expect(getSurface().getAttribute('data-drag-offset')).toBe('60');

    await act(async () => {
      dispatchTouchEvent('touchmove', {
        touches: [
          { clientX: 80, clientY: 152 },
          { clientX: 200, clientY: 200 },
        ],
      });
    });

    expect(getSurface().getAttribute('data-drag-offset')).toBe('0');
    expect(getSurface().getAttribute('data-is-swiping')).toBe('false');

    // Ignora toques iniciados en inputs o zonas data-no-swipe
    const input = container.querySelector('[data-testid="text-input"]')!;
    await act(async () => {
      dispatchTouchEvent('touchstart', { touches: [{ clientX: 20, clientY: 150 }], target: input });
      dispatchTouchEvent('touchmove', { touches: [{ clientX: 110, clientY: 150 }], target: input });
      dispatchTouchEvent('touchend', { changedTouches: [{ clientX: 110, clientY: 150 }], target: input });
      vi.advanceTimersByTime(200);
    });
    expect(onBack).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });

    const removedEvents = removeListenerSpy.mock.calls.map(([eventName]) => String(eventName));
    expect(removedEvents).toEqual(
      expect.arrayContaining(['touchstart', 'touchmove', 'touchend', 'touchcancel']),
    );
  });
});
