# Validación FE-01 / FE-02 / FE-03 — planes de cuotas

Fecha: 23/10/2026. Estado: **bloque cerrado**, migración 029 y PWA publicadas; aceptación completada por Codex a pedido explícito del propietario.

## Resultado

La PWA usa `get_installment_plan` y `mutate_installment_plan` (migración 029). Crear, editar, quitar una cuota o cancelar una compra completa ocurre en una transacción. Un patch solo contiene campos realmente editados: cambiar el nombre conserva centavos, fechas, IDs y números.

Se admiten ambos contratos existentes: padre PWA cancelado sin número y primera cuota WhatsApp como ancla. Quitar esta última cancela su estado sin romper el grupo. No se migra ni se intenta reparar información financiera existente.

## Controles

- Identidad desde `auth.uid()`, perfil bloqueado mientras se verifica acceso, suscripción y propiedad del conjunto y categoría. Tabla de recibos con RLS y sin escritura/lectura directa de clientes.
- Bloqueo por grupo, versión del conjunto revisado y rechazo de edición obsoleta. Dos pantallas no pueden guardar versiones incompatibles a través de la nueva API.
- UUID de intento + hash de parámetros + recibo transaccional: un reintento idéntico obtiene el resultado anterior. Reutilizarlo con otros datos se rechaza. El formulario conserva el intento mientras permanece abierto; crear conserva el UUID al cerrar/reabrir dentro del mismo montaje.
- ARS/USD, importes positivos con dos decimales, categorías propias activas, fechas finitas y 2–60 cuotas. División en centavos enteros y resto en la última cuota. Los límites se muestran también en el cliente.
- Reprogramar cambia fechas solo si se pide explícitamente. Editar cantidad conserva las cuotas existentes por número; no rellena huecos. Ampliar agrega números posteriores al máximo contratado anterior. Reducir cancela los superiores al nuevo límite.
- La PWA vuelve a consultar el resultado del servidor, bloquea doble envío inmediato e impide editar mientras carga la versión. La eliminación identifica el grupo por ID, sin filtrar compras ajenas por descripción.

## Validación local

- 490 Vitest aprobados: 15 escenarios SQL nuevos ejecutando migraciones reales en PGlite y siete del patch/contrato del editor, además de las regresiones anteriores.
- 12 escenarios SQL de renovaciones y seis controles de herramientas de release aprobados.
- ESLint, TypeScript/build y `git diff --check` aprobados. El bundle sigue superando 500 kB (842,25 kB; 241,02 kB gzip); optimización separada.
- Navegador: Dashboard real conectado a PGlite local, con datos ficticios y sin credenciales. Alta desde el formulario de 100 en tres cuotas aprobada. Renombrar compra de 100 conserva 33,33 / 33,33 / 33,34. Quitar la cuota 2 y renombrar desde la 3 conserva números 1 y 3, la cuota 2 cancelada, el importe 33,34 y total activo 66,67. No se usaron cuentas ni movimientos reales.
- Prueba PostgreSQL nativa agregada al ensayo de concurrencia: dos altas con mismo intento, dos ediciones de igual versión y rollback ante fallo intermedio. Docker está apagado en la PC; la ejecución nativa se realiza en CI. El primer intento detectó un delimitador SQL incorrecto en el fixture, corregido. El candidato final y main aprobaron Frontend, Webhook, PostgreSQL y Ensayo de release; Publicar también aprobó en main.

## Publicación y aceptación — completadas

- [PR #30](https://github.com/ThomasMariani11/chatbot-gastos/pull/30) integrada y publicada en d8aaacdfbfca9a674c5fe287acc3140bc9b81cf6; [CI y publicación](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/40035352563) aprobados. Migración 029 aplicada antes de la PWA y registrada transaccionalmente en schema_migrations.
- Fuente normalizada y cuerpos de las cuatro funciones comparados con el candidato aprobado. ACL/RLS correctos; llamadas sin sesión a las RPC y recibos rechazadas con HTTP 401/42501.
- Ensayo SQL autenticado con ROLLBACK aprobado: alta, idempotencia, centavos, conflicto de versión, eliminación y edición posterior. Ningún movimiento de ese ensayo se confirmó.
- El propietario delegó la aceptación final y el cierre: «hacelo vos y cerra el bloque». Se usó su sesión de producción para operar exclusivamente una compra ficticia identificable, sin accionar sobre compras preexistentes.
- Alta desde la PWA: total 100 ARS, tres cuotas 33,33 / 33,33 / 33,34. Cambiar solamente el nombre conservó esos importes y total 100.
- En noviembre se eliminó solamente la cuota 2. Se volvió a renombrar desde la cuota 3 de diciembre: quedaron números 1 y 3 con importes 33,33 / 33,34, total activo 66,67. Los IDs y las fechas originales se conservaron, comprobados por lectura de los recibos del mismo grupo.
- Limpieza desde la PWA: se eliminó el plan ficticio completo. Supabase confirma un único grupo de prueba, cero filas confirmadas y cuatro filas canceladas (padre y tres cuotas). Se mantienen cinco recibos privados como auditoría/idempotencia; no se purgaron históricos ni se activó retención.
- Se volvió a octubre: las cuatro compras anteriores siguen visibles y el plan de prueba ya no aparece. Esta comparación visual no se presenta como un inventario completo de todos los datos de clientes.
- PWA y service worker verificados en la versión publicada; lectura autenticada del editor aprobada. Sin redespliegue del webhook ni avisos a clientes.

FE-01, FE-02 y FE-03 quedan terminados. FE-04/FE-05, FE-09 y los demás límites indicados abajo permanecen abiertos. Los formatos WhatsApp y las condiciones de fallo/concurrencia se validaron en SQL/CI; esta aceptación final en producción se limitó al recorrido PWA descrito.

## Procedimiento de publicación y recuperación

1. Aprobar el cambio y los cuatro controles de la PR. Verificar propietario, categorías y formatos de planes de manera agregada antes de publicar; no imprimir descripciones de clientes.
2. Aplicar 029 en Supabase **antes** de integrar/publicar la PWA. Verificar ACL y RPC con una sesión autenticada y una cuenta ficticia; no usar claves privilegiadas suspendidas por el propietario.
3. Publicar la PWA y comprobar actualización de versión/SW. Una PWA nueva sin 029 devuelve un error seguro y no cae a las escrituras antiguas.
4. Aceptación delegada completada (ver registro anterior). Procedimiento: alta ficticia de 100 en tres cuotas, renombrar, quitar la 2 y volver a editar. Comprobar exactamente los importes y números antes de cerrar FE-01/02/03.
5. Ante fallo, detener la publicación o volver a la PWA anterior manteniendo 029. No eliminar tablas/recibos ni revertir datos financieros. El frontend anterior conserva sus riesgos: el rollback es compatibilidad técnica, no una solución de integridad.

## Límites expresos

- No hay cambios en el webhook ni alteración automática de planes existentes. Confirmaciones WhatsApp mantienen sus operaciones actuales.
- Clientes PWA antiguos y escrituras directas anteriores siguen permitidos por sus políticas existentes. El bloqueo/versionado protege a consumidores de la nueva RPC; no garantiza exclusión global frente a clientes antiguos. La publicación debe coordinarse con la actualización de los clientes.
- Recargar la página pierde el UUID del formulario; ante un resultado incierto, comprobar la compra antes de crear otra. Persistencia del intento a través de recargas y altas normales idempotentes siguen en FE-04.
- No se cambia todavía el cálculo general de totales restantes (FE-09), la carga/error mensual (FE-05), renovaciones (BE-02/FE-06) ni la integridad general de referencias (BE-03).
- No se habilita limpieza de recibos ni retención. Definirla posteriormente con autorización; los recibos contienen el resultado del plan y están aislados por ACL/RLS.