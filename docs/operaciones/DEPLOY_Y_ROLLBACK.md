# Entornos, publicación y rollback compatible (INF-10)

## Mapa actual

```text
PR -> Frontend + Webhook + PostgreSQL + Ensayo de release
merge main -> mismos controles -> Pages (PWA estática)
operador -> migraciones Supabase -> verificación -> Edge Function -> smoke
Meta -> HMAC webhook -> cola PostgreSQL -> worker por usuario -> Meta/Gemini
pg_cron -> dispatch privado -> worker (misma credencial en Vault y Edge)
```

La publicación de Pages no despliega Edge Functions ni aplica SQL. Los tres componentes deben registrarse juntos aunque sus versiones difieran. No hay staging alojado; los ensayos se hacen en Supabase local aislado, sin datos ni proveedores reales. No activan facturación.

## Registro previo y contrato

1. Confirmar repo, rama, árbol limpio y remoto sincronizado. Si hay cambios ajenos, detenerse sin pisarlos.
2. Usar Node de .node-version, Deno 2.9.6 y CLI de .supabase-version. Ejecutar los checks de README y exigir el ensayo de release del PR. El manifiesto de solo lectura se genera con `npm run release:manifest -- production`; guarda SHA del código, herramientas y hashes de cada SQL/archivo runtime en .temp/release-production.json.
3. Leer estado real: historial supabase_migrations.schema_migrations; versión/estado de whatsapp-webhook y verify_jwt; cola habilitada; trabajos en procesamiento/fallidos y cron. Solo conteos, sin payloads ni secretos.
4. Registrar fuera del bundle: SHA candidato/anterior, enlace a CI, migrations antes/después, versión Edge anterior/nueva, hora, smoke y estado previo de cola. observedDeployment del manifiesto empieza con null/false: **no es evidencia de haber desplegado**; completarlo solo con lecturas verificadas.
5. La versión anterior validada llega a 024; esta publicación requiere 025 y el contrato de la cola v2 comienza en 020, con idempotencia 023. El rollback ensayado está fijado en config/environments.json: a4be403 (webhook equivalente a v41), compatible con 024 y la expansión 025. Revisar ese contrato ante cada cambio de esquema. No retroceder a workers anteriores a 020, ni restaurar permisos inseguros de 017 o advertencias privadas anteriores a 024.

Consulta de solo lectura para el estado:

```sql
select version, name from supabase_migrations.schema_migrations order by version;
select enabled from public.whatsapp_queue_control where singleton;
select queue_version,status,count(*) from public.whatsapp_message_queue group by 1,2;
select count(*) as leases_activos from public.whatsapp_user_leases where lease_until > clock_timestamp();
select status,start_time,end_time from cron.job_run_details
where jobid in (select jobid from cron.job where jobname='pesito-whatsapp-queue-recovery')
order by start_time desc limit 1;
```

No reenviar trabajos v1 fallidos ni eliminar pendientes para que los conteos queden en cero.

## Instalación nueva y migraciones posteriores

- Instalación vacía: aplicar **todas las migraciones completas en orden (actualmente 001–025)**, con Auth y publicación supabase_realtime preparados por Supabase. No usar un PostgreSQL común sin esquemas/extensiones como si fuera Supabase. El ensayo CI verifica el stack real con datos sintéticos.
- Instalación existente: comparar el historial real con los archivos y sus hashes; aplicar únicamente las migraciones nuevas aprobadas, sin reescribir las ya aplicadas. Si hay deriva, parar y revisarla.
- Preparar primero la expansión compatible del esquema; validar permisos, índices y dependencias antes de publicar el consumidor. Cualquier cambio destructivo requiere otro plan, no un down automático.
- Antes de usar CLI remoto, verificar el contenido de supabase/.temp/project-ref coincide exactamente con ystyatotldslfmucvgsq. link solo cuando corresponda y nunca en el workdir local. Mantener SSL y restricciones de red; no abrir 0.0.0.0/0 ni resetear contraseña por un problema de conexión.
- Preview: `npx --yes supabase@2.120.0 db push --linked --dry-run`. Revisar que proponga **solo** SQL nuevo esperado. Después ejecutar `db push --linked` una sola vez. En esta red, IPv6 o allowlist pueden impedir TCP: utilizar SQL Editor/Management API HTTPS con el procedimiento revisado de migración y registro de historial en la misma transacción. No inventar un repair para saltarse errores.
- Las migraciones 020–024 incluyen transacciones/guardas propias. No envolver indiscriminadamente con BEGIN/COMMIT adicionales. Si se usa Management API, construir una única transacción revisada y registrar el texto/versión exactos; verificar commit y lectura posterior antes de seguir.
- 020 requiere quietud de trabajos v1 y ausencia de dos grupos abiertos por cliente. No resolver una guarda borrando filas; conservar y revisar el estado.
- 021/022 requieren pg_cron, pg_net, http y Vault; dispatch contiene el endpoint del proyecto actual. Un nuevo proyecto alojado requiere migración/configuración revisada del destino antes de activar. El preparador local bloquea ese dispatch y desprograma cron, sin alterar migraciones versionadas.
- En altas nuevas, 005 promueve usuarios preexistentes. Instalar sobre Auth vacío; designar después solo al administrador aprobado. BE-13 queda abierto.

## Webhook y activación

Desde el checkout del commit aprobado por CI:

```powershell
npx --yes supabase@2.120.0 functions deploy whatsapp-webhook --project-ref ystyatotldslfmucvgsq --no-verify-jwt --use-api
```

--use-api permite empaquetado remoto sin Docker. Desplegar únicamente esta función; no ejecutar config push ni cambiar Auth/secrets globalmente. La config local de Deno se llama deno.ci.json para evitar cambiar el empaquetado de producción.

Verificar versión nueva ACTIVE, JWT false, HMAC y secreto worker conservados. Confirmar existencia (sin revelar valores) de los seis secretos citados en la guía, Vault whatsapp_worker_secret y cron. Un POST vacío sin firma debe dar 401; worker sin x-worker-secret también 401. Un código 200 sin procesar mensajes no prueba el negocio: la aceptación manual con cuenta propia/autorizada sigue siendo necesaria cuando cambie el comportamiento.

La cola actual ya está activa: **no apagarla en una publicación documental o compatible**. Si el cambio requiere una ventana de quietud, registrar enabled previo, deshabilitar recepción v2 y esperar a que terminen trabajos y leases activos antes del cambio. Mientras esté apagada, el webhook responde 503 al intentar persistir y Meta puede reintentar; mantener esa ventana acotada y comprobar reintentos según su política. No anunciar éxito ni confirmar mensajes no revisados. Activar solo después de validar versiones y registrar el estado final.

## PWA

- PR a main; checks aprobados, sin bypass de protección. main publica únicamente si también aprueba el ensayo local.
- Producción usa config/environments.json validado por Vite. Desarrollo necesita configuración local explícita; nunca service role en VITE_.
- Actions identifica sw.js y version.json con el SHA publicado. Comprobar Actions y leer `/chatbot-gastos/version.json` sin caché; abrir la PWA y comprobar datos propios/login. No asumir actualización inmediata en dispositivos offline.
- La coordinación entre service worker, formularios y sesiones instaladas sigue en FE-07. Un smoke HTTP no sustituye esa validación.

## Rollback compatible, conservando datos

1. Identificar el componente fallido y último commit validado con el esquema actual. Si solo falla Pages, evitar cambiar SQL/Edge. Si solo falla Edge, mantener la PWA cuando el contrato lo permita.
2. PWA: preparar un PR que revierta los cambios responsables conservando correcciones de seguridad y configuración; ejecutar todos los checks, integrar y verificar nuevo SHA de Pages. No force-push, no mover main hacia atrás y no publicar un bundle con claves de otro entorno. El SHA del revert es nuevo.
3. Edge: extraer el commit compatible en un checkout temporal identificado, revisar manifiesto/hashes y redeplegar solo whatsapp-webhook con el comando anterior. Supabase asigna otra versión Edge; anotar versión nueva y SHA antiguo del código. No copiar secretos ni recrear Vault. La exclusión por usuario/idempotencia debe ser compatible entre ambas versiones.
4. Si la compatibilidad no permite coexistencia, registrar estado de cola, deshabilitarla en una ventana acotada, esperar procesamiento y leases, cambiar solo el código y restaurar enabled al estado previo tras validar. Conservar trabajos pendientes para el nuevo worker. No reconstruir la cola, revertir efectos financieros ni reenviar respuestas entregadas.
5. SQL: conservar migraciones expansivas compatibles; ante error usar una migración correctiva nueva y probada. **No ejecutar down, db reset --linked ni restaurar una base productiva como rollback de aplicación.** Una reversión de datos exige un plan específico, fuera de este procedimiento.
6. Repetir smoke 401/200 autorizado en aislado, revisar permisos/historial, verificar que un registro existente permanece y que las respuestas no se duplican. En producción validar únicamente con lecturas agregadas y cuenta autorizada.
7. Registrar resultado o parar si la versión anterior no pasa contra el esquema vigente; corregir hacia adelante. La restauración y recuperación de desastres siguen pendientes en INF-08, al final del plan.

El ensayo automatizado usa el mismo esquema durante candidato y rollback. Sirve realmente ambos webhooks con el runtime local y compila/sirve ambas PWA; comprueba identidad de SW/version y persistencia del movimiento sintético. No se presenta como un ensayo de restauración, de cron productivo o de entrega real por Meta.

## Fuentes y alcance

- [Flujo local de Supabase](https://supabase.com/docs/guides/local-development/cli-workflows).
- [Migraciones de base de datos](https://supabase.com/docs/guides/local-development/database-migrations).
- [Gestión de entornos](https://supabase.com/docs/guides/deployment/managing-environments).

La evidencia de esta implementación se guarda en [VALIDACION_INF_10.md](../planes/VALIDACION_INF_10.md). No instalar WSL, cambiar BIOS ni contratar un staging para resolver el ensayo; en una PC sin motor Docker funcional, usar el runner Linux aislado del CI gratuito del repositorio público.
