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
- Deno 2.9.6 cache, check y lint aprobados. Pruebas locales: 86 aprobadas; cuatro bloqueadas por permisos de lectura de módulos CommonJS en la caché virtualizada de Windows. No se cambiaron permisos de producción ni configuración versionada para forzarlas. CI Linux debe aprobar el job Webhook antes de publicar.

## Estado

Implementada y comprobada localmente, todavía sin publicar al escribir esta sección. La versión observada en producción sigue siendo v65. Se necesita CI completa y despliegue del webhook; no requiere migración nueva. La aceptación por WhatsApp se repetirá después de publicar. Se conserva el borrador de prueba del propietario.

El registro de publicación previa está en VALIDACION_RELEASE_042_PRODUCCION.md y su evidencia saneada.
