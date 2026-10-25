# Validación FE-07 / FE-12 — actualizaciones y borradores

Fecha: 25/10/2026. Base: main 77a0002 (plan actualizado en PR #36). Rama: codex/preserve-forms-on-updates.
Estado al 25/10/2026: publicado en PR #37 y verificado técnicamente en producción. FE-12 terminado en su alcance; FE-07 conserva pendiente la aceptación física de Safari/iOS/PWA instalada. La preparación que sigue es registro previo a la publicación.

## Resultado preparado

- Un coordinador de actualización con una suscripción React y un solo aviso. Versionado, foco, visibilidad, conexión, controllerchange y SW_ACTIVATED anuncian disponibilidad; ninguno recarga. Se eliminan los MutationObserver de recarga y la activación automática desde el cliente.
- Actualizar es una acción explícita. Se bloquea mientras hay formularios o envíos activos en acceso/registro, movimientos/presupuesto, códigos, renovación/pausa y configuración administrativa; también durante acciones del panel del bot. Ajustes conserva su bloqueo por nombres sin guardar aunque se navegue a otra pantalla. El bloqueo de configuración administrativa es conservador mientras esa pestaña está abierta.
- Antes de recargar se verifica red/versionado/HTML y se espera al worker instalado. Todas las esperas tienen plazo y cancelación. Se comprueba otra vez el estado de edición después de cada fase que puede preceder a la recarga. Un error deja el aviso y permite reintentar sin abandonar el formulario. Doble clic no duplica la aplicación.
- Un respaldo reconoce diálogos nativos/accesibles y ambos backdrops. El aviso queda por debajo de los diálogos para no tapar sus acciones. Listeners, sondeos y esperas se limpian al desmontar; StrictMode no duplica recursos. Desarrollo no registra el worker productivo.
- El SW nuevo precarga HTML y assets principales; una instalación incompleta falla sin forzar activación. Las actualizaciones esperan la acción del usuario. Versión y comprobación explícita de HTML evitan fallback de caché; servicios externos no se interceptan. Offline devuelve el asset correspondiente o un error, nunca HTML como si fuera JavaScript.
- Con varias pestañas se conservan cachés anteriores para no romper la que continúa en la versión vieja. En una activación con una sola pestaña se eliminan únicamente cachés anteriores con prefijo de Pesito; no se borran cachés de otras aplicaciones. Puede demorarse esa limpieza mientras sigan abiertas varias pestañas.
- El borrador de nombre/apellido vive en la sesión autenticada, separado del perfil. Polling/foco y navegación dentro de la sesión no reemplazan lo escrito. Si cambian los nombres remotos se muestra un aviso y se ofrece usar los datos actualizados. Guardar escribe el formulario visible; no se agrega una nueva transacción de resolución de conflictos entre pestañas.
- Guardado con exclusión inmediata, campos congelados, timeout y verificación de la fila devuelta. Falta de fila, error o respuesta tardía no anuncian éxito. La respuesta confirmada no es pisada por una lectura antigua; se refresca el perfil tras guardar. Descartar usa los datos remotos conocidos. Cambio de usuario/cierre de sesión separa y descarta el borrador anterior.
- No se guardan nombres en localStorage/sessionStorage, ni se registran inputs en logs. No hay cambios de RPC, migraciones, webhook, IA o datos de producción.

## Validación local

- 31 regresiones nuevas en cuatro archivos, sobre coordinador/SW reales, modelo de borrador y componente Settings con hook/aviso reales en jsdom/React StrictMode. Cubren edición/refresco, conflicto y descarte, guardado fallido/fila ausente/doble envío, usuario distinto, timeout/desmontaje, eventos repetidos, primera instalación, offline, acción explícita, caché y fallo de instalación/activación. Se ejecutan con npm test y dependencias declaradas/fijadas.
- Suite completa final: 592 pruebas aprobadas (561 anteriores y 31 nuevas). Incluye primera instalación, offline, detención durante descarga y rechazo del worker al activar. Registrar el resultado de CI sobre el SHA de revisión antes de publicar.
- Lint, TypeScript/build, 12 escenarios SQL existentes y seis controles de release aprobados. El bundle conserva el aviso previo de más de 500 kB. Las nuevas dependencias son solo de pruebas (jsdom 29.1.1 y tipos 28.0.3), compatibles con el Node fijado.
- Audit: cero avisos de producción, altos o críticos. Permanecen dos avisos moderados de desarrollo en vitest/@vitest/mocker, ya registrados como seguimiento INF-07/FE-08; no se ejecutó audit fix ni una actualización ajena a este bloque.

## Navegador ficticio

Vista local en http://127.0.0.1:4196/chatbot-gastos/, con Settings/hook/aviso y SW reales compilados en dos versiones, API de prueba en loopback y perfiles ficticios. No hay credenciales ni llamadas a Supabase/Groq/Meta.

Se escribió Anita local, se publicó B mientras A seguía abierta y se mostró un solo aviso deshabilitado: sin recarga. Refrescar y salir/volver a Ajustes conservaron el borrador. Un cambio remoto generó aviso sin reemplazarlo. Fallo de guardado: mensaje visible y campos conservados. Reintento: fila ficticia confirmada y actualización habilitada. Solo al pulsar Actualizar se cargó B y el nombre guardado continuó visible. Capturas en carpeta temporal: pesito-fe07-borrador-protegido.jpg y pesito-fe07-actualizacion-verificada.jpg. La barra de pruebas no forma parte del producto.

## Publicación y límites

1. Revisar el diff y aprobar los cuatro controles sobre el SHA final. No hay migración ni despliegue del webhook.
2. Obtener autorización para integrar/publicar la PWA. Antes de la primera transición, guardar/cerrar los formularios: el JavaScript ya abierto de una versión anterior conserva su política vieja hasta recibir este cambio; el código nuevo no puede modificar retrospectivamente esa sesión.
3. Comprobar HTML/version.json/SW publicados, acceso y aviso sin escribir en cuentas reales. Aceptación de actualización en instalación existente/Safari/iOS físico pendiente; no se presume probada por Chromium local.
4. Rollback mediante el procedimiento de INF-10. La versión anterior recupera su política de actualización anterior; comunicar ese límite. No se altera SQL ni su historial.

El borrador es en memoria durante la sesión: cierre de pestaña, recarga manual/forzada o terminación del navegador pueden perder cambios sin guardar. Se protege la actualización gestionada por Pesito; no se declara persistencia ante cierre del sistema ni resolución SQL de ediciones concurrentes de nombres. Retención y backups permanecen sin cambios.

## Publicación autorizada y comprobación — 25/10/2026

- El propietario autorizó integrar/publicar PR #37. Candidato 3edb9dcb8de1f1f4296d7b76a82d1589993c7005: Frontend, Webhook, PostgreSQL y Ensayo de release aprobados. Integrada en 15269ba819f6f5e14773df845112e8073ba310ce. [CI main y Publicar](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/40227854172) aprobados. 592 pruebas, lint/tipos/build, SQL y controles de release verificados.
- HTTP: version.json y SW corresponden a 15269ba; bundle publicado contiene el aviso y el manejo de borrador/error. CSP presente. No se aplicó ninguna migración ni se redesplegó el webhook.
- Con la sesión existente del propietario se abrió Ajustes. Se escribió un valor ficticio solo en el formulario: apareció Descartar cambios y Actualizar quedó deshabilitado. Salir/volver conservó el borrador; tras más de 30 segundos continuó intacto. Se descartó y se restauraron los datos remotos visibles; no se pulsó Guardar mis datos. Se pulsó Actualizar con el formulario limpio: recarga completada, acceso conservado, formulario limpio y aviso ausente. Es una comprobación en navegador de la PWA publicada; no se presenta como Safari/iPhone o instalación física.
- Evidencia agregada sin datos personales en carpeta temporal: pesito-fe07-production-artifacts.json y pesito-fe07-production-draft.json. Captura de UI en pesito-fe07-produccion-borrador.jpg; no se versionan capturas con datos de la sesión.
- FE-12 terminado dentro del alcance descrito. FE-07: corrección publicada y comprobada; seguimiento de instalación existente/Safari/iOS físico abierto. No se prueba guardado real de nombres, conflictos entre clientes reales, cierre del navegador ni terminación del sistema. La prueba de guardado/error/usuarios distintos permanece ficticia y no se confunde con cambios en cuentas reales.
- Próximo bloque recomendado: FE-09 + aceptación de FE-11; no se inició esa implementación.

## Seguimiento físico — 25/10/2026

El propietario delegó la prueba física si estaba disponible. El inventario de superficies de esta sesión solo ofrece el navegador integrado y MCP Apps sin pestañas; no hay iPhone/Safari ni instalación PWA física controlables. No se repitió la comprobación publicada como sustituto de ese dispositivo y el seguimiento continúa abierto. Se avanzó con FE-09/11 en datos ficticios, por autorización del propietario.
