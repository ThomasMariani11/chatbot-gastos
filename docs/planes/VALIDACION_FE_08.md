# Validación FE-08 — Actualizar dependencias vulnerables del frontend

## 1. Alcance y estado de vulnerabilidades
- **Actualización realizada (`package.json`, `package-lock.json`):**
  - Los paquetes señalados originalmente en la auditoría (`vite` 8.0.13, `brace-expansion` y `source-map-js` 1.2.1) ya habían sido actualizados en `INF-07` (`vite` `8.1.6`).
  - Se ejecutó `npm audit` sobre el árbol completo actual, detectando dos avisos moderados en `vitest` / `@vitest/mocker` (`<= 4.1.11`: `GHSA-qxg6-89mg-rqv8` y `GHSA-xp26-3454-mjgp`).
  - Se actualizó `vitest` y `@vitest/mocker` a `4.1.12` en `package.json` y `package-lock.json`.

## 2. Verificación ejecutada
- `npm audit`: **0 vulnerabilidades** (248 paquetes auditados).
- `npm audit --omit=dev`: **0 vulnerabilidades**.
- `npm run lint`: aprobado sin errores.
- `npm run build`: aprobado (`tsc --noEmit && vite build`).
- `npm test`: **50 archivos de prueba, 1.087 tests aprobados** sobre Vitest `4.1.12` en Windows.
- `npm run test:sql` y `npm run test:release:guards`: aprobados.
