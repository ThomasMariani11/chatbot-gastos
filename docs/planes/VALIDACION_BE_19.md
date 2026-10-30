# BE-19 — Pago confirmado con código nominativo

**Fecha:** 30/10/2026. **Estado:** implementación en `codex/be19-renovacion-pago-codigo`, basada en documentación `f44cc44`. Sin integración, migración productiva, PWA ni webhook publicados. Última producción observada: `7dd418e`, SQL 001–042 y Edge v66.

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

## Validación automática

Fixtures aisladas: solicitud repetida, doble pago, canje doble, nominativo ajeno/registro, códigos generales, pago sin extensión anticipada, rollback al fallar outbox, ventana expirada/reapertura y durante envío, timestamps inválidos/futuros, vínculo cambiado, cuenta vencida/suspendida, bot/cola/preferencias, estado incierto y ACL. El contrato SQL de instalación/rollback se ejecuta también en PGlite.

Interfaz: doble clic, respuesta perdida, ventana cerrada, estado incierto, cancelación de lecturas y respuestas tardías. Meta simulado: emisor, reautorización, rechazo, timeout, red, 5xx, fallo de finalización y logs sin contenido privado.

- Primer control completo: 1.166 pruebas aprobadas, antes de ampliar escenarios SQL.
- Control SQL BE-19 ampliado: 23 pruebas aprobadas.
- Lint, SQL histórico (12), guardas de release (14), Deno check/lint aprobados.
- Deno: 90 pruebas aprobadas sin red, usando DENO_DIR aislado y permiso de lectura de esa caché en Windows. La caché global virtualizada no resolvía tslib; no se cambió código/dependencias para ocultarlo.
- Control final local: **1.179 pruebas aprobadas en 59 archivos**, build aprobado. Incluye 23 casos SQL nuevos y 27 verificaciones focalizadas de entrega/UI. CI pendiente de registrar.
- Vista local ficticia revisada: estados, modal de días, confirmación y feedback sin afirmar activación; sin conexión a Supabase ni WhatsApp.
- PostgreSQL concurrente: escenarios añadidos a `test:concurrency` (pago único, claim exclusivo y canje una vez); **pendiente de ejecución en CI**.
- Ensayo Supabase completo: 043 incluida en inventario, smoke SQL del pago/código/canje en candidato y sobre esquema expandido con runtime de rollback; **pendiente de ejecución**. Docker Desktop no disponible localmente.

## Instalación, rollback y aceptación pendientes

Contrato candidato 043; rollback `7dd418e367a797e8406c6cfe1acedeeba22c5258` / mínimo 042, conservando 043. No se declara compatibilidad completa por un número o tests en memoria. El runtime anterior no entrega esta nueva bandeja; conserva datos, se documenta su límite y se prefiere corrección hacia adelante.

Orden futuro: controles completos → autorización específica → SQL 043 y verificación → webhook → PWA → aceptación con cuenta de prueba autorizada. Ver [procedimiento](../operaciones/DEPLOY_Y_ROLLBACK.md).

No se usaron clientes reales, no se enviaron recibos reales ni se aplicó nada a producción. Continúan Thomas como único administrador, INF-08/hosting aplazados e INF-14 desactivada.
