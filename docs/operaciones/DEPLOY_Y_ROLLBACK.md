# Entornos, publicación y rollback compatible (INF-10)

## Última publicación observada — 28/11/2026 (Fase 4, grupo de base de datos)

PWA **91d7ae7c9d429b9246daaf0202bd8fccdaec4b7d** (PR #137; sin cambios de PWA), SQL **001–058**, webhook **v81** sin cambios. Orden ejecutado con autorización del propietario: merge de la PR #137 → CI de `main` en verde (incluido el ensayo de release con la 058) y Pages con `version.json` = 91d7ae7 → lecturas previas: 6 suscripciones push, todas de `web.push.apple.com` y 0 fuera de la lista; `next_gemini_model_slot()` de `postgres`; 1 admin → `db push --linked --dry-run` (solo 058) → `db push --linked` → verificación de solo lectura: historial 058; `profiles` UPDATE solo `first_name`, `last_name`, `subscription_status` y `updated_at`; `transactions` sin INSERT ni UPDATE de `status`, con UPDATE de `amount_ars` y DELETE; `app_settings` solo los tres interruptores y `updated_at`; `categories` sin INSERT; `budgets` sin cambios; `system_config` leída solo por `authenticated`; publicación sin delete; ejecutables por `anon`: solo `check_invitation_code`, `has_active_subscription` e `is_admin`; ninguna función SECURITY DEFINER sin `pg_catalog`; `admin_audit_log` con RLS, sin INSERT para `authenticated` y 0 filas; los cuatro triggers; CHECK de push validado con las 6 filas; 4 cuentas; cuatro crons activos. Rollback: conservar la 058. **Prueba del propietario (28/11/2026):** en la PWA, cambiar el nombre, editar y borrar movimientos, presupuestos, interruptores de Ajustes, activar notificaciones y pausar/reactivar un cliente desde el panel funcionaron con la 058.

## Registro histórico — 26/11/2026 (3.2: borrado de cuenta y exportación)

PWA **edf1cdafd8d466a87f5c06a16d4d57f8bf0ae14c** (PR #134), SQL **001–057**, webhook **v81** sin cambios. Orden ejecutado con autorización del propietario: merge de la PR #134 → CI de `main` en verde (Frontend, PostgreSQL, Webhook, ensayo de release con la 057 y Publicar) y Pages con `version.json` = edf1cda → `db push --linked --dry-run` (solo 057) → `db push --linked` enseguida → verificación de solo lectura por `db query --linked`: historial 057; `delete_my_account` SECURITY DEFINER, dueño postgres, `search_path=pg_catalog, public`, EXECUTE solo para authenticated (no anon ni service_role), con la exigencia de sesión reciente y la limpieza de auditoría; `guard_renewal_code` SECURITY DEFINER con la excepción de borrado y su trigger activo; `payment_archive` con RLS, sin privilegios y 0 filas; 4 cuentas; cuatro crons activos. Rollback: conservar la 057; PWA 388730d (no muestra la tarjeta). **Pendiente:** prueba del propietario con una cuenta de prueba creada para eso.

## Registro histórico — 26/11/2026 (SEC-06: límite de mensajes por número)

PWA **66bc3482040adada368dfba50e08004e6cb7027f** (PR #129; la PWA no cambia respecto de a1cfd5c), SQL **001–056**, webhook **v81 ACTIVE** (verify_jwt=false). Orden ejecutado con autorización del propietario: merge de la PR #129 → CI de `main` en verde (Frontend, PostgreSQL, Webhook con `deno check`/`lint`/`test`, ensayo de release con la 056 y Publicar) y Pages con `version.json` = 66bc348 → deploy del webhook desde 66bc348 (v81) → smoke 401 en `/`, `worker` y `client-push` → `inbound_events` con 464 filas (índice instantáneo) → `db push --linked --dry-run` (solo 056) → `db push --linked` → verificación de solo lectura por `db query --linked`: historial 056; `enqueue_whatsapp_messages` SECURITY DEFINER, dueño postgres, `search_path=pg_catalog, public`, EXECUTE solo para service_role, con las marcas `pesito_rate_limited` y `pesito_quiet_not_linked`; columnas `rate_notice_at` y `not_linked_notice_at`; índice `inbound_events_wa_received_idx`; cola habilitada; los cuatro crons activos. Rollback: conservar la 056; webhook v80 compatible (ignora las marcas); PWA a1cfd5c. **Pendiente:** prueba del propietario con un número de prueba; concurrencia real (extender `tests/durable-queue-concurrency.mjs` hasta la 056).

## Registro histórico — 25/11/2026 (SEC-07: baja de notificaciones al cerrar sesión)

PWA **ed9e4d7c61ce6014fdca4c7afd75ed71d4dbc403** (PR #125, SEC-07, y PR #126, texto del cartel de cierre), SQL **001–055** y webhook **v80** sin cambios. CI de `main` en verde; el "Ensayo de release" falló una vez en la fase `candidato_webhook_y_pwa` (arranque del worker en Supabase local, sin código de salida; el mismo código había pasado en `main` 2c4170c y en el CI de la PR) y pasó al reintentar solo ese job. Pages con `version.json` = ed9e4d7. Rollback: PWA 6f8bab1 (sin cambios de datos).

## Registro histórico — 25/11/2026 (SEC-05: con una foto solo se cargan gastos)

PWA **9ebf5e9** (PR #123; sin cambios de PWA respecto de a985aae), SQL **001–055** (sin cambios), webhook **v80 ACTIVE** (verify_jwt=false). Orden ejecutado con autorización del propietario: merge de la PR #123 → CI de `main` en verde (Frontend, PostgreSQL, Webhook con `deno check`/`lint`/`test`, ensayo de release y Publicar) → deploy del webhook desde 9ebf5e9 (v80) → smoke 401 en `/`, `worker` y `client-push`. Rollback: webhook v79 (sin cambios de esquema). **Pendiente:** probar con una foto real de prueba que una imagen con la palabra "confirmar" no confirme el borrador.

## Registro histórico — 25/11/2026 (SEC-04: cupo de IA por cliente)

PWA **136810f77858a0aa09b3b13cc4b3c867fb10aa89** (PR #119), SQL **001–055**, webhook **v79 ACTIVE** (verify_jwt=false). Orden ejecutado con autorización del propietario: merge de la PR #119 → CI de `main` en verde (Frontend, PostgreSQL, Webhook, ensayo de release y Publicar) y Pages con `version.json` = 136810f → deploy del webhook desde 136810f (v79) → smoke 401 en `/`, `worker` y `client-push` → `db push --linked --dry-run` (solo 055) → `db push --linked` → verificación de solo lectura por `db query --linked`: historial 055; política qwen 100/15 y whisper 200/25, ambas habilitadas; `admin_update_ai_quota_policy` SECURITY DEFINER, dueño postgres, `search_path=pg_catalog, public`, EXECUTE solo para authenticated (no anon, no service_role, no PUBLIC); `reserve_whatsapp_ai_quota` SECURITY DEFINER, mismo `search_path`, EXECUTE solo para service_role; `whatsapp_ai_quota_dashboard` SECURITY DEFINER, EXECUTE para authenticated y no para anon; `ai_quota_user_days` con RLS, sin privilegios para anon, authenticated ni service_role y 0 filas; crons `pesito-client-push`, `pesito-whatsapp-observability`, `pesito-whatsapp-queue-recovery` y `pesito-whatsapp-retention` activos. Prueba previa en PGlite, Supabase local aislado (navegador) y el ensayo de release del CI. **Discrepancia:** el último registro anterior era v77 y este deploy quedó como v79; no hay registro de qué fue la v78. Rollback: conservar la 055; PWA a 2a4fe60; antes de volver el webhook a una versión anterior, igualar el límite por cliente al global en ambos carriles desde el panel. **Pendiente:** editar un límite desde el panel en producción con MFA y volver a dejarlo; concurrencia real con `npm run test:concurrency`.

**Después (25/11/2026, solo PWA):** PR #121 (2dd1ca7, aviso de límites guardados junto al formulario) y PR #122 (a985aae, panel de cupo de IA ordenado en el celular). Sin cambios de SQL ni de webhook; Pages publica a985aae.

## SEC-07 (baja de notificaciones al cerrar sesión) — publicado el 25/11/2026 (PWA ed9e4d7)

Rama `fix/sec-07-push-al-cerrar-sesion`. **Solo PWA:** sin migración ni webhook; el contrato de release no cambia (mínimo 055). Al confirmar "Cerrar sesión", la PWA borra la suscripción push del dispositivo en la cuenta y desuscribe el navegador antes del `signOut`, sin trabar el cierre (tope de 3 s). Los otros dispositivos de la cuenta, que el cierre global desloguea, desuscriben su navegador al recibir `SIGNED_OUT`. **Publicación:** merge a `main` (Pages). **Rollback:** PWA anterior; no hay cambios de datos.

## SEC-05 (con una foto solo se cargan gastos) — publicado el 25/11/2026 (webhook v80)

Rama `feat/sec-05-fotos-solo-gastos`. **Solo webhook:** sin migración ni cambios de PWA, así que el contrato de release no cambia (mínimo 055). Diseño en `docs/superpowers/specs/2026-11-25-sec-05-fotos-solo-gastos-design.md`.

- Con una foto, el procesador solo acepta `add_movements`, `request_text` o `unknown`; cualquier otra intención (confirmar, cancelar, borrar, corregir, resumen) no se aplica y el bot responde que esas órdenes se escriben. El control corre después del checkpoint, así que también cubre reintentos de resultados guardados antes del deploy.
- El prompt marca el contenido de la imagen como dato no confiable. Los audios no cambian.

**Publicación** (con autorización del propietario): merge a `main` → deploy del webhook desde ese commit → smoke 401 sin firma en `/`, `worker` y `client-push`. **Rollback:** volver el webhook a v79 (sin cambios de esquema).

## Registro histórico — 18/11/2026 (seguimiento de SEC-01: sin formato de 6 dígitos)

PWA **c9d87611e06541ea6bf58d183f20c153876c9100** (PR #111), SQL **001–054** (sin cambios), webhook **v77 ACTIVE** (verify_jwt=false). Orden ejecutado con autorización del propietario: merge de la PR #111 → CI de `main` en verde (incluido el ensayo de release) y Pages con `version.json` = c9d8761 → deploy del webhook desde c9d8761 (v77) → smoke 401 en `/`, `worker` y `client-push`. Desde esta versión el webhook y la PWA aceptan solo `XXXX-XXXX-XXXX` (o sin separadores, alfabeto de la 054). Rollback: PWA 8406a9e y webhook v76, compatibles con la 054.

## Registro histórico — 18/11/2026 (SEC-01, vinculación de WhatsApp robusta)

PWA **8406a9eab0c470db573c640384b290d3cc41a6de** (PR #107), SQL **001–054**, webhook **v76 ACTIVE** (verify_jwt=false). Orden ejecutado con autorización del propietario: excepción temporal de auditoría para GHSA-fc5q-39xc-vjpf (PR #108, vence el 18/12/2026) → merge de la PR #107 → CI de `main` en verde y Pages con `version.json` = 8406a9e (la PWA acepta ambos formatos) → deploy del webhook desde 8406a9e (v76) → smoke 401 en `/`, `worker` y `client-push` → `db push --linked --dry-run` (solo 054) → `db push --linked` (00:42 UTC; la sustitución verificada de la rama link no abortó) → verificación de solo lectura por `db query --linked` (historial 054; `request_whatsapp_link_code` con el alfabeto de 32, SECURITY DEFINER, `search_path=pg_catalog, public`, EXECUTE para authenticated y no para anon; una sola `apply_whatsapp_job`, SECURITY DEFINER, mismo `search_path`, sin EXECUTE para authenticated, encola `whatsapp_linked`/`whatsapp_unlinked`; check de `kind` con los tipos nuevos; 0 códigos pendientes; 4 vínculos activos intactos; cola habilitada; un cron `pesito-client-push`). Prueba previa en PGlite y en el ensayo de release del CI. Rollback: conservar 054; **no volver el webhook a v75**; PWA a 7d07b17 rechaza el código largo hasta republicar. **Pendiente:** quitar el formato de 6 dígitos del webhook y la PWA (posible desde las 00:52 UTC del 18/11/2026), junto con los menores diferidos.

## Registro histórico — 17/11/2026 (SEC-02, códigos de invitación en el servidor)

PWA **0e247af7d230b24a6fc439644b7851a2d3131728** (PR #103), SQL **001–053**, webhook **v75** sin cambios. Orden ejecutado: merge de la PR (CI en verde, incluido el paso del ensayo `invitaciones_053_generadas_en_servidor`) → Pages publicó la PWA **antes** que el SQL (desvío del orden previsto; efecto: "Crear código" rechazado hasta aplicar la 053, sin crear códigos débiles) → con autorización del propietario, `db push --linked --dry-run` (solo 053) → `db push --linked` → verificación de solo lectura por `db query --linked` (historial 053; RPC SECURITY DEFINER con `search_path=pg_catalog, public`, EXECUTE para authenticated y no para anon; sin insert/update de tabla ni por columna para anon/authenticated; delete para authenticated; políticas: admin select/delete y las dos de `pesito_subscription_writer`; 0 códigos libres sin vencimiento —no había invitaciones sin usar al aplicar—; 1 código de renovación intacto) → Pages con `version.json` = 0e247af. Rollback: conservar 053; PWA a d350e08 (falla cerrado en "Crear código").

## Registro histórico — 17/11/2026 (SEC-03, MFA del administrador)

PWA **d350e08412a10aa71a552adc73381654b05b0c3e** (PR #101), SQL **001–052**, webhook **v75** sin cambios. Orden ejecutado con autorización del propietario: merge de la PR → Pages publicó la PWA (compatible con 051: solo agrega la inscripción o el código antes del panel) → el propietario inscribió y verificó su TOTP en producción desde Administración → `db push --linked --dry-run` (solo 052) → `db push --linked` (la guarda no abortó) → verificación de solo lectura por `db query --linked` (historial 052; una sola `is_admin()`, SECURITY DEFINER, `search_path=pg_catalog, public`, exige aal2 y devuelve false sin sesión; `admin_renew_subscription` exige aal2, dueño `pesito_subscription_writer`, EXECUTE para authenticated y no para anon; 1 admin y 0 admins sin TOTP verificado) → Pages con `version.json` = d350e08. Prueba previa en Supabase local aislado con admin ficticio (16/11/2026). Rollback: conservar 052; PWA a 0a29702 (falla cerrado: sin AAL2 se rechazan las operaciones de admin). Recuperación del factor: panel de Supabase → Authentication → Users → MFA.

## Registro histórico — 10/11/2026 (NOTIF-02, resumen de fin de mes)

PWA **6a768f9450f9a427c8288f4b3ef6e2e0b3723615** (PR #97), SQL **001–051**, webhook **v75 ACTIVE** (verify_jwt=false). Orden ejecutado con autorización del propietario: merge de la PR → Pages publicó la PWA en paralelo (compatible: sin 051 no muestra tarjeta ni interruptor) → deploy del webhook desde 6a768f9 → smoke 401 en `/`, `worker` y `client-push` → `db push --linked --dry-run` (solo 051) → `db push --linked` → verificación (historial 051; `monthly_summary_enabled` boolean not null default true, ninguna cuenta apagada; check de `kind` con los cinco tipos; `enqueue`/`claim`/`finish` SECURITY DEFINER con `search_path=pg_catalog, public` y EXECUTE solo para postgres/service_role; un solo cron `pesito-client-push`; ningún `monthly_summary` encolado) → Pages con `version.json` = 6a768f9. Prueba previa en Supabase local con cuenta y movimientos ficticios, fecha simulada 1/12: tarjeta, "Ver noviembre", interruptor y vista a 360 px correctos. Rollback: conservar 051; PWA y webhook a 26673fd / v74, marcando antes como `skipped` (con autorización) los `monthly_summary` pendientes. Prueba del push en el iPhone del propietario (10/11/2026, autorizada, solo su cuenta): avisos `monthly_summary` de octubre y septiembre y un recordatorio de control, recibidos; el primero (16:54) lo entregó Apple recién a las 17:00 junto con los otros (urgencia "normal", entrega diferida esperable). La tarjeta se acepta el 01/12/2026. Primer envío real: 01/12/2026 10 h ART.

## Registro histórico — 10/11/2026 (segunda tanda de textos del bot)

PWA **7a6055d63b57d2e4e2e6dd0d6a751a98adc32f52** (PR #94), SQL **001–050**, webhook **v74 ACTIVE** (verify_jwt=false). Orden ejecutado con autorización del propietario: merge de la PR → `db push --linked --dry-run` (solo 050) → cola con 283 procesados y 8 pendientes históricos v1 (sin tocar) → `db push --linked` → verificación (`apply_whatsapp_job`, `confirm_draft_group` y `register_subscription_renewal` con una sola versión cada una, sin textos anteriores y con los nuevos; SECURITY DEFINER, `search_path=pg_catalog, public`, dueño postgres y EXECUTE solo para postgres/service_role, o solo postgres en la renovación) → deploy del webhook desde 7a6055d → smoke 401 en `/`, `worker` y `client-push` → Pages con `version.json` = 7a6055d. Rollback: PWA y webhook a 70b0576 / v73 conservando 050 (el runtime anterior funciona igual con los textos SQL nuevos). Aceptación manual en WhatsApp del propietario: 10/11/2026.

## Registro histórico — 09/11/2026 (textos del bot más cercanos)

PWA **4ba7f79f94f4de2284e88f4e71b7aa1989671fc0** (PR #91), SQL **001–049**, webhook **v73 ACTIVE** (verify_jwt=false). Orden ejecutado con autorización del propietario: merge de la PR → `db push --linked --dry-run` (solo 049) → cola habilitada, 0 leases y 0 trabajos en proceso → `db push --linked` → verificación (historial 049, cero funciones con los textos anteriores, `whatsapp_over_limit_reply` con el texto nuevo, `apply_whatsapp_job` sin acceso para authenticated) → deploy del webhook desde 4ba7f79 → smoke 401 en `/`, `worker` y `client-push` → Pages con `version.json` = 4ba7f79. Rollback: PWA y webhook a fbbad78 / v72 conservando 049 (el runtime anterior funciona igual con los textos SQL nuevos). Aceptación manual en WhatsApp del propietario: 10/11/2026.

## Registro histórico — 08/11/2026 (FE-24 / BE-20)

PWA **61fa83db0cba53e8591fd2fbb87173eedc1330ce** (PR #89), SQL **001–048**, webhook **v72 ACTIVE** (verify_jwt=false). Orden ejecutado con autorización del propietario: merge de la PR → Pages con `version.json` = 61fa83d (la PWA salió antes que el SQL; compatible) → IP actual agregada a Network Restrictions por el propietario (el pooler rechazaba la conexión) → `db push --linked --dry-run` (solo 047 y 048) → `db push --linked` → verificación (4 cuentas × 31 categorías, 29 reglas, registro vacío, funciones sin acceso para anon/authenticated) → deploy del webhook desde 61fa83d → smoke 401 en `/`, `worker` y `client-push` → vista previa (16) revisada por el propietario → `category_reclass_apply(16)`: 16 movidos, `run_id` **29036e58-c4f5-42b6-b69c-8a5ba0239d60**, vista previa posterior 0. Cola v2 habilitada y sin leases antes del cambio. Rollback: PWA y webhook a f7e74d6 / v71 conservando 047/048; reclasificación con `select public.category_reclass_revert('29036e58-c4f5-42b6-b69c-8a5ba0239d60');`. Aceptación manual en el celular realizada por el propietario el 09/11/2026.

## Registro histórico — 05/11/2026 (FE-25 / NOTIF-01)

PWA **bb14ace67e5e5e5003316d68bf822fafe4f8489a** (PR #81), SQL **001–046**, webhook **v71 ACTIVE** (verify_jwt=false). Orden ejecutado con autorización del propietario: secretos VAPID (privada solo en Edge) → `db push --linked` con dry-run previo (solo 045 y 046) → deploy del webhook desde 48b184f → smoke 401 en `/`, `worker` y `client-push` → merge de la PR → Pages con `version.json` = bb14ace. Cola v2 habilitada y sin leases activos antes y después; los 8 trabajos v1 históricos pendientes no se tocaron. Aceptación en celular pendiente.

## Registro histórico — 30/10/2026 (BE-19)

PWA **800e82101a1d4c5269ae32179e7169ed6bd005c3**, SQL **001–043**, webhook **v67 ACTIVE** (verify_jwt=false con verificación propia conservada). PR #74 integra BE-19: confirmación de pagos y códigos nominativos de renovación enviados por WhatsApp. Migración 043 aplicada a producción, webhook v67 desplegado con los 28 assets (incluyendo renewals.ts). PWA publicada en GitHub Pages con version.json verificado. Rutas no autorizadas 401. Aceptación manual de BE-19 pendiente con cuenta autorizada. [Registro de validación](../planes/VALIDACION_BE_19.md) y [evidencia](../planes/evidencias/BE_19_DESPLIEGUE_2026-10-30.json).

## Registro histórico previo: v66 y BE-22 — 30/10/2026

PWA 7dd418e, SQL 001–042, webhook v66 ACTIVE. PR #73 corrigió importes múltiples localmente. [Registro histórico](../planes/VALIDACION_BE_22_IMPORTES_MULTIPLES.md).

## Candidato Fase 4, grupo del bot — 28/11/2026

Rama `feat/fase4-bot`. **Solo webhook:** sin migración ni PWA; el contrato no cambia (mínimo 058). Diseño en `docs/superpowers/specs/2026-11-28-fase4-bot-design.md`.

- SEC-20: `x-worker-secret` y el verify token de Meta se comparan en tiempo constante (`secrets.ts`, compartido con el envío administrativo).
- SEC-21: `mediaId` solo dígitos; la descarga de multimedia solo va a `https` de `fbsbx.com`, `fbcdn.net`, `whatsapp.net` o `facebook.com` (y subdominios). Si Meta usara otro dominio, las fotos y audios pedirían texto y aparecerían incidencias `unsupported_media` en el panel.
- SEC-22: las imágenes tienen que empezar con la firma JPEG o PNG de su tipo.
- SEC-23: el reintento solo va de `549…` a `54…`.
- SEC-24: se descartan los mensajes cuyo `phone_number_id` no es `WHATSAPP_PHONE_NUMBER_ID`.
- SEC-27 (avisos en la pantalla bloqueada): sin cambios por decisión del propietario; se declara en la política de privacidad.

**Publicación:** merge → deploy del webhook con smoke 401 en `/`, `worker` y `client-push` → prueba del propietario con una foto de ticket y un audio. **Rollback:** volver a v81.

## Contrato 058 (Fase 4, grupo de base de datos) — publicado el 28/11/2026

Rama `feat/fase4-sql`: mínimo **058**, rollback fijado en **0032135fd6fcb82916b77b764147bde3b4ad2c42** (PWA publicada, verificada con `version.json` el 28/11/2026; mínimo **057**). Diseño en `docs/superpowers/specs/2026-11-28-fase4-sql-design.md`.

**Qué cambia** (sin cambios de PWA ni webhook):
- SEC-12: `authenticated` solo actualiza `first_name`, `last_name`, `updated_at` y `subscription_status` de `profiles` (este último para que el panel pause y reactive; el trigger de 031 solo se lo permite a un admin con MFA).
- SEC-13: sin INSERT directo en `transactions`; UPDATE solo de las columnas que edita la PWA; `app_settings` solo sus tres interruptores; `categories` sin escritura directa. `budgets` y el borrado de movimientos siguen.
- SEC-14: `system_config` se lee solo con sesión.
- SEC-15: `supabase_realtime` publica solo insert y update (los borrados se ven con el refresco de 30 s de la PWA).
- SEC-16: `get_my_role` y `get_distinct_transaction_months` sin EXECUTE para `anon`; `search_path=pg_catalog, public` en cuatro funciones (`next_gemini_model_slot` existe solo en producción, sin migración: deriva histórica; se endurece si está).
- SEC-18: `admin_audit_log` (lectura solo admin) con cambios de rol, de `system_config` y códigos borrados; el último administrador no puede perder el rol ni borrarse (`LAST_ADMIN`).
- SEC-19: `save_push_subscription` no reasigna un endpoint de otra cuenta (`PUSH_ENDPOINT_IN_USE`) y solo acepta Apple, Google FCM, Mozilla y Microsoft (`PUSH_ENDPOINT_HOST`, más un CHECK en la tabla). Las 6 suscripciones de producción son de Apple.
- 3.2: `delete_my_account` suma números de la cola y de renovaciones, bloquea en el orden del bot y borra `category_reclass_log` y las notas de sus códigos.
- SEC-17 queda para cuando exista staging.

**Orden de publicación** (con autorización del propietario): merge (no publica código nuevo) → `db push --linked --dry-run` (solo la 058) → `db push --linked` → verificación de solo lectura (privilegios por columna, política de `system_config`, publicación sin delete, auditoría, CHECK de push, crons). Antes del `db push`, repetir en solo lectura los hosts de `push_subscriptions` (el CHECK se valida al aplicar) y el dueño de `next_gemini_model_slot()`. Probar después en la PWA: editar nombre, editar y borrar un movimiento, presupuestos, los tres interruptores, activar notificaciones y, en el panel, pausar y reactivar un cliente de prueba.

**Rollback:** conservar la 058. Si algo de la PWA fallara por un privilegio, una migración correctiva lo vuelve a otorgar. Nunca hacer un down.

## Contrato 057 (3.2 / LEG-01, borrado de cuenta y exportación) — publicado el 26/11/2026

Rama `feat/leg-01-borrado-exportacion`: mínimo **057**, rollback fijado en **388730d57531d7edfe506860e6c509c6f1c2255d** (PWA publicada, verificada con `version.json` el 26/11/2026; mínimo **056**). Diseño en `docs/superpowers/specs/2026-11-26-leg-01-borrado-y-exportacion-design.md`.

**Qué cambia:**
- Migración 057: tabla `payment_archive` (pagos sin datos personales: tipo, fecha sin hora, días y estado; RLS y sin privilegios para ningún rol) y RPC `delete_my_account()` (solo authenticated; rechaza al administrador; exige una sesión creada hace menos de 5 minutos) que borra la cuenta en un solo paso, incluidas sus entradas de `auth.audit_log_entries`, anula los códigos de pago sin canjear y borra incluidos los restos guardados solo por teléfono salvo los de un número vinculado hoy a otra cuenta. `guard_renewal_code` (043) se redefine con una única excepción: anonimizar el código de pago de la cuenta que se está borrando, que antes bloqueaba el borrado.
- PWA: en Ajustes, tarjeta "Tus datos" con "Descargar mis movimientos" (CSV armado en el navegador) y "Borrar mi cuenta" (aviso y contraseña). Tras borrar, desuscribe el navegador, cierra la sesión local y el ingreso muestra "Tu cuenta fue borrada".
- El webhook no cambia.

**Orden de publicación** (cada paso con autorización del propietario):
1. Merge a `main`: Pages publica la PWA. Compatible con la 056: hasta aplicar la 057, "Borrar mi cuenta" responde "No pude confirmar el borrado" sin borrar nada, y la descarga funciona. Aplicar la 057 enseguida.
2. `db push --linked --dry-run` (solo la 057) y `db push --linked`.
3. Verificar en solo lectura: historial 057; `delete_my_account` SECURITY DEFINER, `search_path=pg_catalog, public`, EXECUTE solo para authenticated; `payment_archive` con RLS y sin privilegios; `guard_renewal_code` con la excepción.
4. Prueba del propietario con una cuenta de prueba creada para eso (nunca con la cuenta de un cliente).

**Rollback:** conservar la 057 (no borra nada por sí sola). La PWA anterior no muestra la tarjeta. Nunca hacer un down.

## Contrato 056 (SEC-06, límite de mensajes por número) — publicado el 26/11/2026 (webhook v81)

Rama `feat/sec-06-limite-mensajes`: mínimo **056**, rollback fijado en **a1cfd5ce57ea272a026c5fc42b615b76999f3dd4** (PWA publicada, verificada con `version.json` el 26/11/2026; mínimo **055**). Diseño en `docs/superpowers/specs/2026-11-26-sec-06-limite-mensajes-por-numero-design.md`.

**Qué cambia:**
- `enqueue_whatsapp_messages` (redefinida desde la 020) cuenta los mensajes aceptados por número en `inbound_events` (índice nuevo por `wa_id, received_at`). Número no vinculado: 5 por minuto y 30 en 24 horas; lo que pasa se descarta sin guardarse. Cliente vinculado: 20 por minuto; el mensaje que pasa el límite se guarda con la marca `pesito_rate_limited` (como máximo una vez por hora, `whatsapp_worker_state.rate_notice_at`) y el resto se descarta.
- Aviso de no vinculado como máximo una vez cada 24 horas: los siguientes mensajes llevan `pesito_quiet_not_linked` (`whatsapp_worker_state.not_linked_notice_at`). Los intentos de VINCULAR se responden siempre, y un mensaje que parece un intento mal escrito recibe la guía aunque esté marcado.
- El webhook responde `BOT_MESSAGES.rateLimited` a la marca de exceso (sin IA) y no responde a la de silencio.

**Orden de publicación** (cada paso con autorización del propietario):
1. Merge a `main` (la PWA no cambia).
2. Deploy del webhook (entiende las marcas; con la 055 no hay marcas y funciona igual que hoy), con smoke 401 sin firma en `/`, `worker` y `client-push`.
3. `db push --linked --dry-run` (debe proponer solo la 056) y luego `db push --linked`.
4. Verificar: historial 056, `enqueue_whatsapp_messages` SECURITY DEFINER con `search_path=pg_catalog, public` y EXECUTE solo para service_role, columnas e índice nuevos, crons activos.

**Rollback:** conservar la 056. El webhook v80 ignora las marcas: procesa el mensaje marcado como uno normal y manda el aviso de no vinculado como antes; los límites de recepción siguen activos. Nunca hacer un down.

**Concurrencia real (26/11/2026):** `tests/durable-queue-concurrency.mjs` (job PostgreSQL del CI, `npm run test:concurrency`) aplica la 056 sobre la 044 y lanza dos tandas simultáneas del mismo número: no vinculado 2×3 → 5 aceptados y un solo aviso; vinculado 2×15 → 21 con una sola marca de exceso. Las pruebas PGlite son secuenciales; incluyen la regresión de CONFIRMAR (grupo y versión) y de mensajes repetidos de la 020.

## Contrato 055 (SEC-04, cupo de IA por cliente) — publicado el 25/11/2026

Rama `feat/sec-04-cupo-ia-por-cliente`: mínimo **055**, rollback fijado en **2a4fe60559fe7560d120c42e270d3731c2de45ca** (`main` publicado, verificado con `version.json`; mínimo **054**). Diseño en `docs/superpowers/specs/2026-11-25-sec-04-cupo-ia-por-cliente-design.md`.

**Qué cambia:**
- Límite diario de IA por cliente, además del global: Qwen (fotos y mensajes largos) 15 y Whisper (audios) 25. El administrador está exento. El global no cambia.
- RPC `admin_update_ai_quota_policy` para editar los límites (exige aal2, o sea MFA del administrador).
- El panel muestra los límites por cliente y el top 5 de uso del día.
- El bot responde un mensaje propio por carril (audios, o fotos y mensajes largos) cuando el cliente llega a su límite; el resto de las reglas locales sigue disponible.

**Orden de publicación** (cada paso con autorización del propietario):
1. Merge a `main`: Pages publica la PWA. Es compatible con el SQL anterior: sin la 055 el panel avisa que la edición de límites no está disponible.
2. Deploy del webhook (entiende `user_exhausted`), con smoke 401 sin firma en `/`, `worker` y `client-push`.
3. `db push --linked --dry-run` (debe proponer solo la 055) y luego `db push --linked`.
4. Verificar: límites iniciales 15/25, permisos de la RPC (no ejecutable por `anon`), y editar un límite desde el panel con MFA y volver a dejarlo.

**Rollback:** conservar la 055. **No volver el webhook a una versión anterior a v79 (v77 o la v78 sin registro) mientras la 055 esté aplicada** sin antes igualar el límite por cliente al límite global en ambos carriles desde el panel (así el global se agota antes y nunca se devuelve `user_exhausted`): v77 trataría `user_exhausted` como error de configuración. La PWA anterior (2a4fe60) no muestra los límites por cliente pero funciona. Nunca hacer un down.

**Concurrencia real (28/11/2026):** `tests/durable-queue-concurrency.mjs` (job PostgreSQL del CI) aplica la 055 y lanza dos reservas simultáneas de dos mensajes del mismo cliente con límite 1: pasa una y la otra recibe `user_exhausted`; la misma reserva repetida en paralelo no suma dos veces.

## Contrato candidato 054 (SEC-01, vinculación de WhatsApp) — 17/11/2026

Rama `feat/sec-01-vinculacion-robusta`: mínimo **054**, rollback fijado en **7d07b1791eb17d8c3b8d089f30ccdd32b6282d6f** (`main` con SQL 053 y la PWA de #106; mínimo **053**).

**Qué cambia:**
- Código de vinculación `XXXX-XXXX-XXXX` de 12 caracteres (alfabeto de 32). Se guarda el hash del código normalizado. La RPC solo genera el formato nuevo y la 054 anula los códigos pendientes; durante la transición el webhook y la PWA aceptan también el formato de 6 dígitos (los emitidos por el SQL anterior).
- Avisos `whatsapp_linked` / `whatsapp_unlinked` por Web Push, enviados por el cron horario (demora de hasta ~1 h). El texto no incluye el número ni datos financieros.
- Al aplicarse, la 054 anula todos los códigos pendientes.

**Orden de publicación** (cada paso con autorización del propietario):
1. Merge a `main`: Pages publica la PWA, que acepta ambos formatos de código.
2. Deploy del webhook (acepta ambos formatos y redacta los avisos), con smoke 401 sin firma en `/`, `worker` y `client-push`.
3. `db push --linked --dry-run` (debe proponer solo la 054) y luego `db push --linked`. Antes del db push, la PWA nueva tiene que estar publicada (aviso de nueva versión disponible). Quien tenga abierta la versión anterior ve "No pudimos generar el código" al vincular hasta recargar.
4. Verificar: la RPC genera el código largo, la vinculación con ambos formatos funciona y llega el aviso en la siguiente corrida del cron.

**Rollback:** conservar la 054. **No volver el webhook a v75 mientras la 054 esté aplicada**: v75 no reconoce el código largo; solo es posible junto con una migración nueva que restaure la RPC. La PWA anterior (7d07b17) rechaza el código nuevo ("No recibimos un código válido") hasta republicar. Nunca hacer un down.

**No objetivos:** confirmación en la PWA antes de activar, límite global de intentos, avisos por WhatsApp (solo Web Push), bandeja de avisos en la PWA y botón "Desvincular".

**Seguimiento (rama `fix/sec-01-quitar-seis-digitos`, 18/11/2026):** el webhook (`link-code.ts`) y la PWA (`src/whatsappLink.ts`) ya no aceptan el formato de 6 dígitos. El bot reconoce el código solo con guiones o sin separadores y con caracteres del alfabeto de la 054; un texto con otra forma (p. ej. con espacios o tres palabras de 4 letras) sigue el camino normal y no suma intentos. Publicación: merge (PWA) y deploy del webhook, en cualquier orden (el SQL ya no emite 6 dígitos). Rollback: volver PWA y webhook a 8406a9e / v76, compatibles con la 054.

## Auditoría de dependencias con excepciones acotadas — 17/11/2026

El job Frontend corre `node scripts/audit-gate.mjs` en lugar de `npm audit --audit-level=high`. Bloquea igual ante cualquier aviso alto o crítico, salvo los listados en `config/audit-exceptions.json` (un aviso GHSA, un paquete, una fecha de vencimiento y el motivo). Un reporte ilegible o una excepción mal formada hacen fallar el job; pasada la fecha (fin del día, hora argentina) el aviso vuelve a bloquear solo.

**Excepción vigente:** GHSA-fc5q-39xc-vjpf en `picomatch` (ReDoS, <=4.0.7), sin versión corregida publicada al 17/11/2026. Solo la usan herramientas de desarrollo (vite, vitest, typescript-eslint) con patrones del propio proyecto; no llega al bundle de la PWA. Aprobada por el propietario el 17/11/2026; **vence el 18/12/2026**. Al salir el parche: actualizar las dependencias y quitar la excepción. No agregar excepciones sin aprobación explícita del propietario.

## Contrato candidato 053 (SEC-02, códigos de invitación en el servidor) — 17/11/2026

Rama `feat/sec-02-codigos-servidor`: mínimo **053**, rollback fijado en **d350e08412a10aa71a552adc73381654b05b0c3e** (`main` con la PWA publicada de SEC-03; mínimo **052**).

**Qué cambia la 053:**
- Nueva RPC `admin_create_invitation_code(p_duration_days, p_notes)`: SECURITY DEFINER, exige `is_admin()` (admin con AAL2). Genera `PESO-XXXX-XXXX-XXXX` (12 caracteres aleatorios de un alfabeto de 32, ~10^18 combinaciones) con `expires_at` a 7 días.
- `invitation_codes`: la política `for all` del admin se reemplaza por `select` y `delete`; se revocan `insert`/`update` a `anon` y `authenticated`. El trigger 043 sigue protegiendo los códigos de renovación.
- Los códigos de invitación libres sin usar y sin vencimiento reciben 7 días desde la aplicación (decisión del propietario, 17/11/2026). Usados, con vencimiento previo y de renovación no cambian.

**Orden de publicación** (cada paso con autorización del propietario):
1. `db push --linked --dry-run`, que debe proponer solo la 053.
2. `db push --linked`.
3. Merge y publicación de la PWA. Entre los pasos 2 y 3, la PWA publicada no puede crear invitaciones (falla cerrado: el insert directo queda rechazado); el resto del panel funciona.
4. Verificar: RPC SECURITY DEFINER con `search_path=pg_catalog, public`, EXECUTE para authenticated y no para anon, sin insert/update para clientes, 0 códigos libres sin usar y sin vencimiento; crear una invitación desde el panel con el código de dos pasos.

**Ensayo de release:** el paso `invitaciones_053_generadas_en_servidor` (`scripts/release-invitation-contract.mjs`) comprueba en Supabase local los permisos reales (sin EXECUTE para anon; sin insert/update de tabla ni por columna para clientes), el rechazo con aal1, el formato y el vencimiento con aal2, y el rechazo del insert directo como `authenticated`. Es SQL sobre el stack, no una llamada por PostgREST con una sesión TOTP real.

**Webhook:** sin cambios.

**Rollback:** conservar 053. La PWA anterior (d350e08) funciona salvo "Crear código", que queda rechazado hasta republicar la versión con la RPC. Nunca hacer un down.

## Contrato candidato 052 (SEC-03, MFA del administrador) — 16/11/2026

Rama `feat/admin-mfa`: mínimo **052**, rollback fijado en **0a297029cbccba136495a3ad0959032924155806** (`main` con la PWA y el webhook v75 publicados; mínimo **051**).

**Qué cambia la 052:**
- Redefine `is_admin()` y `admin_renew_subscription()` para exigir una sesión **AAL2** (TOTP de Supabase Auth), con los mismos dueños y permisos.
- Todas las políticas y RPC que usan `is_admin()` heredan el requisito. Los clientes no cambian.

**Guarda:** la migración **aborta** (`SEC03_ADMIN_SIN_TOTP`) si algún administrador no tiene un factor TOTP verificado en `auth.mfa_factors`.

**Orden de publicación** (cada paso con autorización del propietario):
1. PWA, que es compatible con el SQL anterior: el paso de verificación solo agrega la inscripción o el código antes del panel.
2. El propietario inscribe y verifica su TOTP en producción desde Administración.
3. `db push --linked --dry-run`, que debe proponer solo la 052.
4. `db push --linked`.
5. Verificar:
   - `is_admin()` con `aal2` y `search_path=pg_catalog, public`;
   - el dueño de `admin_renew_subscription` sigue siendo `pesito_subscription_writer`;
   - el panel abre después de ingresar el código.

**Webhook:** sin cambios. Las rutas del bot no usan `is_admin()`.

**Rollback:**
- Conservar la 052. La PWA anterior (0a29702) funciona con la 052, pero sus operaciones de administración se rechazan sin AAL2 (falla cerrado).
- **Recuperación si el administrador pierde el factor** (decisión del propietario, 16/11/2026): eliminarlo desde el panel de Supabase (Authentication → Users → el usuario → MFA) y volver a inscribirlo desde la app.
- **Si el panel queda inaccesible por otra causa:** una migración nueva que restaure la definición anterior de `is_admin()`. Nunca hacer un down.

## Contrato candidato 051 (NOTIF-02, resumen de fin de mes) — 10/11/2026

Rama `feat/notif-02-resumen-mensual`: mínimo **051**, rollback fijado en **26673fdc16a3ef02e5df384533e934c798acee14** (main publicado, webhook v74; mínimo **050**). 051 es expansiva: agrega `app_settings.monthly_summary_enabled` (default true), admite `monthly_summary` en `client_notifications.kind` y redefine `enqueue_client_notifications` y `claim_client_notifications` (esta última devuelve además `period_key`; mismos permisos que 046). Orden: **webhook → SQL 051 → PWA**. El webhook nuevo funciona con el SQL anterior (nunca recibe `monthly_summary`) y, en el orden previsto, ningún webhook viejo recibe el tipo nuevo; la PWA va al final porque lee la columna nueva. Rollback: conservar 051; volver PWA y webhook a 26673fd / v74. Antes de revertir el webhook a v74, con autorización del propietario, marcar como `skipped` los avisos `pending` con `kind = 'monthly_summary'` (v74 los enviaría con el texto de vencimiento). Apagar el cron `pesito-client-push` también pausa los avisos de vencimiento y registro. Publicado el 10/11/2026 (ver arriba).

## Contrato candidato 050 (segunda tanda de textos del bot) — 10/11/2026

Rama `feat/mensajes-bot-cercanos-2`: mínimo **050**, rollback fijado en **70b057661d752a184e1f143d977fffe3f62290a7** (main publicado: PWA 4ba7f79 + docs, webhook v73; mínimo **049**). 050 solo reemplaza textos de respuesta en `apply_whatsapp_job` (confirmar, cancelar, retomar/descartar, vinculación, categoría inexistente), `confirm_draft_group` (motivos de "No pude guardar la lista") y `register_subscription_renewal` (RENOVAR); aborta sin cambios si alguna función no tiene exactamente los textos esperados. Orden: 050 → webhook → PWA (la PWA no cambia en lo funcional). Rollback: conservar 050 (el runtime anterior funciona igual con los textos SQL nuevos). Publicado el 10/11/2026 (ver arriba).

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
