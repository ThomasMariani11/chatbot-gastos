# Límites de audios, imágenes y llamadas externas

Los límites se definen en supabase/functions/whatsapp-webhook/limits.ts. No requieren servicios nuevos, secretos adicionales ni migraciones.

## Archivos

| Recurso | Límite propio de Pesito |
| --- | --- |
| Imagen JPEG/PNG | 5 MiB (5.242.880 bytes) |
| Audio admitido por la política MIME | 10 MiB (10.485.760 bytes) |
| JSON de metadatos de Meta | 16 KiB |
| JSON de respuesta de Gemini | 256 KiB |
| Cuerpo de error de envío de Meta | 16 KiB |
| Solicitud JSON completa a Gemini | 19.000.000 bytes UTF-8 |

La política MIME acepta JPEG/PNG y audio AAC, MP4, MPEG/MP3, AMR, OGG, WAV, FLAC, WebM, M4A y Opus. Se normalizan mayúsculas y parámetros como codecs. Se exige que la familia coincida con el tipo de mensaje; un tipo específico en el cuerpo debe coincidir con el MIME de metadatos. Un Content-Type ausente o application/octet-stream se valida usando los metadatos de Meta. No se afirma validar códecs, decodificar contenido o garantizar que todos los modelos acepten todos esos formatos: una incompatibilidad del proveedor continúa mediante el pedido de texto.

Se comprueba el tamaño declarado de los metadatos y Content-Length, pero el límite decisivo cuenta los bytes realmente leídos del stream. Un tamaño ausente o menor al real no evita el corte. Al rechazar o agotar el presupuesto se cancela la lectura; no se trunca el archivo ni se envía una parte a Gemini. La base64 se construye por bloques y solo después de completar una lectura dentro del límite.

La documentación de Gemini establece un límite inline de 20 MB para audio, incluyendo instrucciones y archivos. El máximo propio de 10 MiB deja margen para la expansión base64 y se verifica además el tamaño del JSON completo. Un archivo admitido por WhatsApp puede superar el límite propio de Pesito; en ese caso se pide un archivo menor o texto, sin subirlo a almacenamiento adicional.

## Presupuestos de tiempo

| Operación | Tiempo máximo configurado |
| --- | --- |
| Metadatos y descarga juntos, incluido el cuerpo | 10 s compartidos |
| Interpretación completa (descarga y modelos) | 30 s compartidos |
| Gemini por modelo | 10 s con medios; 3,5 s con texto |
| Envío y variante argentina de número | 10 s compartidos |
| Petición HTTP de Supabase/RPC | 5 s por petición |
| Intento de procesamiento de un mensaje | 60 s compartidos |

Los límites se combinan mediante AbortSignal; pasar al siguiente modelo, petición de descarga o número argentino no reinicia el presupuesto exterior. El cuerpo también está dentro del límite: recibir los headers no completa una descarga. Si se agota el intento, se impide iniciar un checkpoint, aplicación o envío tardío. Los RPC de fallo/liberación tienen su propio límite de red para limpiar y conservar la recuperación, con margen respecto del lease de 90 s. La espera y ejecución asíncronas se acotan; esto no es un mecanismo que interrumpa JavaScript síncrono o un COMMIT que PostgreSQL ya haya ejecutado.

Un timeout de red puede ocurrir después de un COMMIT. Se conservan los checkpoints, la aplicación una sola vez y las RPC idempotentes de 023: recuperar la entrega no repite el guardado. Meta puede aceptar un mensaje y perderse su acuse; esa incertidumbre puede repetir una respuesta, pero no debe duplicar transacciones.

Si falla la interpretación, se guarda request_text con el motivo permitido y se pide concepto e importe. Archivos demasiado grandes o formatos incompatibles tienen una respuesta específica. El payload y la referencia de media continúan en la cola; no se crea una copia permanente del archivo. Los fallos de base o envío mantienen la recuperación existente. Estos presupuestos no prometen una latencia total fija si hay espera en la cola o un proveedor no entrega una respuesta.

## Verificación y recuperación

Ejecutar npm test, npm run test:sql, npm run test:release:guards, lint/build y los tasks Deno check/lint/test de deno.ci.json. Las pruebas usan streams, red simulada y claves ficticias, con red denegada en Deno. Cubren exceso declarado/real, tamaño falso, cuerpo bloqueado, MIME incorrecto, abortos, base64 por bloques, timeout de RPC y recuperación sin escritura tardía.

Publicar con los cuatro gates de CI aprobados y el procedimiento de DEPLOY_Y_ROLLBACK.md. No cambiar claves ni abrir acceso SQL para probar. Una prueba real debe usar un audio breve y una foto pequeña; no necesita archivos gigantes ni confirmar gastos ficticios. Un resumen o pedido de texto comprueba el circuito de recepción; una extracción exitosa de Gemini depende también de su disponibilidad.

Para ajustar límites, cambiar la política, probar ambos extremos y comprobar el presupuesto total frente al lease. Una regresión de descarga puede resolverse redesplegando el commit compatible indicado en config/environments.json, sin restaurar bases ni reabrir mensajes cancelados.

[Gemini: audio inline](https://ai.google.dev/gemini-api/docs/audio). [Validación INF-12](../planes/VALIDACION_INF_12.md).
