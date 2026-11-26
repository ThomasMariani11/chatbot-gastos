# Guía de incidentes (OPS-05)

Tarea 2.5 del plan de remediación. Creada el 26/11/2026 a partir de los procedimientos vigentes de `DEPLOY_Y_ROLLBACK.md`, `MONITOREO_Y_RETENCION.md` y `COSTOS_Y_CUPOS.md`. Esta guía **no autoriza** ninguna acción en producción: cada paso que cambia algo necesita la autorización del propietario para esa acción concreta.

## Principios

1. **Contener antes de arreglar.** Usar el interruptor más chico que frene el daño (ver "Interruptores"), no el más grande.
2. **No borrar para "limpiar".** No eliminar mensajes, trabajos, movimientos ni filas de la cola para que un conteo quede en cero. No usar `db reset --linked`, migraciones down ni `config push`.
3. **No reenviar ni reproducir.** No reenviar respuestas entregadas, ni reintentar entregas inciertas, ni reprocesar audios o fotos de clientes.
4. **Sin datos reales fuera de producción.** No copiar conversaciones, teléfonos, comprobantes ni movimientos a issues, chats, capturas o logs. Describir el incidente con conteos, horas y códigos.
5. **Registrar todo** (plantilla al final), incluso lo que no se pudo verificar.

## 1. Primeros cinco minutos

1. **¿Qué componente falla?** PWA (Pages), bot (Edge Function `whatsapp-webhook`), base (Supabase), o un proveedor (Meta, Groq, Gemini).
2. **Mirar el panel:** Panel Admin → **Bot** (cola, en proceso, para revisar, alertas, cupo de IA). Las alertas y sus umbrales están en `MONITOREO_Y_RETENCION.md` → "Señales y respuesta".
3. **Leer el estado** (solo lectura, sin payloads ni secretos):

   ```powershell
   npx --yes supabase@2.120.0 functions list --project-ref ystyatotldslfmucvgsq -o json
   ```

   ```sql
   select max(version) from supabase_migrations.schema_migrations;
   select enabled from public.whatsapp_queue_control where singleton;
   select queue_version, status, count(*) from public.whatsapp_message_queue group by 1, 2;
   select count(*) as leases_activos from public.whatsapp_user_leases where lease_until > clock_timestamp();
   select jobname, active, schedule from cron.job order by jobname;
   ```

4. **Versión publicada de la PWA:** `https://thomasmariani11.github.io/chatbot-gastos/version.json`.
5. **Smoke del bot:** un POST vacío sin firma a `/`, `/worker` y `/client-push` debe dar **401**. Otro código indica que el bot no está sano o que perdió sus secretos.

## 2. Interruptores, del más chico al más grande

| Interruptor | Cómo | Efecto | Cómo se vuelve |
| --- | --- | --- | --- |
| **Pausar la IA** de un carril | `update public.ai_quota_policy set enabled = false where lane = 'qwen'` (o `'whisper'`) | La reserva devuelve `provider_disabled`: el bot no llama a la IA y pide escribir el gasto. Textos simples, comandos y confirmaciones siguen funcionando. Queda registrada una incidencia de configuración. | `enabled = true` |
| **Bajar los límites de IA** | Panel Admin → **Bot** → Cupo diario de IA → "Editar límites" (con MFA) | Recorta el gasto de IA global o por cliente sin cortar el servicio. | Volver a los valores anteriores |
| **Respuestas a clientes en pausa** (mantenimiento) | Panel Admin → **Bot** → "Respuestas a clientes" | `system_config.bot_active = 'false'`: el bot responde a los clientes "El bot está en mantenimiento por un rato 🛠️" y **no procesa** esos mensajes (no se retoman después: el cliente tiene que volver a mandarlos). El administrador sigue atendido. | Volver a habilitar desde el mismo botón |
| **Apagar la recepción** (último recurso) | `update public.whatsapp_queue_control set enabled = false where singleton` | El webhook responde **503** y Meta reintenta durante un tiempo limitado. Mantener la ventana lo más corta posible: si se pasa del plazo de reintentos de Meta, esos mensajes se pierden. Registrar el valor previo. | `enabled = true` y comprobar que la cola avanza |

Los límites por número (SEC-06: 5/min y 30/24 h para no vinculados, 20/min para vinculados) ya frenan ráfagas desde un mismo número sin intervención.

## 3. Escenarios

### El bot no responde o la cola se demora

1. Smoke 401 y versión del bot (sección 1).
2. Cron `pesito-whatsapp-queue-recovery` activo y con ejecuciones recientes exitosas (`cron.job_run_details`).
3. Cola habilitada; trabajos `pending`/`processing` con muchos intentos; leases vencidos.
4. Proveedor caído (Meta o Groq): esperar y comprobar; no tocar la cola. Si la IA es la que falla, el bot ya cae a "escribime el gasto".
5. Si una publicación reciente es la causa: rollback del bot (abajo).

### Uso anormal de IA o costo que sube

1. Panel → Cupo diario de IA: uso global y top 5 por cliente.
2. Un cliente concreto: bajar el límite por cliente desde el panel.
3. Todos: bajar el global o pausar el carril (sección 2).
4. Con IA paga, revisar además el consumo en la consola del proveedor.

### Ráfaga o spam desde muchos números

1. Los límites por número cubren un remitente. Con muchos remitentes distintos, la cola y `whatsapp_worker_state` crecen.
2. Contener con "Respuestas a clientes en pausa" si las respuestas salientes cuestan, o como último recurso apagar la recepción por una ventana corta.
3. Revisar en Meta si corresponde bloquear o reportar los números.

### Filtración o sospecha de filtración de una credencial

No imprimir valores en la terminal, chats ni archivos versionados. Cada rotación se hace con autorización del propietario.

| Credencial | Dónde vive | Cómo rotar |
| --- | --- | --- |
| `WHATSAPP_WORKER_SECRET` | Secreto de la Edge Function **y** Vault `whatsapp_worker_secret` | Generar uno nuevo localmente y cargarlo **en los dos lugares en el mismo paso**, lejos del minuto 7 (cron de push). Verificar `/worker` y `/client-push` sin secreto → 401 y una llamada desde la base con el secreto de Vault → 200. Así se rotó el 25/11/2026. |
| `WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Meta (app y número) y secretos de la Edge Function | Regenerar en Meta, actualizar el secreto con `npx --yes supabase@2.120.0 secrets set … --project-ref ystyatotldslfmucvgsq` y repetir el smoke. Un `META_APP_SECRET` desfasado hace que la firma HMAC falle y el webhook rechace todo. |
| `GROQ_API_KEY`, `GEMINI_API_KEY` | Consola del proveedor y secretos de la Edge Function | Revocar en el proveedor, crear una nueva y actualizar el secreto. Mientras tanto la IA falla y el bot pide texto. |
| Claves secretas de Supabase (`SUPABASE_SECRET_KEYS`, service_role) | Dashboard de Supabase → API keys; secreto de la Edge Function | Rotar en el dashboard y actualizar el secreto. Nunca deben estar en la PWA. |
| Clave privada VAPID | Secreto del backend | Rotar obliga a que cada cliente vuelva a activar las notificaciones: decisión del propietario. |

Después de cualquier rotación: smoke 401, revisar que la cola avance y anotar la hora.

### Cuenta de administrador comprometida o sospechosa

1. Cambiar la contraseña y volver a inscribir el MFA (TOTP).
2. Invalidar las sesiones abiertas de esa cuenta desde la consola de Supabase Auth (confirmar en la consola la opción disponible en ese momento). El botón "Cerrar sesión" de la PWA cierra todas las sesiones de la cuenta, pero solo si lo usa quien la controla.
3. Revisar acciones recientes del administrador: invitaciones creadas, renovaciones confirmadas, cambios de límites y de "Respuestas a clientes".
4. Revisar el MFA del resto de las cuentas del proyecto (GitHub, Supabase, Meta, Groq, Google).

### La PWA publicada quedó rota

Rollback según `DEPLOY_Y_ROLLBACK.md` → "Rollback compatible, conservando datos": PR que revierte el cambio, con todos los controles, y verificar el nuevo SHA en `version.json`. No mover `main` hacia atrás ni hacer force-push.

### El bot publicado quedó roto

Redesplegar la versión anterior compatible desde un checkout del commit correspondiente (mismo comando de deploy, `--no-verify-jwt --use-api`) y repetir el smoke. Antes, leer en `DEPLOY_Y_ROLLBACK.md` el contrato vigente: algunas versiones viejas no son compatibles con el esquema actual (por ejemplo, la 055 exige igualar el límite por cliente al global antes de volver a un bot anterior a v79).

### Una migración causó un problema

No hacer down ni reset. Corregir hacia adelante con una migración nueva, probada en PGlite o en Supabase local aislado. Si hace falta frenar mientras tanto, usar los interruptores.

### Pérdida o corrupción de datos

1. Contener: pausar respuestas o la recepción para que no se agrave.
2. **Hoy no hay backups automáticos del plan** (tarea 2.4, pendiente por decisión del propietario). No improvisar restauraciones sobre producción.
3. Registrar qué se perdió (conteos y rangos de fechas) y decidir con el propietario.

### Exposición de datos de clientes

1. Contener: cortar el acceso (rotar la credencial, revocar sesiones, pausar lo que corresponda).
2. Determinar alcance con conteos (qué tipo de dato, cuántos clientes, desde cuándo), sin copiar los datos.
3. Avisar al propietario de inmediato. La obligación y el plazo para notificar a clientes o a la autoridad (AAIP) son **PENDIENTE DE VERIFICACIÓN LEGAL** (Fase 3.1).

## 4. Volver a la normalidad

1. Revertir los interruptores usados, en orden inverso, y confirmar que la cola avanza.
2. Smoke 401, versión del bot, `version.json`, crons activos.
3. Revisar mensajes en revisión manual por el procedimiento normal; no confirmarlos en nombre del cliente.

## 5. Registro del incidente

Agregar una entrada en `DEPLOY_Y_ROLLBACK.md` (o en un documento propio si es largo), sin datos de clientes:

```text
Fecha y hora (UTC):
Detectado por: panel / aviso / cliente / revisión
Componente: PWA / bot / base / proveedor
Impacto: qué dejó de funcionar, desde cuándo, cuántos clientes (conteo)
Contención: interruptores usados y horas
Causa: (o "no determinada")
Corrección: PR, versión del bot, migración
Verificación: smoke, conteos, prueba del propietario
Pendientes: qué quedó sin verificar
```

## Fuentes

- `docs/operaciones/DEPLOY_Y_ROLLBACK.md`: estado, deploy, rollback y contratos.
- `docs/operaciones/MONITOREO_Y_RETENCION.md`: alertas, avisos y retención.
- `docs/operaciones/COSTOS_Y_CUPOS.md`: cupo de IA.
