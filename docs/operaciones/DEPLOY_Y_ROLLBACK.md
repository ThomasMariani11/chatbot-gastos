# Entornos, publicación y rollback compatible (INF-10)

## Última publicación observada — 09/11/2026 (textos del bot más cercanos)

PWA **4ba7f79f94f4de2284e88f4e71b7aa1989671fc0** (PR #91), SQL **001–049**, webhook **v73 ACTIVE** (verify_jwt=false). Orden ejecutado con autorización del propietario: merge de la PR → `db push --linked --dry-run` (solo 049) → cola habilitada, 0 leases y 0 trabajos en proceso → `db push --linked` → verificación (historial 049, cero funciones con los textos anteriores, `whatsapp_over_limit_reply` con el texto nuevo, `apply_whatsapp_job` sin acceso para authenticated) → deploy del webhook desde 4ba7f79 → smoke 401 en `/`, `worker` y `client-push` → Pages con `version.json` = 4ba7f79. Rollback: PWA y webhook a fbbad78 / v72 conservando 049 (el runtime anterior funciona igual con los textos SQL nuevos). Aceptación manual en WhatsApp del propietario: 10/11/2026.

## Registro histórico — 08/11/2026 (FE-24 / BE-20)

PWA **61fa83db0cba53e8591fd2fbb87173eedc1330ce** (PR #89), SQL **001–048**, webhook **v72 ACTIVE** (verify_jwt=false). Orden ejecutado con autorización del propietario: merge de la PR → Pages con `version.json` = 61fa83d (la PWA salió antes que el SQL; compatible) → IP actual agregada a Network Restrictions por el propietario (el pooler rechazaba la conexión) → `db push --linked --dry-run` (solo 047 y 048) → `db push --linked` → verificación (4 cuentas × 31 categorías, 29 reglas, registro vacío, funciones sin acceso para anon/authenticated) → deploy del webhook desde 61fa83d → smoke 401 en `/`, `worker` y `client-push` → vista previa (16) revisada por el propietario → `category_reclass_apply(16)`: 16 movidos, `run_id` **29036e58-c4f5-42b6-b69c-8a5ba0239d60**, vista previa posterior 0. Cola v2 habilitada y sin leases antes del cambio. Rollback: PWA y webhook a f7e74d6 / v71 conservando 047/048; reclasificación con `select public.category_reclass_revert('29036e58-c4f5-42b6-b69c-8a5ba0239d60');`. Aceptación manual en el celular realizada por el propietario el 09/11/2026.

## Registro histórico — 05/11/2026 (FE-25 / NOTIF-01)

PWA **bb14ace67e5e5e5003316d68bf822fafe4f8489a** (PR #81), SQL **001–046**, webhook **v71 ACTIVE** (verify_jwt=false). Orden ejecutado con autorización del propietario: secretos VAPID (privada solo en Edge) → `db push --linked` con dry-run previo (solo 045 y 046) → deploy del webhook desde 48b184f → smoke 401 en `/`, `worker` y `client-push` → merge de la PR → Pages con `version.json` = bb14ace. Cola v2 habilitada y sin leases activos antes y después; los 8 trabajos v1 históricos pendientes no se tocaron. Aceptación en celular pendiente.

## Registro histórico — 30/10/2026 (BE-19)

PWA **800e82101a1d4c5269ae32179e7169ed6bd005c3**, SQL **001–043**, webhook **v67 ACTIVE** (verify_jwt=false con verificación propia conservada). PR #74 integra BE-19: confirmación de pagos y códigos nominativos de renovación enviados por WhatsApp. Migración 043 aplicada a producción, webhook v67 desplegado con los 28 assets (incluyendo renewals.ts). PWA publicada en GitHub Pages con version.json verificado. Rutas no autorizadas 401. Aceptación manual de BE-19 pendiente con cuenta autorizada. [Registro de validación](../planes/VALIDACION_BE_19.md) y [evidencia](../planes/evidencias/BE_19_DESPLIEGUE_2026-10-30.json).

## Registro histórico previo: v66 y BE-22 — 30/10/2026

PWA 7dd418e, SQL 001–042, webhook v66 ACTIVE. PR #73 corrigió importes múltiples localmente. [Registro histórico](../planes/VALIDACION_BE_22_IMPORTES_MULTIPLES.md).

## Contrato candidato 049 (textos del bot más cercanos) — 09/11/2026

Rama `feat/mensajes-bot-cercanos`: mínimo **049**, rollback fijado en **fbbad78d801d6f9869f07b4776b776198d486435** (main publicado: PWA 61fa83d + docs, webhook v72; mínimo **048**). 049 solo reemplaza textos de respuesta en `apply_whatsapp_job`, `next_whatsapp_job` y `whatsapp_over_limit_reply` (reemplazo verificado del texto anterior, sin cambiar lógica ni permisos); aborta sin cambios si la definición vigente no contiene exactamente los textos esperados. Orden: 049 → webhook → PWA (la PWA no cambia en lo funcional). Rollback: conservar 049 (el runtime anterior funciona igual; solo verá los textos nuevos en las respuestas generadas por SQL). Sin aplicar ni publicar.

## Contrato candidato 048 (FE-24 / BE-20 categorías) — 07/11/2026

Contrato candidato en rama `feat/categorias-ampliadas`: mínimo **048**, rollback fijado en **f7e74d684ebbad41589e15c1a14e7ab7e8146207** (#88, mínimo **046**). 047 es expansiva (catálogo de categorías ampliado y alta con 31); 048 solo instala la reclasificación reversible (tablas `category_reclass_rules` / `category_reclass_log` y funciones `category_reclass_target`, `category_reclass_candidates`, `category_reclass_preview`, `category_reclass_apply`, `category_reclass_revert`), sin cron nuevo ni datos reclasificados. Como el mínimo del contrato es 048, el orden de publicación es: 047 + 048 → webhook → PWA → vista previa → revisión del propietario → aplicar la reclasificación (con nueva autorización). Rollback: conservar 047/048 y sus datos (sin down); la reclasificación se deshace únicamente con `category_reclass_revert`. Si #88 (f7e74d6) no fue publicado, el propietario debe elegir el último commit publicado como rollback antes de publicar. Sin aplicar ni publicar.

## Contrato candidato 046 (FE-25 / NOTIF-01 push) — 05/11/2026

Publicado el 05/11/2026 (ver cabecera). Contrato: mínimo **046**, rollback fijado en **769b5b37937f26f4b92d9ca9610827c9c022c8c0** (mínimo 044). Orden sugerido: (1) generar un par VAPID; guardar `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY` y `VAPID_SUBJECT` como secretos Edge y la pública en `config/environments.json → production.vapidPublicKey`; (2) aplicar 045 y 046; (3) desplegar el webhook; (4) publicar la PWA. Sin VAPID el webhook responde 503 a `client-push` y los avisos quedan pendientes; sin la clave pública en la PWA el control de notificaciones no se muestra. Rollback: conservar 045/046 y sus datos; para frenar envíos, `select cron.unschedule('pesito-client-push')`. El runtime anterior no conoce la ruta: el cron recibiría un error, no envía nada. Aplicado y publicado el 05/11/2026.

## Contrato candidato 045 (FE-25 avisos de cliente) — 05/11/2026 (reemplazado por 046)

Contrato candidato en rama `feat/fe25-avisos-cliente`: mínimo **045**, rollback fijado en **769b5b37937f26f4b92d9ca9610827c9c022c8c0** (main con webhook v69), mínimo **044**. 045 solo agrega `app_settings.client_reminders_enabled` (default true). La PWA nueva oculta recordatorio e interruptor si la columna no existe, y el runtime anterior no la lee: aplicar 045 antes o después de publicar la PWA es compatible. Rollback: conservar 045 y sus datos; no hacer down. Sin cambios en el webhook. Sin aplicar ni publicar.

## Contrato de release 044 (fix despacho renovación BE-19) — 03/11/2026

Contrato candidato: mínimo **044**, rollback fijado en **c12657269abb06755d00fa1969dc49bc34e9b410** (PR #75), mínimo **043**.
Corrige el bloqueo en `claim_subscription_renewal_notice` originado por `verified_test_sender_digits` en NULL en `public.whatsapp_ops_config`.
Sincroniza el emisor aprobado desde `public.system_config.whatsapp_bot_phone`, instala trigger para cambios futuros y añade fallback defensivo.
Al aplicar 044 a producción, el cron recuperador tomará automáticamente los avisos de renovación pendientes sin necesidad de reconfirmar el pago.

## Contrato de release BE-19 (043) — registro histórico

Contrato vigente: mínimo **043**, rollback de runtime **7dd418e367a797e8406c6cfe1acedeeba22c5258**, mínimo **042**. Se mantiene SQL 043 y los datos al volver al runtime v66. Migraciones 001–042 intactas; la configuración no acredita aplicación productiva. El ensayo debe cubrir rollback/042, candidato/043 y rollback/043; sobre 043 repite pago, código nominativo, envío simulado y canje con fixtures, conservando ACL y acumulación. Compatibilidad completa todavía pendiente de ensayo CI; pruebas SQL en memoria no la sustituyen.

Publicación futura, con controles y autorización específica:

1. Verificar que el candidato probado coincide con su commit y con la migración 043. Drenar la cola v2 y leases antes del cambio; conservar mensajes históricos sin reproducirlos.
2. Aplicar solo 043, verificar inventario 001–043, RLS, ACL, funciones, anclas y caché de PostgREST. No modificar migraciones previas ni generar pagos/códigos con clientes reales como prueba.
3. Desplegar whatsapp-webhook del mismo commit. Mantener HMAC, trabajador privado y emisor de prueba aprobado; sin secretos nuevos, IA, plantillas, facturación o cron nuevo. La recuperación existente incluye la nueva bandeja.
4. Publicar PWA del mismo candidato y verificar identidad del artefacto. Son operaciones separadas; no inferir una por la otra. La acción web confirma la transacción y después llama wake_subscription_renewals; el cron respalda cierres de pestaña/fallos al despertar.
5. Aceptación solo con cuenta de prueba autorizada: RENOVAR, solicitud única, confirmar pago, recibir un código, vencimiento intacto hasta canje, canje único y ningún segundo WhatsApp. Probar ventana expirada con fixture aislado, no cambiando fechas de clientes reales.

Rollback: no ejecutar down/reset ni borrar pago, código, bandeja o mensajes. Detener/drenar entregas **sending** antes de cambiar runtime; si hay incertidumbre, revisar sin reenviar. v66 conserva contratos generales y SQL protege códigos asignados, pero **no despacha la bandeja BE-19** y su panel anterior puede listar esos códigos como invitaciones: no copiarlos ni gestionarlos desde ese flujo. Mantener pagos/pendientes y preferir corrección hacia adelante para recuperar la entrega; no prometer que volver al runtime antiguo completa BE-19. No reintentar automáticamente estados uncertain/blocked/failed terminales. La compatibilidad de datos se valida sobre 043, no retirándola.

[Validación y límites de BE-19](../planes/VALIDACION_BE_19.md).

## Contrato histórico de release — 29/10/2026 (reemplazado en el candidato BE-19)

El paquete actual requiere **042**: BE-22 envía listas de ediciones/bajas que 041 no aplica completas. El rollback fijado es **ecba42024d413ef05a2a4d1abeb04bdbb97e869e** (PR #67), con mínimo **041**. Se leen de `config/environments.json`; no son una lectura del entorno productivo ni aplican SQL.

- `minimumMigration`: mínimo conservador del paquete candidato; debe coincidir con la última migración distribuida por su snapshot. Una migración nueva exige revisión del contrato.
- `rollbackCommit`: fuentes exactas de PWA y webhook del runtime anterior; no es una versión Edge ni una restauración de base.
- `rollbackMinimumMigration`: mínimo exigido por ese snapshot. No ordena retirar migraciones posteriores: al volver desde 042 se conserva 042 y todos los datos.

El mínimo del corte anterior a BE-22 es 041; **no alcanza para el runtime actual**. Si una lectura de producción muestra solo 041, no considerar habilitado el candidato actual. La configuración no demuestra que 042 esté aplicada. Esta corrección de herramientas no publica PWA/Edge ni toca producción.

Aceptar el rollback únicamente con evidencia del ensayo específico de estas tres combinaciones:

| Esquema exacto | Runtime | Prueba |
| --- | --- | --- |
| 001–041 | ecba420 | Mínimo real de rollback, en un stack independiente. |
| 001–042 | Candidato | Mínimo del candidato y operaciones múltiples. |
| La misma base 001–042 | ecba420 | Volver al código anterior conservando datos. |

`test:release:guards` comprueba formatos, inventarios completos, mínimos, hashes compartidos y matriz de evidencia. `test:release` verifica además esos contratos contra los snapshots fijados, RPC/SQL reales del stack local y ambos runtimes. Su probe ejecuta alta/edición/confirmación/cancelación y un fallo de envío: el reintento debe tener etapa `send`, código `QUEUE_SEND_RETRY` y no reinterpretar ni duplicar movimientos. Meta/IA no reciben peticiones del probe. También verifica expiración, límites/ACL y fallos de persistencia sin guardado parcial.

Una compilación o una fila 041/042 en el historial no acredita todo lo anterior. `release:manifest` registra valores/hashes; `observedDeployment` sigue empezando en null/false y no prueba publicación. Las migraciones compartidas no pueden alterarse para hacer pasar el ensayo.

El ensayo conserva las guardas anteriores de loopback, Docker local, variables y logs seguros, exige Node fijado y checkout limpio, y solo produce evidencia de éxito después de las tres filas y su limpieza. Con Docker inaccesible o alguna fila fallida, el rollback queda **sin verificar**, aunque pasen las guardas y los tests unitarios. Ver [validación y límites](../planes/VALIDACION_CONTRATO_RELEASE_041_042.md).

### Registro histórico — contrato del 27/10/2026

Producción: **035, webhook v59 y PR #46/ebdd6ee**, publicados y aceptados. El mínimo y rollback se leen de config/environments.json: **d62f42af4a15c25ba941e48b8da579fc0f0f2071**, manteniendo 035 y el corte diario. Las referencias de 027/BE-08 a commits anteriores son históricas y no sirven como rollback del cupo actual. Retención desactivada; prepararla/probarla no autoriza activarla. [INF-15](../planes/VALIDACION_INF_15.md), [retención INF-14](../planes/VALIDACION_INF_14_RETENCION.md).

## Mapa actual

```text
PR -> Frontend + Webhook + PostgreSQL + Ensayo de release
merge main -> mismos controles -> Pages (PWA estática)
operador -> migraciones Supabase -> verificación -> Edge Function -> smoke
Meta -> HMAC webhook -> cola PostgreSQL -> worker por usuario -> Meta/Groq
pg_cron -> dispatch privado -> worker (misma credencial en Vault y Edge)
```

La publicación de Pages no despliega Edge Functions ni aplica SQL. Los tres componentes deben registrarse juntos aunque sus versiones difieran. No hay staging alojado; los ensayos se hacen en Supabase local aislado, sin datos ni proveedores reales. No activan facturación.

## Barreras locales del agente — 06/11/2026

El checkout está vinculado a producción (`supabase/.temp/project-ref`) y la CLI de Supabase tiene un token persistente en el Administrador de credenciales de Windows. El vínculo se conserva para los despliegues autorizados. Para que Claude Code no ejecute operaciones productivas por accidente, `.claude/settings.json` registra el hook `PreToolUse` `.claude/hooks/guard-supabase.mjs`. El hook cubre Bash, PowerShell, Edit, Write, MultiEdit y NotebookEdit, y se ejecuta en forma exec (`node` + `args`) con `onFailure: "block"`.

**Qué hace:**

- **Bloquea siempre (`deny`)**, sin diálogo:
  - `supabase link` y `unlink`;
  - `config push`;
  - `db reset` remoto;
  - `migration repair|down|squash` fuera de un workdir local;
  - `projects delete`;
  - `branches delete`;
  - `secrets unset`.

  Si alguna vez hacen falta, las ejecuta el propietario a mano.
- **Pide aprobación del propietario (`ask`)**, en el diálogo de permisos de la app:
  - Cualquier invocación de la CLI de Supabase que no sea un subcomando local (`start`, `stop`, `status`, `functions serve`, `db reset`, `migration list --local`, etc.), con `--workdir` dentro de `.temp/` o `%TEMP%` y sin `--linked`, `--project-ref`, `--db-url` ni `--project-id`. Esto incluye operaciones remotas **sin** `--linked`: `functions deploy`, `secrets`, `projects`, `inspect`, `gen types` y subcomandos futuros.
  - Comandos que mencionen el ref de producción o dominios `supabase.co/.com`.
  - `psql`/`pg_dump` sin host loopback.
  - `node scripts/verify-sql-transport.mjs`.
  - `vite preview` de un build productivo (`.temp/pwa-prod-check`).
  - Intérpretes con código arbitrario (`node -e`, scripts fuera de `scripts/` y `tests/`, `deno`, `python`, shells anidados, `Invoke-Expression`, `Start-Process`, `-EncodedCommand`).
  - `npx`/`npm exec` de cualquier paquete distinto de `supabase@<.supabase-version>` en modo local.
  - `npm install`/`ci`.
  - Lecturas de credenciales (`cmdkey`, `Get-StoredCredential`, etc.).
  - `npm run`/`npm test`/`node scripts|tests/…` cuando un archivo ejecutable difiere de `HEAD` y contiene patrones sensibles. El hook revisa:
    - cambios sin preparar;
    - la versión *staged* del índice;
    - archivos nuevos sin seguimiento;
    - archivos ignorados dentro de `scripts/`, `tests/` y `.claude/hooks/`.

    Si `git` no responde, también pide aprobación.
  - Edit/Write o comandos que toquen `.claude/settings*.json`, `.claude/hooks/`, `supabase/.temp/`, `supabase/config.toml`, `config/environments.json` o `~/.claude/settings*.json`.
- **Ante cualquier error interno pide aprobación** (fail-closed). Si el proceso no arranca o falla, `onFailure: "block"` hace que Claude Code bloquee la herramienta.
- **`permissions.deny`** repite las destructivas más comunes como segunda capa, y `disableBypassPermissionsMode: "disable"` impide el modo que omite permisos.

**Cómo se autoriza:** solo en el diálogo de permisos que la app muestra al propietario, eligiendo "permitir una vez". No existe variable, flag ni texto dentro del comando que habilite una operación. El agente no puede editar el hook ni los settings sin pasar por ese mismo diálogo.

**Autoprueba sin tocar producción:** en una sesión abierta en la raíz de `chatbot-gastos`, pedir `echo PESITO_GUARD_SELFTEST`. El hook responde `ask`. El comando es inofensivo y se puede rechazar.

**Pruebas:** `node --test .claude/hooks/guard-supabase.test.mjs`. Solo usa JSON simulado de PreToolUse y repos git temporales en `%TEMP%`; no ejecuta la CLI ni accede a red.

**Limitaciones (riesgo residual abierto, no resuelto):**

1. **Es una heurística sobre texto.** Un comando o un archivo ofuscado (por ejemplo, un dominio armado por concatenación) puede no coincidir con ningún patrón.
2. **Solo cubre las herramientas del agente** en sesiones abiertas en la raíz de `chatbot-gastos`. No cubre la terminal del propietario, CI, otras aplicaciones ni sesiones abiertas en otra carpeta.
3. **Si alguien edita `.claude/settings.json` fuera del agente**, o si se usa una versión de Claude Code que no respeta `onFailure`, la barrera puede no aplicar.
4. **El token persistente de la CLI sigue disponible para cualquier proceso del usuario.** La única barrera técnica fuerte sería no guardarlo de forma persistente y usar `SUPABASE_ACCESS_TOKEN` solo en la terminal del despliegue. El 07/11/2026 el propietario decidió mantenerlo guardado **hasta el lanzamiento público**.

**Al lanzar (pendiente SEC-TOKEN):**

1. En https://supabase.com/dashboard/account/tokens, revocar el token actual de la CLI y crear uno de deploy, por ejemplo `pesito-deploy-…`. Guardarlo solo en un gestor de contraseñas.
2. Ejecutar `npx --yes supabase@2.120.0 logout`. Quita la credencial `Supabase CLI:supabase` y conserva `supabase/.temp`.
3. En cada deploy autorizado:
   - abrir una terminal nueva, **sin ejecutar `claude` en ella**;
   - cargar el token con `$s = Read-Host "Token de Supabase" -AsSecureString; $env:SUPABASE_ACCESS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))`;
   - desplegar;
   - ejecutar `Remove-Item Env:SUPABASE_ACCESS_TOKEN` y cerrar la terminal.
4. Rotar el token periódicamente o ante cualquier sospecha.

## Reclasificación de categorías (047 / 048) — publicada 08/11/2026

Estado: **publicado y aplicado el 08/11/2026** (ver "Última publicación observada"). El procedimiento de abajo se conserva para referencia y para una eventual reversión. Diseño y plan: [diseño](../superpowers/specs/2026-11-07-categorias-ampliadas-design.md) · [plan](../superpowers/plans/2026-11-07-categorias-ampliadas.md).

**Qué contiene:**

- **047** (expansiva): agrega 15 categorías (11 de gasto y 4 de ingreso) a todas las cuentas existentes con `on conflict do nothing` y redefine `bootstrap_user` para crear y verificar 31. La PWA y el webhook actuales siguen funcionando con ella aplicada.
- **048**: solo **instala** la tabla de reglas `category_reclass_rules` (copia de `category-rules.ts`, con paridad verificada por test), la tabla de registro `category_reclass_log` y las funciones `category_reclass_target`, `category_reclass_candidates`, `category_reclass_preview`, `category_reclass_apply` y `category_reclass_revert`. **No mueve datos al aplicarse.** Las funciones son `SECURITY DEFINER` y están revocadas para `anon`, `authenticated` y `service_role`: solo se ejecutan por la vía de SQL de producción autorizada por el propietario, protegida por el diálogo del hook `guard-supabase.mjs` (ver "Barreras locales del agente").

**Orden de publicación (cada paso con autorización explícita del propietario para esa acción):**

1. Aplicar 047 y 048 (048 solo instala; el contrato candidato exige mínimo 048 antes de publicar webhook y PWA).
2. Desplegar el webhook (`category-rules.ts`, `gemini.ts`, `local-movements.ts`).
3. Publicar la PWA (`categoryVisuals.ts`, `Icons.tsx`).
4. Ejecutar la vista previa: `select * from public.category_reclass_preview();`. Devuelve cantidades por par origen → destino, sin conceptos ni datos de clientes. Las cantidades **incluyen las filas cabecera** de los planes en cuotas (además de sus cuotas), así que la suma de `movements` es exactamente el valor que espera `category_reclass_apply`.
5. El propietario revisa las cantidades. Si algo no cierra, no se aplica.
6. Con **nueva autorización**, ejecutar `select * from public.category_reclass_apply(<total>);`, donde `<total>` es la suma de `movements` de la vista previa revisada. Guardar el `run_id` que devuelve en la evidencia de la operación.

**Garantías de `category_reclass_apply`:**

- Exige el total esperado: con `p_expected` nulo o negativo aborta con `RECLASS_EXPECTED_REQUIRED`. Si los candidatos actuales difieren, aborta con `RECLASS_EXPECTED_MISMATCH` sin mover ni registrar nada: repetir la vista previa y volver a revisar.
- Si un cliente editó un plan mientras corría, aborta con `RECLASS_CONCURRENT_CHANGE` y no se mueve nada (un plan en cuotas nunca queda partido). Reintentar después de una vista previa nueva.
- Es idempotente: una segunda ejecución no encuentra candidatos.
- Dentro de un plan que se mueve, las cuotas en estado `cancelled` o `pending` no son candidatas y **conservan su categoría anterior** (el cliente no las ve, así que no hay inconsistencia visible).

**Reversión de la reclasificación:** `select public.category_reclass_revert('<run_id>');`. Restaura la categoría anterior **solo** de las filas que siguen en la categoría de destino; no pisa ediciones posteriores del cliente. Devuelve la cantidad restaurada. Con `run_id` nulo aborta con `RECLASS_RUN_REQUIRED`.

**Rollback compatible:**

- Revertir la PWA no revierte SQL ni webhook, y no deshace una reclasificación ya aplicada.
- 047 es expansiva: con la PWA o el webhook anteriores, las categorías extra no rompen nada. No se editan migraciones ya aplicadas; cualquier corrección va en una migración nueva.
- Los movimientos reclasificados se deshacen solo con `category_reclass_revert`.

**Limitaciones:** la vista previa y la reclasificación se probaron en PGlite con datos ficticios; no hay verificación contra producción hasta que el propietario autorice cada paso. Los borradores pendientes de WhatsApp y las filas `pending` (incluidas las v1 históricas) no se tocan.

## Registro previo y contrato

1. Confirmar repo, rama, árbol limpio y remoto sincronizado. Si hay cambios ajenos, detenerse sin pisarlos.
2. Usar Node de .node-version, Deno 2.9.6 y CLI de .supabase-version. Ejecutar los checks de README y exigir el ensayo de release del PR. El manifiesto de solo lectura se genera con `npm run release:manifest -- production`; guarda SHA del código, herramientas y hashes de cada SQL/archivo runtime en .temp/release-production.json.
3. Leer estado real: historial supabase_migrations.schema_migrations; versión/estado de whatsapp-webhook y verify_jwt; cola habilitada; trabajos en procesamiento/fallidos y cron. Solo conteos, sin payloads ni secretos.
4. Registrar fuera del bundle: SHA candidato/anterior, enlace a CI, migrations antes/después, versión Edge anterior/nueva, hora, smoke y estado previo de cola. observedDeployment del manifiesto empieza con null/false: **no es evidencia de haber desplegado**; completarlo solo con lecturas verificadas.
5. Leer el contrato vigente de esta cabecera y config/environments.json. Contrastar inventarios completos, funciones/ACL y SHA del runtime; no deducir compatibilidad de una sola fila del historial. Las referencias a 034/v58 y puentes antiguos que aparecen más abajo son históricas.

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

- Instalación vacía: aplicar **todas las migraciones completas en orden (001–042; historial productivo verificado el 30/10/2026)**, con Auth y publicación supabase_realtime preparados por Supabase. No usar un PostgreSQL común sin esquemas/extensiones como si fuera Supabase. El ensayo CI verifica el stack real con datos sintéticos.
- Instalación existente: comparar el historial real con los archivos y sus hashes; aplicar únicamente las migraciones nuevas aprobadas, sin reescribir las ya aplicadas. Si hay deriva, parar y revisarla.
- Preparar primero la expansión compatible del esquema; validar permisos, índices y dependencias antes de publicar el consumidor. Cualquier cambio destructivo requiere otro plan, no un down automático.
- Antes de usar CLI remoto, verificar el contenido de supabase/.temp/project-ref coincide exactamente con ystyatotldslfmucvgsq. link solo cuando corresponda y nunca en el workdir local. Mantener SSL y restricciones de red; no abrir 0.0.0.0/0 ni resetear contraseña por un problema de conexión.
- Preview: `npx --yes supabase@2.120.0 db push --linked --dry-run`. Revisar que proponga **solo** SQL nuevo esperado. Después ejecutar `db push --linked` una sola vez. En esta red, IPv6 o allowlist pueden impedir TCP: utilizar SQL Editor/Management API HTTPS con el procedimiento revisado de migración y registro de historial en la misma transacción. No inventar un repair para saltarse errores.
- Las migraciones 020–024 incluyen transacciones/guardas propias. No envolver indiscriminadamente con BEGIN/COMMIT adicionales. Si se usa Management API, construir una única transacción revisada y registrar el texto/versión exactos; verificar commit y lectura posterior antes de seguir.
- 020 requiere quietud de trabajos v1 y ausencia de dos grupos abiertos por cliente. No resolver una guarda borrando filas; conservar y revisar el estado.
- 021/022 requieren pg_cron, pg_net, http y Vault; dispatch contiene el endpoint del proyecto actual. Un nuevo proyecto alojado requiere migración/configuración revisada del destino antes de activar. El preparador local bloquea ese dispatch y desprograma cron, sin alterar migraciones versionadas.
- En altas nuevas, 005 promueve usuarios preexistentes. Instalar sobre Auth vacío; designar después solo al administrador aprobado. El administrador inicial está excluido de BE-13 por decisión del propietario; 005 no se vuelve a ejecutar en producción.

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

El ensayo automatizado prueba primero el rollback sobre su mínimo exacto en un stack descartable independiente; después conserva el mismo esquema expandido durante candidato y rollback. Sirve ambos webhooks con el runtime local y compila/sirve ambas PWA; además ejecuta sus módulos reales de procesamiento/cola contra RPC locales, con envío simulado y bloqueo de tráfico externo en ese probe. Comprueba identidad de SW/version y persistencia del movimiento sintético. No es un ensayo de restauración, cron productivo o entrega real por Meta.

Antes del cambio de runtime se exige cola sin trabajos pendientes/fallidos/retenidos ni leases activos. No se acredita compatibilidad de checkpoints BE-22 en vuelo con un runtime anterior: drenar/verificar la cola o detener la operación sin borrar mensajes. La matriz ensaya contratos unitarios del rollback sobre 042; no promete que ecba420 interprete ediciones múltiples pendientes.

## Fuentes y alcance

- [Flujo local de Supabase](https://supabase.com/docs/guides/local-development/cli-workflows).
- [Migraciones de base de datos](https://supabase.com/docs/guides/local-development/database-migrations).
- [Gestión de entornos](https://supabase.com/docs/guides/deployment/managing-environments).

La evidencia de esta implementación se guarda en [VALIDACION_INF_10.md](../planes/VALIDACION_INF_10.md). No instalar WSL, cambiar BIOS ni contratar un staging para resolver el ensayo; en una PC sin motor Docker funcional, usar el runner Linux aislado del CI gratuito del repositorio público.

## Mensajes en revisión manual (026)

Un mensaje que agota los reintentos conserva payload y aviso durable en waiting/manual_review. No se reintenta automáticamente ni bloquea nuevos mensajes. El aviso pide concepto y monto en texto y explica que el resto de la lista sigue disponible. Las pausas stale/capacity y las desconocidas conservan su bloqueo.

026 reemplaza dos funciones sin alterar filas, propietarios ni permisos. Al aplicarla, el cron normal podrá procesar pendientes v2 antes bloqueados, en su orden original; puede emitir respuestas a sus remitentes. No reproducir mensajes en revisión ni registros v1. Los movimientos siguen requiriendo confirmación del resumen. No es necesario desplegar otra versión de Edge para este cambio SQL. Un rollback del código conserva 026; no restaurar las funciones con el bloqueo anterior.

Si Meta rechaza el envío o WhatsApp no entrega el mensaje, la aplicación no puede garantizar que el cliente vea el aviso. reply_sent_at acredita el cierre del intento de envío, no la lectura por el cliente. El seguimiento de entregas/alertas requiere trabajo adicional.

## Autenticación del envío administrativo

La ruta POST ?action=test-send acepta la clave secreta **default** vigente del proyecto en el header **apikey** y la compara con SUPABASE_SECRET_KEYS, un objeto JSON que provee el runtime. Es el contrato de servicio a servicio descrito por [Supabase](https://supabase.com/docs/guides/functions/auth#service-to-service-calls). No combinar credenciales: basta ese header; no usar claves públicas, JWT de clientes ni decodificar un role sin verificar.

Si se incluye apikey, una clave incorrecta o una configuración inválida produce 401, sin fallback a otro mecanismo. Sin ese header se conserva la comparación exacta anterior de Authorization: Bearer con SUPABASE_SERVICE_ROLE_KEY, por compatibilidad. La recepción Meta conserva HMAC y la recuperación conserva su propio secreto; no conceden permiso de envío administrativo.

El aviso requiere destino numérico de 8–16 dígitos y texto explícito no vacío de hasta 4096 unidades UTF-16. Cuerpo inválido: 400 sin enviar. Fallo del adaptador: 502 sin éxito ni reintento automático de la ruta. Una petición aceptada llama una vez al adaptador existente; esto no incorpora idempotencia entre solicitudes HTTP diferentes. Ante timeout o resultado ambiguo, no reenviar sin verificar; 200 indica aceptación del proveedor, no entrega/lectura en el teléfono.

Las pruebas utilizan claves ficticias y transporte interceptado con red denegada. No registrar valores de claves, teléfonos, textos ni respuestas crudas del proveedor. El propietario suspendió el uso operativo de las credenciales reales: preparar/publicar código no autoriza recuperarlas ni probar un envío real; requiere una nueva autorización específica.

## Monitoreo y avisos (027)

Aplicar 027 antes del webhook que registra métricas y entrega avisos. Instala tablas/RPC privadas y dos cron adicionales. Tanto WhatsApp como la limpieza quedan desactivados al instalar. Los avisos requieren destinatario admin vinculado, emisor de prueba aprobado/verificado y ventana entrante; activar solo después de publicar el trabajador. No habilitar la limpieza sin aprobación de la política. El preparador local desprograma recuperación, monitoreo y retención. [Operación y límites](MONITOREO_Y_RETENCION.md).

## Detalle de errores por cliente (028)

Publicar 028 antes del worker que registra diagnósticos y del panel que los muestra. La RPC privada valida el lease y una lista de códigos, sin recibir textos de excepciones. El panel admin y el aviso autorizado resuelven la identidad del perfil al consultar/enviar; el historial de avisos conserva solo códigos y conteos. Fechas explícitas en Argentina. Los registros anteriores sin diagnóstico se identifican como tales. [Política y límites](MONITOREO_Y_RETENCION.md#detalle-de-incidentes-por-cliente-028).


## Confirmación de revisión vigente (033 / BE-07)

033 modifica solo apply_whatsapp_job, con firma y permisos existentes. Exige que el contexto recibido siga coincidiendo con el estado durable mostrado (usuario/grupo/versión y sin resumen pendiente). Al liberar mensajes waiting/stale anula la autorización de confirmación anterior, sin descartar las operaciones de esos mensajes. CONFIRMAR antiguo pide revisión; el siguiente resumen y una nueva confirmación siguen el flujo habitual.

Aplicar 033 antes de integrar el candidato cuyo mínimo es 033, tras revisar su CI y obtener autorización. Revalidar el cuerpo vigente de la RPC, su propietario/ACL/SECURITY DEFINER/search_path, el historial de migraciones y la salud de cola; guardar evidencia de código, sin exportar datos. El script aborta ante una definición inesperada o parcialmente parcheada; no forzar reemplazos ni marcar la migración aplicada si falla.

No requiere deploy de whatsapp-webhook: sus llamadas no cambian. La migración no modifica filas ni reejecuta mensajes; cuando los usuarios retomen sus listas, el flujo actualizado podrá procesar los retenidos y pedir nueva confirmación. Verificar después la definición exacta, historial y cola/cron. El ensayo de 25 horas se realiza exclusivamente en base descartable; no envejecer borradores de clientes.

Mantener 033 al volver a PWA/Edge compatibles; no reponer metadatos antiguos de confirmación ni quitar la protección para volver a una versión anterior del código. La retención sigue desactivada y los backups permanecen aplazados. [Pruebas, aceptación y límites](../planes/VALIDACION_BE_07.md).

**Registro 26/10/2026:** 033 aplicada y registrada atómicamente; definición de apply_whatsapp_job exactamente coincidente y atributos conservados. PR #42/1688c7b publicada con los cinco controles de main aprobados. Edge v56 y su bundle conservados; salud de cola/cron y PWA comprobadas. [Evidencia de publicación y límites](../planes/VALIDACION_BE_07.md#publicación-y-cierre-autorizados--26102026).

## BE-08 / 034 — publicado el 26/10/2026

Producción verificada: 034, PR #43/bd896f0 y webhook v58 ACTIVE. Se publicó primero el lector compatible del commit 80e920dcad9581bbff2d54b2c48ae2e255fe6882 como v57, se verificó quietud y se aplicó/registró 034; después se publicó el webhook final. No habilitar operaciones incompletas antes de ese esquema. Revisar el estado real y los cuatro controles del SHA aprobado antes de cada etapa.

Después de 034, el rollback de runtime solo puede usar ese puente o un lector posterior que admita amount/occurred_on NULL. El puente conserva y muestra esos ítems, con instrucciones compatibles, pero no ofrece toda la nueva funcionalidad de completado. Mantener 034 y los datos; no regresar directamente a v56/v52 ni ejecutar down o reset. El ensayo descarga únicamente el SHA de rollback fijado si un squash dejó ese objeto fuera del historial de main, sin cambiar el checkout. Incluye ejecución de ambos lectores con 20 operaciones/NULL, instalación completa y rollback de runtimes/PWA sobre el mismo esquema. [Procedimiento y aceptación](../planes/VALIDACION_BE_08.md).

## BE-09 / 036 — publicado y verificado

Contrato del candidato: mínimo 036 y rollback de runtime 7f26e33 (mínimo 035), conservando la expansión 036. Nueva RPC privada para el backend; monthly_summary conserva firma y pasa a ARS solamente. Aplicar SQL y verificar ACL/cache antes del webhook; no requiere pausa de cola. No ejecutar down ni modificar movimientos para validar. Publicado y verificado: f96ab87/PR #48, 036 y webhook v60; consulta del propietario aceptada. [Validación](../planes/VALIDACION_BE_09.md).

## BE-12 / 037 — publicado y verificado

Candidato mínimo 037, rollback f96ab87 (mínimo 036) conservando 037. Aplicar SQL y comprobar funciones/ACL antes del webhook, tras CI y autorización. Ediciones versionadas bajo lease y patch validado completo antes de escribir; no altera movimientos confirmados. El helper es privado incluso para service_role. Preserva el formato legacy del runtime anterior; checkpoints nuevos llevan grupo/versión y no deben reinterpretarse al volver a v60. Dejar terminar trabajos iniciados o pedir repetir la corrección si fuera necesario. Sin cambios de proveedores, claves, cuotas, hosting o retención. [Validación y límites](../planes/VALIDACION_BE_12.md).

Cierre productivo del 28/10/2026: 037 aplicada, PR #49 integrada en 1e45c94, webhook v61 y PWA verificados con cinco controles aprobados. Aceptación del propietario y cancelación sin movimientos de prueba guardados completadas; ver VALIDACION_BE_12.md. Las instrucciones de preparación anteriores registran el orden y el rollback, no un despliegue pendiente.

## BE-11 / 038 — publicado y verificado

Mínimo del candidato 038, rollback de runtime 1e45c94 (mínimo 037) conservando 038. Tras CI y autorización, verificar historial/fuentes/ACL y las pausas de cola, aplicar/registrar SQL y publicar el webhook. Se agrega capacity_resumes y se ajusta metadata de checkpoints ya aplicados waiting/capacity sin error, sin cambiar estado/contenido ni reenviarlos; no se modifican movimientos financieros. El cron normal podrá atender alias que antes no eran elegibles. Mantener attempts monotónico y no reiniciar recibos IA. Helpers privados y guardas de 033 conservados. Ver [validación y rollback](../planes/VALIDACION_BE_11.md).

Cierre BE-11 del 28/10/2026: PR #50 en 0cc65d9, esquema 038 y webhook v62 verificados con cinco controles aprobados. Aceptación 20+1, alias, numeración y cancelación completa sin movimientos de prueba guardados, IA o fallos técnicos. Las instrucciones anteriores conservan el procedimiento de instalación/rollback; la publicación está completada. Ver VALIDACION_BE_11.md.

## Histórico — candidato BE-13 y contrato 039/038

Aplicar únicamente 039 después de CI aprobado y autorización de publicación; registrar su historial en la misma transacción. Publicar luego la PWA del candidato. No desplegar webhook: v62 permanece compatible. El contrato del candidato exige 039; rollback de runtime fijado en 0cc65d9/038, conservando 039 y su atomicidad. No restaurar el catch histórico ni volver a ejecutar 005. Ver [validación BE-13](../planes/VALIDACION_BE_13.md) para diagnóstico de solo lectura, recuperación y aceptación.
