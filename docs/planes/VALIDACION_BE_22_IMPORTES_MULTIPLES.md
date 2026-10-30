# BE-22 — Corrección local de importes múltiples

Fecha: 30/10/2026. Base: d2d05df; rama codex/fix-bulk-amount-corrections.

## Incidencia y causa

La aceptación manual sobre Edge v65 falló al enviar «El 1 fue de 150 y el 2 fue de 250». El bot pidió indicar un solo cambio y conservó la lista. parsePendingEdit devolvía aclaración para cualquier segundo destino explícito: la RPC 042 aceptaba listas, pero el texto nunca llegaba a ella. Las pruebas anteriores validaban SQL con acciones ya construidas, sin cubrir este recorrido de texto.

## Corrección implementada

Se reconoce localmente una secuencia de correcciones explícitas de importe con destinos numerados, separadas por y, coma, punto y coma o saltos de línea. Las comas decimales se conservan. Se validan todos los destinos, importes, grupo y versión antes de devolver una sola acción edits; posiciones repetidas, quitadas, inexistentes o datos inválidos rechazan todo el mensaje. No se invoca IA ni se consume cupo. Los números estables, conceptos y otros campos se conservan.

El alcance no interpreta frases abreviadas ambiguas como «el 2 de 250» ni generaliza correcciones múltiples de categoría/fecha/concepto. Conserva la ruta previa para esos casos. No cambia SQL, proveedores, configuración, costos, roles, hosting, backups o retención.

## Evidencia de pruebas

- Antes del arreglo, siete regresiones fallaron reproduciendo el caso exacto; diez controles negativos pasaron.
- Después, 17 pruebas nuevas del parser/procesador y una integración adicional texto→RPC 042 aprobadas. La integración verifica ambos importes, tercer pendiente intacto, reintento idempotente y cero movimientos definitivos nuevos.
- npm run lint, npm test (1.129 pruebas / 56 archivos), npm run test:sql (12 escenarios), npm run test:release:guards (14) y npm run build: aprobados.
- Deno 2.9.6 cache, check y lint aprobados. Pruebas locales: 86 aprobadas; cuatro bloqueadas por permisos de lectura de módulos CommonJS en la caché virtualizada de Windows. No se cambiaron permisos de producción ni configuración versionada para forzarlas. El job Webhook aprobó en CI Linux #290, incluidas todas las pruebas Deno.

## Estado

PR #73 integrada en main 7dd418e367a797e8406c6cfe1acedeeba22c5258. Los cuatro controles aprobaron en CI #290 (run 41069648813), incluido Webhook con todas las pruebas Deno y el ensayo completo de release. La revisión automática rechazó inicialmente el despliegue por falta de autorización específica; el propietario la dio expresamente y se desplegó v66 ACTIVE a las 11:28 Argentina. Los 26 archivos descargados coinciden con 7dd418e; PWA version.json coincide también. No se aplicó migración ni se pausó la cola. Tres pendientes conservados, cero trabajos activos y huellas de perfiles/movimientos/RPC sin cambios. Firma ausente y worker sin secreto devuelven 401. La aceptación WhatsApp quedó cerrada en el alcance detallado abajo.

El registro de publicación previa está en VALIDACION_RELEASE_042_PRODUCCION.md y su evidencia saneada.

[Evidencia saneada del despliegue](evidencias/BE_22_IMPORTES_DESPLIEGUE_2026-10-30.json).

## Aceptación manual cerrada — 30/10/2026

El propietario compartió la respuesta del bot con posiciones 1/2/3 e importes 150/250/303: se corrigieron dos y se conservó el tercero. Luego quitó 1 y 3 juntos; la respuesta conservó únicamente el número 2 por 250, sin renumerar. Tras CANCELAR y RESUMEN confirmó el cierre.

Lectura SQL de solo consulta a las 11:36 Argentina: CANCELAR recibido 11:34:05 y RESUMEN 11:34:11, ambos procesados y finalizados; cero grupos abiertos/ítems pendientes del propietario, cola habilitada y cero trabajos v2 activos. Huella de todos los movimientos definitivos sin cambios respecto del preflight. El resumen se entrega por el worker: summary_pending=false, shown_group_id/shown_version nulos y shown_at posterior al comando. reply_text del trabajo no es el registro de ese resumen; una marca de envío no prueba lectura por sí sola.

Cierre válido para esta prueba de importes múltiples, bajas con números estables y cancelación; no extiende la aceptación a fotos, audios, cuotas, monedas o otros campos múltiples. No hubo movimientos de prueba guardados. Próximo bloque sugerido: BE-19. [Evidencia saneada](evidencias/BE_22_ACEPTACION_2026-10-30.json).
