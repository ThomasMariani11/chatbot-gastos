# Validación BE-05 — consultas y operaciones por WhatsApp

Fecha: 25/10/2026 (Argentina). Base: main e311db4, después de aceptar BE-04. Rama: codex/backend-query-routing.
Estado: PR #41 integrada/publicada en cb2cef5; **whatsapp-webhook v56 ACTIVE**, comprobación técnica aprobada y prueba del propietario verificada. **BE-05 cerrado en el alcance probado**. La preparación se conserva como historial. No hay migración, secreto, modelo, proveedor ni dependencia nueva. BE-07 y BE-08 conservan su alcance.

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


## Publicación autorizada — 25/10/2026

- El propietario autorizó integrar PR #41 y desplegar whatsapp-webhook. Candidato b4bf2bd con los cuatro controles aprobados; integrado en cb2cef5ad1005299a41c5bce1aa46d38507c6b1e. Árbol integrado idéntico al candidato. [CI main y Publicar](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/40256874586) aprobados; el Webhook completo, incluidos endpoints, pasó en Linux. 723 pruebas generales.
- Preflight: v55 ACTIVE, verify_jwt=false, 32 migraciones, cola habilitada, cero trabajos v2 en procesamiento/leases activos y recuperación cron succeeded. Fuente de rollback v55 descargada; 17 módulos equivalentes al código e311db4 después de normalizar tokens JavaScript y quitar tipos/comentarios. Se repitió la comprobación de inactividad antes del deploy.
- Despliegue con CLI 2.120.0 desde main limpio, únicamente whatsapp-webhook, --use-api y --no-verify-jwt. Resultado **v56 ACTIVE**, bundle e7f074327164659a345414d319b22cb46cb5fe26ef425a9d4b2255a5339f5acd. Los 17 módulos descargados después coinciden con el checkout integrado, incluida intent.ts.
- Sin migraciones, secretos, modelos o configuración global nuevos. No se enviaron mensajes a clientes ni se creó una operación ficticia para comprobar el despliegue.
- POST al webhook sin firma y POST al worker sin secreto devolvieron 401 antes y después. Son pruebas negativas de autenticación; no validan la interpretación ni una entrega WhatsApp legítima. PWA version.json/SW coinciden con cb2cef5 y CSP presente.
- Postcheck: esquema 032 sin cambios, cola habilitada, mismos conteos (87 v2 procesados; ocho v1 pendientes y 30 v1 procesados heredados, sin reenviar), cero procesos/leases y recuperación succeeded. No se atribuyen esos mensajes históricos al agente ni se presume aceptación de negocio por esos agregados.
- Evidencia local sin contenido de clientes: C:/Users/thomi/AppData/Local/Temp/pesito-be05-release-2026-10-25/ (authorization, preflight/predeploy/post-health, edge-after, comparaciones de fuente, smoke, PWA y release-result). Manifiesto local actualizado con el alcance real de la comprobación.
- **Pendiente:** aceptación del propietario con lista inicialmente vacía: Suscripción Netflix 123; mensaje mixto Gasté 234 en super; pasame el alias; RESUMEN conservando solo el primer movimiento; CANCELAR. Consultas de soporte y saldo deben seguir respondiendo. No cerrar BE-05 antes de registrar el resultado; BE-07 siguiente, BE-08 separado. Retención desactivada y backups al final.


## Revisión de la prueba del propietario — 25/10/2026

Estado: aceptación parcial; faltan las consultas independientes de soporte y saldo.

- Cuenta identificada de manera única por la prueba anterior aceptada de Colectivo 60; consultas posteriores restringidas a esa cuenta. Cinco mensajes entre 23:06:27 y 23:07:10 de Argentina, todos processed en un intento; finalización del paso de envío en los cinco y tiempos totales de 531 a 3307 ms. Esto acredita aceptación de la API de envío, no lectura/entrega en el dispositivo.
- La entrada real de Netflix usó una cifra distinta del ejemplo 123. Se comparó en memoria con el parser productivo, el checkpoint y el ítem del borrador: un gasto, con importe, moneda, concepto y fecha coincidentes. No se copió el texto ni el importe real a la evidencia.
- El mensaje mixto devolvió la aclaración prevista y no originó ítems. El grupo terminó con una sola propuesta, versión 2, luego descartado, y el ítem removed. Cero grupos abiertos y cero transacciones nuevas en esa cuenta desde el despliegue.
- RESUMEN se procesó y se registró un resumen enviado a las 23:06:54. Su cuerpo no se conserva como historial: se comprueba el estado del grupo y el registro de envío, sin afirmar una inspección visual del WhatsApp del propietario.
- El último mensaje incluía tanto alias como saldo. Se respondió clarify, conforme al contrato de consultas de dominios distintos; no fue una prueba independiente de las respuestas de soporte y saldo. Enviar «Pasame el alias» y, en otro mensaje, «saldo disponible» para completar la aceptación. BE-05 no se cierra todavía.
- Una consulta global agregada fue rechazada por la revisión automática porque podía abarcar metadatos de otros clientes; no se ejecutó. La alternativa segura usó únicamente la cuenta identificada por la prueba anterior. Sin cambios productivos, mensajes enviados por el agente ni llamadas a IA. Evidencia saneada en acceptance-partial.json y acceptance-input-consistency.json de la carpeta temporal de release.


## Cierre de aceptación — 25/10/2026

Tras solicitar las consultas por separado, el propietario informó que las ejecutó y pidió revisarlas. Lectura de solo lectura restringida a la misma cuenta previamente identificada:

| Consulta | Hora Argentina | Resultado | Intentos | Tiempo total |
| --- | --- | --- | --- | --- |
| Soporte / alias | 23:16:46 | Respuesta comercial con alias; sin aclaración ni propuesta | 1 | 1692 ms |
| Saldo disponible | 23:16:53 | Respuesta de saldo con gastos, ingresos y balance; sin aclaración ni propuesta | 1 | 3388 ms |

Ambas quedaron processed, con efecto aplicado, paso de envío completado y sin incidente registrado. Cero ítems creados por esas consultas, cero grupos abiertos, cero trabajos de consulta sin terminar y cero transacciones nuevas de esa cuenta desde el despliegue. No se almacenan el alias ni los importes del saldo en la evidencia. El indicador de envío acredita aceptación de la API, no un comprobante de entrega/lectura del dispositivo.

Se suma a la carga de Netflix consistente con la entrada, la aclaración mixta sin ítems nuevos, el resumen registrado y el descarte ya verificados. **BE-05 cerrado en el alcance de las regresiones/CI y este ensayo del propietario.** La gramática finita y los límites del extractor se mantienen. No cierra BE-07/08/09/12/17 ni presume compatibilidad universal. No hubo cambios productivos ni llamadas a IA o mensajes del agente durante esta revisión. Evidencia saneada: acceptance-independent-queries.json y acceptance-complete.json en la carpeta temporal del release. Siguiente: revisar BE-07 antes de implementar, conservando las protecciones ya presentes.
