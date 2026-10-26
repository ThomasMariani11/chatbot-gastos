# Validación BE-05 — consultas y operaciones por WhatsApp

Fecha: 25/10/2026 (Argentina). Base: main e311db4, después de aceptar BE-04. Rama: codex/backend-query-routing.
Estado: candidato preparado; **no publicado**. No hay migración, secreto, modelo, proveedor ni dependencia nueva. BE-07 y BE-08 conservan su alcance.

## Reproducción sobre funciones reales

Antes de cambiar intent.ts, 21 casos de la primera ampliación fallaban: seis entradas claras se desviaban y 15 casos mixtos/ambiguos no pedían aclaración. La batería se amplió después con órdenes invertidos, consultas financieras ambiguas y fragmentos incompletos. Se reproducen decisiones del código, no se presume daño en datos de clientes.

| Entrada ficticia | Clasificador anterior | Candidato |
| --- | --- | --- |
| Suscripción Netflix 5000 | Soporte | Propuesta de gasto 5000 ARS |
| Saldo SUBE 1500 | Saldo mensual | Propuesta de gasto 1500 ARS |
| Vendí / Me pagaron / Me depositaron 5000 por planes de diseño | Soporte | Propuesta de ingreso 5000 ARS |
| Suscripción Netflix 5000 USD | Soporte | Propuesta de gasto 5000 USD |
| Gasté 1000 en super; pasame el alias | Texto completo al extractor | Pide separar; no agrega ni modifica pendientes |
| Pasame el alias y gasté 1000 en super | Texto completo al extractor | Pide separar; no elige solo soporte |
| Suscripción Netflix 5000 euros | Soporte | Pide aclarar; no convierte a ARS/USD |
| ¿Cuánto cuesta el plan de 5000? | Soporte | Conserva soporte; la cifra no se toma como gasto |

El envío de un mensaje mixto al extractor antes del cambio no demuestra por sí solo una pérdida: no se invocó un modelo real para sostener esa afirmación. La corrección agrega una decisión local segura para los formatos reconocidos.

## Implementación

- intent.ts distingue evidencia de operación, consulta y ambigüedad. Reutiliza parseDeterministicMovements para abreviaturas claras, con la fecha local del procesador; no duplica la extracción monetaria. Agrega verbos de venta/cobro que antes faltaban.
- Revisa cláusulas separadas por punto con espacio, punto y coma o salto de línea; comas/conjunciones solo ante inicios reconocidos. La coma decimal no se usa como separador de importes. Una consulta explícita puede contener cifras. Una pregunta que menciona un gasto pasado no se responde como precios de Pesito o saldo general.
- Mezclas reconocidas, dos consultas de dominios distintos, una consulta con otro fragmento sin resolver y términos ambiguos con cifras devuelven clarify. processor.ts responde con kind=reply y text, sin clear_summary ni efectos de alta/edición/confirmación. No consume IA, no lee el borrador y no lo modifica.
- Propuestas claras siguen por el flujo existente: borrador, checkpoint, resumen y confirmación. Consultas comerciales y saldo conservan sus respuestas. Correcciones y comandos mantienen prioridad; perfiles, suscripciones y preferencias siguen comprobándose antes.
- Imágenes y audios quedan fuera del clasificador textual. Las pruebas sustituyen descarga y extracción, verificando que un caption con palabras de consulta no descarte el archivo. No se añade respuesta rápida de saldo a audios ni se promete interpretación semántica universal de multimedia.

## Validación

- Suite general: **723/723 pruebas Vitest aprobadas**, incluyendo 46 nuevas del clasificador y dos SQL de preservación.
- Deno: siete pruebas nuevas del procesador real, **47/47 rutas aprobadas**, sin red. Ocho propuestas claras preservan importe/tipo/moneda sin llamadas; mensajes mixtos y ambiguos no generan checkpoint ni leen saldo/borrador; reintento conserva la respuesta. Consultas de soporte con cifras no usan IA. Saldo real conserva ARS/USD, presupuesto y filtro de propietario/status. Comandos, correcciones, suspensión y multimedia siguen cubiertos.
- SQL real con PGlite y migraciones del fixture de cola: respuesta de aclaración conserva grupo completo, ítems, versión, actividad, finanzas y estado del resumen; se prueban summary_pending=false y true. Reaplicar el trabajo con un alta distinta devuelve la respuesta ya persistida, sin crear movimientos; finalizar tampoco cambia el borrador. No usa tablas ni clientes de producción.
- ESLint, TypeScript/Vite y Deno check/lint aprobados; 12 escenarios SQL y seis guardas de release aprobados. Node local 24.21.0; CI usa la versión fijada 22.23.3. El aviso previo de bundle mayor a 500 kB permanece fuera de este bloque.
- La suite Deno completa local presenta los mismos cuatro fallos de carga CJS del SDK Supabase por permisos de caché npm en Windows; 49 casos pasan. No se amplían permisos ni se cambia la configuración para ocultarlo. El job Webhook de CI Linux debe aprobar la suite completa del candidato antes de publicar.
- No se hicieron llamadas reales a IA/WhatsApp ni cambios en producción. Los logs de las pruebas mantienen solo códigos operativos. Las pruebas locales no validan disponibilidad o cupos de proveedores.

## Límites y puesta en marcha

Es una gramática finita de consultas, no un clasificador universal. Los textos no reconocidos continúan en el extractor existente; los resultados semánticos de IA, consultas analíticas avanzadas y faltantes/correcciones de otros campos pertenecen a BE-08/09/12. La separación de cláusulas solo decide ruta: no recorta el mensaje que llega al extractor ni crea parcialmente propuestas. No se recuperan automáticamente mensajes históricos.

1. Revisar diff y los cuatro controles del SHA final: Frontend, Webhook, PostgreSQL y Ensayo de release.
2. Tras autorización concreta, integrar y publicar PWA y desplegar únicamente whatsapp-webhook desde checkout limpio. Pages no publica Edge Functions. Comprobar versión vigente y ausencia de trabajos en procesamiento, conservar fuente previa para rollback y verificar esquema/cola/cron sin cambiar configuración.
3. Aceptación con el propietario: RESUMEN; Suscripción Netflix 123; verificar propuesta; mandar «Gasté 234 en super; pasame el alias», comprobar aclaración; RESUMEN debe conservar solo el pendiente anterior. CANCELAR al terminar. Consultar «¿Cuánto cuesta el plan de 5000?» y «saldo disponible» para comprobar respuestas, sin crear movimientos.
4. Registrar evidencia, versión y resultado real. No cerrar BE-05 antes de publicar y aceptar. Continuar con BE-07 después; costo $0, retención desactivada y backups al final.
