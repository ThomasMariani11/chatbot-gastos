# Validación FE-15 — Centralizar diálogos accesibles y etiquetas de formularios

## Alcance
- **Componente compartido `ModalDialog` (`src/ModalDialog.tsx`):**
  - Semántica accesible WAI-ARIA APG (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby` opcional y `tabIndex={-1}`).
  - Inercia del fondo mientras el diálogo está abierto (`aria-hidden="true"` e `inert` sobre los hermanos fuera del modal y bloqueo de `document.body.style.overflow = 'hidden'`, restaurando los atributos originales al cerrar).
  - Gestión de foco inicial hacia el primer campo editable o control preferido del diálogo (con reevaluación cuando un formulario asíncrono termina de habilitar su `fieldset`).
  - Confinamiento de foco (`Tab` y `Shift+Tab` ordenados según posición real en el DOM mediante `compareDocumentPosition`, más recuperación ante `focusin` externo).
  - Cierre con tecla `Escape` y clic en el fondo cuando el diálogo no está ocupado (`!busy`), restaurando el foco al botón disparador (o al disparador del menú contextual cuando el ítem de menú se desmonta al abrir el modal).
- **Diálogos centralizados:**
  - `src/Dashboard.tsx`: alta de movimiento (`showAdd`), edición de movimiento/plan (`editingMovement`), eliminación de cuotas (`installmentDeletePrompt`), presupuesto mensual (`showBudgetModal`), confirmación de eliminación de presupuesto (`showDeleteBudgetConfirm`) y distribución por categorías (`showCategoryModal`).
  - `src/AdminPanel.tsx`: pausa global del bot (`confirmingBotPause`), extensión de membresía (`extendingClient`) y pausa/reactivación de cuenta (`suspendingClient`).
  - `src/InstallAppModal.tsx`: modal de instrucciones de instalación PWA.
- **Asociación explícita de etiquetas (`label`/`htmlFor` e `id`) y foco visible:**
  - El campo de importe del alta (`#add-movement-amount`) reemplaza el `<span>` sin asociación por `<label htmlFor="add-movement-amount">`, reflejando dinámicamente `Monto`, `Monto total de la compra` o `Monto por cuota`.
  - Todos los campos de alta, edición, presupuesto y administración cuentan con `id` y `<label htmlFor>` explícitos, además de `aria-describedby` hacia los mensajes de error o ayuda (`#add-movement-custom-installment-error`, `#edit-movement-custom-installment-error`, `#admin-bot-phone-hint`).
  - Eliminación de `outline: none !important` en `.settings-input` y `outline: none` en botones de modal, garantizando contorno `:focus-visible` en controles interactivos.
- **Comportamiento definido al cerrar con datos sin guardar:**
  - En el alta de movimientos (`showAdd`), cerrar con `Escape`, `×` o `Cerrar` conserva el borrador en memoria para que el usuario no pierda lo escrito si vuelve a abrir el formulario.
  - En la edición (`editingMovement`) y presupuesto (`showBudgetModal`), cerrar con `Escape`, `×` o `Cancelar` descarta los cambios no guardados y preserva el valor confirmado.

## Verificación ejecutada
- `npx vitest run tests/accessible-dialogs-and-labels.test.ts` (4 tests aprobados)
- `npm run lint`
- `npm run build`
- `npm test`
- `npm run test:sql`
- `npm run test:release:guards`
