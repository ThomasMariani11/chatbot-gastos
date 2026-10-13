# Plan de mejoras del proyecto

## Objetivo

Reunir los pendientes de infraestructura, frontend y backend para resolverlos de a uno, con alcance y criterios de validación claros.

- Repositorio de trabajo: `C:\Users\thomi\OneDrive\Documentos\Codex\chatbot-gastos`.
- Auditoría de referencia: 13/10/2026, commit `3619d86`.
- Estado inicial: pendientes documentados; ninguna corrección de esta lista aplicada.
- Los datos del entorno representan una observación de esa fecha y deben verificarse nuevamente al abordar cada tarea.
- No registrar claves, tokens, textos financieros, comprobantes ni datos personales en este documento.

## Cómo trabajar la lista

1. Elegir una tarea y definir qué se va a cambiar.
2. Revisar el estado actual y las dependencias de esa tarea.
3. Implementar y verificar con pruebas acordes al riesgo; usar un entorno aislado para pruebas destructivas o de permisos.
4. Registrar cambios, validación y cualquier publicación realizada.
5. Marcar la tarea terminada únicamente cuando cumpla su criterio de cierre.

Estados posibles: pendiente, en curso, bloqueada, terminada.

Las tareas de cola, entrega y límites del webhook también requieren cambios de backend. Se conservan aquí por su impacto operativo; al agregar el plan de backend se referenciarán estos IDs para evitar duplicarlas.

## Infraestructura

### Orden sugerido

| Orden | ID | Severidad | Tema | Referencia | Estado |
| --- | --- | --- | --- | --- | --- |
| 1 | INF-01 | Crítica | Permisos de funciones SQL | F01 | Pendiente |
| 2 | INF-02 | Alta | Escrituras e integridad de borradores y cola | F02 | Pendiente |
| 3 | INF-08 | Alta, a verificar | Backups y recuperación | F08 | Pendiente |
| 4 | INF-03 | Alta | Cola fiable y exclusión por usuario | F03 | Pendiente |
| 5 | INF-04 | Alta | Reintentos y respuestas persistentes | F04 | Pendiente |
| 6 | INF-05 | Alta | Red SQL y TLS obligatorio | F05 | Pendiente |
| 7 | INF-06 | Alta | Protección de main y controles de CI | F06 | Pendiente |
| 8 | INF-07 | Alta; desarrollo | Dependencias vulnerables | F07 | Pendiente |
| 9 | INF-09 | Media | Privacidad de logs | F09 | Pendiente |
| 10 | INF-10 | Media | Entornos, deploy y rollback | F10 | Pendiente |
| 11 | INF-11 | Media | Actions y permisos mínimos | F11 | Pendiente |
| 12 | INF-12 | Media | Timeouts y límites de multimedia | F12 | Pendiente |
| 13 | INF-14 | Media | Observabilidad y retención | F14 | Pendiente |
| 14 | INF-13 | Media | CSP y cabeceras de seguridad | F13 | Pendiente |
| 15 | INF-15 | Media | Controles de costos y documentación | F15 | Pendiente |

### INF-01 — Restringir funciones SQL privilegiadas

- [ ] Terminada.
- **Problema confirmado:** `confirm_draft_group`, `discard_draft_group` y `get_active_draft_group` tienen `SECURITY DEFINER`, permiten ejecución a `anon` y no validan la identidad recibida.
- **Archivos:** `supabase/migrations/014_draft_movement_batches.sql:366`, `:311`; `supabase/migrations/015_allow_multiple_transactions_per_wa_message.sql:33`.
- **Trabajo:** crear una migración nueva que revoque ejecución a `PUBLIC`, `anon` y, donde corresponda, `authenticated`; conservar acceso al backend. Si alguna RPC debe permanecer disponible para la PWA, validar explícitamente identidad y permisos.
- **Cierre:** pruebas de lectura y modificación entre dos usuarios rechazadas; llamadas anónimas rechazadas; circuito legítimo del bot funcionando. No probar ataques sobre datos de clientes reales.

### INF-02 — Restringir escrituras e integridad de borradores y cola

- [ ] Terminada.
- **Problema confirmado:** cuentas cliente pueden insertar y modificar tablas operativas. Las claves foráneas de grupo y usuario no garantizan que ambos pertenezcan al mismo propietario.
- **Archivo:** `supabase/migrations/014_draft_movement_batches.sql:73`, `:78`, `:83`.
- **Trabajo:** reservar las escrituras de `draft_groups`, `draft_items` y `whatsapp_message_queue` al backend; revisar políticas y privilegios. Incorporar integridad entre grupo y propietario. Revisar y resolver inconsistencias existentes antes de agregar restricciones.
- **Cierre:** escrituras directas desde clientes rechazadas; relaciones cruzadas rechazadas por la base; lecturas legítimas y procesamiento del bot verificados.

### INF-03 — Hacer fiable el procesamiento de la cola

- [ ] Terminada.
- **Problema confirmado en código:** el debounce marca mensajes como procesados sin interpretarlos. No hay exclusión duradera por usuario ni recuperación programada declarada. En la auditoría había seis registros pendientes con más de una hora; no se confirmó si sus movimientos ya estaban registrados.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:733`, `:742`, `:852`, `:889`.
- **Trabajo:** persistir todos los mensajes; procesarlos en orden con lease por usuario y protección contra trabajadores vencidos; asignar posiciones de forma atómica; comprobar errores de escritura; incorporar recuperación programada. Revisar los pendientes antiguos antes de reprocesarlos.
- **Cierre:** ráfagas, payloads múltiples y ejecuciones simultáneas no pierden movimientos ni colisionan posiciones; un trabajador interrumpido se recupera sin depender solamente de un temporizador en memoria.
- **Dependencias:** INF-01 e INF-02. Coordinar con INF-04 e INF-14.

### INF-04 — Separar recepción, guardado y entrega de respuestas

- [ ] Terminada.
- **Problema confirmado en código:** se omiten reenvíos de IDs fallidos, errores de persistencia pueden tratarse como duplicados y no existe una outbox para respuestas que fallan después de guardar.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:452`, `:666`, `:944`.
- **Trabajo:** distinguir duplicados de errores; confirmar recepción únicamente cuando el mensaje sea durable; definir estados y reintentos. Guardar el resultado financiero y la respuesta pendiente en una misma transacción; reintentar entrega sin repetir el guardado.
- **Cierre:** reenvíos de Meta, doble confirmación y fallos de entrega no duplican movimientos ni producen guardados parciales. Un fallo de persistencia solicita reintento. Documentar la posible repetición de una respuesta si el proveedor la acepta y falla el registro de esa entrega.
- **Dependencias:** INF-03; verificar cobertura de recuperación con INF-08.

### INF-05 — Exigir TLS y limitar acceso SQL por red

- [ ] Terminada.
- **Problema confirmado en Supabase:** permitidas `0.0.0.0/0` y `::/0`; exigencia de SSL desactivada, aunque SSL está disponible.
- **Ubicación:** configuración remota de Supabase; no existe una línea equivalente en el repositorio. Proyecto asociado en `supabase/config.toml:1`.
- **Trabajo:** inventariar orígenes legítimos de conexiones SQL, exigir TLS y definir una lista de redes permitidas. Preparar acceso de recuperación para evitar bloquear la administración.
- **Cierre:** conexiones SQL sin TLS y desde redes no autorizadas rechazadas; conexiones necesarias y servicios legítimos siguen funcionando. Registrar cómo recuperar el acceso administrativo.

### INF-06 — Proteger main y agregar validaciones de CI

- [ ] Terminada.
- **Problema confirmado:** `main` figura sin protección. El workflow publica sin ejecutar pruebas o lint; el webhook queda fuera del chequeo TypeScript y del lint actuales.
- **Archivos:** `.github/workflows/deploy-pages.yml:4`, `:27`; `tsconfig.json:16`; `eslint.config.mjs:6`; `tests/renewals.integration.mjs:4`.
- **Trabajo:** validar pull requests, exigir checks antes de publicar e incorporar lint, pruebas, build y validación del webhook con Deno. Formalizar la dependencia de PGlite y las pruebas de migraciones para que no dependan de una instalación manual ignorada por Git.
- **Cierre:** un cambio con pruebas fallidas no se publica; las validaciones se reproducen desde un checkout limpio; las reglas de main están comprobadas.

### INF-07 — Actualizar dependencias vulnerables de desarrollo

- [ ] Terminada.
- **Problema confirmado por npm audit:** alertas altas en Vite `8.0.13`, brace-expansion `1.1.18` / `5.0.9` y source-map-js `1.2.1`. La auditoría de dependencias de producción no reportó alertas.
- **Archivo:** `package-lock.json:1069`, `:1385`, `:2580`, `:2822`.
- **Trabajo:** verificar avisos vigentes, actualizar versiones compatibles y revisar el diff del lockfile. Evitar actualizaciones forzadas sin revisar compatibilidad.
- **Cierre:** ejecutar audit completo y de producción, lint, pruebas y build; comprobar desarrollo en Windows. Registrar cualquier alerta residual con justificación y alcance.

### INF-08 — Verificar backups y probar recuperación

- [ ] Terminada.
- **A verificar:** la API informó PITR desactivado y ninguna copia física listada. Esto no demuestra ausencia de backups lógicos o externos.
- **Ubicación:** configuración remota; documentación actual en `GUIA-PUESTA-EN-MARCHA.md:30`.
- **Trabajo:** identificar copias realmente disponibles, frecuencia, retención, cifrado y responsables; definir RPO y RTO; verificar qué recursos cubre cada copia. Probar restauración a un entorno aislado y documentar el procedimiento.
- **Cierre:** evidencia de una restauración exitosa, integridad de datos y tiempos medidos; objetivos de recuperación acordados y runbook disponible. No restaurar sobre producción durante la prueba.

### INF-09 — Evitar datos personales y financieros en logs

- [ ] Terminada.
- **Problema confirmado en código:** se imprimen texto financiero completo, teléfonos y respuestas crudas de proveedores.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:97`, `:349`, `:375`.
- **Trabajo:** usar eventos estructurados con tiempos, estado, cantidades y códigos seguros. Evitar textos, comprobantes, destinatarios y credenciales. Revisar accesos y retención de logs.
- **Cierre:** los casos de éxito y error no registran contenido sensible; conservan información suficiente para diagnosticar fallos. Logs históricos de CI requieren acceso adicional para su revisión.

### INF-10 — Documentar y reproducir entornos, deploy y rollback

- [ ] Terminada.
- **Problema confirmado:** la guía indica ejecutar solo la migración inicial, aunque el webhook requiere migraciones posteriores. Web, base y Edge Function se publican por mecanismos separados; no hay staging ni procedimiento de rollback declarados.
- **Archivos:** `GUIA-PUESTA-EN-MARCHA.md:32`, `:42`; `src/supabase.ts:3`; `supabase/config.toml:1`.
- **Trabajo:** actualizar la instalación completa; fijar versiones de herramientas de deploy; separar configuración por entorno y evitar que pruebas apunten a producción inadvertidamente. Definir el orden migración, verificación, webhook, smoke test y activación. Registrar commit, versión Edge, migraciones y rollback compatible.
- **Cierre:** despliegue reproducido en un entorno aislado desde un checkout limpio; smoke test y rollback ensayados; documentación suficiente para otro operador.

### INF-11 — Fijar Actions y aplicar permisos mínimos

- [ ] Terminada.
- **Problema confirmado:** Actions referenciadas mediante tags móviles; permisos de publicación y OIDC definidos globalmente, también para build.
- **Archivo:** `.github/workflows/deploy-pages.yml:8`, `:21`, `:22`, `:34`, `:35`, `:48`.
- **Trabajo:** fijar acciones a SHA completo verificado, definir actualización periódica y mover permisos de publicación al job de deploy. Revisar timeout de jobs y exposición de credenciales en los pasos de build.
- **Cierre:** todas las acciones fijadas; build con permisos mínimos; publicación verificada sin ampliar permisos innecesariamente.

### INF-12 — Limitar tiempos y tamaño de multimedia

- [ ] Terminada.
- **Problema confirmado en código:** envío y descarga de WhatsApp sin timeout explícito; descarga sin límite propio de bytes antes de convertir a base64.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:86`, `:131`, `:134`.
- **Trabajo:** establecer timeouts y un presupuesto total por trabajo; validar tipos y limitar bytes descargados. Manejar archivos demasiado grandes conservando el estado del trabajo y dando una respuesta útil.
- **Cierre:** proveedores lentos y archivos grandes no agotan invocaciones ni memoria; mensajes admitidos siguen funcionando y los fallos se recuperan conforme a INF-04.

### INF-13 — Incorporar CSP y cabeceras de seguridad

- [ ] Terminada.
- **Problema confirmado por HTTP:** la web tiene HSTS, pero no se observaron CSP, X-Content-Type-Options, Referrer-Policy ni protección contra framing. No se identificó un XSS concreto.
- **Ubicación:** `index.html:3` y configuración del hosting.
- **Trabajo:** definir una CSP compatible con estilos, fuentes, Supabase y Realtime; revisar cabeceras que GitHub Pages permite configurar. Evaluar alternativas solo si una protección requerida no puede implementarse en el hosting actual.
- **Cierre:** cabeceras o política efectivamente publicadas verificadas por HTTP y navegador; autenticación, gráficos, PWA y conexiones funcionan. Documentar limitaciones: frame-ancestors no funciona mediante meta CSP.

### INF-14 — Agregar observabilidad, alertas y retención

- [ ] Terminada.
- **Problema confirmado en el repositorio:** no hay configuración de alertas, métricas de cola/entrega ni política de retención declarada. Servicios externos existentes quedan a verificar.
- **Archivos:** `supabase/migrations/014_draft_movement_batches.sql:47`; `supabase/functions/whatsapp-webhook/index.ts:926`.
- **Trabajo:** medir edad de cola, duración de interpretación y envío, cantidad de operaciones y reintentos. Definir alertas de trabajos atascados y fallos repetidos, con responsable y runbook. Definir retención de payloads y logs sin eliminar trabajo pendiente necesario para recuperación. Revisar cuotas y costos con datos reales antes de cambiar recursos o tamaños del pool.
- **Cierre:** una falla simulada genera una alerta útil; métricas permiten explicar demoras; retención probada y recuperación preservada; contenido sensible excluido de logs.
- **Dependencias:** INF-03, INF-04 e INF-09.

### INF-15 — Corregir documentación y controles de costos

- [ ] Terminada.
- **Problema confirmado:** se documenta un corte el 30/09/2026, pero el webhook no consulta paid_service_messages_authorized ni cost_guard_date. No se comprobaron cargos indebidos.
- **Archivos:** `GUIA-PUESTA-EN-MARCHA.md:115`; `supabase/migrations/001_initial.sql:63`.
- **Trabajo:** verificar tarifas, cuotas y presupuestos actuales de Meta, Gemini y Supabase; acordar límites y alertas; actualizar documentación para que coincida con la protección efectiva. Revisar qué hacer con campos de configuración sin uso.
- **Cierre:** controles y documentación coinciden; límites y alertas se prueban; cualquier corte requiere una fecha y comportamiento vigentes, sin aplicar retroactivamente el corte vencido.

## Frontend — Por agregar

Pendiente de auditoría y definición de tareas. No se agregan problemas supuestos.

## Backend — Por agregar

Pendiente de auditoría y definición de tareas. Referenciar INF-03, INF-04, INF-09 e INF-12 cuando corresponda para no duplicar trabajo.

## Límites de la auditoría de referencia

- No se encontraron Docker, Compose, Kubernetes, Helm, Terraform ni nginx declarados.
- No se detectaron credenciales privadas reconocibles en 281 blobs de texto del historial Git alcanzable. Fue una búsqueda por patrones, no una garantía de ausencia de secretos.
- No se pudo leer el contenido de logs históricos de CI: GitHub respondió 403 por falta de permisos de administrador.
- No se comprobó equivalencia exacta entre el código local y el bundle Edge desplegado.
- Backups lógicos externos, cifrado, restauraciones previas, alertas externas, facturación y quotas efectivas requieren verificación adicional.
- No estaban instalados actionlint, Gitleaks, Trivy, hadolint, tfsec ni checkov. Para esta arquitectura se recomienda priorizar actionlint, Gitleaks y Trivy filesystem; los analizadores Docker/Terraform no tienen archivos aplicables actualmente.

## Registro de tareas realizadas

Completar una entrada al cerrar cada tarea:

| Fecha | ID | Cambios / commit | Validación | Publicación / versión | Pendientes restantes |
| --- | --- | --- | --- | --- | --- |
| — | — | Sin tareas aplicadas todavía | — | — | — |
