# Groq gratuito para cuatro personas — capacidad estimada

Fecha: 20/10/2026. Objetivo: pruebas con cuatro usuarios y costo adicional USD 0. No se activa facturación ni se cambia el bot en este análisis.

## Revisión vigente — 26/10/2026

Groq está integrado y la cuenta sigue en Free, con los mismos límites base observados de Qwen/Whisper. La credencial productiva fue renovada sin vencimiento el 23/10; no usar las claves de evaluación antiguas para verificar cuotas. [Estado y controles actuales](../operaciones/COSTOS_Y_CUPOS.md). Las mediciones y estimaciones del 20/10 que siguen son históricas: los prompts cambiaron, por lo que no garantizan una cantidad diaria de mensajes. El enfriamiento actual usa headers por instancia; no es un presupuesto diario durable compartido.

## Límites de esta cuenta

Leídos en la consola autenticada y contrastados con la documentación pública. Se comparten entre los usuarios de la app que utilizan la misma organización; no son cupos por persona ni se multiplican creando claves nuevas.

| Recurso/modelo | Por minuto | Por día | Otros límites |
| --- | --- | --- | --- |
| Extracción de texto/fotos: qwen/qwen3.8-27b | 30 solicitudes y 8.000 tokens | 1.000 solicitudes y 200.000 tokens | Se alcanza el primero de los límites |
| Audio a texto: whisper-large-v3-turbo | 20 solicitudes | 2.000 solicitudes | 7.200 segundos de audio/hora y 28.800 segundos/día |

Los 28.800 segundos equivalen a ocho horas de audio diarias entre todos; los 7.200 segundos/hora equivalen a dos horas de material por cada hora de reloj (posible con varios usuarios). Si se dividiera equitativamente el cupo diario, serían dos horas de audio por persona. Es un techo de transcripción: el texto obtenido puede consumir después el cupo de extracción.

Fuente: [Groq: límites por organización, respuestas 429 y headers de cupo](https://console.groq.com/docs/rate-limits). La cuenta Free sigue siendo la observada; no se contrató Developer. Los límites pueden cambiar y no garantizan disponibilidad continua.

## Qué consume una acción

- Texto simple o comandos resueltos por las reglas actuales: pueden consumir cero llamadas de IA.
- Texto complejo o foto procesada por Qwen: normalmente una llamada de extracción por mensaje.
- Audio en la ruta probada: una llamada a Whisper y otra a Qwen. Son presupuestos de modelos diferentes, no dos llamadas de Qwen.
- Varios movimientos juntos: pueden salir de una sola llamada, aunque aumentan los tokens de respuesta.
- Correcciones que requieran IA, repeticiones y reintentos consumen más cupo. Confirmaciones y consultas deterministas pueden evitarlo.
- Los movimientos ingresados desde la app no consumen automáticamente Groq. La integración del bot ya está publicada; la carga manual de la PWA no usa esos modelos.

## Estimación con consumo medido

En los seis casos REST iniciales, Qwen informó 9.274 tokens en total entre entrada y salida: promedio 1.545,67 por llamada. Incluyen un ticket y una corrección. No es una muestra representativa de clientes; se usa como referencia conservadora inicial, sin asumir ahorro por caché.

- Tope teórico de tokens: floor(200.000 / 1.545,67) = 129 llamadas diarias entre los cuatro.
- Reservando 20% para variaciones y pruebas: floor(160.000 / 1.545,67) = 103 llamadas diarias; aproximadamente 25 por persona si se reparten por igual.
- El techo de 1.000 solicitudes no sería el primero en alcanzarse con ese tamaño de prompt.

| Uso supuesto de cada persona | Llamadas de extracción entre los cuatro | Tokens estimados/día | Evaluación |
| --- | ---: | ---: | --- |
| 10 al día | 40 | 61.827 | Margen amplio bajo este supuesto |
| 20 al día | 80 | 123.654 | Cabe en el presupuesto de referencia con reserva |
| 25 al día | 100 | 154.567 | Cerca del presupuesto con reserva |
| 30 al día | 120 | 185.480 | Poco margen; fotos/contextos largos pueden excederlo |
| 40 al día | 160 | 247.307 | Supera el cupo de tokens estimado |

Estas son llamadas que efectivamente llegan a Qwen, no necesariamente mensajes de WhatsApp ni movimientos guardados. Las reglas locales pueden reducirlas y las listas largas pueden aumentar el consumo.

## Fotos y ráfagas

El ticket inicial consumió 2.570 tokens. Si todas las llamadas fueran de ese tamaño, el máximo sería unas 77 por día, o 62 con reserva de 20%; aproximadamente 15 por persona con reserva. Otros tamaños/resoluciones o tickets más complejos pueden consumir más.

En un minuto, cuatro textos del tamaño medio sumarían alrededor de 6.183 tokens, dentro de 8.000. Cuatro fotos del tamaño del ticket sumarían 10.280 y podrían exceder el cupo aunque solo sean cuatro solicitudes, muy por debajo de 30 RPM. Hace falta coordinar el presupuesto entre usuarios, no solamente limitar a cada uno por separado.

No se agotó el cupo ni se provocó un 429 en producción para demostrarlo. Se verificaron los límites del panel y headers de respuestas de prueba; la estimación se hace por cálculo. La API informa retry-after ante 429 y headers de tokens/solicitudes. Deben usarse en la integración para moderar el siguiente intento, conservar el mensaje y dar una respuesta clara.

## Recomendación para la beta

Planificar inicialmente hasta unas 20 llamadas de extracción por persona/día con esta mezcla de referencia; no imponerlo como una garantía ni como una cuota nueva al cliente. Medir consumo real antes de fijar límites. Mantener las reglas para comandos/textos claros, agrupar movimientos y evitar reintentos indiscriminados. La recuperación con espera limitada ya está implementada; un presupuesto durable compartido y métricas contables de tokens siguen como trabajo por acordar, no como controles instalados.

Si se alcanza un límite, mantener la operación pendiente o solicitar texto según el caso; no perderla ni guardarla automáticamente. No presentar el plan gratuito como ilimitado ni prometer ausencia de fallos para cuatro usuarios.

Para un lanzamiento público, evaluar costos con el volumen observado, disponibilidad, privacidad y un proveedor de respaldo independiente. Un plan pago eleva cupos, pero no elimina las interrupciones: siguen siendo necesarios timeouts, idempotencia, confirmación y manejo de errores. No se contrata nada ahora.

Evidencia de consumo: [primera prueba](evidencias/GROQ_2026-10-20.json). Evidencia de los casos corregidos se registra en el seguimiento de validación.

## Consumo de la segunda ronda

Las seis llamadas corregidas consumieron 8.943 tokens, promedio 1.490,5. Esa mezcla daría aproximadamente 134 llamadas diarias o 107 reservando 20%. Para planificar se conserva la referencia anterior, algo más prudente, de unas 100 llamadas entre todos con reserva. Las instrucciones adicionales y el esquema estricto no se consideran una optimización garantizada: cambiar el contenido, la lista pendiente o las fotos cambia el consumo.

Los resultados de los dos casos revisados y la evidencia por campo están en [la validación](VALIDACION_GROQ_2026-10-20.md). No se realizó un ensayo de saturación ni una prueba sostenida de 24 horas. El modelo se consultó con la separación de 25 s de la prueba; el servicio productivo deberá gestionar el presupuesto agregado de los cuatro usuarios y atender a los headers, que pueden incluir reserva/estimación de tokens además del uso final.
