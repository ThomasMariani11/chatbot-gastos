# SEC-05: con una foto solo se cargan gastos — diseño

Fecha: 25/11/2026. Tarea 2.1 del plan de remediación (hallazgo SEC-05). Aprobado por el propietario.

## Intención

Una imagen no debe poder darle órdenes al bot. Hoy la IA puede devolver `confirm`, `cancel`, `remove_item`, `edit_item` o `summary` a partir de una foto (por ejemplo, una imagen con la palabra "confirmar"), y el procesador lo aplica sobre el borrador del cliente.

## Objetivos

- Con una foto, solo se aceptan `add_movements` o la respuesta de "no entendí" (`request_text` / `unknown`).
- Cualquier otra intención con foto no se aplica y el bot responde: "Con una foto solo puedo cargar gastos 📷 Para confirmar, cancelar o cambiar algo, escribímelo."
- El prompt marca el contenido de la imagen como dato no confiable.

## No objetivos

- Audios: siguen admitiendo intenciones de control (es la voz del propio cliente).
- Sin cambios de SQL ni de PWA; sin aumento del consumo de IA.

## Enfoques

1. **Control en el procesador más regla en el prompt (elegido).** El control determinístico es la defensa real; el prompt reduce las respuestas inválidas.
2. Solo la regla en el prompt: descartado, la IA puede ignorarla.
3. Dos pasos (imagen → texto → interpretación): descartado, duplica el consumo de IA.

## Diseño

- `processor.ts`: antes del `switch` final, si el mensaje tiene `image.id` y la intención no es `add_movements`, `request_text` ni `unknown`, responder `BOT_MESSAGES.imageControlBlocked`. Al estar después del checkpoint, cubre también resultados guardados antes del deploy.
- `gemini.ts`: con imagen, agregar al prompt una regla que delimita el contenido de la imagen como dato y restringe la respuesta a `add_movements` o `unknown`. El prompt se comparte con Groq (Qwen) y con Gemini.
- `bot-messages.ts`: mensaje nuevo `imageControlBlocked`.
- Pruebas (T15): con adaptador simulado, una foto interpretada como cada intención de control no produce acción; una foto de ticket sigue cargando el gasto; un audio "confirmar" sigue confirmando.

## Publicación

Deploy del webhook con smoke 401. Rollback: volver a v79 (no hay cambios de esquema).
