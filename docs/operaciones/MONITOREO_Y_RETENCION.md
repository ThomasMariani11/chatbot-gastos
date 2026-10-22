# Monitoreo del bot y conservación de contenido (INF-14 / BE-16)

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

Propuesta: después de 30 días desde su procesamiento, retirar contenido de mensajes v2 terminados (payload de texto/media, interpretación, respuesta y error). Conservar identificadores de deduplicación, origen/tipo, estado, intentos y trazabilidad. No modificar movimientos financieros ni borradores; proteger mensajes ligados a listas abiertas/ítems pendientes o transacciones pendientes, además de mensajes no terminados, revisión manual y cola heredada v1. Cada ejecución procesa como máximo 500 registros.

Solo si se aprueba y activa esta política, retirar también métricas agregadas y avisos enviados/cancelados de más de 90 días. Los avisos fallidos/inciertos se conservan para investigar. El cron horario se prepara a minuto 17; no hay eliminación efectiva mientras la bandera esté desactivada. No es un backup ni una política integral de borrado de datos personales.

## Publicación y reversión

1. Validar CI: Frontend, Webhook, PostgreSQL y Ensayo de release. Todos los fallos se simulan con datos ficticios y sin Meta/IA reales.
2. Aplicar 027 atómicamente sobre 026, verificar permisos y cron, manteniendo avisos y limpieza desactivados.
3. Publicar el webhook y la PWA de este mismo candidato. El rollback de aplicación es 23dbe9eaca2828fadd793845cc27b240d530b07c, compatible con 026/027; no retirar tablas ni ejecutar down/reset.
4. Para habilitar avisos autorizados, verificar un único administrador vinculado y registrar su vínculo y el emisor de prueba configurado; no extraer ni reutilizar claves backend. Consultar estado agregado del envío real, sin provocar errores productivos.
5. Si hay problemas: desactivar avisos mediante el panel; conservar incidentes, métricas y movimientos. La limpieza debe seguir desactivada. Un rollback de Edge deja el panel operativo, pero deja sin trabajador de avisos hasta corregir/republicar.

## Validación

Pruebas SQL aisladas: alertas/resolución, permisos de clientes/backend, deduplicación, reintentos y leases inciertos, ventana real, cambio de destinatario, conteos actualizados y protección de recuperación al limpiar. Dos sesiones PostgreSQL compiten por el mismo aviso. Pruebas de runtime: métricas sin datos privados, fallo de telemetría inocuo, verificación de emisor por GET simulado, bloqueo de emisor distinto y entrega única ante error de ack. El ensayo local desprograma los tres cron e impide red productiva. La recepción real por el propietario se registra por separado; no se deduce de HTTP 200.
