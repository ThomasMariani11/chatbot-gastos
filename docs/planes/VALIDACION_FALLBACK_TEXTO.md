# Audio no interpretado: continuar por texto

Fecha: 16/10/2026. Estado: webhook v43 publicado; aceptación real del pedido de texto y su confirmación aprobada.

## Problema observado y decisión

La nueva prueba de audio devolvió HTTP 503 en los dos modelos de Gemini y un timeout. Tras cinco intentos, la cola conservaba el mensaje sin checkpoint, ítems ni transacciones y aún no había enviado respuesta. El silencio se debía al reintento exponencial antes de avisar. El historial muestra que la reducción a 3,5 s por llamada viene de 3619d86, anterior a la auditoría; la indisponibilidad 503 se observó en el proveedor. No se afirma que las actualizaciones hayan causado esos 503.

El usuario pidió conservar el mensaje recibido y pedir texto cuando la IA falla o no entiende, sin esperar sucesivos reintentos. Esta corrección sustituye el reintento de interpretación por esa salida controlada.

## Comportamiento

- Flash Lite primero, Flash como respaldo. Hasta 10 s por modelo para audio/imagen, 3,5 s para texto. La descarga de Meta mantiene sus timeouts existentes; no se promete una latencia total fija.
- Si fallan ambos modelos, la descarga, o no se identifica una operación completa, se persiste el checkpoint interno `request_text` y se pide concepto e importe por texto. Si son varios movimientos se pide la lista completa, sin altas parciales.
- El payload original de WhatsApp sigue almacenado en la cola de Supabase, con su referencia de media. **No se crea una copia permanente del archivo de audio** ni se guarda en el navegador o la PC del cliente.
- El audio termina sin crear movimientos, sin pausa manual que bloquee el texto siguiente y sin reintentos posteriores de IA. Solo un texto nuevo puede aportar los datos, y aún requiere confirmación del usuario para guardarlos.
- La respuesta se guarda mediante el mecanismo existente. Un error al enviarla recupera solo esa respuesta; un reenvío de Meta no reabre el audio. La aceptación remota seguida de pérdida de confirmación local puede repetir la respuesta, pero no crea transacciones.
- Los fallos de base/checkpoint no se disfrazan de fallos de IA. Conservan la recuperación durable existente.
- Se registra proveedor/motivo/HTTP permitido; nunca texto, IDs, audio, tokens ni cuerpos crudos.

## Validación

Pruebas con red denegada y claves ficticias: Meta 403, ambos modelos 503, timeout/respuesta inválida, orden de respaldo, margen de audio, audio válido, audio ambiguo, lista con un importe faltante, checkpoint fallido y recuperación desde checkpoint sin red. SQL aislado: payload conservado, fallo de envío, reenvío de Meta, una sola propuesta del texto de reemplazo y cero transacciones sin confirmar.

198 Vitest, 21 Deno; lint, tipos, build y controles de release deben aprobar junto a los cuatro checks protegidos del PR. La publicación requiere solo webhook, mantiene migraciones 001–025 y deja rollback a a9c0e65/v42. No reabre audios históricos cancelados o retenidos en revisión manual.

## Prueba real aprobada

El usuario envió un audio nuevo y luego aportó una captura del pedido de texto, la propuesta y su confirmación. La lectura de base verificó un solo intento del audio, checkpoint request_text, respuesta en 3,55 s y cero ítems o transacciones provenientes del audio. El texto de reemplazo generó un único borrador y la confirmación del usuario creó exactamente un gasto confirmado de ARS 123 en un grupo cerrado. No quedaron mensajes retenidos. Ambos modelos devolvieron 503: esta aceptación valida el flujo alternativo, no la disponibilidad ni la extracción exitosa de Gemini.

Este cambio no da por resuelta la disponibilidad de Gemini. INF-11 continúa después de validar el flujo; backups permanecen al final.

## Publicación observada

Código 3d8600d, [PR 6](https://github.com/ThomasMariani11/chatbot-gastos/pull/6), con los cuatro checks aprobados en [CI 38941917400](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/38941917400). El ensayo reprodujo las 25 migraciones, probó candidato y rollback a a9c0e65, conservó los datos sintéticos y terminó con limpieza verificada, cero mensajes externos y sin restaurar bases.

Supabase CLI 2.120.0 publicó únicamente los ocho módulos del webhook: versión 43 ACTIVE. Webhook sin firma y worker sin secreto responden 401. No se aplicaron migraciones ni se reabrieron mensajes históricos. El audio de la prueba previa quedó en revisión con aviso enviado, sin ítems ni transacciones; ese flujo anterior necesita resolverse antes de repetir una prueba.

[Evidencia de despliegue](evidencias/FALLBACK_TEXTO_2026-10-16.json). La aceptación del flujo de pedido de texto, reemplazo y confirmación quedó aprobada mediante la prueba real y la lectura de base. Gemini continúa devolviendo 503.
