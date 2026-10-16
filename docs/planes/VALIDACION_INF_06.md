# INF-06 — Validaciones y protección de main

Fecha: 16/10/2026. Estado: en curso; no se declara protección aplicada ni CI remoto aprobado hasta comprobarlos.

## Alcance

- Frontend: npm ci con package-lock, ESLint, 173 tests Vitest (incluyen migraciones PGlite), 12 escenarios de renovaciones SQL y TypeScript/build.
- Webhook: Deno 2.9.6, lockfile congelado, tipos, lint y 12 tests del código real sin red; entorno limitado a nombres requeridos por las fixtures. No se despliega la Edge Function.
- PostgreSQL: dos sesiones nativas sobre una base efímera PostgreSQL 17.11, imagen oficial fijada por digest, solo loopback, healthcheck y límites; cubre leases, fencing, deduplicación y reintentos tardíos. Sin credenciales de producción.
- Pages: mismo artefacto validado por Frontend; job de publicación depende de Frontend, Webhook y PostgreSQL y solo se ejecuta desde main. Pull requests no publican.
- Acciones por SHA oficial, checkout sin persistencia de credenciales, permisos globales de lectura y escritura pages/id-token únicamente en deploy; timeouts de diez minutos. El job Frontend solo agrega pages:read para consultar su configuración al publicar.

No se cambian lógica de negocio, modelos IA, migraciones ni secretos. La contraseña visible en el servicio PostgreSQL es sintética y exclusiva de su contenedor efímero. La política existente de protección estaba desactivada (GET 404 Branch not protected).

## Reproducibilidad

Node 22.20.0 fijado en .node-version. Deno usa su grafo independiente con nodeModulesDir none; no toma dependencias de una instalación npm manual. La única regla de lint excluida es no-import-prefix: los imports npm inline existentes tienen versión exacta y ahora integridad verificada por deno.lock; se conserva la resolución usada por Supabase y no se reescribe el runtime para satisfacer una preferencia de estilo. El resto del lint y los tipos se exige sin omitir errores.

La prueba renewals.integration.mjs importa PGlite desde la dependencia ya fijada en package-lock; no requiere node_modules/.renewal-validation. Los comandos están en README y package.json.

## Protección prevista

Requerir pull request con los tres checks reales y rama actualizada; aplicar también a administradores. Cero aprobaciones humanas obligatorias para permitir al propietario trabajar solo. Bloquear force push y eliminación de main; resolver conversaciones y mantener historia lineal mediante squash o rebase. Confirmar por lectura posterior de la API antes de darlo por aplicado.

## Validación prevista

1. Desde checkout limpio: instalación npm, lint, tests, SQL y build; grafo Deno con caché vacía, check/lint/tests y actionlint.
2. En GitHub: los tres checks aprueban. Verificar sus nombres e identidad de GitHub Actions antes de exigirlos.
3. Probar una aserción deliberadamente fallida en la rama del PR: Frontend falla, main queda bloqueada y el PR no publica. Retirar la aserción y volver a validar.
4. Integrar únicamente el cambio aprobado y observar la ejecución de main y Pages. Guardar IDs/enlaces y los límites del ensayo, sin secretos.

## Recuperación

Los cambios posteriores entran por rama y pull request. Si un check falla, corregir la causa en la rama; no desactivar controles para publicar. Si una regresión llega a main, preparar un revert mediante otro PR y pasar la misma suite. La cuenta propietaria conserva administración para corregir una regla mal configurada, aunque la protección se aplique a sus pushes normales. No se exige un revisor ajeno que impida el trabajo del propietario.

## Referencias

- https://docs.github.com/en/rest/branches/branch-protection
- https://docs.github.com/en/actions/reference/security/secure-use
- https://docs.deno.com/runtime/fundamentals/configuration/
