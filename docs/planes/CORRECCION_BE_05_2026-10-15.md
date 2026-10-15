# BE-05 — Corrección de clasificación y mensaje mixto

Fecha: 15/10/2026. Webhook v39 publicado. Prueba real del propietario pendiente. INF-03/BE-06 siguen en curso; la captura detectó un fallo del clasificador previo a la carga.

## Problema y corrección

El filtro comercial interceptaba cualquier aparición de transferencia, suscripción o saldo antes de interpretar movimientos. Se separó la clasificación de consultas: una operación realizada o un importe acompañado de una señal de movimiento pasa al parser; las consultas comerciales y de saldo conservan su vía rápida. Los captions de audio/foto no activan esas respuestas rápidas.

La regresión con datos sintéticos reproduce un mensaje con dos gastos y un ingreso. También cubre la coma entre concepto e importe siguiente, manteniendo los decimales; reconoce me ingresó y corrige el límite de palabra tras vocales acentuadas en cobré e ingresó. La descripción elimina el prefijo de ingreso.

No se cambia el esquema SQL, la confirmación, las restricciones de cuenta ni el modelo IA. No se reinterpreta ni se vuelve a guardar automáticamente ningún mensaje productivo anterior. El propietario debe reenviar el mensaje para probar el arreglo.

## Validación

- 151 tests Vitest en diez archivos; 15 casos nuevos de clasificación.
- Nueve tests Deno sin red: seis nuevos del procesador/parser reales, además de las tres regresiones existentes de parser, firma y webhook. El caso mixto produce exactamente dos gastos y un ingreso y un solo checkpoint; los importes son fixtures sintéticos.
- Aprobados build con TypeScript, lint del test nuevo, deno check y deno lint. El build mantiene la advertencia anterior de chunk superior a 500 kB.
- Supabase: webhook v39 ACTIVE; la cola y cron conservan su configuración. La aceptación con el WhatsApp del propietario sigue pendiente; no se declara resuelta toda la variedad de consultas mixtas o multimedia de BE-05.

## Prueba real pendiente

1. Enviar RESUMEN y comprobar los pendientes actuales.
2. Reenviar el mensaje mixto que respondió sobre membresía. Deben verse tres operaciones: dos gastos y un ingreso.
3. Revisar conceptos, montos y tipos. Para una prueba sin guardado, responder CANCELAR solamente si se quiere descartar toda la lista pendiente. CONFIRMAR guarda la lista completa.
4. Continuar la prueba de ráfagas de INF-03/BE-06. La captura corresponde a un mensaje mixto; no acredita aún varios mensajes rápidos ni recuperación tras interrupción.
