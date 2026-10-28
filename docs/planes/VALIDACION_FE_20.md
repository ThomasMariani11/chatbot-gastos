# Validación FE-20 — Cancelar temporizadores de navegación al desmontar

## Alcance implementado
- **Ref de temporizador (`timerRef`) en `src/useSwipeBack.ts`:**
  - Conserva el identificador del `setTimeout` de 140 ms (animación de salida antes de invocar `onBack`) en `timerRef`.
  - Limpia `timerRef` de forma determinística al:
    1. Desmontar el componente o limpiar el `useEffect`.
    2. Deshabilitar el hook (`enabled = false`), restableciendo además `dragOffset = 0` e `isSwiping = false`.
    3. Recibir `touchcancel` durante el gesto o durante los 140 ms de animación.
    4. Iniciar un nuevo toque válido o detectar multi-touch (`e.touches.length !== 1`), evitando acumulación de callbacks o estados colgados.
  - Mantiene los cuatro listeners (`touchstart`, `touchmove`, `touchend`, `touchcancel`) con `{ passive: true }` para no bloquear gestos nativos del navegador.

## Pruebas automatizadas
- `tests/use-swipe-back.test.ts` (6 pruebas en entorno `jsdom`):
  - Gesto legítimo desliza la vista y ejecuta `onBack` una única vez tras 140 ms.
  - Desmontaje antes de los 140 ms cancela el temporizador y no invoca `onBack`.
  - `touchcancel` durante la animación cancela el temporizador, restablece `dragOffset = 0` e `isSwiping = false` y no invoca `onBack`.
  - Cambio de `enabled` a `false` durante la animación cancela el temporizador, limpia el desplazamiento y no invoca `onBack`.
  - Múltiples gestos rápidos antes de que venza el temporizador no acumulan ejecuciones de `onBack`.
  - Multi-touch y zonas excluidas (`input`, `[data-no-swipe]`) no disparan navegación y los listeners se registran como `{ passive: true }` y se eliminan al desmontar.
