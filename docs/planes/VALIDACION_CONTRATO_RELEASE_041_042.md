# Validación del contrato de release 041/042

Fecha: 29/10/2026. Base: `768668e`, rama `codex/release-contract-041-042`.

## Alcance

Contrato y herramientas de ensayo; sin migraciones nuevas/modificadas, cambios funcionales del bot/PWA ni operaciones productivas. Los datos y credenciales de los ensayos son ficticios/locales. Preserva las ediciones locales previas del propietario en su checkout original.

## Contrato implementado en rama

- Candidato: mínimo 042, requerido por bajas/ediciones múltiples de BE-22.
- Rollback: `ecba42024d413ef05a2a4d1abeb04bdbb97e869e`, mínimo 041.
- Los mínimos deben cubrir el inventario completo de cada snapshot; hashes del SQL compartido inmutables. El manifiesto no certifica despliegue.
- Matriz requerida: ecba420/041 en un stack independiente; candidato/042; ecba420 sobre la misma base 042 conservando datos.
- No se acepta compatibilidad de checkpoints BE-22 en vuelo: el cambio de runtime exige quietud y no elimina pendientes.
- Guardas de aislamiento conservadas y nuevos controles de mínimos/historial/hashes/matriz. Probes de errores seguros, expiración, vinculación y procesamiento real con envío simulado y tráfico externo denegado.

## Evidencia y límites

Controles locales: lint aprobado, 1111 pruebas Vitest aprobadas, 12 escenarios SQL aprobados, 14 guardas aprobadas y build/TypeScript aprobados. El primer build detectó la declaración faltante del nuevo helper `.mjs`; se agregó el contrato `.d.mts` y el build posterior pasó.

El nuevo smoke SQL pasó dentro de la suite `safe-errors` contra PGlite con 040/041; verifica permisos, expiración y límites de invitaciones, vinculación en cola y rollback completo ante fallos de persistencia. Esa prueba no reemplaza Supabase/Auth/Edge locales completos.

Se obtuvo Node 22.23.3 temporalmente sin cambiar Node global. Docker Desktop no pudo arrancar en esta PC: terminó inesperadamente y su named pipe Linux no estuvo disponible. No se modificaron WSL/BIOS ni se tocaron otros stacks.

La matriz completa **aprobó en el runner aislado**, en [CI #285 / PR #71](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/40944302580), código `3690a92`, merge sintético de prueba `b2e6230`. Los cuatro controles aprobaron y Publicar quedó omitido. El arnés completó el rollback sobre 041 y la ida/vuelta sobre 042, comprobó las tres filas y generó el artefacto saneado después de limpiar el stack. [Registro de conclusiones, fases y metadata del artefacto](evidencias/CONTRATO_RELEASE_041_042_CI_2026-10-29.json). Este registro deriva del resultado/los logs estructurados del job; no se presenta como una lectura del ZIP ni una verificación de producción.

El primer ensayo detectó que algunos conceptos ficticios incluían palabras de comando/números escritos y requerían interpretación fuera del caso determinista. Se corrigieron solo los fixtures, se comprobó que ambos parsers los resuelvan localmente y se repitió la matriz completa. No se cambiaron las reglas funcionales ni se quitaron controles para aprobarla.

El rollback queda acreditado para los contratos y datos ficticios de esta matriz. Siguen **sin verificar** el esquema/Edge de producción en esta tarea y la compatibilidad de checkpoints BE-22 en vuelo; las guardas, las pruebas SQL en memoria o la compilación por sí solas no reemplazan la matriz.

No se consultó ni modificó producción. Si el historial alojado sigue en 041, el candidato que requiere 042 no queda habilitado por este cambio de configuración. No se desplegó webhook ni se publicó PWA.
