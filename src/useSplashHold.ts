import { useEffect, useState } from 'react';

/** Tiempo mínimo en pantalla, contado desde que se abrió la página. */
export const SPLASH_MIN_MS = 2000;
/** Lo que dura la salida (barra completa + desvanecido); coincide con el CSS de index.html. */
export const SPLASH_LEAVE_MS = 450;

export type SplashPhase = 'show' | 'leaving' | 'done';

/** Mantiene la pantalla de inicio el tiempo mínimo mientras la app carga por detrás. */
export function useSplashHold(now: () => number = () => performance.now()): SplashPhase {
  const [phase, setPhase] = useState<SplashPhase>('show');

  useEffect(() => {
    const remaining = Math.max(0, SPLASH_MIN_MS - now());
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    const showTimer = setTimeout(() => {
      setPhase('leaving');
      leaveTimer = setTimeout(() => setPhase('done'), SPLASH_LEAVE_MS);
    }, remaining);
    return () => {
      clearTimeout(showTimer);
      if (leaveTimer) clearTimeout(leaveTimer);
    };
    // Solo al abrir la app: `now` no debe reiniciar la cuenta.
  }, []);

  return phase;
}
