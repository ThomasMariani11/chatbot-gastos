# INF-07 — Dependencias vulnerables de desarrollo

Fecha: 16/10/2026. Estado: en curso; audit corregido, validación funcional pendiente.

## Cambio y criterio de selección

El audit inicial reporta tres paquetes con severidad alta: Vite, brace-expansion y source-map-js. Son dependencias de desarrollo; npm audit --omit=dev no reporta alertas tras el cambio. No se modifican dependencias declaradas de producción, lógica de aplicación, migraciones, modelos IA ni webhook.

| Paquete | Antes | Después | Resolución |
| --- | --- | --- | --- |
| Vite | 8.0.13 | 8.0.16 | Parche mínimo de la línea 8.0 que corrige los avisos Windows |
| brace-expansion vía minimatch 3 | 1.1.18 | 1.1.21 | Dentro del rango transitivo ya declarado |
| brace-expansion vía minimatch 10 | 5.0.9 | 5.0.12 | Dentro del rango transitivo ya declarado |
| source-map-js vía PostCSS | 1.2.1 | 1.2.2 | Parche compatible |

No se usa npm audit fix --force, overrides ni saltos de versión mayor. La selección de Vite se contrastó con el advisory oficial, que fija 8.0.16 como versión corregida. La instalación y los tests existentes verificarán compatibilidad con plugin-react y Vitest.

Vite también cambia Rolldown 1.0.1 → 1.0.3, sus bindings opcionales por plataforma y utilidades WASM del bundler. El diff completo de versiones está registrado en la evidencia; la deduplicación mueve @emnapi/runtime desde la copia raíz 1.11.3 a la copia compatible 1.10.0 ya presente en el grafo anterior. No se afirma que el lockfile cambie solo cuatro nodos. Las versiones de paquetes productivos permanecen iguales.

## Comandos

Desde una rama y con main sincronizada:

~~~powershell
npm install --package-lock-only --save-dev --save-exact vite@8.0.16 --ignore-scripts --no-audit --no-fund
npm update brace-expansion source-map-js --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci --no-audit --no-fund
npm audit
npm audit --omit=dev
npm run lint
npm test
npm run test:sql
npm run build
~~~

CI agrega npm audit --audit-level=high después de npm ci. Alertas altas/críticas o errores del servicio de audit hacen fallar Frontend; no hay continue-on-error ni omisión de la protección. Las alertas de menor severidad se informan sin impedir por sí solas el job. El audit completo local exige cero alertas para este cierre.

## Validación

- Audit tras npm ci: cero alertas en el grafo completo y en producción.
- actionlint: sin errores en el workflow modificado.
- Pendiente: checkout limpio con lint, tests y build; desarrollo en Windows con arranque, transformación y rechazo de un archivo sintético bajo fs.deny; tres checks del PR y publicación de main.

La prueba Windows utilizará únicamente un archivo sintético y un servidor en loopback. No se leerán archivos .env reales ni se harán intentos de conexión UNC/SMB. No se ejecutan ataques de agotamiento de recursos ni pruebas contra producción.

## Límites y recuperación

npm audit usa avisos conocidos del registro y solo cubre el grafo npm del lockfile. No equivale a una auditoría integral de seguridad ni cubre automáticamente el lock Deno independiente. Permanece el aviso de mantenimiento de ESLint 9 sin soporte; no es una vulnerabilidad reportada por este audit. El tamaño del bundle se evalúa con el build; su optimización pertenece al plan frontend.

Ante una regresión, preparar un PR con una versión corregida compatible y pasar los mismos checks. No volver a versiones vulnerables para publicar ni desactivar audit. Cualquier alerta residual requiere documentar paquete, alcance y mitigación antes del cierre.

## Evidencia y fuentes

- [Evidencia y diff de versiones](evidencias/INF_07_2026-10-16.json).
- [Vite: bypass de fs.deny en Windows](https://github.com/advisories/GHSA-fx2h-pf6j-xcff).
- [Vite / launch-editor: rutas UNC](https://github.com/advisories/GHSA-v6wh-96g9-6wx3).
- [brace-expansion: expansión cuadrática](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr).
- [source-map-js: denegación de servicio](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
