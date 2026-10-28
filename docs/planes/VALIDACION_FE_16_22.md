# Validación FE-16 y FE-22 — Contraste de botones y especificidad de pestañas de acceso

## 1. FE-16 — Contraste accesible de botones
- **Variables y variantes actualizadas (`app/globals.css`, `app/forms.css`, `app/interactions.css`, `app/movements.css`, `src/styles.css`, `src/ui.css`, `src/Dashboard.tsx`):**
  - Se definieron `--button-primary-bg: #047857`, `--button-primary-ink: #ffffff`, `--button-primary-hover: #065f46`, `--mint-dark: #047857` y `--muted: #52655b`, conservando `--mint: #20b984` únicamente en elementos decorativos donde no interviene texto.
  - **Relaciones de contraste WCAG 2.2 medidas:**
    - Botón primario / envío (`.primary-button`, `.auth-card form button[type="submit"]`, `.modal-btn-save`, `.settings-save-button`, `.desktop-add`, `.mobile-nav button`): `#ffffff` sobre `#047857` = **5,48:1** (hover `#ffffff` sobre `#065f46` = **7,68:1**), reemplazando el antiguo `#ffffff` sobre `#20b984` (**2,52:1**).
    - Botón secundario (`.button-secondary`): `#1f352b` sobre `#ffffff` = **12,56:1**; `.modal-btn-cancel`: `#3b4e47` sobre `#f2f5f3` = **8,08:1**.
    - Botón de peligro (`.danger-button`): `#991b1b` sobre `#fff1f1` = **7,46:1**; `.modal-btn-delete`: `#a82e2b` sobre `#fdf4f3` = **6,28:1**; `.admin-modal-actions .danger-button`: `#b91c1c` sobre `#fee2e2` = **5,30:1**.
    - Pastillas y pestañas (`.currency-pill`, `.mode-pill`, `.tab-btn`, `.pill-btn`): `#475852` sobre `#edf3ef` = **6,70:1** y `#475569` sobre `#f5f8f6` = **7,09:1**.
  - Foco visible (`outline: 3px solid var(--mint-dark)`) y diferenciación de estados activos mediante borde (`1px solid #b9d8c9`), superficie elevada y peso tipográfico (`font-weight: 800`), sin depender exclusivamente del color.

## 2. FE-22 — Especificidad y navegación por teclado en pestañas de acceso
- **Especificidad coherente (`app/forms.css`, `src/styles.css`, `src/ui.css`):**
  - Se acotó `.auth-card button` en `app/forms.css` a `.auth-card form button[type="submit"]` para no sobrescribir `.auth-tab` ni `.button-link`.
  - Se definieron `.auth-tabs .auth-tab` y `.auth-tabs .auth-tab.active` sin usar `!important`:
    - Pestaña inactiva: `background: transparent`, `color: #52655b` sobre `#eef3f0` (**5,55:1**).
    - Pestaña activa: `background: #ffffff`, `color: #047857` (**5,48:1**), `border: 1px solid #b9d8c9`, `font-weight: 800` y sombra suave.
- **Navegación por teclado (`src/Login.tsx`):**
  - Soporte para `ArrowLeft`, `ArrowRight`, `Home` y `End` en `.auth-tabs[role="tablist"]`, actualizando `aria-selected`, la pestaña activa y el foco (`document.activeElement`), además de cancelar cualquier verificación pendiente de código al volver a *Iniciar sesión*.

## 3. Pruebas automatizadas
- `tests/button-contrast-and-auth-tabs.test.ts` (3 pruebas):
  - Cálculo de luminancia relativa y verificación de umbral WCAG AA (`>= 4.5:1`) en todas las variantes activas de botones y pestañas.
  - Verificación estructural de selectores en `app/forms.css` y `src/styles.css` sin `!important` en `.auth-tabs .auth-tab`.
  - Prueba DOM de `Login` validando alternancia por clic y por teclado (`ArrowLeft`, `ArrowRight`, `Home`, `End`) sin alterar el botón de envío.
