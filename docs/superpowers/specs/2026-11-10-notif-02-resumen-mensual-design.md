# NOTIF-02 — Resumen de fin de mes (diseño)

Fecha: 10/11/2026. Estado: **propuesto, pendiente de aprobación del propietario.**

## Para qué

Que el cliente cierre cada mes sabiendo cuánto gastó, cuánto ingresó y cómo le fue con el presupuesto, sin tener que entrar a buscarlo. Sigue la decisión de NOTIF-01 (05/11/2026): avisos por **notificación push** (sin costo) y visibles en el Resumen. WhatsApp sigue descartado para estos avisos (plantillas pagas de Meta).

## Decisiones del propietario (10/11/2026)

1. **Momento:** el **día 1 de cada mes a las 10 (hora argentina)**, resumiendo el mes que terminó.
2. **Push sin montos:** la notificación no muestra importes en la pantalla bloqueada.
   - Título: `📊 Tu resumen de noviembre`
   - Texto: `Tu resumen del mes está listo. Tocá para ver cuánto gastaste y cuánto te quedó.`
3. **En la app, tarjeta de cierre del mes** arriba del Resumen, con gastos, ingresos y balance por moneda, comparación con el mes anterior y cómo terminó el presupuesto. Se puede cerrar.
4. **Interruptor propio en Ajustes, "Resumen del mes", activado por defecto**, independiente de los recordatorios diarios.

## Cómo funciona

### Base de datos — migración 051 (expansiva)

- `app_settings.monthly_summary_enabled boolean not null default true`. La política existente "own settings" ya limita lectura/escritura a la fila propia.
- `client_notifications.kind` acepta `monthly_summary`; `period_key` = mes resumido `YYYY-MM`. La unicidad `(user_id, kind, period_key)` garantiza **uno por mes** aunque el cron corra de más.
- `enqueue_client_notifications` (se redefine completa, conservando los dos bloques actuales sin cambios):
  - Nuevo bloque: si el día argentino es 1 y la hora es 10 u 11 (una hora de margen, igual que los recordatorios), encola `monthly_summary` del mes anterior para cuentas activas (clientes con suscripción vigente o admin, mismo criterio que el registro), con `monthly_summary_enabled`, al menos un dispositivo suscripto y **al menos un movimiento confirmado con fecha en ese mes** (si no registró nada, no hay resumen que mandar).
- `claim_client_notifications`: además de lo actual, omite (`skipped`) un `monthly_summary` pendiente si el cliente apagó el interruptor; y devuelve también `period_key` (agregado compatible: el webhook anterior lo ignora).
- Mismos permisos que 046: `enqueue` sin acceso para clientes; `claim`/`finish` solo `service_role`. Mismo cron `pesito-client-push` (no se crea otro).

### Webhook (`client-push.ts`)

- Nuevo tipo `monthly_summary`: título con el nombre del mes (de `period_key`; si faltara, el mes anterior en hora argentina), texto fijo sin montos, `url: "./#cierre-mes"`, `tag: "pesito-resumen"`.
- Defensa: un tipo desconocido **no se envía** (hoy cualquier tipo desconocido caería en el texto de vencimiento).
- Logs sin montos ni nombres, como hoy.

### PWA

- **Tarjeta "Cerraste noviembre"** arriba del Resumen, del día 1 al 7 del mes siguiente, solo si el interruptor está activado y ese mes tuvo movimientos:
  - Una sección por moneda con movimientos (Pesos y/o Dólares, **sin sumar monedas**): 💸 Gastos, 💰 Ingresos, 📈 Balance.
  - Comparación de gastos con el mes anterior (`▼ 8% vs oct.` / `▲ 12% vs oct.`), solo si ese mes tiene gastos en la misma moneda.
  - Presupuesto (solo pesos, como hoy): `🎯 Te sobraron $ X del presupuesto` o `⚠️ Te pasaste $ X del presupuesto`; sin presupuesto ese mes, no se muestra la línea.
  - Botones **Ver noviembre** (pone el Resumen en ese mes) y **Cerrar** (la oculta hasta el próximo mes; guardado por cuenta y mes en el navegador).
- Al abrir la app desde la notificación (`#cierre-mes`) se muestra el Resumen con la tarjeta visible.
- **Ajustes:** nuevo interruptor "Resumen del mes" junto al de recordatorios, con el mismo comportamiento (si la lectura falla o la 051 no está aplicada, no se muestra).
- Lectura acotada: totales de dos meses y el presupuesto de uno, desde las tablas propias (RLS existente). Sin RPC nueva para clientes.

## Fuera de alcance

- Resumen por WhatsApp (sigue descartado por costos de Meta).
- Montos en la notificación push.
- Cambios en el texto de SALDO del bot o en el Resumen existente.
- Conversión entre monedas.

## Publicación y rollback

- Orden: **webhook → SQL 051 → PWA.** El webhook nuevo funciona con el SQL anterior (nunca recibe `monthly_summary`) y el SQL nuevo con el webhook anterior solo encola los días 1; así ningún webhook viejo recibe el tipo nuevo.
- Contrato de release: mínimo 051; rollback a la publicación vigente conservando 051 (columna y tipo nuevos son expansivos).
- Rollback funcional sin desplegar: el cliente apaga el interruptor; operativamente, revertir PWA/webhook conserva 051.

## Pruebas

- PGlite: encola el día 1 a las 10–11 y no otros días/horas; uno por mes; respeta el interruptor (al encolar y al reclamar); no encola sin movimientos en el mes, sin dispositivo, ni para cuentas vencidas o pausadas; `claim` devuelve `period_key`; permisos sin cambios; los avisos de 046 siguen igual.
- Vitest: texto del push sin montos y con el mes correcto; tipo desconocido no se envía; tarjeta con una o dos monedas, comparación y presupuesto (sobrante, excedido, sin presupuesto); visible solo días 1–7; Cerrar la oculta hasta el próximo mes; interruptor en Ajustes.
- Deno (CI): `client-push` con el tipo nuevo.
- Prueba manual del propietario: el día 1 en el celular (o forzando el encolado en local).

## Decisiones del agente (revisables)

- Margen de una hora (10 y 11 h) por si el cron no corre, igual que los recordatorios.
- Tarjeta visible del 1 al 7.
- Sin movimientos en el mes, no se manda push ni se muestra tarjeta.
- Comparación solo de gastos (no de ingresos), para que la tarjeta sea corta.
