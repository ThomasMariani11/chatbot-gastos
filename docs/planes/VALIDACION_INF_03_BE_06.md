# INF-03 / BE-06 — Cola durable de WhatsApp

Fecha: 15/10/2026. Base: `65510ca`. Estado: INF-03/BE-06 cerradas el 15/10/2026; webhook actual v40, migraciones 020–022 y aceptación del propietario registrada. Backups INF-08 permanecen para el final del plan.

## Aceptación al 15/10/2026

El propietario confirmó la finalización del procedimiento después de las capturas que muestran el ítem erróneo eliminado y la corrección exclusiva del monto del número 2. Reportó números conservados tras la eliminación, CANCELAR y resumen vacío. Consulta agregada de solo lectura: cero ítems pendientes y cero movimientos confirmados con los nombres de prueba de esta fecha; cero trabajos v2 fallidos o en procesamiento. Evidencia actual: 163 tests, 12 Deno y prueba previa de concurrencia PostgreSQL nativa.

Se cierran INF-03/BE-06. No se provocó una interrupción del worker productivo: recuperación y fencing se probaron en aislamiento, y cron/HTTP se verificaron en el entorno alojado. No se ejecutó la variante manual de audio/foto o confirmación adelantada; esos caminos conservan su validación automática y se ampliarán con las tareas relacionadas. Los ocho mensajes heredados permanecen retenidos; no se reprocesan automáticamente. INF-04/BE-10 sigue pendiente.

[Registro de aceptación y límites](evidencias/INF_03_BE_06_aceptacion_2026-10-15.json). Las secciones posteriores conservan el procedimiento y la evidencia de publicación original v38; los arreglos v39/v40 están documentados en el plan.

## Alcance

- Migración 020: recepción atómica de todos los mensajes; numeración durable por recepción; leases de 90 segundos por teléfono y usuario; fencing en cada RPC; aplicación atómica e idempotente del resultado; creación de un único grupo abierto por cliente y posiciones estables. Las nuevas tablas y RPC son exclusivas del backend.
- El webhook verifica la firma y devuelve 200 únicamente después de persistir el payload completo. Ante un fallo devuelve 503 para que Meta reintente. Recorre todas las entradas y cambios. Los comandos, incluida la confirmación, pasan por el mismo trabajador.
- `EdgeRuntime.waitUntil` procesa en segundo plano. Espera tres segundos sin mensajes nuevos para mostrar el resumen. Un temporizador local solo optimiza la latencia: la recuperación depende también de PostgreSQL y cron.
- Migraciones 021–022: cron por minuto y secreto propio del trabajador en Vault. Solo invoca Edge cuando hay trabajo; no hace HTTP con la cola vacía o desactivada. No almacena service_role en cron. La verificación alojada detectó que Supabase conserva grants PUBLIC de pg_net que postgres no puede revocar. Por eso 022 reemplaza el transporte por HTTP síncrono desde cron, con conexión limitada a 2 segundos y petición a 5 segundos: no persiste el secreto en net.http_request_queue. La extensión pg_net permanece instalada pero este trabajador no la utiliza. La llamada síncrona ocupa una conexión de cron hasta el límite del timeout; nunca bloquea la recepción del webhook.
- Una interpretación se conserva antes de aplicar sus efectos. Un fallo de entrega reintenta la respuesta sin repetir la mutación financiera. El efecto y la respuesta por mensaje se registran en una transacción. No se garantiza entrega de respuestas exactamente una vez si Meta acepta el envío y falla el registro de entrega.
- La confirmación conserva el grupo y versión que ya se habían mostrado cuando se recibió el mensaje. Si había procesamiento pendiente o cambió el grupo, pide revisar el siguiente resumen y confirmar nuevamente. Impide insertar pendientes en grupos cerrados.
- Retiene mensajes ante listas antiguas o falta de capacidad, sin insertar parcialmente un mensaje. Tras cinco intentos de interpretación fallidos, conserva el mensaje para revisión y prepara un aviso durable. Un fallo de envío sigue reintentándose sin volver a interpretar.
- Conserva las consultas comerciales y los controles de cuenta y configuración. Se comprueban errores de lectura; no se calculan saldos como cero al fallar la base ni se suman monedas diferentes. Los modelos y el timeout de Gemini existentes se mantienen.
- Los logs nuevos contienen únicamente tiempos de cola, interpretación y envío, cantidad de operaciones e intentos. No incluyen textos, teléfonos, archivos, códigos, excepciones del proveedor ni secretos.

## Inventario productivo de solo lectura

Se consultaron únicamente cantidades y metadatos:

- Cero grupos abiertos y cero usuarios con varios grupos abiertos.
- Cero eventos en procesamiento.
- Ocho registros antiguos: cola pending, evento inbound failed, payload disponible, sin transacciones ni ítems de borrador asociados. Se conservan como versión 1 y no se vuelven a interpretar automáticamente. Requieren decidir con sus propietarios si corresponde reintentarlos; no se descartan ni se consideran procesados.
- Una propuesta antigua de audio, con importe positivo, fecha, pago único y vínculo activo. La función de corte la puede trasladar a un borrador sin confirmarla. Conserva el registro original como cancelado y una referencia `legacy_transaction_id`; exige un resumen y confirmación nuevos. Ningún movimiento confirmado se modifica. La función aborta ante propuestas incompletas o falta de capacidad y es idempotente.
- pg_cron y pg_net disponibles, sin instalar en el inventario; Vault instalado. La instalación efectiva debe comprobarse durante la publicación.

## Validación local

`npm test`: 136 tests aprobados en nueve archivos (30 nuevos). Tres tests Deno aprobados. También aprobados `npm run lint`, `npm run build`, lint de los tests nuevos, `tsc --noEmit`, `deno check`, `deno lint --rules-exclude=no-import-prefix` y `deno test --allow-env --deny-net`. El build conserva la advertencia previa de chunk JS superior a 500 kB; no se modificó el frontend.

La suite nueva carga las migraciones reales 001 y 003–020 en PostgreSQL efímero PGlite. Prueba deduplicación, rollback del payload, cola deshabilitada, exclusión, fencing de un trabajador vencido, FIFO, checkpoints, atomicidad de lotes, numeración estable, versiones de confirmación, silencio, listas antiguas, suspensión, compatibilidad y aislamiento. Reproduce que antes de 020 se podían crear dos grupos abiertos del mismo cliente.

Las migraciones 021–022 se prueban con dobles explícitos de cron, Vault y HTTP: verifican guardas, autenticación y rechazo de HTTP fallido. En Supabase se comprobó además el transporte HTTP real: status 200 del worker y cero filas en la cola HTTP de pg_net. Sin mensajes de prueba ni habilitación temporal de la cola productiva.

La prueba adicional `tests/durable-queue-concurrency.mjs` carga las migraciones reales en PostgreSQL nativo 17.11 local, escucha únicamente en 127.0.0.1 y exige una base descartable identificada. Dos sesiones simultáneas: solo una adquiere el lease; un trabajador vencido no puede aplicar cambios; dos aplicaciones del mismo resultado generan un solo ítem; tres recepciones simultáneas con un ID repetido conservan dos mensajes distintos. Aprobada en 2.870 ms. El servidor local se apagó al terminar. El binario portátil oficial EDB fue verificado contra su SHA256 publicado. [Evidencia sin datos de clientes](evidencias/INF_03_BE_06_concurrencia_2026-10-15.json).

Los tres tests Deno ejecutan el parser, HMAC y handler reales sin red. Cubren payloads múltiples, recepción durable, 503 ante fallo de base y rechazo de la ruta worker sin secreto. No se enviaron mensajes de WhatsApp durante las pruebas locales.

## Orden de publicación

1. Confirmar checkout, pruebas y ausencia de cambios ajenos. Conservar referencia del webhook anterior. Aplicar 020 y registrar su versión; deja `whatsapp_queue_control.enabled=false`. No reprocesar registros versión 1.
2. Preparar un secreto aleatorio exclusivo para el worker, guardándolo únicamente en Edge y Vault (`whatsapp_worker_secret`). No ponerlo en argumentos, repositorio, chat o cron. Verificar permisos efectivos, no solo el resultado aparente de REVOKE. En Supabase alojado los permisos de pg_net son una restricción de la plataforma.
3. Aplicar 021 y 022 antes de activar el control: 022 evita almacenar el secreto en la cola pública de pg_net. Con el control desactivado cron no invoca Edge. Publicar el webhook modular con `--use-api` y sin verificación JWT, conservando HMAC para Meta y el secreto específico para el worker.
4. Mantener la cola nueva desactivada durante el drenaje de instancias de la versión anterior. Meta recibe 503 durante esta ventana y reintenta. Comprobar cero eventos antiguos en procesamiento; no habilitar mientras haya trabajos activos. Esperar al menos 400 segundos desde el despliegue, cubriendo el máximo alojado documentado incluso para planes pagos. Comprobar nuevamente ausencia de procesamiento antiguo antes de activar.
5. Trasladar explícitamente la propuesta antigua con `migrate_whatsapp_legacy_proposals()`, registrar el conteo y comprobar invariancia de movimientos confirmados. Revisar cualquier error; no eliminar ni reparar datos históricos automáticamente.
6. Verificar secreto, autenticación worker y cron; habilitar el control. Comprobar tablas/RPC sin acceso cliente y ejecutar la prueba real por WhatsApp. Mantener INF-03/BE-06 en validación hasta terminarla.

## Publicación verificada

Webhook v38 activo, migraciones 020–022 registradas, secreto exclusivo en Edge y Vault, cron activo y control de cola habilitado tras esperar más de 400 segundos. HTTP del worker: 200 con autenticación válida; 401 sin secreto; 401 para Meta sin firma. El transporte real desde PostgreSQL respondió 200 sin escribir en la cola HTTP de pg_net. Cron sin fallos al corte.

Se trasladó una propuesta heredada a un borrador sin confirmarla. La transacción comparó el contenido completo de los movimientos confirmados antes y después: los 52 permanecieron idénticos. Ocho mensajes fallidos heredados siguen retenidos sin reprocesarse. No se crearon actores ni mensajes sintéticos en producción. Se eliminaron las copias temporales del secreto; el PostgreSQL local de prueba quedó apagado.

[Estado técnico publicado, sin datos de clientes](evidencias/INF_03_BE_06_publicacion_2026-10-15.json). En la publicación original v38, INF-03 y BE-06 estaban pendientes de la prueba del propietario. Su cierre posterior se registra al inicio de este documento; INF-04 y el resto de la auditoría mantienen su propio alcance.

## Prueba del propietario

1. Enviar RESUMEN. Si aparece una lista antigua, resolver primero RETOMAR o DESCARTAR y revisar sus movimientos.
2. Enviar rápido tres mensajes: `Gasté 101 en prueba cola A`, `Gasté 202 en prueba cola B`, `Cobré 303 por prueba cola C`. Deben aparecer los tres, una sola vez, en la lista.
3. Cambiar el 2, quitar el 1 y agregar otro gasto: los números conservados no deben moverse. Si se agrega tras eliminar el número 20, el identificador puede continuar por 21; el límite es de 20 operaciones activas.
4. Enviar un audio y luego CONFIRMAR mientras se interpreta. Debe pedir revisar el nuevo resumen y confirmar de nuevo; no guardar operaciones que todavía no mostró.
5. Para no guardar datos de prueba, terminar con CANCELAR. Si se prueba el guardado, comprobar en la app la cantidad exacta y eliminar solo las pruebas identificadas por el propietario.

## Operación y recuperación

- Cron: `pesito-whatsapp-queue-recovery`; una vez por minuto. El minuto es la cadencia de recuperación, no una promesa de tiempo máximo de respuesta. Comprobar `cron.job_run_details`; el disparador retorna solo HTTP status. Los rechazos HTTP y timeouts generan errores de código fijo, sin cuerpos ni headers. No consultar ni publicar valores de Vault. `net._http_response` no registra las llamadas del transporte 022.
- Consultar cantidades por status, queue_version, attempts y pause_reason. Los mensajes `manual_review` requieren revisión autorizada; no resetear intentos masivamente. El FIFO bloquea mensajes posteriores cuando falla la cabeza; ante una lista retenida solo se adelantan comandos de resolución.
- No convertir registros versión 1 a versión 2 sin analizar su trazabilidad y la intención actual del cliente. Los ocho registros del inventario permanecen visibles para operación.
- Para detener la cola nueva: `update public.whatsapp_queue_control set enabled=false where singleton;`. Se rechaza nueva recepción con 503; no se borran trabajos. Desactivar cron si la pausa será prolongada. Antes de restaurar el webhook antiguo, conciliar las propuestas y trabajos v2: no hacer un downgrade ciego ni borrar tablas o migraciones.
- INF-04/BE-10 aún requieren validación completa del ciclo de entrega y conciliación de reintentos; BE-08/BE-11/BE-12 conservan pendientes de interpretación incompleta y correcciones más amplias. Este cambio no resuelve la auditoría entera.

## Fuentes técnicas

- [Supabase: tareas en segundo plano](https://supabase.com/docs/guides/functions/background-tasks).
- [Supabase: funciones programadas, pg_cron, pg_net y Vault](https://supabase.com/docs/guides/functions/schedule-functions).
- [Supabase Cron](https://supabase.com/docs/guides/cron).

- [Supabase: restricción de permisos de pg_net](https://supabase.com/docs/guides/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect-0bbc16).
- [Supabase: headers legibles en pg_net](https://supabase.com/docs/guides/troubleshooting/database-roles-can-read-request-headers-queued-by-pg_net-ad6357).
- [Supabase: extensión HTTP](https://supabase.com/docs/guides/database/extensions/http).
- [Límites alojados de Edge Functions](https://supabase.com/docs/guides/functions/limits).
