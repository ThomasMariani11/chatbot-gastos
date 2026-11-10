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

## 3. Seguimiento del 10/11/2026 — minimatch en typescript-eslint

- **Aviso:** `npm audit` informó 7 avisos moderados con una sola causa: `minimatch` 10.2.6, dependencia de `@typescript-eslint/typescript-estree` (lint, solo desarrollo). Aviso [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (30/10/2026): denegación de servicio con patrones de archivos armados; vulnerable `>= 7.0.0, < 11.0.1`. `npm audit --omit=dev`: 0 vulnerabilidades.
- **Por qué un override:** la última versión de `typescript-eslint` (8.72.2) todavía pide `minimatch ^10.2.2` y `npm audit fix --force` proponía bajar a `typescript-eslint` 8.36.0 (cambio incompatible). Decisión del propietario: forzar `minimatch` 11 solo para ese paquete.
- **Cambio:** `overrides` en `package.json` → `@typescript-eslint/typescript-estree` usa `minimatch` **11.0.5** (fijo). El lockfile suma su dependencia `@isaacs/nonrecursive-glob-match` 1.1.0 y corrige la entrada raíz `vitest` que había quedado en `^4.1.11`. `eslint` sigue con su propio `minimatch` 3.1.5, fuera del rango del aviso.
- **Compatibilidad:** `typescript-estree` usa `minimatch` en un solo lugar (`minimatch(filePath, pattern, { dot: true })`); la exportación CommonJS y esa llamada funcionan igual en 11.0.5.
- **Verificación:** `npm audit` y `npm audit --omit=dev`: 0 vulnerabilidades. `npm run lint`, `npm run build`, `npm test` (69 archivos, 1.333 tests), `npm run test:sql` (12 escenarios) y `npm run test:release:guards` (14): aprobados en Windows.
- **Retirar el override** cuando `typescript-eslint` publique una versión que acepte `minimatch` ≥ 11.0.1.
