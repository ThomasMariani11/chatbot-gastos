# Validación FE-06 / BE-02 — renovaciones y canjes

Fecha: 24/10/2026. Base: main 3d5b395. Rama: codex/atomic-subscription-renewals.
Estado al 25/10/2026: corrección publicada en PR #34, migraciones 031/032 aplicadas y verificación técnica completada. Seguimiento del código usado sin usuario asociado abierto; sin correcciones automáticas de datos.

> **Estado vigente — 29/10/2026:** seguimiento del código de prueba cerrado mediante eliminación puntual autorizada y verificada. La lectura del 25/10 se conserva abajo como historia; no se atribuye retrospectivamente una causa ni se corrigieron vencimientos. Ver el cierre al final.

## Resultado preparado

- Migración 031: admin_renew_subscription recibe UUID de intento, cliente, acción extend/lifetime y días (1–3650). Verifica administrador, bloquea su perfil durante la autorización y el perfil del cliente durante el cálculo. Usa el reloj del servidor y suma desde el mayor entre hoy y el vencimiento existente. Devuelve estado/vencimiento persistidos; la interfaz no envía una fecha absoluta.
- Recibos privados por administrador/intento y hash de parámetros. Un reintento no suma días nuevamente y devuelve el vencimiento actual del cliente aunque otra renovación posterior lo haya extendido. No permite reutilizar UUID con otros parámetros ni renovar perfiles administradores.
- redeem_invitation_code conserva su firma y mensajes comerciales, bloquea perfil y código, persiste el cambio y lo comprueba antes de consumir la invitación. Canje y renovación administrativa comparten el bloqueo de la misma fila de perfil.
- El trigger de protección ahora es SECURITY INVOKER. Solo reconoce escrituras de suscripción ejecutadas por el rol interno acotado pesito_subscription_writer y conserva la autorización administrativa para pausar/reactivar. No confía en current_user=postgres dentro de una función SECURITY DEFINER ni en un GUC que pueda establecer un cliente.
- Rol interno NOLOGIN/NOINHERIT, sin SUPERUSER, BYPASSRLS ni CREATEROLE. No se concede a anon/authenticated/service_role. Tiene SELECT y UPDATE de columnas concretas de perfiles/códigos, y SELECT/INSERT sobre recibos con RLS. CREATE en public se concede solo para cambiar el propietario de ambas RPC y se retira al finalizar. El operador postgres conserva administración del rol. No se habilitan accesos externos ni credenciales nuevas.
- Cambiar vencimientos directamente se rechaza también para administradores: una pantalla antigua no puede sobrescribir los días del servidor. Nombre/apellido del cliente y las acciones administrativas de pausa/reactivación se mantienen. No se modifica ningún perfil o código existente al instalar.

## Semántica de planes

- Vigente: conserva días y acumula. Vencido o pending_code: activa desde el reloj del servidor.
- Suspendido: no canjea ni consume códigos. Una renovación administrativa conserva su pausa; la reactivación sigue siendo una acción administrativa separada.
- Activo o suspendido con fecha NULL: una extensión temporal conserva el acceso sin vencimiento y añade cero días. Un pending_code/expired con NULL no se interpreta como vitalicio.
- lifetime es una acción explícita, deja NULL y conserva una pausa existente. El resultado mostrado viene del servidor, sin convertir planes permanentes en temporales por accidente.

## Cliente administrador

- Guardia inmediata de envío, validación de días enteros y resultado real. La fecha previa del modal es una estimación.
- El intento se persiste en sessionStorage por administrador antes de transmitir y se conserva ante respuesta incierta. Recarga y reapertura recuperan el cliente y los parámetros originales; se bloquea cambiar otra renovación hasta comprobarla. La comprobación puede completar el envío si el original no llegó; no es una consulta de solo lectura.
- Plazo de 15 segundos, error visible, recuperación con el mismo UUID y limpieza solo tras una respuesta válida. Si se desmonta durante el envío, conserva el intento. No muestra un vencimiento proyectado adicional al comprobar un intento pendiente.

## Pruebas

- 561 Vitest aprobados: 531 anteriores más 22 SQL y ocho del cliente. SQL carga migraciones 001–017 relevantes y 031 con RLS/rol authenticated, reproduciendo primero el falso éxito de 013+016. Verifica canje vigente/vencido/pendiente/vitalicio/suspendido, registro con código, autorización y escrituras directas, acumulación, idempotencia y datos devueltos.
- Fallos inyectados al insertar recibo, consumir código y un trigger que ignora el cambio revierten la operación o impiden el éxito; no se consume el código si el perfil no cambió.
- Cliente: doble clic, respuesta perdida/recarga, UUID distinto para una nueva intención, parámetros congelados, separación entre administradores, almacenamiento bloqueado/corrupto y desmontaje.
- Lint, tipos/build y seis controles de release aprobados. El aviso previo del bundle mayor que 500 kB permanece. Los 12 escenarios de test:sql también pasan, pero cargan solo 005/013: la regresión con 016/031 está cubierta por el nuevo archivo SQL de Vitest.
- Ensayo PostgreSQL nativo agregado al job existente: dos administradores (+30/+60) y un canje (+15) simultáneos sobre cliente con 20 días producen 125; dos solicitudes con el mismo UUID agregan otros siete una sola vez. Debe aprobar en CI antes de integrar. Docker local no está iniciado.

## Navegador ficticio

AdminPanel real con API local y PGlite descartable en http://127.0.0.1:4194, sin claves ni cuentas de clientes. Se abrió un modal con 20 días restantes; otra renovación agregó 15 mientras permanecía abierto. Se solicitó +30 con doble clic y se simuló pérdida de la respuesta después de guardar. Al recargar, se recuperó el intento pendiente original y se comprobó: 65 días restantes, dos recibos totales (15 y 30), sin sumar otros 30. El mensaje mostró el vencimiento real del servidor. La captura y JSON de evidencia quedan en la carpeta temporal de esta PC (pesito-fe06-be02-*); no se suben al repositorio.

## Procedimiento de publicación y aceptación

1. Aprobar los cuatro controles sobre el SHA de la PR y revisar el rol/ACL, trigger y contrato de rollback. Obtener autorización específica para aplicar 031/032 e integrar/publicar.
2. Comparar historial y fuente real de redeem_invitation_code/protect_profile_system_fields con las migraciones aprobadas; parar ante deriva. Aplicar 031 y 032 antes de publicar la PWA, con registro transaccional de historial y guardas. Comprobar propietario de RPC, atributos/membresías del rol, RLS y permisos. No usar claves privilegiadas suspendidas.
3. Revisar de solo lectura si hay evidencia de códigos consumidos sin renovación. Un conteo o fecha sospechosa no demuestra pérdida de días; no reasignar ni devolver códigos ni cambiar vencimientos sin reconciliación específica con el propietario.
4. Publicar frontend y comprobar versión/SW. Aceptación con un cliente ficticio autorizado y pruebas SQL con rollback; no extender ni suspender clientes reales para probar. Registrar alcance y limpieza antes de cerrar FE-06/BE-02.
5. Rollback: mantener 031/032, recibos, helper privado y rol interno. La PWA anterior puede seguir canjeando, pero la extensión administrativa antigua por fecha absoluta queda bloqueada de forma segura; no relajar el trigger para restaurarla. El rollback técnico no garantiza todas las acciones de administración de una UI antigua.

## Límites

- No recupera automáticamente códigos consumidos históricamente ni corrige vencimientos preexistentes. Ese seguimiento requiere evidencia productiva; permanece abierto.
- Cerrar/borrar la sesión de la pestaña puede perder la identidad local. Una intención nueva con otro UUID puede sumar días legítimamente; comprobar la cuenta antes de repetir tras perder el almacenamiento. Sin retención automática de recibos.
- Un rechazo definitivo (cliente eliminado, identidad cambiada o datos corruptos) requiere revisar el intento antes de limpiar almacenamiento; no hay botón para descartar silenciosamente una renovación de resultado incierto.
- Estados de carga generales del panel, fechas de generación de códigos, otras escrituras administrativas y estadísticas quedan fuera de este bloque. No cambia webhook, proveedor IA, costos, retención ni backups.

## Compatibilidad detectada durante publicación — 25/10/2026

031 se aplicó con autorización. El smoke autenticado con usuario ficticio y rollback detectó que el operador postgres no puede delegar USAGE del esquema auth administrado al rol interno, aunque la instrucción GRANT no falle. Las RPC del rol interno devolvieron 42501 al evaluar auth.uid(); no se publicó todavía la PWA ni se confirmaron los datos de prueba.

La corrección hacia adelante 032 agrega subscription_actor_id, SECURITY DEFINER propiedad de postgres, que devuelve únicamente auth.uid(). Solo el rol interno puede ejecutarla; no se amplían permisos del esquema auth ni se elimina el trigger. Ambas RPC conservan firma, propietario y reglas; usan esta identidad acotada. La regresión revoca USAGE auth al rol interno para reproducir la condición real; pasa en PGlite y se incorpora a la carrera nativa de CI. Se conserva 031 sin editar una migración aplicada. El mínimo del frontend pasa a 032. Antes de continuar se repite el smoke autenticado completo.

## Publicación y verificación técnica — 25/10/2026

- El propietario autorizó aplicar la migración e integrar/publicar PR #34. El candidato inicial 7f55090 aprobó cuatro controles. Durante el smoke, 031 quedó aplicada pero la lectura de auth.uid bajo el rol interno devolvió 42501. El intento completo se revirtió: cero usuarios/perfiles/códigos/recibos ficticios persistidos. No se publicó una PWA que dependiera de ese canje fallido.
- Se corrigió hacia adelante con 032, conservando el archivo y registro de 031. Su helper privado expone exclusivamente la identidad de la sesión al rol interno; auth permanece sin USAGE para ese rol. Código, propietarios, atributos/membresías, ACL/RLS e historial verificados. No se cambiaron permisos generales del esquema auth ni se consultaron claves privilegiadas.
- La regresión nueva revoca USAGE auth al rol interno antes de aplicar 032. El candidato b29b02962a37fdb403e1c0a6e4f13973c8b2ef62 pasó Frontend, Webhook, PostgreSQL (carreras sin acceso directo a auth) y Ensayo de release. [PR #34](https://github.com/ThomasMariani11/chatbot-gastos/pull/34) integrada en edb051b3a0883cf627ef6cc7f81a88042bbe5e86. [CI main y Publicar](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/40162933189) aprobados.
- Smoke en Supabase con usuario/códigos ficticios dentro de BEGIN/ROLLBACK y rol authenticated: registro pendiente, canje de 30 días persistido y coherente con la respuesta, escritura directa de vencimiento denegada, administrador agrega 15 y el reintento no repite; pausa preservada, canje suspendido rechazado sin consumir código, cambio explícito a vitalicio conserva pausa. Cero usuarios, perfiles, códigos y recibos de ese ensayo al terminar. No se renovaron ni pausaron clientes reales.
- HTTP sin sesión a renovación, canje, identidad privada y recibos rechazado con 401/42501. Se usó solamente la clave pública del sitio para esta comprobación negativa.
- version.json, SW y bundle publicados comprobados contra edb051b; el bundle contiene RPC y persistencia del intento. Administrador abierto con la sesión existente, sin pendientes; modal actualizado accesible y cerrado sin enviar. La renovación UI completa con pérdida de respuesta/recarga se probó en el entorno ficticio descrito arriba. No se presenta como una extensión de producción desde la PWA.
- Revisión histórica de solo lectura: cuatro códigos usados; uno sin used_by; cero sin used_at, cero referencias a un usuario con perfil ausente, cero usados para perfiles pending_code y cero indicadores de vencimiento temporal inferior al mínimo del código (tolerancia un minuto). La comparación no reconstruye vencimientos anteriores ni demuestra que nunca haya existido un canje fallido. El código sin usuario puede corresponder a una eliminación u otra modificación; no hay evidencia suficiente para atribuirlo a una causa ni reasignarlo. Seguimiento separado abierto; no se modificaron códigos ni vencimientos históricos.
- Evidencia saneada en carpeta temporal: pesito-renewal-031-preflight.json, pesito-renewal-031-historical-review.json, pesito-renewal-031-auth-diagnosis.json, pesito-renewal-032-verification.json, pesito-renewal-032-production-smoke.json, pesito-renewal-032-http-security.json, pesito-fe06-published.json y pesito-fe06-production-ui-readonly.json. No se versionan claves, nombres ni contenidos de clientes.

La corrección de FE-06/BE-02 queda terminada dentro del alcance técnico y los límites documentados. El seguimiento histórico sin identidad y la aceptación física en otros dispositivos no se declaran resueltos. No se redesplegó el webhook, no se enviaron mensajes y no se activaron retención, backups ni facturación.

## Cierre del registro de prueba — 29/10/2026

Thomas confirmó expresamente que el registro era de prueba y luego aprobó el SQL exacto antes de ejecutarlo. La revisión de solo lectura encontró un único código consumido sin usuario (`used_by = NULL`), UUID `b772fcd7-e275-4893-978e-4592249bfb6e`, enmascarado `PE…26`. Fue creado y consumido el 06/10/2026; sus notas contenían una marca de prueba. No se exportó el código completo ni contenido de clientes.

Se comprobaron cero referencias por UUID/código en 25 tablas públicas, otros códigos y metadatos de usuarios/identidades de Auth; cero FKs entrantes y cero triggers de usuario sobre invitation_codes. La autoría `created_by` era una referencia saliente hacia un administrador, sin dependencia financiera del creador. El panel bloquea borrar códigos consumidos, por lo que no aplicaba su flujo de Invitaciones.

Se ejecutó un único DELETE por ese UUID, dentro de REPEATABLE READ, con revalidación del estado y referencias, bloqueo de la fila, exigencia de exactamente una fila y comparación de huellas antes/después. Cualquier incumplimiento abortaba antes de COMMIT. Se protegieron perfiles completos (incluidos estado y vencimiento), movimientos, recibos y los demás códigos.

Un SELECT independiente posterior confirmó que el registro ya no existe, quedan cero consumidos sin usuario y las huellas de perfiles, vencimientos, movimientos y admin_subscription_requests coinciden con las de la lectura previa. Verificado el 29/10/2026 a las 17:23:55 de Argentina. [Evidencia saneada](evidencias/INVITACION_PRUEBA_ELIMINADA_2026-10-29.json).

**Seguimiento puntual cerrado.** No se reasignó la invitación, no se corrigieron vencimientos, no se tocó ningún movimiento confirmado ni se borró otro registro. Es una operación de datos productiva, no una migración: no se agregó nada a supabase/migrations ni se desplegó PWA/webhook. Los antecedentes anteriores permanecen como registro de lo observado en sus fechas.
