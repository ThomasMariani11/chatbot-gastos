# Puesta en marcha de Pesito

Esta guía reemplaza el procedimiento antiguo que ejecutaba únicamente 001. La instalación necesita **todas las migraciones 001–025, en orden**. Consultar el historial real antes de publicar; no volver a ejecutar las ya registradas.

## Entornos y herramientas

- Producción: GitHub Pages, Supabase `ystyatotldslfmucvgsq`, Meta y Gemini. Configuración pública en [config/environments.json](config/environments.json); secretos exclusivamente en Supabase/Vault.
- Desarrollo/ensayo: Supabase en Docker y PWA en loopback, datos ficticios, sin credenciales de Meta/Gemini. [Configuración local](ops/local/config.toml).
- No existe un staging alojado independiente. El ensayo local en CI no contrata servicios ni requiere facturación.
- Node: [.node-version](.node-version); Deno **2.9.6**; Supabase CLI: [.supabase-version](.supabase-version), **2.120.0**. Usar `npx --yes supabase@2.120.0` en los ejemplos siguientes. Docker con motor Linux funcional es requisito del stack local. npm ci respeta package-lock.json.

El servidor Vite y el build validan el destino antes de arrancar. Desarrollo no hereda producción. Solo admite HTTP loopback y clave pública; rechaza service role. El build normal de producción mantiene los valores públicos actuales. No poner secretos en variables VITE_: se incorporan al navegador.

## Desarrollo aislado

Desde un checkout limpio del repositorio:

```powershell
npm ci
npm run local:prepare
npx --yes supabase@2.120.0 --workdir .temp/local start --exclude studio,imgproxy,storage-api,logflare,vector,supavisor
npx --yes supabase@2.120.0 --workdir .temp/local status
```

El preparador crea un workdir nuevo; se detiene si ya existe, para no pisar datos locales. Copia las migraciones originales sin editarlas. Añade únicamente en ese workdir una migración local que desprograma la recuperación y bloquea cualquier despacho HTTP externo. La cola queda deshabilitada y no se cargan secretos reales.

Crear `.env.local` (ignorado por Git) con la URL y **anon key local** que devuelve status:

```dotenv
VITE_APP_ENV=local
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=REEMPLAZAR_POR_ANON_KEY_LOCAL
```

Luego `npm run dev`; abrir `http://127.0.0.1:5173/chatbot-gastos/`. No copiar service role, DB_PASSWORD ni claves de producción. status muestra credenciales locales: no pegar su salida en chats, issues ni logs. Para parar conservando la base: `npx --yes supabase@2.120.0 --workdir .temp/local stop`.

Esta instalación está pensada para base **vacía**. 005 promueve usuarios preexistentes a admin; BE-13 sigue pendiente. No ejecutar 005 sobre cuentas existentes ni crear usuarios hasta terminar las migraciones. El administrador de una nueva instalación debe seleccionarse explícitamente por UUID aprobado, con procedimiento revisado; no usar la promoción masiva de 005 como herramienta administrativa.

Auth local usa localhost/loopback, sin cambiar los redirects de producción. Para cuentas sintéticas generar una invitación local y registrar el usuario con ella; comprobar perfil, suscripción y categorías, dado el comportamiento pendiente de BE-13. El correo de desarrollo se recibe en Mailpit local, puerto 54324.

No usar `db reset --linked`, no copiar datos de clientes y no enlazar .temp/local a un proyecto remoto. Si cambian migraciones, preparar otro workdir o reconstruir solo la base descartable después de detenerla e identificarla; no reutilizar el config de producción.

## Validación repetible desde checkout limpio

```powershell
npm ci
npm run lint
npm test
npm run test:sql
npm run test:release:guards
npm run build
npm run release:manifest -- local
npm run test:release
```

La última prueba requiere Docker y Git con el commit de rollback disponible (en CI checkout usa fetch-depth 0). Rechaza un árbol sucio, un stack pesito-rehearsal existente, un motor Docker remoto y cualquier URL remota. Verifica las versiones de Node/CLI y registra PostgreSQL/Docker observados. Extrae candidato y versión anterior con git archive, instala Supabase local con todas las migraciones, verifica Auth/perfil/categorías y RPC privadas, sirve y compila PWA/webhook, y vuelve a la versión anterior conservando un movimiento sintético. Cambia SW y version.json juntos.

Usa secretos aleatorios de prueba, valida firma Meta y secreto del worker con payloads vacíos; no envía mensajes ni interpreta comprobantes. No prueba entregas reales, el cron alojado, MFA del proveedor ni sincronización de PWA en teléfonos (FE-07 sigue abierto). Las pruebas de negocio/concurrencia complementan este smoke test.

La evidencia saneada queda en .temp/release-rehearsal.json; CI publica solo ese archivo durante siete días. Nunca subir status, synthetic.env ni el workdir. El stack se detiene en finally con --no-backup; si falla la limpieza, corregirla antes de repetir. Los directorios temporales son privados y descartables; pueden borrarse tras identificar y detener ese stack, nunca con una ruta calculada sin verificar.

## Publicar o recuperar

Seguir [el runbook de deploy y rollback](docs/operaciones/DEPLOY_Y_ROLLBACK.md). Cada componente tiene su propia publicación:

1. Migraciones compatibles y verificación de historial/permisos.
2. Webhook, smoke sin mensajes y registro de versión Edge.
3. PR con los checks aprobados, merge a main y publicación de Pages.
4. Activación de cola únicamente si estaba deshabilitada por el cambio, revisión funcional y registro de versiones.

GitHub Pages: `https://thomasmariani11.github.io/chatbot-gastos/`. Auth productivo mantiene Site URL igual y redirect `https://thomasmariani11.github.io/chatbot-gastos/**`. No agregar localhost a producción para realizar estas pruebas.

Los secretos del bot son GROQ_API_KEY, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, META_APP_SECRET y WHATSAPP_WORKER_SECRET. GEMINI_API_KEY corresponde a una ruta alternativa de configuración: con Groq no vacía se usa Groq y sus fallos no activan Gemini; quitar Groq cambia esa selección y requiere revisar la facturación de Google antes. Supabase inyecta SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. El worker requiere además la misma credencial en Vault bajo whatsapp_worker_secret; no imprimirla, no llevarla a Git ni ponerla en SQL en un log público.

Meta callback: `https://ystyatotldslfmucvgsq.supabase.co/functions/v1/whatsapp-webhook`. Suscribir messages; verify token para GET y App Secret para firma POST. JWT deshabilitado en esta función permite llegar a la verificación HMAC; no significa que los mensajes estén autorizados sin firma.

No se afirma un bloqueo global por la fecha antigua de septiembre ni un recordatorio vigente. Los costos y los mensajes pagos dependen de la configuración efectiva y las políticas de los proveedores (INF-15). paid_service_messages_authorized y cost_guard_date son heredados y no consultados por el webhook: sus valores no acreditan un corte o autorización de facturación. No habilitar complementos, planes ni mensajes pagos por interpretar esos flags. Ver [costos y cupos](docs/operaciones/COSTOS_Y_CUPOS.md) y [evidencia INF-15](docs/planes/VALIDACION_INF_15.md). Los backups continúan postergados al final (INF-08).

El contador compartido INF-15 (100 solicitudes complejas/fotos y 200 transcripciones/día; avisos 75%/90%) está preparado, pendiente de publicar 035 + webhook + PWA. Los comandos y textos resueltos localmente no consumen. Ver [contrato, validación y orden de despliegue](docs/planes/VALIDACION_INF_15.md).
