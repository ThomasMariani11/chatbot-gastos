# INF-09 — Privacidad de logs

Fecha: 16/10/2026. Estado: validado localmente; faltan CI y publicación.

## Hallazgos y alcance

Las líneas históricas de console que imprimían mensajes, teléfonos y respuestas de proveedores ya no existen en el webhook actual tras INF-03. No se atribuye una filtración nueva a esas líneas antiguas. La función bootstrap_user vigente sí conserva RAISE WARNING con new.id y SQLERRM; una regresión aislada reproduce que puede imprimir UUID, correo y contenido del error. No se provocó ese fallo con cuentas reales.

La migración 024 reemplaza exclusivamente esa instrucción por JSON con event bootstrap_user_failed y SQLSTATE. Obtiene la definición existente, exige el texto esperado y falla si cambió; es idempotente y conserva cuerpo restante, propietario, SECURITY DEFINER, search_path y ACL. No reescribe migraciones aplicadas ni modifica filas. El comportamiento de alta incompleta ante error permanece abierto en BE-13, sin mezclar su corrección con privacidad.

## Contrato del webhook

logging.ts solo emite eventos conocidos con campos permitidos por evento. Acepta duración, cantidades, intentos, estado HTTP y enums de ruta/fase; rechaza strings en métricas, valores fuera de rango y propiedades ajenas. No serializa errores, IDs, teléfonos, cuerpos, prompts, comprobantes, URLs, headers ni tokens. No ejecuta getters/toJSON de la entrada. Un fallo del destino de logs no puede alterar el flujo financiero.

Los errores imprevistos del handler se convierten en 503 genérico con metadata segura; no llegan al logger automático como excepción sin capturar. Los reintentos conservan una fase operativa acotada. No cambia la lógica de interpretación, confirmación, envío o cuotas.

CI activa la regla Deno no-console. Solo se exceptúan la salida validada de logging.ts y la fixture queue_test.ts que intercepta console para verificar privacidad. Una comprobación negativa local confirmó que una llamada console.log nueva es rechazada. Los tests Deno usan datos ficticios y red denegada.

## Pruebas locales

- 185 tests Vitest en 12 archivos, incluidos diez casos nuevos de contrato/advertencia SQL y dos casos de entrega real con logger.
- Se reproduce el aviso antiguo y se comprueba que 024 elimina canarios del mensaje y del resto del aviso, mantiene SQLSTATE, privilegios y alta legítima con invitación, nombres y 16 categorías.
- El fallo del logger no reabre un guardado ni repite la respuesta; un error crudo del proveedor produce reintento con fase send sin imprimir su contenido.
- 13 tests Deno: el endpoint real responde 200, 401 y 503 sin registrar canarios de cuerpo, token, URL, excepción, teléfono o comprobante. Check/lint Deno, ESLint, tipos, 12 escenarios SQL y build aprobados.
- La fixture PostgreSQL nativa de CI incorpora 024 antes del alta y conserva las pruebas concurrentes anteriores. Su resultado remoto está pendiente.

## Acceso y retención revisados

La API devuelve un único miembro Owner. Entitlements: log.retention_days = 1 día; log_drains y audit_log_drains deshabilitados. Listar drains devuelve 403, coherente con esa función no habilitada; no se interpreta como una lista vacía por sí solo. No se agregan planes, exportaciones ni cargos.

La revisión agregada de la última hora cubrió 144 eventos PostgreSQL y no encontró los patrones buscados de credenciales ni avisos bootstrap antiguos. No hubo registros function_logs en ese intervalo; no constituye una prueba de ausencia de toda actividad o exposición. No se imprimieron ni guardaron mensajes crudos.

Se revisaron diez logs de jobs de tres ejecuciones CI recientes (15 y 16/10). No aparecieron los prefijos de credenciales ni marcadores de logging crudo buscados. La revisión no es exhaustiva sobre las 117 ejecuciones main; no se afirma ausencia de secretos por un escaneo de patrones. No se guardaron los logs. El repositorio es público, por lo que CI no debe recibir datos de clientes. El plazo exacto de retención de GitHub no se verificó ni modificó.

Los ajustes PostgreSQL leídos incluyen log_statement=ddl, log_min_error_statement=error, log_parameter_max_length_on_error=0, pgaudit.log=none y Auth con log_statement=none. No se cambian globalmente: los logs administrados por la plataforma pueden contener metadata de red y detalles de errores que este logger no controla. El cierre se refiere al logging emitido por nuestro código y a la advertencia identificada, no a una garantía sobre todos los logs del proveedor.

## Operación y publicación

1. Exigir los tres checks del PR. Aplicar 024 con registro de historial en la misma transacción y verificar su definición sin imprimirla.
2. Desplegar solo whatsapp-webhook con los secretos existentes y JWT deshabilitado para Meta; conservar verificación HMAC y secreto del worker.
3. Enviar un POST sintético sin firma: debe responder 401, no encolar mensajes y producir únicamente metadata segura. Comprobar versión, salud y logs agregados de forma acotada.
4. Registrar resultados antes de cerrar. No borrar históricos, ejecutar altas fallidas reales ni reenviar pendientes para esta prueba.

No compartir acceso al Dashboard con clientes. Revisar miembros al cambiar operadores; al investigar, consultar primero eventos, códigos, tiempos y conteos. Exportar solo agregados saneados. No copiar logs crudos a Git, issues o chats. Si aparece una credencial real, restringir acceso y coordinar su rotación; cambiar el logger no revoca ni elimina lo ya registrado. La retención de payloads y borradores, alertas y monitoreo siguen en INF-14; no se elimina trabajo pendiente.

## Recuperación

Si el deploy falla, mantener la versión anterior y corregir en la rama; 024 es independiente de los imports de la función. No restaurar el warning con datos privados. Si el logger provoca una regresión, mantener el contrato cerrado y corregir su integración con los mismos tests; no agregar console de objetos completos como solución temporal.

## Evidencia y referencias

- [Evidencia saneada](evidencias/INF_09_2026-10-16.json).
- [Consulta de logs y límites](https://supabase.com/docs/guides/observability/advanced-log-filtering).
- [Configuración de logging](https://supabase.com/docs/guides/observability/configure-logging).
- [Logs y retención](https://supabase.com/docs/guides/observability/logs).
- [Regla no-console](https://docs.deno.com/lint/rules/no-console).
