# INF-14 — Retención preparada y pruebas de conservación

Fecha: 27/10/2026 (Argentina). Base: PR #46/ebdd6ee, 035 y webhook v59. **Preparación validada; retención desactivada y ninguna limpieza ni activación productiva realizada.** Panel/avisos de INF-14 ya estaban publicados y aceptados; este bloque revisa exclusivamente la propuesta pendiente 30/90 y actualiza el cierre de INF-15.

## Qué se comprobó

La función instalada prune_whatsapp_ops_content coincide con 027 al normalizar CRLF/LF. Es SECURITY DEFINER con search_path fijo; anon, authenticated y service_role no pueden ejecutarla. Solo el dueño SQL/cron autorizado puede mantener contenido. El cron horario está programado y activo, pero retention_enabled=false y last_retention_at=null: programado no significa que se esté borrando.

Lectura productiva 27/10/2026 10:20 Argentina: **0 mensajes, 0 métricas y 0 avisos elegibles**. Se conservan 38 mensajes heredados v1 y dos recibos del nuevo cupo IA. No se consultó contenido ni identidades de clientes; solo conteos y la definición de la función. No se llamó a prune en producción, ni siquiera con la bandera desactivada.

## Política concreta a decidir

| Datos | Tratamiento propuesto | Protecciones |
| --- | --- | --- |
| Contenido de mensajes v2 terminados | Después de 30 días desde processed_at, quitar cuerpo/media de payload, interpretación, respuesta y error crudo | Mantener fila, identificadores, tipo/origen, estado, intentos y diagnóstico seguro. Hasta 500 mensajes por ejecución; SKIP LOCKED. |
| Movimientos y borradores | Conservar íntegros | No se actualizan ni eliminan. Proteger también el mensaje asociado a grupo abierto, ítem pendiente o transacción pendiente (incluidas cuotas con sufijo). |
| Trabajos no terminados/revisión/v1 | Conservar íntegros | Ninguna limpieza por antigüedad de esos estados. |
| Métricas y avisos terminados | Más de 90 días; solo avisos sent/cancelled con finished_at conocido | Conservar recientes, pendientes, enviándose, fallidos, inciertos y bloqueados. Los DELETE no tienen límite de 500 filas: estimar antes. |
| Recibos/contadores IA | Conservar | Redactar contenido no borra el trabajo ni activa cascadas sobre recibos. No devolver ni reiniciar reservas por una limpieza. |

Esta es una política de minimización de contenido, no un borrado integral de identidades ni una copia recuperable. Desactivarla después impide ejecuciones futuras; no reconstruye contenido ya retirado. Se requiere aprobación expresa de 30/90 antes de activar. Backups siguen al final por decisión del propietario.

## Preparación y ensayos

- Consulta ops/sql/whatsapp-retention-preview.sql: SELECT de conteos que reproduce elegibilidad; se contrasta con la limpieza real en aislado. No llama a mantenimiento ni cambia configuración.
- Propuesta ops/sql/whatsapp-retention-enable.sql: guardas de consentimiento técnico, política desactivada de 30 días, fuente normalizada y cron vigente. No ejecutada en cloud; no conectada al deploy. La marca técnica no equivale a aprobación del propietario.
- **19 casos nuevos** ejecutan funciones SQL reales en PGlite, sin clientes/medios reales: desactivación sin efecto en ningún conjunto, límites 30/90 y fecha de procesamiento, lote 500/repetición, estados pendientes/proceso/fallo/revisión, grupos/ítems protegidos, vínculos exactos y cuotas, aislamiento de cuentas/prefijos, redacción de audio/foto y deduplicación, recibos IA intactos, fallos atómicos y permisos/mínimo de 30 días. Se prueba también el SQL de activación y del ensayo de stack.
- PostgreSQL nativo: dos conexiones, mensaje antiguo bloqueado por una sesión omitido por SKIP LOCKED, limpieza posterior y llamadas concurrentes idempotentes; snapshots financieros, borradores y cupos idénticos; reenvío no recrea el mensaje. La prueba solo admite 127.0.0.1/inf03_queue_test.
- Ensayo Supabase completo: caso de redacción sobre usuario/finanzas ficticias después de instalar 001–035. Transacción con ROLLBACK, conservación financiera y bandera false al terminar. Cron local desprogramado, sin proveedores/Meta.

Resultados: **819 pruebas Vitest, cola 145/145**, ESLint, TypeScript/build, 12 renovaciones SQL y seis guardas aprobados. Los cuatro checks del candidato 5a007c49ace2941a72926bae5dd1187134cb2511 aprobaron en [CI](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/40512862005), incluidos PostgreSQL concurrente y stack Supabase completo/rollback. El ensayo verificó la limpieza dentro de una transacción ficticia y bandera false al terminar. La documentación posterior debe conservar sus propios checks antes de integrar.

Sin cambios de runtime, migraciones, dependencias, credenciales ni recursos; bundle/advertencia previos conservados. Docker local no estaba iniciado: los ensayos nativos/completos se ejecutaron en CI Linux, sin presentar ese resultado como ejecución local.

## Salida del bloque

1. Revisar y subir la preparación; los cuatro checks deben aprobar antes de integrar documentación/pruebas.
2. Mostrar los conteos, las protecciones y la pérdida de contenido original; obtener la decisión de activación. Publicar documentación no activa retención.
3. Si se aprueba, verificar nuevamente fuente/política/estimación y habilitar solo el flag con el script revisado. Leer el resultado y la siguiente ejecución normal; no forzar una limpieza de datos reales para demostrarla.
4. Si se posterga, mantener false y registrar INF-14 como parcial por retención sin activar. No cerrar por extensión BE-16 ni otras tareas de observabilidad.

[Evidencia saneada](evidencias/INF_14_RETENCION_2026-10-27.json) · [Runbook y propuesta](../operaciones/MONITOREO_Y_RETENCION.md). INF-15 queda publicado y aceptado según [su validación](VALIDACION_INF_15.md); las cabeceras HTTP de INF-13 y backups siguen separados.
