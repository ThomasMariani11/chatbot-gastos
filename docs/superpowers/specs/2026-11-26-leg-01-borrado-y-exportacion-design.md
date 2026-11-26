# 3.2 Borrado de cuenta y exportación de datos — diseño

Fecha: 26/11/2026. Tarea 3.2 del plan de remediación (hallazgo LEG-01). Decisiones del propietario: registros de pago **conservados y anonimizados** (opción A); borrado **inmediato**.

## Intención

Que un cliente pueda, desde la PWA y sin pedírselo al administrador, bajarse una copia de sus movimientos y borrar su cuenta con todos sus datos. Es lo que va a exigir la política de privacidad (3.1) y hoy no existe: las cuentas de prueba se borraron desde la consola de Supabase.

## Estado verificado (producción, solo lectura, 26/11/2026)

- `postgres` puede borrar en `auth.users` (dueño `supabase_auth_admin`): una RPC `SECURITY DEFINER` puede borrar la cuenta en la misma transacción que el resto.
- Borrar `auth.users` arrastra en cascada: perfil, movimientos, categorías, presupuestos, borradores, ajustes, vínculo de WhatsApp, cola de WhatsApp con `user_id`, leases, notificaciones, push, cupos de IA por cliente, solicitudes de renovación, recibos de renovación del admin y pedidos idempotentes de la PWA.
- **Bloqueo:** `invitation_codes.renewal_user_id → profiles` es `NO ACTION`: si el cliente tuvo un código de renovación, el borrado falla. `subscription_renewal_requests.paid_by → profiles` también es `NO ACTION` (afecta solo a administradores).
- **Restos por teléfono** (sin `user_id`): mensajes de la cola recibidos antes de vincular, `inbound_events` y `whatsapp_worker_state` (este último `SET NULL`).

## Objetivos

- **Exportar:** en Ajustes, "Descargar mis movimientos" genera un CSV (abre en Excel) con fecha, tipo, concepto, categoría, monto, moneda, cuota (n de N) y estado, solo de la cuenta propia (RLS). Se arma en el navegador; no pasa por servidores nuevos.
- **Borrar:** en Ajustes, "Borrar mi cuenta", con un aviso claro y la contraseña. Una RPC atómica:
  1. exige sesión; rechaza al administrador (`42501`);
  2. guarda los pagos anonimizados en una tabla nueva (tipo, fecha, días, estado; sin nombre, correo, teléfono ni identificadores de la cuenta);
  3. desarma el bloqueo (`invitation_codes.renewal_user_id = null` de esa cuenta);
  4. borra los restos por teléfono de los números de la cuenta que no estén vinculados a otra cuenta;
  5. borra `auth.users` (el resto cae en cascada);
  6. devuelve `{deleted: true}`.
- Después del borrado, la PWA desuscribe el navegador de las notificaciones, cierra la sesión local y muestra "Tu cuenta fue borrada".

## No objetivos

- Período de arrepentimiento (decisión: inmediato).
- Borrado por el administrador desde el panel (sigue la consola).
- Datos ya enviados a Groq/Gemini o que pasaron por Meta: quedan bajo las políticas de esos servicios; se declara en la política de privacidad.
- Exportar en otros formatos o más datos que los movimientos (presupuestos, categorías): queda para después si el abogado lo pide.

## Enfoques

1. **RPC SQL `SECURITY DEFINER` que borra todo en una transacción (elegido).** Atómico: o se borra todo, o nada.
2. Edge Function con la API de administración de Auth: descartado, suma una ruta pública nueva, la clave de servicio y dos pasos no atómicos (datos y usuario por separado).
3. Pedido al administrador por WhatsApp: descartado, no es autoservicio y deja el borrado librado a la memoria del operador.

## Diseño

### Migración 057

- Tabla `payment_archive(id uuid, kind text, occurred_at timestamptz, duration_days integer, state text, archived_at timestamptz)`, con RLS y sin privilegios para `anon`, `authenticated` ni `service_role`. `kind` ∈ `renewal_request` (de `subscription_renewal_requests` pagadas o canjeadas), `admin_renewal` (de `admin_subscription_requests`), `invitation_redeemed` (de `invitation_codes.used_by`).
- RPC `delete_my_account() returns jsonb`, `SECURITY DEFINER`, `search_path = pg_catalog, public`; `revoke all … from public, anon, service_role; grant execute … to authenticated`. Bloquea el perfil (`for update`) para serializar con renovaciones concurrentes.
- **Agregado al implementar:** el trigger `guard_renewal_code` (043, única definición) impide modificar el dueño o el canje de un código de pago, lo que también bloquea el borrado. Se redefine idéntico salvo una excepción acotada: con la marca local `pesito.account_deletion` = id de la cuenta (la pone solo `delete_my_account`), el código de esa misma cuenta puede pasar a dueño y canje nulos sin cambiar código, días, vencimiento ni estado de canje. Cualquier otro cambio sigue rechazado (prueba incluida).
- Bloque de verificación y `notify pgrst`. Expansiva y compatible.

### PWA

- `src/Settings.tsx`: nueva tarjeta "Tus datos" en el grupo "Cuenta", con:
  - "Descargar mis movimientos (CSV)".
  - "Borrar mi cuenta": diálogo que explica qué se borra, que los pagos quedan anonimizados, que se pierden los días de suscripción restantes y que no se puede deshacer; pide la contraseña y la verifica con `signInWithPassword` antes de llamar a la RPC. Para el administrador, la opción no se muestra (texto: "La cuenta de administrador no se borra desde la app").
- Módulo nuevo `src/accountData.ts`: armado del CSV (con escape de comillas, separador `;` y BOM para Excel en español) y el flujo de borrado (verificar contraseña → RPC → `unsubscribeBrowserPush` → `signOut({ scope: 'local' })`).

### Publicación

Contrato: mínimo 057; rollback a la PWA publicada (mínimo 056). Orden: `db push` de la 057 → merge (PWA). La PWA nueva sin la 057 mostraría un error al borrar; por eso la migración va primero. El webhook no cambia.

## Pruebas

- PGlite (001–057): borra todas las tablas del cliente y deja intactos los datos de otro cliente; con código de renovación ya no falla; los pagos quedan en `payment_archive` sin identificadores; restos por teléfono borrados salvo si el número está vinculado a otra cuenta; admin rechazado (`42501`); `anon` sin acceso; `service_role` sin EXECUTE; atomicidad (un fallo a mitad no borra nada).
- Vitest: CSV (escape, separador, BOM, cuotas, monedas separadas); flujo de borrado (contraseña errónea no llama a la RPC; éxito desuscribe y cierra la sesión local; error muestra el mensaje sin cerrar la sesión); el administrador no ve la opción.

## Lo que queda al constructor

Nombres internos, textos exactos del diálogo (en el tono de la app), forma de leer las categorías para el CSV.
