import { useEffect, useRef, useState } from 'react';

interface UseSwipeBackOptions {
  onBack: () => void;
  enabled?: boolean;
  threshold?: number;
  edgeThreshold?: number;
  trackDrag?: boolean;
}

/**
 * Hook para detectar gestos de deslizamiento táctil (swipe back) hacia la derecha
 * en dispositivos móviles (iOS Safari, Android Chrome y PWAs).
 *
 * Permite al usuario volver a la pantalla anterior deslizando cómodamente con el pulgar
 * desde el tercio izquierdo de la pantalla.
 */
export function useSwipeBack({
  onBack,
  enabled = true,
  threshold = 60,
  edgeThreshold,
  trackDrag = true,
}: UseSwipeBackOptions) {
  const [dragOffset, setDragOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let isHorizontal = false;
    let startTime = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [data-no-swipe]')) return;

      const touch = e.touches[0];
      // Permite iniciar el gesto desde el borde o tercio izquierdo (hasta 130px o 35% de la pantalla)
      const maxStart = edgeThreshold ?? Math.max(120, window.innerWidth * 0.35);

      if (touch.clientX <= maxStart) {
        startX = touch.clientX;
        startY = touch.clientY;
        tracking = true;
        isHorizontal = false;
        startTime = Date.now();
      } else {
        tracking = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!tracking || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;

      // Si el movimiento inicial es hacia la izquierda, no es un gesto para volver
      if (!isHorizontal && deltaX < 0) {
        tracking = false;
        return;
      }

      // Si el movimiento es predominantemente vertical (haciendo scroll), cancelar tracking
      if (!isHorizontal) {
        if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 8) {
          tracking = false;
          if (trackDrag) setDragOffset(0);
          setIsSwiping(false);
          return;
        }

        // Si se movió al menos 10px a la derecha y con ángulo más horizontal que vertical
        if (deltaX > 10 && deltaX > Math.abs(deltaY) * 1.2) {
          isHorizontal = true;
          setIsSwiping(true);
        }
      }

      if (isHorizontal) {
        // Limitar desplazamiento entre 0 y el ancho de pantalla
        const boundedDeltaX = Math.max(0, Math.min(window.innerWidth, deltaX));
        if (trackDrag) {
          setDragOffset(boundedDeltaX);
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!tracking || !isHorizontal) {
        tracking = false;
        isHorizontal = false;
        if (trackDrag) setDragOffset(0);
        setIsSwiping(false);
        return;
      }

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      const duration = Date.now() - startTime;

      // Activación: supera el umbral (60px) o fue un flick rápido (>35px en menos de 250ms)
      const isQuickFlick = deltaX > 35 && duration < 250 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4;
      const isLongSwipe = deltaX >= threshold && Math.abs(deltaX) > Math.abs(deltaY) * 1.2;

      if (isQuickFlick || isLongSwipe) {
        if (trackDrag) {
          // Deslizar suavemente fuera de la pantalla antes de ejecutar onBack
          setDragOffset(window.innerWidth);
          setTimeout(() => {
            setDragOffset(0);
            setIsSwiping(false);
            onBackRef.current();
          }, 140);
        } else {
          onBackRef.current();
        }
      } else {
        // Rebotar suavemente a la posición original
        if (trackDrag) setDragOffset(0);
        setIsSwiping(false);
      }

      tracking = false;
      isHorizontal = false;
    };

    const handleTouchCancel = () => {
      tracking = false;
      isHorizontal = false;
      if (trackDrag) setDragOffset(0);
      setIsSwiping(false);
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [enabled, threshold, edgeThreshold, trackDrag]);

  return { dragOffset, isSwiping };
}
