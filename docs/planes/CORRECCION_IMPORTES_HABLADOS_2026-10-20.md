# Corrección de importes hablados — 20/10/2026

Estado: implementación validada localmente; publicación y aceptación WhatsApp pendientes. Trabajo relacionado con BE-04, sin cerrar todos sus criterios.

## Error y resultado

La normalización anterior podía convertir una parte de un número y dejar el resto en el concepto. Se reprodujo primero una regresión con código real, sin red, que fallaba al esperar 1.200.000.

| Texto de ejemplo ficticio | Antes | Corregido |
| --- | ---: | ---: |
| Gasté un millón doscientos mil en alquiler | 200.000 | 1.200.000 |
| Gasté doscientos pesos con cincuenta centavos en panadería | 200 | 200,50 |
| Gasté trescientos y veinte en super | 300 | 320 |
| Gasté 2 mil quinientos treinta y cinco en super | 2.535 | 2.535, regresión conservada |

## Cambio

- `spoken-amounts.ts` es un módulo puro compartido por pruebas Node y el webhook. Reemplaza la normalización parcial y mantiene la exportación pública desde `groq.ts`.
- Se interpretan expresiones numéricas completas con centenas, miles, millones e híbridos de dígitos/palabras. Las unidades de centavos admitidas van de 0 a 99; se forman decimales sin sumar fracciones en punto flotante.
- Se conservan monedas, fechas, conceptos, límites y el total de cuotas. No se mezclan operaciones a través de un salto de línea.
- Expresiones inválidas o no soportadas se dejan sin resolver. La gramática local rechaza residuos numéricos, magnitudes y fracciones dentro de la descripción, tanto en texto como después de transcribir. Se deriva el mensaje completo al extractor; ante fallo se solicita texto, sin crear un borrador parcial.
- Los artículos `un` y `una` no se convierten por sí solos en importes. Conceptos con otras palabras numéricas pueden requerir IA por precaución.
- No se cambia el modelo Whisper Turbo, el proveedor, sus claves, sus cuotas ni la confirmación financiera. No contiene migraciones.

## Verificación

- Regresiones sobre el código real: millones, centavos ARS/USD, centenas con conjunción, formatos numéricos argentinos/ingleses, ingresos de 70 mil, fechas, cuotas y listas mixtas.
- El procesador completo se ensaya con transcripción ficticia: los importes claros no invocan Qwen; los ambiguos solicitan interpretación y no conservan propuestas parciales.
- Conservados 12 escenarios SQL y seis guardas de release. Tipos, lint y build aprobados localmente; el aviso previo de tamaño de bundle sigue fuera de este cambio.
- 354 pruebas Vitest y 35 pruebas Deno de rutas aprobadas localmente. Los cuatro checks del PR deben aprobar antes de desplegar. Las pruebas Deno de rutas se ejecutan sin red; el conjunto completo de endpoints/concurrencia y el ensayo Supabase se valida en CI Linux, por la limitación de caché npm/Deno en Windows ya observada.

Las pruebas no consultan proveedores reales ni crean movimientos de clientes. Esto corrige la interpretación de una transcripción; no recupera palabras o importes que Whisper haya transcrito incorrectamente. Se conserva la revisión y confirmación del usuario.

## Publicación prevista

Usar una rama y PR con Frontend, Webhook, PostgreSQL y Ensayo de release aprobados. Desplegar únicamente `whatsapp-webhook` desde el commit integrado y checkout limpio. Base requerida 025, cola existente activa, sin reenvíos ni cambios de datos. Rollback al código v49 validado anterior al cambio. Registrar versión real, smoke de autenticación y salud de cola después de publicar.

## Dependencia necesaria para publicar

El primer CI bloqueó el job Frontend durante npm audit: la versión Vite 8.0.16 ahora tiene tres avisos de launch-editor, incluido GHSA-587h-7wmj-h5pm de severidad alta. Se actualiza exclusivamente la dependencia directa de desarrollo Vite a 8.1.6 (versión corregida de la rama más cercana) y su resolución de herramientas opcionales, sin npm audit fix --force ni cambios de dependencias productivas. npm audit vuelve a informar cero vulnerabilidades; se repiten pruebas, build y CI antes de publicar.

Avisos oficiales: [bypass en Windows](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm), [argumentos de editor](https://github.com/vitejs/launch-editor/security/advisories/GHSA-r825-w8mm-5pxw) y [escape de porcentajes](https://github.com/vitejs/launch-editor/security/advisories/GHSA-698v-4r3x-3vcv). Esto es una corrección de herramientas de desarrollo; no demuestra un compromiso de la aplicación publicada.
