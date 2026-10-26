# Validación BE-04 — fechas, monedas e identificadores

Fecha: 25/10/2026. Base: main 54dce9e. Rama: codex/backend-parser-review.
Estado: corrección preparada y validada localmente; consultar CI de la PR sobre el SHA final. Integración, despliegue del webhook y aceptación WhatsApp pendientes. No hay migración, dependencia ni cambio de proveedor/modelo.

## Revisión y reproducción

Se revisaron las funciones productivas local-movements.ts, spoken-amounts.ts, processor.ts, helpers.ts y groq.ts, y sus regresiones. Ya están presentes las mejoras anteriores de centavos, ingresos con tilde, millones, listas completas y cuotas con total explícito. No se repitió la implementación histórica ni se comprobó el estado cloud del webhook en esta revisión.

Antes de cambiar código se reprodujeron casos ficticios sobre las funciones reales:

| Entrada | Resultado anterior | Resultado preparado |
| --- | --- | --- |
| Compré tornillos 10/10 por 1500 | Concepto Tornillos; fecha 10 de octubre | Sale de la vía local; conserva el mensaje completo para interpretar |
| Gasté 100 pesos colombianos en super | Propone 100 ARS | Sale de la vía local; no sustituye la moneda localmente |
| Gasté 100 dólares canadienses en super | Propone 100 USD | Sale de la vía local; no sustituye la moneda localmente |
| Limpiar iPhone 15 / Colectivo 60 / Ruta 9 | Borra el número final | Conserva el identificador |
| Limpiar Compré 7 Up | Borra el 7 | Conserva 7 Up |

La nueva batería del parser mostró 22 fallos antes de la corrección. La batería del limpiador mostró 11 antes de corregirlo; el nuevo módulo se extrajo primero sin alterar el comportamiento para probar la misma función productiva.

## Cambios

- Las fechas cortas DD/MM necesitan un marcador como el, el día o con fecha, o estar al inicio. Las fechas completas YYYY-MM-DD y DD/MM/YYYY al final conservan el formato admitido; hoy/ayer/anteayer y la validación de calendario se mantienen. Referencias intermedias sin contexto no se consumen como fechas. El dato ambiguo se deriva completo, sin publicar las otras partes del mensaje.
- Códigos monetarios detectados junto al importe y calificadores conocidos de pesos/dólares de otras monedas impiden la vía local ARS/USD. Es una lista acotada, no un catálogo universal. CAD dentro de un concepto con ARS explícito no se interpreta automáticamente como moneda.
- Pesos argentinos y dólares estadounidenses explícitos se resuelven localmente con el concepto limpio. Se conservan los valores predeterminados de moneda/fecha existentes.
- movement-description.ts contiene el limpiador puro compartido por Gemini y Groq; helpers conserva la exportación pública. No se borran números finales sueltos: pueden ser modelos, líneas o rutas. Se quitan importes con marcador monetario o prefijo de acción más conector explícito. Si un importe sin unidad queda en una descripción, se prioriza conservarlo frente a borrar un posible identificador.
- El prompt compartido distingue importe de identificador; solicita unknown sin movimientos para moneda distinta o contradictoria. Esto es una instrucción, no una garantía de cumplimiento semántico del modelo. No se agrega un conversor monetario ni se amplía el enum ARS/USD.
- No cambian confirmaciones, consultas comerciales/saldo, cola, suscripciones, plantillas WhatsApp, datos, secretos o límites de IA. El acceso a proveedores de las pruebas se sustituye; la red permanece denegada.

## Validación

- npm test: **675/675** aprobadas (628 anteriores y 47 nuevas: 29 del parser y 18 del limpiador). Incluye sumas/centavos, cuotas, permisos SQL y componentes existentes.
- npm run lint y npm run build/TypeScript aprobados. Continúa el aviso previo de bundle mayor a 500 kB; no es parte de este cambio.
- Deno 2.9.6: check y lint aprobados. **40/40 pruebas de routing** con --cached-only, --no-prompt y --deny-net aprobadas, sin permisos de lectura adicionales.
- Cuatro pruebas Deno nuevas sobre el procesador real: formatos nativos claros con cero llamadas a proveedores; ambigüedad y 503 con checkpoint request_text vacío en vez de una lista parcial; conservación de identificadores e importes después de respuestas ficticias de Gemini y Groq. Se amplió además el audio simulado: las mismas guardas se aplican después de transcribir, sin usar Whisper real.
- El comando completo Deno local encontró cuatro fallos anteriores de carga CJS del SDK Supabase por permisos de caché npm en Windows. Los otros 42 casos pasaron. Se probaron permisos de lectura acotados a las cachés sin cambiar configuración versionada, pero el resolver requirió otra ruta de búsqueda; se mantuvo el límite y no se declara la suite completa local aprobada. Los seis tests de queue_test.ts completos deben aprobar en el job Webhook de CI Linux con sus permisos habituales; no se usa --allow-all ni se habilita red para disimular el fallo.
- 12 escenarios npm run test:sql y seis guardas de release aprobados. Node local 24.21.0; CI usa el Node fijado 22.23.3 y ejecuta las cuatro verificaciones del repositorio, incluyendo PostgreSQL y ensayo de release.

## Alcance y límites

Los casos locales conservadores no generan borradores por sí solos: quedan sujetos al extractor existente. Si este falla o devuelve unknown, los ensayos prueban el pedido de texto sin aceptar fragmentos. Una respuesta incorrecta semánticamente pero válida del modelo puede necesitar controles adicionales de BE-08/BE-12; estas guardas no resuelven toda comprensión del lenguaje ni recuperan una transcripción equivocada.

BE-04 se mantiene en curso hasta revisar CI, autorizar y desplegar el webhook y aceptar el comportamiento acordado. Los hallazgos históricos no se presumen todos vigentes; las regresiones indican qué se cubrió. BE-05, BE-07 y BE-08 se revisan separadamente. No hubo llamadas reales a IA, WhatsApp ni Supabase; ninguna operación de clientes se modificó.

## Puesta en marcha prevista

1. Revisar diff y Frontend, Webhook, PostgreSQL y Ensayo de release sobre el SHA final. Registrar sus resultados en la PR.
2. Obtener autorización específica para integrar/publicar y desplegar whatsapp-webhook. GitHub Pages no despliega Edge Functions.
3. Antes de desplegar, verificar de solo lectura la versión Edge vigente y guardar rollback compatible desde un checkout limpio; no reutilizar números de versión históricos sin comprobarlos. No hay SQL nuevo ni reenvíos de trabajos.
4. Ensayo WhatsApp con mensaje ficticio autorizado, sin confirmar gastos reales; revisar números del concepto y cancelar al terminar. Revisión productiva de métricas sin contenido ni llamadas extra para cargar a otros clientes.
5. Registrar versión, salud de cola y aceptación, sin cerrar los demás criterios del backend automáticamente. Backups al final; retención sin cambios.
