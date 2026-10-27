# Costos y cupos de la beta — INF-15

Revisión: 26/10/2026 (Argentina). Objetivo del propietario: costo adicional USD 0 para cuatro usuarios. Preparación en rama separada; sin cambios de plan, facturación, secretos, SQL ni webhook productivo. La gratuidad depende de las cuentas y del emisor efectivos, no del número de usuarios ni de un flag del cliente.

## Estado comprobado

| Servicio | Comprobación | Alcance |
| --- | --- | --- |
| Groq | Consola autenticada: organización Personal, Default Project, Free / Current Plan / $0 | No se creó ni revocó una clave. Límites base de la organización leídos sin llamadas de inferencia. |
| Supabase | Organización del proyecto productivo: FREE, compute NANO; Usage informa sin facturar excedentes en ese plan | Valores del ciclo visible, con refresco diferido; no representan una garantía de capacidad futura. |
| Meta | App en desarrollo, emisor marcado como número de prueba; coincide con el aprobado para avisos | Paso 2 ofrece registrar número propio y agregar pagos; no se ejecutó ninguna acción. No se revisó un libro de facturas ni se certificó la tarifa de un número real. |
| Gemini | Credencial presente; ruta secundaria de configuración si falta GROQ_API_KEY | No es respaldo automático de Groq. Nivel de facturación de Google sin verificar; no usarlo como alternativa gratuita garantizada. |
| GitHub Pages/Actions | Sitio estático público y workflow del repositorio; cuatro controles de CI | No se contrató un runner, hosting o monitor nuevo; no se promete un costo contractual por inferencia del código. |

### Groq: límites observados

| Modelo | Solicitudes/min | Solicitudes/día | Tokens/min | Tokens/día | Audio/hora | Audio/día |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| qwen/qwen3.8-27b | 30 | 1.000 | 8.000 | 200.000 | — | — |
| whisper-large-v3-turbo | 20 | 2.000 | — | — | 7.200 s | 28.800 s |

Los cuatro usuarios comparten los límites de organización: no se multiplican por cuatro ni por cantidad de claves. Fotos, contexto y respuestas largas cambian el consumo. La referencia antigua de unas 20–25 extracciones por persona/día es una estimación de fixtures, no una cuota impuesta ni una promesa. Qwen permite hasta 4096 tokens de salida por intento en el código actual, lo cual tampoco equivale a su consumo real.

La fuente para revisar límites futuros es la consola de la organización/proyecto, no una tabla pública tomada como garantía. Groq devuelve 429 al superar sus límites; pasar a Developer requiere una acción de facturación. [Límites oficiales](https://console.groq.com/docs/rate-limits), [facturación](https://console.groq.com/docs/billing-faqs) y [límites de gasto](https://console.groq.com/docs/spend-limits). Los límites monetarios del panel de planes pagos no son un presupuesto local de esta app Free.

### Supabase: muestra del ciclo observado

| Recurso | Uso visible | Incluido visible |
| --- | ---: | ---: |
| Egress | 0,16 GB | 5 GB |
| Base | 35 MB | 500 MB |
| Almacenamiento | 0 GB | 1 GB |
| Usuarios activos mensuales | 6 | 50.000 |
| Invocaciones Edge | 683 | 500.000 |
| Mensajes Realtime | 189 | 2.000.000 |
| Pico de conexiones Realtime | 4 | 200 |
| Ingesta de logs | 0,33 GB | 1 GB |
| Consulta de logs | 4,15 GB | 100 GB |

El panel cuenta usuarios de prueba además de las cuatro personas de la beta. La muestra no es un pronóstico ni una comprobación de facturas. En Free pueden restringirse servicios al alcanzar cupos; Spend Cap es una función de Pro y no se debe confundir con un bloqueo universal a todos sus extras. [Control de costos de Supabase](https://supabase.com/docs/guides/platform/cost-control). No activar Pro, PITR, IPv4, réplicas, dominios, log drains o recursos pagos para resolver un límite sin autorización específica.

## Controles que sí ejecuta el código

- Autorización/suscripción y bot activo antes de interpretar; comandos, consultas, correcciones y textos comprendidos por reglas locales evitan IA.
- Con GROQ_API_KEY no vacía se selecciona Groq. Un 429/503 termina con diagnóstico y pedido de texto persistido; no salta a Gemini. El checkpoint permite reintentar la aplicación/envío sin volver a interpretar ese mensaje.
- Whisper transcribe una vez por intento; si reglas/completado locales bastan, evita Qwen. Una imagen o un texto complejo puede requerir Qwen. No se invoca IA por cada movimiento de una lista.
- Qwen tiene timeout de 6 s para texto y 10 s para imagen; Whisper 10 s; existe presupuesto global de interpretación y límites de bytes. El estado de enfriamiento atiende headers de solicitudes/tokens y permite esperar hasta 3,5 s antes de rechazar. Está **en memoria por instancia**: no es un contador diario compartido ni reserva atómica de cuota entre workers. El límite global efectivo lo impone el proveedor.
- Los logs admiten códigos y números controlados; algunos intentos exponen remaining/retry_after técnicos. No hay un contador durable de tokens facturados ni una alerta de gasto monetario configurada por esta revisión. Las métricas de operaciones, retrasos y pedidos de texto de INF-14 no equivalen a consumo facturado de Groq.
- El transporte WhatsApp construye únicamente mensajes type=text. Ante un rechazo mantiene ese tipo; no habilita plantillas, otra cuenta o un proveedor pago. La variante argentina puede generar hasta dos peticiones, con el mismo timeout; petición, envío aceptado y entrega facturada son conceptos distintos.
- Los avisos administrativos automáticos usan el emisor de prueba aprobado y comparación con Meta antes de enviar, con ventana de 23 h 55 min, frecuencia y bandeja durable. Esta restricción **es propia de los avisos**: no afirmar que exista una comprobación global del emisor en todas las respuestas normales.

## Campos históricos sin efecto de corte

app_settings.paid_service_messages_authorized y cost_guard_date provienen de 001. Ninguna ruta activa del webhook los consulta. La lectura agregada encontró cuatro fechas vencidas y una bandera paid verdadera; no demuestra un cargo, una autorización actual de pagos ni que la cuenta de Meta tenga facturación activa. No se cambiaron filas ni se borraron columnas.

Se declaran **heredados y sin efecto de bloqueo**. No usarlos en una guía o interfaz como interruptor de facturación. Una retirada futura requiere revisar consumidores y una migración nueva; no reescribir 001 ni aplicar retroactivamente el corte de septiembre. Toda política de corte nueva exige fecha vigente, ámbito, comportamiento de mensajes en cola, aviso seguro y aprobación concreta antes de producción.

## Operación con costo objetivo cero

1. Antes de cada cambio de proveedor, emisor o plan, verificar en sus consolas el plan y los cupos efectivos. Registrar fecha y metadatos saneados; nunca copiar claves o medios de pago al repo.
2. Mantener Groq/Supabase en Free, conservar el emisor de prueba confirmado y no activar plantillas, paid tiers ni complementos. Retirar GROQ_API_KEY puede habilitar Gemini: tratarlo como cambio de proveedor y revisar facturación de Google antes, no como rotación inocua.
3. Revisar Usage/Rate Limits de Groq y Usage de Supabase durante la beta. Como criterio operativo propuesto: investigar al 75% de un cupo y acordar reducción del uso antes del 90%. **Son umbrales de revisión manual, no alarmas o cortes automáticos instalados.** No cortar confirmaciones pendientes ni eliminar mensajes para maquillar consumo.
4. Ante 429, no crear claves nuevas para evadir cupos ni habilitar un plan pago. Conservar el checkpoint/cola y pedir texto para la vía local. Con imagen/audio ambiguo, el pedido de texto no significa que se haya cargado el comprobante. El panel muestra degradación si se acumulan pedidos de texto según INF-14.
5. Antes de aumentar usuarios, tamaño de medios o reintentos, medir volumen de peticiones/tokens, duración de audios, tamaño de base/egress/logs e invocaciones Edge. Los cron activos se ejecutan cada minuto para recuperación/observación; la limpieza horaria no elimina contenido mientras retention_enabled=false. No equivalen necesariamente a una invocación Edge por tick.
6. Cualquier paso a número propio o plan pago necesita revisar precios, facturación, límites y mecanismos de corte. Un presupuesto de alerta no es garantía de ausencia de cargos. Los backups siguen al final y la retención desactivada.

## Fuentes que requieren cautela en Meta

Consultadas el 26/10/2026: la [FAQ oficial](https://whatsappbusiness.com/resources/faq/) menciona cobro por mensajes de servicio a partir del 1.001 mensual desde el 01/10/2026, mientras la [página de precios](https://business.whatsapp.com/products/platform-pricing) describe mensajes de servicio gratuitos dentro de 24 horas. Se registra esa discrepancia; no se elige una frase comercial como garantía de costo cero de un número real. Revisar la cuenta y la documentación/tarifa aplicable antes de cambiar el emisor. Esta revisión no calcula una tarifa argentina ni da por comprobada una factura o la gratuidad de Gemini. [Facturación de Google](https://ai.google.dev/gemini-api/docs/billing/).

## Evidencia y pendientes

[Snapshot saneado](../planes/evidencias/INF_15_2026-10-26.json) y [validación INF-15](../planes/VALIDACION_INF_15.md). Sin claves, teléfonos de clientes, contenido financiero ni facturas privadas. Es una preparación documental y de regresiones: no cambia el webhook ni su política de proveedores en producción. La revisión del emisor de prueba y de las cuentas Free quedó completada. El cierre general sigue abierto para cualquier garantía de corte global, aprobación de umbrales/alertas de consumo y tratamiento definitivo de los campos heredados; no se promete un bloqueo universal de USD 0 desde el código actual. Pasar a un emisor real o habilitar Gemini requiere otra comprobación y autorización.
