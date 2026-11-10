# NOTIF-02 — Resumen de fin de mes: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El día 1 a las 10 (ART) llega un push sin montos "📊 Tu resumen de <mes>" y, del 1 al 7, la PWA muestra una tarjeta "Cerraste <mes>" con totales por moneda, comparación y presupuesto; todo apagable con un interruptor propio.

**Architecture:** Reutiliza la bandeja `client_notifications` y el cron `pesito-client-push` de 046: la migración 051 agrega un tipo `monthly_summary` y su preferencia; el webhook solo aprende a formatearlo; la PWA calcula la tarjeta con lecturas propias bajo RLS.

**Tech Stack:** PostgreSQL/PL-pgSQL (PGlite en pruebas), Deno/TypeScript (webhook, probado con Vitest), React 19 + Vite, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-10-notif-02-resumen-mensual-design.md`

## Global Constraints

- Rama `feat/notif-02-resumen-mensual` desde `main` actualizado. Archivos con CRLF: conservar finales de línea.
- Push sin montos. Título exacto `📊 Tu resumen de ${mes}` (mes en minúscula, español); texto exacto `Tu resumen del mes está listo. Tocá para ver cuánto gastaste y cuánto te quedó.`; `url: "./#cierre-mes"`; `tag: "pesito-resumen"`.
- Encolar solo el día 1 (hora argentina) a las 10 u 11; `period_key` = mes anterior `YYYY-MM`; uno por usuario y mes.
- Mismo criterio de cuentas que el registro de 046: admin, o cliente `active` con `subscription_until` nulo o futuro; con `monthly_summary_enabled`, al menos un dispositivo y al menos un movimiento `confirmed` con `occurred_on` en ese mes.
- `app_settings.monthly_summary_enabled boolean not null default true`.
- Monedas nunca se suman entre sí. Presupuesto solo en pesos (`budgets.amount_ars`, `month` = primer día del mes).
- Tarjeta visible del día 1 al 7 (hora argentina), solo con interruptor activado y movimientos en el mes; "Cerrar" la oculta para ese mes y esa cuenta.
- Permisos de 046 sin cambios: `enqueue` sin acceso para clientes; `claim`/`finish` solo `service_role`. Sin RPC nueva para clientes. No crear otro cron.
- Logs sin montos ni nombres. Datos de prueba ficticios.
- No editar migraciones aplicadas; sin acciones en producción.

## Review Focus

1. **Cambio de año:** el día 1/1/2027 debe resumir `2026-12` y comparar con noviembre 2026 (no "mes 0"). → pruebas en Task 1 (SQL) y Task 3 (PWA).
2. **Webhook viejo / tipo desconocido:** un `kind` que el webhook no conoce no debe enviar el texto de vencimiento. → Task 2.
3. **Solo dólares o solo ingresos:** la tarjeta muestra solo las monedas con movimientos; sin gastos el mes anterior no hay comparación; un aumento desde 0 no muestra "∞%". → Task 3.
4. **Interruptor apagado después de encolar:** el push pendiente se omite al reclamar. → Task 1.
5. **Columna ausente (051 sin aplicar) o lectura fallida:** ni tarjeta ni interruptor; nunca un error visible. → Tasks 3 y 4.

---

### Task 1: Migración 051 y contrato de release

**Files:**
- Create: `supabase/migrations/051_monthly_summary_notifications.sql`
- Create: `tests/monthly-summary-push-sql.test.ts`
- Modify: `config/environments.json` (`release`), `scripts/release-tools.test.mjs`

**Interfaces:**
- Produces: columna `app_settings.monthly_summary_enabled`; kind `monthly_summary` en `client_notifications`; `claim_client_notifications` devuelve por aviso `{id, kind, days, period_key, subscriptions}`.

- [ ] **Step 1: Escribir las pruebas.** Copiar el arnés de `describe('Migración 046')` de `tests/client-push.test.ts` (roles, `auth`, `cron` falso, 001, 005, 045, 046) y aplicar después 051. Usuarios ficticios `61000000-…`. Casos:
  - `encola el resumen solo el día 1 a las 10 u 11, del mes anterior y una vez`: con un movimiento `occurred_on='2026-11-14'` confirmado y un dispositivo, `enqueue('2026-12-01T09:30-03:00')` no encola `monthly_summary`; `'2026-12-01T10:07-03:00'` encola uno con `period_key='2026-11'`; `'2026-12-01T11:30-03:00'` no duplica; `'2026-12-02T10:07-03:00'` no encola.
  - `cambio de año`: con movimiento `'2026-12-20'`, `enqueue('2027-01-01T10:07-03:00')` → `period_key='2026-12'`.
  - `no encola sin movimientos del mes, sin dispositivo, vencidos, pausados ni con el interruptor apagado` (un usuario por condición; movimiento `pending` no cuenta).
  - `reclamar omite el resumen si se apagó el interruptor y devuelve period_key`: el `claim` como `service_role` devuelve `period_key: '2026-11'` para el que sigue activo y deja `skipped` al que apagó después de encolar.
  - `los avisos de 046 siguen iguales`: el escenario de mediodía de 046 (`registration_noon` y vencimiento) da los mismos conteos con 051 aplicada.
  - `permisos sin cambios`: `proacl`, `prosecdef`, `proconfig` y dueño de `enqueue_client_notifications`, `claim_client_notifications`, `finish_client_notification` iguales antes y después de 051; `authenticated` sigue sin poder ejecutar `enqueue`/`claim`.
  - `el cliente puede leer y cambiar solo su preferencia`: como `authenticated`, `update app_settings set monthly_summary_enabled=false` afecta solo su fila.
- [ ] **Step 2: Correr y ver que fallan.** `npx vitest run tests/monthly-summary-push-sql.test.ts` → FAIL (no existe 051).
- [ ] **Step 3: Escribir 051** en una transacción:
  - `alter table public.app_settings add column if not exists monthly_summary_enabled boolean not null default true;` con `comment`.
  - Reemplazar el check de `client_notifications.kind` (buscar su nombre en `pg_constraint`, `drop` y `add` con los cinco tipos).
  - `create or replace function public.enqueue_client_notifications(p_now timestamptz default clock_timestamp())` copiando literalmente los dos bloques de 046 y agregando, antes del `return` del bloque de registro (reestructurar para que el bloque mensual corra aunque `slot` sea nulo), el bloque mensual: condición `extract(day from local_time)=1 and local_hour in (10,11)`; mes resumido `date_trunc('month', local_time)::date - interval '1 month'`; `period_key` `to_char(…,'YYYY-MM')`; movimiento con `occurred_on >= mes and occurred_on < mes + interval '1 month'`; `on conflict do nothing`.
  - `create or replace function public.claim_client_notifications(…)`: agregar a la omisión previa `or (n.kind='monthly_summary' and exists (… not a.monthly_summary_enabled))` (separar del filtro de registro para que la regla de "registró después" no aplique al resumen) y `'period_key', c.period_key` en el JSON (`returning` debe incluir `n.period_key`).
  - Repetir los `revoke`/`grant` de 046 para las dos funciones; `notify pgrst, 'reload schema'`.
- [ ] **Step 4: Correr y ver que pasan.** `npx vitest run tests/monthly-summary-push-sql.test.ts tests/client-push.test.ts` → PASS.
- [ ] **Step 5: Contrato de release.** `config/environments.json`: `minimumMigration` `"051"`, `rollbackCommit` = `git rev-parse origin/main` al crear la rama (publicación vigente), `rollbackMinimumMigration` `"050"`. Ajustar `scripts/release-tools.test.mjs` corriendo los números un lugar (050→051, 049→050, 51→52 en `migrationRange`) como se hizo para 050. Correr `npm run test:release:guards` → `fail 0`.
- [ ] **Step 6: Commit** `feat(sql): resumen de fin de mes en la bandeja de avisos push (051)`.

### Task 2: Webhook — formatear el resumen y no enviar tipos desconocidos

**Files:**
- Modify: `supabase/functions/whatsapp-webhook/client-push.ts`
- Test: `tests/client-push.test.ts` (bloque `Despacho de avisos push`)

**Interfaces:**
- Consumes: `period_key` de Task 1 (puede faltar si el SQL es anterior).
- Produces: `ClientNotification.kind` incluye `"monthly_summary"`; `ClientNotification.period_key?: string | null`; `formatClientPush(n: Pick<ClientNotification,"kind"|"days"|"period_key">, now?: number): {title; body; url; tag} | null`.

- [ ] **Step 1: Pruebas.**
  - `formatClientPush({kind:'monthly_summary', days:null, period_key:'2026-11'})` → `{ title: '📊 Tu resumen de noviembre', body: 'Tu resumen del mes está listo. Tocá para ver cuánto gastaste y cuánto te quedó.', url: './#cierre-mes', tag: 'pesito-resumen' }`.
  - Sin `period_key`, con `now = Date.parse('2027-01-01T10:07:00-03:00')` → título `📊 Tu resumen de diciembre`.
  - `period_key` inválido (`'2026-13'`) → usa el mes anterior a `now`.
  - Ningún texto incluye dígitos de importe (extender la prueba existente "los textos no incluyen importes" al tipo nuevo).
  - `formatClientPush({kind:'otro' as never, days:null})` → `null`; en `deliverClientPush`, ese aviso no llama a `send` y se cierra con `p_outcome: 'skipped'`.
- [ ] **Step 2: Correr** `npx vitest run tests/client-push.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** Nombre del mes con un arreglo propio de doce nombres (no `Intl`, igual que `monthly-summary.ts`); mes anterior calculado en hora argentina (UTC−3, sin horario de verano). Las ramas existentes no cambian de texto. En `deliverClientPush`, si `formatClientPush` devuelve `null`, cerrar como `skipped` sin enviar.
- [ ] **Step 4: Correr** el mismo comando → PASS; `npm run lint` sin errores.
- [ ] **Step 5: Commit** `feat(webhook): push del resumen de fin de mes sin montos`.

### Task 3: PWA — reglas y lectura del cierre de mes

**Files:**
- Create: `src/monthCloseRules.ts`
- Test: `tests/month-close.test.ts`

**Interfaces:**
- Consumes: `computeTotalsByCurrency` de `src/dashboardData.ts`.
- Produces:
  - `closedMonth(now?: number): string | null` → `'YYYY-MM'` del mes anterior si el día argentino es 1–7; si no, `null`.
  - `type CurrencyClose = { currency: 'ARS'|'USD'; expenses: number; income: number; balance: number; expenseChange: number | null }` (`expenseChange` en % entero con signo, `null` si el mes anterior no tuvo gastos en esa moneda).
  - `type MonthClose = { month: string; previousMonth: string; currencies: CurrencyClose[]; budget: { amount: number; left: number } | null }` (`left` = presupuesto − gastos en pesos; negativo si se pasó).
  - `buildMonthClose(month: string, rows: Array<{amount:number; currency:'ARS'|'USD'; kind:'expense'|'income'; occurred_on:string}>, budgetArs: number | null): MonthClose | null` (`null` si el mes no tiene filas).
  - `loadMonthClose(client, userId: string, now?: number): Promise<MonthClose | null>`: lee `app_settings.monthly_summary_enabled` (no `true` → `null`), luego `transactions` confirmadas de `previousMonth`-01 hasta fin de `month` (`amount_ars,currency,kind,occurred_on`) y `budgets.amount_ars` del mes; cualquier error → `null`. Tipo del cliente estructural como `ReminderClient` en `clientNoticeRules.ts`.
  - `isMonthCloseDismissed(userId, month): boolean` / `dismissMonthClose(userId, month): void` con clave `pesito:cierre-mes-oculto:${userId}:${month}` (try/catch como `dismissNotice`).
  - `monthLabel(month: string): string` → `'noviembre'`; `shortMonthLabel` → `'nov.'`.
- [ ] **Step 1: Pruebas.**
  - `closedMonth(Date.parse('2026-12-01T00:30:00-03:00'))` → `'2026-11'`; `'2026-12-07T23:59-03:00'` → `'2026-11'`; `'2026-12-08T00:00-03:00'` → `null`; `'2027-01-03T12:00-03:00'` → `'2026-12'`; `'2026-12-01T02:00:00Z'` (30/11 23 h ART) → `null`.
  - `buildMonthClose('2026-11', filas ARS: gasto 350000 y 100000 en oct., ingreso 470000 en nov.; USD: gasto 50 en nov., budget 400000)` → ARS `{expenses:350000, income:470000, balance:120000, expenseChange:250}`, USD `{expenses:50, income:0, balance:-50, expenseChange:null}`, `budget {amount:400000, left:50000}`; orden ARS antes que USD.
  - Excedido: gastos 450000 y presupuesto 400000 → `left: -50000`. Sin presupuesto → `budget: null`.
  - Baja: oct. 100000, nov. 92000 → `expenseChange: -8`. Mes sin filas → `null`. Moneda solo con movimientos en el mes anterior → no aparece.
  - `loadMonthClose` con cliente falso: preferencia `false` → `null`, columna ausente (`{}`) → `null`, error en transacciones → `null`; caso feliz arma el `MonthClose` y pide el rango `2026-10-01`…`2026-11-30` con `status='confirmed'`.
  - `dismissMonthClose('u','2026-11')` → `isMonthCloseDismissed('u','2026-11')` true y `('u','2026-12')` false; con `localStorage` que lanza, no rompe.
- [ ] **Step 2: Correr** `npx vitest run tests/month-close.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `src/monthCloseRules.ts` con las firmas de arriba (porcentaje con `Math.round`, centavos vía `computeTotalsByCurrency`).
- [ ] **Step 4: Correr** → PASS.
- [ ] **Step 5: Commit** `feat(pwa): reglas del cierre de mes`.

### Task 4: PWA — tarjeta en el Resumen e interruptor en Ajustes

**Files:**
- Create: `src/MonthCloseCard.tsx`
- Modify: `src/Dashboard.tsx` (junto a `<ClientNotices>`), `src/Settings.tsx` (grupo Avisos), `src/summary.css`
- Test: `tests/month-close-ui.test.ts`; ajustar `tests/settings-draft-ui.test.ts` si su cliente falso de `app_settings` lo requiere.

**Interfaces:**
- Consumes: todo lo producido por Task 3; `formatMoney(amount, currency)` de `lib/finance`.
- Produces: `MonthCloseCard({ userId, onViewMonth: (month: string) => void, client?, now? })`.

- [ ] **Step 1: Pruebas (jsdom, patrón de `tests/client-notices.test.ts`).**
  - Con `now` = 1/12/2026 y datos del caso feliz de Task 3: renderiza `section` con `aria-label="Cierre del mes"`, título `Cerraste noviembre`, bloques `Pesos` y `Dólares` con `Gastos`, `Ingresos`, `Balance`, el texto `▲ 250% vs oct.` y `Te sobraron` + monto del presupuesto.
  - Excedido → `Te pasaste`; sin presupuesto → sin línea de presupuesto; baja → `▼ 8% vs oct.`.
  - "Ver noviembre" llama `onViewMonth('2026-11')`; "Cerrar" la quita y `isMonthCloseDismissed` queda true; al volver a montar, no aparece.
  - `now` = 8/12 → no renderiza nada; `loadMonthClose` → `null` → no renderiza nada.
  - Ajustes: con `monthly_summary_enabled: true` aparece el switch `aria-label="Resumen del mes"` con `aria-checked="true"`; al tocarlo se llama `update({ monthly_summary_enabled: false, … })` y muestra `Resumen del mes desactivado.`; si la columna no viene en la fila, el switch no aparece (el de recordatorios sigue igual).
- [ ] **Step 2: Correr** `npx vitest run tests/month-close-ui.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
  - `MonthCloseCard`: carga con `loadMonthClose` al montar (efecto con bandera `active`), oculta si `closedMonth` es `null` o está cerrada. Estructura y clases como `client-notice` (`client-notice-info`), con encabezado `📊 Cerraste ${monthLabel}` y filas `💸 Gastos`, `💰 Ingresos`, `📈 Balance`, comparación `▼/▲ N% vs ${shortMonthLabel(previousMonth)}` junto a gastos, y `🎯 Te sobraron X del presupuesto` / `⚠️ Te pasaste X del presupuesto`. Botones `Ver ${monthLabel}` (`button-secondary`) y `Cerrar` (`text-button`).
  - `Dashboard.tsx`: renderizar `<MonthCloseCard userId={userId} onViewMonth={(m) => setMonth(m)} />` en el mismo condicional que `ClientNotices`, antes de él. `#cierre-mes` ya cae en `#resumen` por `normalizeDashboardSection`; no tocar el ruteo.
  - `Settings.tsx`: estado `summaryEnabled: boolean | null` leído de la misma consulta `app_settings` (`typeof … === 'boolean'`), `updateMonthlySummary(next)` copiando `updateReminders` con mensajes `Resumen del mes activado.` / `Resumen del mes desactivado.`; fila nueva debajo de la de recordatorios, solo si `summaryEnabled !== null`, con texto: `El día 1 te avisamos que tu resumen del mes anterior está listo y lo ves arriba del Resumen durante la primera semana.`
  - `summary.css`: solo lo necesario para la grilla de montos de la tarjeta, reutilizando variables existentes; legible a 360 px.
- [ ] **Step 4: Correr** la prueba nueva, `npm test`, `npm run lint`, `npm run build` → PASS.
- [ ] **Step 5: Verificación visual local** con `preview_start pesito-local`, después de comprobar que sus destinos son de prueba (CLAUDE.md). La fecha no se puede forzar en el bundle: comprobar solo que Ajustes muestra el interruptor y que el Resumen carga sin errores de consola; registrar que la tarjeta se vio únicamente en jsdom.
- [ ] **Step 6: Commit** `feat(pwa): tarjeta de cierre del mes e interruptor en Ajustes`.

### Task 5: Documentación y verificación final

**Files:**
- Modify: `docs/contexto/CONTEXTO_PESITO_PARA_CLAUDE.md` (sección 16 nueva "NOTIF-02 — en rama, sin publicar"; fila NOTIF-02 de la tabla de pendientes), `docs/planes/PLAN_MEJORAS_PROYECTO.md` (bloque NOTIF-02), `docs/operaciones/DEPLOY_Y_ROLLBACK.md` ("Contrato candidato 051": orden **webhook → 051 → PWA**, rollback conservando 051).

- [ ] **Step 1: Escribir los tres documentos** con decisiones del propietario y del agente tal como figuran en el spec.
- [ ] **Step 2: Verificación completa:** `npm run lint`, `npm run build`, `npm test`, `npm run test:sql`, `npm run test:release:guards`, `npm audit --omit=dev`. Registrar resultados reales (incluido cualquier test intermitente).
- [ ] **Step 3: Commit** `docs: NOTIF-02 en rama (contrato 051)`, push y PR contra `main`. No aplicar 051, no desplegar webhook ni publicar sin autorización explícita.
