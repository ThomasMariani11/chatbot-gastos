# Validación FE-09 y seguimiento FE-11

Fecha: 25/10/2026. Base: main 382e125. Rama: codex/accurate-installment-remaining.
Estado: implementación y aceptación ficticia terminadas; revisión y publicación pendientes. Consultar CI de la PR sobre el SHA final. No hay migración ni despliegue del webhook en este bloque.

## Qué cambió

- Cuotas y Resumen comparten el cálculo de registros confirmados existentes. Cantidades e importes se obtienen de esas filas, sin multiplicar la cantidad original ni reconstruir cuotas borradas. Las sumas se hacen en centavos enteros, por grupo y moneda.
- El indicador incluye la siguiente cuota: desde hoy para el mes actual/pasado; desde el primer día del mes seleccionado si es futuro. La fecha de corte se muestra en pantalla. Son fechas programadas, no pagos ni deuda acreditados. El total registrado incluye todas las filas confirmadas existentes del grupo.
- Se conserva la numeración original (por ejemplo, 3/3 aunque se haya eliminado la 2). El progreso cuenta fechas existentes anteriores al corte sobre registros existentes; no infiere pagos desde el ordinal.
- Identidad por installment_group_id; un registro legado sin grupo se aísla por su ID, nunca por descripción. Grupos incompatibles o importes/fechas inválidos impiden publicar los totales en vez de inventar valores.
- La lectura de cuotas usa cursor por ID, páginas de 250 y conteo exacto. Comprueba orden, duplicados, cuenta coherente y fin de lectura; un fallo no entrega subtotales. Se conserva la cancelación/timeout del cargador. Esto evita tomar el límite de una respuesta como total; no cierra toda la paginación FE-18/BE-09.
- FE-11 conserva las RPC atómicas y la reconciliación desde el servidor ya publicadas en 029/PR #30. Se agregan pruebas específicas de planes homónimos, fallo y cambio concurrente; no se cambia la política de eliminación.

## Pruebas automáticas

- npm test: **628/628** aprobadas (592 anteriores y 36 nuevas).
- 20 casos del cálculo real: importes distintos, centavos, eliminación, fechas de corte, inicio futuro, meses sin cuota, mes histórico, cambio de año, bisiesto, ARS/USD, identidad y datos inválidos. No se modifica la entrada.
- 9 casos de paginación sobre readDashboardSnapshot real: 1003 filas, límite del servidor menor al pedido, cero filas, página fallida, cuenta ausente/cambiante, ID repetido, página vacía incompleta y cancelación. Transporte simulado, sin Supabase real.
- 5 casos con Dashboard real, React StrictMode y jsdom: montos/monedas, cuota eliminada, eliminación por ID, fallo/reintento y tercer plan homónimo recibido durante el borrado; doble clic no duplica la RPC. Lectura/transporte simulados; presentación y adaptador de planes reales.
- 2 casos SQL nuevos sobre migraciones reales en PGlite descartable: eliminar un Celular deja intactas filas, versión e importes del otro; un trigger falla al cancelar la cuota 2 y revierte todo el plan, conservando ambos. La suite SQL de planes queda en 17 casos.
- npm run lint y npm run build (incluye TypeScript): aprobados. Bundle principal 868,58 kB / 249,13 kB gzip; permanece el aviso previo de tamaño mayor a 500 kB, no cerrado por este bloque.
- npm run test:sql: 12 escenarios existentes aprobados. npm run test:release:guards: 6 aprobados.
- Ejecución local con Node 24.21.0; CI usa el Node fijado en .node-version (22.23.3). Registrar sus resultados sobre el SHA final antes de publicar.

## Navegador con datos ficticios

Vista en http://127.0.0.1:4198/chatbot-gastos/#cuotas. Dashboard, presentación, lectura y adaptador RPC reales; transporte local que imita las respuestas de PostgREST y ejecuta get_installment_plan/mutate_installment_plan de 029 en PGlite en memoria. Solo loopback, sin credenciales ni llamadas a Supabase/Meta/Groq. Barra de pruebas fuera del producto. Las fechas DATE del motor se serializan como YYYY-MM-DD para conservar el contrato de la API.

Resultados observados:

1. Celular A: 100 + 200,10 + 300,20; desde hoy, dos cuotas por 500,30; total registrado 600,30. Celular B independiente: 900 total y 600 programados.
2. Teclado: cuota 2 cancelada; muestra 3/3, una cuota por 33,34 y total registrado 66,67. No reaparece la cuota borrada.
3. Se inyectó fallo de trigger durante delete_plan de Celular A. Error visible y ambos planes conservados. Reintento con el mismo intento: A desaparece; B conserva 900 total y 600 programados. La RPC identifica el grupo seleccionado.
4. USD: Celular separado, 10 del mes, 20 programados y 30 registrados. No se suma con ARS.
5. Noviembre futuro: etiqueta Desde 1 nov; Celular B tiene una cuota por 300; Teclado una por 33,34; Auriculares empieza el 1 de noviembre. Resumen presenta los mismos conteos/importes programados y mantiene la moneda.

Capturas temporales: pesito-fe09-cuotas-antes.jpg, pesito-fe09-eliminacion-fallida.jpg y pesito-fe09-homonimo-conservado.jpg. No contienen datos de clientes. Se conserva la vista local para revisión; no equivale a aceptación en producción.

## Límites y publicación

- No se tocaron compras, perfiles, SQL, webhook ni configuración de producción; no se enviaron mensajes de WhatsApp ni se consumió IA. No hay nuevas dependencias.
- La prueba física de Safari/iPhone/PWA instalada sigue pendiente: el inventario disponible solo muestra el navegador integrado y MCP Apps vacío, sin dispositivo físico. No se presenta Chromium/jsdom como Safari.
- La lectura paginada no es una transacción de snapshot SQL: detecta cambios de cantidad entre páginas, pero no todos los cambios concurrentes con igual cantidad. Las RPC de escritura mantienen la versión/atomicidad y la UI vuelve a consultar tras una mutación. No se declara consistencia transaccional de todas las lecturas del dashboard.
- Tope defensivo de 80 páginas y plazo del cargador; al excederlos se muestra error/reintento, no un total parcial. La paginación del listado mensual sigue en FE-18/BE-09.
- Antes de integrar: revisar diff y cuatro controles CI sobre SHA final. Después de autorización: publicar PWA, comprobar versión/SW y pantalla publicada sin modificar compras reales para probar. Rollback según INF-10; no cambia esquema.
- Retención desactivada; backups al final. Próximo bloque tras revisar/publicar: revisar avances BE-04/05/07/08 con BE-12/17, un defecto por vez y regresiones antes de cambiar el bot.
