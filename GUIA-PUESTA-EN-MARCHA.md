# Guía de puesta en marcha — Pesito

La aplicación usa GitHub Pages para la PWA y Supabase para autenticación, base de datos y el webhook de WhatsApp. Nunca publiques claves privadas ni las agregues al repositorio.

## 1. Publicar la PWA en GitHub Pages

- Repositorio: `https://github.com/ThomasMariani11/chatbot-gastos`
- URL pública: `https://thomasmariani11.github.io/chatbot-gastos/`
- El workflow `.github/workflows/deploy-pages.yml` compila y publica automáticamente cada cambio enviado a `main`.
- En GitHub, abrir **Settings > Pages** y elegir **GitHub Actions** como origen si todavía no está seleccionado.
- Revisar la pestaña **Actions** hasta que el despliegue figure en verde.

La URL y la publishable key de Supabase que usa el navegador ya están configuradas. Son datos públicos y están protegidos por las políticas RLS. Ninguna clave privada debe agregarse al frontend.

## 2. Configurar las URLs de Supabase Auth

En **Supabase > Authentication > URL Configuration**:

```text
Site URL: https://thomasmariani11.github.io/chatbot-gastos/
Redirect URL: https://thomasmariani11.github.io/chatbot-gastos/**
```

Para desarrollo local se puede agregar también:

```text
http://localhost:5173/**
```

## 3. Preparar la base de datos

- En **Supabase > SQL Editor**, ejecutar `supabase/migrations/001_initial.sql` si aún no se hizo.
- Confirmar que existen `categories`, `budgets`, `transactions`, `whatsapp_links`, `app_settings` e `inbound_events`.
- Mantener activadas las políticas Row Level Security incluidas en la migración.

## 4. Desplegar el webhook en Supabase

Desde una terminal ubicada en la carpeta del proyecto:

```powershell
npx supabase login
npx supabase functions deploy whatsapp-webhook --project-ref ystyatotldslfmucvgsq --no-verify-jwt
```

El webhook público será:

```text
https://ystyatotldslfmucvgsq.supabase.co/functions/v1/whatsapp-webhook
```

## 5. Cargar los secretos del webhook

Configurar en Supabase estos secretos, usando sus valores reales:

```text
GEMINI_API_KEY
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_VERIFY_TOKEN
META_APP_SECRET
```

Se pueden cargar desde **Supabase > Edge Functions > Secrets** o con `npx supabase secrets set`. No se necesitan `SUPABASE_URL` ni `SUPABASE_SERVICE_ROLE_KEY`: Supabase los proporciona automáticamente a la función.

Después de cambiar un token de WhatsApp, actualizar `WHATSAPP_ACCESS_TOKEN` en Supabase. No hace falta volver a publicar la PWA.

## 6. Registrar el webhook en Meta

En la configuración de WhatsApp/Webhooks de Meta:

```text
Callback URL: https://ystyatotldslfmucvgsq.supabase.co/functions/v1/whatsapp-webhook
Verify token: el mismo valor guardado como WHATSAPP_VERIFY_TOKEN
```

- Completar la verificación.
- Suscribir únicamente el campo `messages` para recibir mensajes entrantes.
- El App Secret de Meta debe coincidir con `META_APP_SECRET` para validar la firma de cada evento.

## 7. Entrar y vincular WhatsApp

- Abrir `https://thomasmariani11.github.io/chatbot-gastos/`.
- Escribir el correo y abrir el enlace mágico recibido.
- En **Configuración**, seleccionar **Generar código**.
- Enviar al número de prueba de Meta `VINCULAR 123456`, reemplazando los números por el código mostrado.
- Esperar la respuesta de vinculación exitosa.

## 8. Probar el circuito completo

Probar primero texto y después audio e imagen:

```text
Gasté 18.500 pesos en supermercado hoy
Cobré 900.000 de sueldo
Compré una notebook por 1.200.000 en 12 cuotas
```

- Revisar la propuesta recibida.
- Responder `CONFIRMAR` para guardarla o `CANCELAR` para descartarla.
- Verificar que el movimiento y el gráfico se actualicen automáticamente en la PWA.
- Cargar el presupuesto mensual desde el panel.
- Enviar un audio y una foto de comprobante, confirmando ambos resultados.

## 9. Instalarla en el celular

- Abrir la URL pública en Chrome o Safari.
- Elegir **Agregar a pantalla de inicio** o **Instalar aplicación**.
- Si ya estaba instalada con la URL anterior, eliminar esa instalación e instalar la nueva para evitar que abra el sitio que dejó de existir.

## 10. Seguridad y costos

- La publishable/anon key de Supabase puede estar en el navegador; la service-role key, el token de WhatsApp, Gemini y el App Secret nunca.
- El token de prueba de Meta es temporal. Para producción, reemplazarlo por una credencial permanente.
- Mantener desactivada la opción **Autorizar mensajes pagos**.
- Pesito bloquea las respuestas el 30 de septiembre de 2026 a las 23:50, hora de Buenos Aires, salvo autorización explícita.
- Hay un recordatorio previsto antes del 1 de octubre de 2026 para revisar y desactivar cualquier mensaje de servicio pago.
