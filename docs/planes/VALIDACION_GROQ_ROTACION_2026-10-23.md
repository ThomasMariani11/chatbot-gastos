# Renovación Groq — 23/10/2026

**Completada y verificada** con autorización explícita del propietario para crear una clave sin vencimiento, conservarla cifrada y configurar `GROQ_API_KEY` en Supabase tras una prueba ficticia.

- Organización Personal, Default Project, plan Free: no se activó facturación ni una suscripción paga.
- Credencial: «Pesito - beta renovacion octubre», opción **No expiration** verificada en la consola. Las claves anteriores con vencimiento 27/10/2026 se conservaron durante la comprobación; no se revocaron.
- Una solicitud ficticia a `qwen/qwen3.8-27b`: «gasté 1500 pesos en panadería». HTTP 200; importe 1500 ARS y tipo gasto correctos; 647 ms y 71 tokens totales. No se enviaron datos de clientes.
- Se reemplazó únicamente `GROQ_API_KEY` en el proyecto Supabase existente. El SHA-256 del secreto guardado coincide con el de la credencial probada. Marca de actualización: 23/10/2026 21:16:54 UTC.
- Copia local protegida mediante DPAPI del usuario Windows, fuera del repositorio. Sin clave en archivos del proyecto, commits ni documentación. No se recuperaron ni utilizaron las credenciales privilegiadas previamente suspendidas.

La comprobación valida la API y la configuración almacenada. **No equivale a una aceptación nueva de audio/foto por WhatsApp.** No se redeployó el webhook ni se enviaron avisos a clientes.

INF-15 permanece abierto para capacidad, cuotas y documentación. «Sin vencimiento» evita la caducidad programada; no elimina límites de uso ni garantiza disponibilidad del proveedor. Las claves anteriores siguen pendientes de revocación tras confirmar el funcionamiento normal; no hacerlo sin revisar su uso.