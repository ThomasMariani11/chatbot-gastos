# Categorías ampliadas y reclasificación — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sumar 15 categorías fijas (11 de gasto, 4 de ingreso) a todas las cuentas, que el bot y la PWA las usen, y dejar lista una reclasificación reversible de movimientos viejos claros.

**Architecture:** Un módulo único de catálogo y palabras clave en el webhook (`category-rules.ts`) alimenta el parser determinístico, el prompt de IA y —vía prueba de paridad— las reglas SQL de la reclasificación. La migración 047 agrega las categorías y actualiza el alta; la 048 solo instala tabla de registro y funciones (candidatos, vista previa, aplicar, revertir) sin mover datos.

**Tech Stack:** TypeScript (Vite/React 19 en `src/`, Deno 2 en `supabase/functions/whatsapp-webhook/`), PostgreSQL/Supabase, Vitest 4 + PGlite.

**Spec:** `docs/superpowers/specs/2026-11-07-categorias-ampliadas-design.md`

## Global Constraints

- Nombres exactos (con mayúscula y acentos): gasto nuevas `Restaurantes y delivery`, `Suscripciones`, `Auto`, `Hogar`, `Tecnología`, `Cuidado personal`, `Deporte`, `Mascotas`, `Hijos`, `Viajes`, `Regalos y donaciones`; ingreso nuevas `Alquileres`, `Reintegros`, `Regalos`, `Jubilación y asignaciones`.
- Total por cuenta: 22 gasto + 9 ingreso = **31**. Las 16 existentes no se renombran ni se tocan sus `color`/`icon`.
- Sin dependencias nuevas. Sin Tailwind. Imports del webhook con extensión `.ts` (Deno).
- No editar migraciones aplicadas (001–046). Nuevas: `047_extended_categories.sql`, `048_category_reclassification.sql`.
- Funciones SQL nuevas: `security definer`, `set search_path=pg_catalog,public`, `revoke all ... from public, anon, authenticated`. Tablas nuevas: RLS activada y `revoke all` a `public, anon, authenticated` (patrón de `installment_plan_requests` en 029).
- 048 **no mueve datos** al aplicarse.
- El bot no debe usar más IA que hoy.
- Solo datos ficticios en pruebas (`@example.invalid`, UUIDs de fixture).
- Nada se aplica ni publica en producción dentro de este plan.

## Review Focus

1. Mensaje con dos conceptos de la misma familia ("1500 café y facturas") → se resuelve sin IA (no `null`). Test en Task 1.
2. Concepto que coincide con una categoría nueva y una existente ("super y café") → la reclasificación no lo mueve. Test en Task 5.
3. Plan en cuotas con cabecera `cancelled` → cabecera y cuotas se mueven juntas o ninguna. Test en Task 5.
4. Cliente que editó un movimiento después de aplicar → revertir no pisa su edición. Test en Task 5.
5. Usuario existente que ya tuviera una categoría con un nombre nuevo (p. ej. creada a mano antes) → 047 no falla y no duplica. Test en Task 4.

---

### Task 0: Rama de trabajo

- [ ] **Step 1:** `git switch -c feat/categorias-ampliadas` desde `main` actualizado.
- [ ] **Step 2:** `git add docs/superpowers/specs/2026-11-07-categorias-ampliadas-design.md docs/superpowers/plans/2026-11-07-categorias-ampliadas.md` y commit `docs: diseño y plan de categorías ampliadas (FE-24/BE-20)`.

### Task 1: Catálogo y reglas compartidas + parser

**Files:**
- Create: `supabase/functions/whatsapp-webhook/category-rules.ts`
- Modify: `supabase/functions/whatsapp-webhook/local-movements.ts` (`categoryFor`, aprox. 71–112; regla de varios conceptos, aprox. 228–234)
- Test: `tests/category-rules.test.ts` (nuevo), `tests/deterministic-parser.test.ts` (creatina pasa a `Deporte`)

**Interfaces:**
- Produces:
  ```ts
  export type CategoryKind = "expense" | "income";
  export type CategoryRule = { kind: CategoryKind; name: string; family: string; isNew: boolean; keywords: string[] };
  export const CATEGORY_RULES: readonly CategoryRule[];        // orden = prioridad de categoryFor
  export const CATEGORY_NAMES: Record<CategoryKind, readonly string[]>; // 22 / 9, incluye "Otros"
  export function normalizeConcept(text: string): string;     // NFD sin diacríticos, minúsculas (igual a normalize de local-movements)
  export function categoryFor(description: string, kind: CategoryKind): string; // primera regla que coincide o "Otros"
  export function categoryFamily(name: string, kind: CategoryKind): string;
  export function matchingCategories(description: string, kind: CategoryKind): string[]; // todas las que coinciden
  export function reclassTarget(description: string, kind: CategoryKind): string | null; // exactamente 1 coincidencia y isNew
  export function sqlPatternFor(rule: CategoryRule): string;   // "\\y(kw1|kw2)\\y" para regex de Postgres
  export function categoryPromptLines(): string;              // "  * Gasto: ...\n  * Ingreso: ..."
  ```
  Coincidencia JS: `new RegExp("\\b(" + keywords.join("|") + ")\\b")` sobre `normalizeConcept`. Keywords ya normalizadas (sin acentos, minúsculas); frases con espacio permitidas.

**Catálogo (orden de prioridad; familia; palabras clave):**

Gasto — nuevas primero:
| name | family | keywords |
| --- | --- | --- |
| Suscripciones | Ocio | netflix, spotify, disney, hbo, prime video, youtube premium, icloud, chatgpt, suscripcion, suscripciones |
| Restaurantes y delivery | Alimentación | restaurant, restaurante, pedidosya, rappi, mcdonalds, mostaza, burger, cafe, cafes, cafeteria, bar, parrilla, pizza, pizzeria, sushi, helado, heladeria, delivery |
| Auto | Transporte | mecanico, gomeria, cubiertas, neumaticos, service del auto, seguro del auto, seguro auto, lavadero, lavado del auto, cochera, estacionamiento, vtv |
| Tecnología | Compras | celular, notebook, computadora, laptop, tablet, auriculares, cargador, teclado, monitor, iphone |
| Hogar | Compras | mueble, muebles, colchon, heladera, lavarropas, microondas, electrodomestico, electrodomesticos, ferreteria, pintura, plomero, electricista, lavandina, detergente, articulos de limpieza |
| Hijos | Compras | panales, juguete, juguetes, jugueteria, ninera, guarderia |
| Cuidado personal | Cuidado personal | peluqueria, barberia, corte de pelo, perfumeria, perfume, cosmetica, maquillaje, manicura, depilacion |
| Deporte | Salud | gimnasio, gym, cancha, padel, natacion, creatina, suplemento, suplementos, proteina, proteinas |
| Mascotas | Mascotas | veterinaria, veterinario, balanceado, pet shop, petshop, mascota |
| Viajes | Viajes | pasaje, pasajes, vuelo, vuelos, hotel, hostel, airbnb, booking, excursion, despegar, aerolineas |
| Regalos y donaciones | Regalos y donaciones | regalo, regalos, donacion, donaciones |

Gasto — existentes (palabras actuales menos las que se mudaron):
- Alimentación: las actuales sin `cafe, cafes, restaurant, restaurante, pedidosya, rappi, mcdonalds, mostaza, burger, helado`.
- Transporte: las actuales sin `estacionamiento, cochera`.
- Servicios, Vivienda, Educación, Compras, Impuestos, Deudas: sin cambios.
- Salud: las actuales sin `creatina, suplementos?, proteinas?`.
- Ocio: las actuales sin `bar, netflix, spotify, disney, hbo, prime`.
- Otros: sin keywords (fallback). Familia de cada existente = su propio nombre.

Ingreso: Sueldo (actuales + `aguinaldo, bono`), Freelance y Ventas (actuales), Rendimientos (`plazo fijo, intereses, dividendos`), nuevas `Alquileres` (`alquiler, alquileres, inquilino`), `Reintegros` (`reintegro, reembolso, devolucion, cashback`), `Regalos` (`regalo, regalaron`), `Jubilación y asignaciones` (`jubilacion, pension, auh, asignacion, asignaciones, anses`); `Otros` fallback. Familias = propio nombre.

- [ ] **Step 1: Tests que fallan** en `tests/category-rules.test.ts`:
  - `CATEGORY_NAMES.expense.length === 22`, `CATEGORY_NAMES.income.length === 9`, contiene los nombres exactos de Global Constraints y las 16 actuales.
  - `categoryFor("Netflix","expense")==="Suscripciones"`, `("PedidosYa")→"Restaurantes y delivery"`, `("Cochera")→"Auto"`, `("Creatina")→"Deporte"`, `("Veterinaria")→"Mascotas"`, `("Supermercado")→"Alimentación"`, `("Nafta")→"Transporte"`, `("Varios")→"Otros"`, `("Alquiler","income")→"Alquileres"`, `("Jubilación","income")→"Jubilación y asignaciones"`.
  - `reclassTarget("Netflix","expense")==="Suscripciones"`, `reclassTarget("Super y café","expense")===null`, `reclassTarget("Nafta y lavadero","expense")===null`, `reclassTarget("Supermercado","expense")===null` (existente), `reclassTarget("Varios","expense")===null`.
  - `categoryFamily("Restaurantes y delivery","expense")==="Alimentación"`, `categoryFamily("Tecnología","expense")==="Compras"`.
  - `sqlPatternFor(rule)` de Mascotas `=== "\\y(veterinaria|veterinario|balanceado|pet shop|petshop|mascota)\\y"`.
  - `categoryPromptLines()` contiene cada nombre de `CATEGORY_NAMES`.
  - En `tests/deterministic-parser.test.ts`: `parseDeterministicMovement("1500 café y facturas")` no es `null` y su `category` es `"Restaurantes y delivery"`; `"2000 nafta y lavadero"` → `"Auto"`; `"3000 super y netflix"` → `null` (familias distintas, va a IA como hoy). Cambiar las expectativas `category: 'Salud'` de creatina a `'Deporte'`.
- [ ] **Step 2:** `npx vitest run tests/category-rules.test.ts tests/deterministic-parser.test.ts` → FAIL (módulo inexistente / categorías viejas).
- [ ] **Step 3:** Crear `category-rules.ts` con el catálogo. En `local-movements.ts`, borrar el `categoryFor` local e importar el compartido; en la regla de varios conceptos reemplazar el `Set` de categorías por un `Set` de `categoryFamily(...)` (excluyendo `"Otros"`), manteniendo `> 1 → return null`.
- [ ] **Step 4:** `npx vitest run` (suite completa) → PASS. Ajustar solo expectativas que cambian por el catálogo aprobado (creatina, café, cochera, bar, netflix); cualquier otra falla es regresión a corregir.
- [ ] **Step 5:** Commit `feat(bot): catálogo de categorías ampliado y reglas compartidas (BE-20)`.

### Task 2: Prompt de IA

**Files:** Modify `supabase/functions/whatsapp-webhook/gemini.ts` (bloque "CATEGORÍAS:", aprox. 199–201). Test: `tests/category-rules.test.ts`.

**Interfaces:** Consumes `categoryPromptLines()` (Task 1).

- [ ] **Step 1: Test que falla:** leer `gemini.ts` como texto y afirmar que contiene `${categoryPromptLines()}` y ya no contiene la línea fija `* Gasto: Alimentación, Transporte, Vivienda`.
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3:** reemplazar las dos líneas fijas por la interpolación; importar desde `./category-rules.ts`.
- [ ] **Step 4:** `npx vitest run` → PASS; si Deno está instalado, `deno check --config supabase/functions/whatsapp-webhook/deno.ci.json supabase/functions/whatsapp-webhook/index.ts` → sin errores (si no está, registrarlo como no verificado; CI lo cubre).
- [ ] **Step 5:** Commit `feat(bot): prompt con categorías del catálogo compartido`.

### Task 3: Visuales en la PWA

**Files:** Modify `src/categoryVisuals.ts`, `src/Icons.tsx` (íconos de línea nuevos si hacen falta). Test: `tests/category-visuals.test.ts` (nuevo).

**Interfaces:**
- Produces: `export const NEW_CATEGORY_VISUALS: Record<string, { icon: IconName; color: string }>` en `src/categoryVisuals.ts` con las 15 categorías nuevas (Task 4 copia estos valores a SQL). `categoryVisual(name)` las devuelve.

- [ ] **Step 1: Tests que fallan:**
  - Para cada una de las 11 nuevas de gasto, `categoryVisual(name)` ≠ fallback (`icon !== 'receipt' || color !== '#596d78'`) y es igual a `NEW_CATEGORY_VISUALS[name]`.
  - Los 11 pares `icon+color` de gasto nuevos son distintos entre sí y distintos de los de Alimentación, Transporte, Compras, Ocio y Salud.
  - `Object.keys(NEW_CATEGORY_VISUALS).length === 15`.
  - `movementVisual('Alquileres','income').icon === 'arrowUpRight'` (ingresos sin cambios).
- [ ] **Step 2:** `npx vitest run tests/category-visuals.test.ts` → FAIL.
- [ ] **Step 3:** agregar entradas (regex por nombre normalizado, p. ej. `^restaurantes y delivery$`) y los íconos necesarios. Colores con contraste suficiente sobre blanco (≥ 3:1 para gráficos).
- [ ] **Step 4:** `npx vitest run`, `npm run lint`, `npm run build` → PASS.
- [ ] **Step 5:** Verificación visual en `preview_start pesito-local` (antes, confirmar en `.claude/launch.json` y la config de entorno que apunta a recursos locales/de prueba; si apunta a producción, no abrir y dejarlo sin verificar): selector de alta con 22 gastos en 375 y 1280 px, sin desbordes.
- [ ] **Step 6:** Commit `feat(pwa): íconos y colores de categorías nuevas (FE-24)`.

### Task 4: Migración 047 — catálogo y alta

**Files:** Create `supabase/migrations/047_extended_categories.sql`. Test: `tests/categories-catalog-sql.test.ts` (nuevo).

**Interfaces:**
- Consumes: `NEW_CATEGORY_VISUALS` (Task 3), `CATEGORY_NAMES` (Task 1).
- Produces: cada usuario tiene las 31 categorías; `public.bootstrap_user()` crea 31.

- [ ] **Step 1: Tests que fallan.** `beforeAll`: mismo armado que `tests/whatsapp-linking-sql.test.ts` (roles, `auth`, migraciones hasta 040), dos usuarios ficticios creados **antes** de 047; a uno se le inserta manualmente una categoría `('expense','Mascotas')` previa. Luego aplicar 047.
  - Cada usuario previo tiene exactamente 31 categorías activas; el set de `(kind,name)` es igual a `CATEGORY_NAMES`.
  - El usuario con `Mascotas` previa no tiene duplicados y conserva el `id` de esa fila.
  - Las 15 filas nuevas tienen `color`/`icon` iguales a `NEW_CATEGORY_VISUALS[name]`; las 16 existentes conservan sus valores previos.
  - Aplicar 047 dos veces no cambia conteos.
  - Alta nueva con invitación válida → 31 categorías, perfil/ajustes/vínculo creados.
  - Alta con falla forzada (trigger de fixture que lanza en `categories`, como `fixture()` de `tests/signup-sql.test.ts`) → error `REGISTRATION_INITIALIZATION_FAILED` y cero filas del usuario.
  - `has_function_privilege('anon','public.bootstrap_user()','execute')` es `false` (igual que antes).
- [ ] **Step 2:** `npx vitest run tests/categories-catalog-sql.test.ts` → FAIL (archivo inexistente).
- [ ] **Step 3:** escribir 047 dentro de `begin; … commit;`: `insert into public.categories(user_id,kind,name,color,icon) select u.id, v.kind, v.name, v.color, v.icon from auth.users u cross join (values …15…) v(kind,name,color,icon) on conflict (user_id,kind,name) do nothing;` y `create or replace function public.bootstrap_user()` copiada **de 040** con las 15 filas extra y ambos controles en `31`. Terminar con `notify pgrst, 'reload schema';`.
- [ ] **Step 4:** `npx vitest run` → PASS (incluido `tests/signup-sql.test.ts`, que carga hasta 039 y sigue esperando 16).
- [ ] **Step 5:** Commit `feat(db): 047 catálogo de categorías ampliado y alta con 31 (BE-20)`.

### Task 5: Migración 048 — reclasificación reversible

**Files:** Create `supabase/migrations/048_category_reclassification.sql`. Test: `tests/category-reclassification-sql.test.ts` (nuevo).

**Interfaces:**
- Consumes: `CATEGORY_RULES`, `sqlPatternFor`, `reclassTarget` (Task 1); migración 047.
- Produces (todas `security definer`, sin acceso `anon/authenticated`):
  ```sql
  public.category_reclass_rules(kind transaction_kind, name text, is_new boolean, pattern text, primary key(kind,name))
  public.category_reclass_log(id bigserial pk, run_id uuid, transaction_id uuid, user_id uuid,
                              from_category_id uuid, to_category_id uuid, applied_at timestamptz, reverted_at timestamptz)
  public.category_reclass_target(p_kind transaction_kind, p_description text) returns text
  public.category_reclass_candidates() returns table(transaction_id uuid, user_id uuid, kind transaction_kind,
                              from_category_id uuid, to_category_id uuid)
  public.category_reclass_preview() returns table(kind transaction_kind, from_category text, to_category text, movements bigint)
  public.category_reclass_apply() returns table(run_id uuid, moved bigint)
  public.category_reclass_revert(p_run_id uuid) returns bigint
  ```

**Reglas de `category_reclass_candidates()`** (copiar del spec, sección 4):
- Normalización SQL: `translate(lower(description),'áéíóúüñ','aeiouun')`; coincidencia `~ pattern`.
- `target`: exactamente una fila de `category_reclass_rules` del mismo `kind` coincide y tiene `is_new`.
- Filas elegibles: `status='confirmed'`, o cabecera (`status='cancelled' and installment_number is null and installment_group_id is null` y existe otra fila con `installment_group_id = id`). Excluidas `pending` y demás `cancelled`.
- Categoría actual del mismo usuario y nombre en origen: gasto `Alimentación, Transporte, Compras, Ocio, Salud, Otros`; ingreso `Otros`.
- Grupo = `coalesce(installment_group_id, id)`. Un grupo entra solo si **todas** sus filas elegibles tienen categoría de origen y el mismo `target`.
- `to_category_id`: categoría activa del mismo usuario, `kind` y nombre `target`; si no existe, el grupo no entra.

- [ ] **Step 1: Tests que fallan.** Armado como Task 4 + 047 + 048, con fixtures ficticios de dos usuarios:
  - **Paridad de reglas:** filas de `category_reclass_rules` = `CATEGORY_RULES.filter(r => r.keywords.length)` mapeadas a `{kind,name,is_new:r.isNew,pattern:sqlPatternFor(r)}`.
  - **Paridad de resultado:** para la lista `["Netflix","PedidosYa","Super y café","Nafta y lavadero","Supermercado","Varios","Creatina","Cochera","Veterinaria","Alquiler"]` × kind correspondiente, `category_reclass_target` = `reclassTarget`.
  - Vista previa: con Netflix en Ocio, Café en Alimentación, Creatina en Salud, "Super y café" en Alimentación, Netflix en Servicios (no origen), Netflix `pending`, "Alquiler" ingreso en Otros → filas `(Ocio→Suscripciones,1)`, `(Alimentación→Restaurantes y delivery,1)`, `(Salud→Deporte,1)`, `(Otros→Alquileres,1)`; nada más. La vista previa no modifica `transactions` (comparar hash de filas antes/después).
  - Cuotas: plan PWA (cabecera `cancelled` + 3 cuotas) "Notebook" en Compras → las 4 filas a Tecnología. Plan con una cuota editada a "Varios" → ninguna se mueve.
  - Aislamiento: el destino siempre es categoría del mismo usuario.
  - `apply` devuelve `moved` = suma de la vista previa; segunda ejecución → `moved = 0`.
  - `revert(run_id)` restaura todo; si antes de revertir el cliente cambió un movimiento a `Ocio` de nuevo o a otra categoría, ese movimiento no se toca y el resto sí.
  - Permisos: `has_function_privilege('authenticated', 'public.category_reclass_apply()', 'execute')` y el de `anon` son `false`; `has_table_privilege('authenticated','public.category_reclass_log','select')` es `false`.
- [ ] **Step 2:** `npx vitest run tests/category-reclassification-sql.test.ts` → FAIL.
- [ ] **Step 3:** escribir 048 (`begin; … commit;`): tablas con RLS + `revoke`, `insert` de reglas (generadas una vez con `sqlPatternFor` y pegadas literal), funciones según Interfaces. `apply`: un `run_id := gen_random_uuid()`, `insert into category_reclass_log … select from category_reclass_candidates()`, luego `update transactions set category_id = l.to_category_id, updated_at = now() from log l where l.run_id = run_id and transactions.id = l.transaction_id`. `revert`: `update … set category_id = from_category_id where category_id = to_category_id` y `reverted_at = now()` en las filas restauradas.
- [ ] **Step 4:** `npx vitest run` → PASS.
- [ ] **Step 5:** Commit `feat(db): 048 reclasificación reversible de categorías (sin aplicar)`.

### Task 6: Documentación y runbook

**Files:** Modify `docs/operaciones/DEPLOY_Y_ROLLBACK.md`, `docs/planes/PLAN_MEJORAS_PROYECTO.md` (filas FE-24/BE-20 y secciones), `docs/contexto/CONTEXTO_PESITO_PARA_CLAUDE.md`.

- [ ] **Step 1:** runbook — sección "Reclasificación de categorías (048)": orden 047 → webhook → PWA → 048; `select * from public.category_reclass_preview();` y revisión del propietario; con nueva autorización `select * from public.category_reclass_apply();` guardando `run_id` en la evidencia; reversión `select public.category_reclass_revert('<run_id>');`. Aclarar que revertir la PWA no revierte SQL ni webhook.
- [ ] **Step 2:** plan y contexto — FE-24/BE-20 "implementado en rama, sin publicar"; alcance redefinido (sin categorías propias del cliente); catálogo de 31.
- [ ] **Step 3:** Commit `docs: FE-24/BE-20 categorías ampliadas en rama y runbook de 048`.

### Task 7: Verificación final

- [ ] `npm run lint` → sin errores.
- [ ] `npm test` → todo PASS (anotar cantidad).
- [ ] `npm run build` → OK (la advertencia de chunk > 500 kB es previa).
- [ ] `npm run test:release:guards` → PASS.
- [ ] `npm run test:sql` y `npm run test:concurrency` si el entorno lo permite (Docker); si no, anotarlo como no verificado y que lo cubra CI.
- [ ] Registrar comandos y resultados; no abrir PR ni publicar sin pedido del propietario.
