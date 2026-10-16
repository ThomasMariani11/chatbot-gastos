# Pesito — ChatBot Gastos

PWA de finanzas personales con React, TypeScript, Vite, Recharts y Supabase. La interfaz se publica en GitHub Pages y el webhook privado de WhatsApp se ejecuta como Supabase Edge Function.

## Arquitectura

- GitHub Pages: PWA estática, login, presupuesto, movimientos y gráficos.
- Supabase: autenticación, PostgreSQL, Row Level Security y Edge Function.
- Meta WhatsApp Cloud API: mensajes de texto, audio e imágenes.
- Gemini: extracción y categorización de operaciones.

## Desarrollo

```bash
npm ci
npm run dev
npm test
npm run build
```

La publicación de la PWA se ejecuta automáticamente al enviar cambios a `main`. La guía de configuración y migración está en `GUIA-PUESTA-EN-MARCHA.md`.

Nunca subas `.env.local`, tokens de Meta, la service role de Supabase ni la clave de Gemini.

## Pruebas de permisos SQL

La suite de npm test incluye tests/draft-rpc-permissions.test.ts. Carga las migraciones del dominio y comprueba los permisos de las RPC de borradores en PostgreSQL efímero en memoria con PGlite; no utiliza credenciales ni se conecta a Supabase.

Para ejecutarla por separado: npm test -- tests/draft-rpc-permissions.test.ts, después de npm ci.

El alcance, las limitaciones de la fixture y el procedimiento de publicación pendiente están en [Validación de INF-01 / BE-01](docs/planes/VALIDACION_INF_01_BE_01.md).

## Controles antes de publicar

Usar la versión de Node indicada en `.node-version` y Deno 2.9.6. Los comandos reproducibles son `npm ci`, `npm run lint`, `npm test`, `npm run test:sql` y `npm run build`. Para el webhook: desde `supabase/functions/whatsapp-webhook`, ejecutar `deno cache --frozen index.ts queue_test.ts routing_test.ts`, `deno task check`, `deno task lint` y `deno task test`. Sus pruebas no tienen acceso a la red.

Cada pull request a `main` ejecuta los checks Frontend, Webhook y PostgreSQL. El último usa una base PostgreSQL 17.11 descartable y datos sintéticos para probar concurrencia; nunca se conecta a Supabase. Pages publica exclusivamente desde `main` cuando los tres jobs aprueban. La publicación del webhook y de migraciones sigue siendo un procedimiento separado.

Las reglas, el procedimiento de cambio y la evidencia están en [Validación INF-06](docs/planes/VALIDACION_INF_06.md).
