# BE-09 — Saldos mensuales exactos por moneda

Fecha: 27/10/2026. Base: PR #47/7f26e33, esquema 035 y webhook v59. **Cambio preparado, sin publicar ni aplicar 036 en producción.** Hosting INF-13 y backups INF-08 quedan para el final por decisión del propietario; la retención continúa desactivada.

## Revalidación del hallazgo

El bot vigente ya separaba ARS/USD, usaba el primer día del mes siguiente y comprobaba los errores de ambas lecturas. Esos defectos antiguos no se presentan como vigentes. Persistían dos problemas: agregación en JavaScript después de descargar filas sin paginar, susceptible al límite REST; y monthly_summary(date) de 001 sumando monedas distintas. La aritmética Number tampoco conserva siempre centavos en sumas grandes. La función antigua se ejecutó en aislado antes de 036: ARS 10 + USD 5 devolvía expenses=15; el contrato corregido devuelve solo ARS 10.

No se midió ni cambió el max_rows de producción. El ensayo fija **solo en el stack local** max_rows=1000, compara una lectura REST truncada con 1501 filas subyacentes y comprueba que la agregación devuelve los 1501 importes completos. No se aumenta el límite alojado ni se presume que ese límite de prueba sea el valor productivo.

## Contratos preparados

036 añade whatsapp_monthly_summary(p_user_id uuid,p_month date), STABLE, SECURITY DEFINER y search_path fijo. Solo service_role tiene EXECUTE; clientes y anon no pueden elegir otro usuario por esa ruta. Valida la cuenta/suscripción, normaliza el mes y agrega exclusivamente confirmados por usuario/fecha/moneda, con presupuesto ARS en la misma lectura consistente. No escribe movimientos, presupuestos, borradores, cola ni cupos.

Devuelve un objeto JSON versionado con dos monedas, importes decimales y conteos **como texto**, presupuesto opcional y disponible de presupuesto exclusivamente ARS. La suma SQL usa numeric; el formateador valida el contrato, calcula en centavos BigInt y comprueba balances/disponible sin convertir importes a Number. Incluye también balance USD; muestra el presupuesto dentro de la sección ARS. Una moneda sin operaciones se omite visualmente, sin convertirla ni combinarla con otra.

monthly_summary(date) conserva nombre, firma, columnas y tipos numéricos, con SECURITY INVOKER/RLS, pero queda **definida como ARS solamente**. Exige identidad/suscripción válida; EXECUTE queda para authenticated. No tiene consumidores en el frontend/backend actual según búsqueda del repo; cualquier consumidor externo debe considerar esa semántica explícita. No se da por creada una RPC de frontend multimoneda ni se cierra FE-18.

Se validan meses finitos de año 0001 a 9998. Un confirmado sin fecha o con fecha no finita no puede asignarse a un mes: exige revisión. Importe desconocido, cero/negativo/no finito dentro del mes o presupuesto no finito también falla. No se reparan registros históricos automáticamente ni se los presenta como cero. Errores o respuestas parciales/inconsistentes generan el diagnóstico seguro QUEUE_BALANCE_READ; la cola conserva su manejo de reintentos/revisión existente. Nunca se recurre a IA para calcular el saldo.

## Pruebas y límites de evidencia

- **871 Vitest**: 52 nuevos casos SQL/contrato/formato. Monedas, presupuesto de la cuenta/mes correcto, centavos, sumas grandes, más de 1000 movimientos, febrero normal/bisiesto, meses de 30 días, diciembre/enero, pendientes/cancelados/otra cuenta, cuenta vitalicia/inactiva, fechas/datos inválidos, permisos y compatibilidad.
- **75 rutas Deno sin red**: RPC agregada de usuario verificado, sin descargar tablas, IA ni checkpoint de interpretación; mes de Argentina cerca de medianoche/cambio de año y errores SQL/contrato cerrado. Se mantienen las regresiones del ruteo comercial, correcciones y cuota compartida.
- ESLint, TypeScript/build y Deno check/lint aprobados; 12 renovaciones SQL y seis guardas de release aprobados. El frontend no cambia; bundle/advertencia de tamaño previos conservados.
- PostgreSQL nativo y ensayo Supabase completo preparados para CI Linux: consulta concurrente sin escrituras; REST limitado a 1000 frente a agregado de 1501 importes; API service_role, rechazo de cliente/anon y legacy autenticada ARS. Usuarios, clave, contraseña, token y datos son únicamente ficticios del stack local. La prueba elimina sus fixtures locales al terminar y conserva el registro financiero original del ensayo.
- CI final pendiente al preparar esta revisión. No se clonó producción, se enviaron mensajes ni se llamó a proveedores reales. La aceptación posterior de WhatsApp no se presume realizada.

## Publicación propuesta, después de CI y autorización

1. Exigir los cuatro checks del SHA final y autorización explícita para 036, webhook y publicación de la PR. Verificar historial 001–035, definición/atributos/grants de monthly_summary(date), salud y presencia de la nueva RPC solo donde corresponda. Revisar por conteos si existen confirmados inválidos; no corregirlos durante el despliegue.
2. Aplicar y registrar 036 atómicamente con el historial esperado y comprobar fuentes/ACL; NOTIFY recarga el esquema de PostgREST. Es una expansión compatible: el runtime anterior no usa la nueva RPC y sigue funcionando. No requiere apagar la cola ni borrar/reprocesar mensajes.
3. Publicar whatsapp-webhook desde checkout limpio después de 036; verificar fuente y smoke de autenticación. Integrar/publicar la PR y comprobar versión/SW. No cambiar claves, modelos, cuotas, planes, hosting o retención.
4. Aceptación con el propietario: consulta de saldo actual; contrastar agregados de su propia cuenta y presupuesto con lectura autorizada, sin crear movimientos ni modificar datos reales. Si no hay USD, probar esa ruta solo en aislado; no inventar operaciones para la aceptación.
5. Rollback de runtime: 7f26e33b40f6482139e949721aa95e859749e716 (v59), conservando 036 y sus permisos. Mantiene el gate de IA y formato nullable. Recupera la consulta anterior con sus limitaciones conocidas de filas/Number; no restaura datos ni la suma mixta antigua. Nunca usar runtimes anteriores al gate 035.

La consulta del bot sigue siendo la del **mes actual de Argentina**. No se incorpora interpretación de meses libres ni cambios de consultas comerciales/correcciones. La selección de mes de la RPC es para su contrato y pruebas; no se anuncia una capacidad nueva de lenguaje natural.

## Referencias

- [Supabase: select y límite REST predeterminado](https://supabase.com/docs/reference/javascript/select).
- [Supabase: funciones y permisos](https://supabase.com/docs/guides/database/functions).
- [PostgreSQL: agregación y numeric](https://www.postgresql.org/docs/17/functions-aggregate.html).
