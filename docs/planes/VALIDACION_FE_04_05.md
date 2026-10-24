# Validación FE-04 / FE-05 — envíos PWA y carga mensual

Fecha: 24/10/2026. Base: main b79985c. Rama: codex/idempotent-entries-month-loading.
Estado: migración 030 y PWA publicadas con autorización del propietario. Aceptación final del recorrido de alta/recarga en la PWA publicada pendiente.

## Qué cambia

- Un identificador por intención de alta, persistido antes de transmitir. Doble clic/Enter no transmite dos solicitudes; reintentar, recargar la misma pestaña o volver a abrir el panel conserva el identificador y el formulario incierto.
- `submit_pwa_entry` crea movimiento y recibo en una transacción; los planes delegan en 029 dentro de esa transacción. El bloqueo por usuario/intento serializa peticiones concurrentes. Dos operaciones iguales solicitadas por separado siguen permitidas.
- Comprobar un envío reutiliza su identidad. Cancelar consulta primero al servidor: si ya se guardó informa ese resultado; si todavía no llegó, deja una cancelación que impide el guardado tardío. No elimina movimientos confirmados. Un reintento de un movimiento eliminado no lo recrea.
- Se comprueban usuario, suscripción, categoría propia/activa, moneda, fecha, importe y campos permitidos. Los recibos tienen RLS y no se exponen a clientes; la RPC solo permite usuarios autenticados.
- Carga financiera identificada por usuario/mes, con estados de carga y error/reintento. Movimientos, cuotas y presupuesto se presentan juntos tras validar las respuestas; un fallo parcial oculta los totales. No representa una transacción única de lectura en la base.
- Cancelación y descarte de respuestas de efectos anteriores; una sola carga por contexto durante todo el fallback y una actualización adicional si llegó una invalidación. Plazo de 15 segundos; también libera la carga si el transporte ignora abortar.
- Fallos auxiliares (vínculo, configuración del bot o selector de meses) no inventan datos financieros. La configuración desconocida se informa; el fallback de meses avisa si está incompleto.

## Pruebas locales

- Vitest: 531 pruebas aprobadas (490 anteriores y 41 nuevas): cliente persistente, SQL real en PGlite y carga mensual con fallos controlados.
- Linter, TypeScript y build aprobados. Continúa la advertencia previa del bundle mayor que 500 kB; no se optimizó en este bloque.
- 12 integraciones SQL de renovaciones y seis controles de release aprobados.
- Concurrencia PostgreSQL nativa aprobada en CI sobre a5dbd46: dos sesiones para el mismo intento, cancelación simultánea y reintento después de eliminar. El motor Docker local no está iniciado; las bases descartables de CI ejecutan esas pruebas y el ensayo completo. Antes de integrar, comprobar los cuatro controles aprobados sobre el último commit de la PR.

## Navegador ficticio

Se ejecutó el Dashboard real en http://127.0.0.1:4193, con una API local y PGlite descartable, sin cuentas, claves ni datos de clientes.

1. Gasto ARS 123,45: la base guardó y se perdió la respuesta. Tras recargar y comprobar, exactamente una copia confirmada; formulario recuperado.
2. Plan USD 100, tres cuotas, referencia 2/3: misma pérdida y recarga; recuperó moneda/cantidad/referencia/fecha. Cancelar un envío ya guardado conservó las tres cuotas (33,33 / 33,33 / 33,34), sin duplicarlas.
3. Fallo solo del presupuesto al cambiar de octubre a noviembre: error visible, sin totales ni movimientos anteriores bajo el nuevo mes. Restaurar y reintentar mostró exclusivamente noviembre; su ingreso USD 42 siguió separado de ARS.
4. Evidencia local del ensayo: `pesito-fe04-fe05-browser-validation.json` y captura `pesito-fe05-error-mensual.jpg`, en la carpeta temporal de esta PC. No se suben datos financieros al repositorio.

## Publicación verificada — 24/10/2026

- El propietario autorizó aplicar 030 e integrar/publicar la PR #32. Candidato aprobado: a8fdfeebbd3c031716fe8deb10293ad588c917e8; cuatro controles aprobados sobre ese SHA.
- Historial previo 029 y código de la RPC de planes comparados con el repositorio normalizando espacios/saltos de línea. 030 se aplicó en una transacción con su registro en schema_migrations y guardas de historial, fuente, ACL y RLS. Cola habilitada y retención desactivada conservadas.
- Fuente 030 y cuerpo de submit_pwa_entry coinciden con el candidato. Recibos privados para authenticated; anon sin ejecución. Peticiones HTTP sin sesión a la RPC y tabla rechazadas con 401/42501, usando únicamente la clave pública del sitio.
- Smoke SQL con rol authenticated y usuario administrador único: gasto ARS 123,45, reintento con misma identidad, cancelación posterior al guardado, cancelación anterior al envío tardío y plan USD 100 en tres cuotas (33,33 / 33,33 / 33,34), también reintentado. ROLLBACK al terminar: cero recibos de los tres intentos y ningún movimiento ficticio confirmado por ese ensayo.
- [PR #32](https://github.com/ThomasMariani11/chatbot-gastos/pull/32) integrada en d0cf7e5f7adab8fbb1c9321e3768988eb45416fa. [CI y Publicar](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/40141743294) aprobados. version.json y service worker coinciden con ese SHA; bundle contiene la nueva RPC y el manejo de errores mensuales.
- PWA abierta con la sesión existente: panel y datos disponibles, bot activo y formulario nuevo accesible. Se cerró vacío, sin guardar. No se inyectaron fallos en producción ni se modificaron movimientos preexistentes. El ensayo de respuesta perdida/recarga sigue siendo el ficticio descrito arriba; no se presenta como ejecutado en la PWA de producción.
- Evidencias locales: pesito-entry-030-production-verification.json, pesito-entry-030-http-security.json, pesito-entry-030-published.json y pesito-entry-030-ui-smoke.json, en la carpeta temporal. Sin credenciales ni contenidos de clientes en el registro versionado. No se redesplegó el webhook ni se enviaron avisos de WhatsApp.

## Orden de publicación y aceptación

1. Revisar la PR y aprobar todos los controles sobre su mismo commit. Pedir autorización para aplicar 030 e integrar/publicar la PWA.
2. Aplicar `030_idempotent_pwa_entries.sql` antes del frontend, incluyendo registro de migración conforme al runbook. Verificar fuente/ACL; no acceder a claves privilegiadas.
3. Publicar la PR y comprobar el SHA de la PWA. El manifiesto exige migración mínima 030. El rollback fijado conserva su mínimo 027: 030 agrega una RPC/tabla y no retira las rutas anteriores.
4. Con autorización del propietario, usar exclusivamente movimientos ficticios identificables: alta y recarga/reintento del mismo intento, fallo de lectura en entorno de prueba y recuperación por mes. Revisar una copia por intento y limpiar solo los datos ficticios confirmados. No simular fallos sobre producción ni tocar compras preexistentes.
5. Cerrar FE-04/FE-05 solo después de aceptación y registrar alcance/límites.

## Límites y pendientes separados

- El formulario incierto usa sessionStorage por usuario y pestaña. Sobrevive a recarga y navegación interna; cerrar la pestaña, borrar datos o políticas del navegador pueden perderlo. No se promete deduplicación entre nuevas intenciones de pestañas independientes ni después de borrar su identidad. Ante pérdida de almacenamiento, revisar movimientos antes de repetir el alta.
- La persistencia local incluye el formulario financiero incierto y se elimina al comprobar un resultado válido. No se registran contenidos ni respuestas del proveedor en logs.
- Versiones anteriores de la PWA pueden seguir usando las escrituras anteriores hasta actualizarse; la garantía aplica a las altas de esta versión. No se revocan esas rutas para evitar romper clientes existentes.
- Los recibos SQL conservan identidad, hash y entidad aunque se elimine el movimiento. No se habilita limpieza automática ni retención; no se cambia la decisión sobre backups.
- Solo cubre altas PWA; no incorpora persistencia de reintentos de edición/eliminación de planes. No cambia el cálculo FE-09 ni renueva suscripciones (FE-06/BE-02), siguiente bloque recomendado.
- Las lecturas mantienen los límites de paginación actuales del servidor; no se afirma resolver listados masivos.
- Las comprobaciones físicas en iPhone/Android y de compatibilidad general siguen pendientes.
