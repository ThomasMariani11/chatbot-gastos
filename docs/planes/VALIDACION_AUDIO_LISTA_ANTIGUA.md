# Incidente: audio retenido al cancelar una lista antigua

Fecha: 16/10/2026. Estado: 025 y webhook v42 publicados y verificados; integración documental final y prueba de audio pendientes.

## Hallazgo confirmado

Una propuesta heredada, anterior al mensaje nuevo y con más de 24 horas de inactividad, activó la pausa por lista antigua. Esa propuesta no fue creada a partir del audio nuevo. El control de propietario revisado no mostró ítems de otro usuario.

La rama SQL de antigüedad se ejecutaba antes que CANCELAR y solo exceptuaba RETOMAR/DESCARTAR. CANCELAR quedaba retenido junto con el audio en vez de resolver la lista anterior. DESCARTAR liberó los mensajes, pero después falló su preparación y terminaron en revisión manual; la cancelación retenida se ejecutó posteriormente. Los dos mensajes revisados no generaron ítems ni transacciones.

No se atribuye la causa de interpretación específicamente a Gemini, descarga de Meta, cuota o timeout: los logs anteriores solo indicaban stage=interpret. Incluye lecturas de base, descarga y extracción. La cuenta y los secretos requeridos estaban configurados al revisarlos, lo que no prueba que el proveedor estuviera disponible durante el incidente.

## Corrección

025 reemplaza únicamente tres condiciones de apply_whatsapp_job usando pg_get_functiondef y guardas de definición. Ante una lista antigua, CANCELAR equivale a DESCARTAR: cierra solo la lista anterior y libera los mensajes retenidos por antigüedad para interpretarlos una sola vez. CANCELAR una lista reciente mantiene la cancelación completa. No cambia firma, propietario, ACL, SECURITY DEFINER ni search_path. Es idempotente y se detiene ante una definición inesperada.

La migración no edita mensajes ni movimientos existentes. No reactiva mensajes ya cancelados o en revisión manual. No se reconstruyen grupos de clientes para probar.

El webhook emite motivos técnicos controlados (configuración, timeout, autenticación, cuota, indisponibilidad, rechazo HTTP, red, respuesta inválida y lectura de base), proveedor y estado HTTP. Registra cada intento de Gemini con alias fijo de modelo y duración. Las lecturas de base conservan únicamente un nombre de operación permitido. No serializa errores, cuerpos, prompts, URLs, claves, teléfonos, IDs ni comprobantes. El error original no puede reconstruirse retroactivamente.

Se conserva el orden de modelos y los timeouts existentes; esta corrección no afirma resolver disponibilidad o límites del proveedor.

## Pruebas

- Regresión antes de 025: CANCELAR muestra otra vez el aviso de lista antigua y la prueba falla.
- Después de 025: descarta el grupo antiguo, conserva el payload del audio, lo deja pendiente una sola vez y no vuelve a ejecutar CANCELAR después de interpretarlo.
- Cancelación normal sin confirmación financiera.
- ACL/propietario/search_path preservados, aplicación idempotente y definición inesperada rechazada.
- 197 Vitest; 17 Deno; 12 escenarios SQL; seis controles Node de release, tipos/lint/build aprobados.
- Pruebas Deno con red denegada y claves ficticias: descarga rechazada, 429 con respaldo exitoso, timeout, JSON inválido y fallo RPC. Verifican que los canarios privados no aparecen en logs.
- PostgreSQL nativo y ensayo completo Supabase local deben aprobar en el PR antes de publicar.

## Publicación y aceptación

1. Exigir los cuatro checks del PR, incluido Supabase local con las 25 migraciones y rollback al código compatible a4be403.
2. Leer historial 024 y huella de apply_whatsapp_job; aplicar 025 y registrar su texto/versión en la misma transacción. Verificar propiedades y definición, sin editar filas.
3. Desplegar solo whatsapp-webhook con CLI 2.120.0 --use-api y los secretos existentes. Verificar versión ACTIVE y rechazos 401 de peticiones sin firma/secreto.
4. Integrar con protección de main; verificar Pages y registrar versiones reales. Actualizar esta evidencia sin prometer que un smoke vacío verifica la interpretación de audio.
5. Pedir al usuario un audio nuevo o reenvío explícito. Comprobar propuesta y diagnóstico saneado. No confirmar movimientos automáticamente ni reenviar por cuenta propia el audio cancelado. Si falla, usar proveedor/motivo/estado para corregir la causa concreta.

BE-11 e INF-14 siguen abiertos en su alcance general. INF-11 permanece como siguiente punto de infraestructura; backups continúan al final.

## Publicación observada

El código 561198a aprobó los cuatro checks en la [ejecución 38937851487](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/38937851487), incluida la instalación aislada de las 25 migraciones y el rollback compatible. Se exigieron historial 024 y huellas de definición/propiedades antes de aplicar 025; la migración y su registro de historial se ejecutaron en una transacción. La lectura posterior confirma 025, condiciones corregidas y propiedades preservadas.

CLI 2.120.0 publicó únicamente whatsapp-webhook, v42 ACTIVE, con JWT false y secretos existentes. POST sin firma y worker sin secreto responden 401. La cola permanece habilitada, sin trabajos v2 fallidos o procesándose en la lectura de control. Los dos mensajes anteriores siguen cerrados: no se reencolaron ni confirmaron.

[Evidencia saneada](evidencias/AUDIO_LISTA_ANTIGUA_2026-10-16.json). La revisión final del [PR 5](https://github.com/ThomasMariani11/chatbot-gastos/pull/5) debe aprobar nuevamente los checks antes del merge. La causa original de interpretación sigue sin atribución exacta y requiere un audio nuevo enviado explícitamente por el usuario para validar el proveedor con los nuevos códigos.
