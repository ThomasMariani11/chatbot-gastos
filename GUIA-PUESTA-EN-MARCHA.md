# Guía de puesta en marcha — Pesito

Seguí las etapas en orden. No publiques claves ni las agregues al repositorio.

## 1. Crear y preparar Supabase

- [ ] Crear un proyecto Free en [Supabase](https://supabase.com/dashboard).
- [ ] Abrir **SQL Editor**, crear una consulta nueva y ejecutar todo el contenido de `supabase/migrations/001_initial.sql`.
- [ ] Confirmar en **Table Editor** que existen `categories`, `budgets`, `transactions`, `whatsapp_links`, `app_settings` e `inbound_events`.
- [ ] En el cuadro **Connect** o en **Settings > API Keys**, copiar:
  - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
  - Publishable key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Secret key → `SUPABASE_SERVICE_ROLE_KEY`
- [ ] En **Authentication > URL Configuration**, configurar:
  - Site URL: `https://chatbot-gastos-pesito.thomi-mariani.chatgpt.site`
  - Redirect URL: `https://chatbot-gastos-pesito.thomi-mariani.chatgpt.site/**`
  - Para desarrollo local, agregar también `http://localhost:3000/**`.

La publishable key puede estar en el navegador porque el acceso se limita con Row Level Security. La secret key sólo debe existir en el servidor.

## 2. Crear la clave de Gemini

- [ ] Entrar en [Google AI Studio](https://aistudio.google.com/apikey).
- [ ] Crear o copiar una API key para Gemini.
- [ ] Guardarla como `GEMINI_API_KEY` exclusivamente en el servidor.

## 3. Crear la aplicación de Meta y el número de prueba

- [ ] Entrar en [Meta for Developers](https://developers.facebook.com/apps/), crear una app y agregar el producto **WhatsApp**.
- [ ] En **WhatsApp > API Setup**, usar primero el número de prueba de Meta.
- [ ] Agregar el celular personal como destinatario de prueba y verificarlo.
- [ ] Copiar el identificador del número → `WHATSAPP_PHONE_NUMBER_ID`.
- [ ] Copiar el token temporal → `WHATSAPP_ACCESS_TOKEN`.
- [ ] En la configuración básica de la app, copiar el App Secret → `META_APP_SECRET`.
- [ ] Inventar un texto aleatorio y largo para `WHATSAPP_VERIFY_TOKEN`; no es una clave que entregue Meta.

El token de prueba es temporal. Después de validar el flujo completo habrá que sustituirlo por una credencial permanente de producción.

## 4. Configurar las variables del sitio

Configurar estas nueve variables en el entorno de producción:

```text
NEXT_PUBLIC_APP_URL=https://chatbot-gastos-pesito.thomi-mariani.chatgpt.site
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
GEMINI_API_KEY=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_VERIFY_TOKEN=...
META_APP_SECRET=...
```

Marcar como secretas todas salvo `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Después de modificarlas hay que volver a desplegar el sitio.

## 5. Hacer público el webhook

El sitio actual está limitado al propietario. Meta no puede verificar un webhook protegido por el acceso de Sites.

- [ ] Cambiar el sitio a público sólo cuando las variables estén configuradas.
- [ ] Mantener los datos protegidos mediante el inicio de sesión de Supabase y las políticas RLS ya incluidas.
- [ ] Comprobar que la URL pública responde antes de configurar Meta.

## 6. Registrar el webhook en Meta

- [ ] En la configuración de WhatsApp/Webhooks, usar como Callback URL:

```text
https://chatbot-gastos-pesito.thomi-mariani.chatgpt.site/api/whatsapp/webhook
```

- [ ] Introducir exactamente el mismo valor de `WHATSAPP_VERIFY_TOKEN`.
- [ ] Completar la verificación.
- [ ] Suscribir el campo `messages`.

## 7. Crear el usuario y vincular WhatsApp

- [ ] Abrir `https://chatbot-gastos-pesito.thomi-mariani.chatgpt.site/login`.
- [ ] Escribir el correo, abrir el enlace mágico recibido y volver a Pesito.
- [ ] Entrar en **Configuración** y seleccionar **Generar código**.
- [ ] Enviar al número de prueba de Meta el mensaje `VINCULAR 123456`, reemplazando los números por el código mostrado.
- [ ] Esperar la respuesta de vinculación exitosa.

## 8. Probar el circuito completo

Probar primero texto y después audio e imagen:

```text
Gasté 18.500 pesos en supermercado hoy
Cobré 900.000 de sueldo
Compré una notebook por 1.200.000 en 12 cuotas
```

- [ ] Revisar la propuesta recibida.
- [ ] Responder `CONFIRMAR` para guardarla o `CANCELAR` para descartarla.
- [ ] Abrir la PWA y comprobar que el movimiento y el gráfico se actualizaron.
- [ ] Cargar el presupuesto mensual desde el panel.
- [ ] Enviar un audio y luego una foto de comprobante, confirmando ambos resultados.

## 9. Pasar a producción

Sólo después de que el número de prueba funcione:

- [ ] Crear una credencial permanente de Meta y reemplazar el token temporal.
- [ ] Evaluar la migración desde el número de prueba al número definitivo.
- [ ] Confirmar con Meta si el número personal puede coexistir con WhatsApp/WhatsApp Business antes de migrarlo.
- [ ] Mantener desactivada la opción **Autorizar mensajes pagos**.
- [ ] Revisar el recordatorio del 29 de septiembre de 2026. Pesito bloqueará respuestas el 30 de septiembre a las 23:50, hora de Buenos Aires, salvo autorización explícita.

## 10. Cloudflare Pages

La versión actual está desplegada en Sites. La migración a Cloudflare debe hacerse como una etapa separada porque el proyecto tiene rutas de servidor para el webhook; no alcanza con publicar solamente los archivos estáticos de React. Primero validá el circuito anterior. Después se adapta el despliegue a Workers/Pages, se cargan las variables y se cambia la URL del webhook y las URLs permitidas de Supabase.
