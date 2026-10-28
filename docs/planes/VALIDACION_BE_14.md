# Validación y despliegue de BE-14

Fecha: 28/10/2026.
Rama: `codex/be-14-atomic-whatsapp-linking`.
Alcance: Vinculación atómica y protección contra fuerza bruta en WhatsApp y consultas de invitación (`BE-14`).

## Problemas resueltos

1. **Vulnerabilidad de fuerza bruta en vinculación de WhatsApp:**
   Cualquier remitente en WhatsApp podía enviar reiteradamente intentos de vinculación (`vincular 123456`) sin límite de intentos ni período de enfriamiento.
2. **Falta de atomicidad e inconsistencia en worker state durante la vinculación:**
   Al vincular un número mediante `apply_whatsapp_job`:
   - El estado de intentos no se registraba por actor (`wa_id`).
   - El `whatsapp_worker_state.user_id` no se actualizaba inmediatamente en la misma transacción de vinculación, dependiendo de un ciclo posterior de adquisición.
3. **Enumeración de códigos de invitación y consultas ilimitadas:**
   La RPC `public.check_invitation_code` diferenciaba entre código inexistente y código ya utilizado ("El código de invitación no existe" vs "Este código de invitación ya fue utilizado"), permitiendo enumeración de códigos válidos. Asimismo, no contaba con límite de consultas por IP o cliente.
4. **Vencimiento estricto en servidor:**
   Los códigos de invitación carecían de soporte de fecha de expiración opcional en servidor (`expires_at`), y el cálculo de vigencia requería garantizar que tanto el alta inicial (`bootstrap_user`) como la renovación (`redeem_invitation_code`) y la consulta previa validaran de manera estricta `clock_timestamp()`.

## Cambios realizados

### 1. Migración `040_atomic_whatsapp_linking.sql`
- **Control de intentos en `public.whatsapp_worker_state`:**
  - `link_attempts integer not null default 0`
  - `link_locked_until timestamptz`
  - `last_link_attempt_at timestamptz`
- **Expiración de códigos de invitación y tabla de límites:**
  - `alter table public.invitation_codes add column if not exists expires_at timestamptz;`
  - Creación de tabla `public.invitation_check_attempts` (identificador, contador de intentos, ventana temporal y bloqueo), protegida por RLS.
- **`public.check_invitation_code(p_code text)`:**
  - Extrae de forma segura el identificador del cliente a través de encabezados HTTP (`request.headers` -> `cf-connecting-ip`, `x-real-ip`, `x-forwarded-for`).
  - Límite de 15 intentos por minuto; en caso de superación, aplica bloqueo de 5 minutos con mensaje seguro.
  - Mensaje uniforme ante código inexistente, ya utilizado o expirado: `"Código de invitación inválido o no disponible."`, impidiendo la enumeración de códigos.
- **`public.apply_whatsapp_job(p_id uuid, p_token uuid, p_action jsonb)`:**
  - Bloquea el estado del trabajador (`whatsapp_worker_state for update`).
  - Si el teléfono está bloqueado (`link_locked_until > clock_timestamp()`), rechaza la operación inmediatamente con `"Demasiados intentos fallidos de vinculación. Por seguridad, esperá 15 minutos antes de volver a intentar."`.
  - Si el código es inválido o expirado (`link_code_expires_at <= clock_timestamp()`), incrementa el contador de intentos. Al alcanzar 5 intentos, aplica bloqueo por 15 minutos.
  - Si el código es válido y no expirado:
    - Valida que el usuario no esté en ejecución en otro worker (`QUEUE_LINK_BUSY`).
    - Desvincula atómicamente al usuario previo que tuviese asignado ese teléfono (tanto en `whatsapp_links` como en `profiles.phone_number`).
    - Asigna el teléfono al nuevo usuario, activa el vínculo, borra el hash y vencimiento del código.
    - Actualiza el perfil con el teléfono vinculado.
    - Actualiza inmediatamente `whatsapp_worker_state` asignando `user_id = u` y reseteando `link_attempts = 0` y `link_locked_until = null`.
    - Responde `"¡Listo! Tu WhatsApp quedó vinculado con Pesito ✅"`.
- **`public.redeem_invitation_code` y `public.bootstrap_user`:**
  - Incorporan la comprobación `(expires_at is null or expires_at > clock_timestamp())`, impidiendo el canje o registro con códigos de invitación vencidos.

### 2. Frontend (`src/Login.tsx`)
- Actualizado para presentar el mensaje seguro devuelto por el servidor cuando `data.valid === false`, permitiendo que el usuario vea mensajes informativos (como el aviso de exceso de intentos) sin exponer detalles internos.

### 3. Pruebas automatizadas (`tests/whatsapp-linking-sql.test.ts`)
- 15 ensayos exhaustivos en PostgreSQL real vía PGlite:
  1. Conservación de metadata, ACL, definer y configuración de `apply_whatsapp_job`.
  2. Validación de código de invitación activo.
  3. Mensaje seguro y genérico para código inexistente.
  4. Mensaje seguro y genérico para código ya utilizado (sin diferencias de enumeración).
  5. Mensaje seguro y genérico para código vencido en servidor.
  6. Rate limiting de consultas de invitación tras 15 intentos por minuto.
  7. Rechazo de renovación (`redeem_invitation_code`) con código vencido sin consumirlo.
  8. Rechazo de alta (`bootstrap_user`) con código vencido y rollback atómico total.
  9. Vinculación exitosa de WhatsApp con código válido, activando vínculo, perfil y worker state.
  10. Desvinculación atómica y limpia de un propietario anterior del mismo número telefónico.
  11. Rechazo de código de WhatsApp vencido en servidor e incremento de contador de intentos.
  12. Bloqueo por fuerza bruta al 5to intento fallido y rechazo de códigos (incluso válidos) durante el bloqueo.
  13. Rehabilitación automática de vinculación tras expirar el tiempo de bloqueo.
  14. Rollback atómico completo ante concurrencia ocupada (`QUEUE_LINK_BUSY`), preservando el código sin consumir.
  15. Prevención de doble vinculación ante llamadas con el mismo código.

## Evidencia de validación técnica

- **Vitest:** 46 suites pasadas, 1,051 pruebas pasadas (0 fallos).
- **Pruebas SQL de integración:** 12 escenarios aprobados (`npm run test:sql`).
- **Guardas de release:** 6 pruebas aprobadas (`npm run test:release:guards`).
- **Linting:** 0 errores (`npm run lint`).
- **Compilación TypeScript y Vite:** aprobada sin errores (`npm run build`).
