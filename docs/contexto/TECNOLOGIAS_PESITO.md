# Pesito — Tecnologías del proyecto

> Resumen del stack técnico de Pesito (app de finanzas personales con bot de WhatsApp), revisado contra el repositorio el 06/11/2026 (`main` en `6ff63da`).
> Para el contexto completo del producto y las decisiones vigentes, ver `docs/contexto/CONTEXTO_PESITO_PARA_CLAUDE.md`.

El proyecto tiene tres partes: la **app web (PWA)**, el **backend en Supabase** y el **bot de WhatsApp**.

## 1. App web (PWA)

| Tecnología | Versión | Uso |
|---|---|---|
| React | 19.2 | Interfaz: Resumen, Movimientos, Cuotas, Ajustes. |
| TypeScript | 5.9 | Todo el código de `src/`. |
| Vite + `@vitejs/plugin-react` | 8.1 | Desarrollo y build de producción. |
| `@supabase/supabase-js` | 2.x | Cliente de Supabase (Auth, consultas y RPC). |
| Recharts | 3.x | Gráficos del Resumen. |
| Service worker propio (`public/sw.js`) | — | App instalable, caché, aviso de nueva versión y recepción de notificaciones push. |
| Web Push (estándar del navegador) | — | Notificaciones al celular; sin Firebase ni servicios pagos. Clave pública VAPID en `config/environments.json`. |
| CSS propio (`src/styles.css`, `src/summary.css`) | — | Estilos, sin frameworks de CSS. |
| GitHub Pages | — | Hosting de la PWA publicada. |

Archivos clave: `src/App.tsx`, `src/Dashboard.tsx`, `src/Settings.tsx`, `src/environment.ts`, `src/pushNotifications.ts`, `src/PushPrompt.tsx`, `src/ClientNotices.tsx`.

## 2. Backend: Supabase

| Tecnología | Uso |
|---|---|
| PostgreSQL | Base de datos. Migraciones en `supabase/migrations` (001–046 aplicadas en producción). |
| RLS (Row Level Security) | Cada cliente solo accede a sus filas. |
| Funciones SQL (RPC, `SECURITY DEFINER`) | Operaciones sensibles con permisos explícitos (grants/revokes por rol). |
| Supabase Auth | Inicio de sesión y cuentas. |
| pg_cron | Tareas programadas: cola de mensajes, vencimientos y notificaciones push (`pesito-client-push`, minuto 7 de cada hora). |
| Vault | Secretos dentro de la base (p. ej. el secreto con que el cron llama al webhook). |
| `extensions.http` | Llamadas HTTP síncronas desde SQL hacia la Edge Function. |
| Edge Function `whatsapp-webhook` (Deno 2 + TypeScript) | Servidor del bot: recibe mensajes de WhatsApp, cola durable de procesamiento, renovaciones y envío de notificaciones push (ruta `client-push`). Se despliega con `--no-verify-jwt --use-api`. |

Archivos clave: `supabase/functions/whatsapp-webhook/index.ts`, `processor.ts`, `meta-client.ts`, `groq.ts`, `gemini.ts`, `client-push.ts`, `web-push.ts`, `logging.ts`.

## 3. Bot de WhatsApp e IA

| Tecnología | Uso |
|---|---|
| WhatsApp Cloud API (Meta) | Recibir y enviar mensajes. |
| Groq + modelo Qwen | Interpretar mensajes en lenguaje natural ("gasté 5000 en el súper"). |
| Groq + Whisper (`whisper-large-v3-turbo`) | Transcribir audios. |
| Google Gemini (modelos Flash) | Proveedor alternativo de IA cuando Groq no está configurado. |
| Parser determinístico propio | Interpreta mensajes simples sin consumir IA. |

## 4. Pruebas y calidad

| Tecnología | Uso |
|---|---|
| Vitest 4 + jsdom | Tests de la app y del webhook (63 archivos, más de 1200 tests). |
| PGlite | Postgres en memoria para probar migraciones SQL sin base real. |
| ESLint 9 + typescript-eslint | Lint (`npm run lint`). |
| Supabase CLI 2.120 + Docker | Copia local completa de Supabase para ensayos (`npm run local:prepare`, `npm run test:release`). |

Comandos: `npm run lint`, `npm test`, `npm run build`, `npm run test:release:guards`, `npm run test:sql`, `npm run test:concurrency`.

## 5. Publicación y operación

| Tecnología | Uso |
|---|---|
| GitHub | Código, PR y protección de `main`. |
| GitHub Actions (`.github/workflows/deploy-pages.yml`) | CI en cada PR: Frontend, Webhook, PostgreSQL, Ensayo de release. Al mergear a `main`, Publicar en GitHub Pages. |
| Contrato de release (`config/environments.json` + `scripts/`) | Verifica compatibilidad entre la PWA publicada y las migraciones aplicadas, y define el rollback. |

Runbook: `docs/operaciones/DEPLOY_Y_ROLLBACK.md`.

## 6. Costos

Casi todo es gratuito o tiene capa gratuita. Costo potencial: APIs de IA (Groq/Gemini) según uso y mensajes de WhatsApp de Meta. Por eso los avisos a clientes van por Web Push y no por WhatsApp.

## 7. Reglas para trabajar en el repo

- Mantener actualizado `docs/contexto/CONTEXTO_PESITO_PARA_CLAUDE.md` con cada cambio y distinguir: rama, `main`, publicado, migración aplicada y webhook desplegado.
- No incluir claves, tokens, contraseñas, teléfonos, conversaciones, comprobantes ni movimientos reales de clientes. Usar ejemplos ficticios.
- No inventar verificaciones: informar solo lo que se ejecutó.
- No ejecutar `db reset --linked` ni migraciones down; no tocar la cola ni los jobs históricos v1 pendientes; no hacer `config push`.
- Acciones en producción solo con autorización del propietario.
