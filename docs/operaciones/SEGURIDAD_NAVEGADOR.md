# Seguridad del navegador

## Alcance de INF-13 / FE-19

26/10/2026: CSP y política de referencia publicadas desde PR #23 y revalidadas en producción con la sesión del propietario, gráficos/fuentes/administración y actualización. FE-19 terminado en ese alcance. La protección de framing y otras cabeceras exclusivas de HTTP siguen abiertas: INF-13 completo continúa parcial.

La PWA continúa en GitHub Pages, sin proxy, dominio nuevo, facturación ni cambios en Supabase o WhatsApp. La CSP protege el documento del navegador; no reemplaza autorización, RLS, validación de entradas ni la seguridad del webhook.

## Política publicada por el build

src/browser-security.ts construye la política a partir del destino de Supabase que ya validó resolveEnvironment. vite.config.ts la incorpora en index.html inmediatamente después de UTF-8 y antes de scripts, enlaces o estilos. Si el marcador falta, se duplica o queda fuera de head/después de recursos, el build falla. No hay una segunda política que contradiga la primera.

- default-src 'none': denegar recursos sin permiso explícito.
- script-src 'self' y script-src-attr 'none': solo archivos de la propia web; sin scripts inline, atributos onclick ni unsafe-eval.
- connect-src: la propia web, HTTPS del proyecto de Supabase configurado y WSS del mismo proyecto. En un build explícito de ensayo local se usan únicamente sus orígenes HTTP/WS loopback. Sin comodines, permisos a todos los subdominios de Supabase ni conexión directa del navegador a IA/Meta.
- style-src: propia web, fonts.googleapis.com y unsafe-inline. React, los formularios y Recharts usan estilos dinámicos; esta excepción permite CSS inline, nunca JavaScript inline. Eliminarla exige una tarea específica de estilos con pruebas del gráfico y sus medidas.
- font-src: propia web y fonts.gstatic.com. Se conservan las fuentes existentes.
- img-src: propia web y data:, necesarios para recursos locales/representaciones de imagen. No se permiten imágenes arbitrarias de terceros.
- manifest-src y worker-src: propia web, para la PWA. Esto controla carga/registro; no instala una CSP en la respuesta del script del service worker.
- object-src, base-uri, frame-src y media-src: none. La app actual no usa objetos, base HTML, reproductores ni frames.
- form-action 'self': no permitir envíos de formulario a otro origen. Los enlaces habituales a WhatsApp siguen siendo navegación, no solicitudes fetch ni formularios.

index.html incorpora además meta name=referrer content=no-referrer: no enviar Referer en las solicitudes originadas por el documento. Se comprobó mediante un endpoint local de eco. Es una política HTML efectiva, no un header HTTP agregado por GitHub.

La CSP se inyecta únicamente al compilar. Vite de desarrollo conserva HMR; sus excepciones no se copian al build. Las opciones de scripts no se deben relajar para resolver un error de desarrollo.

## Límites del hosting actual

La lectura HTTP de producción del 26/10/2026 devuelve HSTS max-age=31556952, sin Content-Security-Policy, Referrer-Policy, X-Content-Type-Options, X-Frame-Options ni Permissions-Policy en cabeceras. CSP y no-referrer sí están presentes en HTML, antes de recursos. Ver evidencia productiva vinculada.

La configuración actual de GitHub Pages no ofrece control de cabeceras de respuesta. No se agregan archivos _headers, nginx.conf ni meta http-equiv ficticios que el hosting no aplicaría. CSP y no-referrer se entregan por HTML.

Una CSP meta **no admite frame-ancestors, sandbox, report-uri ni el modo Report-Only**. frame-src none bloquea los frames que cargue la app; no impide que otro sitio incruste la app. X-Content-Type-Options y X-Frame-Options tampoco se implementan mediante meta. No se declara prevención completa de clickjacking ni recepción centralizada de violaciones.

Para esas protecciones hace falta un hosting/CDN con cabeceras configurables. Su evaluación queda pendiente y separada; no se cambia de URL ni proveedor en este paso. Antes de mover la web se deben revisar Auth/redirects, enlaces WhatsApp, alcance/caché de PWA y rollback; mantener el requisito de costo cero.

## Validación y publicación

1. npm run lint, npm test y npm run build. Las pruebas validan orígenes, permisos de scripts, recursos compatibles y ubicación única/temprana de la CSP.
2. Inspeccionar dist/index.html: una CSP después de charset y antes del primer link/script; no-referrer presente. Para ensayo local compilar con la configuración local de INF-10, no ejecutar contra datos de clientes.
3. En copia aislada, probar una sesión y finanzas ficticias con componentes reales. Comprobar gráficos, su detalle y administración. Probar scripts inline/eval/handler, script/imagen/objeto/frame/conexión/base externos con recursos inválidos conocidos y sin datos privados: deben bloquearse.
4. Verificar carga de Manrope, registro del service worker y ausencia de Referer mediante eco local. Comprobar Auth health y apertura/cierre de WSS solo con la clave pública del proyecto: no equivalen a un login productivo ni a recepción de cambios de tablas.
5. Exigir los cuatro checks de PR y publicar únicamente con autorización del propietario. Esta tarea no requiere SQL, Edge Function ni claves privadas. Verificar versión, HTML efectivo y assets por HTTP.
6. Aceptación del propietario: abrir sesión, revisar gráficos/administración y volver a la app instalada. Si no se probó Safari/iOS, modo offline o actualización de una instalación existente, registrarlos como pendientes, no como aprobados.

Reversión: volver al frontend anterior a esta política desde una revisión validada, por el pipeline protegido, sin restaurar datos ni alterar el webhook. Una copia antigua del shell puede no recibir la política hasta actualizarse; las futuras publicaciones siguen usando el flujo de PWA existente. FE-07 quedó cerrado para el flujo protegido, incluida la aceptación del propietario desde Pesito instalado en iPhone el 25/10; no se confunde esa aceptación con cobertura universal de Safari/CSP/offline.

## Evidencia y referencias

- [Validación INF-13](../planes/VALIDACION_INF_13.md).
- [Evidencia productiva 26/10](../planes/evidencias/INF_13_FE_19_2026-10-26.json).
- [Evidencia aislada histórica 23/10](../planes/evidencias/INF_13_2026-10-23.json).
- [W3C: CSP en meta y límites](https://w3c.github.io/webappsec-csp/#meta-element).
- [MDN: Referrer-Policy en HTML](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#integration_with_html).
- [GitHub: hosting estático Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).
- [Consulta de la comunidad GitHub sobre cabeceras](https://github.com/orgs/community/discussions/54257) (discusión de usuarios, no garantía contractual del proveedor).
