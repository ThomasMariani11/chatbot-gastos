# Comparación autenticada de Gemini — 20/10/2026

Resultado: ocho intentos, cero respuestas exitosas. Seis HTTP 503 UNAVAILABLE y dos timeouts de audio a los 10 s. Producción no se modificó.

## Acceso y cuotas observados

AI Studio abrió la sesión existente y mostró un proyecto en nivel gratuito. Se verificó en memoria que la clave existente coincide por SHA-256 con el secreto configurado en Supabase. No se crearon claves, proyectos ni cuentas; no se activó facturación. La comparación usó esa clave con header x-goog-api-key. La transferencia local temporal se cifró; la clave privada permaneció en memoria y los archivos temporales de transporte usados se eliminaron.

| Modelo | Solicitudes/minuto | Solicitudes/día | Tokens de entrada/minuto | Máximo RPM/RPD observado en la vista de 1 día antes de probar |
| --- | ---: | ---: | ---: | --- |
| Gemini 3.8 Flash | 5 | 20 | 250.000 | 2 / 2 |
| Gemini 3.1 Flash Lite | 15 | 500 | 250.000 | 1 / 2 |

La vista de 28 días mostraba para 3.8 un pico de 7 RPM frente a 5 permitidas y de 19 RPD frente a 20. Son máximos de un período, no cupo restante ni evidencia de agotamiento actual. La vista de 1 día mostraba ambos por debajo del límite. El panel advierte hasta 15 minutos de retraso. No se vincula retrospectivamente ese pico histórico con los 503 de la prueba.

## Método y resultados

Prueba directa desde esta PC a v1beta/models/MODELO:generateContent. Una solicitud por combinación de modelo/caso, sin reintentos; ocho solicitudes en total. Se separaron los inicios del mismo modelo al menos 14 s, con solicitudes secuenciales. Los casos estructurados reutilizan el prompt y el esquema del helpers.ts actual, con temperature=0.1, sin cambiar thinking. La prueba mínima pide solamente OK y limita la salida a 32 tokens.

| Caso | 3.8 Flash | 3.1 Flash Lite |
| --- | --- | --- |
| Pedido mínimo OK | 503 en 1,07 s | 503 en 0,90 s |
| Texto: dos gastos y un ingreso ficticios | 503 en 1,71 s | 503 en 1,00 s |
| Audio sintetizado: gasto de ARS 1.500 | Timeout en 10,01 s | Timeout en 10,01 s |
| Ticket ficticio con dos productos y total ARS 1.500 | 503 en 2,00 s | 503 en 6,23 s |

Se utilizaron un WAV de voz sintética española de 138.884 bytes y un PNG generado de 17.261 bytes. No contienen información de clientes. El WAV no reproduce el codec ni el ruido de un audio real de WhatsApp. Los cuerpos JSON se limitaron a 256 KiB. El ensayo no envió mensajes por WhatsApp ni tocó la base de datos o el webhook.

## Interpretación y límites

- El fallo mínimo se reproduce sin descarga de Meta, cola, SQL, esquema de movimientos ni archivos. Es evidencia de que existe un fallo externo a esos componentes en las solicitudes observadas; no prueba que todo el backend esté libre de otros errores.
- La misma clave presenta fallos desde esta PC y en los registros previos de Edge. No se verificó una caída mundial ni una causa particular de capacidad, proyecto, región o cuenta.
- Ningún resultado permite comparar precisión de extracción o declarar ganador. Los tiempos son tiempos hasta fallo/timeout, no latencia de una interpretación correcta. Una muestra de ocho solicitudes no estima disponibilidad a largo plazo.
- No se probó configuración de razonamiento bajo en esta ronda: la respuesta mínima ya falló. No se subieron los timeouts ni se añadieron reintentos para prolongar la espera.
- Invertir principal/respaldo no resuelve los fallos demostrados y 3.8 dispone de un cupo diario mucho menor en esta cuenta. El dato de cuota corrige la recomendación preliminar de considerar 3.8 primero sin conocer aún sus límites reales.

## Decisión y siguiente paso

Mantener el orden productivo por ahora y el pedido de texto persistente. INF-12 continúa en curso por interpretación exitosa de medios pendiente. Evaluar una alternativa independiente dentro del objetivo USD 0, empezando con Groq Free para audio; falta cuenta/acceso y GROQ_API_KEY, por lo que aún no se hizo una llamada autenticada a ese proveedor. No reutilizar archivos de clientes para probarlo. Si Gemini vuelve a responder, comparar precisión y presupuesto con ejemplos independientes antes de publicar cambios.

[Evidencia saneada](evidencias/GEMINI_2026-10-20.json). [Evaluación de alternativas](REVISION_IA_2026-10-20.md).
