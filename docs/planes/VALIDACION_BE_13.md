# BE-13 — Alta de usuarios consistente

## Alcance vigente — 28/10/2026

Preparado en rama; todavía no aplicado ni publicado. Cuenta Auth, perfil, ajustes, vínculo de WhatsApp, 16 categorías e invitación se confirman en una misma transacción. Un fallo cancela el alta completa y permite repetir el intento con el mismo código, salvo que otra alta lo haya usado entretanto.

**Administrador inicial excluido por instrucción expresa del propietario.** Thomas conserva su rol; no se altera 005, no se ejecuta de nuevo su promoción histórica ni se añade una función para nombrar administradores. No se cambia ninguna cuenta existente.

Producción observada: main 0cc65d9 / PR #50, esquema 038, webhook v62. El nuevo contrato de release exige 039 y permite rollback de runtime a 0cc65d9 conservando la migración expandida. Hosting, backups y retención siguen fuera del bloque.

## Problema y cambio

La combinación 016/024 atrapa cualquier error del trigger y retorna NEW. La prueba reproduce un usuario Auth persistido sin perfil/ajustes al fallar la inicialización. 024 saneó el warning, pero preservó deliberadamente esa semántica.

039 reemplaza únicamente bootstrap_user. Bloquea la invitación disponible, rechaza códigos inexistentes/usados o ambiguos después de normalizarlos y valida las filas efectivamente creadas. Un error se propaga como REGISTRATION_INITIALIZATION_FAILED, sin código, email, metadata o SQLERRM en el diagnóstico; el warning conserva solo evento y SQLSTATE. EXECUTE queda retirado de los roles de API: el trigger sigue siendo su único punto de entrada. La invitación no se canjea desde el cliente.

Se conserva el alta administrada sin código como pending_code y el canje posterior autenticado. La PWA sigue exigiendo invitación. Las cuentas nuevas son client aunque la metadata diga admin; los administradores existentes no cambian. Las 16 categorías y los defaults permanecen iguales.

Login usa try/finally, exclusión inmediata de doble submit y mensajes seguros. Elimina la actualización de perfil redundante posterior al alta. Una respuesta perdida pide iniciar sesión o revisar el correo antes de repetir y conserva el formulario; no afirma que el servidor falló ni que se activó la licencia. El preflight distingue falta de conexión de código inválido, ignora respuestas antiguas y limpia su timer al desmontarse. La comprobación orientativa no sustituye el bloqueo SQL.

## Diagnóstico productivo de solo lectura

Consulta agregada ejecutada el 28/10/2026, antes de publicar: 4 cuentas Auth; 0 sin perfil, 0 sin app_settings y 0 sin whatsapp_links; 1 administrador y corresponde a Thomas. No se expusieron correos/códigos/contenidos. No se escribieron filas ni se crearon usuarios reales de prueba. Esto comprueba presencia de componentes, no reconstruye ni certifica todos los datos históricos o categorías editadas por cada usuario.

## Validación

- 1036 Vitest aprobados, incluidos 40 nuevos de SQL y del componente Login real; lint, TypeScript/build, 12 escenarios de renovación SQL y seis guards de release aprobados.
- SQL PGlite con migraciones reales: reproducción del defecto anterior, temporal/vitalicio/sin código, código inválido/usado/normalizado/ambiguo, metadata de rol ignorada, fallo en cada etapa, omisión silenciosa por trigger, reintento sin doble consumo, permisos privados y preservación de perfiles existentes.
- Componente real: éxito con/sin sesión, respuesta ofuscada de duplicado, error SQL/red, datos conservados, doble submit, preflight fallido y respuesta antigua; no imprime detalles internos ni anuncia activación sin evidencia.
- PostgreSQL nativo preparado: dos sesiones compiten por una invitación; solo una cuenta completa gana. Fallo posterior al trigger revierte también el código; reintento posterior válido. Verificación de perfiles/roles existentes.
- Supabase local preparado: /auth/v1/signup real con fallo de categorías y reintento del mismo código, rechazo de código consumido, duplicado y metadata de rol ignorada. Fixtures locales .invalid y claves del stack aislado, sin emails ni IA/WhatsApp reales. Conserva prueba financiera de release y rollback de runtime.
- Docker no está disponible en esta PC. Concurrencia y Auth completo requieren los controles PostgreSQL/Ensayo de release de CI Linux; no se declaran aprobados antes de observarlos. Webhook no cambia; su suite completa sigue siendo obligatoria en CI.
- Build: 873,01 kB / 250,40 kB gzip; advertencia de tamaño preexistente, fuera de este bloque.

## Recuperación y aceptación

1. Un error de inicialización confirmado revierte Auth y sus componentes en la misma transacción. Corregir la causa técnica y repetir con el mismo correo y código; verificar antes si otra alta consumió la invitación.
2. Si se perdió la respuesta de red, no asumir rollback ni usar otro código: intentar ingresar/revisar confirmación. Auth impide un segundo usuario con el mismo correo; la PWA no promete un alta ante la respuesta ofuscada de duplicado. No se implementa un reintento automático de signup.
3. Si apareciera una cuenta incompleta anterior a 039, detener reparación automática. Leer Auth/perfil/ajustes/vínculo y estado de invitación, proponer una corrección acotada y obtener aprobación específica. No borrar usuarios, recrear licencias ni regalar días para ocultar el fallo. Hoy el diagnóstico no encontró esos casos.
4. Después de aprobar CI, pedir autorización explícita para 039 + publicación de PWA. No es necesario actualizar el webhook, claves o planes. Comparar función/atributos/permisos, historial y conteos agregados de cuentas/roles; probar el formulario sin enviar un alta real y comprobar PWA/SW/CSP y versión pública.
5. Para una aceptación de registro real adicional, acordar una cuenta de prueba y el envío eventual de correo. Los ensayos de fallos y concurrencia se mantienen en aislado; no se inyectan errores en Auth productivo.

## Estado de publicación

Pendientes: controles CI completos, revisión/autorización de publicación, aplicación 039 y verificación productiva. El alcance de administrador inicial queda expresamente excluido, no resuelto por extensión.
