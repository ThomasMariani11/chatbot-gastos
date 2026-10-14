# Validación y publicación de INF-01 / BE-01

Fecha de preparación: 14/10/2026. Base revisada: c8d6842, main sincronizada con origin/main al comenzar.

Estado al 14/10/2026: INF-01 / BE-01 terminadas. Migración aplicada y validada en Supabase. Circuito WhatsApp probado por el usuario y corroborado con agregados de solo lectura. La publicación Git se consulta en el historial del repositorio.

## Cambio propuesto

Archivo: supabase/migrations/017_restrict_draft_rpc_execution.sql.

Las funciones get_active_draft_group(uuid), confirm_draft_group(uuid,uuid,integer) y discard_draft_group(uuid,uuid) son internas del webhook. Sus llamadas están en supabase/functions/whatsapp-webhook/index.ts; el cliente de Supabase se crea con SUPABASE_SERVICE_ROLE_KEY en las líneas 446–448. No se encontraron llamadas a estas funciones desde src.

La migración revoca ejecución a PUBLIC, anon y authenticated, y conserva EXECUTE para service_role. El propietario y los administradores de base mantienen los privilegios inherentes a su rol; una sesión administradora de la PWA sigue siendo authenticated y no obtiene acceso a estas RPC. Quitar solo anon sería insuficiente porque PUBLIC concede acceso a todos los roles.

No se reemplazan cuerpos ni firmas de funciones, no se cambian datos ni políticas de tablas, y no se requieren cambios de frontend o despliegue del webhook. Las comprobaciones actuales de suscripción, propietario del grupo y versión permanecen. La autorización del usuario de WhatsApp continúa siendo responsabilidad del backend confiable que resolvió su vínculo.

Los cambios de ACL y sus comprobaciones se ejecutan en una transacción. Si los permisos efectivos siguen siendo inesperados, por ejemplo por membresías de roles, la migración falla; revisar esas membresías antes de continuar, sin ampliar permisos de clientes.

Esta tarea no resuelve las escrituras directas de borradores/cola ni la integridad entre propietarios: siguen pendientes en INF-02 / BE-03. Tampoco corrige renovaciones, concurrencia de mensajes u otros hallazgos del plan.

## Pruebas reproducibles

Desde la raíz del repositorio:

```sh
npm ci
npm test -- tests/draft-rpc-permissions.test.ts
npm test
npm run lint
npm exec -- eslint tests/draft-rpc-permissions.test.ts
npm run build
```

PGlite está declarado como dependencia de desarrollo con versión exacta y lockfile. La nueva suite se ejecuta con npm test; no depende de una instalación manual ignorada por Git. Los tipos de Node permiten compilar el test junto con TypeScript.

La base es PostgreSQL efímero en memoria: no acepta URL externa, no utiliza variables de credenciales, no llama a Supabase y se cierra al finalizar. Auth y los roles de Supabase se representan con una fixture mínima. Se cargan las migraciones reales 001 y 003–016, incluidos el bootstrap y el trigger de perfiles de 016, y luego 017.

Limitaciones deliberadas: se omite 002 porque solo configura la publicación de Realtime; de 001 se omite la creación de pgcrypto, no disponible en este runtime, que ya incluye gen_random_uuid. Se elimina el BOM de lectura de los archivos antiguos sin modificar esos archivos. Esto comprueba PostgreSQL y ACL, no el gateway HTTP de Supabase, Meta ni la entrega real de WhatsApp.

Antes de aplicar 017, la fixture reproduce lectura anónima de otro usuario y confirmación ajena desde authenticated; luego revierte esos datos. Después de 017 comprueba:

- Denegación efectiva a anon, authenticated y un rol nuevo sin concesiones (PUBLIC revocado).
- Lectura, confirmación con y sin versión explícita y descarte rechazados con SQLSTATE 42501; datos idénticos antes/después.
- Cliente propietario y administrador de la PWA también rechazados, porque son RPC exclusivas del backend.
- Un claim service_role no concede permisos si el rol PostgreSQL sigue siendo authenticated.
- Lectura y descarte legítimos desde service_role sin afectar al otro cliente.
- Confirmación legítima de gastos, ingresos, ARS, USD y tres cuotas, conservando centavos y totales por moneda.
- Segunda confirmación sin duplicados; propietario o versión incorrectos sin mutación.
- Rechazo de confirmación con cuenta suspendida, vencida, pendiente de código o fecha expirada.
- Funciones de invitación y rol de sesión siguen disponibles según su contrato.
- Cuerpos de las tres funciones y datos preservados al migrar; repetición de 017 segura.

Resultado local: 23 pruebas nuevas aprobadas y 49 pruebas totales aprobadas. Lint general y del test nuevo, TypeScript y build aprobados; persiste la advertencia previa por el bundle de 809,54 kB. No interpretar esto como cierre productivo.

## Revisión antes de publicar — solo lectura

1. Actualizar referencias remotas y revisar cambios de otros colaboradores; no sobrescribir trabajo local ni migraciones nuevas.
2. Confirmar el proyecto y que 001–016 estén aplicadas. No volver a ejecutar migraciones históricas para esta corrección.
3. Verificar backups disponibles y el responsable de recuperación. No asumir que existe una copia válida sin evidencia; registrar cualquier limitación de INF-08.
4. Confirmar que el webhook desplegado conserva el cliente de servicio y no sustituye su Authorization por un JWT de cliente. No imprimir ni copiar las claves en SQL, documentación o navegador.
5. Consultar exclusivamente metadatos de las tres funciones en SQL Editor, usando una sesión administrativa:

```sql
select
  p.oid::regprocedure::text as function_signature,
  pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer,
  has_function_privilege('anon', p.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'execute') as service_execute
from pg_proc p
where p.oid in (
  to_regprocedure('public.get_active_draft_group(uuid)'),
  to_regprocedure('public.confirm_draft_group(uuid,uuid,integer)'),
  to_regprocedure('public.discard_draft_group(uuid,uuid)')
)
order by function_signature;
```

Deben aparecer exactamente tres filas. Antes de publicar, registrar los permisos observados; si difieren del esquema auditado, revisar el alcance. Después de aplicar se esperan false / false / true en cada fila.

## Procedimiento de aplicación y verificación

Solo después de la revisión y aprobación, aplicar el archivo 017 completo por el mecanismo de migraciones acordado. Revisar si hay otras migraciones pendientes antes de usar comandos que publiquen todas. Si se utiliza SQL Editor, mantener registro consistente de lo aplicado; no ejecutar confirmaciones o descartes sobre borradores reales como prueba de seguridad.

Si hay un error durante el archivo, no tratar la migración como aplicada. Revertir la transacción fallida con ROLLBACK en la misma sesión antes de continuar y diagnosticar la causa. Las comprobaciones locales no prueban las ACL remotas hasta que se publique y se vuelva a consultar.

Después de aplicar:

1. Repetir la consulta de metadatos: tres filas, anon=false, authenticated=false, service_role=true.
2. Probar rechazos HTTP con un UUID ficticio sin datos, y con una cuenta de prueba si se dispone; no usar datos de clientes. SQL Editor con rol postgres no representa una llamada anónima o cliente.
3. Desde una cuenta de WhatsApp de prueba, agregar movimientos, pedir resumen y confirmar. Comprobar el resultado y la respuesta del bot.
4. Abrir otro borrador de prueba y cancelar. Comprobar que no se crean movimientos.
5. Revisar errores de permisos sin registrar mensajes, teléfonos, comprobantes o claves. Registrar versión del webhook, migración y evidencia de las verificaciones.
6. Marcar INF-01 y BE-01 terminadas solo al cumplir esos controles. Las políticas de tablas siguen pendientes en INF-02 / BE-03.

## Si el bot falla después del cambio

No restituir permisos a PUBLIC, anon o authenticated para recuperar el servicio. Comprobar proyecto, versión del webhook y rol efectivo de su cliente de Supabase. Si una función es necesaria desde la PWA, detener la publicación correspondiente y diseñar una RPC cliente con autorización explícita, en vez de volver a exponer estas funciones internas.

La recuperación debe mantener el cierre de acceso: corregir el cliente de backend o preparar una migración posterior acotada a los permisos legítimos. No hay una migración automática de reversión que reabra la vulnerabilidad.

## Registro de aplicación — 14/10/2026

- Proyecto y estado revisados por CLI oficial 2.120.0; historial 001–016 antes del cambio. El dry-run anunció únicamente 017; se publicó con skip-vault, sin roles ni seed y quedó registrada como restrict_draft_rpc_execution.
- Antes: PUBLIC, anon y authenticated podían ejecutar las tres RPC. Después: anon=false, authenticated=false, service_role=true. Los hashes de sus definiciones no cambiaron.
- Webhook descargado para comparación: versión 36, ACTIVE, SHA-256 idéntico al código local; usa SUPABASE_SERVICE_ROLE_KEY sin reemplazo global de Authorization. No se redesplegó.
- HTTP: tres rechazos anónimos 401/42501 y tres respuestas 200 del backend con UUID ficticios inexistentes. Las respuestas de negocio negativas de esos UUID eran las esperadas, no guardados exitosos. No se creó una sesión HTTP authenticated; ese rol sí se verificó en PostgreSQL.
- Prueba SQL productiva: dos usuarios ficticios y dos grupos; ocho llamadas anon/authenticated rechazadas; service_role leyó, confirmó cinco transacciones (incluidas tres cuotas) y descartó otro grupo; monedas y centavos correctos; propietario/versión incorrectos y doble confirmación rechazados. Todo dentro de una transacción terminada en ROLLBACK.
- Comprobación posterior: cero usuarios, grupos, ítems, movimientos y códigos de la fixture. No se modificaron registros de clientes existentes.
- Backups: listado físico sin copias devueltas y PITR desactivado. Se guardaron metadatos de las funciones y ACL antes del cambio en una carpeta temporal local. Esto no equivale a un backup completo; INF-08 sigue pendiente y no se verificaron copias lógicas/externas.
- [Resumen de evidencia sin secretos ni datos de clientes](evidencias/INF_01_BE_01_2026-10-14.json). El script de la prueba transaccional está en tests/sql/draft-rpc-permissions-smoke.sql; es manual y no forma parte de npm test.
- Prueba WhatsApp completada por el usuario con su cuenta: resumen inicial vacío, alta, confirmación mediante si, segunda alta y descarte mediante no. Captura y consulta de solo lectura confirman un único movimiento de 100 ARS, cero del concepto descartado y cero ítems de prueba pendientes. El asistente no envió mensajes ni simuló Meta.
- Código, pruebas y documentación se entregan juntos; consultar el historial Git para identificar el commit y su publicación.

El movimiento confirmado de prueba permanece en la cuenta para que el usuario decida cuándo eliminarlo. Esta verificación no lo modificó ni eliminó.
