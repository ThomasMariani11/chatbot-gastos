# Validación BE-07 — confirmar la versión revisada

Fecha: 26/10/2026 (Argentina). Base: main cb2cef5. Rama: codex/backend-reviewed-confirmation.
Estado: candidato preparado, sin publicar. Requiere migración 033; no cambia el código del webhook, la firma de sus RPC, claves, proveedores, modelos, facturación ni datos de clientes.

## Revisión y reproducción

Las protecciones originales de la auditoría ya existen en 020/023: cola por usuario, exclusión, rechazo de ítems pendientes en grupos cerrados, versión mostrada capturada al recibir, timestamp Meta posterior al resumen, confirmación atómica y respuesta persistida. Se conservan y se prueban; no se presume que el defecto histórico de insertar en un grupo confirmado siga abierto.

Se reprodujo otro caso con las funciones SQL reales sobre PGlite descartable:

1. Una lista tiene un resumen válido y luego supera 24 horas sin actividad.
2. CONFIRMAR conserva el contexto del resumen anterior al entrar a la cola. La RPC retiene el mensaje por la antigüedad y solicita RETOMAR/DESCARTAR.
3. RETOMAR libera el mensaje y anula la versión mostrada en el estado del usuario, pero el mensaje retenido conserva la autorización anterior.
4. La comprobación anterior compara únicamente grupo/versión capturados con la lista, que no cambió. Guarda sin un resumen nuevo ni una nueva confirmación.

Dos regresiones fallaron antes de 033: sin mensaje adicional y con un gasto nuevo pendiente. En ambos casos la RPC anunció «Se guardaron 1 movimientos» donde debía pedir revisar y confirmar nuevamente. No se inspeccionaron casos de clientes para sostener esa reproducción ni se modificó producción.

## Corrección acotada

- 033 agrega al guard de apply_whatsapp_job la comprobación del estado durable actual: mismo usuario, grupo y versión mostrados, sin resumen pendiente. Se mantienen la comprobación de la versión recibida, el lease, los bloqueos de grupo/perfil y la transacción existentes.
- Al liberar mensajes waiting/stale tras RETOMAR/DESCARTAR/CANCELAR de una lista antigua, se eliminan sus confirmation_group_id/version anteriores. Los mensajes se conservan; una operación nueva sigue procesándose, mientras una confirmación antigua pide otra revisión.
- La migración reemplaza únicamente dos fragmentos conocidos del cuerpo actual. Si el cuerpo no coincide, aborta con BE07_APPLY_DEFINITION_UNEXPECTED. CREATE OR REPLACE mantiene propietario, ACL, SECURITY DEFINER, search_path, firma y dependencias. La migración no cambia filas ni reenvía trabajos. El cambio de campos ocurre cuando el usuario resuelve su lista por el flujo habitual.
- No se reescribe confirm_draft_group, no se cambia el procesamiento de importes, no se agrega un proveedor ni un envío nuevo. No hay cambios de runtime TypeScript: el webhook publicado puede usar la RPC actualizada.
- config/environments.json fija mínimo 033 para este candidato. Es compatible con las llamadas anteriores y conserva las migraciones al volver al código de rollback. El valor no acredita que 033 esté aplicada en producción.

## Validación

- **735/735 Vitest aprobadas** en 37 archivos: 723 previas y 12 nuevas de BE-07; 106 casos de cola SQL en total. Tipos/build y ESLint aprobados; aviso previo de bundle >500 kB conservado.
- Las nuevas regresiones prueban: confirmación retenida con/sin mensaje adicional, revisión revocada, callback de resumen tardío durante/tras una nueva carga, orden de confirmación y gasto dentro de un payload, rechazo de ítems en grupos confirmados/descartados, idempotencia/atributos de 033 y aborto ante cuerpo SQL inesperado.
- Tras rechazar la confirmación vieja se conserva el grupo, se muestra el resumen nuevo y una confirmación nueva guarda exactamente las operaciones esperadas; no quedan ítems pendientes en grupos cerrados.
- La suite de cola existente ahora carga 033: sigue verificando doble confirmación/IDs distintos, mensaje enviado antes del resumen, resumen fallido/recuperación, resultado SQL perdido, fallo en la segunda cuota sin guardado parcial, ARS/USD separados, autorización/permisos y bloqueo posterior a interpretar. Estas son pruebas con SQL real y dobles de transporte; no afirman disponibilidad de Meta/IA.
- 12 escenarios adicionales de renovaciones y seis guardas de release aprobados. Se corrigieron tipos explícitos de las consultas SQL de las nuevas pruebas antes del build final. Node local 24.21.0; CI usa 22.23.3 fijado en el repo.
- Se amplió el ensayo PostgreSQL nativo de CI: aplica 033 con el esquema disponible, retiene/libera la confirmación antigua, comprueba su rechazo desde dos conexiones y confirma dos veces concurrentemente un trabajo nuevo con un único guardado. Otro mensaje CONFIRMAR con ID distinto tampoco vuelve a guardar. Este resultado se registra solo cuando el job PostgreSQL del SHA final apruebe; localmente no hay psql disponible y se validó la sintaxis del script con node --check.
- Webhook y Ensayo de release completos quedan sujetos al CI del candidato. No se repite una prueba de endpoints local con permisos ampliados para sortear la limitación de caché Deno de Windows ya documentada. No se cambian los permisos de CI.

## Publicación y aceptación pendientes

1. Exigir los cuatro controles de la PR sobre el SHA final y revisar el diff. Registrar los checks de PostgreSQL nativo y ensayo de instalación/rollback completos.
2. Tras autorización concreta, recomprobar esquema, cola y versiones reales; la última observación productiva era 032/webhook v56. Guardar definición/atributos anteriores de la RPC como evidencia de rollback de código, sin exportar datos. Si existen cambios inesperados, reconciliar antes de aplicar.
3. Aplicar y registrar únicamente 033 por el procedimiento de migraciones; verificar cuerpo y atributos frente al candidato. La RPC mantiene su firma y no necesita redesplegar Edge; luego integrar la PR y verificar CI/Pages. No ejecutar backfills ni retocar fechas/versiones de borradores de clientes para ensayar la antigüedad.
4. La aceptación del caso de 25 horas se realiza en base descartable, con reloj del fixture; la comprobación productiva es de solo lectura (hash/atributos, historial y salud). Si se agrega una prueba WhatsApp del propietario, acordar explícitamente su alcance: una confirmación que llegue después del resumen puede guardar la operación ficticia. No provocar escrituras financieras con credenciales reales como smoke automático.
5. Mantener 033 ante un rollback de PWA/Edge compatible; no restaurar la autorización antigua. Si falla 033, la transacción revierte sin aplicar fragmentos. BE-07 sigue en curso hasta registrar CI y publicación/verificación autorizadas; BE-08/12/17 mantienen su propio alcance. Costo $0, retención desactivada y backups al final.

## Límites

El sistema conoce el resumen cuya petición de envío aceptó Meta; no prueba que el cliente lo leyera. Los timestamps con resolución de segundos conservan la política existente de pedir otra confirmación ante ambigüedad. No se amplía la semántica de IA ni se resuelven datos faltantes. Las pruebas nuevas cubren interacciones concretas, no todas las combinaciones de entrega/reinicio posibles. El ensayo PostgreSQL verifica dos conexiones concurrentes sobre la RPC, no dos workers legítimos con el mismo lease.
