# Validación y publicación de FE-13

Fecha: 28/10/2026.
Rama: `codex/fe-13-invitation-validation-race-conditions`.
Alcance: Descartar respuestas antiguas de validación de invitación (`FE-13`).

## Problemas resueltos

1. **Condiciones de carrera en validación de códigos de invitación:**
   - Cancelar el temporizador de debounce no cancelaba las solicitudes HTTP ya despachadas. Si una solicitud anterior para un código inválido tardaba en responder y se resolvía después de una solicitud posterior para un código válido, sobrescribía el estado de la interfaz como inválido y bloqueaba indebidamente el botón de envío.
2. **Desacople entre el código validado y el estado visible en pantalla:**
   - La estructura de estado no guardaba a qué código correspondía el resultado (`codeState.code`), permitiendo que badges de éxito o error permanecieran visibles aun cuando el usuario hubiese modificado o borrado el texto del campo.
3. **Peticiones en vuelo no canceladas al desmontar o cambiar de pestaña:**
   - Si el usuario cambiaba a la pestaña de inicio de sesión o desmontaba el componente mientras se verificaba un código, la resolución tardía intentaba actualizar el estado del formulario.
4. **Diferenciación entre error de red y código inválido:**
   - Ante fallos de conexión o timeout en el preflight, el estado no debe catalogar el código como inválido de forma definitiva (`valid: false`), sino permitir al usuario reintentar manteniendo el formulario intacto.

## Cambios realizados

### 1. `src/Login.tsx`
- **Asociación de estado al código (`CodeCheckState.code`):**
  - Se incorporó `code?: string` en el estado de verificación.
  - Los badges de feedback (`checking`, `valid`, `invalid`) solo se renderizan si `codeState.code === inviteCode`.
  - El botón de envío solo se deshabilita por código inválido si el resultado adverso corresponde exactamente al código actual: `codeState.valid === false && codeState.code === inviteCode`.
- **Cancelación activa con `AbortController`:**
  - Se introdujo `abortControllerRef` que aborta activamente la petición HTTP en curso (`controller.abort()`) al cambiar el valor del input, borrar el texto, cambiar de pestaña o desmontar el componente.
  - Se vincula el signal al builder de Supabase: `rpcBuilder.abortSignal(controller.signal)`.
- **Descarte de respuestas fuera de orden por generación y código:**
  - `checkCode` verifica que tanto la generación (`request === codeRequestRef.current`) como el texto del código (`clean === inviteCodeRef.current`) y el signal no abortado sigan vigentes antes de aplicar cualquier mutación de estado.
  - Si una respuesta vieja llega tarde, se descarta silenciosamente sin afectar el estado actual.
- **Limpieza al cambiar de pestaña:**
  - Al hacer click en "Iniciar sesión", se aborta cualquier consulta de invitación pendiente y se cancela el temporizador de debounce.

### 2. Pruebas automatizadas (`tests/signup-ui.test.ts`)
- Se agregaron 3 nuevas pruebas de UI con React y Testing Library/act:
  1. `FE-13: una respuesta tardía de código inválido no invalida el código nuevo válido ni bloquea el envío`: simula dos peticiones concurrentes donde la primera (inválida) resuelve después de la segunda (válida). Comprueba que el estado permanezca válido y el botón habilitado.
  2. `FE-13: borrar el código de invitación descarta cualquier respuesta previa y no muestra mensajes residuales`: comprueba que al vaciar el campo, las respuestas en vuelo se descarten y no dejen badges de error o éxito.
  3. `FE-13: cambiar a la pestaña de login cancela la validación y no aplica la respuesta resuelta mientras estaba oculta`: verifica que la pestaña de login descarte consultas en curso.

## Evidencia de validación técnica

- **Vitest:** 47 suites pasadas, 1.061 pruebas pasadas (0 fallos).
- **Pruebas SQL de integración:** 12 escenarios aprobados (`npm run test:sql`).
- **Guardas de release:** 6 pruebas aprobadas (`npm run test:release:guards`).
- **Linting:** 0 errores (`npm run lint`).
- **Compilación TypeScript y Vite:** aprobada sin errores (`npm run build`).
