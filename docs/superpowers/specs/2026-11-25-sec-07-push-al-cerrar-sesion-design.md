# SEC-07: dar de baja las notificaciones al cerrar sesión — diseño

Fecha: 25/11/2026. Tarea 2.3 del plan de remediación (hallazgo SEC-07). Aprobado por el propietario.

## Intención

Hoy cerrar sesión solo llama a `signOut`: el navegador sigue suscripto y `push_subscriptions` conserva la fila de la cuenta. Ese dispositivo sigue recibiendo los avisos de la cuenta anterior aunque después entre otra persona.

## Objetivos

- Al confirmar "Cerrar sesión", antes del `signOut`: borrar la suscripción de este dispositivo en el servidor (`delete_push_subscription`, exige sesión) y desuscribir el navegador.
- El navegador se desuscribe siempre, aunque falle el servidor. La fila que quede se limpia sola en el próximo envío (404/410 → `gone`, ya implementado).
- El cierre de sesión nunca se traba: errores ignorados y tope de 3 segundos.

## No objetivos

- Borrar en el servidor las suscripciones de una sesión revocada (no hay sesión para el RPC; se limpian con 404/410).
- Sin migración ni cambios en el bot.

## Enfoques

1. **Baja en el dispositivo y en el servidor antes del `signOut`, sin bloquear (elegido).**
2. Reasignar la suscripción al próximo usuario: descartado, mientras nadie entre los avisos siguen llegando.
3. Solo en el servidor: descartado, sin conexión no se borra y el navegador sigue suscripto.

## Diseño

- `src/pushNotifications.ts`: `releasePushOnSignOut(env?, timeoutMs = 3000): Promise<void>` (nunca lanza; borra en servidor y desuscribe en paralelo) y `signOutDevice(signOut, env?, timeoutMs?)` que llama a la baja y después a `signOut`.
- `src/App.tsx`: `handleConfirmSignOut` usa `signOutDevice(() => supabase.auth.signOut())`. Es el único punto de salida (cliente y Panel Admin).
- **Agregado tras la revisión final:** `signOut()` es global, así que los otros dispositivos de la cuenta quedan deslogueados por `onAuthStateChange` sin pasar por el botón. Al recibir `SIGNED_OUT`, `App.tsx` llama a `unsubscribeBrowserPush()` (desuscribe solo el navegador; nunca lanza). Cubre también tokens revocados o vencidos.
- Consecuencia: quien vuelva a entrar en ese dispositivo reactiva las notificaciones en Ajustes.

## Publicación

Solo PWA (merge a `main`, Pages). Rollback: PWA anterior.
