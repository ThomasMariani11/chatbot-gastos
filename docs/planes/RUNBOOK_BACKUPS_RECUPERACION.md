# INF-08 — Backups y recuperación

Fecha local: 14/10/2026, America/Buenos_Aires. Estado: **en curso; protección y restauración aún no verificadas**.

## Objetivos y decisiones

- Requisito del propietario: preferir ninguna pérdida; aceptar como máximo **una hora de datos perdidos (RPO <= 1 h)**. Almacenar copias en cloud.
- Un RPO de una hora no equivale a cero pérdida. Tampoco alcanza con programar un backup cada hora: importan la antigüedad de su snapshot, la duración y los fallos de las ejecuciones.
- Propuesta para copias lógicas: ejecutarlas cada 30 minutos, vigilar desde un servicio independiente la antigüedad del último snapshot recuperable y alertar antes de llegar a una hora. Una programación por sí sola no garantiza ese objetivo.
- RTO (tiempo máximo para recuperar): **pendiente de acordar y medir**; no hay un tiempo prometido ni ensayado.
- Responsable propuesto: propietario del proyecto para facturación, custodia y recuperación de claves; operador designado para revisar alertas y practicar restauraciones. Falta confirmar responsables y canal de alertas.
- No hay autorización específica para contratar planes, crear recursos facturables ni elegir un proveedor cloud en nombre del propietario.

## Inventario comprobado

Consulta productiva de metadatos y cantidades agregadas, sin exportar filas de clientes. Supabase CLI 2.120.0; código base `87469debbd3b7d7318178ef1d93c7a27bd369a89`.

| Recurso | Resultado | Alcance de la observación |
| --- | --- | --- |
| Backups físicos listados | `backups: null`, `physical_backup_data: {}` | No hay una copia enumerada para seleccionar. No demuestra ausencia de backups lógicos o externos. |
| PITR | Desactivado | No se verificó recuperación a un instante. |
| WAL-G | Indicador `walg_enabled: true` | No prueba un backup disponible, antigüedad, retención ni recuperabilidad. |
| Base | PostgreSQL 17.6; 13.962.387 bytes al consultar | Tamaño observado, no tamaño de un dump ni estimación de costo. |
| Aplicación | 12 tablas públicas, todas con RLS | Incluye movimientos, cuotas, cola, borradores, vínculos y configuración. |
| Auth | 4 usuarios; `on_auth_user_created` llama a `public.bootstrap_user` | Restaurar solo `public` no recuperaría las cuentas ni toda su integración. |
| Storage | 0 buckets y 0 objetos | Estado puntual. Los bytes de futuros archivos requieren un respaldo adicional. |
| Migraciones | 001–019 registradas | El historial remoto debe conservarse además del Git. |
| Extensiones | plpgsql, pgcrypto, uuid-ossp, pg_stat_statements, supabase_vault | Vault tiene cero entradas al consultar; no se leyeron valores. Volver a verificar su uso antes de cada recuperación. |
| Programación SQL | pg_cron no instalado | No prueba ausencia de cron o jobs externos. |
| Realtime | app_settings, budgets, transactions, whatsapp_links | Conservar o reactivar las publicaciones en el destino de recuperación. |
| Secretos Edge requeridos | Los cinco nombres usados por el webhook figuran configurados | No se recuperaron sus valores ni se acreditó que el propietario conserve una copia o pueda rotarlos. |
| Automatización en el repositorio | Solo `deploy-pages.yml` | No hay workflow de backup declarado. No prueba ausencia de automatizaciones externas. |
| Motor local | Docker Desktop detenido; backend reporta `hasNoVirtualization: true` | La aplicación se inició, pero el motor no quedó disponible. No se cambió BIOS, WSL ni configuración del hipervisor. |

El diagnóstico de Windows muestra hipervisor y virtualización de firmware presentes; no se concluye que la virtualización esté desactivada en BIOS. El impedimento concreto comprobado es que Docker no dispone de un motor operativo en este entorno.

La consulta repetible está en [inventory-recovery.sql](../../scripts/ops/inventory-recovery.sql). La evidencia sin contenido de clientes está en [INF_08_2026-10-14.json](evidencias/INF_08_2026-10-14.json).

Para repetir únicamente el inventario con una CLI autenticada desde la raíz del proyecto (no genera un backup ni modifica datos):

```powershell
supabase backups list --project-ref ystyatotldslfmucvgsq --output json --agent yes
supabase db query --linked --project-ref ystyatotldslfmucvgsq --file scripts/ops/inventory-recovery.sql --output json --agent yes
```

## Cobertura necesaria

| Recurso | Respaldo y recuperación requeridos |
| --- | --- |
| Datos de aplicación | Tablas públicas completas, cuotas y referencias, borradores, cola y deduplicación. No omitir pendientes ni eventos sin evaluar su función en la recuperación. |
| Identidad | Datos de Auth, configuración de proveedores y correo, URLs y trigger propio `on_auth_user_created`. Distinguir datos SQL de configuración del servicio. Probar inicio de sesión después del restore. |
| Esquema y seguridad | Roles, funciones, triggers, políticas RLS, privilegios, constraints, índices, extensiones y publicaciones Realtime. Mantener los controles de 017–019. |
| Historial de migraciones | Esquema y datos de `supabase_migrations`; restaurar un backup no implica volver a ejecutar todas las migraciones. |
| Storage | Metadatos SQL más objetos binarios si los hubiera; verificar cantidades y hashes por separado. Hoy el inventario es cero. |
| Web y Edge Function | Git remoto y commit de recuperación; registrar versión Edge y su correspondencia con el código. La recuperación de la base no despliega el webhook. |
| Secretos y claves | Custodia separada en gestor de secretos: GEMINI_API_KEY, META_APP_SECRET, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_VERIFY_TOKEN, además de credenciales de plataforma. Se confirmó presencia de esos nombres, no recuperación de valores. No registrar sus valores en Git, logs ni en esta guía. Verificar acceso o procedimiento de rotación. |
| Vault/cifrado de columnas | Verificar uso. Si existe, conservar o transferir la clave raíz por el procedimiento oficial; copiar ciphertext a otro proyecto no basta. |
| Servicios externos | Configuración de Meta y servicios de IA, sus cuotas y acceso administrativo. Un dump no recupera el historial que solo exista en WhatsApp ni todas las credenciales externas. |

## Alternativas concretas para decidir

### A. PITR administrado en Supabase y copia externa adicional

Es la opción propuesta si la prioridad es reducir la pérdida y la operación del archivado. Requiere plan de pago compatible, add-on PITR y al menos compute Small. La documentación permite restauración con granularidad de segundos, pero hay que comprobar el punto recuperable real y ensayar el procedimiento; no prometer cero pérdida.

Precios públicos consultados el 14/10/2026: Pro desde USD 25/mes, Small USD 15/mes con USD 10 de crédito de compute incluido en planes de pago; PITR de siete días aproximadamente USD 100/mes. Para un único proyecto con ese esquema, estimación de referencia **aproximadamente USD 130/mes**, antes de impuestos, extras y almacenamiento externo. No es una cotización del proyecto ni se comprobó su plan actual. Revisar el total en la consola antes de contratar.

Los backups del mismo proyecto no sustituyen una copia externa: la documentación advierte que eliminar el proyecto también elimina sus backups asociados. La copia externa y sus claves deben sobrevivir a la pérdida de esa cuenta o proyecto.

### B. Copias lógicas cifradas a almacenamiento externo

Elegir un bucket privado fuera del proyecto productivo, con versionado/retención y cifrado del lado del proveedor; cifrar también antes de subir. El job debe correr en cloud independientemente de esta PC. La credencial de backup tendrá solo los permisos necesarios de lectura de origen y escritura en el prefijo de destino; la clave de descifrado se custodiará separada del job y del bucket.

Propuesta de retención a aprobar: copias cada 30 minutos durante 48 horas y una diaria durante 30 días; medir tamaño, transferencia y costo antes de activarla. No configurar borrado automático hasta verificar retención y recuperabilidad. Vigilar antigüedad del snapshot, fallos y expiración de credenciales desde un sistema independiente.

GitHub Actions puede alojar automatizaciones, pero un cron susceptible a retrasos o ejecuciones omitidas no constituye una garantía de RPO de una hora. No usar un artifact temporal de CI como única estrategia de recuperación ni subir dumps sin cifrar a GitHub.

Pendiente elegir proveedor, región, cuenta propietaria, presupuesto, identidad de acceso y custodia de claves. No se creó bucket, job, secreto ni contratación.

## Procedimiento de backup lógico

Estos pasos son una especificación pendiente de ensayo, **no comandos ya ejecutados ni un backup existente**.

1. Preparar un runner privado con versiones fijadas de CLI/PostgreSQL y conexión SQL con TLS verificado. Usar conexión directa o pooler de sesión compatible; no incluir contraseñas en argumentos visibles ni logs. La clave publishable y la service_role de la API no sustituyen un dump de la base.
2. Crear un directorio temporal privado, fuera del repositorio, OneDrive y carpetas compartidas. Usar disco efímero/cifrado. No producir dumps sin cifrar en rutas sincronizadas.
3. Siguiendo el procedimiento oficial de Supabase, exportar roles, esquema y datos; conservar aparte `supabase_migrations` y las personalizaciones de `auth`/`storage`. Confirmar que el trigger de alta y las políticas están incluidos. Exportar los objetos de Storage si el inventario dejó de ser cero.
4. Para demostrar consistencia, capturar datos y manifiesto bajo el mismo snapshot transaccional o implementar un mecanismo equivalente y probarlo. Dumps separados y agregados de producción tomados en otro momento no demuestran igualdad de un backup mientras continúan las escrituras. Evitar despliegues de esquema durante la captura y no bloquear escrituras sin un procedimiento aprobado.
5. Generar manifiesto privado con instante del snapshot, versiones, alcance, checksums, cantidades por tabla y estado de cada exportación. Un fallo de cualquier componente invalida el conjunto; no publicar un marcador de éxito parcial.
6. Cifrar el conjunto con una herramienta mantenida de cifrado autenticado; clave privada fuera del runner. Calcular checksum del artefacto cifrado, subirlo al destino privado y verificar su lectura y descifrado en el entorno de ensayo. El upload exitoso por sí solo no valida una restauración.
7. Registrar únicamente estados, tiempos, bytes y códigos seguros. Publicar el marcador de copia recuperable después de completar todas las verificaciones previstas. Retirar los temporales; en discos efímeros, destruir el volumen conforme al proveedor. Borrar un archivo no garantiza borrado seguro en SSD.

## Ensayo de restauración aislada

1. Elegir un entorno Supabase de prueba compatible o un entorno local completo con motor operativo. Debe ser distinto de producción y comprobarse su identidad **antes de cualquier escritura**. No confiar solo en que una URL diga localhost: podría existir un túnel a producción.
2. Bloquear tráfico de salida a Meta/Gemini y correo; no instalar tokens productivos ni habilitar workers, cron o webhooks de producción. No reenviar colas restauradas a proveedores. Controlar esto antes de cargar datos.
3. Descargar una copia real del cloud, verificar integridad y descifrar con la clave de recuperación independiente. Medir por separado preparación, descarga, descifrado, carga, verificaciones y total.
4. Restaurar según el procedimiento oficial, en orden compatible con roles, esquema, datos e historial, con parada ante el primer error. Desactivar triggers durante la carga de datos según el procedimiento de Supabase para evitar altas/efectos duplicados; volver a su estado previsto antes de verificar. No aplicar automáticamente migraciones históricas ya incluidas.
5. Conservar el snapshot recuperado antes de realizar pruebas funcionales. Comparar cantidades y checksums de todas las tablas con el manifiesto correspondiente al **mismo snapshot**. Comprobar constraints validados, relaciones entre propietarios, importes en centavos, monedas, cuotas, usuarios y configuración.
6. Verificar RLS y privilegios de 017–019 con cuentas sintéticas: rechazos anónimos, aislamiento de dos usuarios, backend legítimo. Probar Auth y las funciones sin llamar a WhatsApp real. Registrar solo agregados sin textos, teléfonos, códigos ni credenciales.
7. Comprobar qué hacer con mensajes y respuestas ya entregados después del punto recuperado. INF-03/INF-04 todavía están pendientes: restaurar una cola antigua puede repetir efectos si se habilita directamente. No atribuir a INF-08 la solución de esa idempotencia ni activar el worker durante el ensayo.
8. Medir RPO observado y RTO real; documentar fallos y repetir hasta obtener una restauración válida. Luego retirar únicamente los recursos de ensayo identificados y temporales privados según la política acordada, sin borrar evidencias ni copias vigentes.

## Recuperación ante incidente real

Declarar incidente, designar operador y pausar recepción/procesamiento antes de cambiar el servicio. Preservar estado actual cuando sea posible, elegir un punto verificable y recuperar primero en un destino aislado. Validar datos, permisos e integraciones; decidir reconciliación de mensajes desde el snapshot hasta el incidente antes de activar el bot. Coordinar configuración y cambio de destino con INF-10; no restaurar ni redirigir producción como parte del ensayo.

## Criterios pendientes para cerrar INF-08

- [x] Inventario productivo de solo lectura y límites documentados.
- [x] RPO máximo de una hora y preferencia de cloud indicados por el propietario.
- [ ] Proveedor, presupuesto, responsables, retención, RTO y custodia de claves acordados.
- [ ] Copias cloud cifradas y programación independiente operativas; accesos comprobados.
- [ ] Recuperación de secretos/Vault/configuración externa cubierta según su uso efectivo.
- [ ] Descarga, descifrado y restauración de una copia real aprobados en un entorno aislado.
- [ ] Integridad, permisos, RPO y tiempos de recuperación medidos y registrados.
- [ ] Alertas de falta de copias y runbook ejercitados; reconciliación de cola documentada.

No se exportaron datos de clientes, no se restauró ninguna base, no se modificó producción y no se contrató un servicio. Docker Desktop se intentó iniciar para el ensayo; el motor no quedó operativo. Esto es avance de inventario y preparación, no cierre de INF-08.

## Fuentes oficiales consultadas

- [Supabase: Database Backups](https://supabase.com/docs/guides/platform/backups): cobertura, retención, PITR y exclusión de objetos de Storage.
- [Supabase: Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore): roles/esquema/datos, Auth, historial, triggers y claves.
- [Supabase: Pricing](https://supabase.com/pricing): plan, compute y estimación económica, sujetos a revisión antes de contratar.
- [GitHub: Troubleshooting workflows](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows): retrasos y posibles omisiones de ejecuciones programadas.
