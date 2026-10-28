# Validación y cierre de FE-10

Fecha: 28/10/2026.
Rama: `codex/fe-10-installment-limits-validation`.
Alcance: Alinear el límite de cuotas (2 a 60) y validar enteros entre dominio, alta, edición y controles (`FE-10`).

## Problemas resueltos

1. **Clamping silencioso y truncamiento decimal en campos personalizados (`customCountInput` y `customEditCountInput`):**
   - Anteriormente, al elegir cantidad personalizada en alta o edición, `onChange` aplicaba `parseInt(valStr, 10)` y `Math.min(60, parsed)`. Esto ocasionaba que:
     - Escribir `3.5` truncaba silenciosamente a `3`.
     - Escribir `61` o `120` y presionar Guardar (cuyo `onMouseDown={(e) => e.preventDefault()}` impedía disparar `onBlur`) enviaba silenciosamente `60` cuotas aunque en pantalla figurara `120`.
     - Escribir `1` o `0` mantenía el valor previo en memoria (ej. `3`) y enviaba una compra de 3 cuotas cuando el usuario había escrito `1`.
2. **Validación de límites y enteros en `planPatch` (`src/installmentPlans.ts`):**
   - `planPatch` no validaba que `edited.count` fuera un entero en `2..60` ni que `edited.number` fuera un entero en `1..edited.count` antes de construir el patch para `mutate_installment_plan`.
3. **Feedback accesible en el modal de edición:**
   - Los errores de validación o guardado en `saveMovementEdit` ahora se presentan de forma accesible mediante `<p role="alert">{editPlanError}</p>` dentro del modal de edición, en línea con los modales de alta y eliminación.

## Cambios realizados

1. **`src/installmentPlans.ts`:**
   - Constantes compartidas: `MIN_INSTALLMENT_COUNT = 2`, `MAX_INSTALLMENT_COUNT = 60`, `PRESET_INSTALLMENT_COUNTS`, `INSTALLMENT_BOUNDS_ERROR = 'Revisá la cantidad y referencia de cuotas (2 a 60).'`.
   - Funciones de validación compartidas: `isValidInstallmentCount`, `isValidInstallmentSchedule`, `parseInstallmentCountInput` (exige cadena de dígitos enteros exactos `/^\d+$/` dentro del rango `2..60`, rechazando decimales, negativos y vacíos).
   - Validación en `planPatch` y `parsePlanSnapshot` usando `isValidInstallmentSchedule`.
2. **`src/pwaEntries.ts`:**
   - `validateDraft` reutiliza `isValidInstallmentSchedule` e `INSTALLMENT_BOUNDS_ERROR` de `src/installmentPlans.ts`.
3. **`src/Dashboard.tsx`:**
   - Controles personalizados de alta y edición configurados con `min={MIN_INSTALLMENT_COUNT}`, `max={MAX_INSTALLMENT_COUNT}`, `step="1"`, `inputMode="numeric"`.
   - Validación explícita con `parseInstallmentCountInput` e `isValidInstallmentSchedule` en `addMovement` y `saveMovementEdit` antes de invocar la API, mostrando mensaje claro en `role="alert"`.
4. **Pruebas automatizadas:**
   - `tests/installment-plan-editor.test.ts`: 10 pruebas unitarias cubriendo extremos (`2` y `60`), fuera de rango (`0`, `1`, `-3`, `61`, `120`), decimales (`2.5`, `'3.5'`, `'3,5'`) y números de referencia inválidos.
   - `tests/installments-dashboard-ui.test.ts`: 7 pruebas de integración UI verificando en los formularios reales de alta y edición el rechazo de `1`, `0`, `61`, `120`, decimales y vacíos sin llamar a la API, y la aceptación de `60` cuotas.

## Evidencia de validación técnica

- **Vitest:** 48 suites pasadas, 1.078 pruebas pasadas (0 fallos).
- **Pruebas SQL de integración:** 12 escenarios aprobados (`npm run test:sql`).
- **Guardas de release:** 6 pruebas aprobadas (`npm run test:release:guards`).
- **Linting y compilación:** `npm run lint` y `npm run build` sin errores.
