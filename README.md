# Pesito — ChatBot Gastos

PWA personal para registrar gastos e ingresos desde WhatsApp mediante texto, audio o fotos. Gemini interpreta el mensaje, el usuario confirma la propuesta y Supabase conserva únicamente los datos estructurados.

## Incluido

- Dashboard responsive con presupuesto, categorías, movimientos y cuotas.
- Alta manual desde la PWA y autenticación por enlace mágico de Supabase.
- Vinculación segura del número mediante un código temporal.
- Webhook firmado de WhatsApp con idempotencia por `message_id`.
- Extracción multimodal estructurada con Gemini 3.5 Flash.
- Eliminación inmediata de archivos después de procesarlos.
- Corte automático de respuestas desde el 1 de octubre de 2026 salvo autorización explícita.
- Migración PostgreSQL con Row Level Security y categorías iniciales.

## Puesta en marcha

1. Crear un proyecto gratuito en Supabase y ejecutar `supabase/migrations/001_initial.sql` desde el SQL Editor.
2. Copiar `.env.example` a `.env.local` y completar las credenciales.
3. En Meta Developers, configurar el webhook como `https://TU_DOMINIO/api/whatsapp/webhook`, usando el mismo `WHATSAPP_VERIFY_TOKEN`.
4. Suscribir el webhook al campo `messages` y usar primero el número de prueba de Meta.
5. Ejecutar `npm run dev`; entrar a `/login`, acceder por correo y vincular WhatsApp desde `/configuracion`.

## Comandos

- `npm run dev`: desarrollo local.
- `npm test`: pruebas de reglas financieras.
- `npm run build`: compilación de producción.

No se deben subir archivos `.env*`, tokens ni claves de servicio al repositorio.
