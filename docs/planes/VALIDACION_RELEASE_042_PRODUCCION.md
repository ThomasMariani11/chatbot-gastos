# Publicación productiva de 042 / BE-22

Fecha: 30/10/2026, Argentina. Commit publicado: d2d05df8229066f20e4a33f9625b0cdf3a0d04e6 (main, PR #72). Autorización del propietario: aplicar la migración y desplegar.

## Resultado comprobado

- Historial completo **001–042**. Se aplicó solamente 042; su texto original quedó registrado en la misma transacción. SHA-256 del archivo y del texto registrado coinciden: 071f2cbf436ae02a6888bc414f499c069e8f87e410f751dbeeb36578154a9f5c.
- Webhook **v65 ACTIVE**, JWT de plataforma false con verificación HMAC/worker propia. Desplegado desde d2d05df con CLI 2.120.0 y empaquetado API. Los 26 archivos descargados del runtime publicado coinciden con el candidato, normalizando LF.
- PWA ya publicada: CI **#289**, cuatro controles y Publicar aprobados. HTTP 200 y version.json = d2d05df comprobados; no se necesitó otra publicación web.
- Ramas múltiples de edición y baja presentes en la RPC; ACL conservada, ejecución solo para postgres/service_role.
- Perfiles (incluidos vencimientos), movimientos, invitaciones y recibos de renovación conservaron sus huellas. No se insertaron operaciones ficticias ni se enviaron mensajes a clientes.

## Ventana y recuperación

Cola v2 sin trabajos activos ni leases antes de cambiar runtime. Pausa desde **10:43:54 hasta 10:44:43 Argentina**, unos 49 segundos; restaurada enabled=true. Durante la ventana podían rechazarse recepciones con 503 para reintento de Meta; no se acredita entrega de reintentos no observados. Cron succeeded a las 10:45 y cero trabajos activos v2/leases después.

Se conservaron **ocho pendientes históricos v1**: no reenviados, procesados ni eliminados. La quietud comprobada corresponde a la cola actual v2; no se usa el registro antiguo como prueba de pérdida ni como motivo para borrar mensajes.

El primer intento abortó por una representación distinta del separador en las huellas del SQL operativo. Se verificaron 041, definición original de la RPC y cola habilitada tras el rollback. Se unificó a chr(10) y se repitió con todas las guardas. No hubo guardado parcial ni migración intermedia. No se modificó el archivo versionado 042.

## Validación

- npm run lint: aprobado.
- npm test: **1.111 pruebas / 55 archivos**, aprobado.
- npm run test:sql: **12 escenarios**, aprobado.
- npm run test:release:guards: **14 guardas**, aprobado.
- npm run build: TypeScript y build aprobados.
- Ensayo completo de instalación/rollback: aprobado en CI #289 del mismo commit; Docker local no se volvió a intentar.
- POST sin firma y worker sin secreto: ambos **401**, sin efectos financieros.
- Resguardo previo v64: 26 archivos descargados iguales a ecba420, el rollback ensayado. No se ejecutó rollback productivo ni se retiró SQL.

## Aceptación que falta

Publicación técnica comprobada; **pendiente prueba manual WhatsApp BE-22**: agregar tres movimientos ficticios, cambiar dos en un mensaje, quitar dos juntos y cancelar. Verificar números estables y resumen; no confirmar para guardar. Antes enviar RESUMEN y conservar cualquier pendiente real que se quiera guardar.

Después se propone **BE-19: aviso de renovación por WhatsApp**, con entrega duradera/idempotencia y sin bloquear la renovación. No se implementó en este despliegue.

Se mantienen Thomas como único administrador, proveedores/claves/cupos/costo, CSP/hosting y backups aplazados. Retención 30/90 **desactivada**.

[Evidencia saneada](evidencias/RELEASE_042_PRODUCCION_2026-10-30.json). [CI #289](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/40952806060).

## Seguimiento de aceptación — 30/10/2026

El paso 3 falló en WhatsApp: la regla local rechazó dos importes en un texto sin modificar la lista. La publicación técnica 042/v65 se mantiene acreditada, pero la aceptación funcional no está cerrada. Ver [corrección en rama y pruebas](VALIDACION_BE_22_IMPORTES_MULTIPLES.md).
