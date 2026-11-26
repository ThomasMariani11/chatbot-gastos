# Pantalla de inicio animada — diseño

Fecha: 25/11/2026 · Rama: `feat/pantalla-inicio-animada` (desde `main`)

## Intención

Hoy Pesito abre mostrando solo el texto "Abriendo Pesito…" y, antes de que cargue el JavaScript, una pantalla en blanco. El propietario quiere un arranque con movimiento y con el logo.

## Qué se ve (elegido por el propietario)

- Fondo verde Pesito `#20b984` (igual al `theme-color`).
- El chanchito del logo flota suavemente arriba y abajo.
- La moneda cae y **entra en la ranura** (se recorta al pasarla), en bucle.
- Debajo, "Pesito" en blanco y una barra fina que **avanza rápido y se va frenando** hasta quedar casi llena (~92 %). No se reinicia: queda así hasta que la app abre.

## Objetivos / no objetivos

- Objetivo: que la animación se vea desde el primer instante y sin salto al pasar a React.
- No objetivo: cambiar las cargas internas ("Abriendo Ajustes…", "Abriendo Administración…", etc.); siguen con texto. *(Decisión del agente.)*
- Anti-objetivo: demorar la apertura para "terminar" la animación, sumar dependencias o JavaScript en `index.html`.

## Enfoques considerados

1. **Solo en React** — simple, pero la animación aparece recién después del blanco de carga del bundle. Descartado.
2. **En `index.html` + componente React con el mismo dibujo** — se ve desde el primer pintado; la CSP ya permite `<style>` en línea (`style-src 'unsafe-inline'`) y no hace falta script. **Elegido.**

## Cómo se construye

- `index.html`: dentro de `<div id="root">` va el marcado de la pantalla de inicio (SVG en línea del chanchito simplificado del `favicon.svg`) y en `<head>` un `<style>` con las clases `pesito-splash*` y sus `@keyframes`. React reemplaza el contenido de `#root` al montar.
- `src/Splash.tsx`: componente con el mismo marcado y clases (las reglas CSS viven solo en `index.html`, una sola fuente). Reemplaza los cuatro "Abriendo Pesito…" de arranque en `App.tsx` (guardas de sesión/perfil y los dos `Suspense`).
- Continuidad de la barra: el componente React fija `animation-delay: -<performance.now()>ms` en la barra, así sigue desde donde iba la del HTML (performance.now() cuenta desde el inicio de la navegación) en lugar de volver a cero. *(Decisión del agente.)*
- Accesibilidad: contenedor con `role="status"` y texto "Abriendo Pesito…" solo para lectores de pantalla; SVG `aria-hidden`.
- `prefers-reduced-motion: reduce`: chanchito quieto, sin moneda cayendo, sin barra; se muestra el texto "Abriendo Pesito…" visible. *(Decisión del agente.)*
- Sin dependencias nuevas; sin cambios de CSP, service worker ni backend.

## Verificación

- Tests Vitest: `index.html` contiene la pantalla de inicio dentro de `#root` y no agrega `<script>` en línea; `Splash` renderiza `role="status"` con el texto accesible; la CSP existente sigue pasando.
- `npm run lint`, `npm test`, `npm run build`.
- Revisión visual en el navegador integrado con `pesito-local` (destinos de prueba verificados antes, según CLAUDE.md), incluida la variante de movimiento reducido.

## Queda para el implementador

- Tiempos exactos de las animaciones (referencia: flotar 2,2 s; moneda 1,8 s; barra ~6 s con `cubic-bezier(.2,.7,.3,1)`).
- Actualizar `docs/contexto/CONTEXTO_PESITO_PARA_CLAUDE.md` con el cambio.
