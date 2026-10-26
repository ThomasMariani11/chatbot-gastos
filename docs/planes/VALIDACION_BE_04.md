# Validación BE-04 — fechas, monedas e identificadores

Fecha: 25/10/2026. Base: main 54dce9e. Rama: codex/backend-parser-review.
Estado: PR #40 integrada/publicada en e311db4; whatsapp-webhook v55 ACTIVE y comprobación técnica aprobada. Aceptación WhatsApp confirmada por el propietario; cerrado en el alcance probado. La preparación y sus límites se conservan debajo. No hay migración, dependencia ni cambio de proveedor/modelo.

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

Este registro de preparación exigía revisar CI, autorizar/desplegar y aceptar el comportamiento acordado; los resultados posteriores se registran al final. Los hallazgos históricos no se presumen todos vigentes; las regresiones indican qué se cubrió. BE-05, BE-07 y BE-08 se revisan separadamente. No hubo llamadas reales a IA, WhatsApp ni Supabase; ninguna operación de clientes se modificó.

## Puesta en marcha prevista

1. Revisar diff y Frontend, Webhook, PostgreSQL y Ensayo de release sobre el SHA final. Registrar sus resultados en la PR.
2. Obtener autorización específica para integrar/publicar y desplegar whatsapp-webhook. GitHub Pages no despliega Edge Functions.
3. Antes de desplegar, verificar de solo lectura la versión Edge vigente y guardar rollback compatible desde un checkout limpio; no reutilizar números de versión históricos sin comprobarlos. No hay SQL nuevo ni reenvíos de trabajos.
4. Ensayo WhatsApp con mensaje ficticio autorizado, sin confirmar gastos reales; revisar números del concepto y cancelar al terminar. Revisión productiva de métricas sin contenido ni llamadas extra para cargar a otros clientes.
5. Registrar versión, salud de cola y aceptación, sin cerrar los demás criterios del backend automáticamente. Backups al final; retención sin cambios.

## Publicación autorizada — 25/10/2026

- El propietario autorizó integrar la PR #40 y desplegar el webhook. Candidato 167572e con los cuatro controles aprobados; integrado en e311db4bcc15b4c8ffa92f152c4cc9b9a401bc42. [CI main y Publicar](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/40254224019) aprobados, incluidos el Webhook completo en Linux y sus endpoints. 675 pruebas generales.
- Preflight: webhook v54 ACTIVE, verify_jwt=false, migraciones 001–032 registradas, cola habilitada, cero trabajos v2 en procesamiento y cero leases activos; cron de recuperación activo y última ejecución succeeded. Los ocho pendientes heredados v1 se conservaron sin reenviar; no son trabajos nuevos de este despliegue.
- Rollback: fuente de la v54 descargada y hashes guardados en carpeta temporal, junto con el SHA anterior 54dce9e. Se comprobó igualdad del código integrado con el candidato aprobado antes de desplegar.
- Despliegue desde main limpio con CLI 2.120.0, --use-api y --no-verify-jwt, únicamente whatsapp-webhook. Resultado: **v55 ACTIVE**, verify_jwt=false, bundle adc5af6c97dbcb187e8db6b996b7eabbf563a4e728a3731e41c3020860a80445. No se cambiaron secretos, configuración global, modelos ni esquema.
- Fuente descargada después del despliegue: equivalencia de tokens JavaScript normalizados, tras quitar tipos/comentarios, en index, processor, queue, local-movements, helpers, movement-description y groq frente al checkout integrado. Todas coinciden. Se conserva además la evidencia de hashes y salida CLI.
- POST sin firma al webhook y POST al worker sin secreto devolvieron 401 antes y después. Son pruebas negativas de autenticación, no aceptación de negocio ni validación de una firma legítima. No se leyeron claves service_role/sb_secret ni se enviaron mensajes a clientes.
- Postcheck: mismas 32 migraciones y mismos conteos, cola habilitada, cero procesos/leases y recuperación succeeded. PWA version.json y SW coinciden con e311db4; CSP presente. No se repitió la prueba física de actualización como si validara el negocio del bot.
- Evidencias locales sin textos/clientes en C:/Users/thomi/AppData/Local/Temp/pesito-be04-release-2026-10-25/: preflight-health.json, post-health.json, edge-after.json, source-comparison.json, smoke-before.json, smoke-after.json, pwa-proof.json y release-result.json. Manifiesto local actualizado con observaciones y alcance del smoke.
- **Aceptación WhatsApp — 25/10/2026:** el propietario confirmó que «Gasté 123 en colectivo 60» produjo $123 con concepto «Colectivo 60» y que CANCELAR descartó el pendiente. Se registra su comprobación manual; no se atribuye a este cierre una lectura SQL adicional ni una prueba universal del modelo. BE-04 cerrado en el alcance de las regresiones y este ensayo. BE-05/07/08 conservan su propio alcance.
