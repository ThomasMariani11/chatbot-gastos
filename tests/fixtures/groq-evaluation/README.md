# Ejemplos ficticios para evaluar Groq

expense.wav: voz sintética Microsoft Helena (español de España), generada localmente diciendo «Gasté mil quinientos pesos en supermercado». No es un audio de un usuario ni reproduce OGG/Opus de WhatsApp.

receipt.png: comprobante dibujado localmente, comercio ficticio, dos productos de ARS 1.000 y ARS 500; total ARS 1.500; fecha 20/10/2026. No contiene información de clientes.

Ensayo sin red:

    node scripts/evaluate-groq.mjs --dry-run

Ensayo real con cupo gratuito ya verificado:

    node scripts/evaluate-groq.mjs --live

El modo real lee GROQ_API_KEY del entorno o una línea de entrada estándar. No colocar la clave en argumentos, archivos del repositorio ni el chat. La lectura de la credencial cifrada de esta PC se hace con un lanzador local ignorado, no incluido en Git. Ese lanzador solo debe usar la cuenta/clave de evaluación autorizada y respetar su vencimiento.

La prueba realiza ocho solicitudes de extracción y una transcripción, con separación de 25 s entre extracciones. Consume cuota: no se ejecuta desde CI ni desde npm test. Guarda metadatos y respuestas de estos casos exclusivamente sintéticos en .temp/groq-review/, ignorado por Git. No usar el programa con documentos de clientes. No escribe en Supabase ni envía mensajes por WhatsApp.

La fecha está fijada al 20/10/2026 para que coincida con el comprobante y las expectativas. Para medir disponibilidad hoy se debe interpretar esa fecha como fecha de la ficción, no como reloj real. La muestra no prueba precisión o disponibilidad generales.
