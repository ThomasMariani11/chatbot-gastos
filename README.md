# Pesito — ChatBot Gastos

PWA de finanzas personales con React, TypeScript, Vite, Recharts y Supabase. La interfaz se publica en GitHub Pages y el webhook privado de WhatsApp se ejecuta como Supabase Edge Function.

## Arquitectura

- GitHub Pages: PWA estática, login, presupuesto, movimientos y gráficos.
- Supabase: autenticación, PostgreSQL, Row Level Security y Edge Function.
- Meta WhatsApp Cloud API: mensajes de texto, audio e imágenes.
- Reglas locales: comandos, consultas y operaciones claras sin IA.
- Groq: Whisper para audio y Qwen para extracción compleja/fotos. Gemini conserva una ruta de configuración si falta Groq; no es respaldo automático ante sus fallos.

## Desarrollo

```bash
npm ci
# Preparar Supabase y .env.local según la guía antes de dev
npm run dev
npm test
npm run build
```

La publicación de la PWA se ejecuta automáticamente al enviar cambios a `main`. La guía de configuración y migración está en `GUIA-PUESTA-EN-MARCHA.md`.

Nunca subas `.env.local`, tokens de Meta, la service role de Supabase ni las claves de Groq/Gemini.

## Pruebas de permisos SQL

La suite de npm test incluye tests/draft-rpc-permissions.test.ts. Carga las migraciones del dominio y comprueba los permisos de las RPC de borradores en PostgreSQL efímero en memoria con PGlite; no utiliza credenciales ni se conecta a Supabase.

Para ejecutarla por separado: npm test -- tests/draft-rpc-permissions.test.ts, después de npm ci.

El alcance, las limitaciones de la fixture y el procedimiento de publicación pendiente están en [Validación de INF-01 / BE-01](docs/planes/VALIDACION_INF_01_BE_01.md).

## Controles antes de publicar

Usar la versión de Node indicada en `.node-version` y Deno 2.9.6. Los comandos reproducibles son `npm ci`, `npm run lint`, `npm test`, `npm run test:sql` y `npm run build`. Para el webhook: desde `supabase/functions/whatsapp-webhook`, ejecutar `deno cache --config deno.ci.json --frozen index.ts queue_test.ts routing_test.ts`, `deno task --config deno.ci.json check`, `deno task --config deno.ci.json lint` y `deno task --config deno.ci.json test`. Sus pruebas no tienen acceso a la red.

Cada pull request a `main` ejecuta Frontend, Webhook, PostgreSQL y Ensayo de release. PostgreSQL usa una base PostgreSQL 17.11 descartable y datos sintéticos para probar concurrencia; nunca se conecta a Supabase. Pages publica exclusivamente desde `main` cuando los cuatro jobs aprueban. La publicación del webhook y de migraciones sigue siendo un procedimiento separado.

Las reglas, el procedimiento de cambio y la evidencia están en [Validación INF-06](docs/planes/VALIDACION_INF_06.md).

## Entornos y recuperación

Desarrollo requiere Supabase local explícito; no hereda producción. Ver [puesta en marcha](GUIA-PUESTA-EN-MARCHA.md) y [deploy/rollback compatible](docs/operaciones/DEPLOY_Y_ROLLBACK.md). El ensayo `npm run test:release` instala desde un checkout limpio, ejecuta smoke y vuelve a una versión compatible con datos ficticios, sin restaurar producción ni enviar mensajes. Herramienta de deploy fijada en .supabase-version; manifiesto de solo lectura con `npm run release:manifest -- production`.

## Costos y cupos de la beta

Objetivo del propietario: USD 0 para cuatro usuarios. [Controles efectivos, cuentas verificadas y límites](docs/operaciones/COSTOS_Y_CUPOS.md). Los planes Free y el número de prueba no equivalen a capacidad ilimitada; los campos antiguos de autorización/corte de app_settings no bloquean costos. No activar planes, emisores o proveedores alternativos sin revisar facturación y autorización.

El contador compartido INF-15 (100 solicitudes complejas/fotos y 200 transcripciones/día; avisos 75%/90%) está preparado, pendiente de publicar 035 + webhook + PWA. Los comandos y textos resueltos localmente no consumen. Ver [contrato, validación y orden de despliegue](docs/planes/VALIDACION_INF_15.md).
