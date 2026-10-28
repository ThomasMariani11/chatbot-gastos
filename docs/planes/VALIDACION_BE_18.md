# Validación BE-18 — Separar responsabilidades y reducir llamadas remotas

## 1. Objetivo
Desacoplar las responsabilidades que permanecían combinadas en `helpers.ts` y `processor.ts` dentro de `supabase/functions/whatsapp-webhook/`, y reducir las llamadas remotas secuenciales a la base de datos durante la preparación de cada mensaje de WhatsApp sin comprometer la atomicidad, las validaciones de suscripción ni la seguridad de las RPC.

## 2. Arquitectura modular resultante

| Módulo | Responsabilidad única |
| --- | --- |
| `meta-client.ts` | Criptografía HMAC/SHA-256 (`validSignature`, `sha256`), envío y descarga acotada por Graph API (`sendWhatsAppText`, `downloadWhatsAppMedia`) y verificación de remitente de prueba (`isVerifiedOperationalTestSender`). |
| `gemini.ts` | Esquema JSON multi-operación (`multiResponseJsonSchema`), construcción de prompt contextual, delegación a Groq (`extractWithGroq`) y fallback entre modelos Gemini (`gemini-3.1-flash-lite` → `gemini-3.8-flash`) y parser determinista. |
| `context-repository.ts` | Resolución paralela del contexto del actor (`resolveActorAccess`): vínculo activo (`whatsapp_links`), perfil y vigencia de suscripción (`profiles`), configuración global y datos de soporte (`system_config`), y preferencias de respuesta (`app_settings`). |
| `processor.ts` | Orquestación pura del flujo de decisión del mensaje (`prepareMessage`): vinculación, consultas comerciales/saldo, comandos locales, completado/edición de borradores e invocación de interpretación con `checkpoint`. |
| `queue.ts` | Recepción ordenada (`readMessages`), ciclo de vida del worker por actor (`runActor`, `processJob`) y registro seguro de incidentes (`recordIssue`). |
| `helpers.ts` | Fachada liviana de re-exportación para mantener compatibilidad total con imports existentes. |

## 3. Reducción de llamadas remotas y latencia por mensaje

### 3.1. Antes de BE-18
En cada ejecución de `prepareMessage`:
1. Se ejecutaban **4 lecturas secuenciales** (4 round-trips en serie):
   - `whatsapp_links` (`.eq("wa_id", ...).maybeSingle()`)
   - `profiles` (`.eq("id", ...).maybeSingle()`)
   - `system_config` (`.eq("key", "bot_active").maybeSingle()`)
   - `app_settings` (`.eq("user_id", ...).maybeSingle()`)
2. Si la cuenta estaba suspendida, vencida o hacía una consulta comercial (`query === "commercial"`), se realizaba una **segunda consulta** a `system_config` (`.in("key", ["support_phone", "payment_alias"])`).
3. Si llegaba un mensaje sin texto ni multimedia compatible (p. ej. un sticker o ubicación), se consultaba innecesariamente la RPC `get_active_draft_group` antes de rechazar el formato.

### 3.2. Después de BE-18
1. **Paralelización de lecturas de contexto (1 round-trip en vez de 4)**:
   - Como `claim_whatsapp_actor` / `next_whatsapp_job` ya resuelve `job.user_id`, `resolveActorAccess` lanza en paralelo (`Promise.all`) las lecturas de `whatsapp_links`, `profiles`, `system_config` y `app_settings`, verificando inmediatamente que `link.user_id === job.user_id`.
2. **Unificación de `system_config` en una sola consulta**:
   - `bot_active`, `support_phone` y `payment_alias` se leen juntos en una única consulta `.in("key", ["bot_active", "support_phone", "payment_alias"])` (con respaldo automático a `.eq("key", "bot_active").maybeSingle()` para mocks unitarios simples).
3. **Descarte temprano de mensajes incompatibles**:
   - La validación `!text && !message.image?.id && !message.audio?.id` se ejecuta antes de `db.rpc("get_active_draft_group")`, ahorrando 1 llamada RPC por cada mensaje de tipo no soportado.

| Escenario | Round-trips de BD antes | Round-trips de BD después (BE-18) |
| --- | --- | --- |
| Mensaje de gasto/ingreso normal (`job.user_id` presente) | 4 secuenciales + 1 RPC borrador = **5 viajes** | 1 lote paralelo (4 lecturas simultáneas) + 1 RPC borrador = **2 viajes** |
| Consulta comercial (`¿Cómo renuevo?`) o cuenta suspendida | 4–5 secuenciales = **5 viajes** | **1 viaje paralelo** (incluye `support_phone` y `payment_alias`) |
| Mensaje de tipo incompatible (sticker / ubicación / contacto) | 4 secuenciales + 1 RPC borrador = **5 viajes** | **1 viaje paralelo** (`0` lecturas de borrador) |

## 4. Evidencia de pruebas
- `tests/be18-webhook-architecture-and-calls.test.ts` (4 tests en Vitest):
  1. Verificación de fachada `helpers.ts` y contratos de `meta-client.ts`, `gemini.ts` y `context-repository.ts`.
  2. Ejecución simultánea de las 4 lecturas de contexto (`maxParallel === 4`) y lectura única de `system_config`.
  3. Reutilización de `support_phone` y `payment_alias` sin segunda consulta en cuentas suspendidas y consultas comerciales, y omisión de `get_active_draft_group` en mensajes incompatibles.
  4. Preservación de controles de seguridad: rechazo por cambio de vínculo (`job.user_id !== link.user_id`) y corte global `bot_active = false` para clientes manteniendo acceso de administradores.
- `supabase/functions/whatsapp-webhook/routing_test.ts`: test Deno adicional verificando paralelismo, consulta única a `system_config` y omisión de `get_active_draft_group` en mensajes sin texto/media.
