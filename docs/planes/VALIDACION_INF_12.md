# INF-12 — Tamaño de multimedia y presupuestos de trabajo

Fecha: 18/10/2026. Estado: implementada y probada localmente; pendientes CI, publicación y aceptación real de multimedia.

## Cambios

La revisión histórica decía que faltaban timeouts. El código actual ya tenía límites individuales de 15 s para cada petición de descarga, 10 s por envío y por modelo con medios. Faltaban un presupuesto compartido, un límite de bytes antes de base64 y validación de MIME. La descarga usaba arrayBuffer sin tope propio y el envío clonaba/leía cuerpos JSON sin límite.

Se incorporan lectura por streaming con corte/cancelación, 5 MiB por imagen y 10 MiB por audio, MIME normalizado y coincidencia con la familia del mensaje. Metadatos y respuestas JSON también tienen máximos. Se conserva el seguimiento normal de redirecciones de Meta; la URL inicial de descarga debe ser HTTPS y no contener credenciales. La conversión base64 usa bloques y la solicitud completa a Gemini se limita a 19.000.000 bytes.

La descarga comparte 10 s, la interpretación 30 s y cada intento de trabajo 60 s. El envío y su variante argentina comparten 10 s. El SDK/RPC usa 5 s por petición. Las señales se propagan y una operación agotada no inicia escrituras tardías. Los fallos se registran con motivos y proveedores permitidos, sin contenido. Un rechazo de tamaño/formato conserva el pedido de texto y no produce altas parciales. Se mantienen la confirmación atómica, la idempotencia de entrega y la privacidad existentes. El lector usa un buffer de crecimiento acotado, sin retener un objeto por fragmento. La invocación ejecuta como máximo dos actores en paralelo y comparte una ventana de 45 s para iniciar trabajo; al terminarla no comienza otro mensaje, pero conserva el trabajo activo y los no iniciados para su recuperación.

## Verificación local

- 221 Vitest en 15 archivos, incluidos límites de streams, timeout del trabajador y checkpoint tardío rechazado; recuperación deja un solo borrador y cero transacciones sin confirmar.
- 31 Deno con red denegada y claves ficticias: descarga válida, límite por metadata, tamaño real superior al declarado, tipo incorrecto, cuerpo lento cancelado, presupuesto agotado, envío argentino compartido y RPC real con abort propagado.
- 12 escenarios SQL de renovaciones y seis controles Node de release aprobados.
- Tipos, lint Deno/ESLint y build aprobados. Se mantiene la advertencia previa de bundle superior a 500 kB.

## Publicación y aceptación

Exigir los cuatro checks del PR, incluido PostgreSQL nativo y ensayo Supabase con las 25 migraciones. Este cambio no contiene SQL nuevo. El rollback de código se fija en acde1f8, compatible con 025 y el flujo de fallback ya validado. Publicar solo whatsapp-webhook con CLI 2.120.0 y los secretos existentes. Verificar ACTIVE, HMAC y secreto del worker con rechazos 401, sin enviar mensajes sintéticos ni operaciones de prueba a producción.

Una prueba real posterior debe recibir un audio corto y una foto pequeña. Revisar que haya propuesta o pedido de texto sin espera prolongada, sin procesar el archivo parcialmente y sin confirmar datos automáticamente. Los excesos y proveedores lentos se ensayan de forma aislada; no hace falta sobrecargar producción.

[Política y procedimiento](../operaciones/LIMITES_MULTIMEDIA.md). [Evidencia](evidencias/INF_12_2026-10-18.json). INF-12 continúa en curso hasta registrar despliegue y aceptación. Después sigue INF-14; backups al final.
