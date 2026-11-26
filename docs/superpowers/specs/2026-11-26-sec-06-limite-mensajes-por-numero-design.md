# SEC-06: límite de mensajes por número — diseño

Fecha: 26/11/2026. Tarea 2.2 del plan de remediación (hallazgo SEC-06 / B2-003). Números y aviso aprobados por el propietario.

## Intención

Hoy `enqueue_whatsapp_messages` (020, única definición) guarda en la cola todo mensaje firmado por Meta, y un número no vinculado recibe "Tu número todavía no está vinculado…" en cada mensaje. No hay límite por número. El riesgo es de costo y carga (filas en `inbound_events` y en la cola, respuestas salientes que con número propio cuestan en Meta), no de acceso a datos.

## Objetivos

- **Números no vinculados:** hasta **5 mensajes por minuto** y **30 en 24 horas**. Lo que pasa el límite se descarta sin responder.
- **Aviso de no vinculado:** como máximo **una vez cada 24 horas** por número. Las respuestas a un intento de vinculación ("vinculado", "código inválido") se siguen mandando siempre.
- **Agregado tras la revisión final (decisión del propietario, 26/11/2026):** si el mensaje parece un intento de vinculación mal escrito (dice "vincul…" o trae un bloque de 12 caracteres con letras y números, con o sin espacios o guiones), recibe la guía aunque el aviso ya se haya mandado (`looksLikeLinkAttempt` en `link-code.ts`).
- **Clientes vinculados:** hasta **20 mensajes por minuto**. Al pasarlo, esos mensajes no se procesan y el bot avisa una vez: "Recibí muchos mensajes seguidos 🙏 Esperá un minuto y mandame de nuevo los que falten." Sin límite diario (el cupo de IA de SEC-04 frena el consumo caro).

## No objetivos

- Límite global de números distintos (cada número nuevo sigue creando su fila de estado).
- Cambios en la PWA.

## Enfoques

1. **Todo en la recepción (`enqueue_whatsapp_messages`), con marcas en el payload (elegido).** La función ya bloquea la fila de estado de cada número (`for update`) antes de procesar, así que el conteo es consistente con payloads concurrentes. Atómico con la deduplicación existente.
2. Contar y decidir en el webhook (TypeScript): descartado, dos instancias concurrentes contarían mal y el mensaje ya estaría guardado.
3. Suprimir el aviso de no vinculado al aplicar la respuesta (`apply_whatsapp_job`): descartado, esa función se modifica por reemplazo de texto en varias migraciones y tocarla es más riesgoso que la recepción.

## Diseño

### Migración 056

- Índice `inbound_events(wa_id, received_at desc)` para contar por número y ventana.
- Columnas nuevas en `whatsapp_worker_state`: `rate_notice_at timestamptz` y `not_linked_notice_at timestamptz` (nulas).
- `enqueue_whatsapp_messages` redefinida desde la 020 con el mismo cuerpo, más, por cada mensaje (después de resolver el vínculo `u`):
  - Se quitan del mensaje entrante las claves reservadas `pesito_rate_limited` y `pesito_quiet_not_linked` (nunca vienen de Meta).
  - Conteo de mensajes aceptados del número en `inbound_events` en el último minuto (y, sin vínculo, en las últimas 24 horas). La ventana usa `now()`, igual que el `received_at` por defecto, así que cuentan los mensajes del mismo payload ya insertados.
  - **Sin vínculo** y conteo de 1 minuto ≥ 5 o de 24 horas ≥ 30: se descarta (sin fila en `inbound_events` ni en la cola).
  - **Con vínculo** y conteo de 1 minuto ≥ 20: si no hubo aviso en la última hora (`rate_notice_at`), se acepta marcado con `pesito_rate_limited: true` y se registra `rate_notice_at`; si no, se descarta. *(Ventana de una hora para el aviso: decisión del constructor, así una ráfaga sostenida no genera un aviso por minuto.)*
  - **Sin vínculo** y aceptado: si `not_linked_notice_at` está dentro de las últimas 24 horas, se marca `pesito_quiet_not_linked: true`; si no, se registra `not_linked_notice_at`. El registro se hace solo después de la deduplicación (un reintento de Meta no cuenta).
  - Dueño, `SECURITY DEFINER`, `search_path = pg_catalog, public` y grants sin cambios (solo `service_role`). Bloque de verificación y `notify pgrst`.

### Webhook

- `processor.ts` (`prepareMessage`): si el payload trae `pesito_rate_limited`, responde `BOT_MESSAGES.rateLimited` antes de cualquier otra regla (sin IA).
- `context-repository.ts` (`resolveActorAccess`): sin vínculo, si el payload trae `pesito_quiet_not_linked`, devuelve una respuesta sin texto (no se envía nada; el patrón ya existe en `blocked(null)`). La vinculación se evalúa antes y no cambia.
- `queue.ts`: `IncomingMessage` suma las dos marcas opcionales.
- `bot-messages.ts`: `rateLimited`.

### Compatibilidad y publicación

- Webhook nuevo con SQL 055: no hay marcas, funciona igual que hoy. SQL 056 con webhook anterior (v80): las marcas se ignoran; el mensaje marcado se procesa como antes y el aviso de no vinculado se manda como antes. Compatible en ambos sentidos.
- Orden: merge (PWA sin cambios) → deploy del webhook con smoke 401 → `db push` de la 056. Contrato: mínimo 056; rollback al `main` publicado (mínimo 055). Rollback: conservar la 056.

## Pruebas

- PGlite (001–056): ráfaga de 6 mensajes de un número no vinculado en un minuto → 5 aceptados; 31 en 24 h (fuera del minuto) → 30; vinculado con 21 → 20 normales y 1 marcado; 22.º en la misma hora → descartado; reintento de Meta con el mismo id no cuenta ni registra aviso; aviso de no vinculado: primero sin marca, segundo marcado; pasadas 24 h, otra vez sin marca; claves reservadas entrantes se quitan; dos números no se afectan; dueño, `SECURITY DEFINER`, `search_path` y grants.
- Vitest: el mensaje marcado responde `rateLimited` sin IA; sin vínculo y marcado no responde; sin marca responde `notLinked`; "vincular CÓDIGO" sigue funcionando aunque esté marcado como silencioso.
- Concurrencia real (dos payloads del mismo número a la vez) queda para `npm run test:concurrency` (Docker), como en SEC-04.

## Lo que queda al constructor

Nombres internos, forma exacta del conteo SQL y del bloque de verificación.
