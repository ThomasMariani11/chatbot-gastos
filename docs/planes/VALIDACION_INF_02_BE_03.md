# Validación y despliegue de INF-02 / BE-03

Fecha: 14/10/2026. Base: 145cf54, publicado en origin/main y verificado en version.json de la web pública. Estado de publicación: 018 aplicada y registrada; prueba transaccional productiva aprobada sin residuos. Se publica el nuevo cliente antes de aplicar 019; el cierre requiere las verificaciones finales y WhatsApp del usuario.

## Revalidación productiva de solo lectura

Se consultaron exclusivamente metadatos y agregados de inconsistencias. Las cuatro tablas draft_groups, draft_items, whatsapp_message_queue y whatsapp_links conservan concesiones de escritura a authenticated y políticas propias ALL. RLS está activado, pero permite esas escrituras propias. También hay privilegios de tabla para anon; las políticas no permiten confundir ese privilegio con acceso anónimo efectivo a filas.

No se detectaron ítems asociados a grupos ajenos, categorías de otro propietario, cuotas con padre ajeno ni hashes de código duplicados. Es una observación previa al despliegue: las restricciones vuelven a validar los datos al aplicarse y abortan ante inconsistencias, sin repararlas ni eliminarlas silenciosamente.

No existían la RPC request_whatsapp_link_code ni la migración 018 registrada. Se comprobó disponibilidad de sha256(bytea) del núcleo de PostgreSQL. La vista column_privileges incluye concesiones derivadas de tabla; su cantidad no demuestra por sí sola concesiones explícitas por columna. La migración retira ambas formas y verifica permisos efectivos.

## Cambios preparados

### 018: RPC de solicitud de código

- Archivo: supabase/migrations/018_request_whatsapp_link_code.sql.
- Solo authenticated puede solicitar un código de su propia sesión, sin parámetros de usuario, teléfono, hash, estado ni fecha. Perfil existente y acceso vigente se comprueban después del bloqueo de su fila.
- Generación criptográfica en servidor, código de seis dígitos compatible con el webhook, hash SHA-256 y vencimiento de diez minutos calculado por PostgreSQL. Hash no nulo único, reintento de colisión y sustitución del código previo.
- La solicitud no activa ni cambia un teléfono y conserva el vínculo activo. El webhook sigue siendo quien verifica el código recibido antes de activar el vínculo.
- Esta etapa agrega la RPC sin retirar aún el contrato de la web anterior. No cambia suscripciones ni corrige el trigger de renovaciones de BE-02.

### Cliente PWA

- src/whatsappLink.ts centraliza la llamada y valida la respuesta del servidor sin mostrar errores SQL internos.
- src/Dashboard.tsx y src/Settings.tsx usan esa función; dejan de generar códigos, definir vencimientos y escribir directamente en whatsapp_links.
- La experiencia conserva el enlace VINCULAR por WhatsApp. No se modificaron estilos ni otras operaciones financieras.

### 019: escrituras internas y propietario

- Archivo: supabase/migrations/019_enforce_backend_writes_and_owner_links.sql.
- Revoca privilegios de tabla y columna a PUBLIC, anon y authenticated en las cuatro tablas. Mantiene lectura propia de grupos, ítems y vínculo para authenticated; la cola queda interna del backend. Retira políticas de modificación de clientes y conserva RLS.
- service_role conserva SELECT/INSERT/UPDATE/DELETE. Las funciones internas cerradas en 017 mantienen sus permisos; los cuerpos no se reemplazan.
- Claves compuestas garantizan el mismo propietario en ítem/grupo, ítem/categoría, movimiento/categoría y cuota/padre. Se conservan cascadas y se anula solo la referencia opcional al borrar categoría o padre, sin anular user_id.
- Protege phone_number del perfil frente a cambios directos de clientes. El rol del backend y el propietario de la tabla conservan su actualización; nombre, apellido y configuración legítima siguen funcionando.
- Ambas migraciones son transaccionales y tienen lock_timeout de cinco segundos. Un conflicto de locks o datos debe revisarse y reintentarse; no saltar validaciones. Las restricciones compuestas agregan tres índices únicos de soporte.

## Pruebas locales

```sh
npm test
npm run lint
npm exec -- eslint tests/operational-isolation.test.ts tests/whatsapp-link.test.ts
npm run build
```

Resultado: 106 tests aprobados en ocho archivos; lint general y de los nuevos tests, TypeScript y build aprobados. El bundle conserva la advertencia conocida de tamaño: JS 809,10 kB, gzip 230,97 kB. No se actualizaron dependencias en esta tarea.

La integración tests/operational-isolation.test.ts carga las migraciones reales 001 y 003–019 en PostgreSQL efímero con una fixture mínima de Auth. Como en 017, omite publicación Realtime y creación de pgcrypto, y usa gen_random_uuid del núcleo. Simula las concesiones de tablas de Supabase y una concesión explícita por columna para comprobar su retirada.

Antes del arreglo reproduce la activación directa de un vínculo, la edición directa del teléfono del perfil y un ítem de un usuario dentro del grupo de otro. Comprueba que 019 rechaza esos datos históricos; revierte la fixture y aplica el cambio sobre datos coherentes.

Las regresiones cubren:

- 24 intentos de INSERT/UPDATE/DELETE rechazados entre cuatro tablas y dos roles; comprobación de datos sin cambios tras cada rechazo.
- Lectura propia de grupos, ítems y vínculo; aislamiento de otros usuarios; cola inaccesible al cliente y borradores inaccesibles a anon.
- Eliminación de privilegios por columna y conservación de operaciones del backend.
- Relaciones cruzadas rechazadas aun desde service_role; movimientos válidos de la PWA admitidos y referencias ajenas rechazadas.
- Borrado de categoría, padre, grupo y usuario sin perder el propietario ni afectar al otro cliente; reasignación de padres referenciados rechazada.
- Confirmación con cuotas y descarte del bot funcionando con las nuevas restricciones.
- RPC de vinculación solo para la sesión, hash y vencimiento correctos, rechazo de usuarios ausentes/suspendidos/vencidos/pendientes, código nuevo que invalida el anterior y unicidad entre cuentas.
- Activación del vínculo y copia de teléfono desde el backend; rechazo de cambio directo del teléfono desde el cliente; nombres y preferencias siguen editables.
- Contrato del helper de la PWA y respuestas inválidas o errores de servidor.

No se probaron concurrencia real de conexiones, PostgREST remoto con 018/019 ni una nueva vinculación real por WhatsApp. Las pruebas locales no equivalen a publicación ni cierre productivo.

## Orden de despliegue pendiente

1. Revisar estado remoto, backups disponibles y metadatos actuales; registrar definiciones, políticas y ACL previas sin exportar datos de clientes. INF-08 sigue abierto; no asumir recuperación completa por la copia de metadatos de 017.
2. Publicar únicamente 018. Usar una carpeta de despliegue con las migraciones hasta 018 y comprobar mediante dry-run que solo anuncia ese archivo. No ejecutar db push desde un árbol que incluya 019 en este paso: aplicaría ambas antes de actualizar la PWA.
3. Comprobar RPC, ejecución anónima rechazada y generación legítima con la cuenta aprobada. Confirmar que solicitar código no desconecta un vínculo activo.
4. Publicar el commit de la PWA que usa la RPC. Verificar el workflow, version.json, Dashboard, Ajustes y actualización de la PWA instalada. No retirar permisos mientras la versión publicada siga escribiendo directamente en la tabla.
5. Publicar 019 tras revisar el dry-run, que debe anunciar únicamente ese archivo. Volver a verificar restricciones y permisos efectivos, incluidos los de columna y lecturas aisladas.
6. Verificar PostgREST: relación categories(name) de movimientos, listados legítimos y rechazos de escritura; usar datos ficticios y rollback donde corresponda.
7. Comprobar vinculación real desde WhatsApp y luego resumen/confirmación/descarte; no modificar vínculos existentes de clientes para simular la prueba.
8. Registrar versiones, resultados y evidencia sin códigos ni teléfonos; cerrar INF-02 y BE-03 únicamente después de esas comprobaciones.

Al aplicar 019, una versión antigua de la PWA que todavía use upsert directo recibirá un rechazo al generar código; necesitará actualizarse. Los vínculos ya activos y el webhook no dependen de ese upsert para procesar mensajes. La migración 019 no se aplica antes de publicar el nuevo cliente.

## Recuperación y pendientes relacionados

Si falla 018, la transacción revierte sus cambios. Si la nueva PWA falla antes de 019, puede recuperarse la versión previa, cuyo contrato sigue disponible en esa etapa.

Después de 019, recuperar el cliente que usa la RPC o aplicar una corrección específica. Una vuelta a la PWA anterior requiere coordinar su contrato; no reabrir escrituras arbitrarias de clientes como recuperación automática. Verificar historial antes de reejecutar migraciones: estos archivos de esquema no están diseñados para aplicarse dos veces por fuera del registro de migraciones.

BE-14 sigue pendiente: consumo y reasignación completos del código en una transacción, rate limiting y límites de intentos. También permanecen BE-02 (renovaciones), las tareas de cola y los demás hallazgos. Este cambio no atribuye a la generación de código la solución de todo el proceso de vinculación.
