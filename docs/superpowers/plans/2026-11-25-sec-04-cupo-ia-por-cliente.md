# SEC-04 Cupo de IA por cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un límite diario de IA por cliente, además del global, editable desde el Panel Admin, para que un cliente no agote el cupo de todos.

**Architecture:** La migración 055 extiende la política y la reserva de la 035 (contador por cliente y por día, admin exento), agrega una RPC de admin para editar límites y amplía el dashboard con el top 5 por carril. El bot distingue `user_exhausted` con un mensaje por carril. El panel muestra los límites, el top 5 y un formulario de edición.

**Tech Stack:** PostgreSQL (Supabase), PGlite + Vitest, Edge Function Deno (TypeScript), React 19.

**Spec:** `docs/superpowers/specs/2026-11-25-sec-04-cupo-ia-por-cliente-design.md` (incluida la sección "Decisiones tomadas tras el chequeo del constructor", que prevalece).

## Global Constraints

- Carriles: `qwen` (textos complejos y fotos) y `whisper` (audios). Valores iniciales por cliente: `qwen` **15**, `whisper` **25**; los globales no cambian (100 y 200).
- Límites entre **1 y 10000**; por cliente ≤ global.
- Día = fecha de `America/Argentina/Buenos_Aires`, como en la 035.
- Admin (`profiles.role = 'admin'`) exento del límite por cliente (no suma ni se controla); sí lo alcanza el global.
- Orden en la reserva: `exhausted` (global) → `already_reserved` → `user_exhausted` → reserva. Un rechazo no suma a ningún contador.
- Edición de límites solo con `public.is_admin()` (admin con aal2).
- Preservar dueño, `SECURITY DEFINER`, `search_path = pg_catalog, public` y grants de las funciones redefinidas. No editar migraciones 001–054. Solo datos ficticios.

## Review Focus

- Dos reservas concurrentes del mismo cliente en el último lugar de su cupo: solo una pasa (bloqueo de la fila del cliente); test en Task 1.
- Cambio de día: el contador del cliente arranca en 0 al día siguiente; test en Task 1.
- Límite por cliente bajado por debajo del uso del día: el cliente queda rechazado sin error; test en Task 1.
- Dashboard con el SQL anterior (sin `per_user_limit` ni `top_users`): el panel sigue mostrando el uso global; test en Task 3.
- Valores no numéricos o fuera de rango en el formulario: no se envían y se explica el motivo; test en Task 3.

---

### Task 1: Migración 055 y pruebas SQL

**Files:**
- Create: `supabase/migrations/055_ai_quota_per_user.sql`
- Test: `tests/ai-quota-per-user-sql.test.ts`

**Interfaces:**
- Produces: `reserve_whatsapp_ai_quota(p_id uuid, p_token uuid, p_attempt integer, p_lane text) returns jsonb` (misma firma) con la razón nueva `{allowed:false, reason:'user_exhausted', used, limit, day}`.
- Produces: `admin_update_ai_quota_policy(p_lane text, p_daily_limit integer, p_per_user_daily_limit integer) returns jsonb` → `{lane, daily_limit, per_user_daily_limit, enabled}`; errores 42501 (no admin) y 22023 (validación).
- Produces: `whatsapp_ai_quota_dashboard()` → cada carril agrega `per_user_limit: number` y `top_users: Array<{user_id: string, name: string, used: number}>` (máx. 5, uso descendente).

- [ ] **Step 1: Tests** (PGlite 001–054 con el patrón de `tests/whatsapp-link-strong-sql.test.ts`, luego 055; `beforeAll(..., 120_000)`; dos clientes activos, un admin con TOTP verificado; trabajos reservables con el patrón de `tests/durable-queue.test.ts`):
  - `un cliente que llega a su límite recibe user_exhausted y otro cliente sigue allowed` (bajar `per_user_daily_limit` de `qwen` a 2 para el test).
  - `un rechazo por cliente no suma al global ni al cliente`.
  - `el admin no tiene límite por cliente pero sí global` y `no aparece en top_users`.
  - `el global sigue siendo el techo: exhausted antes que user_exhausted`.
  - `la misma reserva repetida devuelve already_reserved sin sumar`.
  - `el contador del cliente se reinicia al cambiar de día` (fila de ayer no cuenta).
  - `bajar el límite por debajo del uso rechaza sin error`.
  - `dos reservas concurrentes en el último lugar: pasa una sola` (dos conexiones PGlite o dos transacciones secuenciales con bloqueo; si PGlite no permite concurrencia real, validar con `for update` y documentarlo en el reporte).
  - `admin_update_ai_quota_policy`: aal2 actualiza y devuelve la fila; aal1, cliente y anon → 42501; 0, 10001 y por cliente > global → 22023; carril inexistente → 22023.
  - `el dashboard incluye per_user_limit y top_users (máx. 5, orden) solo para admin`.
  - `valores iniciales: qwen 100/15, whisper 200/25`.
  - `dueño, SECURITY DEFINER, search_path y grants sin cambios en reserve y dashboard; la RPC nueva no es ejecutable por anon`.
- [ ] **Step 2:** `npx vitest run tests/ai-quota-per-user-sql.test.ts` → FAIL (falta la 055).
- [ ] **Step 3: Implementar la 055** según la spec y las Global Constraints. Redefinir `reserve_whatsapp_ai_quota` y `whatsapp_ai_quota_dashboard` desde la 035 (única definición vigente), reutilizando la lectura de `profiles` (`for share`) para saber si es admin. Bloque de verificación y `notify pgrst`.
- [ ] **Step 4:** → PASS; `npx vitest run tests/durable-queue.test.ts tests/ai-quota.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(sql): cupo de IA por cliente y edición de límites (SEC-04)`.

### Task 2: Bot — límite por cliente con mensaje por carril

**Files:**
- Modify: `supabase/functions/whatsapp-webhook/ai-quota.ts`, `processor.ts`, `bot-messages.ts`, `gemini.ts` (tipo `requestTextReason`)
- Test: `tests/ai-quota.test.ts` (y el test del procesador que ya cubre `aiQuota`, si existe; si no, agregar uno con el patrón de `tests/whatsapp-link-code.test.ts`)

**Interfaces:**
- Consumes: `reason: 'user_exhausted'` (Task 1).
- Produces: `class AiUserQuotaExceeded extends OperationalFailure { lane: 'qwen' | 'whisper' }`; `BOT_MESSAGES.aiUserQuotaAudio`, `BOT_MESSAGES.aiUserQuotaText`; `requestTextReason` ∈ `"size" | "type" | "quota" | "user_quota_audio" | "user_quota_text"`.

- [ ] **Step 1: Tests:** `user_exhausted en whisper lanza AiUserQuotaExceeded con lane whisper` (y en `qwen`); `exhausted sigue lanzando AiQuotaExceeded`; `el procesador responde aiUserQuotaAudio para un audio y aiUserQuotaText para una foto`; los textos piden escribir el gasto, incluyen el ejemplo y dicen que mañana se renueva.
- [ ] **Step 2:** `npx vitest run tests/ai-quota.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** `AiUserQuotaExceeded` con la misma metadata de fallo que `AiQuotaExceeded` (`rate_limit`). Textos: "Por hoy llegaste al límite de audios 🎧" / "Por hoy llegaste al límite de fotos y mensajes largos 📷", seguido de "Escribime el gasto, por ejemplo:\n${EXAMPLE}\n\nMañana se renueva." (ajustable de tono, mismo formato que `aiQuota`).
- [ ] **Step 4:** → PASS; `npx vitest run tests/be18-webhook-architecture-and-calls.test.ts tests/renewal-delivery.test.ts tests/client-push.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(webhook): mensaje propio al llegar al límite de IA del cliente (SEC-04)`.

### Task 3: Panel Admin — límites, top 5 y edición

**Files:**
- Modify: `src/AiQuotaUsage.tsx` (y estilos `bot-ops-*` en el CSS existente si hace falta)
- Test: `tests/ai-quota-ui.test.ts`

**Interfaces:**
- Consumes: dashboard ampliado y `admin_update_ai_quota_policy` (Task 1).

- [ ] **Step 1: Tests:** `parseAiQuotaSnapshot acepta per_user_limit y top_users` y `acepta la respuesta anterior sin esos campos`; `rechaza top_users con used negativo o más de 5 filas`; `la vista muestra "Por cliente: N por día" y la lista "Nombre Apellido — N"`; `sin campos nuevos no muestra límite por cliente ni lista`; `el formulario envía admin_update_ai_quota_policy con p_lane, p_daily_limit y p_per_user_daily_limit y recarga`; `no envía si un valor está fuera de 1–10000 o por cliente > global, y explica el motivo`; `un error de la RPC se muestra sin romper la vista`.
- [ ] **Step 2:** `npx vitest run tests/ai-quota-ui.test.ts` → FAIL.
- [ ] **Step 3: Implementar** con los patrones del componente actual (sin librerías nuevas).
- [ ] **Step 4:** → PASS; `npm run lint`.
- [ ] **Step 5: Commit** `feat(admin): límites de IA por cliente y top 5 en el panel (SEC-04)`.

### Task 4: Contrato de release y documentación

**Files:** `config/environments.json` (mínimo `055`, `rollbackCommit` = `main` al empezar la rama: `2a4fe60559fe7560d120c42e270d3731c2de45ca`, mínimo `054`), `scripts/release-tools.test.mjs` (de 054/053 a 055/054, mismo patrón), `docs/operaciones/DEPLOY_Y_ROLLBACK.md` (contrato 055: orden merge/PWA → webhook con smoke 401 → `db push`; rollback: conservar 055 y no volver el webhook a v77 sin antes subir el límite por cliente a 10000), `docs/operaciones/COSTOS_Y_CUPOS.md` (límite por cliente y cómo recalcularlo al pasar a IA paga: costo por uso × presupuesto por cliente), `docs/contexto/CONTEXTO_PESITO_PARA_CLAUDE.md` (sección SEC-04 en rama; CRLF).

- [ ] **Step 1:** actualizar el test de contrato → `node --test scripts/release-tools.test.mjs` FAIL.
- [ ] **Step 2:** `environments.json` → 14/14 PASS.
- [ ] **Step 3:** documentar.
- [ ] **Step 4:** `npm run lint`, `npm test`, `npm run build`, `npm run test:release:guards` → OK.
- [ ] **Step 5: Commit** `chore(release): contrato 055 y documentación de SEC-04`.
