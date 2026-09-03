# Pesito — ChatBot Gastos

PWA de finanzas personales con React, TypeScript, Vite, Recharts y Supabase. La interfaz se publica en GitHub Pages y el webhook privado de WhatsApp se ejecuta como Supabase Edge Function.

## Arquitectura

- GitHub Pages: PWA estática, login, presupuesto, movimientos y gráficos.
- Supabase: autenticación, PostgreSQL, Row Level Security y Edge Function.
- Meta WhatsApp Cloud API: mensajes de texto, audio e imágenes.
- Gemini: extracción y categorización de operaciones.

## Desarrollo

```bash
npm install
npm run dev
npm test
npm run build
```

La publicación de la PWA se ejecuta automáticamente al enviar cambios a `main`. La guía de configuración y migración está en `GUIA-PUESTA-EN-MARCHA.md`.

Nunca subas `.env.local`, tokens de Meta, la service role de Supabase ni la clave de Gemini.
