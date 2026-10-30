# BE-19 — Pago confirmado con código nominativo

**Fecha:** 30/10/2026. **Estado:** publicado y verificado en producción técnica tras autorización expresa del propietario. PR #74 en `main` (`800e82101a1d4c5269ae32179e7169ed6bd005c3`), SQL 001–043 aplicado, webhook v67 ACTIVE y PWA publicada en GitHub Pages. Aceptación manual pendiente con cuenta de prueba autorizada.

## Contrato acordado

1. Cliente vinculado envía RENOVAR o QUIERO RENOVAR. Se registra una solicitud abierta por cuenta y se responden las instrucciones comerciales vigentes; sin IA ni movimientos.
2. Thomas verifica pago fuera del sistema. En Clientes → Renovaciones confirma días (1–3650 o acceso sin vencimiento).
3. Una transacción registra pago, código generado/asignado a ese cliente y outbox única. Repetir con igual duración recupera el resultado; otra duración se rechaza.
4. Después del commit se despierta el trabajador existente; cron respalda pendientes. El recibo confirma pago y entrega código para Ajustes, sin afirmar activación o vencimiento calculado.
5. El cliente canjea usando la RPC existente. Recién entonces se acumulan días una vez. No hay segundo WhatsApp. Ajustar días sigue siendo una acción administrativa separada, sin comprobante de pago.

La propuesta histórica de notificar tanto el ajuste manual como el canje queda reemplazada por esta decisión del propietario.

## Persistencia y seguridad

- Solo nueva migración `043_subscription_payment_codes.sql`; no reescribe 001–042 ni cambia roles.
- `subscription_renewal_requests`: identidad/vínculo, solicitud, pago, duración, código y canje. Una abierta por cliente, locks perfil→solicitud compatibles con canje.
- `subscription_renewal_notices`: estado, intentos, disponibilidad, token y lease. No textos financieros ni códigos en logs.
- Tablas sin acceso directo de anon/authenticated/service_role. RPC de panel exigen administrador autenticado; claim/authorize/finish solo service_role. Helpers/trigger privados.
- `invitation_codes.renewal_user_id` protege destinatario, duración y consumo. No sirve para alta ni cuenta ajena; no elimina ni altera códigos generales.
- Mantiene controles de canje, acumulación y suspensión existentes. Crear pago/código no toca vencimientos, movimientos o presupuestos.
- Verifica identidad de mensaje bajo el lease de cola; no deriva RENOVAR mixto con gastos a este flujo.

## Entrega y costo

- Ventana de 23h55m desde timestamp válido de RENOVAR firmado/persistido, nunca timestamp futuro. Destino exacto vinculado, sin probar otra variante del número. Revalidación antes de enviar: vínculo y linked_at, cuenta, preferencias, bot/cola y emisor de prueba aprobado.
- Ventana vencida: pago/código conservados, waiting_window visible; otro RENOVAR reabre la entrega, sin emitir otro código.
- Cambio de vínculo/cuenta suspendida/respuestas desactivadas: no entregar; revisión administrativa. Un pago previo no se reasigna a otro destino.
- Rechazo HTTP 4xx (excepto 408): mismo aviso/código, backoff y hasta cinco intentos. Timeout/red/408/5xx después de iniciar envío, o lease vencido: uncertain, sin reenvío automático.
- Si guardar el resultado de envío falla, el lease termina incierto; no se vuelve a confirmar pago para repetir entrega.
- Despacho limitado a cinco avisos por activación y 20 segundos para iniciar nuevas entregas; timeouts remotos existentes. Recuperación programada existente.
- Sin IA, plantillas, facturación, emisor nuevo ni validación bancaria. La ventana limita envío, no canje posterior del código.

## Validación y despliegue

- Primer control completo: 1.166 pruebas aprobadas, antes de ampliar escenarios SQL.
- Control SQL BE-19 ampliado: 23 pruebas aprobadas.
- Lint, SQL histórico (12), guardas de release (14), Deno check/lint aprobados.
- Control final local previo al merge: **1.179 pruebas aprobadas en 59 archivos**, build aprobado.
- CI en GitHub Actions (#41089399656 sobre `800e82101a1d4c5269ae32179e7169ed6bd005c3`):
  - Frontend: success
  - PostgreSQL: success
  - Webhook: success
  - Ensayo de release: success (verificación completa de contratos, instalación de 043 y rollback en contenedor aislado)
  - Publicar: success (PWA desplegada a GitHub Pages)
- **Migración 043 aplicada a producción:**
  - Historial verificado `001–043` mediante `supabase migration list --linked`.
  - Tablas `subscription_renewal_requests`, `subscription_renewal_notices` y columna `invitation_codes.renewal_user_id` operativas.
  - RPCs `admin_confirm_renewal_payment`, `request_subscription_renewal`, `claim_subscription_renewal_notice`, `finish_subscription_renewal_notice` creadas con permisos correctos.
- **Webhook desplegado:**
  - Versión 67 ACTIVE (`verify_jwt: false`, HMAC propio y worker secreto conservados).
  - 28 módulos cargados, incluyendo `renewals.ts`.
- **Smoke en producción:**
  - POST sin firma a webhook: HTTP 401.
  - POST sin clave worker a `?action=worker`: HTTP 401.
  - `version.json` en GitHub Pages verificado sin caché: `800e82101a1d4c5269ae32179e7169ed6bd005c3`.

## Aceptación pendiente

- Probar con cuenta de prueba autorizada de Thomas:
  1. Enviar RENOVAR o QUIERO RENOVAR desde WhatsApp y verificar respuesta con instrucciones comerciales sin IA.
  2. Abrir Clientes → Renovaciones en panel Admin y verificar visualización con contador de ventana 24h.
  3. Ejecutar "Confirmar pago y enviar código" con 30 días.
  4. Verificar recepción de WhatsApp con recibo y código, sin activar días anticipadamente.
  5. Canjear código en Ajustes → Código de renovación y verificar acumulación única de días.

[Evidencia de despliegue](evidencias/BE_19_DESPLIEGUE_2026-10-30.json).

No se usaron clientes reales, no se enviaron recibos reales no autorizados ni se modificaron roles ni administradores. Continúan Thomas como único administrador, INF-08/hosting aplazados e INF-14 desactivada.
