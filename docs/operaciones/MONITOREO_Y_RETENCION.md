# Monitoreo del bot y conservación de contenido (INF-14 / BE-16)

## Estado vigente — 27/10/2026

Panel y avisos publicados y aceptados. Retención **desactivada**; propuesta 30/90 revalidada sobre 035/v59, con pruebas aisladas y estimación productiva de solo lectura. Hoy: 0 mensajes, 0 métricas y 0 avisos elegibles. Preparar/subir pruebas o documentación no autoriza borrar datos ni habilitar la limpieza. [Validación INF-14](../planes/VALIDACION_INF_14_RETENCION.md).

## Alcance y responsable

Responsable: propietario de Pesito, con su cuenta administradora y WhatsApp vinculado. El panel **Estado del bot** se actualiza cada 30 segundos mientras está visible. Un cron revisa los incidentes cada minuto. La cola sigue siendo la fuente durable; las métricas son agregados de intentos y su persistencia es de mejor esfuerzo. Una interrupción puede perder muestras, nunca debe reabrir un movimiento por un error de telemetría.

## Señales y respuesta

| Señal | Umbral | Acción del operador |
| --- | --- | --- |
| Cola demorada | Trabajo v2 ejecutable recibido hace más de 2 min | Comprobar cron, versión Edge, disponibilidad de DB y Meta; revisar intentos antes de reactivar trabajos. |
| Fallos repetidos | Trabajo v2 ejecutable con 3 o más intentos | Identificar etapa/código seguro en logs; corregir credenciales/disponibilidad. No repetir una entrega incierta. |
| Revisión manual | Uno o más mensajes v2 en revisión | Revisar el caso por el procedimiento autorizado. No reproducir audios ni crear movimientos sin confirmación. |
| Varios pedidos de texto | 3 o más pedidos de texto en aproximadamente 15 min | Revisar descarga e interpretación. Es una señal de degradación o ambigüedad, no prueba por sí sola una caída de IA. |
| Recuperación sin señal | Cola habilitada y cron inactivo o sin ejecución SQL exitosa en 3 min | Revisar pg_cron, dispatch y transporte. Éxito SQL del cron no garantiza que Meta haya respondido. |

Las esperas por listas antiguas/capacidad no se consideran bloqueos de infraestructura. La revisión manual no frena los mensajes nuevos. Marcar una alerta como revisada silencia el incidente actual; no cancela ni confirma gastos. Un conjunto nuevo de trabajos, o una reaparición, vuelve a abrir la alerta.

## Avisos al WhatsApp del propietario

El propietario solicitó panel y WhatsApp y confirmó que sigue usando el número de prueba de Meta. El destino se obtiene de su vínculo activo y se vuelve a validar que sea administrador. El panel permite activar/desactivar los avisos propios. No se guardan teléfonos ni cuerpos en la bandeja de avisos: solo destinatario interno, etiquetas técnicas, conteos y estados.

Se agrupan incidentes, con al menos 30 min entre avisos nuevos. Un fallo definitivo admite hasta 3 intentos separados por 15 min. Un timeout después de iniciar el envío, un registro de resultado perdido o un lease vencido quedan **inciertos** y no se repiten automáticamente. Un envío aceptado por Meta no demuestra entrega o lectura. La concurrencia se controla mediante locks, token de intento y bandeja separada de los movimientos.

Para mantener esta función limitada a la prueba sin contratar servicios:

- Se debe registrar explícitamente el emisor de prueba aprobado. El patrón de teléfono por sí solo no demuestra el estado de prueba; se combina con la confirmación del propietario y la comparación con el emisor real de Meta.
- Antes de cada aviso el runtime consulta el número asociado a su PHONE_NUMBER_ID y debe coincidir exactamente con el aprobado. Si cambia, se bloquea el aviso. No se habilitan plantillas pagas.
- Solo se prepara/envía dentro de las 23 h 55 min siguientes a un mensaje entrante auténtico del propietario. Se usa el timestamp de Meta, no la recepción tardía del webhook. Fuera de la ventana, quedan las alertas del panel: el propietario puede escribir RESUMEN para reabrirla.
- La FAQ oficial consultada el 22/10/2026 indica que desde el 01/10/2026 los números comerciales tienen 1.000 mensajes de servicio gratuitos por mes y cobro posterior: https://whatsappbusiness.com/resources/faq/ . Por eso una ventana de 24 h no se trata como garantía general de costo cero. Pasar a un número propio requiere revisar INF-15 antes de habilitar estos avisos.

No hay una garantía de notificación externa si caen simultáneamente Supabase, cron o Meta: el aviso depende de esos servicios. El panel advierte si no hay revisión reciente, siempre que pueda consultar la base. No se contrató un monitor externo ni se alteró facturación.

## Métricas y privacidad

Se agregan por minuto tiempos de cola, interpretación, envío y trabajador; operaciones interpretadas, intentos/reintentos y pedidos de texto. El panel muestra promedios, máximos y muestras de las últimas 24 h. No equivalen a cantidad de transacciones confirmadas. Buffer máximo: 256 eventos por lote; el descarte de telemetría se registra sin contenido.

Las tablas internas tienen RLS y no admiten acceso directo de clientes ni service_role. Solo el backend ejecuta las RPC de métricas/entregas. Las RPC de panel/configuración/revisión requieren sesión y rol admin; los clientes no acceden al monitoreo global. Mantenimiento y limpieza son privados para el dueño SQL/cron. Los logs propios usan una lista de campos permitidos, sin cuerpos, comprobantes, teléfonos, tokens ni errores crudos. La retención de logs administrados por Supabase/GitHub es independiente (ver INF-09).

## Conservación propuesta: preparada, desactivada

**No activar sin aprobación expresa del propietario.** La migración instala el mecanismo con retention_enabled=false. Ejecutarlo así devuelve cero y no borra nada.

Propuesta: después de 30 días desde su procesamiento, retirar contenido de mensajes v2 terminados (payload de texto/media, interpretación, respuesta y error). Conservar identificadores de deduplicación, origen/tipo, estado, intentos y trazabilidad. No modificar movimientos financieros ni borradores; proteger mensajes ligados a listas abiertas/ítems pendientes o transacciones pendientes, además de mensajes no terminados, revisión manual y cola heredada v1. Cada ejecución redacta como máximo 500 mensajes, omitiendo filas bloqueadas. Ese límite **no** se aplica a los DELETE de métricas/avisos: se retiran los elegibles de más de 90 días en esa ejecución. Medir esos conteos antes de activar; no afirmar que el total de filas afectadas esté limitado a 500.

Solo si se aprueba y activa esta política, retirar también métricas agregadas y avisos enviados/cancelados de más de 90 días. Los avisos fallidos/inciertos se conservan para investigar. El cron horario se prepara a minuto 17; no hay eliminación efectiva mientras la bandera esté desactivada. No es un backup ni una política integral de borrado de datos personales.

## Publicación original de 027 — registro histórico

Las instrucciones y el rollback de esta sección describen 027/v52; **no usar ese commit con el esquema/cupo vigente**. El contrato actual exige 035 y el rollback d62f42a de config/environments.json.

1. Validar CI: Frontend, Webhook, PostgreSQL y Ensayo de release. Todos los fallos se simulan con datos ficticios y sin Meta/IA reales.
2. Aplicar 027 atómicamente sobre 026, verificar permisos y cron, manteniendo avisos y limpieza desactivados.
3. Publicar el webhook y la PWA de este mismo candidato. El rollback de aplicación es 23dbe9eaca2828fadd793845cc27b240d530b07c, compatible con 026/027; no retirar tablas ni ejecutar down/reset.
4. Para habilitar avisos autorizados, verificar un único administrador vinculado y registrar su vínculo y el emisor de prueba configurado; no extraer ni reutilizar claves backend. Consultar estado agregado del envío real, sin provocar errores productivos.
5. Si hay problemas: desactivar avisos mediante el panel; conservar incidentes, métricas y movimientos. La limpieza debe seguir desactivada. Un rollback de Edge deja el panel operativo, pero deja sin trabajador de avisos hasta corregir/republicar.

## Validación

Pruebas SQL aisladas: alertas/resolución, permisos de clientes/backend, deduplicación, reintentos y leases inciertos, ventana real, cambio de destinatario, conteos actualizados y protección de recuperación al limpiar. Dos sesiones PostgreSQL compiten por el mismo aviso. Pruebas de runtime: métricas sin datos privados, fallo de telemetría inocuo, verificación de emisor por GET simulado, bloqueo de emisor distinto y entrega única ante error de ack. El ensayo local desprograma los tres cron e impide red productiva. La recepción real por el propietario se registra por separado; no se deduce de HTTP 200.

## Detalle de incidentes por cliente (028)

El propietario solicitó expresamente que el panel y sus avisos indiquen a qué cliente le ocurrió el error y el detalle. Se usa nombre y apellido del perfil (email como alternativa si faltan); no se agregan teléfonos ni contenido de mensajes. La identidad solo se resuelve para el administrador autenticado y su aviso al WhatsApp configurado. Los logs y la bandeja histórica de avisos siguen sin copiar nombres, emails o cuerpos.

Cada mensaje puede conservar su último diagnóstico seguro: etapa, motivo, proveedor, HTTP cuando exista, operación de lectura conocida y hora del registro del servidor. Un fallo del registro se limita a 1,5 s y no reabre operaciones ni impide el reintento normal. Los errores de interpretación que piden texto también conservan estos códigos sin volver a invocar IA. No se guardan errores crudos, stack traces, prompts, audios, fotos ni mensajes financieros en ese diagnóstico.

El panel muestra detalles en las alertas activas (hasta diez por categoría) y hasta 50 mensajes de las últimas 24 horas o todavía sin resolver. Los registros anteriores sin diagnóstico muestran “causa técnica no registrada” y la fecha de recepción, sin inventar un proveedor, un código o la hora del fallo. Se usa el user_id del trabajo: un teléfono vinculado después a otra persona no cambia esa atribución histórica. Las fechas y horas se muestran en America/Argentina/Buenos_Aires.

Los avisos por WhatsApp incluyen la misma descripción y hasta cinco casos por categoría, acotados a un único mensaje de menos de 4096 caracteres. Si quedan casos, remiten al panel. Los fallos de recuperación general se identifican como servicio general, sin adjudicarlos a un cliente. Se mantienen los umbrales, reconocimiento, exclusión, límite de frecuencia, ventana y verificación del emisor existentes. La retención sigue desactivada.

Prueba de aceptación de la versión anterior (v52): el 22/10/2026 se simuló un caso manual_review con el usuario del propietario; apareció en el panel, se reconoció, Meta aceptó un único envío y el propietario confirmó recepción. El incidente se cerró, quedaron cero alertas/avisos pendientes y los hashes de movimientos y borradores permanecieron iguales. La versión 028 amplía el detalle; su nueva aceptación se registra por separado.

### Vista rápida del panel

Estado del bot muestra tres contadores (cola, proceso y mensajes para revisar), tarjetas breves con cliente/causa/fecha y estado de los avisos. Los códigos del proveedor, intentos y referencia quedan en Detalle técnico; el historial y los ajustes/métricas se abren bajo demanda. Los mensajes de fallo de actualización o envío permanecen visibles. No se modifican umbrales ni permisos al simplificar la presentación.

## Revisión y propuesta de activación 30/90

1. Ejecutar en sesión SQL privilegiada la consulta [whatsapp-retention-preview.sql](../../ops/sql/whatsapp-retention-preview.sql). Es un SELECT de conteos; no llama a prune, no modifica banderas ni devuelve textos/IDs/telefonía. La fecha del resultado importa: es una estimación sin bloquear filas, no garantiza qué encontrará un cron futuro. Las protecciones por borrador/transacción pueden superponerse: no sumar esos conteos como categorías excluyentes.
2. Exigir CI y revisar los casos de [VALIDACION_INF_14_RETENCION.md](../planes/VALIDACION_INF_14_RETENCION.md). La limpieza se ejecuta exclusivamente en bases ficticias/descartables durante esas pruebas. No clonar datos alojados.
3. Obtener aprobación **expresa** para retirar contenido de mensajes terminados después de 30 días y métricas/avisos enviados o cancelados después de 90 días. No afecta movimientos, borradores, pendientes, v1 ni recibos/contadores IA. Sí se pierde el contenido original procesado que se redacte: no es un archivo ni un backup, y la identidad/metadatos de deduplicación continúan guardados.
4. Solo después de esa aprobación preparar una llamada de Management API/SQL a [whatsapp-retention-enable.sql](../../ops/sql/whatsapp-retention-enable.sql), en el proyecto aprobado. El archivo exige la marca técnica pesito.retention_approval=30d-content-90d-metrics-v1 en la misma conexión, política aún desactivada de 30 días, fuente vigente y cron esperado; esa marca no sustituye el consentimiento humano. No está conectado a CI/deploy ni se ejecuta automáticamente.
5. Al habilitar, actuará el cron ya existente al minuto 17 de cada hora. El script no llama a prune inmediatamente, no cambia plazos ni crea recursos. Leer flag/días/cron antes y después; revisar conteos posteriores sin contenido. Su integración documental o la publicación de la PWA no habilitan nada.
6. Para parar futuras limpiezas, el dueño SQL puede desactivar retention_enabled conservando el esquema. Una ejecución ya iniciada puede terminar antes del cambio. Desactivar no restaura texto/interpretación/respuestas ni métricas previamente retiradas. No usar down/reset, no restablecer payloads ficticios ni alterar movimientos para aparentar recuperación.

La revisión mantiene backups al final y no agrega servicios ni costos. Los logs administrados por Supabase/GitHub, las tablas heredadas y los metadatos del cupo IA tienen políticas separadas; no se presentan como eliminados por esta función.
