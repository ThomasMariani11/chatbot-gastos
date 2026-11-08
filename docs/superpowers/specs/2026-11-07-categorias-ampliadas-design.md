# Categorías ampliadas y reclasificación (FE-24 + BE-20) — diseño

Fecha: 07/11/2026. Estado: **borrador para aprobación del propietario.** Nada implementado.

## Intención

Hoy cada cuenta tiene 11 categorías de gasto y 5 de ingreso. Muchos gastos normales terminan en "Otros" o en una categoría demasiado amplia (Netflix en Ocio, PedidosYa en Alimentación, un service del auto en Transporte). El propietario quiere un catálogo fijo más amplio que cubra la mayoría de los gastos e ingresos cotidianos, que el bot y la PWA usen bien, y que los movimientos ya cargados se reacomoden al catálogo nuevo.

**Éxito:** casi nada cae en "Otros" por falta de categoría; los gráficos del Resumen muestran categorías útiles; los movimientos viejos claros quedan en la categoría nueva que les corresponde.

## Objetivos

1. Agregar 11 categorías de gasto y 4 de ingreso, iguales para todas las cuentas (existentes y nuevas).
2. Que el bot las asigne: parser determinístico con palabras clave para lo simple y lista actualizada en el prompt de IA (Groq/Gemini comparten `buildPrompt` de `gemini.ts`).
3. Que la PWA las muestre con ícono y color propios.
4. Reclasificar movimientos existentes cuando el concepto coincide claramente con una categoría nueva, con registro para deshacer.

## No objetivos

- **El cliente no crea, renombra ni borra categorías** (decisión del propietario; reemplaza el alcance original de FE-24 punto 2 y BE-20 punto 2). No se agregan RPC de gestión de categorías ni límite por usuario.
- No se incluyen "Inversiones" ni "Ahorro": comprar dólares o un plazo fijo es mover plata propia, no un gasto, y distorsionaría el balance.
- No se renombran ni eliminan las 16 categorías actuales.
- No se usa IA para reclasificar.
- No se reclasifican borradores pendientes de WhatsApp; solo filas de `public.transactions`.

## Anti-objetivos (sería un fracaso aunque funcione)

- Mover un movimiento a una categoría equivocada por una coincidencia ambigua.
- Que una compra en cuotas quede repartida entre dos categorías.
- Que el alta de usuario (039) falle o quede a medias por el nuevo conteo de categorías.
- Que el bot use más IA que hoy.
- Aplicar la reclasificación en producción sin que el propietario haya visto antes el resumen de cantidades.

## Catálogo (decidido con el propietario)

**Gastos nuevos (11):** Restaurantes y delivery · Suscripciones · Auto · Hogar · Tecnología · Cuidado personal · Deporte · Mascotas · Hijos · Viajes · Regalos y donaciones.

**Ingresos nuevos (4):** Alquileres · Reintegros · Regalos · Jubilación y asignaciones.

Total por cuenta: 22 de gasto + 9 de ingreso = **31**.

Alcance de cada una (guía para palabras clave):

| Categoría | Qué incluye | Antes caía en |
| --- | --- | --- |
| Restaurantes y delivery | comer afuera, PedidosYa, Rappi, café, bar, restaurante, McDonald's, helado | Alimentación / Ocio |
| Suscripciones | Netflix, Spotify, Disney, HBO/Max, Prime, YouTube Premium, iCloud | Ocio |
| Auto | service, mecánico, gomería, cubiertas, seguro del auto, lavado, cochera, estacionamiento | Transporte |
| Hogar | muebles, electrodomésticos, ferretería, artículos de limpieza, arreglos | Compras / Otros |
| Tecnología | celular, computadora, notebook, accesorios, auriculares | Compras |
| Cuidado personal | peluquería, barbería, perfumería, cosmética, manicura | Otros |
| Deporte | gimnasio, club, cancha, pádel, suplementos, creatina, proteína | Salud / Otros |
| Mascotas | veterinario, alimento balanceado, pet shop | Otros |
| Hijos | pañales, juguetes, niñera, guardería | Otros / Compras |
| Viajes | pasajes, vuelos, hotel, Airbnb, excursiones | Otros |
| Regalos y donaciones | regalo, cumpleaños, donación | Otros |
| Alquileres (ingreso) | cobro de alquiler | Otros |
| Reintegros (ingreso) | reintegro, devolución, cashback | Otros |
| Regalos (ingreso) | regalo recibido | Otros |
| Jubilación y asignaciones (ingreso) | jubilación, pensión, AUH, asignación | Otros |

Las existentes conservan su nombre; su alcance se achica: Alimentación = súper/almacén/verdulería/carnicería; Transporte = colectivo/tren/subte/Uber/taxi/nafta/peajes/SUBE; Compras = ropa y calzado; Ocio = cine/teatro/salidas/juegos. Aguinaldo y bonos siguen en Sueldo.

**Colores e íconos:** a definir por el builder. Cada categoría de gasto nueva necesita ícono y color distintos; se pueden agregar íconos SVG a `src/Icons.tsx` en el estilo de línea existente. La PWA resuelve los visuales **por nombre** en `src/categoryVisuals.ts` e ignora las columnas `color`/`icon` de la base (hoy ya difieren para las 16 existentes). Llamada del diseño: las 15 filas nuevas llevan en la base el mismo color/ícono que en `categoryVisuals.ts`; **no se actualizan las filas existentes** (sería un cambio de datos sin beneficio visible). Los ingresos siguen mostrándose con la flecha verde en la lista de movimientos (`movementVisual`), como hoy; las categorías de ingreso nuevas solo necesitan visual para la dona/detalle si corresponde.

## Cómo está hoy (verificado en el código el 07/11/2026)

- `public.categories(user_id, kind, name, color, icon, active)`, único `(user_id, kind, name)`, RLS por dueño (001).
- El alta atómica se creó en `039_atomic_user_signup.sql`, pero **la definición vigente de `bootstrap_user` está en `040_atomic_whatsapp_linking.sql` (aprox. líneas 213–268)**, que agrega el control de `expires_at`. Inserta 16 filas y **verifica 16**: debe redefinirse en una migración nueva **partiendo de la versión de 040**, con el conteo 31.
- Planes en cuotas (029): existe una **fila cabecera** con `status='cancelled'`, cuyo `id` es el grupo y sin `installment_group_id`; al editar el plan se reutiliza su `category_id` (029, aprox. línea 238).
- Siguen existiendo filas v1 con `status='pending'` en `transactions` (020): no se tocan.
- Parser determinístico con varios conceptos ("café y facturas"): si las partes caen en más de una categoría conocida devuelve `null` y el mensaje va a la IA (`local-movements.ts`, aprox. líneas 229–234).
- El bot resuelve la categoría por nombre en SQL: `lower(name)=lower(...)` y si no existe usa "Otros" (034 y 037). No normaliza acentos: el nombre que devuelva el parser o la IA debe coincidir con el guardado.
- Parser determinístico: `categoryFor` en `supabase/functions/whatsapp-webhook/local-movements.ts` (regex sobre texto normalizado sin acentos).
- Prompt de IA: lista fija en `gemini.ts` ("CATEGORÍAS:"), reutilizada por Groq.
- PWA: carga categorías activas del usuario ordenadas por nombre (`src/Dashboard.tsx:555`); visuales por nombre en `src/categoryVisuals.ts`.
- Cuotas: filas de `transactions` con el mismo `installment_group_id`.
- Última migración en el repo: 046.

## Diseño

### 1. Migración 047 — catálogo ampliado (expansiva)
- Inserta las 15 categorías nuevas para **todas las cuentas existentes** con `on conflict (user_id, kind, name) do nothing` (idempotente).
- Redefine `bootstrap_user` **a partir de su versión vigente en 040** para crear las 31 y verificar 31. Conservar exactamente el resto del contrato (atomicidad, invitación con `expires_at`, perfil, ajustes, vínculo, `search_path`, grants).
- Compatible con la PWA y el webhook actuales: categorías extra no rompen nada.

### 2. Bot
- `categoryFor`: agregar reglas de las categorías nuevas y mover las palabras que cambian de casa (p. ej. café/restaurante/pedidosya → Restaurantes y delivery; netflix/spotify → Suscripciones; cochera/estacionamiento → Auto; creatina/suplementos → Deporte). El orden de las reglas importa: las específicas antes que las generales.
- Prompt: actualizar la lista de categorías de gasto e ingreso con los nombres exactos.
- **No debe aumentar llamadas a IA.** Al separar categorías, mensajes como "café y facturas" o "nafta y lavado" pasarían a tener dos categorías conocidas y hoy eso los manda a la IA. Llamada del diseño: en la regla de varios conceptos, cada categoría nueva cuenta como de la misma **familia** que la categoría de la que salió (Alimentación~Restaurantes y delivery; Transporte~Auto; Compras~Tecnología/Hogar/Hijos; Salud~Deporte; Ocio~Suscripciones). Si todas las partes son de una sola familia, se resuelve sin IA y la categoría final es la que da `categoryFor` sobre la descripción completa (igual que hoy). Partes de familias distintas siguen yendo a la IA como hoy. Pruebas de regresión con estos casos.

### 3. PWA
- `src/categoryVisuals.ts`: entrada por cada categoría nueva; `src/Icons.tsx` si hacen falta íconos.
- Los selectores ya leen de la base: no requieren cambios de lógica. Con 22 opciones de gasto, verificar que el selector siga siendo cómodo en 375 px.

### 4. Reclasificación de movimientos existentes (migración separada, 048)
- **Qué hace 048:** solo **instala** la tabla de registro y tres funciones (vista previa, aplicar, revertir). **No mueve datos al aplicarse.** Las funciones son `SECURITY DEFINER` con `search_path` fijo y `REVOKE` total a `public`, `anon` y `authenticated`; se ejecutan solo como operación de producción autorizada por el propietario, por la vía protegida que documenta `docs/operaciones/DEPLOY_Y_ROLLBACK.md` (diálogo del hook `guard-supabase.mjs`). Pasos: aplicar 048 → ejecutar vista previa → el propietario revisa cantidades → con nueva autorización, ejecutar aplicar. El runbook se actualiza con estos pasos.
- **Reglas:** las mismas palabras clave que `categoryFor`, aplicadas al `description` normalizado (minúsculas, sin acentos), generadas o validadas desde una única fuente.
- **Qué es "claro":** el concepto se evalúa contra **todas** las reglas del catálogo (nuevas y existentes). Se mueve solo si coincide con **exactamente una** categoría y esa categoría es **nueva**. Si coincide con ninguna, con dos o más (p. ej. "super y café", "nafta y lavado"), o solo con una existente, no se mueve.
- **Paridad TS ↔ SQL:** una prueba corre un conjunto de conceptos ficticios por ambos lados y compara el **resultado final** (categoría o "no mover"). Para los conceptos con una única coincidencia, el destino SQL debe ser igual a `categoryFor`.
- **Solo origen permitido:** Alimentación, Transporte, Compras, Ocio, Salud y Otros (gasto); Otros (ingreso). Destino: solo categorías nuevas, del mismo `kind` y del mismo usuario.
- **Qué filas:** movimientos `confirmed` y las **filas cabecera de planes en cuotas** (`cancelled`, `id` = grupo, sin `installment_group_id`). **Excluidas:** filas `pending` (incluidas las v1 históricas de 020) y cualquier otra `cancelled` que no sea cabecera.
- **Cuotas:** el plan (cabecera + todas sus cuotas con ese `installment_group_id`) se mueve entero o no se mueve; se mueve solo si todas sus filas resultan en el mismo destino.
- **Registro para deshacer:** tabla privada (sin acceso `anon`/`authenticated`) con `transaction_id`, `user_id`, categoría anterior, categoría nueva y fecha. La función de reversión restaura la categoría anterior solo si el movimiento sigue en la categoría a la que se movió (no pisa ediciones posteriores del cliente).
- **Vista previa obligatoria:** función de solo lectura que devuelve cantidades agregadas por par origen → destino, sin conceptos ni datos de clientes.
- **Idempotente:** ejecutar aplicar dos veces no cambia nada la segunda vez.
- **Contra conocida y aceptada:** si un cliente eligió a propósito una categoría vieja para algo que coincide con una regla, se mueve igual; puede volver a editarlo.

### Orden de publicación
1. 047 (catálogo) → 2. webhook con reglas y prompt nuevos → 3. PWA con visuales → 4. vista previa de 048 → 5. aplicar 048 con autorización del propietario.
Cada paso productivo requiere autorización explícita según `CLAUDE.md` y `docs/operaciones/DEPLOY_Y_ROLLBACK.md`. Revertir la PWA no revierte SQL ni webhook; la reclasificación se revierte con su función propia.

## Pruebas esperadas
- SQL en PGlite: 047 sobre cuentas existentes (idempotente), alta nueva con 31 categorías, fallo atómico del alta conservado (`tests/signup-sql.test.ts` hoy espera 16).
- Reclasificación con datos ficticios: casos claros, ambiguos, sin coincidencia, otro usuario, cuotas mixtas, segunda ejecución, reversión y reversión tras edición del cliente.
- Parser: casos por categoría nueva y regresiones de los existentes (`tests/deterministic-parser.test.ts`, `tests/bot-natural-language-and-simplicity.test.ts`).
- PWA: visuales de cada categoría y selector en 375/1280 px.
- Paridad de reglas TS ↔ SQL.

## Llamadas del autor del diseño (revisables)
- Nombres exactos con mayúscula inicial y acentos como en la tabla.
- Reclasificación como migración 048 separada de 047; 048 instala funciones y no mueve datos; aplicar es un paso aparte con autorización.
- "Claro" = una sola coincidencia en todo el catálogo y que sea categoría nueva.
- Familias de categorías en el parser para no aumentar el uso de IA.
- No se actualizan color/ícono de las 16 categorías existentes; los ingresos siguen con la flecha verde en la lista.
- No se reclasifican borradores ni filas `pending`; sí las cabeceras de planes en cuotas.

## Queda para el builder
- Colores, íconos y regex concretas (respetando los alcances de la tabla).
- Forma de compartir las reglas entre TS y SQL.
- Estructura exacta de la tabla de registro y de las funciones de vista previa y reversión.
- Actualizar `docs/planes/PLAN_MEJORAS_PROYECTO.md` (FE-24/BE-20) y `docs/contexto/CONTEXTO_PESITO_PARA_CLAUDE.md`.
