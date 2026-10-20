# INF-12 — Tamaño de multimedia y presupuestos de trabajo

Fecha: 18/10/2026. Estado: publicada en webhook v44 y verificada; pendiente aceptación real de multimedia.

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

## Publicación observada

El [PR 11](https://github.com/ThomasMariani11/chatbot-gastos/pull/11), head d72552b, aprobó Frontend, Webhook, PostgreSQL y Ensayo de release en [39156531097](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/39156531097). Se integró por squash como 3b3ea8c; el runtime integrado coincide con el candidato probado. El ensayo instaló las 25 migraciones y ejecutó candidato y rollback a acde1f8, con limpieza verificada, cero mensajes externos y sin restaurar datos.

CLI 2.120.0 publicó solo los nueve módulos del webhook: versión 44 ACTIVE, verify_jwt=false con HMAC/secreto propios. Peticiones sin firma y worker sin secreto devuelven 401. La comprobación posterior conserva 025, cola habilitada y cero trabajos procesándose en ese instante. No se aplicaron migraciones, no se reabrieron históricos ni se crearon operaciones de prueba.

Falta la prueba real de audio corto y foto pequeña enviados por el usuario. Los rechazos de tamaño/tipo, respuestas lentas y recuperación ya se probaron de forma aislada; no se requiere probar excesos sobre clientes reales. INF-12 sigue en curso únicamente por esta aceptación.

La ejecución de main [39156737331](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/39156737331) aprobó sus cinco jobs, incluida Publicar. Sitio, version.json y sw.js responden 200 y corresponden a 3b3ea8cc78e145446f53ad7ca45f8c2c748d674d.

## Prueba real del 20/10/2026 — recuperación verificada, interpretación pendiente

El usuario envió un audio y una imagen y recibió el pedido de texto en ambos casos. Consulta de solo lectura a las 13:55:32 UTC: un actor, dos trabajos procesados, un intento por mensaje, respuesta enviada, cero ítems de borrador y cero transacciones atribuibles a esos mensajes (incluidas las claves con sufijo de posición). Audio: 24,22 s hasta respuesta. Imagen: 9,39 s.

Los registros agregados de los últimos 60 minutos muestran errores 503 y timeouts de Gemini en Flash Lite y Flash, y dos eventos de fallback de interpretación. No se observaron rechazos de tamaño/formato o errores de Meta en esa consulta. Los registros agrupados no permiten asignar cada error concreto a cada mensaje. La evidencia respalda el manejo del fallo y no una interpretación exitosa. El audio todavía demora hasta agotar los intentos; no se considera una respuesta inmediata.

INF-12 permanece en curso hasta verificar interpretación correcta de multimedia válida. Revisar disponibilidad/configuración efectiva de Gemini antes de nuevos cambios o de pedir otra prueba. No se reenviaron mensajes, no se reabrieron trabajos ni se modificó producción durante esta comprobación.
