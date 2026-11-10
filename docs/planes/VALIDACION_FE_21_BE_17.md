# Validación FE-21 / BE-17 — Cobertura transversal de pruebas

Fecha: 10/11/2026. Rama `test/fe21-be17-cierre`. Alcance decidido por el propietario el 10/11/2026: (1) una sola implementación del dominio financiero en el Resumen; (2) pruebas de Paywall y del componente de diálogos; (3) pruebas directas del módulo de IA (`groq.ts`) y de la cuota de IA, con respuestas simuladas; (4) este inventario. Sin dependencia nueva: no se mide porcentaje de cobertura.

## 1. Qué se hizo en este cierre

- **Dominio único (FE-21):** `src/Dashboard.tsx` dejó de tener copias de respaldo de `computeTotalsByCurrency`, `createDashboardQueryCache` y `DASHBOARD_POLL_INTERVAL_MS`; las importa de `src/dashboardData.ts`. Las copias existían para tolerar mocks parciales en dos pruebas, que ahora conservan el módulo real (`importOriginal`). `tests/fe21-single-domain.test.ts` impide que la copia vuelva.
- **Paywall:** `tests/paywall-ui.test.ts` (8): encabezado por estado, código vacío, normalización, código inválido/usado, error del servidor, canje fallido, canje exitoso con `onSuccess` único, WhatsApp/alias/cerrar sesión.
- **Diálogos:** `tests/modal-dialog.test.ts` (7): semántica modal, fondo inerte, foco inicial, Tab/Shift+Tab confinados, Escape y fondo (bloqueados si está ocupado), restauración de foco y fondo, envío como formulario.
- **IA del bot (BE-17):** `tests/groq-extraction.test.ts` (12): esquema estricto y validación, normalización, clave inválida y señal abortada sin red, texto con reserva de cuota, cuota rechazada sin llamar a la IA, JSON roto/vacío/fuera de esquema, errores HTTP y de red, bloqueo por 429, audio con Whisper y resolución local, audio vacío. Todas las respuestas son simuladas.
- **Cuota de IA:** `tests/ai-quota.test.ts` (4): reserva con trabajo/token/intento/línea, cuota agotada (`rate_limit`) distinta de configuración, abortos antes y durante la reserva.
- **Comprobación de que las pruebas nuevas detectan fallas:** se rompió temporalmente el código (validación de Paywall, `onSuccess` inmediato, Escape con `busy`, restauración de foco, cuota agotada, errores de esquema) y las pruebas correspondientes fallaron; el código se restauró.
- **Suite estable:** el bloque de Web Push de `tests/client-push.test.ts` (cifrado y firma reales) superaba los 5 s por defecto con la suite completa en paralelo; ahora tiene 30 s de margen.

## 2. Inventario por dominio

| Dominio | Pruebas | Qué cubren | Límites |
|---|---|---|---|
| Parser determinístico y textos locales | `deterministic-parser`, `spoken-amounts`, `description-cleaning`, `local-commands`, `message-routing`, `bot-natural-language-and-simplicity`, `routing_test.ts` (Deno, 70) | Importes, monedas, fechas, comandos, ruteo sin IA | Frases reales infinitas; se agregan regresiones por caso |
| IA y cuota de IA | `groq-extraction`, `ai-quota`, `interpretation-diagnostics`, `fixtures/groq-evaluation`, `routing_test.ts` | Esquema, normalización, errores, límites, audio, cuota | Sin llamadas reales a Groq/Gemini; calidad del modelo no se prueba |
| Borradores, correcciones y confirmación | `draft-batches`, `draft-corrections`, `draft-edit`, `draft-summary`, `incomplete-drafts`, `bulk-amount-corrections`, `draft-rpc-permissions`, `bot-messages-sql` | Lista, correcciones, faltantes, confirmación atómica, textos | — |
| Cola durable y concurrencia | `durable-queue`, `queue_test.ts` (Deno), `durable-queue-concurrency.mjs` (CI PostgreSQL) | Leases, reintentos, checkpoints, deduplicación, carreras | Concurrencia probada en Postgres de CI, no en producción |
| Cuotas | `installment-*`, `installments-dashboard-ui` | Fechas, planes, edición, paginación, UI | — |
| Monedas, totales, presupuesto y Resumen | `finance`, `fe18-queries-and-pagination`, `fe21-single-domain`, `dashboard-loading`, `summary-presentation`, `monthly-summary*`, `month-close*` | Sumas exactas por moneda sin mezclar, paginación, cierre de mes | — |
| Categorías y reclasificación | `category-rules`, `category-visuals`, `categories-catalog-sql`, `category-reclassification-sql` | Catálogo de 31, reglas, reclasificación reversible | — |
| Suscripción, renovaciones y códigos | `subscription*`, `renewal-delivery`, `renewals.integration.mjs` (12 escenarios SQL), `paywall-ui` | Estados, canje, renovación por WhatsApp, pagos, Paywall | — |
| Altas y vinculación | `signup-*`, `whatsapp-link*`, `whatsapp-linking-sql`, `profile-draft`, `settings-draft-ui` | Invitaciones, vínculo, perfil, Ajustes | — |
| Avisos push y resumen mensual | `client-push`, `client-notices`, `push-*`, `monthly-summary-push-sql` | Cifrado RFC 8291, VAPID, bandeja idempotente, opt-out | Entrega real de Apple/FCM verificada solo manualmente |
| PWA | `pwa-service-worker`, `pwa-updates`, `pwa-entry-*`, `lazy-loading`, `use-swipe-back` | Service worker, actualización, entradas offline, carga diferida | Instalación en dispositivos reales: aceptación manual |
| Accesibilidad y UI | `accessible-dialogs-and-labels`, `modal-dialog`, `button-contrast-and-auth-tabs`, `sidebar-status-and-notice`, `support-whatsapp-button`, `ai-quota-ui` | Diálogos, foco, etiquetas, contraste | Sin lector de pantalla real |
| Seguridad, logs y aislamiento | `log-privacy`, `safe-errors`, `operational-isolation`, `resource-limits`, `browser-security`, `environments`, `issue-details`, `admin-send`, `operations` | Logs sin datos personales, errores seguros, límites, aislamiento por usuario | — |
| SQL, RLS y roles | `*-sql` con PGlite y migraciones combinadas, `sql/*.sql` (smoke) | Permisos `anon`/`authenticated`, SECURITY DEFINER, contratos | PGlite y Postgres de CI, no producción |
| Release y CI | `scripts/release-tools.test.mjs` (14), `rehearse-release.mjs` (ensayo con Supabase local), jobs Frontend/Webhook/PostgreSQL/Ensayo | Contrato de migraciones, rollback, gates de publicación | — |
| Arquitectura del webhook | `be18-webhook-architecture-and-calls`, Deno check/lint en CI | Módulos, llamadas remotas, tipado Deno | — |

## 3. Criterios de cierre

- Las pruebas importan el código real; no quedan copias divergentes del dominio en el Resumen (prueba de arquitectura).
- Toda la suite corre en CI (Frontend: lint, Vitest, SQL, guards y build; Webhook: Deno check/lint/test; PostgreSQL: concurrencia; Ensayo de release).
- Las pruebas nuevas fallan ante defectos introducidos a propósito y pasan con el código actual.

**Límites que se aceptan al cerrar:** no hay pruebas automáticas en un navegador real (E2E) ni medición de cobertura (decisión del propietario: sin dependencia nueva); no hay llamadas reales a Meta, Groq, Gemini, Apple ni FCM; el número de pruebas no prueba cobertura completa. Nuevas regresiones se agregan junto con cada tarea.

## 4. Verificación ejecutada (10/11/2026, Windows)

- `npm test`: 77 archivos, 1409 pruebas aprobadas.
- `npm run test:sql`: 12 escenarios aprobados.
- `npm run test:release:guards`: 14 aprobados, 0 fallidos.
- `npm run lint` y `npm run build`: aprobados.
