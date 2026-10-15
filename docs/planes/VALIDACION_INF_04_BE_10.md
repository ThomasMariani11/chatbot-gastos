# INF-04 / BE-10 — Reintentos y respuestas recuperables

Fecha: 15/10/2026. Migración 023 publicada; webhook v40 sin redespliegue. Estado: INF-04/BE-10 cerradas con aceptación del propietario y corroboración agregada de solo lectura.

## Diseño y cambio

La migración 020 ya persistía la respuesta `reply_text` junto al efecto financiero `effect_applied`, en la misma transacción. Los campos de entrega del trabajo cumplen la función de outbox: si falla enviar o registrar el envío, el siguiente worker omite interpretación y guardado, y reintenta esa respuesta. No fue necesario crear otra tabla ni repetir el diseño de INF-03.

Se reprodujo un fallo real en el SQL previo a 023: después de finalizar la entrega en la base, una pérdida de la respuesta RPC hacía que el catch del worker llamara fail_whatsapp_job y reabriera el registro processed como failed. No duplicaba operaciones financieras, pero podía reenviar un texto ya registrado como enviado.

023 conserva las firmas, el fencing y los permisos exclusivos del backend. Ambas RPC vuelven a leer el trabajo bajo bloqueo del actor y del registro. finish es idempotente para trabajos terminados y avisos waiting ya entregados; fail modifica únicamente trabajos processing. Un error tardío no reabre processed/waiting ni desplaza dos veces el próximo intento.

## Ensayos aislados

Diez casos nuevos usan el worker real y las RPC reales en PostgreSQL PGlite. Solo se simulan proveedor y cortes antes/después de las respuestas RPC. Cada llamada se aísla con savepoints; la suite mantiene una transacción externa descartable, por lo que no equivale a matar un proceso o perder un COMMIT físico de producción.

- Fallo antes de aplicar: no hay guardado ni anuncio de éxito. Fallo de respuesta después de aplicar: se conserva el guardado y la respuesta, y el worker nuevo no vuelve a aplicar.
- Reenvío de Meta y caída del proveedor: un solo trabajo y mismo resultado financiero. La entrega continúa incluso tras más de cinco intentos; no se transforma un guardado aplicado en revisión de interpretación.
- Aceptación de la respuesta por Meta y fallo antes de registrar: posible repetición del texto, sin repetir operaciones. Fallo después de registrar: permanece processed y no reenvía.
- Interrupción simulada tras guardar y fallo al liberar el lease: al vencer la concesión otro worker recupera exclusivamente la respuesta.
- Error SQL en la segunda cuota: rollback del grupo completo y ninguna respuesta de éxito. Al retirar el fallo simulado se confirman tres cuotas ARS y un ingreso USD, con importes exactos por moneda.
- Dos confirmaciones con identificadores diferentes: una sola confirmación financiera; la segunda informa que no hay pendientes.
- Resumen con envío fallido: summary_pending permanece disponible para recuperación, sin nueva interpretación ni confirmación.
- Aviso retenido ya entregado: un error tardío no lo reabre ni modifica los timestamps.

173 tests aprobados en once archivos, lint del test modificado y build con TypeScript aprobados. El build mantiene la advertencia previa del chunk frontend mayor a 500 kB. No se cambió código Deno en este punto; sus doce regresiones aprobadas previamente se mantienen sin cambios.

Se ejecutó además PostgreSQL nativo 17.11 local, con dos conexiones simultáneas: finish/fail sobre una entrega ya finalizada mantienen processed; leases, fencing, aplicación y recepción concurrentes siguen idempotentes. El servidor local quedó apagado al terminar. [Evidencia concurrente](evidencias/INF_04_BE_10_concurrencia_2026-10-15.json).

## Publicación y límites

023 aplicada y registrada en la misma transacción. Se verificaron guardas y ACL: clientes sin ejecución, service_role habilitado; cola activa, cero trabajos v2 fallidos o en procesamiento al chequeo. No se modificaron movimientos ni se inyectaron fallos en producción. Los ocho registros heredados siguen fuera de la recuperación automática. [Evidencia publicada](evidencias/INF_04_BE_10_publicacion_2026-10-15.json).

No se garantiza que un texto se entregue exactamente una vez: si el proveedor lo acepta y el registro local no queda confirmado, puede repetirse el texto. reply_sent_at representa la finalización del envío a la API, no prueba de entrega o lectura en el teléfono. La protección verificada es contra guardados duplicados y parciales; no se promete ausencia absoluta de respuestas repetidas.

El resumen usa su bandera durable y versión mostrada; un fallo antes de registrar el envío puede repetir el resumen. Cron recupera trabajos según su cadencia; no garantiza un máximo de respuesta de tres segundos durante una falla.

## Procedimiento de aceptación ejecutado

1. Revisar RESUMEN y resolver cualquier lista anterior antes de agregar pruebas.
2. Enviar un único gasto de prueba identificable de 1 ARS. Revisar el borrador y responder CONFIRMAR una vez.
3. Tras recibir el aviso de guardado, responder CONFIRMAR otra vez. Debe informar que no hay pendientes y la app debe contener un solo gasto de prueba de 1 ARS.
4. El propietario puede eliminar ese gasto de prueba desde la app. No realizar simulaciones de fallos sobre su cuenta ni cancelar listas ajenas a la prueba.

INF-04/BE-10 cerradas el 15/10/2026. El propietario confirmó el resultado correcto: guardado único y segunda confirmación sin duplicado. Una lectura agregada corroboró un único gasto de prueba de 1 ARS, cero ítems pendientes de esa prueba y cero trabajos v2 fallidos o en procesamiento. No se modificaron datos ni se publicaron cambios adicionales durante el cierre. [Evidencia de aceptación](evidencias/INF_04_BE_10_aceptacion_2026-10-15.json). INF-03/BE-06 conservan su cierre. BE-05/BE-12 y los demás puntos no se cierran por esta publicación. Backups continúan para el final.
