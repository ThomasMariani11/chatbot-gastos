# INF-13 / FE-19 — Política del navegador

Revalidación: 26/10/2026 (Argentina). CSP/no-referrer publicadas desde PR #23; producción comprobada 0d2d56101ff6de2f8dc857c173550f524d5b0770. **FE-19 terminado en el alcance de compatibilidad verificado. INF-13 parcial: cabeceras HTTP y protección de framing pendientes de una decisión de hosting.** Esta revisión no publica una política nueva ni cambia datos, facturación o proveedor.

## Evidencia productiva actual

- HTTP 200: una sola CSP en meta, después de charset y antes de recursos; coincidencia con la política generada por src/browser-security.ts. default-src none, scripts propios sin inline/eval, conexiones limitadas al proyecto Supabase/WSS, objetos/base/frames/media denegados. Meta no-referrer presente.
- HTML, bundle JavaScript con MIME correcto, version.json y SW corresponden a la versión publicada. HSTS presente. CSP/Referrer-Policy HTTP, X-Content-Type-Options, X-Frame-Options y Permissions-Policy ausentes: no se confunden las metas con headers.
- Navegador integrado Chromium, sesión existente del propietario: Resumen cargó con gráficos; se abrió/cerró el detalle; fuente Manrope cargada. Se utilizó Actualizar con pantalla limpia, recargó y conservó sesión. Se abrió Administración y la sección Bot cargó. Cero errores de consola o violaciones CSP durante ese recorrido. No se modificaron formularios, clientes ni movimientos y no se enviaron WhatsApps.
- Auth health HTTP 200 y apertura/cierre WebSocket Realtime con clave pública, sin suscribirse a datos de clientes. La sesión autenticada que carga la app es evidencia distinta de ese health. No se probó un inicio de sesión nuevo ni se fabricó un cambio de tabla para generar eventos.
- 14 pruebas unitarias existentes de política/build y pruebas negativas aisladas del 23/10 siguen vigentes. En esa copia se bloquearon inline/eval/handler y script/fetch/imagen/objeto/frame/base externos; eco local verificó ausencia de Referer. No se ejecutaron inyecciones sobre la sesión financiera real.
- Aceptación física relacionada: el propietario confirmó el 25/10 actualización protegida, conservación del borrador, descarte y sesión retenida desde el ícono instalado de Pesito en iPhone. Fuente: VALIDACION_FE_07_12.md. No equivale a ejecutar todas las pruebas negativas de CSP en Safari/iOS ni a prueba offline.

## Qué se cierra y qué queda

FE-19: política efectivamente publicada y compatible con sesión existente, gráficos, fuentes, administrador y flujo de actualización; transportes Auth/Realtime accesibles. Se cierra esa tarea dentro del alcance probado. Safari en pestaña, todos los modelos/versiones de iOS, offline, nuevo login y eventos reales de tablas no se dan por cubiertos universalmente.

INF-13: falta protección contra incrustación desde otro sitio y headers exclusivos de HTTP. La CSP en meta no puede aplicar frame-ancestors, sandbox, report-uri ni Report-Only; frame-src none solo restringe frames que la app cargue. No añadir metas ficticias, archivos _headers ignorados por Pages ni JavaScript de frame-busting como supuesto cierre.

El hosting estático actual de Pages no expone en esta configuración una regla de respuesta para esos headers. Resolverlo requiere evaluar un hosting/CDN con control HTTP y costo $0, preparar primero un entorno de vista previa y verificar Auth/redirects, base de assets, alcance/cache de PWA, vínculos WhatsApp y rollback. Cambiar de URL puede requerir reinstalar la PWA. Esa migración no se ejecuta ni se presume autorizada en esta revisión; mantener la deuda visible sin detener el resto del plan.

## Repetición y trazabilidad

Después de cada publicación comprobar HTML/CSP/versionado y hacer el recorrido de lectura; mantener los tests de build. No relajar connect-src/script-src para resolver un fallo de desarrollo. Una violación nueva se investiga por directiva y recurso concreto, sin imprimir tokens o datos de clientes.

[Evidencia productiva saneada](evidencias/INF_13_FE_19_2026-10-26.json) · [Evidencia histórica aislada](evidencias/INF_13_2026-10-23.json) · [Runbook](../operaciones/SEGURIDAD_NAVEGADOR.md) · [W3C: CSP en meta](https://w3c.github.io/webappsec-csp/#meta-element).
