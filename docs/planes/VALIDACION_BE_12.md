# BE-12 — Correcciones versionadas y resumen de pendientes

Fecha: 27/10/2026. Base publicada: PR #48/f96ab87, esquema 036 y webhook v60. **Cambio preparado en rama; 037 y el webhook nuevo no están publicados.** BE-11 conserva su seguimiento separado. Hosting/backups siguen para la etapa final y la retención desactivada.

## Revalidación y alcance

BE-08 ya muestra moneda, fecha y mes inicial de cuotas. El parser anterior solo corregía importes; el camino de edición interpretada aceptaba categoría pero no la aplicaba. La actualización SQL comprobaba posición/propiedad/estado y filas afectadas, por lo que ese hallazgo histórico no se presenta como completamente vigente. Faltaba un contrato de patch versionado que cubriera todos los campos y conservara el contexto al reintentar.

El parser local acepta importe, concepto, categoría, moneda ARS/USD, fecha ISO, cantidad de cuotas y mes inicial, y tipo gasto/ingreso. Permite varios campos de **un mismo movimiento** separados por punto y coma. Ejemplos:

- `El 2 fue de 1.234,50`
- `El 2 concepto Farmacia del Centro`
- `El 2 categoría Salud`
- `El 2 moneda USD`
- `El 2 fecha 2024-02-29`
- `El 2 cuotas 3 desde 2026-11`
- `El 2: importe 250,25; moneda USD; concepto Café`

Monedas no admitidas, fechas imposibles, importes no positivos/con más de dos decimales, campos repetidos y órdenes ambiguas piden aclaración sin IA, altas ni cambios parciales. No se promete interpretar cualquier formulación libre localmente. Las categorías deben existir, estar activas y pertenecer al usuario y tipo; no se crean ni se sustituyen silenciosamente por Otros. Cambiar el tipo exige cuotas compatibles y una categoría válida del tipo nuevo (Otros si no se especifica categoría).

## Persistencia y reintentos

037 añade un helper interno sin EXECUTE para PUBLIC/anon/authenticated/service_role. La RPC existente conserva firma, propietario, SECURITY DEFINER, search_path y grants; exige lease, identidad y cuenta válida como antes. El helper bloquea grupo e ítem, comprueba usuario/grupo abierto/posición pendiente/versión y valida todo el patch **antes de una única actualización**. Un campo inválido o una categoría no disponible deja intacto el ítem y la versión. Solo los campos presentes cambian; quitar cuotas limpia el mes inicial. Los faltantes resueltos se retiran; una duda de revisión no se da por resuelta automáticamente.

El éxito incrementa una vez la versión e invalida la revisión anterior. No escribe movimientos definitivos, presupuestos, cuotas confirmadas ni cupos de IA. Confirmar después requiere el resumen vigente; la creación de cuotas sigue usando la operación SQL existente y sus centavos exactos. Un reenvío con efecto aplicado no repite el patch.

Texto explícito: cero IA. Audio con Groq: después de transcribir se prueba la corrección local antes de Qwen. Los checkpoints nuevos conservan grupo, versión y patch; un reintento no reinterpreta ni elige la versión nueva. Un checkpoint antiguo de edición sin versión pide repetir la corrección con RESUMEN, sin adivinar el destino. No se cambia proveedor, clave, cuota o facturación.

Se adaptan únicamente las formas nuevas de edición en la elegibilidad detrás de mensajes retenidos por capacidad. La edición no libera ese excedente ni renumera pendientes. Esto **no cierra BE-11** ni modifica su política de listas antiguas/mensajes mayores de 20.

## Resumen

Conserva fecha/moneda/mes inicial y añade categoría para revisar el cambio. Hasta 20 operaciones, sin sumar monedas. Conceptos/categorías largos se abrevian con aviso y sin romper Unicode, posiciones, cifras o cuotas; el texto respeta 4096 caracteres. Los datos completos permanecen guardados en el borrador.

## Validación y límites

- **939 Vitest (68 nuevos)** y **80 rutas Deno (cinco nuevas)** aprobados localmente. Parser y formatter reales importados por Vitest. SQL real de cola y migraciones combinadas en PGlite: categorías ajenas/inactivas/ambiguas, fecha imposible, patch parcial inválido, versión vieja/grupo ajeno/posición quitada, faltantes, confirmación anterior, idempotencia y permisos.
- Edición seguida de revisión/confirmación real con USD 123,46 en tres cuotas: 41,15 + 41,15 + 41,16; concepto y categoría conservados. Solo fixtures aisladas.
- Procesador Deno con red denegada y HTTP simulado: texto sin IA, audio con una transcripción sin Qwen, categoría del extractor, checkpoint/reintento y objetivo ausente. No se llamó a proveedores reales ni se enviaron WhatsApps.
- Tipos/lint/build, 12 renovaciones SQL y seis guardas de release aprobados. El bundle frontend no cambia (871,54 kB / 249,86 gzip); advertencia de tamaño preexistente.
- Docker local no está disponible. PostgreSQL nativo de dos sesiones y ensayo completo de instalación/rollback están preparados para CI Linux; sus resultados finales se registrarán después. No se presume que hayan pasado localmente ni que la publicación/aceptación WhatsApp esté realizada.

## Publicación propuesta y rollback

Después de CI y autorización: comprobar historial 001–036, definición de apply/next/due, grants y salud de cola; aplicar/registrar 037 atómicamente y verificar fuentes/ACL antes de desplegar el webhook candidato. La migración conserva el formato legacy amount/description/category para el runtime anterior, con validación. No requiere cambios financieros ni pausa para una expansión compatible. Dejar terminar los trabajos iniciados al publicar y comprobar checkpoints si hubiera rollback.

Rollback de runtime: f96ab87701425374810b9ac2076e3b4524db3767, mínimo 036, conservando 037. Un runtime anterior no entiende el checkpoint interno nuevo; no reprocesarlo artificialmente ni reescribir su destino: dejar terminar los iniciados con el candidato o pedir repetir la corrección si se requiere volver atrás. Mantener 033/034/035/036 y sus protecciones; no ejecutar down, restore ni retirar permisos. El ensayo comprueba el runtime anterior sobre el esquema nuevo y el formato legacy.

Aceptación posterior con el propietario: crear un pendiente ficticio, corregir concepto/moneda/categoría/fecha/cuotas y dos campos juntos, revisar el resumen y cancelar sin confirmar. La ruta de confirmación con cuotas y fallos se prueba en aislado. BE-12 no se marca cerrado hasta publicar y completar la aceptación acordada.
