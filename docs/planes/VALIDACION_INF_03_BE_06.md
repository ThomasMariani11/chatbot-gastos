# INF-03 / BE-06 — Cola durable de WhatsApp

Fecha: 15/10/2026. Base: `65510ca`. Estado: implementación y pruebas locales; publicación y prueba real pendientes. Backups INF-08 permanecen para el final del plan.

## Alcance

- Migración 020: recepción atómica de todos los mensajes; numeración durable por recepción; leases de 90 segundos por teléfono y usuario; fencing en cada RPC; aplicación atómica e idempotente del resultado; creación de un único grupo abierto por cliente y posiciones estables. Las nuevas tablas y RPC son exclusivas del backend.
- El webhook verifica la firma y devuelve 200 únicamente después de persistir el payload completo. Ante un fallo devuelve 503 para que Meta reintente. Recorre todas las entradas y cambios. Los comandos, incluida la confirmación, pasan por el mismo trabajador.
- `EdgeRuntime.waitUntil` procesa en segundo plano. Espera tres segundos sin mensajes nuevos para mostrar el resumen. Un temporizador local solo optimiza la latencia: la recuperación depende también de PostgreSQL y cron.
- Migración 021: cron por minuto con pg_net y secreto propio del trabajador en Vault. Solo invoca Edge cuando hay trabajo; no hace HTTP con la cola vacía o desactivada. No almacena service_role en cron. Los headers de la cola HTTP quedan restringidos a roles internos.
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

`npm test`: 135 tests aprobados en nueve archivos (29 nuevos). Tres tests Deno aprobados. También aprobados `npm run lint`, `npm run build`, lint de los tests nuevos, `tsc --noEmit`, `deno check`, `deno lint --rules-exclude=no-import-prefix` y `deno test --allow-env --deny-net`. El build conserva la advertencia previa de chunk JS superior a 500 kB; no se modificó el frontend.

La suite nueva carga las migraciones reales 001 y 003–020 en PostgreSQL efímero PGlite. Prueba deduplicación, rollback del payload, cola deshabilitada, exclusión, fencing de un trabajador vencido, FIFO, checkpoints, atomicidad de lotes, numeración estable, versiones de confirmación, silencio, listas antiguas, suspensión, compatibilidad y aislamiento. Reproduce que antes de 020 se podían crear dos grupos abiertos del mismo cliente.

La migración 021 se prueba con dobles explícitos de cron, Vault y net.http_post: valida su contrato y las guardas, pero no sustituye una ejecución del servicio alojado. PGlite usa una conexión; no demuestra carreras entre dos sesiones PostgreSQL reales. Se verifican las transiciones de leases y el rechazo de tokens vencidos mediante el SQL real. La revisión de los bloqueos y una prueba de concurrencia alojada siguen formando parte de la puesta en marcha.

Los tres tests Deno ejecutan el parser, HMAC y handler reales sin red. Cubren payloads múltiples, recepción durable, 503 ante fallo de base y rechazo de la ruta worker sin secreto. No se enviaron mensajes de WhatsApp durante las pruebas locales.

## Orden de publicación

1. Confirmar checkout, pruebas y ausencia de cambios ajenos. Conservar referencia del webhook anterior. Aplicar 020 y registrar su versión; deja `whatsapp_queue_control.enabled=false`. No reprocesar registros versión 1.
2. Preparar un secreto aleatorio exclusivo para el worker, guardándolo únicamente en Edge y Vault (`whatsapp_worker_secret`). No ponerlo en argumentos, repositorio, chat o cron. Comprobar ACL de la cola HTTP antes de utilizarlo.
3. Aplicar 021. Con el control desactivado cron no invoca Edge. Publicar el webhook modular con `--use-api` y sin verificación JWT, conservando HMAC para Meta y el secreto específico para el worker.
4. Mantener la cola nueva desactivada durante el drenaje de instancias de la versión anterior. Meta recibe 503 durante esta ventana y reintenta. Comprobar cero eventos antiguos en procesamiento; no habilitar mientras haya trabajos activos. Verificar el límite efectivo de duración de instancias antes de dar por terminado el drenaje.
5. Trasladar explícitamente la propuesta antigua con `migrate_whatsapp_legacy_proposals()`, registrar el conteo y comprobar invariancia de movimientos confirmados. Revisar cualquier error; no eliminar ni reparar datos históricos automáticamente.
6. Verificar secreto, autenticación worker y cron; habilitar el control. Comprobar tablas/RPC sin acceso cliente y ejecutar la prueba real por WhatsApp. Mantener INF-03/BE-06 en validación hasta terminarla.

## Prueba del propietario

1. Enviar RESUMEN. Si aparece una lista antigua, resolver primero RETOMAR o DESCARTAR y revisar sus movimientos.
2. Enviar rápido tres mensajes: `Gasté 101 en prueba cola A`, `Gasté 202 en prueba cola B`, `Cobré 303 por prueba cola C`. Deben aparecer los tres, una sola vez, en la lista.
3. Cambiar el 2, quitar el 1 y agregar otro gasto: los números conservados no deben moverse. Si se agrega tras eliminar el número 20, el identificador puede continuar por 21; el límite es de 20 operaciones activas.
4. Enviar un audio y luego CONFIRMAR mientras se interpreta. Debe pedir revisar el nuevo resumen y confirmar de nuevo; no guardar operaciones que todavía no mostró.
5. Para no guardar datos de prueba, terminar con CANCELAR. Si se prueba el guardado, comprobar en la app la cantidad exacta y eliminar solo las pruebas identificadas por el propietario.

## Operación y recuperación

- Cron: `pesito-whatsapp-queue-recovery`; una vez por minuto. El minuto es la cadencia de recuperación, no una promesa de tiempo máximo de respuesta. Comprobar `cron.job_run_details` y los códigos HTTP de `net._http_response` sin publicar cuerpos ni headers.
- Consultar cantidades por status, queue_version, attempts y pause_reason. Los mensajes `manual_review` requieren revisión autorizada; no resetear intentos masivamente. El FIFO bloquea mensajes posteriores cuando falla la cabeza; ante una lista retenida solo se adelantan comandos de resolución.
- No convertir registros versión 1 a versión 2 sin analizar su trazabilidad y la intención actual del cliente. Los ocho registros del inventario permanecen visibles para operación.
- Para detener la cola nueva: `update public.whatsapp_queue_control set enabled=false where singleton;`. Se rechaza nueva recepción con 503; no se borran trabajos. Desactivar cron si la pausa será prolongada. Antes de restaurar el webhook antiguo, conciliar las propuestas y trabajos v2: no hacer un downgrade ciego ni borrar tablas o migraciones.
- INF-04/BE-10 aún requieren validación completa del ciclo de entrega y conciliación de reintentos; BE-08/BE-11/BE-12 conservan pendientes de interpretación incompleta y correcciones más amplias. Este cambio no resuelve la auditoría entera.

## Fuentes técnicas

- [Supabase: tareas en segundo plano](https://supabase.com/docs/guides/functions/background-tasks).
- [Supabase: funciones programadas, pg_cron, pg_net y Vault](https://supabase.com/docs/guides/functions/schedule-functions).
- [Supabase Cron](https://supabase.com/docs/guides/cron).
