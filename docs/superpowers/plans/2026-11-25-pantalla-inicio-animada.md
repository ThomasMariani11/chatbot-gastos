# Pantalla de inicio animada — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar "Abriendo Pesito…" por una pantalla de inicio con el chanchito flotando, la moneda entrando en la ranura y una barra que avanza y se frena.

**Architecture:** El marcado y el CSS viven en `index.html` (se pinta antes del bundle). `src/Splash.tsx` repite el mismo marcado, sin CSS propio, y React lo usa en el arranque; la barra se sincroniza con `animation-delay` negativo a partir de `performance.now()`.

**Tech Stack:** HTML/CSS/SVG en línea, React 19, Vitest 4 + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-25-pantalla-inicio-animada-design.md`

## Global Constraints

- Sin dependencias nuevas; sin `<script>` en línea (CSP `script-src 'self'`).
- Fondo `#20b984`; chanchito con los colores planos del `favicon.svg` (`#45c992`, `#1b8d60`, `#0a5238`, `#062f20`, moneda `#ffcc45`/`#c4860a`).
- Tiempos: flotar 2,2 s `ease-in-out` infinito; moneda 1,8 s `ease-in` infinito; barra 0→92 % en 6 s `cubic-bezier(.2,.7,.3,1)` `forwards` (no se reinicia).
- Texto accesible "Abriendo Pesito…" con `role="status"`; SVG `aria-hidden="true"`.
- `prefers-reduced-motion: reduce`: sin animaciones, sin moneda, sin barra, texto visible.
- Las cargas internas (`ScreenFallback` con otras etiquetas) no cambian.

## Review Focus

- Cambio de HTML a React: la barra no debe volver a 0 → el test de Task 2 verifica el `animation-delay` negativo.
- Movimiento reducido: el texto debe quedar visible → regla CSS cubierta en el test de Task 1.
- Divergencia entre el marcado de `index.html` y `Splash.tsx` → test de Task 2 compara las clases de ambos.
- Barra o moneda en iOS standalone con `viewport-fit=cover`: centrado vertical con `min-height: 100dvh` → revisión visual de Task 3.
- CSP: no colar scripts ni atributos `on*` → test de Task 1.

---

### Task 1: Pantalla de inicio en `index.html`

**Files:**
- Modify: `index.html` (`<head>`: bloque `<style>`; `<div id="root">`: marcado)
- Test: `tests/splash.test.ts` (nuevo)

**Interfaces — Produces:** clases `pesito-splash`, `pesito-splash__pig`, `pesito-splash__coin`, `pesito-splash__slot`, `pesito-splash__name`, `pesito-splash__track`, `pesito-splash__bar`, `pesito-splash__label`; `clipPath id="pesito-splash-above"` (recorta la moneda por encima de la ranura, y = 54 en el viewBox 0 0 170 170).

- [ ] **Step 1: Test que falla** — `describe('pantalla de inicio en index.html')`:
  - `#root` (parseado con `JSDOM`) contiene `.pesito-splash[role="status"]` y `.pesito-splash__label` con texto `Abriendo Pesito…`.
  - contiene `.pesito-splash__coin` y `.pesito-splash__bar`.
  - el HTML no matchea `/<script(?![^>]*\bsrc=)/` (sin scripts en línea) ni `/\son\w+=/`.
  - el `<style>` incluye `prefers-reduced-motion: reduce` y `#20b984`.
- [ ] **Step 2:** `npx vitest run tests/splash.test.ts` → FAIL.
- [ ] **Step 3:** Agregar marcado y CSS. La ranura se dibuja después de la moneda (queda por delante). Label visualmente oculto salvo en movimiento reducido.
- [ ] **Step 4:** `npx vitest run tests/splash.test.ts tests/browser-security.test.ts tests/brand-assets.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(ui): pantalla de inicio animada en index.html`.

### Task 2: Componente `Splash` y uso en el arranque

**Files:**
- Create: `src/Splash.tsx`
- Modify: `src/App.tsx` (líneas 53, 57, 252, 341 de `main`: los cuatro "Abriendo Pesito…")
- Test: `tests/splash.test.ts`

**Interfaces — Consumes:** las clases de Task 1. **Produces:** `export function Splash(): JSX.Element`.

- [ ] **Step 1: Tests que fallan** (`// @vitest-environment jsdom` en un archivo aparte `tests/splash-component.test.ts`):
  - render de `Splash` → `[role="status"]` con texto `Abriendo Pesito…`.
  - con `performance.now` mockeado a `1500`, `.pesito-splash__bar` tiene `style.animationDelay === '-1500ms'`.
  - el conjunto de `class` de todos los elementos de `Splash` es igual al del `#root` de `index.html`.
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3:** Implementar `Splash` (delay calculado una vez con `useState(() => …)`, redondeado a ms enteros). En `App.tsx` reemplazar los dos `<main><p className="loading-copy">Abriendo Pesito…</p></main>` y los dos `fallback={<ScreenFallback label="Abriendo Pesito…" />}` por `<Splash />`.
- [ ] **Step 4:** `npm test` → PASS (incluye `lazy-loading.test.ts`, que no debe cambiar).
- [ ] **Step 5:** Commit `feat(ui): usar la pantalla de inicio animada al abrir Pesito`.

### Task 3: Verificación y documentación

- [ ] `npm run lint` y `npm run build` sin errores.
- [ ] Antes de abrir el navegador: confirmar en `.env*`/config que el frontend local apunta a recursos de prueba (sin imprimir secretos). Si apunta a producción, revisar solo la pantalla de inicio sin iniciar sesión.
- [ ] `preview_start pesito-local`: captura de la pantalla de inicio (animación, barra frenándose, transición a React sin salto) y con `prefers-reduced-motion` emulado.
- [ ] Agregar una entrada en `docs/contexto/CONTEXTO_PESITO_PARA_CLAUDE.md`; commit `docs: registrar la pantalla de inicio animada`.
