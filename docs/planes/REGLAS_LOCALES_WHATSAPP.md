# Reglas locales de WhatsApp para reducir el consumo de IA

Fecha: 20/10/2026. Estado: publicado en webhook v45 y aceptado en WhatsApp real. Relacionado con BE-12, BE-15 e INF-12; no cierra esos puntos completos.

## Orden de procesamiento

1. Validar vínculo, usuario, suscripción, bot activo y preferencias de respuesta.
2. Conservar las rutas comerciales y de saldo existentes, que no requieren IA.
3. Resolver comandos exactos mediante reglas locales. No interpretar el caption de una imagen como CONFIRMAR/CANCELAR.
4. Respetar la lista antigua: si está vencida, pedir resolverla antes de interpretar movimientos nuevos.
5. Resolver correcciones de importe por posición; ante una corrección incompleta, pedir un formato explícito sin invocar IA ni cambiar la lista.
6. Intentar interpretar el mensaje de texto completo con reglas locales. Si todas sus operaciones son claras, persistir el checkpoint y usar el mismo circuito de borradores/confirmación atómica existente.
7. Derivar a la IA cuando las reglas no puedan interpretar el mensaje completo. Los audios y las imágenes conservan su circuito actual de IA y pedido de texto ante fallos.

No se cambian proveedores ni modelos. No se usa la clave de evaluación de Groq en producción. Estas pruebas no consumieron cuotas de ningún proveedor.

## Formatos locales

| Caso | Ejemplo | Comportamiento |
| --- | --- | --- |
| Gasto explícito | `Gasté 1500 en super` | Gasto ARS, fecha local, categoría por palabras completas |
| Gasto abreviado | `21000 creatina` o `creatina 21000` | Gasto ARS, categoría Salud |
| Ingreso explícito | `Cobré 80k por diseño` | Ingreso de 80.000 ARS |
| Ingreso recibido | `Me ingresó 70mil de una transferencia` | Ingreso de 70.000 ARS |
| Moneda | `Cobré USD 100 por diseño` | Importe 100 en USD, sin conversión |
| Lista mixta | `Gasté 5000 super, 6000 proteínas y me ingresó 70mil de una transferencia` | Tres operaciones, sin IA |
| Concepto compuesto | `Gasté 250,50 en pan y leche y 4000 de nafta` | Dos operaciones; no separar pan y leche |
| Lista en líneas | Una operación por renglón, con viñetas o numeración | Interpretación completa; no recorta operaciones |
| Fecha | `Ayer gasté 100 en super`, `Gasté 100 en super el 19/10/2026` | Calendario validado; DD/MM usa el año actual |
| Cuotas | `Compré silla por un total de 12000 en 3 cuotas` | Total 12.000, tres cuotas; no dividir anticipadamente el total |
| Corrección | `El 2 fue de 250` | Cambia únicamente el importe de la posición estable 2 |
| Eliminación | `Sacame el movimiento 2` | Quita una sola posición; pedidos múltiples piden aclaración |
| Comandos | `CONFIRMAR`, `CANCELAR`, `RESUMEN`, `RETOMAR`, `DESCARTAR` | Sin IA; conserva controles y transacciones existentes |
| Ayuda | `hola`, `ayuda`, `comandos`, `gracias` | Respuesta fija sin IA |

ARS y USD se conservan en cada operación. Sin indicación: ARS, fecha local de Buenos Aires y categoría Otros si no hay coincidencia. La extracción mantiene el nombre histórico totalAmountArs, pero el importe corresponde a la moneda de la operación.

Las cuotas se resuelven localmente solo cuando se indica el **total** y entre 2 y 60 cuotas. El primer mes corresponde al de la fecha de la operación. Otras instrucciones de cuotas/mes inicial requieren interpretación; no se inventan.

## Límites y ambigüedad

- No tomar el primer número de un mensaje con varios importes sin entender el resto.
- No tratar preguntas, negaciones, deudas futuras, correcciones o transferencias sin dirección como gastos nuevos.
- No usar fechas o números de cuotas como importe. Rechazar fechas imposibles y cantidades negativas, cero o fuera del rango monetario admitido.
- No aceptar una parte de una lista cuando otra parte queda incompleta. Se deriva el mensaje completo; el manejo de faltantes de BE-08 continúa pendiente.
- No heredar un ingreso hacia un concepto abreviado sin verbo; no adivinar el alcance de fechas/monedas entre continuaciones distintas.
- Si un solo mensaje produce más de 20 operaciones, responder con el límite sin agregar ninguna de ese mensaje. No truncar. Si el exceso depende de operaciones ya pendientes, sigue actuando la validación atómica SQL existente.
- No agregar caché compartido de mensajes: podría mezclar usuarios, fechas o contexto. El checkpoint durable existente evita reinterpretar un resultado ya guardado.
- Las reglas son una gramática acotada, no comprensión universal del lenguaje. La categoría inferida sigue siendo una propuesta revisable por el usuario.

## Código y mantenimiento

- `supabase/functions/whatsapp-webhook/local-movements.ts`: gramática de importes, tipo, moneda, fecha, cuotas, categorías y lotes.
- `local-commands.ts`: vocabulario de comandos y respuestas fijas.
- `draft-corrections.ts`: edición local de importe y aclaración segura.
- `movement-types.ts`: contrato puro, compartido por Deno y las pruebas Node, sin cargar dependencias de ejecución del otro entorno.
- `helpers.ts`: conserva las exportaciones públicas; el respaldo después de un fallo de IA usa exactamente las mismas reglas conservadoras.
- `processor.ts`: integra las reglas después de los controles de acceso y antes de solicitar interpretación.

Para incorporar una variante: agregar primero casos positivos y ambiguos en `tests/deterministic-parser.test.ts` o `tests/local-commands.test.ts`, cambiar la gramática y probar el procesador real en `routing_test.ts` con proveedores sustituidos. Los tests del parser ahora importan el código productivo: se eliminó la copia divergente del parser que estaba dentro del test.

## Medición y validación

Evento permitido `local_rule`: únicamente rule (`command`, `correction`, `movements`) y cantidad de operaciones interpretadas. Se conserva `ai_attempt` para solicitudes a modelos. No se registran textos, importes, teléfonos, IDs, audios, fotos ni prompts. Una operación interpretada todavía no equivale a una operación confirmada.

Resultados locales:

- 306 pruebas Vitest aprobadas, incluyendo SQL aislado/PGlite y regresiones existentes.
- 35 pruebas Deno aprobadas con red denegada. Los HTTP de proveedores son respuestas ficticias sustituidas; ningún gasto ni mensaje real fue enviado.
- El procesador real resuelve una batería de 15 casos locales con **cero llamadas a proveedores**, incluidos listas mixtas, cuotas, correcciones, comandos y exceso de límite.
- Suscripción suspendida sigue bloqueando comandos y movimientos antes de interpretar.
- Preguntas y mensajes incompletos se derivan; un 503 de IA no habilita un parser más permisivo.
- Deno check/lint, ESLint y build TypeScript/Vite aprobados. Preparación offline del evaluador Groq aprobada, cero llamadas.

Esto demuestra las rutas cubiertas, no un porcentaje de ahorro real para los cuatro usuarios. Se medirá después de publicar, contando rutas locales y llamadas, sin registrar contenido. La implementación inicial no realizó migraciones ni cambios productivos. La publicación del punto 1 se registra a continuación.

## Siguiente validación al publicar

Con el webhook actualizado, enviar un lote mixto ficticio, corregir un importe, quitar una posición y revisar RESUMEN; terminar con CANCELAR si no se desea crear movimientos. Verificar métricas locales sin ai_attempt para esos mensajes. Probar audio/foto por separado cuando se integre y valide la alternativa de IA, respetando el presupuesto compartido del plan gratuito.

## Publicación del punto 1

Autorizada por el propietario el 20/10/2026. Preflight: main sincronizada con origin/main, webhook v44 ACTIVE, verify_jwt=false, base en 025 y cola habilitada, cero trabajos procesándose en la lectura. Publicación compatible sin SQL nuevo ni cambios de proveedores/secretos. Rollback fijado al código probado 3b3ea8c (v44), con las mismas 25 migraciones.

Controles adicionales previos: 12 escenarios SQL, seis guardas de release y npm audit sin vulnerabilidades. Exigir Frontend, Webhook, PostgreSQL y Ensayo de release del PR. Los cuatro controles aprobaron en el PR 13; se integró como ce216ec y se publicó desde un checkout limpio.

## Despliegue verificado

El [PR 13](https://github.com/ThomasMariani11/chatbot-gastos/pull/13) aprobó los cuatro checks en [39455220444](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/39455220444). El árbol del merge sintético del ensayo coincide exactamente con el candidato y con el squash integrado ce216ec3864b418795c97714fd048c8d4eceae59. Ensayo aislado con 25 migraciones, ejecución de candidato y rollback a 3b3ea8c, datos conservados, cero mensajes externos y limpieza aprobada.

CLI 2.120.0 desplegó únicamente los 12 módulos importados de whatsapp-webhook. Lectura posterior 2026-10-20T16:15:59.8762932Z: webhook **v45 ACTIVE**, verify_jwt=false; webhook sin HMAC y worker sin secreto responden 401. Base en 025, cola habilitada, cero trabajos en procesamiento y cero leases activos en esa lectura; última recuperación cron succeeded. Se verificó presencia de los seis secretos requeridos sin revelar valores; Groq no está configurado. Sin migraciones, cambios de credenciales/modelos, reenvíos históricos ni movimientos financieros creados por el agente.

**Aceptación en WhatsApp verificada (20/10/2026 16:54:02Z):** el propietario ejecutó la secuencia de 5 mensajes reales en WhatsApp (lista mixta de 3 operaciones, corrección de importe por posición, eliminación por posición estable, `RESUMEN` y `CANCELAR`). Lectura agregada de solo lectura en los últimos 15 minutos: 5 trabajos recibidos y procesados en 1 intento cada uno (`0,65 s` mín., `1,43 s` prom., `2,27 s` máx.), 5 respuestas entregadas, 1 grupo de borrador descartado (`discarded`), 0 grupos abiertos y 0 transacciones creadas. Métricas operativas de Edge Function en la ventana: `local_rule` registró `movements` (`operations=3`, 1 evento), `correction` (1 evento) y `command` (3 eventos), con **0 eventos `ai_attempt`** y 0 fallbacks. [Evidencia de publicación y aceptación](evidencias/REGLAS_LOCALES_2026-10-20.json).

## Revisión BE-04 preparada — 25/10/2026

Cambio todavía sin desplegar: DD/MM sin marcador solo al inicio; con el/el día/con fecha y fechas completas finales se mantiene la vía local. Referencias como tornillos 10/10 salen de esa vía en vez de perderse del concepto. Monedas detectadas fuera de ARS/USD también se derivan completas; pesos argentinos/dólares estadounidenses explícitos se reconocen. El limpiador compartido conserva números como iPhone 15, colectivo 60 y Ruta 9; no elimina números finales sin contexto monetario. Lista de detección acotada y semántica de IA no garantizada. [Pruebas, límites y publicación pendiente](VALIDACION_BE_04.md).

### Publicación de la revisión BE-04 — 25/10/2026

El bloque anterior fue publicado por autorización del propietario: PR #40/e311db4, whatsapp-webhook v55 ACTIVE. CI completo y comprobación técnica productiva aprobados. No hay migración ni cambio de claves, proveedores o modelos. El propietario confirmó la propuesta de $123 / «Colectivo 60» y su descarte con CANCELAR. BE-04 cerrado en ese alcance; la marca anterior de preparación se conserva como historial. [Evidencia](VALIDACION_BE_04.md).

## Revisión BE-05 preparada — 25/10/2026

Suscripción Netflix 5000 y Saldo SUBE 1500 llegan a propuestas; ventas/cobros por planes no se desvían a soporte. Las consultas explícitas de precios con cifras siguen respondiéndose localmente. Si hay una consulta mezclada con un movimiento o una frase ambigua reconocida, se pide separar/aclarar sin agregar ni modificar la lista ni limpiar el resumen. Los captions y audios conservan su ruta multimedia. No se activa un parser más permisivo ante fallos de IA ni se cambia la confirmación. Pendiente de CI/publicación y aceptación; [pruebas y límites](VALIDACION_BE_05.md).
