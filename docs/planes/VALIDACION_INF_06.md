# INF-06 — Validaciones y protección de main

Fecha: 16/10/2026. Estado: controles y protección verificados. El PR final se integra únicamente con sus tres checks aprobados; observar la publicación de main antes de comunicar finalización. Este documento registra la validación previa a esa integración, sin atribuir éxito a una ejecución futura.

## Alcance

- Frontend: npm ci con package-lock, ESLint, 173 tests Vitest (incluyen migraciones PGlite), 12 escenarios de renovaciones SQL y TypeScript/build.
- Webhook: Deno 2.9.6, lockfile congelado, tipos, lint y 12 tests del código real sin red; entorno limitado a nombres requeridos por las fixtures. No se despliega la Edge Function.
- PostgreSQL: dos sesiones nativas sobre una base efímera PostgreSQL 17.11, imagen oficial fijada por digest, solo loopback, healthcheck y límites; cubre leases, fencing, deduplicación y reintentos tardíos. Sin credenciales de producción.
- Pages: mismo artefacto validado por Frontend; job de publicación depende de Frontend, Webhook y PostgreSQL y solo se ejecuta desde main. Pull requests no publican.
- Acciones por SHA oficial, checkout sin persistencia de credenciales, permisos globales de lectura y escritura pages/id-token únicamente en deploy; timeouts de diez minutos. El job Frontend solo agrega pages:read para consultar su configuración al publicar.

No se cambian lógica de negocio, modelos IA, migraciones ni secretos. La contraseña visible en el servicio PostgreSQL es sintética y exclusiva de su contenedor efímero. La política existente de protección estaba desactivada (GET 404 Branch not protected).

## Reproducibilidad

Node 22.20.0 fijado en .node-version. Deno usa su grafo independiente con nodeModulesDir none; no toma dependencias de una instalación npm manual. La única regla de lint excluida es no-import-prefix: los imports npm inline existentes tienen versión exacta y ahora integridad verificada por deno.ci.lock; se conserva la resolución usada por Supabase y no se reescribe el runtime para satisfacer una preferencia de estilo. El resto del lint y los tipos se exige sin omitir errores.

La prueba renewals.integration.mjs importa PGlite desde la dependencia ya fijada en package-lock; no requiere node_modules/.renewal-validation. Los comandos están en README y package.json.

La configuración y el lock de pruebas se llaman deno.ci.json y deno.ci.lock y se seleccionan explícitamente con --config. No se agrega un deno.json/deno.lock autodetectado por el despliegue de Supabase: CI no modifica la configuración del runtime productivo ni su grafo de imports. La compatibilidad de publicación del webhook conserva su procedimiento separado.

## Protección aplicada

Requerir pull request con los tres checks reales y rama actualizada; aplicar también a administradores. Cero aprobaciones humanas obligatorias para permitir al propietario trabajar solo. Bloquear force push y eliminación de main; resolver conversaciones y mantener historia lineal mediante squash o rebase. Aplicada y comprobada con GET posterior de la API. Los checks están vinculados a GitHub Actions (app ID 15368).

## Resultados de validación

1. Copia limpia mediante clone local sin hardlinks ni archivos ignorados: npm ci, lint, 173 tests en 11 archivos, 12 escenarios SQL, TypeScript y build aprobados. Node local 24.21.0; CI verifica Node 22.20.0.
2. Deno 2.9.6 con caché inicialmente vacía: cache --frozen, tipos, lint de ocho archivos y 12 tests con permisos de entorno acotados y red denegada, aprobados. actionlint 1.7.12 oficial, binario validado por SHA256: sin errores.
3. [CI inicial](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/38922024227): Frontend, Webhook y PostgreSQL aprobados; Publicar omitido al ser PR. La concurrencia SQL se ejecutó en PostgreSQL 17.11 real sobre Linux. No se usa Supabase para las fixtures.
4. [Ensayo negativo](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/38922296104): una aserción deliberadamente falsa en tests/inf06-gate-probe.test.ts hizo fallar npm test. Los otros dos checks aprobaron; Publicar quedó skipped y el PR mostró mergeable_state blocked bajo la protección activa. No se intentó forzar una integración ni publicar un commit fallido. El archivo temporal se elimina de la revisión final y nunca se integra a main.
5. El [PR 1](https://github.com/ThomasMariani11/chatbot-gastos/pull/1) exige de nuevo los tres checks tras retirar el ensayo. Integrar por squash con SHA esperado y observar el workflow de main. Los resultados posteriores de publicación se consultan en GitHub; esta evidencia no los anticipa.

[Evidencia reproducible sin secretos](evidencias/INF_06_2026-10-16.json).

Se mantiene el aviso existente de bundle superior a 500 kB para el plan frontend. No se actualizan dependencias vulnerables en este punto: INF-07 conserva su alcance. Los límites de prueba y la ausencia de cambios productivos del webhook quedan explícitos.

## Recuperación

Los cambios posteriores entran por rama y pull request. Si un check falla, corregir la causa en la rama; no desactivar controles para publicar. Si una regresión llega a main, preparar un revert mediante otro PR y pasar la misma suite. La cuenta propietaria conserva administración para corregir una regla mal configurada, aunque la protección se aplique a sus pushes normales. No se exige un revisor ajeno que impida el trabajo del propietario.

## Referencias

- https://docs.github.com/en/rest/branches/branch-protection
- https://docs.github.com/en/actions/reference/security/secure-use
- https://docs.deno.com/runtime/fundamentals/configuration/
