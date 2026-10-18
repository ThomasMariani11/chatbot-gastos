# INF-11 — Actions verificadas y permisos mínimos

Fecha: 18/10/2026. Estado: implementada y validada estáticamente; CI y publicación pendientes.

## Resultado de la revisión

INF-06 ya había fijado las Actions por SHA, separado permisos de escritura y desactivado la persistencia de credenciales. INF-10 añadió el ensayo y su timeout. No se atribuyen esos problemas históricos al workflow actual.

Quedaban una revisión periódica de las Actions y pages:read en el job de build. Además, la Action compuesta upload-pages-artifact v3.0.1 usaba internamente upload-artifact@v4, aun cuando la referencia externa estaba fijada. No se encontró esa dependencia móvil en las otras Actions revisadas.

Se agrega Dependabot semanal para Actions, se mueve configure-pages al job de deploy, se elimina pages:read del build y se usa empaquetado tar equivalente al oficial con upload-artifact por SHA. La subida conserva nombre github-pages, artifact.tar y retención de un día. Los PR prueban el empaquetado y no suben el sitio ni publican. No hay automerge.

## Verificación

- Los SHA se contrastaron con tags de sus repositorios oficiales mediante git ls-remote, incluidos los tags anotados. Se verificó action.yml para detectar uses internos. Los seis SHA conservados tienen versiones oficiales coincidentes; los comentarios ahora identifican la versión completa.
- actionlint 1.7.12: sin errores en el workflow modificado.
- Lectura de API: default_workflow_permissions=read; can_approve_pull_request_reviews=false. Main exige Frontend, Webhook, PostgreSQL y Ensayo de release con strict=true; enforce_admins=true; force push y borrado deshabilitados. Sin cambios administrativos.
- Versiones de Node, Deno, Supabase y PostgreSQL, secrets y runtime del bot permanecen iguales. No requiere SQL ni deploy Edge.

El cierre requiere los cuatro checks en el PR, integración protegida, Publicar aprobado desde main y version.json con el SHA publicado. El runbook explica verificación de origen, revisión de permisos, actualizaciones de major y recuperación mediante PR. La primera ejecución programada de Dependabot y futuras propuestas se revisarán en el repositorio: aún no se atribuye éxito a una ejecución futura.

[Procedimiento](../operaciones/MANTENIMIENTO_ACTIONS.md). [Evidencia de revisión](evidencias/INF_11_2026-10-18.json).
