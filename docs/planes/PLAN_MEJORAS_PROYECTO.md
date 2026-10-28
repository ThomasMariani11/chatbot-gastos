# Plan de mejoras del proyecto

## Estado vigente — 28/10/2026

**BE-13 en revisión, sin publicar.** Migración 039 y registro PWA preparados: Auth/perfil/ajustes/vínculo/categorías/invitación se completan o revierten juntos. 1036 Vitest, lint/tipos/build, 12 SQL y seis guards locales aprobados; Auth real/rollback ya aprobados en el candidato funcional; seguimiento de los cuatro controles y ajuste del fixture nativo en [PR #51](https://github.com/ThomasMariani11/chatbot-gastos/pull/51). Lectura agregada productiva: cuatro cuentas, cero perfiles/ajustes/vínculos ausentes, un único administrador (Thomas). Por decisión expresa del propietario, el administrador inicial queda excluido: no se modifican 005 ni los roles actuales. [Validación y procedimiento](VALIDACION_BE_13.md).

**BE-11 cerrado en el alcance publicado y probado.** PR #50 integrada en 0cc65d9, migración 038 y webhook v62 ACTIVE; 996 Vitest, 83 rutas Deno y cinco controles de main aprobados. Aceptación del propietario 28/10 a las 12:17–12:18 Argentina: lote de 20 + uno retenido; alias atendidos, posición 2 quitada y retenido incorporado una sola vez como 21, sin renumerar. Cero IA, fallos técnicos, movimientos de prueba guardados o trabajos pendientes; cancelación y resumen vacío verificados. [Cierre](VALIDACION_BE_11.md) y [evidencia](evidencias/BE_11_CIERRE_2026-10-28.json).

**BE-12 cerrado en el alcance publicado y probado.** PR #49 integrada en 1e45c94, migración 037 y webhook v61 ACTIVE; 939 Vitest, 80 rutas Deno y cinco controles de main aprobados. Aceptación del propietario 28/10 a las 11:19–11:21 Argentina: cinco ediciones del mismo pendiente, EUR/posición 99 rechazados, cancelación y resumen vacío; cero movimientos de prueba guardados, grupos abiertos o trabajos pendientes. Correcciones sin IA; el alta inicial reservó una consulta Qwen. [Cierre](VALIDACION_BE_12.md) y [evidencia](evidencias/BE_12_CIERRE_2026-10-28.json).

**BE-09 cerrado en el alcance probado.** PR #48 publicada en f96ab87, migración 036 y webhook v60 ACTIVE. 871 Vitest, 75 rutas Deno y los cinco controles de main aprobados. Consulta real del propietario 27/10 a las 13:30: respuesta enviada en 5,122 s, un intento, cero IA; contenido contrastado con SQL, cero movimientos creados y cero trabajos propios pendientes. [Validación](VALIDACION_BE_09.md).

**Decisión del propietario:** el cambio de hosting y las cabeceras HTTP pendientes de INF-13 se postergan hasta que esté terminada la parte funcional de la app. Los backups INF-08 también continúan para la etapa final. No se evalúa ni migra hosting en el próximo bloque; se conserva la CSP ya publicada.

**INF-15 cerrado en el alcance probado.** PR #46 integrada/publicada en ebdd6ee, migración 035 y webhook v59 ACTIVE. 800 pruebas, cuatro controles y Publicar aprobados. Aceptación del propietario 10:07–10:09 Argentina: texto $123 sin IA, audio $234 con una transcripción y cero Qwen, foto con una consulta; contadores 1/100 y 1/200, tres CANCELAR, cero movimientos nuevos, duplicados o trabajos pendientes. [Cierre](VALIDACION_INF_15.md) y [evidencia](evidencias/INF_15_CIERRE_2026-10-27.json).

**INF-14: retención preparada, desactivada.** 19 pruebas nuevas sobre limpieza 30/90, consulta de estimación de solo lectura y ensayo con datos ficticios. Producción: cero registros elegibles hoy; ningún borrado ni activación. PR #47 integrada/publicada en 7f26e33; 819 pruebas y cinco controles de main aprobados, incluida concurrencia/stack completo. La publicación no activó retención; esa decisión sigue separada. [Validación](VALIDACION_INF_14_RETENCION.md). **FE-19 cerrado** en compatibilidad verificada; INF-13 sigue parcial por headers HTTP/framing y decisión de hosting. Backups al final.

**FE-01, FE-02 y FE-03 terminados.** Migración 029 aplicada, [PR #30](https://github.com/ThomasMariani11/chatbot-gastos/pull/30) publicada en d8aaacd, CI completo y aceptación en producción ejecutada por Codex por instrucción del propietario. La compra ficticia se creó, renombró, editó tras eliminar la cuota 2 y eliminó al terminar; cero cuotas de prueba activas. [Evidencia y límites](VALIDACION_FE_01_02_03.md).

**FE-04 + FE-05 terminados.** Migración 030 aplicada y registrada antes de integrar/publicar la [PR #32](https://github.com/ThomasMariani11/chatbot-gastos/pull/32), versión d0cf7e5. Altas PWA con recibo SQL, recuperación del mismo intento tras recargar y carga/error por usuario y mes. Los cuatro controles y la publicación aprobaron. Aceptación final delegada y aprobada en la PWA publicada: doble clic, recarga inmediata, recuperación del formulario, dos comprobaciones y una sola operación/recibo. Cambio rápido de mes correcto. Prueba cancelada, sin movimientos ficticios activos ni envíos pendientes. [Validación, orden y límites](VALIDACION_FE_04_05.md). FE-06/BE-02 quedó publicado y verificado (ver abajo). Ese cierre no cambió FE-09 ni completó la aceptación de homónimos FE-11; su preparación posterior se registra abajo.

**Corrección FE-06 / BE-02 terminada y publicada.** PR #34 (edb051b), migraciones 031 y 032; 561 pruebas y cuatro controles más publicación aprobados. Verificación técnica autenticada en producción con rollback, permisos e identidad privada comprobados y panel abierto sin renovar clientes reales. La prueba UI de pérdida de respuesta/recarga se ejecutó con datos ficticios locales. Revisión histórica de solo lectura completada: un código usado sin usuario sigue como seguimiento separado; no se reasignaron códigos ni se cambiaron vencimientos históricos. [Validación y límites](VALIDACION_FE_06_BE_02.md).

Groq fue renovado sin vencimiento y se conserva el plan Free observado; INF-15 quedó cerrado en el alcance de beta probado el 27/10. Backups siguen al final y la retención no se habilita. Las secciones de revisión y preparación siguientes son registros históricos; no reabren FE-01/02/03/04/05/06 ni BE-02. Los estados y la secuencia vigentes se resumen a continuación.

## FE-07 + FE-12 — publicación y verificación técnica

Publicación autorizada e integrada en [PR #37](https://github.com/ThomasMariani11/chatbot-gastos/pull/37), versión 15269ba. 592 pruebas y los cuatro controles más Publicar aprobados. SHA, SW, bundle y CSP comprobados; acceso autenticado, borrador sin guardar, navegación, espera de más de 30 segundos, bloqueo de actualización, descarte y actualización explícita verificados en la PWA publicada. No se envió el formulario ni se cambiaron datos productivos. [Evidencia y límites](VALIDACION_FE_07_12.md). FE-12 terminado en su alcance. El propietario completó además el flujo en Pesito instalado desde el ícono del iPhone: aviso bloqueado con borrador, conservación al navegar, descarte y actualización con sesión conservada. FE-07 cerrado en ese alcance; no se presume compatibilidad física universal.

## FE-09 + seguimiento FE-11 — publicados y verificados

[PR #39](https://github.com/ThomasMariani11/chatbot-gastos/pull/39) integrada y publicada por autorización explícita del propietario, versión **54dce9e**. 628 pruebas y cuatro controles más Publicar aprobados. Totales por registros existentes, centavos y moneda; corte explícito desde hoy o desde el mes futuro elegido. Paginación de cuotas sin entregar subtotales. Identidad, fallo SQL/rollback y reintento verificados con planes homónimos ficticios en Dashboard y RPC reales sobre base descartable. SHA, SW, bundle y CSP publicados comprobados. Sin migración, webhook ni compras productivas de prueba. **FE-09 y seguimiento FE-11 cerrados en su alcance.** [Evidencia y límites](VALIDACION_FE_09_11.md).

## Punto de reanudación — 28/10/2026

- Producción: **0cc65d9 / PR #50, 001–038 y whatsapp-webhook v62 ACTIVE**. Fuentes, ACL, helpers privados vía API, PWA/SW/CSP y cinco controles verificados; BE-11 aceptado por el propietario. Rollback compatible de runtime: 1e45c94, conservando 038, counters y recibos IA; ver su validación. No volver a runtimes que omitan las guardas de confirmación o cupos.
- INF-15 y FE-19 cerrados en sus alcances verificados. INF-13 parcial por cabeceras HTTP y framing: no cambiar hosting/URL sin preparar una vista previa y obtener aprobación.
- FE-01/02/03/04/05/06/07/09/11/12 y BE-04/05/07/08/09/11/12 conservan sus cierres y límites. BE-17 sigue abierto en su alcance transversal; no se da por cerrado por extensión.
- INF-14: preparación publicada en PR #47 y retención 30/90 validada en aislado; mantener retention_enabled=false sin nueva autorización. La estimación del 27/10 a las 10:20 dio 0 mensajes, 0 métricas y 0 avisos elegibles; 38 registros v1 y dos recibos IA conservados.
- Bloque actual: **BE-13 — consistencia del alta**. Implementado en rama para revisión, sin SQL ni PWA productivos nuevos; 039 requiere publicación posterior. Administrador inicial excluido por el propietario, Thomas conserva su rol. No se reparan cuentas existentes; la lectura agregada no encontró perfiles/ajustes/vínculos ausentes.
- Decisiones vigentes: costo adicional $0, sin cambios de claves/planes/emisor, retención desactivada y backups INF-08 al final.

## Próximos bloques — 28/10/2026

| Orden | Bloque | Qué falta | Criterio para avanzar |
| --- | --- | --- | --- |
| Cerrado en su alcance | INF-15 | Publicado y aceptado: cupos compartidos, reglas locales y cancelaciones correctas. | [Validación](VALIDACION_INF_15.md). |
| Cerrado en su alcance | FE-19 | CSP publicada y compatibilidad revalidada. | Limitaciones físicas/HTTP registradas en INF-13. |
| Cerrado en su alcance | **BE-09** | 036/PR #48/v60, saldos SQL exactos y consulta real verificada. | FE-18/BE-17 no se cierran por extensión. |
| Cerrado en su alcance | **BE-12** | PR #49 / 037 / v61; correcciones y aceptación del propietario verificadas. | [Validación y límites](VALIDACION_BE_12.md). |
| Cerrado en su alcance | **BE-11** | 038/PR #50/v62, recuperación 20+1 y alias aceptados. | [Validación y límites](VALIDACION_BE_11.md). |
| En revisión; sin publicar | **BE-13** | Alta atómica 039, reintentos seguros y mensajes veraces; administrador inicial excluido por decisión del propietario. | Pruebas locales aprobadas; completar CI aislado y autorizar SQL/PWA antes de publicar. |
| Preparado y publicado; sin activar | **INF-14** | Política 30/90 validada y documentada en PR #47. | Retención false hasta una autorización específica; no impide avanzar con mejoras funcionales. |
| Etapa final de la app | **INF-13 / hosting** | Headers HTTP y protección de framing, postergados por el propietario hasta terminar la funcionalidad. | Retomar entonces la evaluación con costo $0 y vista previa; aprobar el cambio después de probar Auth/PWA/rollback. |
| Último | **INF-08** | Backups y recuperación aplazados por el propietario. | Nueva evaluación/autorización cuando se priorice; no habilitar almacenamiento ahora. |

Siguen abiertos: seguimiento histórico BE-02 (un código usado sin usuario), compatibilidad física fuera del flujo iPhone aceptado, revisión de dependencias de desarrollo INF-07/FE-08, cobertura transversal FE-21/BE-17 y las tareas pendientes de sus tablas. Los estados históricos que siguen no sustituyen esta secuencia vigente.

## Revisión incremental del 23/10/2026 — registro histórico

Esta sección conserva la lectura realizada el 23/10 sobre main 8e46f60391558a41801dfc2768194a97e8439632; las auditorías y cierres fechados más abajo se conservan como registro histórico. No se deben interpretar sus líneas antiguas como verificación actual de producción.

### Actualizaciones verificadas

- Desde 79a955d se integraron cuatro commits, todos con autor Thomas Mariani: 83e3322 / PR #26 (Movimientos y Cuotas independientes), 358abc4 / PR #27 (Ajustes), 32db811 / PR #28 (Admin) y 8e46f60 / PR #29 (centrado y selector móvil). Nueve archivos cambiados; no hay cambios de backend, SQL, workflows ni dependencias en ese intervalo.
- El checkout ya estaba actualizado y limpio antes de esta revisión. fetch --all --prune y pull --ff-only no incorporaron nuevos commits; no se reemplazaron cambios locales.
- Los cinco bloques del [plan visual](PLAN_MEJORAS_VISUALES.md) están integrados y la versión 8e46f60 está publicada: version.json y sw.js coinciden, y los cuatro controles más Publicar aprobaron.
- Validación local: lint, TypeScript/build y 468 pruebas aprobados. Chunk principal: 840,59 kB / 240,21 kB gzip; sigue la advertencia de tamaño. Esto es tamaño de build, no una medición de Core Web Vitals.
- No se hicieron despliegues, modificaciones de datos, mensajes a clientes, llamadas de IA ni cambios de infraestructura en esta revisión. No se comprobó nuevamente la configuración remota de Supabase o la disponibilidad de los proveedores.

### Continuidad después del cierre visual — 23/10/2026

El propietario da por cerrado el plan de implementación visual: los cinco bloques están publicados. La comprobación física de compatibilidad continúa como seguimiento, sin declararla realizada. El próximo bloque recomendado del plan general es **FE-01 + FE-02 + FE-03**, coordinado con BE-03, BE-17 y FE-21, para resolver el contrato de planes y proteger los importes.

Secuencia propuesta: (1) pruebas de regresión con planes PWA/WhatsApp, centavos y cuotas eliminadas; (2) contrato de grupo y operación SQL atómica con autorización, validación y control de concurrencia; (3) conectar los formularios a esa operación y actualizar solo campos realmente editados; (4) validar fallos y revisión antes de publicar. No se inició esa implementación ni se modificaron datos reales al cerrar el plan visual.

Después siguen FE-04/FE-05 (duplicados y carga por mes) y FE-06/BE-02 (renovaciones). Los avisos nuevos de desarrollo requieren una actualización acotada de dependencias. En infraestructura permanece INF-15 y el cierre parcial de INF-13/INF-14; backups siguen al final. La vigencia Groq registrada para el 27/10/2026 requiere revisión antes de esa fecha, sin acceder ni rotar credenciales sin la autorización correspondiente.

### Prioridades registradas el 23/10/2026 — reemplazadas por el estado vigente

1. **Alta — FE-01/FE-02/FE-03: integridad de edición de cuotas.** Se extrajo la función actual saveMovementEdit de src/Dashboard.tsx y se ejecutó con un cliente Supabase simulado en memoria. Cero solicitudes a producción. Resultados:
   - Plan con la primera cuota como ID del grupo (contrato WhatsApp): 100 / 100 / 100 pasó a 300 / 100 / 100 en un orden válido de ejecución. La función escribe el total y el importe individual sobre la misma fila (líneas 805, 852 y 859).
   - Editar únicamente el nombre de un plan de 100 repartido en 33,33 / 33,33 / 33,34 dejó 99,99 (línea 805).
   - Fallo sintético al actualizar la segunda cuota: 100 / 100 / 100 pasó a 200 / 100 / 200 pese al mensaje de error. Promise.all no revierte las escrituras independientes (línea 859).
   - Con las cuotas 1 y 3 existentes, la búsqueda por índice renumeró la 3 como 2 y creó una nueva cuota 3 (línea 795).
   - Esto confirma que el código conserva los riesgos; **no demuestra que existan datos dañados de clientes**. Próximo trabajo recomendado: contrato único, actualización SQL atómica, preservar campos/centavos no editados e identidad estable; pruebas con ambos orígenes antes de publicar.
2. **Alta — FE-04/FE-05: altas duplicadas y errores de carga por mes.** Siguen pendientes según código: addMovement sin exclusión inmediata/idempotencia (Dashboard.tsx:618), y cargas que mantienen datos anteriores si falla una consulta (Dashboard.tsx:402–430). No se provocaron fallos ni altas reales.
3. **Alta — FE-06/BE-02: renovaciones concurrentes.** AdminPanel.tsx:498 sigue escribiendo un vencimiento absoluto calculado desde el perfil cargado. Requiere validar el trigger vigente y una operación atómica de servidor; no se hicieron renovaciones reales.
4. **Media — seguimiento INF-07/FE-08: nuevos avisos de desarrollo.** npm audit detectó vitest y @vitest/mocker afectados, con severidad moderada. Son avisos posteriores al cierre histórico de INF-07; no se afirma que el arreglo previo haya fallado. npm audit --omit=dev informó cero vulnerabilidades. El parche indicado para la rama 4 es 4.1.12; actualizar manifiesto/lockfile y volver a validar en una tarea separada. No se ejecutó npm audit fix. Fuentes: [registro de mocks](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) y [rutas Windows](https://github.com/advisories/GHSA-xp26-3454-mjgp). La explotación depende de un servidor de desarrollo con el plugin y acceso al mismo; no se encontró evidencia de explotación ni de exposición del sitio estático por estos avisos.
5. **INF-15 / INF-14: costos, vigencia y retención.** La documentación de la beta registra vencimiento de la clave Groq el 27/10/2026 (VALIDACION_INF_12.md:50); comprobar su vigencia/rotación antes de esa fecha con autorización para credenciales, sin asumir que la configuración remota siga igual. La limpieza/retención permanece sin autorización para activarla. Backups continúan al final por decisión del propietario.

La aceptación física del rediseño, las cabeceras que GitHub Pages no permite configurar y la reducción del bundle también siguen abiertas. La CSP ya se publicó en PR #23; las referencias históricas a publicación pendiente no representan ese avance.


## Ejecución del 23/10/2026 — Groq y cuotas

- **Groq: renovación completada.** Clave sin vencimiento creada con autorización, prueba ficticia HTTP 200 y secreto Supabase actualizado/verificado. Plan Free mantenido, claves anteriores conservadas. [Evidencia y límites](VALIDACION_GROQ_ROTACION_2026-10-23.md). Este avance reemplaza la revisión de vigencia pendiente que figura en la sección histórica anterior; INF-15 sigue abierto.
- **FE-01 / FE-02 / FE-03: publicados y aceptados en [PR #30](https://github.com/ThomasMariani11/chatbot-gastos/pull/30).** RPC atómica 029, contratos PWA/WhatsApp, control de versión e idempotencia; patch de campos editados y cuotas con identidad estable. 490 tests locales, lint/tipos/build, 12 SQL y seis controles de release aprobados. Navegador probado con PGlite ficticio. [Validación y orden de publicación](VALIDACION_FE_01_02_03.md).
- **FE-11:** eliminación por identificador publicada en este bloque; sigue pendiente su aceptación específica con planes homónimos. FE-04 recibió guardia inmediata de envío y recibos para planes, pero las altas normales y la persistencia del intento tras recargar siguen abiertas.
- 029/PWA publicadas y aceptación completada operando solamente la compra ficticia autorizada. No se operó sobre compras preexistentes. La retención permanece sin habilitar y los backups al final por decisión del propietario.

## Objetivo

Reunir los pendientes de infraestructura, frontend y backend para resolverlos de a uno, con alcance y criterios de validación claros.

- Repositorio de trabajo: `C:\Users\thomi\OneDrive\Documentos\Codex\chatbot-gastos`.
- Auditoría de infraestructura: 13/10/2026, commit `3619d86`.
- Auditoría de backend: 13/10/2026, commit `7b5663f` (código sin cambios respecto de `3619d86`).
- Auditoría de frontend: 13/10/2026, commit `72ee916` (código sin cambios respecto de `3619d86`).
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

Las tareas de cola, entrega y límites del webhook también requieren cambios de backend. Las entradas BE referencian las INF relacionadas: implementar el trabajo compartido una sola vez y cerrar ambas cuando se cumplan sus criterios.

## Infraestructura

### Orden sugerido

| Orden | ID | Severidad | Tema | Referencia | Estado |
| --- | --- | --- | --- | --- | --- |
| 1 | INF-01 | Crítica | Permisos de funciones SQL | F01 | Terminada |
| 2 | INF-02 | Alta | Escrituras e integridad de borradores y cola | F02 | Terminada |
| 3 | INF-03 | Alta | Cola fiable y exclusión por usuario | F03 | Terminada |
| 4 | INF-04 | Alta | Reintentos y respuestas persistentes | F04 | Terminada |
| 5 | INF-05 | Alta | Red SQL y TLS obligatorio | F05 | Terminada |
| 6 | INF-06 | Alta | Protección de main y controles de CI | F06 | Terminada |
| 7 | INF-07 | Alta; desarrollo | Dependencias vulnerables | F07 | Terminada |
| 8 | INF-09 | Media | Privacidad de logs | F09 | Terminada |
| 9 | INF-10 | Media | Entornos, deploy y rollback | F10 | Terminada |
| 10 | INF-11 | Media | Actions y permisos mínimos | F11 | Terminada |
| 11 | INF-12 | Media | Timeouts y límites de multimedia | F12 | Terminada |
| 12 | INF-14 | Media | Observabilidad y retención | F14 | En curso; retención sin activar |
| 13 | INF-13 | Media | CSP y cabeceras de seguridad | F13 | Parcial; cambio de hosting postergado a la etapa final por el propietario |
| 14 | INF-15 | Media | Controles de costos y documentación | F15 | Terminada en el alcance de beta; PR #46/035/v59 y aceptación |
| 15 | INF-08 | Alta, a verificar | Backups y recuperación | F08 | Pendiente; última del plan |

### INF-01 — Restringir funciones SQL privilegiadas

- [x] Terminada.
- **Cierre al 14/10/2026:** Terminada. Migración 017 aplicada; ACL, HTTP y SQL con ROLLBACK verificados. Prueba WhatsApp del usuario corroborada en la base: un movimiento de prueba de 100 ARS confirmado, ninguno del concepto descartado y cero ítems de prueba pendientes. Webhook v36 sin redespliegue. La publicación Git se consulta en el historial del repositorio. [Procedimiento](VALIDACION_INF_01_BE_01.md) y [evidencia](evidencias/INF_01_BE_01_2026-10-14.json).
- **Problema confirmado:** `confirm_draft_group`, `discard_draft_group` y `get_active_draft_group` tienen `SECURITY DEFINER`, permiten ejecución a `anon` y no validan la identidad recibida.
- **Archivos:** `supabase/migrations/014_draft_movement_batches.sql:366`, `:311`; `supabase/migrations/015_allow_multiple_transactions_per_wa_message.sql:33`.
- **Trabajo:** crear una migración nueva que revoque ejecución a `PUBLIC`, `anon` y, donde corresponda, `authenticated`; conservar acceso al backend. Si alguna RPC debe permanecer disponible para la PWA, validar explícitamente identidad y permisos.
- **Cierre:** pruebas de lectura y modificación entre dos usuarios rechazadas; llamadas anónimas rechazadas; circuito legítimo del bot funcionando. No probar ataques sobre datos de clientes reales.

### INF-02 — Restringir escrituras e integridad de borradores y cola

- [x] Terminada.
- **Estado al 14/10/2026:** Terminada. Migraciones 018 y 019 aplicadas; PWA con RPC publicada antes de cerrar escrituras. 106 tests, lint, tipos, build, permisos, cuatro FK, diez llamadas HTTP y SQL con 24 rechazos y ROLLBACK aprobados. Prueba real del usuario y consulta agregada de solo lectura: vínculo activo y código consumido; gasto de 100 ARS guardado una sola vez; gasto temporal descartado sin guardarse; cero ítems pendientes de prueba. Webhook v36 sin redespliegue. El modo instalado standalone no se comprobó. [Procedimiento](VALIDACION_INF_02_BE_03.md) y [evidencia](evidencias/INF_02_BE_03_2026-10-14.json).
- **Problema confirmado:** cuentas cliente pueden insertar y modificar tablas operativas. Las claves foráneas de grupo y usuario no garantizan que ambos pertenezcan al mismo propietario.
- **Archivo:** `supabase/migrations/014_draft_movement_batches.sql:73`, `:78`, `:83`.
- **Trabajo:** reservar las escrituras de `draft_groups`, `draft_items` y `whatsapp_message_queue` al backend; revisar políticas y privilegios. Incorporar integridad entre grupo y propietario. Revisar y resolver inconsistencias existentes antes de agregar restricciones.
- **Cierre:** escrituras directas desde clientes rechazadas; relaciones cruzadas rechazadas por la base; lecturas legítimas y procesamiento del bot verificados.

### INF-03 — Hacer fiable el procesamiento de la cola

- **Seguimiento 22/10/2026:** corregir bloqueo por revisión manual y aclarar aviso al cliente, con migración 026 y pruebas de regresión; publicación pendiente de CI. [Alcance y validación](CORRECCION_COLA_REVISION_MANUAL_2026-10-22.md).

- [x] Terminada.
- **Cierre al 15/10/2026:** webhook v40, migraciones 020–022; 163 tests, 12 Deno y concurrencia PostgreSQL nativa aprobados. Capturas del propietario: eliminación del ítem erróneo y corrección del número 2 sin aumentar la lista. El propietario confirma números estables y descarte con resumen vacío. Agregados de solo lectura: cero pendientes y cero confirmados con nombres de prueba; cero trabajos v2 fallidos o en procesamiento. Recuperación/interrupciones verificadas en aislamiento, no provocadas en producción. Ocho mensajes heredados conservados para revisión autorizada. [Aceptación](evidencias/INF_03_BE_06_aceptacion_2026-10-15.json) y [procedimiento](VALIDACION_INF_03_BE_06.md).

- **Problema confirmado en código:** el debounce marca mensajes como procesados sin interpretarlos. No hay exclusión duradera por usuario ni recuperación programada declarada. En la auditoría había seis registros pendientes con más de una hora; no se confirmó si sus movimientos ya estaban registrados.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:733`, `:742`, `:852`, `:889`.
- **Trabajo:** persistir todos los mensajes; procesarlos en orden con lease por usuario y protección contra trabajadores vencidos; asignar posiciones de forma atómica; comprobar errores de escritura; incorporar recuperación programada. Revisar los pendientes antiguos antes de reprocesarlos.
- **Cierre:** ráfagas, payloads múltiples y ejecuciones simultáneas no pierden movimientos ni colisionan posiciones; un trabajador interrumpido se recupera sin depender solamente de un temporizador en memoria.
- **Dependencias:** INF-01 e INF-02. Coordinar con INF-04 e INF-14.

### INF-04 — Separar recepción, guardado y entrega de respuestas

- [x] Terminada.
- **Cierre al 15/10/2026:** migración 023 aplicada; 173 tests, diez escenarios de fallo aislados, build, lint y PostgreSQL nativo concurrente aprobados. El propietario confirmó el guardado y la segunda confirmación sin duplicados. Lectura agregada: un único gasto de prueba de 1 ARS, cero pendientes de esa prueba y cero trabajos v2 fallidos o en procesamiento. Se mantiene documentada la posible repetición del texto si Meta lo acepta y falla su registro local. [Aceptación](evidencias/INF_04_BE_10_aceptacion_2026-10-15.json) y [procedimiento](VALIDACION_INF_04_BE_10.md).

- **Problema confirmado en código:** se omiten reenvíos de IDs fallidos, errores de persistencia pueden tratarse como duplicados y no existe una outbox para respuestas que fallan después de guardar.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:452`, `:666`, `:944`.
- **Trabajo:** distinguir duplicados de errores; confirmar recepción únicamente cuando el mensaje sea durable; definir estados y reintentos. Guardar el resultado financiero y la respuesta pendiente en una misma transacción; reintentar entrega sin repetir el guardado.
- **Cierre:** reenvíos de Meta, doble confirmación y fallos de entrega no duplican movimientos ni producen guardados parciales. Un fallo de persistencia solicita reintento. Documentar la posible repetición de una respuesta si el proveedor la acepta y falla el registro de esa entrega.
- **Dependencias:** INF-03; verificar cobertura de recuperación con INF-08.

### INF-05 — Exigir TLS y limitar acceso SQL por red

- **Cierre al 16/10/2026:** terminada para la arquitectura vigente. TLS obligatorio, rechazo sin cifrar y de origen no autorizado, acceso por ambos poolers con CA/hostname válidos y administración HTTPS comprobados. Refrescada únicamente la /32 SQL actual; tres /32 propias observadas, sin rangos mundiales ni costo. El propietario confirma datos visibles y respuesta del bot. El endpoint directo resuelve solo a IPv6 y la PC carece de ruta IPv6 (ENETUNREACH): no se usa en esta arquitectura; para SQL nativo se admite el pooler IPv4. No se afirma autenticación nativa ni TLS directo IPv6 probados. [Runbook y límites](VALIDACION_INF_05.md), [evidencia inicial](evidencias/INF_05_2026-10-15.json) y [cierre](evidencias/INF_05_cierre_2026-10-16.json).

- [x] Terminada.
- **Problema confirmado en Supabase:** permitidas `0.0.0.0/0` y `::/0`; exigencia de SSL desactivada, aunque SSL está disponible.
- **Ubicación:** configuración remota de Supabase; no existe una línea equivalente en el repositorio. Proyecto asociado en `supabase/config.toml:1`.
- **Trabajo:** inventariar orígenes legítimos de conexiones SQL, exigir TLS y definir una lista de redes permitidas. Preparar acceso de recuperación para evitar bloquear la administración.
- **Cierre:** conexiones SQL sin TLS y desde redes no autorizadas rechazadas; conexiones necesarias y servicios legítimos siguen funcionando. Registrar cómo recuperar el acceso administrativo.

### INF-06 — Proteger main y agregar validaciones de CI

- [x] Terminada.
- **Problema confirmado:** `main` figura sin protección. El workflow publica sin ejecutar pruebas o lint; el webhook queda fuera del chequeo TypeScript y del lint actuales.
- **Archivos:** `.github/workflows/deploy-pages.yml:4`, `:27`; `tsconfig.json:16`; `eslint.config.mjs:6`; `tests/renewals.integration.mjs:4`.
- **Trabajo:** validar pull requests, exigir checks antes de publicar e incorporar lint, pruebas, build y validación del webhook con Deno. Formalizar la dependencia de PGlite y las pruebas de migraciones para que no dependan de una instalación manual ignorada por Git.
- **Cierre:** un cambio con pruebas fallidas no se publica; las validaciones se reproducen desde un checkout limpio; las reglas de main están comprobadas.

### INF-07 — Actualizar dependencias vulnerables de desarrollo

- **Cierre al 16/10/2026:** Vite 8.0.13 → 8.0.16, brace-expansion 1.1.18 → 1.1.21 / 5.0.9 → 5.0.12 y source-map-js 1.2.1 → 1.2.2, sin --force ni overrides. Audit completo y de producción: cero alertas conocidas; versiones e integridad productivas sin cambios. Copia limpia: 173 tests, 12 SQL, tipos/lint/build aprobados; Windows: arranque, transformación TSX y rechazo 403 de .env sintético y variante NTFS ADS. Actionlint y tres checks de GitHub aprobados, incluido audit nuevo en Frontend; toda revisión final debe aprobar antes de integrar. Sin cambios de negocio, base ni webhook. Se conserva el aviso de soporte de ESLint como deuda de mantenimiento y los límites de audit/Windows. [Procedimiento](VALIDACION_INF_07.md) y [evidencia](evidencias/INF_07_2026-10-16.json).

- [x] Terminada.
- **Problema confirmado por npm audit:** alertas altas en Vite `8.0.13`, brace-expansion `1.1.18` / `5.0.9` y source-map-js `1.2.1`. La auditoría de dependencias de producción no reportó alertas.
- **Archivo:** `package-lock.json:1069`, `:1385`, `:2580`, `:2822`.
- **Trabajo:** verificar avisos vigentes, actualizar versiones compatibles y revisar el diff del lockfile. Evitar actualizaciones forzadas sin revisar compatibilidad.
- **Cierre:** ejecutar audit completo y de producción, lint, pruebas y build; comprobar desarrollo en Windows. Registrar cualquier alerta residual con justificación y alcance.

### INF-08 — Verificar backups y probar recuperación

- **Decisión del propietario, 15/10/2026:** tarea postergada hasta terminar las demás mejoras de infraestructura, backend y frontend. Se retira la preparación de backups de esta etapa: workflow, scripts, guías y evidencias específicas; el historial Git conserva el trabajo para retomarlo. No se habilitaron backups productivos ni se restauró producción. La app y el bot mantienen las mejoras ya publicadas. Google aceptó la revocación del acceso OAuth de prueba y se retiraron las credenciales temporales locales. El 15/10/2026 se cerró el proyecto Google Cloud pesito-backups por pedido del propietario; la consola confirmó que está apagado y programado para borrarse después del 14/11/2026. Los archivos sintéticos privados de ensayo en Drive permanecen sin automatización; no se activó facturación.

- [ ] Terminada.
- **A verificar:** la API informó PITR desactivado y ninguna copia física listada. Esto no demuestra ausencia de backups lógicos o externos.
- **Ubicación:** configuración remota; documentación actual en `GUIA-PUESTA-EN-MARCHA.md:30`.
- **Trabajo:** identificar copias realmente disponibles, frecuencia, retención, cifrado y responsables; definir RPO y RTO; verificar qué recursos cubre cada copia. Probar restauración a un entorno aislado y documentar el procedimiento.
- **Cierre:** evidencia de una restauración exitosa, integridad de datos y tiempos medidos; objetivos de recuperación acordados y runbook disponible. No restaurar sobre producción durante la prueba.

### INF-09 — Evitar datos personales y financieros en logs

- **Cierre al 16/10/2026:** migración 024 aplicada y registrada atómicamente; webhook v41 activo. Logger con campos permitidos y no-console en CI; advertencia de alta con evento/SQLSTATE, sin UUID ni SQLERRM. 185 tests, 13 Deno, 12 SQL, tipos/lint/build y concurrencia nativa aprobados. Probes sin credenciales: 401 sin encolar; dos eventos HTTP observados sin campos prohibidos; cola/cron sanos. Revisados un Owner, retención Supabase de un día y drains deshabilitados. Historial CI revisado de forma acotada; retención exacta de GitHub y logging administrado por plataforma quedan fuera de la garantía del código propio. Sin borrar históricos ni datos. [Procedimiento y límites](VALIDACION_INF_09.md) y [evidencia](evidencias/INF_09_2026-10-16.json).

- [x] Terminada.
- **Problema confirmado en código:** se imprimen texto financiero completo, teléfonos y respuestas crudas de proveedores.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:97`, `:349`, `:375`.
- **Trabajo:** usar eventos estructurados con tiempos, estado, cantidades y códigos seguros. Evitar textos, comprobantes, destinatarios y credenciales. Revisar accesos y retención de logs.
- **Cierre:** los casos de éxito y error no registran contenido sensible; conservan información suficiente para diagnosticar fallos. Logs históricos de CI requieren acceso adicional para su revisión.

### INF-10 — Documentar y reproducir entornos, deploy y rollback

- **Cierre al 16/10/2026:** destinos separados, CLI fijada, instalación 001–024 y runbook compatible; 190 tests + seis controles de ensayo, 12 SQL, lint/tipos/build aprobados. Ensayo completo en CI Linux 38932608913 aprobado con instalación 001–024 y rollback sin restauración; integración condicionada a los cuatro checks del PR y publicación de Pages verificada antes de informar el cierre. [Validación](VALIDACION_INF_10.md) y [runbook](../operaciones/DEPLOY_Y_ROLLBACK.md).

- [x] Terminada.
- **Problema confirmado:** la guía indica ejecutar solo la migración inicial, aunque el webhook requiere migraciones posteriores. Web, base y Edge Function se publican por mecanismos separados; no hay staging ni procedimiento de rollback declarados.
- **Archivos:** `GUIA-PUESTA-EN-MARCHA.md:32`, `:42`; `src/supabase.ts:3`; `supabase/config.toml:1`.
- **Trabajo:** actualizar la instalación completa; fijar versiones de herramientas de deploy; separar configuración por entorno y evitar que pruebas apunten a producción inadvertidamente. Definir el orden migración, verificación, webhook, smoke test y activación. Registrar commit, versión Edge, migraciones y rollback compatible.
- **Cierre:** despliegue reproducido en un entorno aislado desde un checkout limpio; smoke test y rollback ensayados; documentación suficiente para otro operador.

### INF-11 — Fijar Actions y aplicar permisos mínimos

- **Cierre al 18/10/2026:** SHA contrastados con tags oficiales; Pages fuera del build y subida sin dependencia interna móvil; Dependabot semanal por PR y runbook. actionlint y YAML aprobados; cuatro checks del PR y publicación main aprobados. Web/version.json/sw.js HTTP 200 con c227cf3. Dependabot inició sus comprobaciones correctamente y abrió el PR 9 de versiones, que queda para revisión. [Detalle](VALIDACION_INF_11.md). Sigue INF-12; backups al final.

- [x] Terminada.
- **Problema confirmado:** Actions referenciadas mediante tags móviles; permisos de publicación y OIDC definidos globalmente, también para build.
- **Archivo:** `.github/workflows/deploy-pages.yml:8`, `:21`, `:22`, `:34`, `:35`, `:48`.
- **Trabajo:** fijar acciones a SHA completo verificado, definir actualización periódica y mover permisos de publicación al job de deploy. Revisar timeout de jobs y exposición de credenciales en los pasos de build.
- **Cierre:** todas las acciones fijadas; build con permisos mínimos; publicación verificada sin ampliar permisos innecesariamente.

### INF-12 — Limitar tiempos y tamaño de multimedia

- **Cierre al 20/10/2026:** lectura de streams acotada (imagen 5 MiB, audio 10 MiB), MIME, presupuestos compartidos de descarga/interpretación/envío y 60 s por intento del trabajador. Ante la indisponibilidad observada en Gemini (ocho fallos 503/timeout documentados en [VALIDACION_GEMINI_2026-10-20.md](VALIDACION_GEMINI_2026-10-20.md)), se evaluó e integró Groq Free (`whisper-large-v3-turbo` + normalización de montos hablados preservando `<dígitos> mil` + reglas locales previas para movimientos/comandos/correcciones + `qwen/qwen3.8-27b` con esquema estricto, validador runtime y control compartido de cupo/429). 306 Vitest, 38 Deno sin red, 12 SQL y seis controles Node aprobados. Webhook ACTIVE publicado desde checkout limpio tras CI y smoke 401 verificado. Aceptación real en WhatsApp completada: comprobante en imagen interpretado en **3,11 s** (`qwen`) y audio corto en **2,32 s** (`whisper` + `local_rule` con cero llamadas a `qwen`), seguidos de `CANCELAR` con cero transacciones creadas. La credencial de la beta de 4 usuarios vence el 27/10/2026; la rotación y revisión de retención/costos quedan asociadas a INF-14 e INF-15. [Detalle](VALIDACION_INF_12.md), [evaluación Groq](VALIDACION_GROQ_2026-10-20.md) y [capacidad 4 usuarios](CAPACIDAD_GROQ_4_USUARIOS.md).

- [x] Terminada.
- **Problema confirmado en código:** envío y descarga de WhatsApp sin timeout explícito; descarga sin límite propio de bytes antes de convertir a base64.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:86`, `:131`, `:134`.
- **Trabajo:** establecer timeouts y un presupuesto total por trabajo; validar tipos y limitar bytes descargados. Manejar archivos demasiado grandes conservando el estado del trabajo y dando una respuesta útil.
- **Cierre:** proveedores lentos y archivos grandes no agotan invocaciones ni memoria; mensajes admitidos siguen funcionando y los fallos se recuperan conforme a INF-04.

### INF-13 — Incorporar CSP y cabeceras de seguridad

- **Decisión vigente del propietario — 27/10/2026:** postergar el cambio de hosting y los headers que dependen de él hasta terminar la funcionalidad de la app. Mantener CSP/hosting actuales y retomar la evaluación en la etapa final; no marcar esta deuda como resuelta.

- **Estado vigente al 26/10/2026:** CSP/meta no-referrer publicadas y compatibilidad revalidada con sesión, gráficos, fuentes, administración y actualización. FE-19 cerrado en alcance probado. INF-13 parcial por headers HTTP y framing; requiere decisión de hosting, sin cambiar proveedor/URL en este bloque.

- **Avance 23/10/2026:** CSP generada en el build y no-referrer en HTML; 459 tests, lint/tipos/build y navegador aislado aprobados (scripts/eval/orígenes externos bloqueados, Auth health 200, WSS abierto, fuentes/gráficos/PWA compatibles). Publicación y aceptación productiva pendientes. GitHub Pages no permite configurar las cabeceras HTTP requeridas: protección de framing y demás headers siguen abiertos; no se cambia hosting ni se agregan costos. [Validación](VALIDACION_INF_13.md) y [runbook](../operaciones/SEGURIDAD_NAVEGADOR.md).

- [ ] Terminada.
- **Problema confirmado por HTTP:** la web tiene HSTS, pero no se observaron CSP, X-Content-Type-Options, Referrer-Policy ni protección contra framing. No se identificó un XSS concreto.
- **Ubicación:** `index.html:3` y configuración del hosting.
- **Trabajo:** definir una CSP compatible con estilos, fuentes, Supabase y Realtime; revisar cabeceras que GitHub Pages permite configurar. Evaluar alternativas solo si una protección requerida no puede implementarse en el hosting actual.
- **Cierre:** cabeceras o política efectivamente publicadas verificadas por HTTP y navegador; autenticación, gráficos, PWA y conexiones funcionan. Documentar limitaciones: frame-ancestors no funciona mediante meta CSP.

### INF-14 — Agregar observabilidad, alertas y retención

- [ ] Terminada. **Retención preparada al 27/10/2026:** panel/avisos publicados y aceptados; 19 pruebas nuevas de limpieza 30/90, estimación productiva de solo lectura y ensayos ampliados. Retención desactivada, cero elegibles en la estimación; 819 pruebas y cuatro checks aprobados en 5a007c4. Integración y activación pendientes de autorización. [Validación](VALIDACION_INF_14_RETENCION.md).
- **Problema confirmado en el repositorio:** no hay configuración de alertas, métricas de cola/entrega ni política de retención declarada. Servicios externos existentes quedan a verificar.
- **Archivos:** `supabase/migrations/014_draft_movement_batches.sql:47`; `supabase/functions/whatsapp-webhook/index.ts:926`.
- **Trabajo:** medir edad de cola, duración de interpretación y envío, cantidad de operaciones y reintentos. Definir alertas de trabajos atascados y fallos repetidos, con responsable y runbook. Definir retención de payloads y logs sin eliminar trabajo pendiente necesario para recuperación. Revisar cuotas y costos con datos reales antes de cambiar recursos o tamaños del pool.
- **Cierre:** una falla simulada genera una alerta útil; métricas permiten explicar demoras; retención probada y recuperación preservada; contenido sensible excluido de logs.
- **Dependencias:** INF-03, INF-04 e INF-09.

- **Avance 22/10/2026:** migración 027, agregados por minuto, incidentes de cola/reintentos/revisión/recuperación/pedidos de texto; panel de administrador y bandeja de avisos independiente. El propietario eligió panel y su WhatsApp y confirmó número de prueba de Meta: verificación de emisor antes de cada envío, ventana entrante y bloqueo si cambia. Conservación propuesta 30 días de contenido terminado y 90 días de agregados/avisos enviados o cancelados; **desactivada hasta aprobación**. No se usaron claves backend suspendidas ni se alteraron movimientos. [Runbook y límites](../operaciones/MONITOREO_Y_RETENCION.md).

- **Aceptación 22/10/2026:** migración 027 y webhook v52 publicados (PR #20). Prueba ficticia con el propietario: alerta visible, reconocimiento desde el panel y un aviso recibido por WhatsApp; simulación cerrada sin alterar movimientos ni borradores. 028 y webhook v53 ya publicados (PR #21) para mostrar cliente, fecha/hora de Argentina y diagnóstico seguro en panel/avisos. PR #22 publicada el 23/10/2026 (1eb546b): administración por Clientes, Invitaciones, Bot y Ajustes; vista móvil y modales con foco/teclado revisados. Esto no cierra todas las tareas de accesibilidad o membresías concurrentes del frontend. Retención desactivada.

### INF-15 — Corregir documentación y controles de costos

- [x] Terminada en el alcance probado el 27/10/2026. PR #46/ebdd6ee, 035 y webhook v59 publicados; 800 pruebas y cinco controles aprobados. Texto local, audio Whisper y foto Qwen aceptados; contadores 1/100 y 1/200, tres grupos descartados y cero transacciones nuevas/duplicados/pendientes. [Validación](VALIDACION_INF_15.md).
- **Revalidación:** la guía ya no promete el corte antiguo, pero debe describir la selección Groq/Gemini, enfriamiento por instancia y ausencia de límite monetario global. Los dos campos históricos siguen sin consultarse; se documentan como heredados, sin alterar datos. No se comprobaron cargos indebidos.
- **Archivos:** `GUIA-PUESTA-EN-MARCHA.md:115`; `supabase/migrations/001_initial.sql:63`.
- **Trabajo:** verificar tarifas, cuotas y presupuestos actuales de Meta, Gemini y Supabase; acordar límites y alertas; actualizar documentación para que coincida con la protección efectiva. Revisar qué hacer con campos de configuración sin uso.
- **Cierre:** controles y documentación coinciden; límites y alertas se prueban; cualquier corte requiere una fecha y comportamiento vigentes, sin aplicar retroactivamente el corte vencido.

## Frontend

Auditoría del 13/10/2026 sobre el commit 72ee916. Los dos últimos commits agregan documentación; el código auditado no cambió respecto de 3619d86. El remoto se verificó sincronizado, sin commits nuevos para incorporar.

No se aplicaron correcciones. Lint, type-check, tests y build se ejecutaron en una copia temporal con los archivos del frontend verificados contra el repositorio. Los casos financieros utilizaron funciones reales con respuestas y datos sintéticos; no hubo escrituras contra producción.

### Relación con infraestructura y backend

Implementar una sola vez el trabajo compartido y registrar su validación en las tareas relacionadas. FE-08 comparte actualización de dependencias con INF-07; FE-19 comparte CSP con INF-13. Las RPC propuestas para planes, idempotencia y extensiones requieren autorización e integridad del servidor: coordinar con BE-01, BE-02, BE-03, BE-10 y BE-17 sin reutilizar una RPC de borradores para una operación distinta. Las pruebas de FE-21 acompañan cada corrección; no se postergan hasta terminar todas las tareas.

### Orden sugerido

| Orden | ID | Severidad | Tema | Tareas relacionadas | Estado |
| --- | --- | --- | --- | --- | --- |
| 1 | FE-01 | Alta | Contrato de cuotas de WhatsApp y PWA | FE-02, FE-03, BE-03 | Terminada; publicada y aceptada |
| 2 | FE-02 | Alta | Escrituras atómicas de planes | BE-10, BE-17 | Terminada; publicada y aceptada |
| 3 | FE-03 | Alta | Preservar importes y cuotas eliminadas | FE-01, FE-02 | Terminada; publicada y aceptada |
| 4 | FE-21 | Media | Pruebas de flujos y dominio real | BE-17, INF-06 | En curso; regresiones por bloque, cobertura restante abierta |
| 5 | FE-04 | Alta | Evitar movimientos duplicados | BE-10 | Terminada; publicada y aceptada |
| 6 | FE-05 | Alta | Carga por mes y errores visibles | FE-18 | Terminada; publicada y aceptada |
| 7 | FE-09 | Media | Totales de cuotas restantes | FE-03 | Terminada; PR #39 publicada y verificada en su alcance |
| 8 | FE-06 | Alta | Extensiones concurrentes de suscripción | BE-02 | Corrección terminada; publicada y verificada |
| 9 | FE-07 | Alta | Actualizaciones PWA sin perder formularios | INF-10 | Terminada en el flujo protegido; aceptado en PWA instalada en iPhone |
| 10 | FE-12 | Media | Borradores de Ajustes y refresco de perfil | FE-07 | Terminada; publicada y verificada en su alcance |
| 11 | FE-13 | Media | Validación de invitación fuera de orden | — | Terminada |
| 12 | FE-08 | Alta; desarrollo | Dependencias vulnerables | INF-07 | Terminada |
| 13 | FE-10 | Media | Límite de cuotas y contrato SQL | FE-21 | Terminada |
| 14 | FE-14 | Media | Permitir ampliación del navegador | — | Descartada por decisión del propietario |
| 15 | FE-15 | Media | Diálogos, foco y etiquetas accesibles | FE-07 | Pendiente |
| 16 | FE-16 | Media | Contraste de botones | FE-22 | Terminada |
| 17 | FE-11 | Media | Eliminación visual por identificador | FE-02 | Terminada; homónimos/fallo/reintento verificados en entorno aislado; cierre con PR #39 |
| 18 | FE-17 | Media | Separar carga inicial por pantallas | FE-21 | Terminada |
| 19 | FE-18 | Media | Consultas, caché y paginación | BE-09 | Pendiente |
| 20 | FE-19 | Media | CSP compatible con el cliente | INF-13 | Terminada en alcance verificado; headers HTTP siguen en INF-13 |
| 21 | FE-20 | Baja | Cancelar navegación pendiente al desmontar | — | Terminada |
| 22 | FE-22 | Baja | Cascada CSS de pestañas de acceso | FE-16 | Terminada |

### FE-01 — Unificar el contrato de cuotas de WhatsApp y PWA

- [x] Terminada. Publicada y aceptada el 23/10/2026; ver [validación](VALIDACION_FE_01_02_03.md).
- **Categoría:** Bug. **Problema reproducido:** la PWA supone un padre separado, pero WhatsApp usa la primera cuota confirmada como identificador del grupo. Al editar todo el plan se escribe sobre esa cuota tanto su importe individual como el total, en paralelo. Una fixture de tres cuotas de 100 terminó en 300, 100 y 100; el resultado depende del orden de escritura.
- **Archivos:** src/Dashboard.tsx:817, :824; supabase/migrations/015_allow_multiple_transactions_per_wa_message.sql:184, :186.
- **Trabajo:** definir un contrato único de grupo y distinguir un padre cancelado de una cuota confirmada; no escribir el total sobre una cuota. Revisar planes existentes antes de una migración y no asumir que existen importes dañados en producción. Coordinar la operación atómica de FE-02 y la integridad de propietario de BE-03.
- **Cierre:** edición de planes originados en PWA y WhatsApp conserva la suma, actualiza cada cuota una sola vez y no altera datos de otro cliente; regresión del caso reproducido aprobada.

### FE-02 — Guardar creación y edición de planes de forma atómica

- [x] Terminada. Publicada y aceptada el 23/10/2026; ver [validación](VALIDACION_FE_01_02_03.md).
- **Categoría:** Bug. **Problema reproducido:** las actualizaciones de cuotas y padre son peticiones independientes; Promise.all no es una transacción. Al fallar la segunda cuota de un cambio de 100 a 200, quedaron 200, 100 y 200. En el alta, un fallo del lote deja el padre cancelado sin hijos; la inserción del array de cuotas por sí misma sí es una única operación.
- **Archivos:** src/Dashboard.tsx:612, :653, :831.
- **Trabajo:** definir RPC transaccionales específicas para crear y editar planes, con identidad, suscripción, propietario, entradas validadas y control de versión; devolver el resultado real. Incluir altas, cambios y eliminaciones requeridos en la misma transacción. Reconciliar el estado cliente después del resultado.
- **Cierre:** errores inyectados en cada etapa revierten todos los cambios; no hay padres huérfanos ni cuotas parcialmente modificadas; conflictos concurrentes se informan sin sobrescribir silenciosamente.
- **Relacionado:** principios de BE-10, autorización de BE-01 e integridad de BE-03; pruebas junto con BE-17 y FE-21.

### FE-03 — Preservar campos no modificados y números de cuota

- [x] Terminada. Publicada y aceptada el 23/10/2026; ver [validación](VALIDACION_FE_01_02_03.md).
- **Categoría:** Bug. **Problema reproducido:** aplicar a todas está activado por defecto y copia el importe de la cuota seleccionada a todas. Cambiar solo la descripción de un total de 100 dividido en 33,33 / 33,33 / 33,34 dejó 99,99. Si se eliminó la cuota 2, editar el plan renumera la 3 como 2 y crea otra 3.
- **Archivos:** src/Dashboard.tsx:705, :718, :767, :777, :785.
- **Trabajo:** calcular un patch de los campos efectivamente cambiados; mantener importes y centavos cuando no se editan; distribuir centavos desde un total validado cuando corresponda. Buscar cuotas por ID/número estable, no por índice; agregar, quitar o restaurar cuotas mediante acciones explícitas.
- **Cierre:** editar solo nombre o categoría conserva fechas, cuotas e importes; centavos exactos; una cuota eliminada no reaparece y los números originales no cambian sin solicitud explícita.

### FE-04 — Evitar dobles envíos de movimientos

- [x] Terminada. Publicada en PR #32 y aceptada el 24/10/2026. [Validación](VALIDACION_FE_04_05.md).
- **Categoría:** Bug. **Problema reproducido:** addMovement no tiene exclusión durante el guardado ni clave de idempotencia. Dos envíos antes de terminar la primera petición crearon dos movimientos iguales. El botón solo se deshabilita por falta de categoría.
- **Archivos:** src/Dashboard.tsx:590, :1626.
- **Trabajo:** guardia inmediata mediante ref, estado de envío, botón deshabilitado y feedback visible; reutilizar una clave idempotente del mismo intento en reintentos. Validar y deduplicar esa clave en el servidor, sin bloquear operaciones iguales que el usuario quiera crear por separado.
- **Cierre:** doble clic, Enter repetido y reintento tras respuesta incierta producen una sola operación por intento; fallos permiten reintentar y conservan el formulario.

### FE-05 — Representar carga, error y contexto mensual correctamente

- [x] Terminada. Publicada en PR #32 y aceptada el 24/10/2026. [Validación](VALIDACION_FE_04_05.md).
- **Categoría:** Bug. **Problema confirmado:** errores de movimientos/presupuesto se omiten y se mantiene el estado anterior. Al cambiar de mes y fallar solo una consulta pueden aparecer movimientos del mes anterior bajo el nuevo encabezado. La primera carga fallida puede verse como cero o vacío. El fallback de meses contiene un segundo await sin revalidar el efecto activo.
- **Archivos:** src/Dashboard.tsx:385, :402, :405, :422, :444, :456.
- **Trabajo:** estado de datos identificado por usuario/mes; estados explícitos de carga, vacío y error con reintento. Cancelar consultas o descartar respuestas con generación de solicitud, después de cada await; mantener la exclusión durante todo el fallback y evitar mezclar resultados de cargas distintas.
- **Cierre:** cambios rápidos de mes, desmontaje y respuestas fuera de orden no alteran el contexto nuevo; errores parciales no presentan totales fiables ni saldo cero; recuperación y reintento verificados.

### FE-06 — Extender suscripciones desde el valor actual del servidor

- [x] Corrección terminada. Publicada en PR #34 con 031/032 y verificación técnica el 25/10/2026; alcance y seguimiento histórico separados. [Validación](VALIDACION_FE_06_BE_02.md).
- **Categoría:** Bug. **Problema confirmado en código:** el administrador calcula una fecha absoluta desde el perfil cargado y la escribe sin comprobar modificaciones concurrentes. Dos administradores que agregan 30 días desde la misma fecha producen el mismo vencimiento, perdiendo una extensión; un canje entre apertura y guardado también puede sobrescribirse. No se ejecutaron extensiones reales.
- **Archivos:** src/AdminPanel.tsx:365, :371, :376, :378, :381.
- **Trabajo:** enviar días o cambio explícito de plan a una RPC administrativa autorizada; bloquear el perfil y calcular desde su valor actual, con fecha del servidor. Definir el comportamiento de planes vitalicios y devolver el vencimiento efectivo para el feedback. Coordinar con el trigger de BE-02.
- **Cierre:** extensiones simultáneas y canjes concurrentes conservan todos los días válidos; usuarios no administradores rechazados; resultado mostrado coincide con la base; casos vencidos y vitalicios verificados.

### FE-07 — Actualizar la PWA sin recargar formularios activos

- **Estado al 25/10/2026:** corrección publicada en PR #37, CI y comprobación técnica productiva aprobados. Aviso y bloqueo con borrador sin guardar, navegación, descarte y actualización explícita verificados sin enviar cambios. [Validación y límites](VALIDACION_FE_07_12.md).

- [x] Cierre del flujo protegido: el propietario confirmó borrador conservado al navegar, Actualizar bloqueado, descarte que lo habilita y recarga con sesión en la PWA instalada desde el ícono del iPhone. [Aceptación y límites](VALIDACION_FE_07_12.md). Otras versiones/modos no se presumen probados.
- **Categoría:** Bug. **Problema reproducido:** la primera comprobación detecta escritura, pero el MutationObserver solo verifica ausencia de modal-backdrop. Una mutación del DOM recarga con un input todavía enfocado; eventos repetidos crean varios observadores. Los modales administrativos usan admin-modal-backdrop, otra clase.
- **Archivos:** src/main.tsx:30, :35, :37, :45, :80; src/AdminPanel.tsx:1065.
- **Trabajo:** centralizar la actualización pendiente y mostrar una acción explícita para aplicarla; considerar cambios sin guardar, foco y todos los diálogos mediante estado compartido. Evitar observadores duplicados y limpiar suscripciones; conservar compatibilidad entre versión web, service worker y cachés.
- **Cierre:** actualización durante registro, Ajustes y modales no pierde datos; varios eventos generan un solo aviso; aceptación del usuario aplica la versión y limpia recursos; probar instalación existente y recuperación tras actualización fallida.

### FE-08 — Actualizar dependencias vulnerables del frontend

- [x] Terminada. Validación y detalle en [VALIDACION_FE_08.md](VALIDACION_FE_08.md).
- **Categoría:** Seguridad. **Problema confirmado por npm audit:** tres paquetes de desarrollo con severidad alta: Vite 8.0.13, brace-expansion y source-map-js 1.2.1. Audit de producción reportó cero. El bypass de archivos de Vite en Windows afecta al servidor de desarrollo, no demuestra exposición desde GitHub Pages.
- **Archivos:** package.json:30; package-lock.json:1069, :1385, :2580, :2822.
- **Trabajo:** actualizar a versiones compatibles corregidas y revisar el lockfile; el audit observó Vite 8.3.4 como solución disponible. Verificar avisos vigentes al ejecutar y evitar actualizaciones forzadas sin revisar compatibilidad.
- **Cierre:** audit completo y sin dev, lint, tipos, tests y build repetidos; desarrollo en Windows comprobado; registrar alertas residuales y su alcance si las hubiera.
- **Trabajo compartido:** INF-07; una sola actualización y validación para ambas tareas.

### FE-09 — Sumar las cuotas futuras reales

- **Cierre al 25/10/2026:** PR #39 publicada; [pruebas, criterio de corte, aceptación y límites](VALIDACION_FE_09_11.md). Los archivos/líneas y el problema de la auditoría que siguen son referencias históricas, no una nueva reproducción sobre la versión publicada.

- [x] Terminada en su alcance; PR #39 publicada en 54dce9e, CI/Publicar y comprobación técnica aprobados.
- **Categoría:** Bug. **Problema reproducido:** el total restante usa cantidad por importe de la primera cuota. Para cuota actual de 100 y futuras de 200 y 300 se muestran 200 restantes en vez de 500; redondeos y cuotas eliminadas también invalidan esa fórmula.
- **Archivos:** src/Dashboard.tsx:474, :476, :480, :482, :483.
- **Trabajo:** definir si restantes incluye la cuota del mes y sumar registros activos reales por fecha, grupo y moneda usando centavos. Calcular cantidades desde cuotas existentes, sin reconstruirlas a partir del total original.
- **Cierre:** planes con importes distintos, redondeos, eliminaciones, inicio futuro y mes sin cuota muestran cantidades y totales correctos; ARS y USD separados.

### FE-10 — Alinear el límite de cuotas con el esquema

- [x] Terminada.
- **Cierre al 28/10/2026:** Terminada. Contrato compartido de 2 a 60 cuotas (`MIN_INSTALLMENT_COUNT = 2`, `MAX_INSTALLMENT_COUNT = 60`, `parseInstallmentCountInput`, `isValidInstallmentSchedule`) entre `src/installmentPlans.ts`, `src/pwaEntries.ts` y `src/Dashboard.tsx`; rechazo explícito de valores fuera de rango, decimales o vacíos en alta y edición antes de llamar a la API con mensaje claro en `role="alert"`; pruebas de límites y decimales en `tests/installment-plan-editor.test.ts` y `tests/installments-dashboard-ui.test.ts`. [Validación](VALIDACION_FE_10.md).
- **Avance al 25/10/2026:** 029 y la PR #30 ya incorporaron contrato de 2–60 cuotas; alta y edición muestran ese límite. La incompatibilidad original de 120 es histórica. [Validación relacionada](VALIDACION_FE_01_02_03.md).
- **Categoría:** Bug. **Problema confirmado:** el formulario aceptaba y anunciaba hasta 120 cuotas o truncaba/ajustaba silenciosamente entradas inválidas, mientras transactions.installment_count y los borradores admiten como máximo 60 según las migraciones.
- **Archivos:** src/Dashboard.tsx; src/installmentPlans.ts; src/pwaEntries.ts; supabase/migrations/001_initial.sql:42; supabase/migrations/014_draft_movement_batches.sql:31.
- **Trabajo:** compartir el límite de 60 entre dominio, alta, edición y controles; validar enteros antes de llamar a la API. Si se decide ampliar a 120, cambiar previamente todos los contratos y restricciones mediante una migración aprobada.
- **Cierre:** límites, decimales y entradas inválidas probados en alta y edición; mensaje de validación claro; ningún valor aceptado por el cliente es rechazado por una restricción incompatible.

### FE-11 — Eliminar visualmente un plan por identidad, no por descripción

- **Cierre al 25/10/2026:** PR #39 publicada; [pruebas, criterio de corte, aceptación y límites](VALIDACION_FE_09_11.md). Los archivos/líneas y el problema de la auditoría que siguen son referencias históricas, no una nueva reproducción sobre la versión publicada.

- [x] Terminada en su alcance; PR #39 publicada en 54dce9e, CI/Publicar y comprobación técnica aprobados.
- **Categoría:** Bug. **Problema reproducido:** el filtrado optimista borra de la pantalla todos los planes/movimientos con igual título. Al eliminar un grupo de dos llamados Celular, ambos desaparecen; la base conserva el otro y vuelve al refrescar. No se demostró pérdida del segundo plan en la base.
- **Archivos:** src/Dashboard.tsx:935, :936, :942.
- **Trabajo:** filtrar exclusivamente por grupo/ID; reconciliar la respuesta real y revertir solo la operación fallida, sin sustituir cambios concurrentes con un snapshot viejo.
- **Cierre:** planes homónimos permanecen visibles; error de eliminación restaura únicamente lo afectado; el estado final coincide con el servidor.

### FE-12 — Conservar cambios sin guardar en Ajustes

- **Cierre al 25/10/2026:** PR #37 publicada, 592 pruebas/CI y comprobación productiva sin escrituras aprobados. Cambios remotos, error de guardado y aislamiento entre usuarios cubiertos con datos ficticios; navegación, espera, descarte y bloqueo comprobados también en la PWA publicada. [Alcance y límites](VALIDACION_FE_07_12.md).

- [x] Terminada en su alcance.
- **Categoría:** Bug. **Problema reproducido:** cada objeto nuevo de userProfile vuelve a copiar nombre y apellido al formulario. El refresco cada 30 segundos o al recuperar foco reemplaza lo que el usuario escribió sin guardar.
- **Archivos:** src/Settings.tsx:85, :87, :88; src/App.tsx:110, :128, :129.
- **Trabajo:** separar borrador y perfil remoto; sincronizar solo cuando no hay cambios locales o al cambiar de usuario. Guardar limpia el estado dirty; definir feedback si hubo cambios remotos concurrentes.
- **Cierre:** polling y retorno de foco no reemplazan entradas; cambio de usuario no conserva datos ajenos; guardar/cancelar y errores preservan el comportamiento esperado.

### FE-13 — Descartar respuestas antiguas de validación de invitación

- [x] Terminada.
- **Cierre al 28/10/2026:** Terminada. AbortController para cancelar peticiones HTTP en vuelo, codeState vinculado al código activo, descarte estricto por generación de solicitud y código visible; limpieza al desmontar y al cambiar de pestaña; 18 pruebas en tests/signup-ui.test.ts (1.061 tests pasando en total). [Validación](VALIDACION_FE_13.md).
- **Categoría:** Bug. **Problema reproducido:** cancelar el debounce no cancela consultas iniciadas. La respuesta vieja de un código inválido, llegando después de una válida, dejó inválido el código actual y bloqueó el envío.
- **Archivos:** src/Login.tsx:32, :51, :101, :104, :528.
- **Trabajo:** asociar resultado a código y generación de solicitud; descartar respuestas anteriores; limpiar temporizador e invalidar solicitudes al desmontar o modificar el código. Manejar error de red separadamente de código inválido.
- **Cierre:** respuestas en cualquier orden corresponden siempre al código visible; borrar código y desmontar no actualizan el estado anterior; reintento tras fallo funciona.

### FE-14 — Permitir el zoom del navegador

- [x] Descartada por decisión del propietario (se conserva el bloqueo de zoom para evitar ampliaciones accidentales en móvil).
- **Categoría:** Accesibilidad. **Problema confirmado:** viewport con user-scalable=no y escala máxima/mínima 1; initZoomLock intercepta gestos, rueda y atajos de ampliación. Restringe el uso con baja visión.
- **Archivos:** index.html:5; src/main.tsx:11; src/disableZoom.ts:16, :21, :45, :56.
- **Trabajo:** usar viewport con width=device-width e initial-scale=1 y eliminar bloqueos globales. Resolver gestos específicos de la interfaz sin bloquear ampliación; comprobar texto y controles ampliados.
- **Cierre:** zoom por teclado, navegador y gestos admitidos; al 200 % no se pierde contenido ni funcionalidad; revisar móviles reales y reflow.
- **Referencia:** https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html.

### FE-15 — Centralizar diálogos accesibles y etiquetas de formularios

- [ ] Terminada.
- **Categoría:** Accesibilidad. **Problema observado en código:** modales principales sin gestión completa de foco, confinamiento, Escape y retorno al botón de apertura. El importe del alta tiene un texto visual en span sin label asociado. No se realizó una prueba con lector de pantalla real.
- **Archivos:** src/Dashboard.tsx:1374, :1431, :1457, :1637; src/AdminPanel.tsx:1065, :1172.
- **Trabajo:** componente de diálogo compartido con semántica, título, foco inicial, fondo inerte, cierre y restauración de foco; considerar dialog.showModal o una solución accesible probada. Asociar label/htmlFor e id a controles y errores; agregar foco visible donde se elimina outline.
- **Cierre:** teclado y lector de pantalla recorren solo el diálogo; Escape y cierre devuelven el foco; campos tienen nombres accesibles; cierre con datos sin guardar tiene un comportamiento definido.
- **Referencia:** https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/.

### FE-16 — Corregir el contraste de botones

- [x] Terminada. Validación y detalle en [VALIDACION_FE_16_22.md](VALIDACION_FE_16_22.md).
- **Categoría:** Accesibilidad. **Problema medido:** blanco sobre #20b984 tiene contraste 2,52:1. El navegador confirmó esa combinación en el botón de registro con texto de 16 px; no alcanza 4,5:1 para texto normal ni 3:1 para texto grande.
- **Archivos:** app/globals.css:1; app/forms.css:2.
- **Trabajo:** definir variantes de color accesibles para botones, manteniendo el color de marca donde no afecte legibilidad. Por ejemplo, fondo #047857 con texto blanco; revisar hover, foco, error y estados aplicables.
- **Cierre:** contraste medido sobre colores computados cumple los umbrales aplicables en todas las variantes activas; foco visible y estados distinguibles sin depender únicamente del color.
- **Referencia:** https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html.

### FE-17 — Separar la descarga inicial por pantallas

- [x] Terminada.
- **Cierre al 28/10/2026:** Terminada. Separación de pantallas mediante React.lazy (Dashboard, Settings, AdminPanel, Paywall, Login) con cargador resiliente lazyWithRetry, recuperación protegida ante despliegues nuevos en GitHub Pages y límite de recarga en sessionStorage para prevenir bucles; límites de error accesibles (ScreenErrorBoundary) y avisos de carga (ScreenFallback). JS principal reducido de 873,75 kB a 424,47 kB (-51,4%), gzip de 250,61 kB a 122,46 kB (-51,1%); advertencia de chunks mayores a 500 kB de Vite eliminada; 12 pruebas en tests/lazy-loading.test.ts (1.073 pruebas pasando en total). [Validación](VALIDACION_FE_17.md).
- **Categoría:** Rendimiento. **Problema medido:** imports anticipados de Dashboard, Ajustes y Administración producían un JS principal de 873,75 kB, 250,61 kB gzip. El código de gráficos se incorporaba antes de necesitarlo; Vite advertía un chunk mayor de 500 kB.
- **Archivos:** src/App.tsx; src/lazyWithRetry.tsx; tests/lazy-loading.test.ts.
- **Trabajo:** lazy/dynamic import por pantallas y Suspense con fallback útil; medir qué dependencias quedan en el ingreso. No separar chunks arbitrariamente sin comparar tamaño, peticiones y tiempos; manejar fallo de carga tras un despliegue.
- **Cierre:** registrar tamaños antes/después y reducción de JS inicial; ingreso, navegación y actualización PWA funcionan en red lenta y con fallo de chunk; medir rendimiento en dispositivos representativos.

### FE-18 — Reducir consultas y paginar resultados

- [ ] Terminada.
- **Categoría:** Rendimiento. **Problema confirmado:** siete consultas cada cinco segundos además de Realtime, aproximadamente 84 por minuto por pestaña activa sin contar carga inicial y otros refrescos. Se vuelven a traer cuotas históricas; perfiles y códigos administrativos no se paginan.
- **Archivos:** src/Dashboard.tsx:393, :396, :528, :533; src/AdminPanel.tsx:118, :119.
- **Trabajo:** cachear configuración estable, invalidar por eventos, pausar polling cuando corresponda y acotar consultas. Paginar listados; obtener totales completos en el servidor por moneda. Verificar máximo efectivo de filas de Supabase antes de atribuir truncamiento en producción.
- **Cierre:** medir consultas/bytes antes y después; varias pestañas, red lenta y reconexión mantienen datos actualizados; probar más filas que el límite del servidor sin totales truncados ni elementos inaccesibles.
- **A verificar:** límite productivo de PostgREST; no hubo acceso a esa configuración en la auditoría frontend. Coordinar agregaciones con BE-09 sin mezclar monedas.

### FE-19 — Publicar una CSP compatible con el cliente

- **Estado vigente al 26/10/2026:** FE-19 cerrado en el alcance de compatibilidad probado. Cabeceras HTTP/protección de framing siguen abiertas en INF-13; Safari/CSP/offline no se presentan como cobertura universal. El avance del 23/10 que sigue es histórico.

- **Avance 23/10/2026:** implementación y validación compartidas con INF-13; no se duplica la política. Pendiente de publicación y aceptación productiva. [Validación](VALIDACION_INF_13.md).

- [x] Terminada dentro del alcance verificado al 26/10/2026. CSP publicada, sesión del propietario/gráficos/fuentes/admin/actualización comprobados; Auth/WSS accesibles. [Revalidación](VALIDACION_INF_13.md).
- **Categoría:** Seguridad. **Hallazgo original de la auditoría, resuelto por PR #23 y revalidado:** no hay Content-Security-Policy, variante report-only ni meta CSP. No se encontró una vía de XSS explotable. Las sesiones persistentes de la SPA aumentan el impacto potencial de un script malicioso del mismo origen, pero usar persistencia del SDK no se clasificó por sí solo como vulnerabilidad.
- **Archivos:** index.html:3; src/supabase.ts:7. Parte de la solución corresponde a configuración de hosting sin línea local equivalente.
- **Trabajo:** política ajustada a scripts, estilos, fuentes, Supabase y Realtime; excluir objetos y restringir base-uri. Un punto inicial es script-src 'self'; object-src 'none'; base-uri 'self'. Validar antes de endurecer y documentar directivas que requieren headers.
- **Cierre:** verificar política efectivamente publicada y funcionamiento de autenticación, gráficos, fuentes, PWA y Realtime; sin excepciones amplias injustificadas. frame-ancestors no se resuelve mediante meta.
- **Trabajo compartido:** INF-13; no crear dos políticas contradictorias.

### FE-20 — Cancelar temporizadores de navegación al desmontar

- [x] Terminada. Validación y detalle en [VALIDACION_FE_20.md](VALIDACION_FE_20.md).
- **Categoría:** Bug. **Problema reproducido:** el gesto swipe back programa onBack con setTimeout sin cancelarlo al limpiar el efecto; una fixture invocó la navegación después del desmontaje.
- **Archivos:** src/useSwipeBack.ts:118, :148.
- **Trabajo:** conservar el temporizador en una ref y limpiarlo al desmontar, cancelar el gesto o deshabilitar el hook. Revisar listeners y estado de animación sin interferir con gestos nativos.
- **Cierre:** desmontaje o cancelación durante la animación no llama onBack; gesto legítimo funciona y no acumula callbacks. Compatibilidad con Safari real requiere prueba adicional.

### FE-21 — Probar flujos del cliente y reutilizar el dominio financiero

- **Avance al 25/10/2026:** regresiones y pruebas de navegador incorporadas junto con cuotas, altas/carga mensual y renovaciones (PR #30/#32/#34). El conteo de 26 pruebas de la auditoría inicial es histórico; la última publicación pasó 561. Sigue abierto el alcance transversal, incluidas actualizaciones PWA; el número de pruebas no prueba cobertura completa.

- [ ] Terminada.
- **Categoría:** Mejora. **Problema confirmado:** 26 tests aprobados en entorno Node sin cubrir componentes, formularios, navegación, efectos o service worker. Dashboard contiene lógica financiera propia, por lo que probar helpers similares no asegura ese comportamiento.
- **Archivos:** vitest.config.ts:4; src/Dashboard.tsx:86; package.json:13.
- **Trabajo:** importar una única implementación del dominio; incorporar entorno DOM y pruebas de comportamiento de componentes con peticiones controladas, además de E2E donde aporten valor. Priorizar regresiones de cuotas, errores parciales, duplicados, meses, validación fuera de orden y actualización PWA. Declarar dependencias y ejecutar desde checkout limpio.
- **Cierre:** pruebas fallan ante los defectos originales y pasan con las correcciones; suite incluida en CI; no depender de copias del código ni afirmar cobertura completa por el número de tests.
- **Relacionado:** BE-17 e INF-06. Agregar cada regresión junto con su tarea, no al final del plan.

### FE-22 — Corregir especificidad de pestañas de acceso

- [x] Terminada. Validación y detalle en [VALIDACION_FE_16_22.md](VALIDACION_FE_16_22.md).
- **Categoría:** Bug. **Problema confirmado en navegador:** auth-card button tiene mayor especificidad que auth-tab y sobrescribe su fondo transparente/color. Al seleccionar Crear cuenta, Iniciar sesión inactivo permanece verde con blanco y el activo queda blanco.
- **Archivos:** app/forms.css:2; src/styles.css:2147, :2164.
- **Trabajo:** acotar estilos de botones y dar especificidad coherente a las pestañas, por ejemplo auth-tabs .auth-tab y su variante active; evitar !important como parche general. Revisar representación visual, estado seleccionado y foco.
- **Cierre:** selección y apariencia coinciden en ingreso/registro, móvil/escritorio y navegación por teclado; sin alterar botones de envío; contraste conforme a FE-16.

### Resultados y límites de la auditoría de frontend

- ESLint, TypeScript y build aprobados en una copia temporal; 26 tests aprobados en cinco archivos. Un EPERM del sandbox afectó el primer intento de tests; repetir con permisos adecuados resolvió el problema, sin atribuirlo al proyecto.
- Build: JS 809,54 kB / gzip 231,27 kB; CSS 56,46 kB / gzip 10,68 kB. Advertencia de chunk superior a 500 kB; no se midieron Core Web Vitals de campo.
- npm audit completo: tres paquetes de desarrollo con alertas altas; audit --omit=dev: cero vulnerabilidades reportadas. Revalidar avisos al actualizar y coordinar INF-07.
- Verificación pública sin autenticar: registro a 320 px sin desbordamiento horizontal; contraste insuficiente y conflicto de pestañas confirmados. No se enviaron formularios ni se crearon cuentas.
- No se encontraron dangerouslySetInnerHTML, innerHTML ni enlaces javascript: en el frontend revisado. La clave pública Supabase es publishable, no una credencial privada de servidor; la protección definitiva requiere políticas y RPC del backend.
- No se ejecutaron operaciones con una cuenta autenticada productiva ni escrituras reales. No se verificaron lectores de pantalla, Safari/iPhone real, límites efectivos de filas, equivalencia de migraciones con producción o comportamiento de ataques XSS reales.
- Casos adicionales reproducidos con código real y respuestas simuladas: edición de cuotas de WhatsApp/PWA, centavos, cuota eliminada, fallo parcial, doble envío, planes homónimos, invitación fuera de orden, refresco de Ajustes, callback posterior al desmontaje y recarga PWA durante escritura.
- La auditoría frontend no confirmó hallazgos críticos independientes. Las vulnerabilidades ya documentadas de autorización y RPC del backend continúan siendo dependencias del acceso cliente; ocultar una ruta en React no sustituye autorización del servidor.

## Backend

Auditoría del 13/10/2026 sobre `7b5663f`. Ese commit agrega únicamente el plan; el código del backend corresponde a `3619d86`.

No se aplicaron correcciones. Las pruebas con escrituras se realizaron con datos sintéticos en PostgreSQL aislado; las verificaciones productivas fueron de lectura y metadatos.

### Relación con infraestructura

Cuando una tarea BE e INF comparten implementación, se realizan una sola vez. El mismo cambio y su validación pueden cerrar ambas entradas si cumplen todos sus criterios. No crear migraciones, workers o controles duplicados.

### Orden sugerido

| Orden | ID | Severidad | Tema | Infraestructura relacionada | Estado |
| --- | --- | --- | --- | --- | --- |
| 1 | BE-01 | Crítica | Autorización de RPC privilegiadas | INF-01 | Terminada |
| 2 | BE-03 | Alta | Escrituras y propiedad de datos operativos | INF-02 | Terminada |
| 3 | BE-02 | Alta | Renovaciones bloqueadas por el trigger | — | Corrección terminada; seguimiento histórico abierto |
| 4 | BE-17 | Media | Pruebas del código y esquema reales | INF-06 | En curso; esquema/roles/concurrencia por bloque, alcance global abierto |
| 5 | BE-04 | Alta | Parser determinista e interpretación financiera | — | Terminada en el alcance probado; PR #40/v55 y aceptación WhatsApp |
| 6 | BE-05 | Alta | Detección de consultas comerciales y saldo | — | Terminada en el alcance probado; PR #41/v56 y aceptación verificada |
| 7 | BE-06 | Alta | Cola, orden y concurrencia | INF-03 | Terminada |
| 8 | BE-07 | Alta | Confirmación durante procesamiento | INF-03, INF-04 | Terminada en su alcance; 033/PR #42 publicadas y verificadas |
| 9 | BE-10 | Alta | Errores, transacciones y entrega de respuestas | INF-04 | Terminada |
| 10 | BE-08 | Alta | Movimientos incompletos y dudas | — | Terminada en su alcance; 034/PR #43/v58 y aceptación WhatsApp verificadas |
| 11 | BE-09 | Alta | Saldo por moneda y límites mensuales | — | Terminada en su alcance; 036/PR #48/v60 y aceptación verificadas |
| 12 | BE-11 | Media | Listas antiguas, excedentes y numeración | INF-03 | Terminada en alcance probado; 038/PR #50/v62 y aceptación |
| 13 | BE-12 | Media | Correcciones y resumen completo | — | Terminada en alcance probado; 037/PR #49/v61 y aceptación |
| 14 | BE-13 | Media | Consistencia del alta y bootstrap administrativo | INF-10 | Pendiente |
| 15 | BE-14 | Media | Vinculación atómica y límites de intentos | — | Terminada |
| 16 | BE-15 | Media | Integraciones y límites de multimedia | INF-12 | Terminada |
| 17 | BE-16 | Media | Logs y errores seguros | INF-09, INF-14 | Terminada |
| 18 | BE-18 | Baja | Separación del código y llamadas remotas | — | Pendiente |

Las pruebas de BE-17 deben agregarse junto con cada corrección, empezando por las renovaciones y la autorización. Su posición no implica postergar los cierres críticos hasta completar todo el sistema de pruebas.

### BE-01 — Autorizar las RPC privilegiadas

- [x] Terminada.
- **Cierre al 14/10/2026:** Terminada. Migración 017 aplicada; ACL, HTTP y SQL con ROLLBACK verificados. Prueba WhatsApp del usuario corroborada en la base: un movimiento de prueba de 100 ARS confirmado, ninguno del concepto descartado y cero ítems de prueba pendientes. Webhook v36 sin redespliegue. La publicación Git se consulta en el historial del repositorio. [Procedimiento](VALIDACION_INF_01_BE_01.md) y [evidencia](evidencias/INF_01_BE_01_2026-10-14.json).
- **Problema confirmado:** `get_active_draft_group`, `confirm_draft_group` y `discard_draft_group` permiten ejecución anónima, aceptan el usuario por parámetro y no comprueban su identidad. Sus propietarios productivos tienen BYPASSRLS. La fixture permitió lectura y confirmación de un grupo ajeno como anon.
- **Archivos:** `supabase/migrations/014_draft_movement_batches.sql:366`, `:311`; `supabase/migrations/015_allow_multiple_transactions_per_wa_message.sql:33`.
- **Trabajo:** restringir las RPC al backend o validar identidad y permisos cuando requieran acceso cliente. Revocar también PUBLIC; comprobar la exposición por PostgREST y revisar las demás funciones SECURITY DEFINER.
- **Cierre:** llamadas anónimas y entre usuarios rechazadas; acceso legítimo del bot verificado; no consultar ni modificar datos ajenos reales para probar el arreglo.
- **Trabajo compartido:** INF-01; registrar una sola migración y validación para ambas tareas.

### BE-02 — Corregir renovaciones y activaciones bloqueadas por el trigger

- [x] Corrección terminada. Publicada en PR #34 con 031/032 y verificación técnica el 25/10/2026; alcance y seguimiento histórico separados. [Validación](VALIDACION_FE_06_BE_02.md).
- **Problema reproducido:** el trigger de perfiles conserva estado y vencimiento del cliente incluso durante un canje autorizado. La RPC devuelve éxito y consume el código, pero no renueva. También ocurre con un usuario pending_code.
- **Archivos:** `supabase/migrations/016_add_name_fields_to_profiles.sql:23`; `supabase/migrations/013_secure_subscription_renewals.sql:47`.
- **Trabajo:** separar la edición de nombres de las operaciones autorizadas de suscripción y administración. Rediseñar privilegios y trigger sin permitir que clientes modifiquen campos protegidos. No usar current_user=postgres como autorización dentro de un trigger SECURITY DEFINER. Incorporar regresiones con todas las migraciones relevantes.
- **Cierre:** el vencimiento y estado persistidos coinciden con lo devuelto; cliente vigente conserva días y suma la renovación; pendiente y vencido se activan; suspendido no se reactiva; códigos se consumen solo con un cambio legítimo completado; actualización directa de campos protegidos rechazada.
- **Seguimiento de datos:** verificar si hubo códigos reales consumidos sin renovación; no asumir que existen ni reasignarlos sin reconciliar evidencia.

### BE-03 — Proteger escrituras y relaciones de propietario

- [x] Terminada.
- **Estado al 14/10/2026:** Terminada. Migraciones 018 y 019 aplicadas; PWA con RPC publicada antes de cerrar escrituras. 106 tests, lint, tipos, build, permisos, cuatro FK, diez llamadas HTTP y SQL con 24 rechazos y ROLLBACK aprobados. Prueba real del usuario y consulta agregada de solo lectura: vínculo activo y código consumido; gasto de 100 ARS guardado una sola vez; gasto temporal descartado sin guardarse; cero ítems pendientes de prueba. Webhook v36 sin redespliegue. El modo instalado standalone no se comprobó. [Procedimiento](VALIDACION_INF_02_BE_03.md) y [evidencia](evidencias/INF_02_BE_03_2026-10-14.json).
- **Problema reproducido:** un cliente puede modificar tablas operativas, activar su vínculo con un teléfono no asignado sin prueba de control e insertar un ítem propio en un grupo ajeno. La unicidad impide asignar un teléfono ya ocupado; no se demostró ese caso de toma de vínculo.
- **Archivos:** `supabase/migrations/001_initial.sql:93`; `supabase/migrations/014_draft_movement_batches.sql:73`, `:78`, `:83`.
- **Trabajo:** reservar las escrituras operativas al backend; crear una RPC limitada para generar códigos; activar el vínculo exclusivamente tras validación del webhook. Garantizar propietario de grupo e ítem mediante integridad relacional y revisar relaciones de categorías y cuotas entre clientes.
- **Cierre:** escrituras cliente no autorizadas rechazadas; teléfono no activable directamente; relaciones entre propietarios distintos rechazadas por la base; generación y uso legítimo del código funcionan.
- **Trabajo compartido:** INF-02; coordinar vinculación con BE-14.

### BE-04 — Corregir el parser determinista

- **Publicación al 25/10/2026:** PR #40/e311db4 y webhook v55 ACTIVE; cuatro controles y Publicar aprobados, esquema 032 y cola conservados, fuente descargada coincidente y protecciones 401 verificadas. [Detalle del despliegue](VALIDACION_BE_04.md). El propietario aceptó $123 / «Colectivo 60» y descarte con CANCELAR. Cerrado en el alcance probado; la preparación siguiente es registro histórico.

- **Avance al 25/10/2026:** revisión completada y tres fallos adicionales reproducidos/corregidos: referencias numéricas como fechas, monedas ajenas convertidas localmente y números finales del concepto eliminados. 675 pruebas, 40 Deno de rutas, tipos/lint/build, SQL y guards locales aprobados. Suite completa Deno pendiente de CI Linux por límite de caché Windows. [Validación y puesta en marcha](VALIDACION_BE_04.md). Sin desplegar ni cambiar datos.

- **Reanudación al 25/10/2026:** primer punto propuesto tras el cierre FE-07/09/11. Leer la versión actual y revalidar las regresiones previas; no repetir correcciones ya presentes ni asumir que todos los ejemplos originales siguen fallando. Registrar pruebas y alcance antes de declarar el cierre integral.

- **Registro histórico de preparación del 20/10/2026 (correcciones presentes en main; estado cloud no revisado en este bloque):** corregidos millones, centavos y centenas habladas sin truncar expresiones; residuos numéricos se derivan completos y no entran al concepto como si el importe fuera válido. Regresiones de dominio y del procesador real con red denegada. Publicación pendiente de CI; BE-04 conserva sus demás criterios abiertos. [Detalle](CORRECCION_IMPORTES_HABLADOS_2026-10-20.md).

- [x] Terminada en el alcance probado; límites de IA y otros bloques conservados.
- **Problema reproducido en funciones reales:** `Gasté 10000,50 en supermercado` genera dos gastos; `Cobré 80000 por diseño` se interpreta como gasto; `Compré iPhone 15 por 1200000` usa 15 como importe; cuotas y fechas explícitas se ignoran; una parte incomprensible puede perderse si otra se interpreta.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:200`, `:206`, `:260`, `:262`, `:270`, `:752`.
- **Trabajo:** limitar la vía rápida a formatos inequívocos; no separar por comas decimales; reconocer ingresos con acentos; distinguir importes de números de producto, transporte, fechas y cuotas. Interpretar todas las partes o derivar el mensaje completo al extractor. Conservar números identificadores en las descripciones.
- **Cierre:** regresiones con los ejemplos anteriores, ARS/USD, miles y centavos, múltiples operaciones, fechas, cuotas y partes incompletas; ninguna cifra o tipo cambiado silenciosamente. Las pruebas importan el código real.

### BE-05 — Evitar que consultas intercepten operaciones válidas

- **Cierre al 25/10/2026:** PR #41/cb2cef5 y v56 publicadas; 723 pruebas y CI, carga consistente, aclaración mixta, resumen/cancelación y consultas individuales de soporte/saldo verificadas. Un intento por consulta, sin ítems ni transacciones nuevas y cero grupos abiertos en la cuenta. [Evidencia, tiempos y límites](VALIDACION_BE_05.md). Los estados pendientes siguientes son históricos.

- **Publicación al 25/10/2026:** PR #41/cb2cef5 y webhook v56 ACTIVE; CI completo/Pages, equivalencia de 17 módulos, protecciones 401 y esquema/cola/cron verificados. Sin SQL, secretos o modelos nuevos. Aceptación WhatsApp pendiente; la preparación siguiente es histórica. [Evidencia](VALIDACION_BE_05.md).

- **Preparación al 25/10/2026:** seis variantes desviadas reproducidas en el clasificador anterior y mensajes mixtos sin decisión local segura. El candidato reutiliza el parser real para propuestas abreviadas, reconoce ingresos omitidos y pide separar consultas/operaciones sin tocar el borrador. Preserva consultas explícitas con cifras, comandos, correcciones y multimedia. Pruebas de procesador sin red y preservación SQL real; publicación y aceptación pendientes. [Validación y límites](VALIDACION_BE_05.md). El avance de v39 siguiente es histórico.

- **Avance al 15/10/2026:** Webhook v39 publicado tras el fallo detectado por el propietario al probar INF-03/BE-06. Transferencias y operaciones realizadas ya no activan soporte o saldo; corregidos separadores e ingresos con tilde. 151 tests y nueve Deno aprobados. Prueba WhatsApp pendiente; BE-05 permanece en curso. [Corrección y alcance](CORRECCION_BE_05_2026-10-15.md).

- [x] Terminada en el alcance probado.
- **Problema reproducido:** gastos e ingresos por transferencia, gastos de suscripción y pagos con la palabra saldo son clasificados como consultas; terminan sin incorporarse al borrador.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:551`, `:601`.
- **Trabajo:** distinguir una consulta comercial completa de una operación realizada. Revisar mensajes mixtos, captions y multimedia; ante ambigüedad conservar los pendientes y pedir aclaración.
- **Cierre:** `Pagué 15000 por transferencia al supermercado`, `Cobré 80000 por transferencia`, `Gasté 5000 en la suscripción de Netflix` y `Pagué 5000 del saldo de la tarjeta` se registran como propuestas; consultas reales de renovación y saldo mantienen su respuesta.

### BE-06 — Serializar mensajes y mutaciones de borradores

- [x] Terminada.
- **Cierre al 15/10/2026:** trabajo compartido con INF-03 cerrado con las pruebas automáticas y concurrentes y la aceptación manual del propietario; lectura agregada sin pendientes ni confirmados de prueba. Persisten las limitaciones y tareas relacionadas indicadas en la [evidencia](evidencias/INF_03_BE_06_aceptacion_2026-10-15.json). INF-04/BE-10 y demás entradas conservan su propio alcance.

- **Problema confirmado:** debounce que marca mensajes procesados sin interpretarlos; ausencia de exclusión duradera por usuario; posibilidad de grupos abiertos múltiples y posiciones concurrentes. La fixture aceptó dos grupos abiertos del mismo usuario.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:733`, `:742`, `:841`, `:852`, `:889`.
- **Trabajo:** cola durable, lease por usuario, recuperación y orden definido; creación de grupo y reserva de posiciones atómicas. Persistir todos los mensajes de todas las entradas y cambios del payload: readMessages en la línea 62 solo recorre el primer entry/change. Definir deduplicación por mensaje y posición de operación.
- **Cierre:** payloads múltiples, ráfagas, mensajes fuera de orden, trabajadores simultáneos y reiniciados conservan cada operación; un grupo activo por usuario; ningún pendiente queda oculto por grupos duplicados.
- **Trabajo compartido:** INF-03; coordinar BE-07, BE-10 e INF-14.

### BE-07 — Confirmar únicamente la versión revisada por el cliente

- **Cierre al 26/10/2026:** 033 aplicada y registrada antes de publicar PR #42/1688c7b. 735 pruebas, controles/Pages y PostgreSQL concurrente aprobados; definición completa/atributos productivos coincidentes, esquema 033, cola/cron saludables, PWA SHA/SW/CSP y Edge v56 conservados. Caso de 25 horas probado en base descartable; sin nuevos ensayos financieros en cuentas reales. [Evidencia y límites](VALIDACION_BE_07.md). Los estados pendientes siguientes son históricos.

- **Preparación al 26/10/2026:** 020/023 ya protegen grupos cerrados, versiones, exclusión y guardado atómico. Se reprodujo un caso restante: CONFIRMAR retenido por antigüedad conservaba contexto al RETOMAR y guardaba sin nuevo resumen. 033 exige revisión durable vigente y anula la autorización de mensajes liberados de stale; sin modificar filas al migrar ni cambiar runtime Edge. 735 pruebas, tipos/lint/build, 12 SQL y seis guards aprobados; PostgreSQL concurrente y ensayo completo pendientes de CI. [Validación y publicación](VALIDACION_BE_07.md). El problema y líneas siguientes son el registro histórico de auditoría.

- [x] Terminada en el alcance probado.
- **Problema reproducido:** después de confirmar, la base admite un nuevo ítem pendiente en ese grupo cerrado; no aparece al consultar el borrador activo. CONFIRMAR no pasa por la misma cola y la versión usada no representa necesariamente el último resumen mostrado.
- **Archivos:** `supabase/functions/whatsapp-webhook/index.ts:643`, `:657`, `:889`; `supabase/migrations/015_allow_multiple_transactions_per_wa_message.sql:49`.
- **Trabajo:** bloquear el grupo en toda mutación; exigir estado abierto; registrar versión mostrada y contexto de confirmación al recibir el mensaje. Si hay procesamiento anterior o lista modificada, solicitar revisión y una nueva confirmación. Revalidar usuario y suscripción al guardar.
- **Cierre:** confirmaciones adelantadas, doble confirmación, respuestas de resumen fallidas y movimientos concurrentes no guardan datos no revisados ni dejan ítems pendientes en grupos cerrados. Un fallo SQL no guarda parcialmente.
- **Trabajo compartido:** INF-03 e INF-04; depende del diseño de BE-06 y BE-10.

### BE-08 — Conservar operaciones incompletas y dudas

- [x] Terminada en el alcance probado.
- **Revalidación al 26/10/2026:** 020/023 ya conservan missing_fields y confianza cero. El fallo vigente era rechazar toda extracción parcial válida y exigir amount/occurred_on no nulos; la fecha desconocida también se sustituía por hoy. No se presume que sigan abiertos todos los defectos históricos.
- **Publicado al 26/10/2026:** PR #43/bd896f0, puente v57, 034 y webhook v58 ACTIVE. 781 pruebas, CI/Pages completo, definiciones/permisos, historial, código Edge y salud verificados. Aceptación del propietario verificada: completo/incompleto, completar el 2, resumen nuevo y descarte; cero transacciones nuevas y cero pendientes. Cerrada en su alcance. [Detalle y límites](VALIDACION_BE_08.md).
- **Archivos:** `supabase/functions/whatsapp-webhook/index.ts:830`, `:889`, `:901`; `supabase/migrations/014_draft_movement_batches.sql:27`.
- **Trabajo:** adaptar esquema y dominio para borradores incompletos; persistir dudas y confianza; distinguir agregar, corregir y completar. Validar respuestas del extractor en runtime y evitar que una instrucción ambigua modifique la lista.
- **Cierre:** completos e incompletos conviven sin pérdidas; se solicita el dato faltante; no se guarda el grupo hasta completar o quitar el ítem; valores predeterminados se aplican solo cuando corresponde; confianza cero se conserva.

### BE-09 — Calcular saldos por moneda y con fechas válidas

- [x] Terminada en el alcance probado. **Publicada y aceptada el 27/10/2026:** 036/PR #48/v60; 871 Vitest, 75 rutas Deno y cinco controles de main aprobados. Consulta del propietario enviada en 5,122 s; contenido coincide con SQL, cero IA, movimientos nuevos o trabajos propios pendientes. [Validación](VALIDACION_BE_09.md).
- **Revalidación vigente:** el bot ya separa monedas, usa límite mensual exclusivo y detecta errores; seguían vigentes descarga sin paginar/sumas Number y mezcla de monedas en monthly_summary. Se reprodujo la mezcla en la función real antes de 036; el límite de filas se prueba en API local, sin presumir el max_rows alojado.
- **Archivos:** `supabase/functions/whatsapp-webhook/index.ts:614`, `:618`, `:633`; `supabase/migrations/001_initial.sql:114`.
- **Trabajo:** agregación SQL por moneda, límite mensual exclusivo en el primer día del mes siguiente, manejo de errores y centavos. Evitar depender de transferir todas las filas; verificar el límite efectivo de PostgREST.
- **Cierre:** ARS/USD separados; febrero, años bisiestos y meses de 30 días correctos; resultados completos para volúmenes superiores al límite de filas; errores no se informan como saldo cero.

### BE-10 — Garantizar escrituras atómicas y respuestas recuperables

- [x] Terminada.
- **Cierre al 15/10/2026:** migración 023 aplicada; 173 tests, diez escenarios de fallo aislados, build, lint y PostgreSQL nativo concurrente aprobados. El propietario confirmó el guardado y la segunda confirmación sin duplicados. Lectura agregada: un único gasto de prueba de 1 ARS, cero pendientes de esa prueba y cero trabajos v2 fallidos o en procesamiento. Se mantiene documentada la posible repetición del texto si Meta lo acepta y falla su registro local. [Aceptación](evidencias/INF_04_BE_10_aceptacion_2026-10-15.json) y [procedimiento](VALIDACION_INF_04_BE_10.md).

- **Problema confirmado:** escrituras sin comprobar error o filas afectadas; borradores parcialmente insertados; reenvíos fallidos omitidos como duplicados; HTTP 200 tras fallos y ausencia de outbox luego de guardar.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:452`, `:648`, `:666`, `:824`, `:889`, `:927`, `:944`.
- **Trabajo:** aplicar el resultado completo de un mensaje mediante una RPC transaccional; comprobar errores; separar estados de recepción, interpretación, guardado y envío. Crear respuestas pendientes en la misma transacción del guardado y reintentar su entrega de forma independiente.
- **Cierre:** errores inyectados no dejan resultados parciales ni anuncios falsos; reenvíos y doble confirmación no duplican movimientos; fallos después del guardado recuperan la respuesta sin guardar otra vez. Documentar límites de entrega exactamente una vez con el proveedor.
- **Compatibilidad adicional:** revisar la rama de transacciones antiguas en la línea 648: confirma directamente y no expande cuotas. La auditoría no encontró pendientes antiguos con cuotas, pero ese camino debe probarse o migrarse al modelo de borrador.
- **Trabajo compartido:** INF-04; coordinar BE-06 y BE-07.

### BE-11 — Retener mensajes ante listas antiguas o falta de capacidad

- **Cierre del 28/10/2026:** PR #50 / 0cc65d9 / 038 / v62 publicados y aceptados. Siete mensajes reales de prueba: 20 + uno retenido, alias, numeración estable y cancelación; cero IA, fallos técnicos, movimientos guardados, grupos abiertos o trabajos propios pendientes. [Validación](VALIDACION_BE_11.md) y [evidencia](evidencias/BE_11_CIERRE_2026-10-28.json). Los registros de preparación siguientes son históricos.

- **Implementación preparada el 28/10/2026:** 038, comandos de resolución coherentes, mensajes >20 sin espera imposible y contador de capacidad independiente del presupuesto de fallos. 996 Vitest/83 Deno locales aprobados. Se preservan los avances de listas antiguas y numeración; CI completo/publicación/aceptación pendientes. [Validación](VALIDACION_BE_11.md). Las notas de revalidación/propuesta siguientes registran el punto de partida.

- **Revalidación del 28/10/2026, sobre esquema 037:** ya se retiene el mensaje nuevo ante una lista antigua y se recupera al resolverla; CANCELAR en ese caso descarta la lista anterior y permite procesar el audio nuevo. También se cuentan operaciones activas y las eliminaciones permiten posiciones superiores a 20 sin renumerar. Cinco regresiones existentes de SQL real aprobaron en PGlite aislado. No se presentan esos defectos históricos como si siguieran todos vigentes.
- **Pendiente reproducido:** el parser acepta `ver lista`, `sacame el 2`, `borralo` y `¡sí!`, pero next_whatsapp_job no los admite detrás de un mensaje waiting. Los comandos canónicos sí pasan. La prueba usa fixtures, sin producción ni IA. [Diagnóstico](evidencias/BE_11_REVALIDACION_2026-10-28.json).
- **Diferencia actual de contratos:** processor.ts rechaza explícitamente un único mensaje de más de 20 y pide dividirlo, mientras apply_whatsapp_job conserva un add de más de 20 en waiting/capacity. Esa segunda ruta nunca cabe en una lista de 20. Hay que unificar ambas sin crear un bloqueo permanente; no se encontró ni se presume una pérdida real de movimientos de clientes.
- **Propuesta para implementar:** (1) alinear comandos/normalización entre parser, next y due, conservando autorización, lease y revisión antes de confirmar; (2) si la lista tiene 18 y llega un mensaje con tres operaciones, retener las tres juntas y retomarlas en orden después de liberar capacidad o confirmar las anteriores; (3) si un solo mensaje trae más de 20, rechazar el alta completa con cantidad/límite/instrucción de división claros, conservar el original para diagnóstico y permitir seguir usando el bot; no partirlo ni guardar los primeros 20 automáticamente; (4) probar RETOMAR/DESCARTAR, varios retenidos, reenvíos, reinicios y numeración con huecos. Nada se guarda sin CONFIRMAR sobre un resumen vigente.
- **Estado de esa revisión inicial:** propuesta documentada antes de implementar; reemplazado por la preparación 038 registrada arriba. Producción continúa en 037/v61 hasta autorización/publicación. Los párrafos siguientes conservan el historial de la auditoría y no reemplazan esta revalidación.

- **Seguimiento de audio 16/10/2026:** la prueba nueva confirmó 503 en ambos modelos. Se implementa pedido de texto inmediato tras agotar los dos modelos, con checkpoint persistente y sin reintentos de IA en la cola. Flash Lite primero; medios con 10 s por intento. No se crean movimientos del audio fallido. Ver [validación](VALIDACION_FALLBACK_TEXTO.md). Webhook v43 publicado y smoke 401 aprobado; cuatro checks CI aprobados, 198 Vitest y 21 Deno. Prueba real aprobada: respuesta al audio en 3,55 s, un solo gasto confirmado de ARS 123 desde el texto y cero desde el audio, sin mensajes bloqueados. Gemini sigue devolviendo 503; INF-11 es el siguiente punto.

- **Incidente 16/10/2026:** CANCELAR ante una lista de más de 24 h se retenía junto con el audio nuevo. Corrección 025 y diagnóstico seguro de preparación implementados; 197 tests + 17 Deno aprobados. 025 aplicada y webhook v42 activo tras cuatro checks aprobados; pendiente prueba de audio con diagnóstico nuevo. El alcance general de BE-11 sigue abierto. [Detalle](VALIDACION_AUDIO_LISTA_ANTIGUA.md).

- [x] Terminada en el alcance publicado y probado el 28/10/2026.
- **Hallazgo original de la auditoría (ver revalidación vigente arriba):** el gasto nuevo que llega con una lista antigua no queda retenido para retomarlo; los excedentes no tienen transición de recuperación. El límite depende de la posición máxima incluyendo eliminados, no de la cantidad activa.
- **Archivos:** `supabase/functions/whatsapp-webhook/index.ts:588`, `:863`; `supabase/migrations/014_draft_movement_batches.sql:24`.
- **Trabajo:** conservar el mensaje hasta RETOMAR/DESCARTAR o liberar capacidad; no truncar un mensaje parcialmente. Mantener números estables sin limitar su identificador histórico a 20; contar operaciones activas bajo bloqueo. Definir qué hacer si un único mensaje supera 20.
- **Cierre:** retomar o descartar conserva el gasto nuevo; excedentes explicados y recuperables; eliminaciones liberan capacidad sin renumerar; el usuario puede resolver mensajes mayores de 20 sin pérdida silenciosa.
- **Trabajo compartido:** INF-03; depende de BE-06 y BE-08.

### BE-12 — Completar correcciones y datos del resumen

- **Cierre 28/10/2026:** PR #49 / 1e45c94 / 037 / v61 publicados y aceptados por el propietario. Cinco ediciones, rechazos y cancelación verificados, sin movimientos de prueba guardados ni IA en correcciones. [Validación](VALIDACION_BE_12.md) y [evidencia](evidencias/BE_12_CIERRE_2026-10-28.json). Los avances siguientes son históricos.

- **Revalidación 27/10/2026:** BE-08 ya muestra moneda, fecha y mes inicial de cuotas. Se trabaja en ediciones locales versionadas de todos los campos, validación de categoría y cambios atómicos; BE-11 no se da por cerrado. 037 y cambios de webhook preparados; 939 Vitest y 80 rutas Deno aprobados localmente. CI completo/publicación/aceptación pendientes. [Contrato, pruebas y límites](VALIDACION_BE_12.md).

- **Avance al 20/10/2026 — ahorro de IA:** comandos ampliados, aclaración de correcciones sin IA y gramática conservadora para textos simples/listas mixtas, fechas y cuotas con total explícito. Tests importan el parser real; métricas permitidas sin contenido. 306 Vitest, 35 Deno sin red, tipos/lint/build aprobados. Publicado: PR 13, commit ce216ec, webhook v45 ACTIVE; cuatro checks CI aprobados, base 025 y cola habilitada. Aceptación WhatsApp verificada (5 mensajes en 0,65–2,27 s, `local_rule` en movimientos/corrección/comandos y cero `ai_attempt`); no cierra los otros campos de BE-12, BE-08 ni INF-12. [Reglas y validación](REGLAS_LOCALES_WHATSAPP.md).

- **Avance al 15/10/2026:** durante la prueba INF-03 se detectó una corrección convertida en un gasto nuevo. Webhook v40 interpreta correcciones explícitas de importe sin IA y bloquea altas desde instrucciones de edición. 163 tests y 12 Deno aprobados. Pendiente repetir WhatsApp y completar los demás campos de BE-12. [Detalle y validación](CORRECCION_PENDIENTES_2026-10-15.md).

- [x] Terminada en el alcance publicado y probado el 28/10/2026.
- **Hallazgo histórico resuelto en el alcance de BE-12:** categoría declarada en la edición pero no aplicada; no se verifica existencia/estado del objetivo; una actualización sin filas puede anunciar éxito. El resumen omite fecha y mes inicial de cuotas; el contrato de edición no representa moneda, fecha ni cuotas.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:818`, `:821`, `:828`, `:405`.
- **Trabajo:** contrato validado para campos corregibles; verificar objetivo pendiente y pertenencia; aplicar todos los cambios de forma atómica y devolver el resultado real. Mostrar moneda, fecha y cuotas relevantes para revisar.
- **Cierre:** posiciones inexistentes, quitadas y ajenas rechazadas sin modificar otros pendientes; importe, concepto, categoría, moneda, fecha y cuotas corregidos según el contrato; resumen coincide con lo guardado.

### BE-13 — Hacer consistente el alta de usuarios

- **Alcance acordado el 28/10/2026:** consistencia del alta, invitación, fallos y reintentos. Administrador inicial excluido expresamente; Thomas sigue siendo el único administrador y no se promueven ni modifican roles existentes. 039 no reescribe migraciones aplicadas ni repara cuentas. [Preparación y límites](VALIDACION_BE_13.md).

- [x] Terminada. Migración 039 aplicada y publicada en PR #51; ver [VALIDACION_BE_13.md](VALIDACION_BE_13.md).
- **Problema reproducido:** bootstrap_user captura cualquier excepción y permite persistir el usuario de Auth sin perfil ni configuración. La migración inicial 005 promueve a todos los usuarios existentes a administrador; su adecuación al procedimiento de instalación queda a verificar.
- **Archivos:** `supabase/migrations/016_add_name_fields_to_profiles.sql:114`; `supabase/migrations/005_admin_and_invitations.sql:194`.
- **Trabajo en el alcance vigente:** alta atómica, errores saneados y reintento explícito; diagnóstico de cuentas existentes de solo lectura. Administrador inicial fuera de este bloque por decisión del propietario; la observación histórica de 005 se conserva documentada y no se ejecuta sobre producción.
- **Cierre del alcance vigente:** fallos inyectados sin cuentas incompletas ni códigos consumidos parcialmente; alta legítima, concurrencia y reintentos correctos; roles actuales intactos. Administrador inicial excluido, no declarado resuelto. Publicación y verificación productiva pendientes.
- **Relacionado:** INF-10; validar junto con BE-02 y BE-17.

### BE-14 — Hacer atómica la vinculación y limitar intentos

- [x] Terminada.
- **Cierre al 28/10/2026:** Terminada. Migración 040 aplicada; vinculación atómica con protección contra fuerza bruta por teléfono (bloqueo tras 5 intentos fallidos), actualización inmediata de worker state y perfiles, check_invitation_code con rate limiting (15 intentos/minuto) y mensajes uniformes sin enumeración; verificación de expiración estricta en servidor (clock_timestamp()) en altas, renovaciones y consultas. 1,051 tests aprobados en 46 suites, 12 pruebas SQL y guardas de release. [Procedimiento](VALIDACION_BE_14.md).
- **Problema confirmado en código:** búsqueda y consumo del código separados de las escrituras de vinculación; sin bloqueo de fila ni límites propios de intentos. No se ejecutó fuerza bruta real; los límites externos quedan a verificar.
- **Archivos:** `supabase/functions/whatsapp-webhook/index.ts:465`, `:467`, `:471`; `supabase/migrations/005_admin_and_invitations.sql:73`.
- **Trabajo:** bloquear y consumir el código, desvincular y reasignar en una transacción; definir límites por teléfono y para consultas de invitación; vencimiento calculado en servidor; errores seguros sin revelar información innecesaria.
- **Cierre:** dos usos concurrentes no generan doble vinculación exitosa; fallos intermedios revierten el cambio; códigos vencidos y límites de intentos comprobados; uso legítimo no bloqueado indebidamente.
- **Dependencias:** BE-03; coordinar generación segura del código.

### BE-15 — Acotar llamadas externas y procesamiento multimedia

- **Cierre al 20/10/2026:** cerrado junto con INF-12 (validación runtime de esquema, presupuestos compartidos de red/trabajo, normalización de montos hablados y aceptación de multimedia en WhatsApp con Groq `whisper-large-v3-turbo` + `qwen/qwen3.8-27b`). [Detalle](VALIDACION_INF_12.md).

- [x] Terminada.
- **Problema confirmado:** envío/descarga de WhatsApp sin timeout explícito ni límite propio de bytes; Gemini solo tiene timeout por intento. No se confirmó SSRF: la URL de descarga viene de Meta, no directamente del cliente.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:86`, `:131`, `:139`, `:336`.
- **Trabajo:** presupuesto total del trabajo; límites de tamaño y MIME; descargas acotadas; reintentos selectivos y backoff para errores transitorios. Validar el contrato de proveedores y las respuestas JSON en runtime; comprobar disponibilidad de modelos sin suponer nombres válidos o inválidos.
- **Cierre:** fallos, respuestas incompletas, archivos grandes y proveedores lentos no agotan memoria ni invocaciones; fallback y recuperación probados; no se descartan operaciones por un error transitorio.
- **Trabajo compartido:** INF-12; coordinar BE-08 y BE-10.

### BE-16 — Separar errores de negocio, persistencia y envío

- [x] Terminada.
- **Cierre al 28/10/2026:** Terminada. Migración 041 con mensajes de negocio limpios y sanitización de excepciones en confirm_draft_group y discard_draft_group; fail_whatsapp_job registra QUEUE_SEND_RETRY en whatsapp_message_queue e inbound_events si effect_applied es true; queue.ts asigna stage "send" sin reinterpretar ante fallos de entrega; helpers.ts traslada API key de Gemini a header x-goog-api-key; 7 pruebas en tests/safe-errors.test.ts (1,058 tests pasando en total). [Validación](VALIDACION_BE_16.md).
- **Problema confirmado:** logs con mensajes financieros, teléfonos y respuestas crudas; errores SQL enviados al usuario y avisos que pueden confundir fallo de interpretación con fallo de entrega.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:97`, `:349`, `:375`, `:662`, `:926`.
- **Trabajo:** códigos y eventos estructurados; mensajes públicos seguros y específicos; correlación que no exponga datos personales; tiempos y cantidades de operaciones/reintentos. Evitar registrar URLs que contengan credenciales.
- **Cierre:** casos de éxito y error sin textos, comprobantes, teléfonos ni secretos en logs; diagnóstico posible; un guardado exitoso seguido de fallo de envío no se informa como interpretación fallida.
- **Trabajo compartido:** INF-09 e INF-14; coordinar BE-10.

### BE-17 — Probar el código real y las migraciones combinadas

- **Avance al 25/10/2026:** PGlite declarado en dependencias, regresiones SQL con migraciones relevantes/roles y carreras PostgreSQL en CI para los bloques publicados. FE-06/BE-02 cubre expresamente el trigger 016 y 031/032. La descripción inicial no implica ausencia actual de esas pruebas; revisar lo que falta por dominio y handler antes de cerrar BE-17. [Último bloque verificado](VALIDACION_FE_06_BE_02.md).

- [ ] Terminada.
- **Problema confirmado:** tests con copias del parser/formateador y pruebas SQL que no incluyen el trigger de 016. PGlite depende de una instalación manual ignorada; npm test no ejecuta esa integración. Lint y build principales excluyen el webhook.
- **Archivos:** `tests/deterministic-parser.test.ts:3`; `tests/draft-batches.test.ts:14`; `tests/renewals.integration.mjs:22`; `tsconfig.json:16`; `eslint.config.mjs:6`.
- **Trabajo:** extraer e importar funciones reales; declarar dependencias de pruebas; ejecutar esquema y migraciones relevantes juntos. Agregar pruebas del handler, roles, entradas múltiples, cuotas, monedas, concurrencia, reenvíos, fallos de envío y procesamiento interrumpido. Configurar Deno check/lint conforme a las convenciones de Supabase.
- **Cierre:** validaciones reproducibles desde checkout limpio; regresiones fallan sobre el comportamiento anterior y pasan con la corrección; no dependen de copias divergentes del código. No atribuir cobertura total a tests unitarios parciales.
- **Trabajo compartido:** INF-06; acompañar cada tarea de mayor prioridad con sus regresiones.

### BE-18 — Separar responsabilidades y reducir llamadas remotas

- [ ] Terminada.
- **Mejora observada:** handler de unas 945 líneas, confirmación/cancelación duplicadas y una escritura remota por movimiento. No se midió un cuello de botella productivo.
- **Archivo:** `supabase/functions/whatsapp-webhook/index.ts:413`, `:654`, `:788`, `:877`.
- **Trabajo:** separar dominio puro, integraciones, repositorio transaccional y recepción/worker; unificar comandos; reducir escrituras mediante RPC o lotes sin sacrificar atomicidad. Revisar índices y consultas usando mediciones, no suposiciones.
- **Cierre:** comportamiento y permisos preservados por regresiones; módulos testeables; llamadas y latencia comparadas para lotes; cambios de rendimiento respaldados por evidencia.
- **Dependencias:** diseño fiable de BE-06, BE-07 y BE-10; pruebas de BE-17.

### Resultados y límites de la auditoría de backend

- npm test: 26 pruebas aprobadas; lint y build principales aprobados, pero excluyen el webhook.
- Deno check del webhook: aprobado. Deno lint: tres problemas (import prefijado y dos usos de any); ajustar reglas y tipos sin tratar una convención de import como fallo de despliegue.
- Integración existente: inicialmente falla por dependencia PGlite ausente; con dependencia provisionada solo en la copia temporal, 12 escenarios aprobados. No carga las migraciones combinadas que reproducen BE-02.
- Las pruebas adicionales ejecutaron funciones reales y SQL aislado. La confirmación SQL revirtió sus inserciones ante un error interno; eso no resuelve las carreras ni la persistencia parcial de borradores.
- npm audit completo: tres paquetes de desarrollo con alertas altas; audit sin dev: cero vulnerabilidades reportadas. No se realizó un escaneo independiente del bundle npm resuelto por Deno. Coordinar actualizaciones con INF-07.
- Historial Git: 282 blobs de texto revisados, sin credenciales privadas reconocibles. Búsqueda por patrones, no garantía absoluta.
- No se verificaron contenido exacto del bundle Edge, disponibilidad/comportamiento real de Gemini con credenciales productivas, entrega real de multimedia/WhatsApp, implementación interna de Auth, logs históricos de CI ni límites externos y máximo efectivo de filas de PostgREST.
- No se enviaron mensajes reales ni se ejecutaron RPC productivas de escritura. Una prueba anónima de la RPC de lectura usó un UUID ficticio inexistente.

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
| 14/10/2026 | INF-01 / BE-01 | Migración 017 y regresiones; consultar historial Git | 49 tests, lint, tipos, build, ACL, HTTP, SQL con ROLLBACK y WhatsApp | Supabase 017; webhook v36 sin cambios | INF-02 / BE-03 y demás tareas abiertas |
| 14/10/2026 | INF-02 / BE-03 | Migraciones 018/019, RPC y cliente b7ff5cf; evidencia técnica 5c41e42 | 106 tests, lint, tipos, build, ACL, HTTP, SQL con ROLLBACK y prueba real de vinculación/confirmación/descarte corroborada por agregados | Supabase 018/019; PWA con RPC; webhook v36 sin cambios | BE-02, BE-14, INF-08 y demás tareas abiertas |
| 15/10/2026 | INF-08 | Preparación revertida por decisión del propietario; pendiente para el final del plan completo | Se retiran únicamente archivos de INF-08; sin cambios en app, webhook ni migraciones | Sin backups productivos habilitados | Retomar desde inventario y credenciales cuando se priorice nuevamente |

| 15/10/2026 | INF-03 / BE-06 | Cola durable, leases con fencing, cron y transporte privado; webhook v38; migraciones 020–022 | 136 tests, 3 Deno y concurrencia nativa; HTTP y cron verificados | Cola habilitada; una propuesta heredada trasladada sin confirmar; 52 confirmados intactos | Prueba WhatsApp del propietario; ocho mensajes antiguos conservados para revisión; INF-04 y demás tareas siguen abiertas |

| 15/10/2026 | BE-05 relacionado con INF-03 / BE-06 | Corrección del clasificador y parser mixto; webhook v39 | 151 tests, nueve Deno, tipos, lint y build aprobados | Sin migraciones ni reenvíos automáticos de mensajes anteriores | Propietario debe reenviar el mensaje y verificar los tres movimientos; aceptación de cola sigue pendiente |

| 15/10/2026 | BE-12 / INF-03 / BE-06 | Webhook v40: corrección de importe por número y rechazo de altas falsas | 163 tests, 12 Deno, tipos, lint y build; edición SQL aislada sin inserciones | Sin migraciones ni cambios directos en la lista del propietario | Repetir corrección y completar aceptación WhatsApp; INF-04 todavía pendiente |

| 15/10/2026 | Cierre INF-03 / BE-06 | Webhook v40, migraciones 020–022 y correcciones documentadas | 163 tests, 12 Deno, concurrencia nativa; capturas y confirmación del propietario; cero pendientes y confirmados de prueba en consulta agregada | Sin nuevo deploy ni escrituras productivas en el cierre | INF-04 / BE-10 siguiente; revisión autorizada de ocho heredados; otros puntos abiertos |

| 15/10/2026 | INF-04 / BE-10 | Migración 023: estados de entrega idempotentes; sin redespliegue de webhook v40 | 173 tests, diez ensayos nuevos, lint, tipos, build y concurrencia nativa | 023 aplicada; ACL y cola activa verificadas; sin fallos simulados en producción | Prueba normal del propietario para cerrar; límites de respuestas repetidas documentados |

| 15/10/2026 | Cierre INF-04 / BE-10 | Migración 023 y evidencia de aceptación; sin cambios de código o deploy en este cierre | Propietario confirma prueba correcta; un único gasto de prueba de 1 ARS y cero pendientes; cola v2 sin fallos ni procesamiento | Lectura agregada sin modificar datos | INF-05 siguiente; resto de auditoría abierto; backups al final |

| 15/10/2026 | INF-05 | TLS obligatorio y allowlist de dos /32 propias; script manual y runbook de recuperación por HTTPS | Protocolos sin credenciales, denegación de red, CA/hostname, salud HTTP/SQL/cron | Configuración aplicada sin addon ni cambios de app/bot/migraciones | Prueba normal del propietario; ruta directa no disponible desde esta red; IPs dinámicas se actualizan por control HTTPS |

| 16/10/2026 | Cierre INF-05 | TLS obligatorio y tres /32 SQL observadas; ruta nativa admitida por pooler IPv4 | DNS A/AAAA, IPv6 ENETUNREACH sin ruta, denegación antes de autorizar /32, ambos poolers con TLS verificado, salud SQL/cron/HTTP y aceptación del propietario | Sin cambios de datos, contraseñas, facturación ni deploys; TLS/autenticación directa IPv6 no ensayados | INF-06 siguiente; reevaluar IPv6 solo si se incorpora un consumidor directo |

| 16/10/2026 | INF-06 | CI para PR/main y protección real de main | Checkout limpio: 173 tests, 12 SQL, tipos/lint/build; 12 Deno sin red; actionlint; CI inicial aprobado; ensayo fallido bloqueó PR sin publicar | Publicación de Pages depende de tres checks; sin secretos productivos ni deploy del webhook | Integrar solo revisión final aprobada; INF-07 siguiente |

| 16/10/2026 | INF-07 | Parche Vite y transitivas; audit obligatorio en Frontend | Audit completo/producción sin alertas; 173 tests, 12 SQL, tipos/lint/build; smoke Windows con rechazo ADS; CI y actionlint aprobados | Sin dependencias productivas, datos, migraciones ni webhook modificados | Integrar solo revisión aprobada y verificar Pages; INF-09 siguiente; backups al final |

| 16/10/2026 | INF-09 | Logger permitido, no-console y advertencia SQL privada; 024 + webhook v41 | 185 tests, 13 Deno, 12 SQL, tipos/lint/build y CI nativo; 401 sintéticos, dos logs HTTP saneados, cola/cron sanos | Sin altas fallidas, mensajes reales, purgas ni datos financieros modificados; límites de históricos/plataforma explícitos | Integrar revisión documental aprobada; INF-10 siguiente; BE-13 e INF-14 abiertos |

| 16/10/2026 | INF-10 | Entornos explícitos, CLI 2.120.0 y runbook SQL/Edge/Pages con rollback compatible | 190 Vitest + seis controles Node, 12 SQL, lint/tipos/build; ensayo Supabase local completo 38932608913 | 24 migraciones reproducidas; rollback conserva registro sintético; sin SQL ni webhook productivos modificados | Integrar con cuatro checks aprobados; INF-11 siguiente; backups al final |

| 16/10/2026 | Incidente BE-11 / diagnóstico INF-14 | CANCELAR resuelve la lista antigua conservando el mensaje nuevo; errores técnicos permitidos por proveedor | Regresión reproducida; 197 Vitest, 17 Deno, 12 SQL, seis controles Node, tipos/lint/build | Sin reprocesar audios cancelados, guardar movimientos ni cambiar modelos/timeouts | 025 + webhook v42 publicados y verificados; integrar revisión documental tras CI y validar audio nuevo; INF-11 después |

| 18/10/2026 | INF-11 | Actions por SHA verificado, build solo lectura, publicación aislada y Dependabot semanal | actionlint/YAML, cuatro checks PR, cinco jobs main y HTTP de versión | Publicación c227cf3 verificada; bot y SQL sin cambios en este punto | Terminada; INF-12 siguiente; PR de actualizaciones de Dependabot pendiente de revisión |

| 20/10/2026 | BE-12 (reglas locales WhatsApp) | Gramática local conservadora, comandos y correcciones sin IA; PR 13 (ce216ec), webhook v45 ACTIVE | 306 Vitest, 35 Deno sin red, cuatro checks PR y aceptación real en WhatsApp (5 mensajes en 0,65–2,27 s, local_rule y cero ai_attempt) | Sin SQL nuevo ni transacciones de prueba creadas | Resto de campos de edición/resumen de BE-12 y BE-08 siguen abiertos |

| 20/10/2026 | INF-12 / BE-15 | Integración Groq Free (whisper-large-v3-turbo + normalización de montos hablados + reglas locales previas + qwen/qwen3.8-27b con esquema estricto y cupo compartido) | 306 Vitest, 38 Deno sin red, 12 SQL, seis controles Node, cuatro checks CI, smoke 401 y aceptación WhatsApp (imagen 3,11 s, audio 2,32 s + CANCELAR) | Webhook ACTIVE desplegado desde checkout limpio; cero transacciones creadas | Terminada; rotar clave beta antes del 27/10 y continuar con INF-14 / BE-16 |

| 23/10/2026 | INF-13 / FE-19 | CSP única en build y meta no-referrer; solo scripts propios y orígenes exactos | 459 tests, lint/tipos/build; copia ficticia con gráficos, administrador, SW, fuentes y bloqueos CSP; Auth health 200/WSS real sin datos | Preparado en rama; sin publicación, SQL ni webhook nuevos | CI/publicación y aceptación; headers exclusivos del hosting abiertos; INF-15 siguiente, retención sin aprobar y backups al final |

| 23/10/2026 | Cierre FE-01 / FE-02 / FE-03 | Migración 029 y PR #30 (d8aaacd); aceptación delegada por el propietario | 490 Vitest, 12 SQL, seis controles de release, lint/tipos/build, concurrencia PostgreSQL y CI main; PWA con alta de 100, renombrado, eliminación de cuota 2, reedición y limpieza | Fuente/funciones/ACL verificadas; cero cuotas ficticias activas; compras anteriores visibles | FE-04/FE-05 siguiente; FE-09 y seguimiento FE-11 abiertos; backups al final |

| 24/10/2026 | Preparación FE-04 / FE-05 | Migración 030 y PWA en rama de revisión; sin cambios en producción | Pruebas SQL/cliente/carga y navegador con datos ficticios; ver validación del bloque | Recuperación tras respuesta perdida y recarga sin duplicar; error parcial oculta totales; reintento del mes correcto | CI y aprobación de 030/publicación; aceptación real pendiente; FE-06/BE-02 después |

| 24/10/2026 | Publicación FE-04 / FE-05 | 030 aplicada/registrada; PR #32 integrada, d0cf7e5 publicada | 531 Vitest, SQL/guards, cuatro controles y Pages aprobados; SHA/SW/bundle comprobados; smoke autenticado con rollback; apertura del formulario sin guardar | Código/historial/ACL verificados; llamadas sin sesión rechazadas; cero recibos del ensayo; cola habilitada | Aceptación final de alta/recarga en PWA publicada pendiente; FE-06/BE-02 siguiente; FE-09 abierto |

| 24/10/2026 | Cierre FE-04 / FE-05 | PWA d0cf7e5 y 030; aceptación delegada por el propietario | Doble clic y recarga inmediata; recuperación del mismo formulario, dos comprobaciones, una copia y un recibo; cambios rápidos noviembre/diciembre/octubre | Gasto ficticio cancelado de forma reversible, cero activos y cero pendientes; recibo conservado y reintento no recrea; bot activo | FE-06/BE-02 siguiente; FE-09, compatibilidad física y límites de sesión siguen abiertos |

| 24/10/2026 | Preparación FE-06 / BE-02 | 031, RPC administrativa, rol acotado y cliente persistente; sin cambios productivos | 560 Vitest, lint/tipos/build, 12 SQL y seis controles; navegador ficticio con 20+15+30 y respuesta perdida/recarga | 65 días conservados, un recibo por intención; pausa/vitalicio/autorización y reversión ante fallos probados | CI y autorización de 031/publicación; aceptación y revisión histórica pendientes |

| 25/10/2026 | Publicación FE-06 / BE-02 | PR #34 edb051b; 031 y corrección 032 aplicadas y registradas | 561 tests, cuatro controles + Pages; SQL authenticated con usuario ficticio y rollback; ACL/SHA/SW/bundle; apertura modal sin enviar | Corrección de identidad auth validada; cero datos de prueba persistidos; revisión histórica agregada sin cambios | Código usado sin usuario: seguimiento sin causa atribuible; no hubo extensión de clientes reales en la PWA |

| 25/10/2026 | Revisión del plan | Estados vigentes y secuencia FE-07/FE-12, FE-09/FE-11, backend e infraestructura; avances parciales de CSP, límite de cuotas y pruebas reconciliados | Lectura de main 14e1cac, cierres y código; revisión documental, sin nuevas pruebas funcionales | Sin publicación, cambios de aplicación, SQL, cloud ni datos | Elegir el siguiente bloque; retención desactivada y backups al final |

| 25/10/2026 | Preparación FE-07 / FE-12 | Aviso explícito, guardias compartidas, SW compatible y borrador de perfil por sesión | Regresiones reales y navegador con dos versiones/datos ficticios; ver validación del bloque | Sin cambios productivos; no hay migración ni webhook nuevos | CI, revisión, publicación y aceptación física/productiva pendientes |

| 25/10/2026 | Publicación FE-07 / FE-12 | PR #37, 15269ba; aviso explícito y borrador por sesión | 592 pruebas, cuatro controles + Publicar; SHA/SW/bundle/CSP; borrador productivo sin enviar, navegación/espera/descarte/actualización | PWA publicada; sin cambios SQL/webhook/IA ni datos productivos | FE-12 terminado; seguimiento físico FE-07 abierto; siguiente FE-09 + aceptación FE-11 |

| 25/10/2026 | Preparación FE-09 / aceptación ficticia FE-11 | Suma y conteo de filas existentes, corte explícito, monedas e identidad; lectura paginada sin subtotales | 628 Vitest, lint/tipos/build, 12 SQL, seis guards y navegador con SQL descartable/trigger fallido/reintento | Sin datos ni configuración productivos; sin migración/webhook/IA | CI, revisión y publicación pendientes; Safari/iPhone físico abierto; siguiente revisión del bot BE-04/05/07/08 |

| 25/10/2026 | Seguimiento físico parcial FE-07 | El propietario informó aviso de actualización y recarga al tocar en iPhone | Evidencia manual comunicada por el propietario; no ejecución directa de Codex | Sin cambios de aplicación ni datos | Falta probar borrador sin guardar en el dispositivo y precisar navegador/modo instalado; FE-09/11 sigue preparado sin publicar |

| 25/10/2026 | Publicación FE-09/FE-11 y aceptación FE-07 en iPhone | PR #39, 54dce9e; actualización de Pesito instalado desde el ícono del iPhone | 628 pruebas, CI/Publicar, SHA/SW/bundle/CSP; propietario confirma bloqueo con borrador, navegación, descarte y recarga con sesión | Sin migración/webhook ni compras reales de prueba; nombres de prueba sin guardar | FE-09/11 y flujo FE-07 cerrados en su alcance; siguiente revisión incremental BE-04/05/07/08 con BE-12/17; backups al final |

| 25/10/2026 | Actualización documental del plan | Reconciliados cierres FE-07/09/11, publicación PR #39 y aceptación en PWA instalada en iPhone | Revisión del plan y evidencias ya registradas; sin nuevas pruebas funcionales | Solo documentación local; sin commit/push ni nuevo despliegue en esta actualización | Primer paso propuesto BE-04: revalidar parser y regresiones; luego BE-05, BE-07 y BE-08 según dependencias |

| 25/10/2026 | Preparación incremental BE-04 | Guardas de contexto de fechas/monedas y limpiador compartido que conserva identificadores; prompt alineado | 675 Vitest, 40 rutas Deno sin red, check/lint/build, 12 SQL y seis guards; suite Deno de endpoints pendiente de CI por caché Windows | Sin IA ni mensajes reales, migraciones o despliegue; cierres anteriores preservados | Revisar CI/PR y autorizar publicación antes de aceptación; BE-05/07/08 continúan separados |

| 25/10/2026 | Publicación BE-04 | PR #40, e311db4; whatsapp-webhook v54 → v55 ACTIVE | CI completo/Pages, fuente coincidente, smoke 401, esquema 032/cola/cron conservados, SHA/SW/CSP PWA | Sin migración, secretos/modelos nuevos, IA real, reenvíos ni movimientos de prueba; rollback v54 conservado | Aceptación WhatsApp pendiente; después BE-05; backups al final y retención desactivada |

| 25/10/2026 | Aceptación BE-04 | Propietario confirma $123 / «Colectivo 60» y descarte con CANCELAR | Ensayo manual sobre v55, sumado a regresiones/CI ya registrados | Sin nueva lectura SQL, despliegue o mensaje del agente | BE-04 cerrado en el alcance probado; siguiente BE-05 |

| 25/10/2026 | Preparación BE-05 | Ruteo de propuestas/consultas y aclaración conservadora de mezclas; sin cambios SQL | Regresiones de clasificador/procesador y preservación SQL, ver VALIDACION_BE_05.md | Sin IA real, mensajes externos ni cambios productivos | CI/revisión y publicación autorizada antes de aceptación WhatsApp; después BE-07 |

| 25/10/2026 | Publicación BE-05 | PR #41, cb2cef5; whatsapp-webhook v55 → v56 ACTIVE | 723 pruebas, CI completo/Pages, 17 módulos coincidentes, smoke 401, esquema/cola/cron conservados, PWA SHA/SW/CSP | Sin migraciones, secretos/modelos nuevos, IA real, reenvíos ni movimientos ficticios | Aceptación WhatsApp pendiente; después BE-07; backups al final y retención desactivada |

| 25/10/2026 | Aceptación parcial BE-05 | Cinco mensajes propios, carga consistente, aclaración mixta, resumen y cancelación; consulta final combinó alias/saldo | Un intento cada uno, 531–3307 ms; un ítem descartado, cero grupos abiertos y cero transacciones nuevas en la cuenta | Lectura acotada a cuenta identificada; sin IA ni mensajes del agente | Enviar soporte y saldo por separado antes de cerrar BE-05 y seguir con BE-07 |

| 25/10/2026 | Cierre BE-05 | Consultas de alias y saldo ejecutadas separadamente por el propietario y verificadas | Respuestas correctas, un intento, 1692/3388 ms; sin ítems, pendientes ni transacciones nuevos | Lectura restringida a la cuenta de prueba; sin cambios productivos ni mensajes del agente | Revisar BE-07; BE-08 separado; retención desactivada y backups al final |

| 26/10/2026 | Preparación BE-07 | Migración 033: confirmación retenida exige nueva revisión al RETOMAR; guard de estado mostrado vigente | Dos fallos reproducidos antes de corregir; 735 Vitest, tipos/lint/build, 12 SQL y seis guards locales aprobados | Sin producción, datos de clientes ni proveedores reales; sin cambio de runtime Edge | CI PostgreSQL/instalación/rollback y aprobación de 033/publicación; después BE-08 |

| 26/10/2026 | Publicación y cierre BE-07 | Migración 033 y PR #42/1688c7b; Edge v56 conservado | 735 pruebas, CI/Pages y concurrencia nativa; función completa/ACL e historial coincidentes; salud y PWA comprobados | Sin cambios financieros, secretos, proveedores o reenvíos; caso antiguo ensayado en SQL descartable | Revisar BE-08 por separado; retención desactivada y backups al final |

| 26/10/2026 | Preparación BE-08 | 034, normalización compartida, datos faltantes por posición y lector/rollback nullable | 781 Vitest, 53 Deno routing sin red, tipos/lint/build, 12 SQL y seis guards locales aprobados; concurrencia/ensayo completo pendientes CI | Sin producción, IA real ni mensajes a clientes; 033/v56 conservados | CI del SHA final, aprobación del puente + 034 + webhook y aceptación; retención apagada y backups al final |

| 26/10/2026 | CI BE-08 | PR #43, candidato funcional 4f83c07 | Cuatro controles aprobados en run 40396083121; PostgreSQL 17.11 concurrente, 34 migraciones y lectores/runtime/PWA candidato + rollback | Sin producción ni proveedores reales; cambio documental posterior vuelve a CI | Autorizar puente compatible + 034 + webhook y acordar aceptación WhatsApp |

| 26/10/2026 | Publicación BE-08 | PR #43/bd896f0; puente v57 → 034 → webhook v58 ACTIVE | 781 pruebas, cuatro controles y Pages, funciones/ACL/historial completos, 20 módulos Edge, smoke 401, salud y PWA verificados | Sin datos financieros de prueba, IA real, reenvíos ni cambios de proveedores; cola habilitada | Aceptación WhatsApp del propietario con incompleto/completado y CANCELAR; backups al final y retención desactivada |

| 26/10/2026 | Cierre BE-08 | Prueba propia de completos/incompletos, completar por posición y cancelar | 22:18–22:19 Argentina; $101 intacto, segundo de NULL a $202, grupo descartado, un intento por mensaje y cero transacciones/grupos abiertos/trabajos nuevos sin terminar | Lectura acotada al fixture/cuenta; sin envíos ni cambios productivos del agente | Infraestructura pendiente según secuencia; BE-12/17 separados, backups al final y retención desactivada |

| 26/10/2026 | Inicio INF-15 | Revisión solo lectura de Groq/Supabase/Meta, runbook y snapshot saneado, deprecación documental de flags heredados | Free y cupos efectivos confirmados; 56 rutas Deno, tipos/lint; tres regresiones de 429/503/checkpoint y ausencia de plantillas | Sin claves, facturación, SQL/runtime ni mensajes reales nuevos; cierre BE-08 subido en PR #44 | CI y revisión de preparación; INF-15 general abierto para alcance de controles globales/alertas; integrar main requiere aprobación explícita |

| 26/10/2026 | INF-15, cupo compartido preparado | Reserva SQL por trabajo/intento/carril, 100/200 al día Argentina; panel 75%/90% y vías locales disponibles | 800 Vitest, 70 rutas Deno, 12 SQL, seis guardas, tipos/lint/build | Sin publicación 035/Edge/PWA ni cambios de facturación | CI final y autorización/aceptación; INF-13/FE-19 revalidados a continuación; backups al final |

| 26/10/2026 | Revalidación INF-13 / cierre FE-19 | CSP/no-referrer vigentes en 0d2d561; sesión, gráficos, fuentes, administración y actualización verificadas; Auth 200 y WSS abierto | Cero escrituras financieras, mensajes o cambios de hosting | FE-19 cerrado dentro del alcance; INF-13 parcial por headers HTTP/framing | Preparar evaluación de hosting gratuito con vista previa antes de cambiar URL/PWA; backups al final |

| 27/10/2026 | Cierre INF-15 | 035, PR #46/ebdd6ee y v59 publicados; aceptación texto/audio/foto | Cinco controles y 800 pruebas; contadores 1/100 y 1/200; tres grupos descartados | Sin transacciones de prueba, duplicados o trabajos pendientes | INF-14 retención preparado; INF-13 parcial, backups al final |

| 27/10/2026 | Preparación INF-14 | Política existente 30/90 revalidada; consulta de estimación y activación con guardas, sin ejecutar en cloud | 819 Vitest, 12 SQL, seis guardas y cuatro checks de 5a007c4; PostgreSQL SKIP LOCKED, preservación financiera/deduplicación/cupos y stack aislado | Retención false; 0 mensajes/métricas/avisos elegibles al leer; sin cambios productivos | Integrar preparación y decidir explícitamente activación; INF-13 después, backups al final |

| 27/10/2026 | Reordenamiento solicitado por el propietario | Hosting/INF-13 postergado hasta finalizar la funcionalidad; backups siguen al final | Cambio documental; sin implementación ni despliegue | PR #47 publicada, retención false; CSP vigente conservada | Revalidar BE-09 como siguiente bloque funcional antes de corregir |

| 27/10/2026 | Preparación BE-09 | 036 y agregación SQL por cuenta/moneda/mes, presupuesto ARS consistente y centavos exactos; legacy ARS con firma conservada | 871 Vitest, 75 Deno, lint/tipos/build, 12 SQL y seis guardas locales | Sin migración, webhook ni datos productivos nuevos | CI/API local y aprobación de publicación; hosting y backups al final, retención apagada |

| 28/10/2026 | Preparación BE-13 | 039, alta PWA, errores seguros y pruebas de fallos/reintentos | 1036 Vitest, lint/tipos/build, 12 SQL y seis guards locales; concurrencia/Auth real preparados para CI | Consulta agregada sin cambios: 4 cuentas completas, un admin Thomas; administrador inicial excluido | Completar CI y pedir autorización específica de SQL/PWA; hosting/backups al final, retención false |
