# INF-05 — TLS obligatorio y acceso SQL por red

Fecha: 15/10/2026. Estado: configuración aplicada y comprobaciones técnicas aprobadas en las rutas accesibles; falta la prueba normal del propietario. El endpoint directo sigue a verificar desde una red con resolución/ruta adecuada. Sin cambios de facturación, addons, contraseñas de base, migraciones ni despliegues de app/webhook.

## Inventario y alcance

El propietario confirmó que usa únicamente Supabase y esta PC. PWA y webhook se conectan con supabase-js mediante HTTPS; GitHub Actions construye/publica la PWA sin conexión SQL directa. Cron invoca el worker por HTTPS desde PostgreSQL. Las conexiones nativas del ensayo de concurrencia son locales y descartables.

Supabase restringe por IP Postgres y sus poolers, no las APIs HTTPS de Auth, REST o Storage. Esto no sustituye RLS ni autorización. La fila sin TLS observada en el inventario correspondía al rol interno pgbouncer con aplicación Supavisor; no se atribuyó a un cliente externo sin evidencia.

## Configuración aplicada

- TLS: obligatorio, currentConfig.database=true y appliedSuccessfully=true. TLS mínimo del servidor: 1.2; pooler verificado con TLS 1.3, CA oficial y hostname. Ambos modos del pooler rechazan un startup sin cifrar con ESSLREQUIRED.
- Red: dos reglas IPv4 /32, correspondientes a los orígenes que Supabase observó al conectar desde esta PC. Sin reglas IPv6 ni rangos mundiales. Entitlement allowed y status applied.
- La dirección de salida HTTPS no coincidía con el origen SQL y este alternó entre dos IPs observadas. La primera regla bloqueó correctamente el protocolo SQL con EADDRNOTALLOWED. Se sustituyó por reglas precisas para esos orígenes, sin abrir el rango del ISP. Las direcciones no están en Git ni en esta evidencia.
- Metadata privada de operación: %LOCALAPPDATA%\Pesito\infra\inf05-network.json. Archivo/directorio con acceso restringido al usuario; contiene allowed_cidrs y antecedentes de la configuración, sin credenciales. No copiarlo a Git, chat o issues.

Activar TLS produjo el reinicio breve documentado por Supabase. Durante ese intervalo la consulta administrativa respondió 57P03 (shutting down); se esperó la recuperación sin cambiar contraseñas ni reiniciar nuevamente.

## Validación y límites

[Evidencia sin direcciones ni datos personales](evidencias/INF_05_2026-10-15.json).

- Antes: los dos poolers pedían autenticación aun sin TLS.
- Después: ambos rechazan plaintext; desde una IP fuera de la primera regla se observó EADDRNOTALLOWED; desde los orígenes autorizados se llega a la petición de autenticación con certificado y hostname verificados. Los probes se detienen allí: no envían contraseña ni ejecutan consultas de datos.
- PWA, Auth y REST con limit=0: HTTP 200. Worker autenticado: HTTP 200; cron succeeded; cola habilitada y cero trabajos v2 fallidos/en procesamiento.
- SQL administrativo por Management API HTTPS verificado bajo la red restringida. La CLI enlazada incorpora un preflight TCP antes de usar la API; puede quedar esperando si cambió la IP, aunque la API HTTPS siga disponible.
- El hostname directo devolvió ENOTFOUND desde esta red. No se afirma haber probado conexión directa IPv6 ni autenticación nativa con contraseña. La configuración de red y TLS aplicada al proyecto quedó leída y verificada; falta comprobar esa ruta desde un entorno con conectividad adecuada.
- No se cambió código de negocio ni se repitió la suite de aplicación de 173 tests, porque no se modificó su implementación. Se comprobó la sintaxis y ejecución del script de diagnóstico, protocolos reales y salud de servicios.

## Repetir la comprobación

Descargar la CA desde el enlace oficial que usa Supabase Studio, o desde Database Settings → SSL Configuration → Download certificate. No confiar en un certificado obtenido del endpoint que se quiere verificar ni desactivar la validación.

```powershell
# Desde la raíz del repositorio enlazado. La CA es pública; no requiere contraseñas.
$env:INF05_CA_FILE = 'C:\ruta\prod-ca-2021.crt'
node scripts/verify-sql-transport.mjs --run-live
Remove-Item Env:INF05_CA_FILE
```

El script requiere --run-live, usa únicamente los endpoints del proyecto enlazado y limita cada intento a diez segundos. No imprime mensajes del servidor que puedan contener IPs. Devuelve resultados explícitos; timeout/ENOTFOUND no se consideran pruebas aprobadas. El exit code es 0 únicamente si los dos poolers rechazan plaintext y admiten TLS verificado hasta la autenticación; es 2 ante un resultado inesperado de esas rutas. El resultado directo se informa por separado y no se presume aprobado. INF05_OUTPUT_FILE permite guardar el JSON saneado. No debe ejecutarse como prueba unitaria automática o con reintentos ilimitados.

## Recuperación administrativa acotada

1. Mantener una sesión de propietario en Supabase Dashboard. El control de red y la API administrativa HTTPS no dependen del acceso SQL desde la IP de esta PC. Se comprobó una consulta SQL mediante Management API aun cuando fallaba el preflight de la CLI.
2. Si cambia la IP y el SQL directo deja de responder, entrar por Dashboard → Database Settings → Network Restrictions. Verificar los orígenes reales del SQL, no asumir que son los de una consulta HTTPS a un servicio de IP pública.
3. Actualizar exclusivamente las direcciones propias confirmadas (/32 IPv4 o /128 IPv6). Reemplazar orígenes obsoletos y repetir rechazo sin TLS, acceso permitido y salud HTTPS. La CLI network-restrictions get/update y ssl-enforcement get usan la vía de control HTTPS; no precisan contraseña SQL.
4. No restaurar rangos mundiales como salida automática. La revisión automática rechazó ese rollback amplio; no se ejecutó. La recuperación utilizada conservó la restricción y corrigió solo los dos orígenes observados. No hay bloqueos de aprobación pendientes.
5. Si la CLI db query --linked queda esperando, cancelar esa consulta de solo lectura y usar SQL Editor/Management API. No cambiar contraseñas ni desactivar TLS para resolver una IP fuera de la lista. No copiar tokens a comandos, repositorio o chat.

## Prueba pendiente del propietario

Recargar la app y comprobar que muestra sus datos. Enviar RESUMEN al bot y comprobar respuesta normal. No hace falta crear ni confirmar un gasto para esta validación. Registrar el resultado antes del cierre; conservar explícita la limitación del endpoint directo.

## Fuentes oficiales

- [Restricciones de red y alcance sobre APIs HTTPS](https://supabase.com/docs/guides/platform/network-restrictions).
- [TLS obligatorio, reinicio y verify-full](https://supabase.com/docs/guides/platform/ssl-enforcement).
- [Configuración oficial del enlace de la CA en Supabase Studio](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json).
- [CLI: consulta enlazada y preflight antes de Management API](https://github.com/supabase/cli/blob/main/apps/cli/src/commands/db/query/query.handler.ts).
