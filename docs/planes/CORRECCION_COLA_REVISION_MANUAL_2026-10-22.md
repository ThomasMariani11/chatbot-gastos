# Corrección de revisión manual — 22/10/2026

## Problema confirmado
Un mensaje v2 que agotaba reintentos quedaba en waiting/manual_review. next_whatsapp_job y due_whatsapp_actors trataban todas las pausas por igual: los mensajes nuevos del mismo cliente no llegaban a interpretación. Se observó un cliente afectado, tres mensajes sin intentos y ningún movimiento confirmado de esos mensajes. No se incluyen datos personales ni contenido financiero.

## Cambio
- 026 conserva el mensaje fallido para revisión, pero permite nuevas cargas y recuperación por cron.
- Aviso durable: explica que ese mensaje no se cargó, pide texto con concepto/monto y permite continuar sin cancelar la lista.
- Conserva aislamiento, FIFO entre mensajes elegibles, leases, idempotencia y confirmación explícita.
- Mantiene bloqueos stale/capacity/desconocidos y no modifica ni reproduce filas manual_review o v1.
- Los fallos de interpretación de IA siguen usando el aviso inmediato existente; este aviso cubre agotamiento de reintentos operativos. No se reducen los reintentos ni se promete respuesta inmediata ante caída total de BD o Meta.

## Validación
Regresión reproducida antes de corregir: recovery omitía al actor y next devolvía null. Pruebas SQL sintéticas cubren continuación de audio/texto, aviso, confirmación sin incluir el fallo, pausas intencionales, reaplicación y ACL. La publicación exige los cuatro checks de CI y ensayo de release; estado final se registra con lecturas verificadas en el PR.

## Operación
Aplicar solo 026 tras CI; no requiere nuevo Edge. Su aplicación habilita el procesamiento normal de pendientes v2 antes bloqueados y puede enviar respuestas del bot. No confirmar datos del cliente ni reintentar el mensaje aislado. Verificar cola y cron después. No se garantiza recepción/lectura del aviso si falla la plataforma de entrega.
