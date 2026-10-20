# Revisión de Gemini y alternativas de IA — 20/10/2026

Estado: diagnóstico con comparación autenticada completada; ocho intentos fallidos. [Resultados y cuotas privadas verificadas](VALIDACION_GEMINI_2026-10-20.md). Sin cambios de runtime, secretos, suscripciones ni despliegues. INF-12 continúa en curso. Mantener costo adicional objetivo USD 0; backups al final.

## Evidencia del proyecto

- helpers.ts:463 consulta GEMINI_API_KEY. La lista autenticada de secretos de Supabase confirma que existe; actualización informada: 03/09/2026. No devuelve su valor utilizable. No hay GEMINI_API_KEY local en las ubicaciones de entorno revisadas ni en el proceso. No se extrajeron credenciales de otras aplicaciones.
- helpers.ts:509–514 fija gemini-3.1-flash-lite primero y gemini-3.8-flash después. Ambos figuran en el catálogo oficial consultado hoy. La existencia en el catálogo no garantiza acceso o capacidad para esta cuenta.
- REST v1beta generateContent, JSON con esquema, temperature=0.1. No se configura thinkingConfig ni maxOutputTokens. La clave se coloca en el parámetro key de la URL; se recomienda el header x-goog-api-key para reducir el riesgo de exposición en diagnósticos de transporte. No se observó una fuga de esa clave.
- Cada modelo dispone de 10 s con medios o 3,5 s con texto. Interpretación total 30 s, descarga compartida 10 s. El presupuesto no garantiza una respuesta exitosa dentro de esos tiempos.
- processor.ts usa reglas deterministas para textos simples y comandos/correcciones antes de la IA. Conviene reutilizar estas reglas al incorporar transcripción.
- La prueba real de hoy terminó en request_text: audio 24,22 s; imagen 9,39 s; ambos procesados una vez, sin ítems ni transacciones. Los logs agregados muestran 503 y timeouts de ambos modelos, sin rechazo de tamaño/formato observado. No permiten atribuir cada error a un mensaje individual.
- No hay secretos GROQ_API_KEY ni OPENROUTER_API_KEY en la lista de Supabase. Continuación: el usuario creó su cuenta de Groq Free y autorizó una clave de evaluación de siete días. Se probaron únicamente ejemplos ficticios, con siete HTTP 200; cuatro de seis casos pasan el matcher y dos requieren revisión. Sin integración en Supabase. [Resultados](VALIDACION_GROQ_2026-10-20.md).

## Qué está confirmado y qué falta

Confirmado: fallos de disponibilidad/tiempo en los intentos productivos observados y una recuperación que pide texto sin altas parciales. El respaldo actual comparte proveedor y proyecto/clave con el principal; no brinda independencia de proveedor. Los cupos de Gemini se aplican por proyecto, por lo que rotar claves del mismo proyecto no constituye una solución de cuotas. [Límites oficiales](https://ai.google.dev/gemini-api/docs/rate-limits).

Continuación del 20/10: se verificó el proyecto gratuito de la cuenta, sus cuotas y la coincidencia de la clave con Supabase. La comparación mínima y los casos de texto/audio/foto dieron seis 503 y dos timeouts, cero éxitos. Ver el informe enlazado arriba. Sigue a verificar la causa específica de indisponibilidad y cualquier restricción de cuenta/clave que ese error no permita distinguir. La presencia del secreto no demuestra su validez. No hubo 401/403/429 en la muestra revisada, lo cual tampoco descarta problemas fuera de esa ventana. No se confirmó una caída global: el panel público de estado requiere una interfaz que la consulta documental no pudo interpretar. [Diagnóstico oficial](https://ai.google.dev/gemini-api/docs/troubleshooting).

## Ajustes candidatos de Gemini

1. Probar una solicitud mínima sintética con la misma clave y luego el esquema real, en el entorno del backend, sin mensajes financieros ni envíos a WhatsApp. Comparar estado HTTP, tiempo y resultado validado. Confirmar antes que se use el cupo gratuito; no activar facturación.
2. Evaluar razonamiento reducido según modelo. Flash 3.8 usa medium por defecto y admite low. Esto puede reducir latencia, pero no corrige un 503. Verificar el parámetro en la API REST que utiliza el proyecto antes de implementarlo. [Thinking](https://ai.google.dev/gemini-api/docs/thinking).
3. Revisar temperature=0.1: Google indica que 3.6+ ignora ese parámetro y prevé rechazarlo en el futuro. Quitar o adaptar por modelo tras pruebas; no confundirlo con la causa demostrada del incidente actual. [Compatibilidad](https://ai.google.dev/gemini-api/docs/troubleshooting).
4. Evaluar gemini-3.5-flash-lite como candidato de prueba; el catálogo lo ofrece y publica cupo gratuito. No cambiar producción solo por ser más nuevo ni suponer que la cuenta dispone del cupo. [Catálogo](https://ai.google.dev/gemini-api/docs/models), [precios](https://ai.google.dev/gemini-api/docs/pricing).
5. Definir un límite de salida que admita 20 operaciones completas, correcciones y faltantes; probar truncamiento y JSON inválido. No elegir un número pequeño que pierda movimientos. Mantener el presupuesto total y el pedido de texto persistente.
6. Registrar solo metadatos permitidos y resultados de validación. No prolongar la espera con más reintentos de modelos indiscriminados. Evaluar una pausa temporal de proveedor tras fallos repetidos con recuperación de prueba controlada.

## Alternativas evaluadas

| Opción | Uso en Pesito | Costo y condición | Evaluación |
| --- | --- | --- | --- |
| Groq + Whisper | Audio a texto en español; reglas propias o extractor convierten texto a movimientos | Free Plan con límites por solicitudes y segundos de audio | Primer candidato para una prueba independiente de Google. Transcribir no resuelve por sí solo todos los mensajes ambiguos. |
| Groq + Qwen con visión | Extraer total, comercio, moneda y fecha de una foto | Modelo de visión incluido en tabla Free Plan; cuota real a confirmar en la cuenta | Candidato para comprobantes; medir exactitud de importes y formato JSON antes de activarlo. |
| Gemini ajustado | Texto, audio y fotos con el esquema actual | Cupos gratuitos por modelo/proyecto; sin capacidad garantizada | Menor cambio, pero principal y respaldo siguen compartiendo proveedor. |
| OpenRouter gratuito | Acceso a modelos de distintos proveedores | Plan gratuito publicado: 50 solicitudes/día; disponibilidad y modalidades dependen del modelo | Útil para experimentar; techo reducido como soporte de una app con clientes. Elegir proveedor/modelo explícitos y revisar tratamiento de datos. |
| Whisper.cpp + modelo local vía Ollama | Transcripción y extracción en hardware propio | Sin tarifa de API, con consumo eléctrico, hardware y operación | Viable para pruebas. Una PC apagada o sin red no puede atender clientes; no sustituye por sí sola un servicio disponible permanentemente. |

Fuentes: [Groq audio y formatos](https://console.groq.com/docs/speech-to-text), [visión](https://console.groq.com/docs/vision), [cupos](https://console.groq.com/docs/rate-limits), [OpenRouter](https://openrouter.ai/pricing), [Whisper.cpp](https://github.com/ggml-org/whisper.cpp), [Ollama](https://docs.ollama.com/faq). Las cifras son documentación consultada hoy, no cuotas verificadas de una cuenta nueva. Groq ya cuenta con una primera prueba autenticada, documentada arriba; su muestra no determina precisión o disponibilidad generales. OpenRouter no se probó mediante una API autenticada.

Antes de enviar comprobantes de clientes a un proveedor nuevo, revisar los controles de datos. Groq publica ZDR para clientes y excepciones de retención sin ese ajuste. La tabla gratuita de Gemini indica uso de datos para mejorar productos. No asumir privacidad equivalente por ser gratuito. [Groq](https://console.groq.com/docs/your-data), [Gemini](https://ai.google.dev/gemini-api/docs/pricing).

## Agente propio y entrenamiento

Propuesta: un flujo especializado de Pesito que controle enrutamiento, reglas, validación y borradores. Audio pasa a transcripción; foto a extracción visual; texto y resultados pasan por el mismo contrato de movimientos. La IA propone datos; la aplicación valida y la confirmación explícita autoriza el guardado SQL atómico existente. Una transcripción dudosa, un total no verificable o una instrucción ambigua debe pedir aclaración.

Esto puede construirse con instrucciones, ejemplos revisados y lógica existente. No requiere entrenamiento inicial ni un agente autónomo con acceso libre a la base. Agregar agentes o llamadas no elimina las fallas del modelo que usan y puede añadir demora.

Entrenar desde cero no es una opción razonable para el objetivo de costo cero. Un ajuste fino de un modelo existente solo se justificaría después de medir errores persistentes con un conjunto representativo, contar con ejemplos autorizados/anonimizados y presupuestar entrenamiento e inferencia. No reutilizar automáticamente audios, comprobantes o datos de clientes como dataset.

## Próximo paso recomendado

1. Comprobación privada y comparación directa realizadas: 3.8 ofrece 5 RPM y 20 RPD; Lite 15 RPM y 500 RPD. Ninguno respondió correctamente en esta ronda. No invertir el orden productivo basándose solo en la capacidad anunciada del modelo.
2. Preparar una evaluación aislada de Groq Free: audio español -> Whisper -> parser existente; foto -> visión -> contrato validado. Cuenta Free y clave de evaluación creadas con autorización; primera prueba completada. Contrato revisado y seis de seis casos de desarrollo correctos en el prototipo; integrar con controles de presupuesto y probar ejemplos independientes antes de publicar. Ver capacidad para cuatro usuarios en el documento específico. No activar plan pago.
3. Usar inicialmente 50 casos sintéticos/revisados, separando ejemplos de desarrollo y evaluación: múltiples operaciones, lucas, transferencias recibidas/pagadas, ARS/USD, cuotas, tickets con productos, fotos ilegibles, audio con ruido y correcciones. Medir por campo, número de operaciones, p50/p95, tasa de fallback y consumo de cuota; no publicar basándose solo en un JSON correcto.
4. Elegir el proveedor/ruta por resultados y conservar timeouts, deduplicación, números estables y confirmación atómica. Evaluar alternativa independiente dentro del mismo presupuesto, sin encadenar esperas largas.
5. Publicar una ruta habilitable y reversible únicamente después de pruebas y checks. La aceptación exige interpretación correcta de audio/foto válida; un pedido de texto aislado no cierra esa parte de INF-12.
