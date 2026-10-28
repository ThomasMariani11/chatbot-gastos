# Validación y despliegue de BE-16

Fecha: 28/10/2026.
Rama: `codex/be-16-safe-errors-and-logs`.
Alcance: Separar errores de negocio, persistencia y envío / Logs y errores seguros (`BE-16`).

## Problemas resueltos

1. **Exposición de detalles internos y mensajes de negocio crudos al usuario:**
   - En las funciones RPC de confirmación y descarte de borradores (`confirm_draft_group`, `discard_draft_group`), los mensajes devueltos al usuario ante listas ya procesadas combinaban cadenas en inglés y enums internos (`'El grupo ya fue confirmed'`, `'El grupo ya fue discarded'`).
   - Las excepciones imprevistas o fallos de base de datos no capturados en las funciones de negocio exponían errores crudos (`SQLERRM`, nombres de tablas o columnas de PostgreSQL) al usuario final en WhatsApp o la PWA.
2. **Ambigüedad entre fallos de persistencia y fallos de entrega en la cola:**
   - Cuando un trabajo ya había aplicado sus efectos en base de datos (`effect_applied = true`), si la llamada posterior de envío de mensaje por WhatsApp (`scoped.send`) fallaba por un problema de red o caída de la API de Meta, el actor de cola marcaba el trabajo de nuevo con etapa inicial o ambigua, y `fail_whatsapp_job` lo categorizaba con el mismo código genérico `'QUEUE_RETRY_REQUIRED'`.
   - Esto impedía al monitor operativo y a los reintentos distinguir si lo que falló fue la persistencia del gasto/ingreso o únicamente la notificación de respuesta al usuario.
3. **Privacidad de credenciales en peticiones salientes a proveedores de IA:**
   - En `supabase/functions/whatsapp-webhook/helpers.ts`, la API key de Google Gemini se enviaba como parámetro de query en la URL (`?key=${apiKey}`).
   - Los parámetros de consulta en URLs son más susceptibles a quedar registrados en logs de proxies, gateways intermedios o herramientas de diagnóstico de red.

## Cambios realizados

### 1. Migración `041_safe_business_errors.sql`
- **Mensajes de negocio limpios en `confirm_draft_group`:**
  - Ante lista confirmada previamente: `'Esta lista ya fue confirmada anteriormente.'`.
  - Ante lista descartada previamente: `'Esta lista ya fue descartada.'`.
  - Ante cualquier otro estado no abierto: `'La lista no se encuentra en estado borrador.'`.
  - Bloque `exception when others`: captura cualquier fallo técnico interno imprevisto, emite una advertencia de servidor con `SQLSTATE` sin exponer datos de usuario, y retorna de forma segura `{"success": false, "error": "No se pudo confirmar la lista; hubo un problema técnico al registrar las operaciones. Por favor intentá nuevamente."}`.
- **Manejo seguro de excepciones en `discard_draft_group`:**
  - Ante lista no encontrada o no abierta: `'La lista ya no se encuentra pendiente.'`.
  - Bloque `exception when others`: captura cualquier fallo técnico imprevisto y retorna `{"success": false, "error": "No se pudo descartar el lote pendiente por un error técnico. Por favor intentá nuevamente."}`.
- **Diferenciación de reintentos en `fail_whatsapp_job`:**
  - Si el efecto ya fue aplicado (`q.effect_applied = true`), `fail_whatsapp_job` actualiza `whatsapp_message_queue.error_message` e `inbound_events.error_code` como `'QUEUE_SEND_RETRY'`, dejando claro que la operación financiera ya está asentada y solo resta reintentar la entrega del mensaje.
  - Si el efecto no fue aplicado, mantiene `'QUEUE_RETRY_REQUIRED'` para su reevaluación.

### 2. Función de cola de WhatsApp (`supabase/functions/whatsapp-webhook/queue.ts`)
- Inicializa la etapa del trabajo según si el efecto ya fue asentado:
  `let stage: FailureStage = job.effect_applied ? "send" : "interpret";`
- Inmediatamente después de `apply_whatsapp_job`, establece `stage = "send"` antes de invocar la entrega.
- Si `scoped.send` falla cuando `job.effect_applied` es verdadero, el fallo operativo queda catalogado con `stage: "send"`, impidiendo reintentos de interpretación o diagnósticos equívocos.

### 3. Privacidad de API keys en llamadas externas (`supabase/functions/whatsapp-webhook/helpers.ts`)
- Se eliminó el parámetro de query `?key=${apiKey}` en la URL de Google Gemini `models/${model.id}:generateContent`.
- La API key se traslada de manera segura en el encabezado HTTP estándar `x-goog-api-key: apiKey`.
- Se añadieron tipos seguros para el entorno Deno/Node sin generar errores de compilación ni advertencias de variables globales no definidas.

### 4. Pruebas automatizadas (`tests/safe-errors.test.ts`)
- 7 pruebas exhaustivas verificando:
  1. `confirm_draft_group` informa estados ya procesados con mensajes claros en español, sin enums crudos (`'confirmed'`) ni cadenas `SQLERRM`.
  2. Fallos de persistencia inyectados mediante triggers temporales retornan mensajes controlados y amigables, sin exponer `SQLERRM`, `SQLSTATE` ni nombres de tablas/columnas.
  3. `discard_draft_group` ante errores imprevistos devuelve mensajes genéricos protegidos sin filtrar excepciones internas.
  4. `fail_whatsapp_job` cataloga trabajos con efecto aplicado como `QUEUE_SEND_RETRY` en cola y eventos de entrada.
  5. `fail_whatsapp_job` cataloga trabajos sin efecto aplicado como `QUEUE_RETRY_REQUIRED`.
  6. Si un trabajo con `effect_applied = true` experimenta un fallo de entrega de red, registra el incidente con `stage: "send"` y nunca vuelve a invocar `prepare`.
  7. `extractFromGemini` envía la API key en el encabezado `x-goog-api-key` y nunca en la query string de la URL.

## Evidencia de validación técnica

- **Vitest:** 47 suites pasadas, 1,058 pruebas pasadas (0 fallos).
- **Pruebas SQL de integración:** 12 escenarios aprobados (`npm run test:sql`).
- **Guardas de release:** 6 pruebas aprobadas (`npm run test:release:guards`).
- **Linting:** 0 errores (`npm run lint`).
- **Compilación TypeScript y Vite:** aprobada sin errores (`npm run build`).
