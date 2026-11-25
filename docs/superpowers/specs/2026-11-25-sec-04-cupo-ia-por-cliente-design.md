# SEC-04 — Cupo de IA por cliente (diseño)

Fecha: 25/11/2026. Fase 1.4 del plan de remediación de la auditoría de pre-lanzamiento.

## Intención

Que un solo cliente no pueda gastar el cupo diario de IA de todos. Hoy el cupo es único y compartido (migración 035: `qwen` 100 y `whisper` 200 por día para todos los clientes juntos). Un cliente con uso intensivo, un error en bucle o un abuso agota el cupo y deja sin audios ni fotos al resto hasta el día siguiente.

El propietario quiere el mecanismo preparado para escalar cuando la IA sea paga: los números se van a calcular al lanzar (precio, cantidad de clientes, plan de Groq) y se tienen que poder cambiar **sin tocar código**.

## Cómo funciona hoy

- `reserve_whatsapp_ai_quota(p_id, p_token, p_attempt, p_lane)` (035) valida el trabajo y la cuenta, bloquea la política del carril, cuenta el día en `ai_quota_days(day, lane, reserved)`, registra `ai_quota_reservations(job_id, attempt, lane, day)` y devuelve `{allowed, reason?, used, limit, day}`. Razones actuales: `exhausted`, `provider_disabled`, `already_reserved`.
- El día es la fecha de Argentina (`America/Argentina/Buenos_Aires`).
- El bot (`ai-quota.ts`) llama a la RPC antes de cada uso de IA: `allowed` → sigue; `reason = 'exhausted'` → `AiQuotaExceeded`; cualquier otra razón → `OperationalFailure('configuration', …)`.
- `processor.ts` convierte `AiQuotaExceeded` en `requestTextReason: 'quota'` (se guarda en el checkpoint) y responde `BOT_MESSAGES.aiQuota`.
- `whatsapp_ai_quota_dashboard()` (admin) devuelve el uso por carril; `src/AiQuotaUsage.tsx` lo muestra en el panel (sección Bot), con avisos al 75 % y 90 %.
- Los textos simples se resuelven sin IA (parser determinístico) y no consumen cupo.

## Decisiones del propietario (25/11/2026)

- **Un solo plan:** un único límite por cliente para todos (sin planes ni niveles).
- Límites **configurables desde el Panel Admin**, sin código ni migraciones.
- Valores iniciales: **25 audios** (`whisper`) y **15 textos complejos y fotos** (`qwen`) por cliente por día. El cupo global queda como está (200 y 100).
- **El admin queda exento del límite por cliente** (para probar sin trabas); el cupo global sí lo alcanza.
- Mensaje distinto al cliente que llegó a su límite.

## Objetivos

1. Límite diario por cliente y por carril, además del global, controlados en la **misma operación atómica** que hoy.
2. Si el cliente llegó a su límite, se rechaza solo para él, con la razón nueva `user_exhausted`; los demás siguen.
3. El admin edita los cuatro números (global y por cliente, de cada carril) desde el panel, con MFA (`is_admin()` exige aal2 desde la 052) y validación de rangos.
4. El panel muestra el uso global del día (como hoy), los límites vigentes y los **5 clientes que más usaron cada carril** hoy.
5. El bot responde un mensaje propio cuando el cliente llegó a su límite.

## No objetivos

- Planes o niveles con límites distintos (el propietario eligió un solo plan).
- Límites mensuales, cobros por excedente o contadores de costo en dinero.
- Cambiar de proveedor, plan de Groq o habilitar Gemini.
- Avisar al cliente antes de llegar al límite.

## Anti-objetivos

- Que un cliente bloquee a otros (es lo que se corrige).
- Contar dos veces un mismo intento: la reserva sigue siendo idempotente por `(job_id, attempt, lane)`.
- Que un cliente rechazado por su límite consuma cupo global o del cliente.
- Que un cliente o `anon` pueda ver el uso de otros o cambiar límites.
- Aumentar el consumo de IA o cambiar qué mensajes usan IA.

## Enfoque

Hay una sola forma razonable, apoyada en el cupo existente: extender la política y la reserva de la 035. Se descartó contar por número de teléfono (`wa_id`): el límite tiene que ser por cuenta, y un número no vinculado nunca llega a usar IA.

## Diseño

### Migración 055 (`055_ai_quota_per_user.sql`)

- `ai_quota_policy`: columna nueva `per_user_daily_limit integer not null` con check `between 1 and 10000`; valores `qwen` 15 y `whisper` 25.
- Tabla nueva `ai_quota_user_days(day date, lane text references ai_quota_policy(lane), user_id uuid references public.profiles(id) on delete cascade, reserved integer not null default 0 check (reserved >= 0), primary key (day, lane, user_id))`. RLS activado y sin permisos para `public`, `anon`, `authenticated` ni `service_role` (igual que las tablas de la 035).
- `reserve_whatsapp_ai_quota` redefinida desde la versión vigente (035), misma firma, dueño, `search_path`, grants y validaciones previas. Cambios, en este orden dentro de la misma transacción:
  1. Global: igual que hoy (si `reserved >= daily_limit` → `exhausted`).
  2. Si ya existe la reserva del intento → `already_reserved` (sin cambios).
  3. **Por cliente** (si el perfil no es admin): bloquear o crear la fila `(día, carril, usuario)`; si `reserved >= per_user_daily_limit` → `{allowed:false, reason:'user_exhausted', used, limit, day}` **sin** reservar nada.
  4. Si pasa: insertar la reserva, sumar 1 al global y, si no es admin, sumar 1 a la fila del cliente.
  - El usuario es el `u` que ya valida la función (`assert_whatsapp_lease`).
- `admin_update_ai_quota_policy(p_lane text, p_daily_limit integer, p_per_user_daily_limit integer) returns jsonb`: SECURITY DEFINER, `search_path = pg_catalog, public`; exige `public.is_admin()` (42501 si no); valida carril existente y ambos límites entre 1 y 10000 (22023); exige `p_per_user_daily_limit <= p_daily_limit` (22023); devuelve la fila actualizada. `revoke all … from public, anon`; `grant execute … to authenticated`.
- `whatsapp_ai_quota_dashboard()` redefinida: por carril agrega `per_user_limit` y `top_users` (hasta 5, ordenados por uso descendente: `user_id`, nombre y apellido del perfil, `used`). Sigue exigiendo admin.
- Bloque de verificación al final y `notify pgrst`.

### Bot (`supabase/functions/whatsapp-webhook/`)

- `ai-quota.ts`: `reason === 'user_exhausted'` → nueva `AiUserQuotaExceeded` (subclase de `OperationalFailure`, como `AiQuotaExceeded`).
- `processor.ts`: `AiUserQuotaExceeded` → `requestTextReason: 'user_quota'`, respuesta `BOT_MESSAGES.aiUserQuota`.
- `bot-messages.ts`: `aiUserQuota` = "Por hoy llegaste al límite de audios, fotos y mensajes largos 🙏\nEscribime el gasto simple, por ejemplo:\n${EXAMPLE}\n\nMañana se renueva." (texto final a criterio del implementador, mismo tono que `aiQuota`).
- Compatibilidad: el bot nuevo funciona con el SQL anterior (nunca recibe `user_exhausted`). El bot anterior (v77) trataría `user_exhausted` como error de configuración: por eso el bot se despliega **antes** que la 055.

### PWA (`src/AiQuotaUsage.tsx`)

- `parseAiQuotaSnapshot` acepta `per_user_limit` y `top_users` (y tolera su ausencia, para funcionar con el SQL anterior).
- La vista muestra, por carril: uso global / límite global, el límite por cliente y la lista de los 5 clientes con más uso hoy ("Nombre Apellido — N").
- Formulario para editar, por carril, el límite global y el límite por cliente. Llama a `admin_update_ai_quota_policy`, muestra el error de la base si lo hay y recarga el panel. Si la RPC no existe todavía (SQL anterior), el formulario muestra el error sin romper la vista.

### Orden de publicación

1. Merge: Pages publica la PWA (compatible con el SQL anterior: sin `top_users` ni `per_user_limit` no los muestra y el formulario avisa que no está disponible).
2. Deploy del webhook (entiende `user_exhausted`), smoke 401.
3. `db push --dry-run` (solo 055) y `db push`.

Rollback: conservar la 055. **No volver el webhook a v77 mientras la 055 esté aplicada** sin antes subir el límite por cliente a 10000 (así nunca se devuelve `user_exhausted`).

### Pruebas

- **SQL (PGlite 001–055):** un cliente que llega a su límite recibe `user_exhausted` y otro cliente sigue `allowed`; el rechazo por cliente no suma al global ni al cliente; el admin no tiene límite por cliente pero sí global; el global sigue siendo el techo (`exhausted` antes que `user_exhausted`); idempotencia por intento; `admin_update_ai_quota_policy` con aal2 funciona, con aal1, cliente o anon → 42501, rangos y `per_user <= global` → 22023; el dashboard devuelve `per_user_limit` y `top_users` (máximo 5, orden correcto) solo a admin; permisos y SECURITY DEFINER sin cambios; la migración conserva los valores globales.
- **Bot (Vitest):** `user_exhausted` → `AiUserQuotaExceeded`; el procesador responde `aiUserQuota`; `exhausted` sigue con `aiQuota`.
- **PWA (Vitest/jsdom):** parseo con y sin los campos nuevos; la vista muestra el límite por cliente y el top 5; el formulario llama a la RPC con los valores y muestra errores.
- Contrato de release a mínimo 055.

## Decisiones tomadas tras el chequeo del constructor (25/11/2026)

1. **Intentos fallidos:** la reserva del cliente se cobra igual que la global: al reservar, sin devolución si el intento falla (timeout, error de Groq, reintento con otro `attempt`). Motivo: el proveedor puede haber consumido el pedido igual, y los reintentos ya están acotados por la cola. Si se observan clientes perjudicados por fallas, se agrega una devolución en otra iteración.
2. **Mensaje por carril:** `AiUserQuotaExceeded` lleva el carril. `whisper` → `BOT_MESSAGES.aiUserQuotaAudio` ("Por hoy llegaste al límite de audios 🎧", pide escribir el gasto con el ejemplo y avisa que mañana se renueva); `qwen` → `BOT_MESSAGES.aiUserQuotaText` (igual, "límite de fotos y mensajes largos 📷"). Un cliente puede tener un carril agotado y el otro disponible. `requestTextReason` agrega `'user_quota_audio'` y `'user_quota_text'` (se amplía el tipo en `gemini.ts`).
3. **Admin exento:** no suma ni se controla en `ai_quota_user_days`, así que **no aparece en el top 5**; su uso solo se ve en el global. El rol se toma de la misma lectura de `profiles` (`for share`) que ya hace la función para `valid_account`.
4. **Formulario:** un envío por carril con los dos valores (global y por cliente). El panel valida antes de enviar que ambos estén entre 1 y 10000 y que por cliente ≤ global, con un mensaje claro; la base vuelve a validar.
5. **Orden de chequeo:** se conserva el heredado de la 035: global lleno (`exhausted`) → `already_reserved` → por cliente (`user_exhausted`) → reserva.
6. **Cambios de límites:** rigen de inmediato (se leen en cada reserva). Si se baja el límite por debajo del uso del día, esos clientes quedan sin IA ese día; el panel lo deja ver (uso ≥ límite). Sin tabla de auditoría de cambios en esta iteración.
7. **Top 5:** cuenta solo reservas, no rechazos. Al borrar un cliente se borra su contador (`on delete cascade`); es aceptable porque es operativo y diario.
8. **Contrato de release:** `config/environments.json` (mínimo 055, rollback = `main` publicado, mínimo 054) y `scripts/release-tools.test.mjs` (de 054/053 a 055/054), como en SEC-02 y SEC-01.

Los puntos 2 a 8 reemplazan lo que diga en contrario la sección "Bot" de arriba (en particular, el mensaje único `aiUserQuota` pasa a ser uno por carril).

## Queda a criterio del implementador

- Texto final de `aiUserQuota` y de las etiquetas del panel.
- Estilo del formulario y de la lista en el panel, coherente con `bot-ops-*`.
- Nombres internos de funciones auxiliares.
