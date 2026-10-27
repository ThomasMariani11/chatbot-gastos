# Validación INF-15 — costos y documentación

Fecha: 26/10/2026 (Argentina). Base documental: PR #44, 23f39cc; base funcional: PR #43/bd896f0, 034 y webhook v58. Estado: **revisión de beta preparada; INF-15 general continúa en curso**. Sin publicación funcional ni cambios de cuentas/datos. La integración de PR #44 fue rechazada por revisión automática por faltar autorización explícita para main; el commit y la PR quedaron guardados en GitHub.

## Revisión efectiva

- Fuente activa: helpers selecciona Groq cuando hay GROQ_API_KEY no vacía; el catch no activa Gemini. Si falta Groq, puede seleccionarse Gemini, con Flash Lite/Flash; no se presume gratuita esa cuenta de Google. Secrets list se utilizó solo para comprobar presencia de nombres; no se leyeron valores ni claves privilegiadas.
- Código y metadatos agregados: paid_service_messages_authorized y cost_guard_date no son consultados por el webhook. Cuatro fechas antiguas vencidas y una bandera verdadera no significan cargos ni un permiso vigente de compra. Se documentó su deprecación funcional sin editar filas/columnas/migraciones históricas.
- Consola Groq autenticada: Free/Current Plan, Default Project; límites base Qwen 30 RPM, 1000 RPD, 8000 TPM y 200000 TPD; Whisper Turbo 20 RPM, 2000 RPD, 7200 ASH y 28800 ASD. No se generaron claves ni solicitudes reales. Son límites observados, no disponibilidad garantizada para cuatro personas.
- Consola Supabase: organización productiva FREE, NANO, 0,16/5 GB egress, 35/500 MB de base, 683/500000 invocaciones, 189/2000000 mensajes Realtime y pico 4/200 conexiones. El snapshot incluye los otros recursos; el panel advierte refresco diferido. No se activó Pro, Spend Cap, un complemento ni un presupuesto pago.
- Después del login realizado por el propietario, Meta Developers muestra una app en desarrollo y el número de prueba. Ese emisor coincide con el previamente aprobado en whatsapp_ops_config; registro propio/pagos aparecen en la configuración de producción y no se ejecutaron. No se abrió ningún payload de clientes, se generaron tokens, enviaron pruebas o revisaron medios de pago/facturas.
- Configuración operativa: cola y avisos habilitados, emisor de prueba aprobado, cero alertas activas. Cron de recuperación/observabilidad por minuto; limpieza horaria programada, pero retention_enabled=false. El cron activo no implica eliminación efectiva ni necesariamente una llamada Edge por tick.
- Fuentes públicas primarias actualizadas enlazadas en el runbook. Las páginas de precios y FAQ de Meta no coinciden en gratuidad de servicio; esa discrepancia impide usar una frase general como prueba de cero costo de un número real. No se interpreta como un cargo encontrado en la cuenta actual.

## Cambios preparados

Runbook COSTOS_Y_CUPOS, snapshot saneado y guía/README actualizados para la ruta Groq y controles reales; capacidad histórica etiquetada como estimación. No se instala un presupuesto ficticio que el runtime ignore ni se reutiliza la fecha vencida. Se distingue límite organizacional del proveedor de enfriamiento por instancia, lectura manual de consumo de alerta automática, y envío aceptado de entrega/cargo.

Se proponen umbrales operativos de revisión 75%/90%, expresamente manuales y pendientes de acordar. No se activa ninguna alerta por email/WhatsApp, corte de acceso, pausa de bot o facturación por este documento. Los avisos técnicos existentes conservan sus umbrales de INF-14.

## Regresiones

Se añaden tres casos sobre módulos reales a routing_test, todos sin red:

1. Groq 429 con ambas claves ficticias: una sola solicitud a Groq, petición de texto persistida, cero solicitudes a Gemini y recuperación del mismo checkpoint sin otra interpretación.
2. Groq 503: mismas garantías, con diagnóstico de indisponibilidad.
3. Meta rechaza texto por ventana 131047: como máximo dos peticiones de texto para las variantes argentinas, mismo contrato, ninguna plantilla ni nuevo proveedor. No demuestra tarifas de Meta, solo que el código no habilita otro producto al fallar.

56/56 routing Deno, tipos y lint aprobados localmente. No se modifica runtime, SQL, dependencias, permisos ni configuración productiva; no hace falta redeploy de Edge ni repetir pruebas financieras de BE-08. CI completo del candidato pendiente; la suite integral de endpoints continúa verificándose en Linux por la limitación de caché Windows ya documentada. No se amplían permisos ni se invoca IA para probar un cupo.

## Pendientes y criterio de cierre

Esta preparación corrige la documentación y prueba los controles actuales, pero **no cierra INF-15 general**:

- No existe bloqueo global que detecte cambios de plan/emisor/proveedor en todas las rutas ni presupuesto diario transaccional de tokens compartido entre instancias. El límite global actual de Groq se aplica en el proveedor Free; no se presenta el enfriamiento en memoria como tal presupuesto.
- Concretar si se exige impedir automáticamente cambios de emisor/proveedor antes de incorporarlos, qué debe ocurrir con mensajes retenidos y qué alertas de consumo realmente se necesitan. Preparar contrato y regresiones antes de cambiar runtime/SQL; requiere publicación autorizada.
- Mantener Gemini inactivo mientras Groq esté configurado; verificar su facturación antes de habilitarlo. No revocar claves vigentes como parte de esta revisión.
- Antes de número propio/plan pago/lanzamiento, verificar tarifas efectivas y facturación, resolver discrepancias y definir corte/alertas. No certificar costo universal cero ni disponibilidad por una captura de un plan Free.
- Subir y revisar esta preparación; integrar PR #44 y la PR dependiente solo con autorización explícita de main. Retención desactivada y backups al final.

Evidencia pública saneada: [INF_15_2026-10-26.json](evidencias/INF_15_2026-10-26.json). Lecturas agregadas/solicitudes GitHub privadas: C:/Users/thomi/AppData/Local/Temp/pesito-inf15-2026-10-26/. Sin teléfonos de clientes, claves, payloads, facturas ni contenidos financieros. Las observaciones son del momento indicado, no monitoreo permanente.
