# Instrucciones de trabajo — Pesito

## Contexto para Claude: mantenimiento obligatorio

El contexto vivo del proyecto es `docs/contexto/CONTEXTO_PESITO_PARA_CLAUDE.md`.
Leerlo al comenzar una tarea y mantenerlo actualizado como parte del mismo trabajo.

La instrucción expresa del propietario es que toda mejora, corrección, modificación,
eliminación o cambio relevante se refleje en ese documento. Incluye frontend, backend,
reglas del bot, SQL, infraestructura, IA, configuración, despliegues, límites y decisiones
que afecten al producto o a su operación.

Antes de dar por terminado un cambio:

1. Actualizar las secciones afectadas para que describan el comportamiento vigente.
   No limitarse a añadir una nota histórica si el cuerpo quedó contradictorio.
2. Si se quita una función, retirarla de las capacidades actuales y explicar su reemplazo
   o impacto cuando corresponda. No dejarla presentada como disponible.
3. Mantener alineados funcionalidades, reglas, contratos, límites, arquitectura,
   archivos relevantes, comandos y pendientes. Actualizar inventarios si cambian
   migraciones, tablas o módulos.
4. Distinguir claramente entre propuesta, implementación en rama, integración en main,
   publicación web, migración aplicada y webhook desplegado. Un merge no prueba
   que una migración o el bot estén publicados.
5. Actualizar fecha, referencia funcional conocida y evidencia cuando corresponda.
   No inventar versiones, pruebas, despliegues o verificaciones. Si no se comprobó
   producción, conservar la última observación fechada y explicitar el límite.
6. Incluir el contexto junto con el cambio en la misma propuesta/commit/PR cuando
   corresponda. Tras verificar un despliegue, dejar también su estado documentado.
7. Preservar ediciones locales o concurrentes: revisar el diff y fusionar el contenido;
   no regenerar ni sobrescribir el documento ciegamente.
8. No incorporar claves, tokens, contraseñas, teléfonos, conversaciones, comprobantes
   o movimientos reales de clientes. Usar ejemplos ficticios.

No considerar cerrado el trabajo si el contexto sigue describiendo incorrectamente
lo cambiado. Si un cambio puramente interno no altera capacidades, dejar constancia
breve del alcance sin inventar una funcionalidad nueva.

Esta es una obligación de mantenimiento del contenido: el documento se actualiza al
trabajar en el proyecto, no se genera automáticamente ni certifica por sí solo producción.
