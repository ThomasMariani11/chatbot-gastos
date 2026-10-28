# BE-11 — Recuperación de listas y capacidad sin bloqueos

Fecha: 28/10/2026. Base publicada: PR #49 / 1e45c94, esquema 037 y webhook v61. **Publicado y aceptado el 28/10/2026: PR #50 / 0cc65d9, 038 y webhook v62.** Hosting y backups siguen al final; retención desactivada, sin cambio de proveedores, claves o cupos.

## Revalidación

La retención del mensaje nuevo ante listas de más de 24 horas, RETOMAR/DESCARTAR y CANCELAR de lista antigua ya estaban resueltos por la cola y 025/033. También se cuentan ítems activos y se conservan posiciones después de quitar: 20 activos pueden tener posición máxima 21 o superior. No se reescribe esa lógica ni se presentan todos los hallazgos iniciales como vigentes.

Se reprodujeron en aislado dos problemas actuales:

1. El parser acepta `ver lista`, `sacame el 2`, `borralo` y `¡sí!`, pero el filtro SQL no los dejaba pasar detrás de un mensaje waiting. Los comandos canónicos sí pasaban. [Diagnóstico previo](evidencias/BE_11_REVALIDACION_2026-10-28.json).
2. Un lote de 20 retenido frente a 20 pendientes podía pasar a revisión manual tras cinco liberaciones de espacio, aunque nunca hubiera fallado la interpretación/SQL. attempts mezclaba procesamiento legítimo y errores técnicos. [Reproducción previa](evidencias/BE_11_CAPACIDAD_REINTENTOS_2026-10-28.json).

El procesador rechazaba explícitamente un mensaje mayor de 20, mientras la RPC dejaba ese add en espera de una capacidad imposible. 038 unifica esa salida.

## Comportamiento preparado

- Misma normalización de acentos, espacios y puntuación para controles de texto: ambas funciones de cola usan un helper privado. Pruebas comparan el SQL real con parseLocalCommand real, incluidos alias, ayuda, remociones ambiguas y emojis. Correcciones y respuestas breves a faltantes de 034 siguen pudiendo pasar. La elegibilidad permite procesar/validar un control; **no autoriza** confirmar, editar otro usuario ni omitir suscripción/lease/revisión vigente.
- Lista con 18 + mensaje de tres operaciones: retener las tres juntas con checkpoint, informar ambas cantidades y retomar al liberar un lugar. No insertar solo las dos que caben. Si se confirma la lista anterior, el lote retenido queda pendiente en otra lista y requiere su propia revisión/confirmación.
- Un único mensaje de más de 20: responder cantidad/límite/instrucción para dividir, conservar la lista anterior y no insertar nada ni dejar una espera imposible. El procesador y la RPC usan textos equivalentes comprobados por tests. No se divide ni se confirma automáticamente. El original/checkpoint sigue bajo la política de retención existente; no se agrega almacenamiento externo.
- Números estables, orden de los mensajes retenidos, ningún reenvío de IA después de checkpoint. El siguiente mensaje puede volver a esperar si ya no cabe.

## Reintentos de capacidad y compatibilidad

038 agrega capacity_resumes a la cola. attempts **sigue siendo monotónico**, conservando los identificadores de reservas IA y la trazabilidad. Al liberar un mensaje waiting/capacity, capacity_resumes se incrementa una sola vez bajo el efecto transaccional del comando. El umbral de revisión manual y el backoff descuentan esas vueltas de negocio; cinco fallos técnicos reales conservan la revisión manual.

La migración inicializa ese offset solo para checkpoints v2 ya aplicados, en waiting/capacity y sin error pendiente: greatest(attempts-1,0). No cambia estado, contenido, efecto aplicado, fecha de agenda o respuesta de esos mensajes. No modifica filas financieras ni reenvía mensajes. Failed, manual_review y otros estados conservan offset cero al instalar. Luego, la recuperación/cron normal puede atender comandos que antes estaban bloqueados por el filtro.

Las guardas de 033 y la liberación de mensajes stale se conservan literalmente; no se reescriben migraciones anteriores. Los cuatro RPC existentes conservan firma, propietario, ACL, SECURITY DEFINER y search_path. Helpers de normalización y aviso sin EXECUTE para PUBLIC/anon/authenticated/service_role.

## Pruebas y límites

- **996 Vitest (57 nuevos)** y **83 rutas Deno (tres nuevas)** aprobados localmente. Código y SQL reales importados, sin copias del parser. Normalización/alias, 18+3, confirmar lista previa sin guardar la nueva, veinte liberaciones sin revisión falsa, varios mensajes en orden, 21/101 operaciones, claves de checkpoint, backoff y cinco fallos reales, metadata/ACL y migración de checkpoints previos.
- RETOMAR/DESCARTAR/CANCELAR con mensaje nuevo mixto ARS/USD conserva sus datos. Una confirmación por alias sigue sin guardar la lista antigua. Numeración con huecos y vuelta al resumen vigentes cubiertas junto a BE-07/BE-12.
- Tipos/lint/build, 12 renovaciones SQL y seis guardas de release aprobados. Bundle frontend sin cambios: 871,54 kB / 249,86 gzip; advertencia de tamaño preexistente.
- SQL exacto del smoke de recuperación ejecutado con PGlite aislado. PostgreSQL de dos sesiones y Supabase local completo/rollback preparados para CI Linux; Docker local no está disponible. Ambos aprobaron en CI del candidato y main. No se ejecutaron en esta PC.
- No se consultaron mensajes de clientes, se llamó a proveedores reales ni se enviaron WhatsApps durante esta implementación. La aceptación posterior del propietario se registra abajo.

## Publicación y rollback propuestos

Después de revisar CI y obtener autorización: exigir candidato limpio, historial 001–037, fuentes exactas/ACL de apply/next/due/fail y salud/pausas de cola. Aplicar/registrar 038 atómicamente; verificar columna, offset, helpers privados y fuentes. Desplegar webhook después e integrar/publicar la PR; comprobar fuentes/Edge/PWA y smoke de autenticación. No ejecutar down ni actualizar movimientos/borradores de clientes para probar.

Rollback de runtime: 1e45c94f46a3b2ce1e3106d429570e0d3b1ab390, mínimo 037, conservando 038 y sus guardas. El código previo ignora la columna adicional; la cola y la RPC mantienen firmas. Al conservar 038 siguen disponibles las correcciones SQL de alias/reintentos y la salida de exceso; el aviso del runtime previo tiene la redacción anterior. No revertir counters ni borrar checkpoints/recibos. El ensayo comprueba candidato y runtime anterior sobre la misma base.

Aceptación sugerida: probar control por alias y numeración con una lista ficticia, cancelar al final. Envejecimiento 25 horas, saturación, reinicios, fallos y concurrencia se ensayan en aislado para no alterar datos reales de clientes. La publicación y aceptación de ese alcance se completaron según el registro siguiente; no se atribuye cobertura universal a una prueba de WhatsApp.

## Publicación y aceptación — 28/10/2026

038 aplicada/registrada atómicamente tras comparar las fuentes con el esquema probado. Seis funciones verificadas, ACL preservadas, helpers privados también comprobados vía API (401); no había mensajes esperando capacidad a inicializar. Webhook v62 ACTIVE, 23 módulos iguales al candidato y smoke 401 de webhook/worker. Main 0cc65d96cdee3735f36da6f9ed95dc67e69f1e22, cinco controles aprobados, PWA/version/SW/bundle/CSP comprobados. [CI de publicación](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/40712839331). Rama integrada retirada; repositorio limpio al terminar el despliegue.

Aceptación del propietario 12:17–12:18 Argentina: siete mensajes procesados, lote inicial de 20 y uno retenido. ver lista/sacame el 2/borralo atendidos. El retenido se incorporó una sola vez como 21 después de quitar el 2; posiciones originales conservadas. Dos pasadas y una vuelta de capacidad para ese mensaje, sin reintentos técnicos ni nueva IA. Cero IA en toda la prueba. Cancelación: grupo descartado, cero movimientos financieros de prueba, grupos abiertos o trabajos propios pendientes. Resumen vacío registrado a las 12:18:30. [Evidencia saneada](evidencias/BE_11_CIERRE_2026-10-28.json).

BE-11 cerrado en el alcance publicado y probado. Meta aceptó los envíos; no se presume recibo de lectura del dispositivo. Envejecimiento, esperas repetidas, fallos, concurrencia y rollback se comprobaron en aislado/CI, no provocándolos en clientes. Hosting/backups y activación de retención conservan sus estados separados. Los apartados de preparación anteriores registran el orden y los límites, no una publicación pendiente.
