# Validación y publicación de FE-17

Fecha: 28/10/2026.
Rama: `codex/fe-17-screen-code-splitting`.
Alcance: Separar la descarga inicial por pantallas y code splitting resiliente (`FE-17`).

## Resumen del trabajo realizado

1. **Separación de la descarga inicial por pantallas (`React.lazy`):**
   - Se desacoplaron las pantallas secundarias (`Dashboard`, `Settings`, `AdminPanel`, `Paywall`, `Login`) de la descarga inicial del bundle principal.
   - La librería pesada de gráficos (`recharts`) y la lógica completa de dashboards, formularios de movimientos y paneles administrativos ya no se descargan en el ingreso ni bloquean el primer render.
   - La pantalla de administración (`AdminPanel`, ~52 kB) solo se descarga si un usuario con rol de administrador navega a `#admin`.
   - La pantalla de ajustes (`Settings`, ~13.5 kB) solo se descarga bajo demanda al abrir la vista de ajustes.
   - La pantalla de paywall (`Paywall`, ~5 kB) solo se descarga en caso de que la suscripción esté vencida o suspendida.

2. **Carga perezosa resiliente y recuperación ante despliegues (`lazyWithRetry`):**
   - Se implementó `lazyWithRetry` en `src/lazyWithRetry.tsx` para manejar de manera robusta los desajustes de versiones tras despliegues en GitHub Pages:
     - **Detección multinavergador de fallos de chunk (`isChunkLoadError`):** reconoce mensajes característicos de módulos rotos o 404 en Chromium (`Failed to fetch dynamically imported module`), Safari/WebKit (`Importing a module script failed`), Firefox (`error loading dynamically imported module`) y Webpack/Rollup (`Loading chunk failed`).
     - **Tolerancia a microcortes de red:** reintento inmediato configurable antes de declarar error.
     - **Recarga protegida ante despliegues:** si un chunk falla por invalidación de hash de una nueva versión, recarga la aplicación automáticamente para sincronizar el HTML con los nuevos hashes de producción.
     - **Prevención de bucles infinitos:** utiliza una clave en `sessionStorage` (`pesito_chunk_retry_${chunkKey}`) para recargar a lo sumo una vez por pantalla en la sesión activa. Si persiste la falla (ej. sin conexión a internet), delega el error al boundary de pantalla sin provocar bucles de recarga.
     - **Limpieza de estado:** al cargar exitosamente el chunk, limpia la marca de recarga para tolerar futuros despliegues posteriores.

3. **Límites de error accesibles e indicadores de carga:**
   - **`ScreenErrorBoundary`:** captura fallos de descarga o excepciones de pantalla y presenta una tarjeta accesible (`role="alert"`) con título, explicación clara y botón de "Reintentar" sin dejar la pantalla en blanco.
   - **`ScreenFallback`:** componente con `role="status"` y estilo de la aplicación (`.loading-copy`) para anunciar el estado de carga mientras se descargan los chunks.

---

## Métricas de rendimiento: Antes vs. Después

| Métrica | Antes de FE-17 | Después de FE-17 | Variación |
| :--- | :--- | :--- | :--- |
| **JS Principal (`index-*.js`)** | 873.75 kB | **424.47 kB** | **-51.4% (-449.28 kB)** |
| **Gzip Principal (`index-*.js.gz`)** | 250.61 kB | **122.46 kB** | **-51.1% (-128.15 kB)** |
| **Alerta Vite (> 500 kB)** | `(!) Some chunks are larger than 500 kB` | **Ninguna alerta (0 chunks > 500 kB)** | **Eliminada** |
| **Chunk Dashboard (+ recharts)** | Incluido en index | 365.32 kB (106.35 kB gz) | Cargado bajo demanda |
| **Chunk AdminPanel** | Incluido en index | 52.18 kB (14.75 kB gz) | Cargado bajo demanda (solo admin) |
| **Chunk Settings** | Incluido en index | 13.46 kB (4.50 kB gz) | Cargado bajo demanda |
| **Chunk Login** | Incluido en index | 11.89 kB (3.98 kB gz) | Cargado solo si no hay sesión |
| **Chunk Paywall** | Incluido en index | 5.00 kB (2.30 kB gz) | Cargado solo si está vencido |

---

## Cobertura de pruebas y verificación técnica

1. **Pruebas unitarias y de integración (`tests/lazy-loading.test.ts`):**
   - 12 pruebas completas cubriendo:
     - Detección de errores de chunks para Chromium, Safari, Firefox y Rollup.
     - Discriminación correcta de errores ajenos a módulos (errores de red comunes, TypeError, null).
     - Accesibilidad y personalización de etiquetas en `ScreenFallback`.
     - Manejo de excepciones y reintento en `ScreenErrorBoundary`.
     - Carga exitosa directa y limpieza de `sessionStorage`.
     - Recuperación ante microcortes transitorios en el reintento sin recargar.
     - Disparo de recarga protegida ante despliegues nuevos (chunk 404).
     - Supresión de recarga infinita si ya se intentó en la sesión y activación de la pantalla accesible.
     - Integración con el componente raíz `App` para carga de Login sin sesión.
2. **Suite completa de Vitest:**
   - 48 archivos de prueba pasados (48/48).
   - 1.073 pruebas pasadas (1.073/1.073).
3. **Pruebas de base de datos e integración:**
   - `npm run test:sql`: 12 escenarios aprobados.
4. **Guardas de release:**
   - `npm run test:release:guards`: 6 pruebas aprobadas.
5. **Calidad de código y tipado:**
   - `npm run lint`: 0 errores, 0 warnings.
   - `npm run build`: compilación limpia y chunks optimizados.
