# INF-08 — Configurar backups cifrados en Google Drive con presupuesto cero

Decisión del propietario, 14/10/2026: **costo adicional máximo USD 0** y destino **Google Drive**. PITR de pago descartado. INF-08 sigue en curso: no hay aún un backup productivo generado ni una restauración de la base comprobada.

## Qué quedó preparado

- `.github/workflows/backup-drive.yml`: pruebas en push; ejecuciones manuales y programación a los minutos 7 y 37. Usa runner Linux estándar únicamente mientras el repositorio sea público, sin caché ni artifacts de backups en GitHub. Si pasa a privado, los jobs se omiten para evitar consumo no revisado de minutos.
- `scripts/backup/install-backup-tools.sh`: CLI 2.120.0 y rclone 1.75.2 con SHA-256 verificados. Checkout y setup-node fijados a commits completos. PostgreSQL 17 fijado a digest de imagen; contenedor cliente sin root, puertos publicados ni capacidades adicionales.
- `scripts/backup/backup-drive.mjs`: exportación de lectura con TLS y CA verificada, cifrado GPG con clave pública y envío a una carpeta explícita de Drive. Descarga nuevamente el ciphertext y compara SHA-256. No contiene la clave privada de recuperación.
- `scripts/backup/backup-drive.test.mjs`: ocho pruebas de guardas, contrato de exportación, cuotas, componentes y manifiesto. No equivalen a una prueba integral de backup/restauración.

El script obtiene los comandos de exportación de la CLI oficial con una URL ficticia, elimina sus cinco exports de conexión y hereda credenciales libpq solamente dentro del contenedor cliente. Nunca ejecuta como código una contraseña de origen. Se comprobaron los seis tipos de dry-run con la CLI real, sin conexiones a esa URL.

Los datos de aplicación, Auth y el historial de migraciones se exportan en **una sola ejecución de pg_dump**, con un snapshot consistente para ese archivo. La única adaptación del filtro de datos de la CLI es incluir `supabase_migrations`; se comprueba el contrato y se detiene ante un cambio inesperado. Los roles, esquemas y catálogos se capturan aparte; no hacer despliegues de esquema durante el backup. Se compara el esquema de aplicación antes y después, lo cual detecta cambios persistentes pero no sustituye un bloqueo global de despliegues.

El manifiesto obtiene las cantidades de filas directamente de los bloques COPY del dump, no de una lectura posterior de producción. Conserva hashes de los archivos exportados dentro del archivo cifrado. Incluye los catálogos de Auth y Storage para preservar sus personalizaciones; **no deben ejecutarse completos sin revisión sobre otro proyecto administrado**. La restauración debe adaptar el trigger de alta, roles reservados, publicaciones y configuración del destino según el runbook principal.

## Comprobación cloud ya realizada

Se creó una carpeta privada de ensayo `Pesito Backups` y se comprobó que solo figura el propietario. Se subió un archivo **sintético** cifrado de 553 bytes, se descargó, se verificó su hash, se descifró y se comparó con el original. El archivo también es privado. La clave fue efímera, exclusivamente para ese ensayo; no es la clave del backup productivo.

No se subieron datos de clientes, claves privadas, contraseñas ni tokens. Este ensayo usa la conexión de Drive del chat; no autoriza ni provee tokens reutilizables al runner de GitHub. La cuota libre de la cuenta aún no se midió.

## Límites de costo y operación

- El repositorio se verificó público. Los runners estándar en repositorios públicos son gratuitos; no utilizar runners grandes ni cambiar a un repositorio privado sin reevaluar.
- Google ofrece capacidad gratuita compartida entre sus servicios; usar únicamente el espacio disponible, sin contratar Google One. La cuota real de la cuenta debe comprobarse, no inferirse de los 15 GB generales.
- El proyecto OAuth de Drive no debe vincularse a facturación ni solicitar aumentos de cuota de pago. No contratar PITR, compute, buckets ni otros servicios de pago.
- Antes de permitir exportar, `PESITO_BACKUP_FREE_LIMITS_VERIFIED=true` exige que el operador haya comprobado los límites actuales de GitHub, Drive y **el plan/egress compartido de Supabase**. Este flag es una declaración del operador, no una consulta automática de facturación.
- Límites iniciales del script: 2 MiB de archivos SQL/JSON por conjunto y ciphertext; 256 MiB máximos de archivos en la carpeta; al menos 256 MiB libres en Drive. Cada archivo exportado tiene un límite de tamaño del sistema operativo dentro del contenedor. Si un límite se excede, el job falla sin contratar capacidad adicional.
- El límite del archivo no mide todo el tráfico SQL: los catálogos, protocolo y consultas también consumen transferencia. Medir el primer ensayo y la cuota compartida antes de habilitar la frecuencia. No hay garantía de costo cero por extrapolar solo el tamaño de la base o del archivo comprimido.
- **No hay borrado automático ni retención habilitada todavía.** Antes del cron permanente, ensayar restauración y definir rotación de copias propias. Si la carpeta llega al límite, se detienen los nuevos backups; hay que resolverlo antes de que se incumpla el RPO. No vaciar la papelera ni borrar otros archivos de Drive para obtener espacio.
- Si aparecen objetos de Storage o entradas de Vault, el script se detiene: el flujo actual no respalda sus bytes o claves y no debe anunciar cobertura incompleta como éxito.
- Los errores muestran códigos seguros. Los resultados solo registran tiempos, bytes y cantidades. Los temporales y logs de comandos permanecen privados en el runner y se retiran al finalizar; nunca se publican como artifacts.

La programación de GitHub puede demorarse, omitirse o desactivarse. **RPO <= 1 h sigue siendo un objetivo pendiente de validar, no una garantía de este diseño gratuito.** Falta un control independiente de antigüedad y un canal de alertas probado; una notificación de fallo de GitHub no detecta por sí sola un cron que nunca arrancó.

## Preparación de credenciales, sin pegarlas en el chat

1. Crear una clave GPG de recuperación protegida en un equipo de confianza. Guardar su clave privada y contraseña en un gestor/medio independiente del runner y de la carpeta de backups. Probar su recuperación. Exportar únicamente la clave pública ASCII y anotar su fingerprint completo de 40 caracteres. El job rechaza importar una clave privada.
2. Crear un cliente OAuth propio para Drive, sin facturación; autorizar rclone con scope **drive.file**, evitando acceso a todo Drive. No depender del cliente compartido de rclone ni de un consentimiento de prueba que caduque a los siete días. Usar la modalidad adecuada para aplicación personal según Google/rclone, sin asumir una exención que no corresponda.
3. Crear o autorizar la carpeta desde ese mismo cliente OAuth y obtener su ID. La carpeta creada por la conexión del chat no será necesariamente visible a otro cliente con `drive.file`: no ampliar a todo Drive para resolverlo automáticamente. Verificar que la carpeta elegida sea privada.
4. Preparar un archivo de configuración de rclone con **un único remoto** llamado `backupdrive`, tipo `drive`, scope `drive.file`, `client_id`, `client_secret`, `token` con refresh_token y `root_folder_id` igual al ID elegido. Probar `about`, listado, subida y lectura sintética. No compartir ni commitear ese archivo; los tokens del chat no se extraen ni se reutilizan.
5. Obtener conexión SQL de sesión de Supabase y certificado CA. Puerto 5432; base postgres; usuario `postgres.<project-ref>` en pooler o postgres en conexión directa. El script permite únicamente el proyecto aprobado y fuerza lectura en las sesiones. Revisar el alcance de la credencial: no confundir la configuración read-only del cliente con una contraseña que solo tenga permisos de lectura. No crear roles amplios ni resetear la contraseña productiva para esta tarea sin evaluar sus consumidores.
6. En GitHub > Settings > Secrets and variables > Actions, cargar los valores directamente en la UI segura o desde una herramienta local autenticada. No pegarlos en este documento, el chat, issues ni logs.

| Secret de GitHub | Contenido |
| --- | --- |
| PESITO_BACKUP_PUBLIC_KEY | Clave pública GPG ASCII; nunca la privada |
| PESITO_BACKUP_RCLONE_CONFIG | Configuración de ese único remoto, que contiene OAuth privado |
| PESITO_BACKUP_DB_CA_PEM | Certificado CA válido para el endpoint SQL |
| PESITO_BACKUP_PGHOST | Endpoint de conexión directa o pooler de sesión |
| PESITO_BACKUP_PGUSER | Usuario SQL del proyecto aprobado |
| PESITO_BACKUP_PGPASSWORD | Contraseña SQL, preservada sin cambios |

| Variable de GitHub | Valor / condición |
| --- | --- |
| PESITO_BACKUP_DRIVE_FOLDER | ID de la carpeta privada validada con el cliente OAuth del runner |
| PESITO_BACKUP_KEY_FINGERPRINT | Fingerprint completo de la clave de recuperación |
| PESITO_BACKUP_FREE_LIMITS_VERIFIED | true solo tras comprobar cuotas, plan y transferencia; de lo contrario false |
| PESITO_BACKUP_ENABLED | false inicialmente; true permite un ensayo manual cuando las credenciales y condiciones estén verificadas |
| PESITO_BACKUP_SCHEDULE_ENABLED | false hasta completar restauración, retención y alertas; después true habilita el cron |

La ausencia de variables deja el envío desactivado. Un push únicamente corre validaciones, nunca el backup. Para el primer ensayo manual, habilitar PESITO_BACKUP_ENABLED manteniendo PESITO_BACKUP_SCHEDULE_ENABLED=false y ejecutar `Backups cifrados de Pesito` desde Actions en main.

## Validación y activación pendientes

1. Configurar las credenciales independientes y medir espacio/egress con un ensayo manual.
2. Descargar y descifrar el conjunto real; verificar todos sus componentes y hashes, identidad de origen y cantidades COPY. Guardar aparte una copia conocida buena.
3. Restaurar en un destino aislado compatible, sin enviar correo ni mensajes, según [el runbook](RUNBOOK_BACKUPS_RECUPERACION.md). Probar Auth, RLS, RPC, datos y reconciliación de cola; medir tiempos. La verificación de ciphertext del job no acredita este paso.
4. Acordar RTO, responsables, retención y mecanismo de alertas. Implementar y probar rotación y detección de copias atrasadas sin costo adicional y sin borrar la última copia recuperable.
5. Solo entonces habilitar el cron, observar intervalos reales y revisar consumos. Si el RPO de una hora no se puede cumplir, dejarlo explícitamente sin cumplir y revisar el alcance con el propietario. No marcar INF-08 cerrada por tener un workflow o por el ensayo sintético.

## Fuentes

- [GitHub Actions: facturación](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
- [GitHub: limitaciones de ejecuciones programadas](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
- [Google: almacenamiento compartido](https://support.google.com/drive/answer/6374270).
- [Google Drive API: límites y precios](https://developers.google.com/workspace/drive/api/guides/limits).
- [rclone: Drive, scopes y OAuth propio](https://rclone.org/drive/).
- [Supabase: backup y restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
