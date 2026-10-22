# Autenticación de avisos administrativos — 22/10/2026

## Diagnóstico y alcance
La ruta test-send devolvió 401 desde el propio handler al comparar literalmente el Bearer recibido con SUPABASE_SERVICE_ROLE_KEY. El aviso solicitado no se envió. Este diagnóstico no implica que fallen el webhook de Meta o el worker, que tienen autenticación independiente.

## Corrección
Se admite solo la clave secreta default vigente por apikey, comparada en el servidor con SUPABASE_SECRET_KEYS. No requiere combinar claves, crear credenciales, cambiar permisos ni nuevas dependencias. Comparación por digests de tamaño fijo, configuración inválida cerrada y ausencia de claves en logs/respuestas. Se conserva el Bearer legacy exacto únicamente si no se envió apikey.

El handler se extrae a admin-send.ts para probar HTTP y el adaptador de envío sin proveedores. Valida destino y texto explícitos, no anuncia éxito ante fallo ni reintenta el envío administrativo. El transporte existente conserva sus límites. No cambia colas, borradores, modelos IA, migraciones ni confirmación de movimientos.

## Evidencia
- 33 pruebas nuevas del handler con claves ficticias: default válida, legacy compatible, rechazo de otras claves/públicas/JWT inventado, JSON/configuración inválidos, validación del aviso y fallo del envío sin filtraciones ni reintento.
- Una prueba nueva Deno del endpoint real intercepta fetch y comprueba tres rechazos sin envío y una solicitud válida con una llamada a Meta ficticia.
- Vitest total: 395. Tipos, lint y build aprobados. Validación Deno completa en CI Linux requerida; en Windows el SDK npm requiere lecturas de caché virtualizada no permitidas por la configuración local.
- Publicación y pruebas reales se registran en el PR una vez verificadas. No se accedió a claves backend reales ni se enviaron mensajes en esta corrección. El uso operativo sigue suspendido hasta nueva autorización del propietario.

## Límite
Una llamada por solicitud al adaptador no garantiza idempotencia entre solicitudes nuevas. No repetir manualmente un envío con resultado ambiguo. El estado de entrega/lectura en WhatsApp requiere confirmación adicional.
