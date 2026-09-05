/**
 * Bloquea cualquier intento de zoom en la app tanto en móviles (iOS Safari, Android PWA)
 * como en computadoras (touchpad pinch, Ctrl+Wheel, Ctrl++, etc.) para garantizar
 * una experiencia fluida e idéntica a una aplicación nativa.
 */
export function initZoomLock(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const prevent = (event: Event) => {
    if (event.cancelable) {
      event.preventDefault();
    }
  };

  // 1. Bloquear gestos propietarios de zoom en iOS Safari (WebKit)
  document.addEventListener('gesturestart', prevent, { passive: false } as AddEventListenerOptions);
  document.addEventListener('gesturechange', prevent, { passive: false } as AddEventListenerOptions);
  document.addEventListener('gestureend', prevent, { passive: false } as AddEventListenerOptions);

  // 2. Bloquear gestos multitáctiles (pellizcar / pinch-to-zoom con 2 o más dedos)
  document.addEventListener(
    'touchstart',
    (event: TouchEvent) => {
      if (event.touches.length > 1) {
        prevent(event);
      }
    },
    { passive: false }
  );

  document.addEventListener(
    'touchmove',
    (event: TouchEvent) => {
      if (event.touches.length > 1) {
        prevent(event);
      }
    },
    { passive: false }
  );

  // 3. Prevenir doble toque accidental para hacer zoom en áreas no interactivas
  let lastTouchEndTime = 0;
  document.addEventListener(
    'touchend',
    (event: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEndTime <= 300) {
        const target = event.target as HTMLElement | null;
        const isInteractive =
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'SELECT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'BUTTON' ||
            Boolean(target.closest('button')) ||
            Boolean(target.closest('a')) ||
            Boolean(target.closest('.movement')));

        if (!isInteractive) {
          prevent(event);
        }
      }
      lastTouchEndTime = now;
    },
    { passive: false }
  );

  // 4. Bloquear zoom por rueda del ratón o pellizco en touchpad (Ctrl + Wheel)
  window.addEventListener(
    'wheel',
    (event: WheelEvent) => {
      if (event.ctrlKey) {
        prevent(event);
      }
    },
    { passive: false }
  );

  // 5. Bloquear atajos de teclado para zoom en navegador (Ctrl/Cmd + '+', '-', '=', '_')
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey) {
      if (['+', '-', '=', '_'].includes(event.key)) {
        prevent(event);
      }
    }
  });
}
