# 📋 PLAN MAESTRO DE IMPLEMENTACIÓN - TRANSICIÓN A SAAS (PESITO)

> **Avance en rama — 30/10/2026:** BE-19 implementa solicitud RENOVAR, confirmación manual del pago y envío de código nominativo; no renueva hasta canjearlo en Ajustes y no envía otro WhatsApp al canjear. Migración 043 preparada, sin aplicar; PWA/webhook sin publicar. Base documental f44cc44, rama codex/be19-renovacion-pago-codigo. Ver [VALIDACION_BE_19](docs/planes/VALIDACION_BE_19.md). Las listas de pendientes anteriores son históricas respecto de este avance.

## Estado vigente — 29/10/2026

- **Commit base funcional:** `ecba42024d413ef05a2a4d1abeb04bdbb97e869e` (PR #67). **Corte SQL contrastado: 001–041**, archivos del repositorio; no es una nueva comprobación o aplicación sobre Supabase.
- **Base Git al iniciar: 15b3f94.** Incluye BE-22/042 (PR #68) y contexto PR #69, posteriores al corte solicitado. Se conservan como avances posteriores; su publicación SQL/Edge está **sin verificar en esta revisión**. No se retrocede el checkout.
- **Incorporado** acredita código integrado y evidencia de pruebas/cierre dentro de su alcance. No equivale por sí solo a migración aplicada o webhook desplegado. Estado productivo/configuración remota actuales y aceptaciones no acreditadas: **sin verificar** en esta tarea documental.
- Thomas es el único administrador; administrador inicial excluido de BE-13. Hosting y backups (INF-13/INF-08) se aplazan al final. INF-14 conserva observabilidad incorporada y retención 30/90 **preparada, desactivada y pendiente de activación autorizada**.
- BE-19, FE-24/BE-20, FE-25/BE-21/NOTIF-01, FE-14 y FE-21/BE-17 siguen pendientes. Para FE-14 prevalece la instrucción actual sobre el descarte anterior, que queda histórico.

Las secciones históricas se conservan como registro. “Siguiente paso”, “pendiente”, “sin publicar”, cifras y versiones antiguas no reemplazan esta ficha. No ejecutar recetas históricas sin contrastar el contrato vigente.

### Fases: declaración anterior y evidencia

| Fase | Declaración anterior | Estado contrastado |
| --- | --- | --- |
| 1 — Base/acceso | Completada al 02/10, afirmando verificación productiva. | **Incorporada en 001–041**, con correcciones posteriores. [BE-13](docs/planes/VALIDACION_BE_13.md), [BE-14](docs/planes/VALIDACION_BE_14.md), 039/040. Producción actual sin verificar aquí. |
| 2 — Admin | “Siguiente paso”, aunque el diagrama tiene check. | **Núcleo incorporado:** `src/AdminPanel.tsx`, `src/App.tsx`, [FE-06/BE-02](docs/planes/VALIDACION_FE_06_BE_02.md). Renovación actual por RPC, no update del vencimiento calculado en navegador. No se certifica cada detalle imaginado del diseño original. |
| 3 — Registro | Guía a desarrollar; diagrama con check. | **Incorporada:** Login, alta atómica 039/040 y [FE-13](docs/planes/VALIDACION_FE_13.md). Signup + canje posterior es procedimiento histórico reemplazado por trigger. |
| 4 — WhatsApp | Guía a desarrollar; diagrama con check. | **Incorporada:** `src/whatsappLink.ts`, RPC 018 y [BE-14](docs/planes/VALIDACION_BE_14.md)/040. El enlace prepara el mensaje; el usuario lo envía. No crear códigos con escrituras libres desde la web. |
| 5 — Ajustes/Paywall | Guía a desarrollar; diagrama con check. | **Núcleo de cuenta/acceso incorporado:** Settings, Paywall y subscription.ts. Gestión de categorías personales del diseño original **pendiente FE-24/BE-20**. No se cierra toda la propuesta por existir Settings. |

### Mejoras y decisiones posteriores

El [plan general vigente](docs/planes/PLAN_MEJORAS_PROYECTO.md) lista cada uno de los 61 bloques, código y evidencia. BE-13/14/16/18 y FE-08/10/13/15/16/17/18/20/22/23 están incorporados a la base funcional con las validaciones allí citadas. FE-23 es PR #67, solo Dashboard; PR #66 corrige el cursor mensual.

Siguen pendientes BE-19, FE-24/BE-20, FE-25/BE-21/NOTIF-01, FE-14, FE-21/BE-17, INF-13, INF-08 e INF-14 (retención preparada y desactivada). Único administrador Thomas; bootstrap administrativo excluido. Hosting y backups al final. No se habilitan avisos, retención ni servicios con esta revisión.

## Registro histórico conservado — 02/10/2026

> Stack React 18, commit antiguo, “siguiente paso” y recetas siguientes son historia. Stack contrastado: React 19, TypeScript, Vite y Supabase. No ejecutar el update directo de vencimiento, el canje después de signup o las escrituras libres de códigos de vínculo de esas recetas. Se conservan para trazabilidad; datos de contacto/códigos de ejemplo omitidos.
> **Documento para transferencia a Codex / Nueva Sesión de IA**  
> **Fecha de corte:** 2 de Octubre de 2026  
> **Repositorio:** `ThomasMariani11/chatbot-gastos` (Rama `main`)  
> **Stack:** React 18, TypeScript, Vite, Supabase (PostgreSQL, Auth, Edge Functions en Deno), PWA  
> **Último commit:** `5cd9cb7` (`feat: add profiles, invitation_codes tables, and sync phone on webhook`)  
> **Supabase Project Ref:** `ystyatotldslfmucvgsq` (URL: `https://ystyatotldslfmucvgsq.supabase.co`)  
> **Super Admin actual:** `[correo omitido]` (WhatsApp: `[teléfono omitido]`)

---

## 🎯 OBJETIVO DEL PROYECTO
Convertir la aplicación web/PWA actual de finanzas personales ("Pesito") en un **SaaS comercializable** con:
1. **Control de acceso estricto mediante Códigos de Invitación de un solo uso** (para evitar que la gente se pase la app o se registre sin pagar).
2. **Panel de Administrador exclusivo** para generar licencias/códigos, ver métricas del negocio y gestionar clientes y suscripciones.
3. **Flujo de Onboarding 100% automático** para que los clientes se registren solos con un enlace inteligente y conecten su WhatsApp en 1 toque.
4. **Vista de Cliente limpia y comercial** eliminando advertencias técnicas de la pantalla de configuración.

---

## Histórico — Fase 1 declarada completada al 02/10/2026

La **Fase 1 (Base de Datos & Roles en Supabase)** ya está 100% desplegada y verificada en la base de datos de producción:

### 1. Tablas y Estructuras en Supabase
* **`public.profiles`**:
  - `id` (`UUID`, PK -> `auth.users.id` on delete cascade)
  - `email` (`TEXT`)
  - `role` (`TEXT` check in `'admin'`, `'client'`, default `'client'`)
  - `subscription_status` (`TEXT` check in `'active'`, `'expired'`, `'suspended'`, default `'active'`)
  - `subscription_until` (`TIMESTAMPTZ`, `null` = vitalicio/sin vencimiento)
  - `phone_number` (`TEXT`, sincronizado automáticamente con WhatsApp)
  - `created_at`, `updated_at` (`TIMESTAMPTZ`)
* **`public.invitation_codes`**:
  - `id` (`UUID`, PK)
  - `code` (`TEXT`, UNIQUE, ej. `PESO-[ejemplo omitido]`)
  - `duration_days` (`INTEGER`, ej. 30, 90, 365, o `null` para vitalicio)
  - `is_used` (`BOOLEAN`, default `false`)
  - `used_by` (`UUID` -> `auth.users.id`)
  - `used_at` (`TIMESTAMPTZ`)
  - `created_by` (`UUID` -> `auth.users.id`)
  - `notes` (`TEXT`, ej. *"Pagó Juan Pérez - MP"*)
  - `created_at` (`TIMESTAMPTZ`)

### 2. Funciones RPC en Supabase
* `public.check_invitation_code(p_code text)`:
  - Función pública segura (`SECURITY DEFINER`).
  - Verifica si el código existe y no fue usado.
  - Devuelve `{ valid: true, duration_days: 30 }` o `{ valid: false, error: '...' }`.
* `public.redeem_invitation_code(p_code text, p_user_id uuid)`:
  - Función atómica (`SECURITY DEFINER`).
  - Bloquea la fila con `FOR UPDATE`, quema el código (`is_used = true`, `used_by = p_user_id`), calcula `subscription_until = now() + duration_days` y actualiza `public.profiles`.
  - Rechaza cualquier intento de reuso o código inválido.
* `public.bootstrap_user()`:
  - Trigger automático sobre `auth.users`: crea automáticamente el perfil en `public.profiles`, categorías por defecto, `app_settings` y `whatsapp_links`.

### 3. Webhook de WhatsApp Desplegado
* `supabase/functions/whatsapp-webhook/index.ts`:
  - Desplegado con `--no-verify-jwt`.
  - Cuando un usuario envía `VINCULAR <código>` y se vincula con éxito, actualiza automáticamente `whatsapp_links` y `profiles.phone_number = message.from`.

### 4. Pruebas Reales Ejecutadas y Aprobadas en Producción
- [x] Rechazo de códigos inexistentes (`valid: false`).
- [x] Reconocimiento de códigos reales válidos (`valid: true`).
- [x] Canje atómico y cálculo de días (`success: true`, calcula fecha a 30 días).
- [x] Rechazo estricto si se intenta reutilizar un código ya quemado.
- [x] Usuario admin actual (`[correo omitido]`) configurado con `role = 'admin'` y acceso perpetuo.

---

## Histórico — roadmap original de fases 2 a 5

```mermaid
flowchart LR
    F1["Fase 1 ✅\nBase de Datos y Roles"] --> F2["Fase 2 ✅\nPanel de Administrador"]
    F2 --> F3["Fase 3 ✅\nRegistro con Enlace Inteligente"]
    F3 --> F4["Fase 4 ✅\nConectar WhatsApp en 1 toque"]
    F4 --> F5["Fase 5 ✅\nConfiguración limpia y Paywall"]
```

---

## Histórico — guía Fase 2; no es el siguiente paso

### Objetivo de la Fase 2:
Crear la vista de **Panel de Administrador** (`AdminPanel.tsx`) en el frontend, accesible solo para usuarios con `role === 'admin'`.

### Archivos a crear / modificar:
1. **`src/AdminPanel.tsx` (Nuevo componente)**:
   - **Barra superior**: Título "Panel de Administrador", botón para alternar a "Ver mi Dashboard".
   - **Tarjetas de Métricas**:
     - Total clientes activos (`profiles` con `role = 'client'`).
     - Clientes próximos a vencer en los próximos 7 días (`subscription_until <= now() + 7 days`).
     - Códigos disponibles (`invitation_codes` con `is_used = false`).
     - Total transacciones o eventos registrados.
   - **Formulario Generador de Códigos**:
     - Selector de Duración: `30 días (1 mes)`, `90 días (3 meses)`, `1 año (365 días)`, `Vitalicio (sin vencimiento)`.
     - Campo Nota / Cliente: texto opcional (ej. "Juan Pérez - Mercado Pago").
     - Botón `Generar Código de Invitación`:
       - Genera un código legible aleatorio (ej. `PESO-` + 4 o 6 caracteres alfanuméricos en mayúsculas).
       - Inserta en `invitation_codes` (con `created_by = userId`, `duration_days`, `notes`).
     - Al generarse, muestra un modal o banner con el código y un botón destacado:
       `[ 📲 Copiar mensaje para WhatsApp ]`
       - Copia al portapapeles el texto pre-armado:
         > *"¡Hola! Gracias por sumarte a Pesito 💰.*\n\n*Para activar tu cuenta:*\n*1. Entrá a este enlace exclusivo: https://<dominio>/?invitacion=PESO-[ejemplo omitido]*\n*2. Creá tu contraseña.*\n*3. Tocá 'Instalar' para tenerla como app en tu pantalla de inicio.*\n*4. ¡Listo! Ya podés registrar tus gastos por WhatsApp."*
   - **Tabla de Gestión de Clientes**:
     - Columnas: Email, WhatsApp vinculado (`phone_number`), Estado (`Activo` / `Próximo a vencer` / `Vencido`), Vence el (`subscription_until`), Acciones:
       - Botón `+ 30 días` (ejecuta un update sumando 30 días a `subscription_until`).
       - Botón `Pausar / Reactivar cuenta` (`subscription_status = 'suspended'` o `'active'`).
       - Botón directo para abrir chat de WhatsApp con el cliente si tiene número vinculado (`https://wa.me/<phone_number>`).
   - **Tabla de Códigos de Invitación**:
     - Columnas: Código, Duración, Nota, Estado (`Disponible` / `Usado por <email>`), Fecha de creación, Acciones:
       - Botón `Copiar enlace`.
       - Botón `Anular / Eliminar` (si no fue usado).

2. **`src/App.tsx` (Actualizar navegación)**:
   - Al cargar la sesión del usuario, consultar `public.profiles` por `id = session.user.id`.
   - Guardar en estado `userProfile`: `{ role: 'admin' | 'client', subscription_status, subscription_until }`.
   - Si `userProfile.role === 'admin'`:
     - Agregar opción de vista: `type View = 'dashboard' | 'settings' | 'admin'`.
     - En el header del Dashboard, mostrar botón o badge discreto `[ 🛠️ Panel Admin ]` que cambie a `view = 'admin'`.

3. **`src/styles.css`**:
   - Agregar estilos limpios para el panel de administración (métricas en cards, tablas responsive, badges de estado verde/amarillo/rojo, botones de acción).

---

## Histórico — guía Fase 3 (REGISTRO CON ENLACE INTELIGENTE)

### Objetivo:
Permitir que los clientes se registren solos, validando el código de invitación desde la URL o tipeado.

### Archivos a modificar:
1. **`src/Login.tsx`**:
   - Detectar si la URL contiene `?invitacion=CODIGO` o `?code=CODIGO`.
   - Si contiene código:
     - Automáticamente cambiar a la pestaña "Crear cuenta".
     - Llamar a `supabase.rpc('check_invitation_code', { p_code: codigo })`.
     - Mostrar feedback visual: `[ ✅ Código verificado: Plan de X días ]` o `[ ❌ Código inválido o ya utilizado ]`.
   - Formulario de Registro:
     - Email
     - Contraseña
     - Repetir contraseña
     - Código de invitación (auto-completado si vino por URL, o editable si entró directo).
   - Al hacer submit:
     1. `supabase.auth.signUp({ email, password })`.
     2. Apenas se crea el usuario, llamar a `supabase.rpc('redeem_invitation_code', { p_code: codigo, p_user_id: user.id })`.
     3. Redirigir directamente al Dashboard listo para usar.
   - Si alguien entra a registrarse sin código:
     - Mostrar advertencia: *"Para registrarte necesitás un código de invitación"* con botón `[ 💬 Solicitar acceso por WhatsApp ]`.

---

## Histórico — guía Fase 4 (CONECTAR WHATSAPP EN 1 TOQUE)

### Objetivo:
Hacer que la vinculación del bot de WhatsApp sea instantánea, sin que el cliente copie códigos ni agende números.

### Archivos a modificar:
1. **`src/Dashboard.tsx` o componente de Onboarding**:
   - Si el usuario no tiene WhatsApp vinculado (`profiles.phone_number` es null o `whatsapp_links.status !== 'active'`):
     - Mostrar banner/card destacada: `[ 🟢 Conectar mi WhatsApp en 1 toque ]`.
   - Al hacer clic:
     - Generar código de 6 dígitos en `whatsapp_links` (como hace `Settings.tsx`).
     - Abrir enlace: `https://wa.me/<NUMERO_BOT>?text=VINCULAR%20<CODIGO>`.
     - Se abre la app de WhatsApp del celular con el mensaje listo. El usuario solo toca **Enviar**.
     - El webhook procesa el mensaje, responde al usuario y actualiza `profiles.phone_number`.
     - El dashboard detecta el cambio por realtime o recarga y muestra `[ ✅ WhatsApp conectado ]`.

---

## Histórico — guía Fase 5 (LIMPIEZA DE SETTINGS Y PAYWALL AMABLE)

### Objetivo:
Limpiar la pantalla de configuración para clientes y bloquear el acceso cuando vence el período contratado.

1. **`src/Settings.tsx`**:
   - Eliminar avisos de costos de API, fechas de corte técnicas y mensajes pagos.
   - Dejar una vista amigable:
     - Tarjeta "Mi Suscripción": Plan actual, fecha de vencimiento, días restantes, botón para renovar por WhatsApp.
     - Tarjeta "WhatsApp": Número vinculado y botón para cambiar de número.
     - Tarjeta "Categorías": Gestionar categorías personales.
     - Tarjeta "Instalar aplicación": PWA install prompt.
     - Botón "Cerrar sesión".
2. **Control de Vencimiento (`Paywall / Bloqueo`)**:
   - Si `profiles.subscription_status === 'expired'` o `now() > subscription_until` (y no es admin):
     - Mostrar pantalla bloqueante: *"Tu período de suscripción ha finalizado"*.
     - Campo para ingresar un nuevo código de renovación.
     - Botón directo para hablar por WhatsApp y renovar.
