# INF-15 — Cupo compartido de IA de la beta

Estado vigente: **publicado y cerrado en el alcance probado el 27/10/2026**. PR #46/ebdd6ee, migración 035 y webhook v59 ACTIVE; cinco controles de main aprobados. La preparación que sigue documenta el contrato implementado.

## Política aprobada por el propietario

- 100 solicitudes de textos complejos/fotos y 200 transcripciones por día entre los cuatro usuarios, sin multiplicarlas por persona ni por proceso.
- Reinicio a las 00:00 de America/Argentina/Buenos_Aires, calculado por la base; avisos en el panel al 75%, 90% y agotamiento. Actualiza cada 30 segundos mientras el panel está visible. No se añade un envío automático por WhatsApp por este cupo; los avisos técnicos existentes conservan su política.
- CONFIRMAR, CANCELAR, RESUMEN, consultas, correcciones y movimientos resueltos localmente no reservan IA. Un audio usa Whisper; solo reserva también Qwen si su transcripción necesita interpretación. Una imagen corresponde a una solicitud, aunque incluya varios movimientos.
- El límite cuenta **solicitudes reservadas**, no tokens, segundos de audio ni dólares facturados. Un error/timeout también consume la unidad reservada; no se devuelve por una respuesta incierta. Los límites del proveedor siguen aplicando y pueden agotarse antes.

## Contrato y aislamiento

035 crea ai_quota_policy, ai_quota_days y ai_quota_reservations. Sin textos, teléfonos ni comprobantes: solo trabajo, intento, carril, día y hora de reserva. Tablas con RLS y sin escritura directa para anon/authenticated/service_role. El backend solo reserva mediante la RPC protegida.

reserve_whatsapp_ai_quota exige lease válido, trabajo v2 en procesamiento sin aplicar, intento vigente y cuenta/suscripción habilitada. Bloquea la política/contador del carril antes de reservar. La clave (job_id, attempt, lane) impide volver a usar el mismo intento. No comparte un lease entre clientes ni concede reserva a un trabajo ya aplicado.

El gate se ejecuta antes de cada HTTP de Whisper/Qwen. Si la base falla o la señal vence, no se llama al proveedor. Si se agota el cupo, se persiste request_text/quota y se pide texto simple; no se añade ningún movimiento de ese mensaje, ni se eliminan los otros pendientes. Reintentar el envío o recuperar ese checkpoint no repite IA. Un nuevo intento sin checkpoint puede reservar otra unidad conservadora; siempre sujeto al límite global.

No existe política para Gemini en esta beta: si se retira la clave Groq, el runtime candidato también deniega las solicitudes a Google antes de HTTP. No se modifican claves, modelos, planes, facturación, emisor Meta ni tiempos de proveedores.

whatsapp_ai_quota_dashboard exige administrador autenticado y devuelve solo los dos contadores agregados. Un cliente normal no puede leerlos. Un error de lectura oculta valores anteriores y ofrece reintentar; no inventa un consumo cero. No se agrega una API de configuración editable en el cliente.

## Validación local

- 800 Vitest: incluye 126 escenarios de cola SQL (11 nuevos de cuotas) y ocho pruebas del panel: umbrales, datos inválidos, error/reintento, señal de aborto y ausencia de sondeos tras desmontaje.
- 70 rutas Deno sin red: cupo agotado en texto/audio/foto, cero HTTP de IA, recuperación sin reinterpretación, fallo SQL cerrado, aborto tras reserva, Gemini denegado, transcripción local sin Qwen y contexto real del trabajador.
- Tipos Deno, lint Deno/ESLint y TypeScript/build aprobados. Bundle 871,54 kB/249,86 gzip; sigue la advertencia previa de tamaño.
- 12 escenarios SQL de renovaciones y seis guardas de release aprobados.
- npm audit --audit-level=high no encontró altas/críticas; informó dos moderadas del tooling Vitest/@vitest/mocker. No se actualizaron dependencias dentro de este bloque.
- Concurrencia PostgreSQL de dos conexiones y ensayo completo Supabase/rollback aprobados en CI Linux (run 40440830920, candidato 6f2abd6). Docker local no estaba iniciado; no se presenta esa comprobación como ejecutada localmente. La suite integral Deno de endpoints sigue ejecutándose en Linux por la limitación de caché Windows ya documentada; sin ampliar permisos.

## Publicación y reversión propuestas

1. Exigir los cuatro checks del candidato. El ensayo instala todo en Supabase local y comprueba autorización, reserva SQL/duplicado/Gemini denegado y conservación de datos sintéticos. Ejecuta el gate del candidato y del commit de rollback, además de los smoke existentes.
2. Obtener autorización concreta del propietario para 035, webhook y PWA. Comprobar que producción siga en el baseline esperado y no haya trabajos/leases anteriores activos. Si los hay, esperar a que terminen antes del cambio; no borrar cola ni forzar confirmaciones.
3. Pausar brevemente la cola con el procedimiento vigente, esperar trabajos activos y aplicar/registrar/verificar 035. Mientras queue_control está desactivada, recepción devuelve 503 y Meta puede reintentar; la pausa no borra mensajes ya persistidos. Publicar el webhook desde checkout limpio con mínimo 035, verificar smoke/autenticación y reactivar. Aplicar primero SQL, después runtime.
4. Integrar/publicar PWA cuando la RPC esté disponible; verificar SHA, panel admin y rechazo a cliente. Publicar el frontend antes de 035 mostraría un error de cupo, por eso no se invierte el orden.
5. Aceptación con un mensaje ficticio, RESUMEN y CANCELAR, sin confirmación financiera; comprobar contadores según la ruta elegida. Para agotamiento usar fixtures aisladas, no consumir 100/200 solicitudes reales ni manipular consumo de clientes.
6. Rollback permitido: d62f42af4a15c25ba941e48b8da579fc0f0f2071. Ya aplica el gate, conserva el esquema 035 y el frontend previo. No volver a v58 ni al puente 80e920d: omitirían el corte nuevo. No borrar tablas/recibos ni restaurar datos.

El cierre de este alcance exige publicación y aceptación. No promete bloquear cambios futuros de plan/emisor desde sus consolas: cualquier lanzamiento, número propio o servicio pago requiere nueva revisión/autorización. La retención continúa desactivada y los backups se mantienen al final.

Evidencia del candidato: [INF_15_CUPO_2026-10-26.json](evidencias/INF_15_CUPO_2026-10-26.json). Los cuatro controles aprobaron; la documentación posterior conserva esa referencia de SHA y requiere sus propios checks antes de integrar.

## Publicación y aceptación — 27/10/2026

Autorización explícita del propietario para 035, PR #46, webhook y PWA. Pausa breve con guardas de historial/quietud; 035 aplicada y registrada en una transacción, fuentes/permisos verificados, v59 publicado desde bcd5c17 limpio y cola reactivada. Durante la pausa de queue_control el webhook puede responder 503 y Meta reintentar: no persistía ingresos mientras estaba desactivada. No se borraron ni reenviaron pendientes. Se comprobaron 21 módulos ejecutables descargados; movement-types.ts solo declara tipos y no se incluye en el bundle.

PR #46 integrada en ebdd6eedc2ce7718452e672015b848786c610ae6; [CI main/Pages](https://github.com/ThomasMariani11/chatbot-gastos/actions/runs/40442554650) aprobado. HTML, SW, versión, bundle y panel con sesión del propietario verificados; acceso no administrador rechazado.

Aceptación WhatsApp 10:07–10:09 Argentina: $123 por texto sin IA, $234 por audio con una reserva Whisper/cero Qwen, foto con una reserva Qwen/cero Whisper. Los tres grupos quedaron descartados por CANCELAR; siete mensajes procesados en un intento sin diagnóstico de error, cero movimientos nuevos, duplicados o trabajos pendientes. Contadores 1/100 y 1/200 coinciden con la captura del propietario. No se agotaron cupos reales para probar límites; ese escenario sigue cubierto en aislado.

[Evidencia de cierre saneada](evidencias/INF_15_CIERRE_2026-10-27.json). Retención desactivada, facturación/claves sin cambios y backups al final.
