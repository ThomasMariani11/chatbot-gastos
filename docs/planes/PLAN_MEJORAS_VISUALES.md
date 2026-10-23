# Mejoras visuales de Pesito

Origen: pesito-mejoras-visuales-codex.md, leído y priorizado con el propietario el 23/10/2026. Este documento resume el alcance sin copiar datos o importes de capturas privadas. Se trabaja por bloques, con commits pequeños y validación de cada revisión. El plan de infraestructura/backend conserva su seguimiento independiente.

## Reglas

Mantener identidad, voseo, lógica financiera, permisos, datos, endpoints y parámetros de API. Solo presentación y UX. Sin dependencias nuevas. Probar 375 px y 1280 px, foco visible y controles táctiles de al menos 44 px. Antes de publicar, exigir CI y autorización específica para la PR. No probar guardados o eliminaciones contra clientes reales.

## Estado

| Bloque | Alcance | Estado |
| --- | --- | --- |
| 1 | Base transversal: hover, SVG, categorías, botones y legibilidad | Publicado en PR #24 (98c3dca), CI y verificación web aprobados; aceptación física en dispositivo pendiente |
| 2 | Resumen: jerarquía de KPIs, presupuesto vacío, dona, movimientos breves y cuotas | Implementado y validado localmente; revisión visual, CI y publicación pendientes |
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

## Bloque 2 — Implementación y validación

- Balance primero y a todo el ancho; gastos e ingresos debajo. Se conserva la resta existente y se aclara “Ingresos menos gastos”.
- El encabezado deja solo el mes. Admin e instalación quedan en la sección de herramientas del sidebar; en móvil se accede por Ajustes. Se conserva espacio inferior para el botón flotante y la navegación.
- Presupuesto ARS sin definir: explicación breve y botón para abrir el formulario existente. Con presupuesto, barra verde/ámbar/roja según uso; excedentes expresados como “Superaste el límite en”, sin números negativos engañosos.
- Dona: el importe exacto queda debajo del aro, también en el detalle. Leyenda con cuatro categorías, sin scroll interno; “Ver más” abre el detalle completo. Estado vacío si no hay gastos. Colores y agrupación conservados.
- Inicio muestra cinco movimientos. “Ver todos” navega al ancla Movimientos y despliega toda la lista del mes ya cargada; “Ver resumen” y volver en el historial recuperan el límite. Los nuevos filtros y la vista independiente siguen en el bloque 3. Separadores rectos, chevrones alineados, gastos en rojo oscuro e ingresos en verde.
- Cuotas: se muestra la próxima fecha efectivamente guardada desde hoy (o desde el mes seleccionado si es futuro), con su número e importe exactos. No se infieren pagos ni vencimientos. Al consultar un mes pasado, esta sección sigue mostrando el futuro desde hoy; los movimientos históricos permanecen disponibles. Sin fechas futuras, hay estado vacío.
- “Total registrado” conserva la suma de las filas existentes sin afirmar que equivale a la compra original si faltan cuotas. Modificar abre la misma cuota mostrada y conserva el formulario; eliminar sigue requiriendo la confirmación existente. No se modifican cálculos de guardado ni escrituras.
- ESLint, TypeScript/build y 464 pruebas aprobados (459 previas + 5 sobre fechas pasadas, hoy, mes futuro/cambio de año, centavos finales y ausencia de mutaciones). Se conserva el aviso de bundle mayor a 500 kB.
- Las 52 llamadas de Supabase del Dashboard se compararon por AST contra 98c3dca: expresiones y argumentos idénticos. Sin endpoints nuevos, SQL, cambios de permisos ni dependencias.
- Chromium con datos ficticios y escrituras bloqueadas: 375 y 1280 px; cinco filas vs. lista completa e historial, todas las categorías en detalle, presupuesto sin definir/al 50%/al 85%/excedido, vacío, importes grandes, ARS/USD, selección de mes, cuota final con sus centavos, edición y confirmación abiertas/canceladas. Sin guardados ni mensajes externos.
- Muestreo de textos del resumen: 55 elementos en móvil y 56 en escritorio, ninguno con tamaño menor a 13 px ni contraste insuficiente en los estados examinados. Acciones examinadas de al menos 44 px; no se observó desbordamiento horizontal. Esto no reemplaza la prueba física en Safari/PWA ni una auditoría completa de accesibilidad.

## Pendientes explícitos

La revisión visual del propietario, los controles de CI y la publicación del bloque 2 se registran por separado en su PR. La app de producción continúa en el bloque 1 hasta autorizar esa PR. Movimientos/Cuotas conservan por ahora su ubicación compartida hasta el bloque 3; Ajustes y compactación del admin quedan para 4 y 5. No se afirma cumplir todavía tres clientes por pantalla.

La aceptación global exige completar los cinco bloques y probar los flujos que cambian visualmente. Publicar únicamente la revisión autorizada y registrar su commit/CI en la PR correspondiente; la aceptación real en teléfono se registra por separado.
