# INF-13 / FE-19 — Política del navegador

Fecha: 23/10/2026. Base: 1eb546b (PR #22). Estado: implementada y validada localmente; pendiente de CI/publicación y aceptación productiva. INF-13 completo permanece abierto por las cabeceras que requieren control del hosting.

## Cambios

- Política CSP única y temprana generada durante build, usando únicamente el destino público ya validado de Supabase y su WSS.
- Scripts propios sin inline/eval; objetos, frames y base externa bloqueados. Se conservan fuentes, estilos React/Recharts, imágenes locales y PWA.
- Política HTML no-referrer.
- Sin cambios de negocio, datos, permisos SQL, claves, modelos de IA, webhook, retención ni backups.

## Resultados

- 459 pruebas Vitest aprobadas (14 nuevas de seguridad). ESLint, TypeScript y build aprobados. Permanece el aviso previo del bundle mayor a 500 kB.
- Build real servido en loopback: pantalla de acceso cargada, Manrope y CSP/referrer presentes, sin errores de consola observados. No se introdujeron credenciales de clientes.
- Copia compilada con componentes reales, sesión y datos ficticios: ingreso, resumen, Recharts, apertura del detalle del gráfico y panel de administrador funcionando bajo la misma política.
- Pruebas negativas aisladas: bloqueados inline/eval/atributo handler y script, fetch, imagen, objeto, frame y base de otro origen. Eventos de violación recibidos para las directivas correspondientes.
- Endpoint local de eco confirma ausencia de Referer; registro y activación de service worker en el alcance de ensayo aprobados.
- Únicos accesos productivos de las pruebas del navegador: health de Auth (HTTP 200) y apertura/cierre WSS de Realtime, con la clave pública ya versionada. Sin leer movimientos ni enviar mensajes; no se usaron service_role/sb_secret. No se probaron login productivo ni eventos de cambios de tablas.
- HTTP de producción antes del cambio: HSTS presente, CSP/referrer en cabecera y meta ausentes, X-Content-Type-Options/X-Frame-Options/Permissions-Policy ausentes.

## Pendientes para cierre

CI de la revisión final; publicación autorizada y comprobación HTTP del HTML/versionado; aceptación autenticada del propietario. Safari/iOS, offline y actualización de una PWA ya instalada no se dan por probados. Las cabeceras exclusivas de HTTP y protección de framing requieren una decisión posterior de hosting/CDN; no se las simula con meta.

[Runbook](../operaciones/SEGURIDAD_NAVEGADOR.md) · [Evidencia](evidencias/INF_13_2026-10-23.json).
