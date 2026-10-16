# INF-10 — Entornos, deploy y rollback

Fecha: 16/10/2026. Estado: ensayo completo aprobado en CI; integración final por PR pendiente.

## Implementación

Configuración pública centralizada y validada antes de arrancar Vite/compilar. Desarrollo exige un backend loopback explícito, rechaza producción y service role; el build habitual mantiene producción. La configuración validada se inserta como constante, para que el bundle del ensayo no contenga el destino/clave de producción.

CLI de deploy fijada en .supabase-version (2.120.0). Guía actualizada para todas las migraciones 001–024, workdir aislado, secretos de Edge/Vault, activación de cola y URLs Auth separadas. Runbook con registro de versiones/hashes, orden SQL/Edge/Pages y rollback compatible sin restaurar datos. BE-13, FE-07 e INF-08 siguen abiertos.

El manifiesto exige checkout limpio y no consulta cloud. El preparador local no sobrescribe un workdir existente; deja la cola apagada, desprograma cron y bloquea el dispatch externo mediante una migración solo del workdir. Las migraciones aplicadas de producción no se editan.

## Ensayo automatizado

Job Ensayo de release en Ubuntu 24.04, con Node del repositorio y CLI 2.120.0, permisos contents:read, sin secretos de Supabase/Meta/Gemini. Extrae candidato y rollback 894e1a0 con git archive; levanta Supabase local real, comprueba las 24 migraciones, Auth/perfil/categorías y denegación de RPC a anon; sirve webhook y compila/sirve PWA. Vuelve al código compatible, comprueba SW/version y que siga el movimiento sintético sin restaurar SQL.

Se detiene el stack en finally y se publica solo evidencia saneada por siete días. El job Publicar depende de los cuatro controles. No implica un staging alojado ni verificación de Meta/Gemini reales o de dispositivos instalados.

## Validaciones observadas hasta ahora

- 190 tests Vitest (13 archivos), incluidos cinco casos de destinos/credenciales.
- Seis controles Node del ensayo: loopback, limpieza de variables heredadas, ocultación de salida de comandos fallidos, SW/version coherentes y rechazo de sobrescritura y motor Docker exclusivamente local.
- 12 escenarios SQL, ESLint, TypeScript y build aprobados.
- actionlint 1.7.12 aprobado; SHA upload-artifact v4.6.2 verificado contra la referencia oficial.
- El motor Docker Desktop local devuelve error 500 al consultar su API; no se instaló WSL ni se cambió la configuración del sistema. Se usa CI Linux para el ensayo completo.
- El aviso de bundle >500 kB continúa en el backlog frontend.

No se ejecutaron migraciones, restauraciones, cambios de secretos ni despliegue del webhook en producción en este punto. El [ensayo 38932608913](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/38932608913) aprobó las seis fases con Supabase local real: instalación de 24 migraciones (53 s), Auth/permisos, candidato (11 s) y rollback compatible (12 s), sin restaurar datos ni enviar mensajes. El checkout probado es el merge sintético 06555f3 de GitHub para el head e36d850; no se confunde con un despliegue productivo. Los otros tres checks también aprobaron. [Evidencia](evidencias/INF_10_2026-10-16.json).

La revisión final añade verificación del motor Docker por socket local, versiones observadas y evidencia escrita solo tras detener el stack. Debe aprobar nuevamente CI antes del merge. No se requiere instalar WSL en esta PC.
