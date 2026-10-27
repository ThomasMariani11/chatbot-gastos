# Validación BE-08 — operaciones incompletas y dudas

Fecha: 26/10/2026 (Argentina). Base: main 1688c7b, migración 033, webhook v56.
Estado: PR #43 integrada/publicada en bd896f0; migración 034 aplicada/verificada y webhook v58 ACTIVE. Cuatro controles y Pages aprobados. Aceptación WhatsApp del propietario verificada: BE-08 cerrado en el alcance probado. La preparación que sigue es histórica.

## Reproducción y alcance

La revisión no confirma todos los defectos históricos de la auditoría: 020/023 ya persisten missing_fields y conservan confidence=0 mediante coalesce. El problema vigente era el rechazo del mensaje entero al recibir una extracción parcial válida, amount/occurred_on NOT NULL y la sustitución de una fecha expresamente desconocida por hoy. Cinco nuevas pruebas SQL fallaron con el esquema anterior; pasan con 034. No se consultaron mensajes de clientes para reproducirlo.

Se conserva el contrato de BE-07: versión mostrada vigente, exclusión por usuario, autorización/suscripción, confirmación atómica e idempotencia. No se cambia ningún proveedor, modelo, clave, límite de IA, facturación o configuración de alertas.

## Comportamiento preparado

- Una lista mezcla operaciones completas e incompletas. Los faltantes amount/date/description/review se conservan por ítem, con la duda acotada a 500 caracteres y confianza cero intacta. La tabla de movimientos definitivos no admite faltantes.
- Normalización compartida de Gemini/Groq y checkpoint: rechaza importes no positivos, no finitos, con más de dos decimales o fuera de rango; enums, fechas inexistentes, cuotas y confianza inválidos. Una respuesta estructuralmente inválida solicita texto y conserva el mensaje en la cola; no intenta rescatar una parte arbitraria.
- ARS, fecha local y Otros siguen siendo predeterminados cuando no se indican. Una fecha expresamente marcada como desconocida permanece NULL. La categoría no es esencial; una duda exclusivamente de categoría no bloquea la lista ni reaparece al validar un checkpoint.
- Texto simple: “Gasté 101 en super y pagué alquiler” crea dos borradores, el segundo sin importe, sin llamar a IA. Se conserva la gramática previa conservadora. La detección finita de identificadores iPhone/Galaxy/modelo/colectivo/ruta evita tomarlos automáticamente como importe; no promete reconocer todos los modelos posibles.
- Completar: “El 2 fue de 5000”, “El 2 fecha 2026-10-26”, “El 2 concepto farmacia”. Un importe o fecha sin número solo completa cuando hay un único candidato de ese campo. Un gasto nuevo explícito sigue agregándose. Para review: reformulación completa “El 2: gasté 5000 en farmacia”, o quitar el ítem. No se elimina una duda con un sí genérico.
- La acción complete lleva grupo y versión observados. La función auxiliar privada valida propietario, grupo abierto, posición pendiente y versión; mantiene identidad y origen. No tiene EXECUTE para anon/authenticated/service_role; solo la RPC autorizada puede utilizarla. Las instrucciones internas de completado no forman parte de las intenciones admitidas de los proveedores.
- Whisper utiliza el mismo completador local tras transcribir, sin Qwen para ese caso. Si Gemini devuelve una corrección sobre un incompleto, se solicita una respuesta textual explícita; no se atribuye una transcripción inexistente ni se adivina el objetivo.
- El resumen indica importe/fecha/concepto pendiente y las acciones posibles, mantiene números estables, USD/ARS, centavos y cuotas. No expone preguntas libres del proveedor. Hasta 20 ítems caben en 4096 unidades UTF-16; se abrevian solo conceptos largos en la presentación, con aviso, conservando cifras/metadatos/datos guardados y pares Unicode.
- Una confirmación con faltantes no crea ninguna transacción. Tras completar o quitar, exige el resumen actualizado y otra confirmación. Un mensaje retenido por capacidad no se libera al completar/corregir, porque no se liberó un lugar; quitar/confirmar conserva el circuito existente. Respuestas numéricas/fechas pueden resolver un faltante detrás de una pausa de capacidad. Los mensajes antiguos conservan la pausa stale.

## Pruebas locales

- 781/781 Vitest en 39 archivos: 735 anteriores, cinco del lector real, 32 de normalización/parser/completado y nueve regresiones SQL (115 casos de cola en total).
- SQL real PGlite: lote completo/incompleto, confianza cero y dudas; bloqueo de toda confirmación; resolución de tres campos y versión antigua rechazada; guardado final atómico de cuotas ARS y un ingreso USD; quitar incompleto; derivación de flags ante NULL; rollback de un mensaje inválido; review por duda libre; aislamiento/permisos; capacidad 20 y posición 21 tras quitar sin renumerar.
- 53/53 Deno routing sin red con proveedores/Meta simulados: altas completas/incompletas locales, completado único/ambiguo, Gemini/Groq con checkpoint/reintento y categoría predeterminada, Whisper sin Qwen, rechazo de una intención interna inventada por proveedor. Tipos y lint Deno aprobados.
- ESLint, TypeScript/build, 12 escenarios SQL de renovaciones y seis guardas de release aprobados. Advertencia previa de bundle >500 kB conservada. Node local 24.21.0; CI utiliza 22.23.3 fijado.
- Script PostgreSQL nativo ampliado: aplica 034, bloquea confirmación parcial, aplica el mismo completado concurrentemente desde dos conexiones, rechaza una versión vieja y confirma exactamente dos movimientos. Sintaxis local y resultado nativo aprobados en PostgreSQL 17.11, con las tres guardas BE-08 verdaderas y las de BE-07 conservadas.
- Ensayo CI ampliado: ejecuta lector candidato y puente con 20 ítems incluyendo NULL, además de instalación completa, ambos runtimes/PWA, rollback y persistencia de datos. Aprobado sobre el candidato funcional 4f83c07: lector nullable candidato/puente, 34 migraciones, Auth, ambos webhooks/PWA y rollback sin restaurar datos. No se amplían permisos de Deno para sortear la limitación de caché Windows de endpoints ya documentada; suite completa en CI Linux.
- Cero llamadas a IA real, cero mensajes externos y cero cambios productivos durante la preparación.

## Publicación por etapas y rollback

1. Exigir cuatro controles aprobados sobre el SHA final, revisar diff, esquema real 033, fuente v56, cola/leases y permisos. Guardar evidencia de código/ACL anterior sin exportar datos de clientes.
2. Con autorización concreta, desplegar primero el puente **80e920dcad9581bbff2d54b2c48ae2e255fe6882**, fijado como rollbackCommit. Solo extrae el lector nullable y acota su mensaje; mantiene el procesador anterior y muestra instrucciones compatibles (RESUMEN/quitar/CANCELAR). No habilita la nueva extracción parcial. Verificar versión/hash/smoke antes de SQL.
3. Esperar quietud del trabajo anterior durante la ventana controlada, aplicar/registrar exclusivamente 034 de forma atómica y verificar columnas, funciones completas, triggers, propietario y permisos; abortar si las definiciones previas no coinciden. No backfill ni reenvíos. No reescribir 001–033.
4. Integrar/publicar la PR y desplegar el webhook final que requiere 034. Pages no aplica SQL ni despliega Edge. Verificar código exacto, historial, salud, reanudación del estado previo de cola y controles de main. No recuperar claves de servicio ni desactivar las restricciones de acceso.
5. Rollback de runtime: conservar 034 y desplegar el puente fijado. Conserva y muestra los incompletos, pero el procesador viejo tiene funcionalidad reducida para completar fecha/concepto; se puede revisar/quitar/cancelar. **No volver directamente a v56/v52:** su lector supone amount no nulo. No down/reset/restauración ni eliminación de pendientes. Para restaurar funcionalidad completa, corregir hacia adelante.
6. Aceptación propuesta con la cuenta del propietario tras publicación autorizada: enviar “Gasté 101 en prueba completo y pagué prueba alquiler”, comprobar dos ítems y el faltante, responder “El 2 fue de 202”, ver RESUMEN y CANCELAR. Verificar que no existan transacciones nuevas de la prueba. No confirmar gastos ficticios sin acordarlo ni contactar a otros clientes.

## Límites y cierre pendiente

Las pruebas no garantizan comprensión de todo lenguaje, entrega/lectura de WhatsApp ni disponibilidad de proveedores. Si el extractor devuelve un dato erróneo pero estructuralmente válido, el cliente debe revisar el resumen. El resumen largo abrevia conceptos para respetar el transporte; no altera el borrador almacenado. Si un caso no cabe, se rechaza la emisión y no se marca como mostrado.

BE-08 continúa en curso hasta registrar CI, publicación/verificación y aceptación en el alcance acordado. BE-12/BE-17 no se cierran por extensión. Retención desactivada, costo $0 y backups INF-08 al final.

## CI y revisión del candidato

[PR #43](https://github.com/ThomasMariani11/chatbot-gastos/pull/43), candidato funcional 4f83c07404daeec16693079f9fcbbca9a73c3070; [run 40396083121](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/40396083121) aprobó Frontend, Webhook, PostgreSQL y Ensayo de release. Publicar se omite en PR como corresponde. El job Frontend incluye npm audit, 781 pruebas, SQL/guards y build; el Webhook ejecutó su suite completa Linux con red denegada. Se revisaron las fases saneadas y la evidencia nativa. Un ajuste documental posterior debe volver a pasar los controles sobre su nuevo SHA antes de integrar; no cambia la fuente funcional validada. Producción sigue en 033/v56, sin nuevas pruebas ni escrituras remotas.

## Publicación autorizada — 26/10/2026

- El propietario autorizó el puente compatible, 034 e integración/publicación de PR #43. Head aprobado b4402c661957069d1df760e8f8caf068477efc17, integrado por squash en **bd896f02206a3cffa22d292ac1ef230778e0b0c8**, árbol idéntico al candidato. [CI main y Pages](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/40405253148) aprobados, con 781 pruebas, Webhook completo, PostgreSQL 17.11 concurrente y ensayo de instalación/rollback. El conector GitHub rechazó el permiso de integración; se usó el acceso Git autenticado del repositorio, sin bypass de controles ni publicación anticipada de Pages.
- Preflight: historial 001–033, v56 ACTIVE, 17 módulos descargados coincidentes con main 1688c7b, cola habilitada, cero procesos/leases y recuperación succeeded. Fuente/atributos anteriores guardados como evidencia de código, sin exportar mensajes ni transacciones.
- Etapa 1: puente 80e920dcad9581bbff2d54b2c48ae2e255fe6882 desplegado como **v57 ACTIVE**; 18 módulos coincidentes con el archivo de ese SHA, verify_jwt=false y dos rechazos HTTP 401 sin firma/secreto verificados.
- Etapa 2: **034 aplicada y registrada atómicamente** en schema_migrations. Se preservó el SQL aprobado, normalizado a LF, SHA-256 dea36522e3ad3ab2ae4270165c1bb6844b82c7402b87a456cbca66016788d635; MD5 del texto registrado 446e7dcf405d6abcec21e3ccce36e3a1. La transacción verificó historial, hashes de las funciones anteriores y ausencia de procesos/leases bajo bloqueos breves; lock_timeout 5 s y statement_timeout 20 s. No se apagó ni reconstruyó la cola. Sin backfills ni reenvíos.
- Las seis funciones completas coinciden con el resultado calculado al aplicar el SQL sobre código previo en base descartable. Propietario, ACL, SECURITY DEFINER y search_path de las cuatro funciones existentes conservados; permisos efectivos anon/authenticated rechazados y backend preservado. Los dos helpers nuevos no son ejecutables por service_role. Columnas nullable y trigger habilitado comprobados.
- Etapa 3: webhook final **v58 ACTIVE**, bundle 48c3889d141fc4282a9df719fbe4b379ea2471138df918311d868fc8cc5596a7, verify_jwt=false; 20 módulos descargados coincidentes con el código publicado. Nuevos rechazos 401 sin firma/secreto, PWA version.json y SW del SHA bd896f0, bundle servido y CSP presente verificados.
- Salud posterior: esquema 001–034, cola habilitada, cero procesos/leases, recuperación succeeded. Se conservan conteos: 94 trabajos v2 procesados; ocho v1 pendientes y 30 v1 procesados heredados. No se alteraron teléfonos, suscripciones, proveedores, modelos o movimientos de clientes, ni se mandaron mensajes externos.
- Evidencia saneada: C:/Users/thomi/AppData/Local/Temp/pesito-be08-release-2026-10-26/ (autorización, preflight, fuentes anteriores/puente/final, preparación/hashes, migración/verificación, salud, Edge, PWA y release-result). Manifiesto local release-production actualizado con alcance y aceptación pendiente.
- **BE-08 publicado y verificado técnicamente; falta aceptación WhatsApp del propietario.** Probar la lista con importe faltante, completar el 2, revisar y CANCELAR, sin confirmar ni guardar movimientos ficticios. Si RESUMEN muestra pendientes previos, no descartarlos para hacer la prueba. Costo $0, retención desactivada y backups al final.

## Aceptación y cierre — 26/10/2026

El propietario realizó la prueba y solicitó revisarla/cerrar el bloque. La lectura quedó restringida a la cuenta encontrada mediante el mensaje ficticio exacto, posterior a v58; no se inventariaron otras conversaciones ni se expusieron teléfonos/identidades.

| Paso | Hora Argentina | Resultado | Intentos | Tiempo del trabajo |
| --- | --- | --- | --- | --- |
| RESUMEN previo | 22:18:56 | Procesado, paso de envío terminado | 1 | 2515 ms |
| Lista completa/incompleta | 22:19:12 | Dos propuestas: $101 y otro importe NULL con missingFields amount | 1 | 865 ms |
| Completar el 2 | 22:19:25 | $202 en posición 2; $101 de la posición 1 intacto | 1 | 735 ms |
| Descarte | 22:19:37 | Respuesta de descarte y grupo descartado, dos ítems removed | 1 | 1804 ms |

El completado capturó el grupo mostrado en versión 2 y el descarte capturó el mismo grupo en versión 3: se emitió un resumen actualizado antes de cancelar. Los dos conceptos corresponden a la prueba y no había otros ítems en ese grupo. Todos los trabajos quedaron processed, effect_applied y paso de envío terminado, un solo intento y sin pausa. Cero transacciones nuevas en esa cuenta desde la carga, cero grupos abiertos y cero trabajos nuevos pendientes/procesando/fallidos/en espera. Se conservaron posiciones 1/2, ARS y todos los campos resueltos; el ensayo no guardó gastos ficticios.

Los tiempos son desde recepción a processed del trabajo, no latencia total hasta que el usuario leyó el resumen: no incluyen necesariamente el debounce. El estado de envío no es comprobante de lectura/entrega física. No se añadieron pruebas reales de audio/foto en esta aceptación; normalización multimedia, fechas/dudas, cuotas, monedas, concurrencia y atomicidad se acreditan en las pruebas aisladas/CI descritas arriba.

**BE-08 cerrado en el alcance de esas regresiones, publicación/verificación y aceptación del propietario.** No cierra BE-12/BE-17 ni promete interpretación universal de IA. Revisión de solo lectura: sin cambios de base/runtime/proveedores, mensajes externos ni nuevas transacciones del agente. Evidencia saneada: acceptance.json y acceptance-complete.json en la carpeta del release. Continuar con la infraestructura pendiente según el plan; backups INF-08 al final y retención desactivada.
