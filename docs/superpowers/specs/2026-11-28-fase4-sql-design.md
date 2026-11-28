# Fase 4, grupo de base de datos (migración 058) — diseño

Fecha: 28/11/2026. Hallazgos SEC-12 a SEC-19 del plan de remediación (P3), más los pendientes de 3.2 que llevan migración. Decisiones del propietario: SEC-15 opción A (no publicar borrados en tiempo real); SEC-17 queda para cuando exista staging (tarea 2.6).

## Estado verificado (producción, solo lectura, 28/11/2026)

- `authenticated` puede actualizar 10 columnas de `profiles` (incluidas `email`, `created_at`, `phone_number`, `role`, `subscription_*`; el trigger de 031 frena rol y suscripción).
- La PWA escribe directo: `transactions` (editar y borrar), `budgets` (upsert y borrar), `app_settings` (tres interruptores), `profiles` (nombre y apellido), y el admin `system_config` (upsert) e `invitation_codes` (borrar). No escribe directo en `categories`.
- `system_config` tiene la política `anyone can read public system config` (`using (true)`, `to public`); todas las lecturas de la PWA son con sesión.
- Ejecutables por `anon`: `check_invitation_code` (a propósito, registro), `is_admin`, `has_active_subscription` (las dos usadas en políticas RLS), `get_my_role`, `get_distinct_transaction_months`.
- `SECURITY DEFINER` sin `pg_catalog` en el `search_path`: `get_active_draft_group(uuid)`, `get_my_role()`, `has_active_subscription()`, `next_gemini_model_slot()`. `CREATE` sobre `public` ya está cerrado para `anon` y `authenticated`.
- `supabase_realtime` (dueño `postgres`) publica insert, update, delete y truncate de `transactions`, `budgets`, `whatsapp_links` y `app_settings`. La PWA además refresca cada 30 s.
- Un solo administrador. Push: 6 suscripciones, todas de `web.push.apple.com`.

## Objetivos

| # | Cambio |
| --- | --- |
| SEC-12 | `authenticated` solo actualiza `first_name`, `last_name` y `updated_at` de `profiles` (privilegio por columna). |
| SEC-13 | `transactions`: sin INSERT directo; UPDATE solo de `description`, `amount_ars`, `currency`, `kind`, `category_id`, `occurred_on`, `updated_at`; DELETE se mantiene. `app_settings`: UPDATE solo de los tres interruptores y `updated_at`; sin INSERT ni DELETE. `categories`: sin escritura directa. `budgets` sin cambios. |
| SEC-14 | La lectura de `system_config` pasa a `to authenticated`. |
| SEC-15 | `alter publication supabase_realtime set (publish = 'insert, update')`: los borrados ya no se emiten; la PWA los ve con el refresco de 30 s. |
| SEC-16 | Revocar EXECUTE a `anon` de `get_my_role` y `get_distinct_transaction_months`. `is_admin` y `has_active_subscription` siguen ejecutables por `anon` porque las políticas RLS las llaman (sin sesión devuelven falso). `search_path = pg_catalog, public` en las cuatro funciones listadas. |
| SEC-18 | Tabla `admin_audit_log` (RLS; lectura solo admin; sin escritura directa) llenada por triggers `SECURITY DEFINER`: cambios de `profiles.role`, altas/cambios/bajas en `system_config`, bajas en `invitation_codes`. Trigger que impide que el último administrador pierda el rol o se borre. |
| SEC-19 | `save_push_subscription`: si el endpoint ya es de otra cuenta, rechaza (`PUSH_ENDPOINT_IN_USE`) en vez de reasignarlo; el endpoint tiene que ser de un servicio conocido (Apple, Google FCM, Mozilla, Microsoft). Constraint en `push_subscriptions` con la misma lista. |
| 3.2 | `delete_my_account` (redefinida desde 057): suma los números de `whatsapp_message_queue.user_id` y `subscription_renewal_requests.wa_id`; bloquea primero las filas de estado por número y de la cola (mismo orden que el bot) y después el perfil; borra `category_reclass_log` de la cuenta y anula las `notes` de sus códigos. El bloque `$verify$` también comprueba `guard_renewal_code`. |

## No objetivos

- SEC-17 (URL de producción en las migraciones): queda para staging.
- Grupos de webhook y PWA de la Fase 4.
- Cambios en la PWA o el webhook: la migración respeta exactamente lo que escriben hoy.

## Enfoques

1. **Privilegios por columna y triggers (elegido).** No cambia la PWA: cada escritura que hace hoy sigue permitida, y lo demás se cierra.
2. Pasar todas las escrituras a RPC: descartado por ahora, obliga a reescribir pantallas sin ganar seguridad adicional sobre datos propios.
3. Solo CHECKs: no alcanzan para impedir que un cliente cambie `status` o `source` de un movimiento.

## Compatibilidad y publicación

- PWA y webhook actuales siguen funcionando con la 058 (verificado contra sus escrituras). Las funciones del bot son `SECURITY DEFINER` y no dependen de los privilegios de `authenticated`.
- Orden: `db push` de la 058 (no hay código nuevo que publicar; el merge solo trae la migración, tests y docs). Contrato: mínimo 058, rollback a la PWA publicada (mínimo 057).
- Rollback: conservar la 058; si algo de la PWA fallara por un privilegio, una migración correctiva vuelve a otorgarlo.

## Pruebas (PGlite 001–058)

Como `authenticated`: no cambia `email`/`created_at`/`role` propios y sí `first_name`; no inserta movimientos directo ni cambia `status`/`source`, sí edita concepto, monto y fecha y borra; `app_settings` solo los tres interruptores; no escribe categorías; upsert de presupuestos sigue. Como `anon`: `system_config` vacío y sin error; `get_my_role` rechazado; `check_invitation_code` sigue. Publicación sin delete. Auditoría registra rol, configuración y código borrado con el actor; el último admin no pierde el rol ni se borra. Push: endpoint ajeno rechazado sin cambiar de dueño; host desconocido rechazado; Apple aceptado. Borrado: limpia `category_reclass_log`, notas y números de la cola. Propiedades de funciones existentes sin cambios salvo el `search_path` indicado.

## Lo que queda al constructor

Nombres de triggers y de la tabla de auditoría, forma exacta de las expresiones regulares de hosts.
