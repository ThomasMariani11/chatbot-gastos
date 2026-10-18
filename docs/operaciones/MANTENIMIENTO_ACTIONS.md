# Mantenimiento de GitHub Actions

## Permisos y publicación

Los jobs de build, webhook, PostgreSQL y ensayo heredan únicamente contents:read. Checkout tiene persist-credentials:false; los comandos de build no reciben credenciales del repositorio en Git. Los permisos pages:write e id-token:write pertenecen solo al job Publicar, desde main y después de aprobar los cuatro controles. La consulta/configuración de Pages se ejecuta en ese job.

El sitio se empaqueta con tar en artifact.tar, eliminando enlaces simbólicos y duros mediante dereference y hard-dereference. Se sube con actions/upload-artifact fijado por SHA, nombre github-pages y retención de un día. El paso de empaquetado también se ejecuta en PR, pero la subida y el deploy se limitan a main. Esto evita la dependencia interna móvil actions/upload-artifact@v4 de upload-pages-artifact v3.0.1.

Cada job tiene un timeout: 10 minutos para las validaciones/publicación y 25 para el ensayo completo. Los PR no publican. Los cuatro checks son estrictos y también obligan al administrador; no se permite force push ni borrar main.

## Revisión de versiones

Dependabot revisa únicamente el ecosistema github-actions los lunes a las 09:00 de Argentina. Agrupa propuestas y mantiene como máximo un PR abierto de actualizaciones de versión. No hay automerge: cada propuesta se revisa y pasa los mismos controles. Los avisos de seguridad del repositorio mantienen su funcionamiento propio.

Antes de integrar una actualización:

1. Confirmar el repositorio de origen y que el SHA completo de 40 caracteres coincide con la versión oficial indicada en el comentario. Consultar las referencias oficiales con git ls-remote --tags https://github.com/OWNER/ACTION.git; para tags anotados, usar su referencia desreferenciada.
2. Revisar notas de versión, runtime de Node, permisos requeridos y cambios en action.yml, incluidos pasos uses internos de acciones compuestas. No cambiar un SHA por un tag o una rama.
3. Comprobar que los tests no reciben secretos y que pages/id-token continúan reservados al job de deploy. No agregar pull_request_target, escritura global o pasos de aprobación automática para hacer pasar una actualización.
4. Exigir Frontend, Webhook, PostgreSQL y Ensayo de release. Revisar cambios de major individualmente aunque lleguen agrupados; dividir el PR si hace falta.
5. Después del merge, verificar Publicar y version.json. Si falla una actualización, corregir/revertir por PR conservando la protección.

Mensualmente revisar las propuestas pendientes y comprobar que Dependabot está funcionando. Si hay un aviso de seguridad relevante, revisar la corrección sin esperar a la revisión mensual. Node, Deno, Supabase CLI, paquetes npm e imágenes de base mantienen sus versiones y procedimientos propios; esta configuración no los actualiza automáticamente.

Las actualizaciones del runner alojado ubuntu-24.04 siguen bajo administración de GitHub. Este procedimiento fija las Actions utilizadas, no el sistema completo del runner ni sus servicios.

## Referencias

- [Seguridad de Actions](https://docs.github.com/en/actions/reference/security/secure-use).
- [Actualizar Actions con Dependabot](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/auto-update-actions).
- [Empaquetado oficial de upload-pages-artifact v3.0.1](https://github.com/actions/upload-pages-artifact/blob/56afc609e74202658d3ffba0e8f6dda462b719fa/action.yml).
- [Validación de INF-11](../planes/VALIDACION_INF_11.md).
