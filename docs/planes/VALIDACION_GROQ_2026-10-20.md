# Evaluación inicial de Groq — 20/10/2026

Estado actual: los dos casos fueron diagnosticados y resueltos en el experimento; seis de seis ejemplos de desarrollo pasan. Se conserva abajo la primera ronda (cuatro de seis) como antecedente. Todavía no está integrado ni publicado en el bot.

## Cuenta y credencial

El usuario completó el registro. La consola autenticada muestra Free como Current Plan, USD 0. No se agregó tarjeta ni se activó facturación. Antes de crear una clave nueva se obtuvo autorización expresa del usuario. Se creó «Pesito - evaluacion IA», con vencimiento el 27/10/2026 en Default Project. El formulario no ofreció permisos específicos por endpoint. No se instaló esa credencial en Supabase ni se guardó un archivo con la clave en claro. El transporte local se cifró y los archivos temporales utilizados se eliminaron. La clave no se conserva para reutilización local tras terminar esta prueba; la credencial del servicio caduca en la fecha elegida.

Cuotas leídas en la organización:

| Modelo | RPM | RPD | Otros límites |
| --- | ---: | ---: | --- |
| qwen/qwen3.8-27b | 30 | 1.000 | 8.000 tokens/minuto; 200.000 tokens/día |
| whisper-large-v3-turbo | 20 | 2.000 | 7.200 segundos de audio/hora; 28.800 segundos/día |

El cupo es compartido y se puede agotar por tokens o duración antes de llegar a la cantidad de solicitudes. Estos límites no representan una garantía de disponibilidad.

## Método

Se reutilizaron los ejemplos ficticios de la comparación con Gemini: WAV de voz sintética española y PNG de un ticket con dos productos y un solo total. Se añadieron ejemplos de monedas/cuotas, corrección y monto faltante. No se enviaron datos de clientes.

REST directo desde la PC. Transcripción con Whisper y extracción con Qwen. El prompt y el esquema provienen de helpers.ts; Qwen usa JSON Object Mode con el esquema incluido en las instrucciones y validación local. Ese modo garantiza formato JSON, no el contrato de datos por sí solo. No se probó Structured Outputs estricto. Peticiones secuenciales, sin reintentos y separadas 25 s entre inicios de extracción para moderar el consumo. Timeout de 10 s por petición, presupuesto de 30 s por caso, respuesta acotada a 256 KiB. La salida de evaluación registra metadatos, no claves ni respuestas crudas.

## Resultados

| Caso | Respuestas HTTP | Tiempo total | Resultado observado |
| --- | --- | ---: | --- |
| Dos gastos y un ingreso en texto | 200 | 1,63 s | Pasa: tres movimientos, tipos/importes/monedas esperados y esquema válido |
| Ticket con dos productos y un total | 200 | 2,28 s | Revisión: intención add_movements, salida rechazada por el validador del esquema |
| Audio sintetizado -> texto -> movimiento | 200 + 200 | 1,97 s | Pasa: transcripción no vacía y un gasto ARS 1.500; transcripción 1,15 s y extracción 0,81 s |
| Ingreso USD y compra ARS en cuotas | 200 | 1,11 s | Revisión: esquema válido y dos movimientos, pero no coincide con todas las expectativas del caso |
| Corregir únicamente el movimiento 2 | 200 | 0,88 s | Pasa: edit_item, posición 2, importe esperado y cero movimientos nuevos |
| Gasto sin monto | 200 | 1,25 s | Pasa: monto null y amount entre los datos faltantes |

Siete respuestas HTTP, todas 200. Cuatro casos correctos según el matcher y dos pendientes. No hubo 503, 429 ni timeout en esta ronda. No se guardaron transacciones ni se enviaron mensajes por WhatsApp.

## Límites y siguiente paso

No atribuir todavía un error financiero concreto a los dos casos pendientes: la primera instrumentación no guardó la ruta del campo que falló, ni la comparación individual de cada campo. Además, el matcher exige fecha explícita y ausencia de faltantes para casos completos, mientras la aplicación puede completar fecha/otros valores por defecto. Se debe distinguir un dato incorrecto de una adaptación o de un criterio de prueba demasiado estricto.

El siguiente paso es normalizar y validar la respuesta contra el contrato real de Pesito: nulos/campos opcionales, fecha y categoría predeterminadas, significado de importe total y cuotas, monedas independientes y conservación de movimientos incompletos. Evaluar Structured Outputs para el modelo elegido. Agregar diagnóstico por campo sin incluir contenido sensible y repetir los dos casos, junto con los ya aprobados.

La ronda es una prueba pequeña de conectividad y compatibilidad, no una medida general de precisión o disponibilidad. No reproduce audio OGG/Opus, ruido ni español rioplatense de clientes. Antes de publicar hacen falta ejemplos independientes, controles de datos del proveedor y aceptación real de audio/foto. Se debe preparar una credencial adecuada al entorno si se continúa; esta clave de evaluación vence el 27/10.

Gemini permanece como estaba en producción. INF-12 sigue abierto. No se modificaron fuentes del webhook, SQL ni dependencias. [Evidencia saneada](evidencias/GROQ_2026-10-20.json). [Comparación previa de Gemini](VALIDACION_GEMINI_2026-10-20.md).

## Seguimiento: diagnóstico y repetición de los dos casos

La repetición directa por API identificó el campo exacto del rechazo de la foto: edit=null. El ticket se había interpretado correctamente como un solo gasto de ARS 1.500, con fecha correcta y sin datos faltantes. El esquema del primer ensayo permitía omitir edit, pero no aceptaba null. Fue una incompatibilidad del validador de la prueba, no un error demostrado del contenido del comprobante ni un fallo productivo del bot.

El caso de monedas sí reprodujo un dato incorrecto: el ingreso en USD tenía totalAmountArs=null pese a que el mensaje decía 100 dólares. También marcaba date como faltante cuando correspondía usar la fecha local. Es compatible con una ambigüedad del nombre histórico del campo; no se atribuye certeza sobre el razonamiento interno del modelo.

Se preparó un experimento con estas reglas explícitas:

- totalAmountArs contiene el importe numérico en currency, incluso USD; no convertir monedas ni borrar el importe por el sufijo Ars.
- Una compra de ARS 12.000 en tres cuotas mantiene totalAmountArs=12000 e installments=3.
- Fecha local si no se indica otra; categoría Otros si no se identifica; conservar el monto realmente desconocido como null con amount faltante.
- Esquema de transporte estricto con campos opcionales representables como null. La adaptación omite edit=null únicamente cuando la intención no es edit_item; nunca transforma una corrección vacía en una válida. Los defaults de fecha/categoría se verifican conforme al contrato de la app.

Prompt y formato estricto se cambiaron juntos. La ronda demuestra el resultado de esa combinación; no aísla qué fracción de la mejora corresponde a cada cambio. Structured Outputs controla la estructura, no garantiza que importes y decisiones sean correctos.

| Caso con adaptación e instrucciones nuevas | Resultado | Tiempo total observado |
| --- | --- | ---: |
| Ticket: un solo total | Correcto: un gasto ARS 1.500 | 0,95 s |
| Ingreso USD y compra en cuotas | Correcto: ingreso USD 100; gasto ARS 12.000 en 3 cuotas, mes inicial 2026-10 | 0,99 s |
| Texto con tres movimientos | Correcto | 1,09 s |
| Audio sintético: transcripción y extracción | Correcto | 1,32 s |
| Corrección del movimiento 2 | Correcta, sin altas nuevas | 0,79 s |
| Monto faltante | Conservado como null y pendiente | 2,13 s |

Seis de seis casos de desarrollo pasan, con nueve respuestas HTTP 200 en esta ronda (dos extracciones de referencia, seis del experimento y una transcripción). No hubo reintentos ni pruebas para agotar cuotas. El experimento consumió 8.943 tokens de extracción en sus seis casos corregidos, promedio 1.490,5. Los headers observados confirman 1.000 solicitudes y 8.000 tokens como límites publicados en esas respuestas. No informan por sí solos el cupo diario de tokens, que se leyó del panel de la cuenta.

Se mantuvieron los fallos originales como evidencia; no se sustituyeron sus resultados por los nuevos. Los casos corregidos son ejemplos de desarrollo ya conocidos, no una evaluación independiente de exactitud. No incluyen audio rioplatense con ruido, OGG/Opus, un lote de veinte movimientos ni una aceptación real de WhatsApp.

### Reproducibilidad y estado

[Script del experimento](../../scripts/evaluate-groq.mjs), [fixtures y uso](../../tests/fixtures/groq-evaluation/README.md), [evidencia saneada](evidencias/GROQ_REVISION_2026-10-20.json) y [capacidad para cuatro usuarios](CAPACIDAD_GROQ_4_USUARIOS.md).

El script exige --live para consumir API; --dry-run verifica preparación y controles locales sin red. Las pruebas externas no se agregaron a CI ni npm test. Se verificaron preservación de USD, ausencia de mutación de entrada, defaults, monto faltante y rechazo de importes de texto/correcciones vacías. Los resultados completos de estos ejemplos exclusivamente ficticios permanecen en .temp ignorado; no se guardan respuestas de clientes.

Con autorización expresa se creó «Pesito - pruebas 4 usuarios», también con vencimiento el 27/10, y se guardó cifrada con DPAPI de este usuario de Windows para poder repetir pruebas. Se verificó su descifrado sin imprimirla. No está en el repositorio ni en Supabase. La clave anterior de evaluación permanece hasta su vencimiento; no se revocó ni se modificó otra credencial sin autorización.

El prototipo resuelve los dos casos revisados. Todavía hace falta integrar un proveedor dentro del presupuesto compartido, validar entradas y salidas en el backend, manejar 429/indisponibilidad, revisar controles de datos y probar casos independientes antes de desplegar. No cambió el runtime del bot ni la base de datos. INF-12 permanece abierto hasta esa integración y aceptación real.
