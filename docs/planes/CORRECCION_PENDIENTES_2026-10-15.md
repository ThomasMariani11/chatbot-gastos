# Corrección por número de pendiente — BE-12 / validación INF-03

Fecha: 15/10/2026. Webhook v40 ACTIVE. Prueba real del propietario pendiente.

La prueba WhatsApp detectó que una instrucción para corregir el número 2 terminaba como un gasto nuevo con importe 2. La interpretación IA o su fallback podían devolver add_movements aunque el texto fuera una corrección.

## Cambio publicado

- Las formas explícitas «El 2 fue de 250», «El 2 era 5.000» y «Cambiá el 2 a 250» se interpretan como edición de importe por número estable, sin IA. Aceptan separadores argentinos y multiplicadores mil/k.
- Conserva descripción, tipo y moneda del pendiente. Si el número no existe, la RPC informa que no se encontró y no agrega otro.
- Valores no positivos, formatos no admitidos o varias modificaciones dentro de esa forma solicitan aclaración sin cambios parciales.
- Si una corrección general pasa por IA y esta devuelve alta de movimientos, el procesador rechaza esa alta y pide aclaración. Mantiene las ediciones que la IA identifica correctamente.
- Los bloqueos de cuenta y la resolución de listas antiguas siguen antes de la edición. No hay migraciones SQL ni modificaciones directas de listas o movimientos productivos. El pendiente erróneo ya creado requiere quitarlo explícitamente; no se reinterpreta el mensaje anterior.

## Evidencia

- 163 tests Vitest aprobados, incluidos 11 del parser de correcciones y una integración SQL con las migraciones reales: cambia solo el importe del movimiento 2 entre tres, preserva IDs, números, conceptos, tipos y monedas, no crea movimientos confirmados y repetir la aplicación no duplica. Un número inexistente no modifica la lista.
- 12 tests Deno aprobados sin red. El procesador real identifica la corrección sin IA y rechaza un add_movements incorrecto previamente interpretado.
- Build y tipos, lint de tests modificados, deno check y deno lint aprobados. Permanece la advertencia previa de tamaño del bundle frontend.
- Webhook v40 publicado. INF-03/BE-06 y BE-12 permanecen en curso. Esta corrección solo cubre el importe y la guarda contra altas falsas; no completa categorías, fechas, cuotas ni todas las variantes de edición de BE-12.

## Repetición de la prueba

1. Pedir RESUMEN y revisar los números vigentes.
2. Quitar explícitamente el pendiente erróneo agregado por la instrucción anterior, usando su número actual. No cancelar movimientos reales ajenos a la prueba.
3. Enviar «El 2 fue de 250»: debe cambiar solo ese importe y no aumentar la cantidad.
4. Continuar eliminación y descarte de los movimientos de prueba del procedimiento INF-03. No confirmar la lista de pruebas.
