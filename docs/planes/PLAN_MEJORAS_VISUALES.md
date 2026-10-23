# Mejoras visuales de Pesito

Origen: pesito-mejoras-visuales-codex.md, leído y priorizado con el propietario el 23/10/2026. Este documento resume el alcance sin copiar datos o importes de capturas privadas. Se trabaja por bloques, con commits pequeños y validación de cada revisión. El plan de infraestructura/backend conserva su seguimiento independiente.

## Reglas

Mantener identidad, voseo, lógica financiera, permisos, datos, endpoints y parámetros de API. Solo presentación y UX. Sin dependencias nuevas. Probar 375 px y 1280 px, foco visible y controles táctiles de al menos 44 px. Antes de publicar, exigir CI y autorización específica para la PR. No probar guardados o eliminaciones contra clientes reales.

## Estado

| Bloque | Alcance | Estado |
| --- | --- | --- |
| 1 | Base transversal: hover, SVG, categorías, botones y legibilidad | Implementada y validada localmente; CI/publicación y aceptación en dispositivo pendientes |
| 2 | Resumen: jerarquía de KPIs, presupuesto vacío, dona, movimientos breves y cuotas | Pendiente |
| 3 | Vistas propias de Movimientos y Cuotas con datos existentes | Pendiente |
| 4 | Ajustes: agrupación, acciones secundarias, instalación y navegación inferior | Pendiente |
| 5 | Admin: contadores compactos, pestañas sticky, tarjetas y acciones | Pendiente |

## Bloque 1 — Implementación

- Hover: 19 reglas sin protección corregidas; las 44 reglas finales con hover quedan bajo (hover: hover) and (pointer: fine). La dona aplica esa misma condición al resaltado con mouse. La selección activa sigue funcionando sin depender del hover.
- SVG: set de línea compartido en src/Icons.tsx; iconos decorativos ocultos al lector de pantalla. Se conservan los nombres accesibles de los controles; ARS/USD dejan de depender de banderas. Se conserva el saludo con mano y no se modifican las plantillas externas de WhatsApp.
- Movimientos: icono por categoría, flecha verde para ingresos y fallback genérico. src/categoryVisuals.ts se usa también en la dona, su leyenda y el detalle: colores estables aunque cambie el orden de categorías, sin tocar nombres guardados, sumas ni agrupación.
- Botones: tokens compartidos en src/ui.css para primario verde con texto oscuro, secundario blanco con borde y destructivo rojo suave. Se centralizan estilos inline de botones y tamaños mínimos; feedback de toque y foco visible. La limpieza de CTAs duplicados y la jerarquía final de cada pantalla se completan en los bloques 2, 4 y 5.
- Textos: mínimo 13 px en las declaraciones CSS y metadatos inline revisados; secundarios más oscuros, controles de entrada legibles y texto repetido de actualización retirado. Se corrige el conflicto por el que tabs/enlaces de acceso heredaban el verde primario. No se promete que esta revisión sea una auditoría completa WCAG.

## Validación del bloque 1

- ESLint, TypeScript/build y 459 pruebas existentes aprobadas. Se conserva el aviso previo de bundle mayor a 500 kB.
- Comparación estática contra 8031263: 160 llamadas/parámetros de Supabase revisados sin diferencias. No se modifican migraciones, backend, tablas ni dependencias.
- Chromium: copias compiladas con componentes reales y API ficticia, con escrituras rechazadas por el mock. Se revisan 375 × 812 y 1280 × 960; acceso, registro, resumen, gráficos, apertura/cancelación de edición, Ajustes, admin y apertura/cancelación de membresía.
- Muestreo de estilos computados: secundarios/control de acceso y registro, Ajustes y admin con texto >=13 px y contraste AA en los estados examinados. Primario #103b2e sobre #20b984: 4,94:1; secundarios #52655b sobre #f5f8f6: 5,83:1; destructivo #a83236 sobre #fff1f1: 6,02:1.
- Controles administrativos examinados >=44 px. Vista móvil sin desbordamiento horizontal observado; selector de mes conserva espacio suficiente.
- Límite: cambiar ancho de viewport no emula una pantalla táctil física. La protección de hover se comprobó estructuralmente en todas las reglas; se requiere aceptación en celular, especialmente Safari/iOS y PWA instalada. No se enviaron mensajes ni se guardaron movimientos de prueba.

## Pendientes explícitos

El total grande dentro de la dona, las fechas/totales de cuotas, el presupuesto vacío, el límite de cinco movimientos y los accesos duplicados se mantienen como trabajo del bloque 2. No se ocultan cambiando importes ni inventando próximos vencimientos. Movimientos/Cuotas todavía comparten el contenido actual hasta el bloque 3. La navegación de Ajustes y la compactación del admin quedan para 4 y 5; no se afirma cumplir todavía tres clientes por pantalla.

La aceptación global exige completar los cinco bloques y probar los flujos que cambian visualmente. Publicar únicamente la revisión autorizada y registrar su commit/CI en la PR correspondiente; la aceptación real en teléfono se registra por separado.
