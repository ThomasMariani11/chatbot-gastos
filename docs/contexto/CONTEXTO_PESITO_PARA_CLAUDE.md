# Pesito — Contexto completo del producto y del proyecto para Claude

> **Documento de transferencia de contexto.** Describe el producto, la implementación y las decisiones vigentes. No autoriza cambios, despliegues, gastos ni acceso a cuentas.
>
> **Fecha:** 29/10/2026, Argentina. **Código revisado:** `main`, commit `ebbefceb75a3f73670e95ee7b51d76aaf9f072f3`, PR #68.
>
> **Observaciones operativas:** la revisión de planes utiliza ecba420/001–041. Las observaciones previas son fechadas y no se revalidaron aquí. La aplicación productiva de 042/BE-22 está **sin verificar en esta tarea documental**; no inferir despliegue por merge.
>
> Sin contraseñas, tokens, claves, códigos utilizables, teléfonos de clientes, movimientos reales ni comprobantes. Todos los ejemplos financieros son ficticios.

## Revisión documental de planes — 29/10/2026

Se reconciliaron ambos planes con base funcional ecba420 (PR #67) y migraciones 001–041, separando incorporaciones, pendientes y registros históricos. No se agregan funcionalidades ni se certifica un despliegue. BE-22/042 se conserva como avance posterior del checkout, con publicación productiva **sin verificar en esta tarea**.

FE-14 queda pendiente según la instrucción actual; el descarte previo se conserva como historia. INF-13/INF-08 se aplazan y la retención INF-14 sigue preparada/desactivada. Thomas continúa como único administrador. Se preservan las ediciones locales previas del contexto.

## Índice

1. Producto y objetivos.
2. Estado actual y decisiones del propietario.
3. Funcionalidades de la PWA para clientes.
4. Cuotas y reglas financieras.
5. Funcionalidades del bot de WhatsApp.
6. Reglas locales, audio, fotos e IA.
7. Administración y suscripciones.
8. Arquitectura y flujos completos.
9. Datos, RPC y endpoints.
10. Fiabilidad e idempotencia.
11. Seguridad y privacidad.
12. Instalación, actualización y rendimiento.
13. Operación y recuperación.
14. Entornos, despliegue y pruebas.
15. Limitaciones y funciones que no deben darse por existentes.
16. Mejoras recientes y pendientes.
17. Mapa del repositorio.
18. Cómo usar este contexto con Claude.
19. Inventario de migraciones y tablas.

---

## 1. Producto y objetivos

**Pesito**, también identificado históricamente como **ChatBot Gastos** o `chatbot-gastos`, es una aplicación de finanzas personales que permite registrar y consultar gastos e ingresos desde una web instalable y desde WhatsApp. Los dos canales trabajan sobre la misma base de datos.

La propuesta es reducir el esfuerzo de registrar operaciones: escribir un texto, mandar un audio o enviar una foto de un comprobante, revisar lo que entendió el bot y confirmar. La PWA permite cargar/editar directamente y consultar resumen mensual, categorías, presupuesto y cuotas.

No es una cuenta bancaria, un procesador de pagos ni un servicio que mueva dinero. Los saldos provienen de los movimientos registrados en Pesito. No hay sincronización bancaria automática acreditada por la implementación revisada.

### Objetivos

- Registrar gastos e ingresos con poca fricción.
- Admitir uno o varios movimientos en un mensaje o en varios mensajes seguidos.
- Revisar y corregir lo interpretado por WhatsApp antes de guardarlo.
- Consultar balance, presupuesto, categorías y cuotas por mes.
- Separar pesos argentinos y dólares estadounidenses.
- Ofrecer una experiencia móvil clara, amigable y en español con voseo argentino.
- Evitar operaciones perdidas, duplicadas o guardadas parcialmente.
- Facilitar la gestión administrativa de clientes, membresías e incidentes.
- Resolver lo claro con reglas locales antes de consumir IA.

### Identidad y acceso

- Nombre visible: **Pesito**.
- Repositorio: `https://github.com/ThomasMariani11/chatbot-gastos`.
- PWA: `https://thomasmariani11.github.io/chatbot-gastos/`.
- Web responsive para celular/escritorio e instalable como PWA.
- Cada cuenta tiene sus movimientos, categorías, presupuesto, opciones y vínculo de WhatsApp.

## 2. Estado actual y decisiones del propietario

La aplicación está desplegada en producción técnica, pero su uso actual es una **beta privada orientada a cuatro usuarios**. Esto no equivale a un lanzamiento comercial abierto al público general.

| Rol | Uso |
| --- | --- |
| `client` | Gestionar sus finanzas, membresía y vínculo con WhatsApp. |
| `admin` | Acceder además al panel administrativo y a sus operaciones autorizadas. |

El propietario es Thomas. La comprobación agregada del bloque de alta encontró cuatro cuentas completas y un único administrador, Thomas. No se incluyen identidades de clientes en este archivo.

**Decisión expresa:** Thomas seguirá siendo el único administrador por ahora. El administrador inicial quedó excluido de BE-13. No agregar administradores ni automatizar promociones a partir de este documento.

### Restricciones que deben preservarse

1. **Costo adicional objetivo: USD 0** en la beta. No activar planes ni facturación por iniciativa del asistente.
2. El bot usa el **número de prueba de Meta**, según la última revisión documentada. No cambiarlo a un número propio sin revisar autorización y costos.
3. Groq es la vía de IA de la beta. No cambiar proveedores, modelos, claves o cupos sin acordarlo.
4. **Hosting y cabeceras HTTP pendientes de INF-13: etapa final**. Conservar la CSP actual.
5. **Backups INF-08: aplazados al final**. No reactivar la preparación Google Cloud/Drive ni presentarla como backup cloud operativo.
6. **Retención 30/90: preparada pero desactivada**. No habilitar purgas sin autorización específica.
7. Ensayos ficticios y aislados. No inyectar fallos ni enviar pruebas a clientes reales sin autorización.
8. No modificar movimientos confirmados, vencimientos históricos o códigos consumidos como atajo para resolver un problema.
9. Publicar PWA, aplicar migraciones y desplegar webhook son operaciones distintas.

## 3. Funcionalidades de la PWA para clientes

### 3.1. Registro e inicio de sesión

- Registro con nombre, apellido, correo, contraseña, repetición de contraseña e invitación.
- Validación orientativa del código mientras se escribe, con espera breve y control de respuestas antiguas.
- Una respuesta de un código anterior no debe pintar como válido el código nuevo; las solicitudes superadas se cancelan.
- Ingreso con correo/contraseña o enlace de acceso por correo —magic link/OTP de Supabase—.
- Estados visibles para carga de sesión, carga del perfil y errores.
- Alta Auth/perfil/configuración/categorías/invitación atómica mediante SQL; no depende de una segunda escritura de perfil que deba completar el navegador.
- Ante una respuesta de red perdida, conserva el formulario y orienta a comprobar acceso/correo antes de repetir con otra invitación.
- Una cuenta sin acceso vigente ve el flujo de membresía, renovación o canje.

Confirmación y entrega de correo dependen de la configuración de Auth y del servicio de email. No asumir entrega garantizada o licencia activada por una respuesta ofuscada de cuenta duplicada.

### 3.2. Pantallas y navegación

| Vista | Hash / acceso |
| --- | --- |
| Inicio / Resumen | `#resumen`. |
| Movimientos | `#movimientos`. |
| Cuotas | `#cuotas`. |
| Ajustes | `#settings`. |
| Administración | `#admin`, con rol autorizado. |

Se usan estado React, hashes e historial del navegador. No es una app basada en React Router o Next.js. Incluye navegación inferior móvil, accesos de escritorio y gestos para volver en los flujos correspondientes.

### 3.3. Resumen mensual

- Saludo por nombre y selección del mes.
- Selector **ARS / USD**.
- Totales de gastos, ingresos y balance del período en esa moneda.
- Presupuesto mensual en ARS y seguimiento del consumo.
- Alta, modificación y eliminación del presupuesto.
- Gráfico de gastos por categoría y detalle ampliado.
- Últimos movimientos del mes y acceso a la lista completa.
- Próximas cuotas calculadas con registros realmente existentes.
- Accesos a cargar, Ajustes, instalación/vinculación y administración si corresponde.
- Estados de carga, vacío, error y refresco; al cambiar de mes no debe presentar cifras viejas como datos del mes nuevo.

**Semántica:** balance mensual = ingresos menos gastos de la misma moneda. Presupuesto restante = presupuesto ARS menos gastos ARS. No equivale al saldo real de una cuenta bancaria ni integra una conversión de USD.

### 3.4. Movimientos

- Consulta en el contexto de mes y moneda.
- Búsqueda por concepto/categoría, tolerante a acentos.
- Filtro de tipo: todos, gastos o ingresos.
- Filtro por categoría.
- Fecha, concepto, importe, moneda y referencia de cuotas cuando corresponde.
- Presentación por fecha y **50 elementos por página** en la lista.
- Edición y eliminación/cancelación con su flujo visual.

La lectura mensual usa cursor estable por ID y luego ordena por fecha descendente y desempate estable. No volver a mezclar un cursor por ID con un orden de consulta incompatible. Es la corrección de PR #66.

### 3.5. Alta y edición manual

| Dato | Contrato |
| --- | --- |
| Tipo | Gasto o ingreso. |
| Concepto | Breve, hasta 160 caracteres. |
| Importe | Positivo, hasta dos decimales; presentación argentina. |
| Moneda | ARS o USD. |
| Fecha | Fecha válida de la operación. |
| Categoría | Del usuario y compatible con el tipo. |
| Cuotas | Las compras con plan usan el flujo específico. |

Las altas manuales de movimiento/plan tienen identificador de solicitud y recibo SQL. El intento pendiente se conserva por usuario en `sessionStorage`, para comprobar una recarga o respuesta perdida sin crear otra operación.

El formulario manual guarda desde la PWA. No exige la revisión conversacional de WhatsApp: son canales con contratos de borrador y confirmación distintos.

### 3.6. Ajustes

- Estado/vencimiento de membresía o acceso sin vencimiento.
- Abrir conversación para renovar por WhatsApp.
- Canjear invitación/renovación.
- Editar nombre y apellido.
- Conservar el borrador de nombre al navegar y ante refrescos del perfil.
- Detectar conflictos entre edición local y datos remotos y permitir decidir qué conservar.
- Cerrar sesión mediante confirmación.
- Solicitar código de vínculo y abrir WhatsApp con `VINCULAR <código>` preparado; el usuario debe enviarlo.
- Abrir chat y pausar/reanudar respuestas automáticas para su cuenta.
- Instalar la PWA o ver instrucciones según navegador.
- Acceder al panel de control si el rol lo permite.

Los campos históricos de autorización de mensajes pagos o fecha de corte no constituyen un bloqueo universal de facturación.

### 3.7. Soporte por WhatsApp

FE-23 / PR #67 agrega un **icono de WhatsApp en la barra superior del Dashboard**, con etiqueta accesible y foco visible.

- Usa `support_phone` de `system_config`, con respaldo en el número del bot.
- Sanitiza el teléfono y construye un enlace `wa.me` con texto inicial de ayuda.
- El enlace externo usa `noopener noreferrer`.
- Abre una conversación; no manda automáticamente el mensaje.
- El propietario excluyó agregar este mismo icono nuevo en Ajustes. Los enlaces de renovación/chat ya existentes allí son otra funcionalidad.

### 3.8. Catálogo base de categorías

El alta inicial prepara 16 categorías separadas por tipo:

| Tipo | Categorías iniciales |
| --- | --- |
| Gasto | Alimentación, Transporte, Vivienda, Servicios, Salud, Educación, Ocio, Compras, Impuestos, Deudas, Otros. |
| Ingreso | Sueldo, Freelance, Ventas, Rendimientos, Otros. |

Tienen identidad, propietario, color, icono y estado activo. Seleccionar o clasificar con estas categorías no equivale a disponer de una pantalla completa de creación de categorías personalizadas; esa ampliación está pendiente.

## 4. Cuotas y reglas financieras

### 4.1. Monedas y centavos

- Solo **ARS y USD**; no sumar monedas ni convertirlas automáticamente.
- WhatsApp usa ARS por defecto. Una moneda contradictoria o no soportada requiere rechazo/aclaración, no sustitución silenciosa.
- PostgreSQL conserva precisión decimal; los cálculos críticos utilizan centavos.
- `amount_ars`, `amountArs` y `totalAmountArs` son **nombres heredados**. Con `currency = USD`, el valor numérico está en USD, no convertido a ARS.
- Usar agregadores conscientes de moneda y contratos actuales. Un helper histórico de suma no es seguro para mezclar filas sin filtrar.

### 4.2. Planes de compra

- Operación simple: una cuota.
- Editor de planes PWA: **2 a 60 cuotas**, presets y cantidad personalizada.
- Importe ingresado como total de compra o valor de cada cuota, según modo.
- Cuota de referencia y fecha, para registrar también una compra ya iniciada.
- Fechas mensuales con día preferido y ajuste al último día válido; el ajuste de febrero no se arrastra permanentemente a marzo.
- División en centavos conservando el total: 100 / 3 puede producir 33,33 + 33,33 + 33,34. El resto se compensa en la última cuota.
- En extracción WhatsApp, la cantidad interpretada representa el total de la compra dentro del contrato vigente; no dividirla dos veces.

### 4.3. Edición y eliminación

- Un plan se abre con identidad, filas y versión.
- Se puede editar una cuota o aplicar cambios al plan conforme al editor.
- Moneda, cantidad y reprogramación global necesitan el alcance correcto.
- Se envían solo los campos modificados.
- La versión esperada evita pisar cambios concurrentes.
- Categorías y planes se validan por propietario, no solo por formato de UUID.
- Las mutaciones relevantes se hacen atómicamente mediante RPC.
- Se puede quitar una cuota o compra completa por identidad, no por descripción.
- Dos compras con el mismo concepto son distintas.
- Comprobar un reintento viejo no debe recrear cuotas eliminadas.

Hay una cabecera técnica de plan y filas de cuotas. No contar la cabecera como un gasto adicional ni reconstruir cuotas inexistentes para calcular totales.

### 4.4. Próximas cuotas

Se suman y cuentan las cuotas existentes programadas desde el corte:

- Mes futuro elegido: desde su primer día.
- Contexto actual/no futuro: desde hoy.
- Cada moneda por separado.
- No extrapolar “valor × cantidad original” si faltan cuotas.
- Una fecha programada no prueba que un débito bancario se haya cobrado o pagado.

## 5. Funcionalidades del bot de WhatsApp

### 5.1. Vincular teléfono y cuenta

1. Desde una sesión autorizada se solicita código al backend.
2. Se generan seis dígitos y se guarda su hash, con diez minutos de vigencia.
3. La PWA prepara `VINCULAR <código>` y abre el chat.
4. El usuario envía el comando.
5. El backend valida código, expiración, acceso, intentos y concurrencia.
6. El vínculo y los cambios de propietario se aplican atómicamente.

040 agrega protección de intentos fallidos. El código no se consume si el vínculo falla por un conflicto transitorio. Invitación de membresía y código de vínculo son cosas diferentes.

### 5.2. Entradas y propuesta

Acepta textos, audios y fotos; uno o varios gastos, ingresos o ambos; varios mensajes rápidos y combinaciones de formatos.

Ejemplo ficticio:

```text
Gasté 15000 en supermercado, 4000 en nafta y cobré 80000 por diseño.
```

Respuesta conceptual:

```text
Tenés 3 movimientos para revisar:
1. 🔴 Supermercado · $15.000
2. 🔴 Nafta · $4.000
3. 🟢 Diseño · $80.000

Podés seguir agregando, corregir alguno o responder CONFIRMAR.
```

Conceptos breves: “Supermercado”, no toda la frase original con importe y medio de pago.

### 5.3. Lista pendiente

- Como máximo una lista abierta por usuario.
- Se agregan mensajes sin cancelar automáticamente el borrador anterior.
- El resumen espera a no tener mensajes anteriores por interpretar y a cumplir la ventana durable de silencio.
- El worker tiene una espera corta de tres segundos como optimización. SQL también persiste la condición de estar listo. No prometer una respuesta en tres segundos ni reducir toda la política a un timer en memoria.
- Máximo **20 operaciones pendientes activas**, no posición máxima 20.
- Numeración estable: quitar el 2 no renumera el 3.
- El mensaje retenido por capacidad no debe perderse ni bloquear los comandos que permiten liberar espacio.
- No truncar silenciosamente mensajes que excedan el límite.
- Confirmar exige revisión mostrada y vigente de esa versión.
- Una confirmación durante procesamiento obliga a revisar el próximo resumen y confirmar otra vez.
- Se confirma grupo y cuotas en una transacción SQL, sin guardado parcial ni falso éxito.

### 5.4. Comandos

| Mensaje | Resultado |
| --- | --- |
| `RESUMEN`, `pendientes`, `ver lista` | Lista pendiente; no es el balance mensual. |
| `CONFIRMAR` | Guarda la versión revisada si satisface las guardas. |
| `sí`, `ok`, `dale`, `listo` | Alias de confirmación, con las mismas guardas. |
| `CANCELAR`, `no`, `cancelar todo` | Descarta el borrador según su estado. |
| `El 2 fue de 5000` | Corrige el importe del ítem 2; no crea otro gasto. |
| `El 1 fue farmacia` | Corrección de concepto; si resulta ambigua pide aclaración. |
| `Quitá el 2`, `sacame el 2` | Quita ese ítem sin cambiar los otros números. |
| `Cancela el 5 y el 6`, `Cancela 4.5.6`, `Quitá el 2 y el 3` | Bajas múltiples atómicas sin desfasar números (BE-22, migración 042). |
| `Cancela el 6` | Reconocido como comando/intención de baja; no se convierte en gasto de $6 (BE-22). |
| `El 1: es comida \n El 2: gaseosa` | Correcciones múltiples multilínea interpretadas en lote por IA (BE-22). |
| `RETOMAR` | Resuelve continuar una lista antigua. |
| `DESCARTAR` | Resuelve descartar la lista antigua y libera el mensaje nuevo según el flujo. |
| `hola`, `ayuda`, `comandos` | Ayuda de uso. |

Las correcciones validan grupo, versión, posición y campos permitidos. Ante ambigüedad, preguntar sin modificar otras operaciones.

### 5.5. Datos faltantes y listas antiguas

- Conservar operaciones incompletas junto con las completas.
- No confirmar hasta completar lo esencial o quitar la operación incompleta.
- Defaults: ARS, fecha local y categoría Otros cuando no se indican de forma identificable.
- Una fecha expresamente ambigua puede requerir aclaración.
- Tras **24 horas sin actividad**, pedir RETOMAR o DESCARTAR.
- Si vuelve con un gasto nuevo, conservarlo hasta resolver la lista anterior.
- Un CONFIRMAR retenido antes de RETOMAR no autoriza guardar una revisión nueva que nunca se mostró.

### 5.6. Consultas

Además de cargar, interpreta preguntas sobre gastos/ingresos/balance mensual, presupuesto disponible cuando corresponde, renovación, soporte, medios de pago configurados y ayuda.

Una consulta explícita con cifras no es un gasto. Un gasto que dice “transferencia” o “pagué” no debe desviarse automáticamente a una respuesta comercial. Existen regresiones específicas de esas clasificaciones.

## 6. Reglas locales, audio, fotos e IA

### 6.1. Qué tipo de sistema es

Combina parsers deterministas, prompts/esquemas, proveedores externos, normalización y persistencia SQL. No tiene acreditados modelo propio entrenado, fine-tuning, base vectorial un agente autónomo general que decida negocios.

“Local” significa reglas del servidor sin llamada a IA; no significa que el mensaje de WhatsApp se procese enteramente en el celular.

### 6.2. Circuitos de interpretación

- **Texto claro:** comando, consulta o parser determinista → respuesta/borrador sin IA si se resuelve con seguridad.
- **Texto complejo:** extracción estructurada → validación/normalización → borrador. La respuesta del modelo no escribe finanzas directamente.
- **Audio:** descarga de Meta → transcripción Whisper/Groq → normalización de números hablados → reutilización de comandos/correcciones/parser local → extracción compleja solo si sigue siendo necesaria.
- **Foto:** descarga y validación → extracción por el adaptador de IA configurado → validación → borrador. No hay OCR offline propio acreditado.

Un comprobante representa normalmente una compra/operación. Sus productos no son automáticamente gastos distintos. Varias operaciones se admiten si la imagen muestra comprobantes o movimientos claramente independientes.

### 6.3. Modelos y proveedor

| Vía | Configuración del código revisado |
| --- | --- |
| Groq audio | `whisper-large-v3-turbo`. |
| Groq extracción | `qwen/qwen3.8-27b`, con esquema estructurado y validación. |
| Rama Gemini conservada | `gemini-3.1-flash-lite` primero; `gemini-3.8-flash` como siguiente candidato de esa rama. |

Son nombres configurados, no una certificación de catálogo/disponibilidad actual de los proveedores.

- Si existe `GROQ_API_KEY`, se selecciona Groq.
- **Fallar Groq no activa automáticamente Gemini.**
- La rama Gemini puede elegirse por configuración si falta Groq, pero el gate de la beta **deniega Gemini**.
- No describir Google como respaldo gratuito automático operativo.
- Ciertos textos pueden recuperarse por una regla determinista segura; si no, se pide texto/aclaración.

### 6.4. Cuotas propias de Pesito

| Recurso | Cupo diario compartido |
| --- | ---: |
| Extracciones complejas/fotos vía Qwen | 100. |
| Transcripciones vía Whisper | 200. |

- Compartidos entre usuarios, no por persona.
- Reinicio a medianoche de Argentina.
- Avisos en el panel al 75% y 90%.
- Reserva SQL antes de HTTP; los fallos pueden consumir reserva de forma conservadora.
- Un audio puede usar una transcripción y luego una extracción si el texto es complejo.
- Reglas locales y comandos no necesitan consumir ese cupo.
- Estos contadores no reemplazan límites de tokens, solicitudes o audio del proveedor.
- Los planes gratuitos pueden cambiar: verificarlos antes de lanzar o cambiar de plan.

### 6.5. Fallback a texto

Ante fallo compatible de interpretación de audio/foto:

1. Conservar checkpoint persistente de pedido de texto y diagnóstico permitido.
2. Pedir concepto e importe por escrito; si eran varios, pedir todos en texto.
3. Aclarar que todavía no se cargó nada de ese medio.
4. Evitar reintentos indefinidos de IA que dejen esperando al cliente.
5. Reintentar entrega sin reinterpretar ni duplicar operaciones.

La cola guarda payload y referencia de media. **No equivale a guardar una copia permanente del audio/foto en una carpeta local o backup.**

Existieron incidentes históricos de Gemini con 503 y esperas; motivaron límites, vía Groq y pedido de texto. Son antecedentes, no prueba de una caída actual de todos los modelos.

### 6.6. Límites efectivos

| Recurso / operación | Límite propio |
| --- | --- |
| Imagen | 5 MiB; política JPEG/PNG. |
| Audio | 10 MiB; política MIME validada. |
| Metadatos Meta | 16 KiB. |
| JSON de proveedor | 256 KiB. |
| JSON de error/respuesta de envío | 16 KiB. |
| Solicitud inline completa Gemini | 19.000.000 bytes UTF-8. |
| Metadatos y descarga | 10 segundos compartidos. |
| Interpretación completa | 30 segundos compartidos. |
| Intento de mensaje | 60 segundos compartidos. |
| Supabase/RPC | 5 segundos por petición. |
| Envío WhatsApp | 10 segundos compartidos. |
| Actores en paralelo | Máximo 2. |
| Ventana para iniciar trabajos | 45 segundos por invocación. |

Gemini tiene además 10 s por modelo con medios y 3,5 s con texto, dentro del presupuesto exterior. No son garantías de latencia total: intervienen cola, red, Meta y recuperación.

Se controlan bytes realmente recibidos, no solo Content-Length. Un MIME admitido no garantiza que el proveedor pueda decodificar cualquier archivo de esa familia. Hay varios formatos de audio aceptados por la política; un fallo del proveedor sigue el pedido de texto.

## 7. Administración y suscripciones

### 7.1. Panel

| Pestaña | Funcionalidades |
| --- | --- |
| Clientes | Lista, búsqueda/filtros, estado, vencimiento, métricas de activos/próximos a vencer, extensión/renovación y pausa/reactivación. |
| Invitaciones | Generar, listar, copiar y gestionar códigos con duración/estado; eliminar según el flujo permitido. |
| Bot | Cola, procesamiento, revisión manual, incidentes, métricas, cupo IA y avisos técnicos. |
| Ajustes | Número del bot, soporte y alias/instrucciones de pago según controles disponibles. |

Clientes e invitaciones: **20 filas por página** en presentación. La configuración relacionada se reúne en una consulta a `system_config`.

### 7.2. Estados de membresía

- `active`: temporal vigente o acceso sin vencimiento.
- `expired`: vencido.
- `suspended`: pausado; sumar días no debe reactivarlo automáticamente.
- `pending_code`: pendiente de activación/código.

El cliente necesita `active` y fecha futura, o `subscription_until = null` en el contexto activo. El administrador tiene el acceso que habilitan sus políticas. La validación de pantalla está respaldada por autorización en SQL/backend.

### 7.3. Renovación y canje

- Se suman días desde el mayor entre vencimiento vigente y hora del servidor.
- Renovar anticipadamente no debe perder días ya disponibles.
- Acceso vitalicio se conserva conforme al contrato.
- Renovar una cuenta suspendida no quita su pausa.
- Canje y cambio de membresía se realizan en una transacción.
- Códigos temporales o vitalicios; 040 incorpora `expires_at`, validado tanto en alta como en renovación.
- Solicitudes administrativas con identidad, recibo e idempotencia para respuesta perdida/reintento.
- El cliente no puede editar libremente su rol o vencimiento.
- Un rol SQL interno sin login permite renovaciones autorizadas; no es otro administrador humano ni una cuenta a compartir.

**Pendiente:** enviar automáticamente al cliente una notificación WhatsApp al renovarlo. El enlace actual “Renovar por WhatsApp” abre una conversación; no es esa automatización ni una pasarela de cobro.

### 7.4. Avisos técnicos al administrador

Ya hay alertas en panel y, si está autorizado y el canal lo permite, en WhatsApp del propietario. Los incidentes permiten identificar cliente, fecha/hora argentina, origen, etapa y causa controlada.

No confundir esta función operativa con recordatorios o notificaciones periódicas para clientes. Tampoco asumir mensajes ilimitados fuera de las restricciones de ventana, emisor y costo de Meta.

## 8. Arquitectura y flujos completos

### 8.1. Stack

| Capa | Tecnología |
| --- | --- |
| Cliente | React 19.2.6 + TypeScript 5.9.3. |
| Build | Vite 8.1.6. |
| Gráficos | Recharts 3.x. |
| Estado | Hooks, controladores y cachés propios; no Redux/Zustand como base. |
| Identidad/datos | Supabase Auth, PostgreSQL, RLS, RPC/PostgREST. |
| Servidor del bot | Supabase Edge Function TypeScript/Deno. |
| Mensajes | Meta WhatsApp Cloud API. |
| IA | Adaptadores Groq/Gemini con las restricciones ya explicadas. |
| Web | Sitio estático GitHub Pages. |
| Recuperación | `pg_cron`, transporte HTTP privado y worker Edge. |
| Tests | Vitest, jsdom/React, PGlite, PostgreSQL y Supabase local en CI. |

```text
PWA → Supabase JS → Auth + PostgREST/RPC → PostgreSQL/RLS

WhatsApp → Meta → webhook firmado → cola SQL persistente
                                         ↓
                         worker exclusivo por actor/usuario
                                         ↓
                         reglas locales / audio / extracción IA
                                         ↓
                             checkpoint + borrador + resumen
                                         ↓
                            confirmación SQL atómica del grupo
                                         ↓
                              movimientos y cuotas definitivos

pg_cron → recuperación privada del worker
Métricas/alertas SQL → panel admin y aviso técnico autorizado
GitHub Actions → cuatro controles → publicación PWA desde main
```

### 8.2. Distribución de responsabilidades

No hay un único servidor REST tradicional. La PWA opera contra Supabase con sesión/RLS; la Edge Function atiende el bot. Parte fundamental del negocio vive en funciones, constraints, triggers y transacciones PostgreSQL.

Cambiar solo React o solo el parser puede romper una regla coordinada con SQL. Hay que seguir el contrato completo del flujo.

### 8.3. Módulos del webhook

- `index.ts`: HTTP, firmas, dependencias, workers y rutas auxiliares.
- `queue.ts`: leases, checkpoint, aplicación, finalización y recuperación.
- `processor.ts`: preparación y decisión del mensaje.
- `context-repository.ts`: vínculo, identidad, perfil y configuración/contexto.
- `meta-client.ts`: Meta, firma, envío y descarga de media.
- `gemini.ts` / `groq.ts`: adaptadores y esquemas de IA.
- `helpers.ts`: fachada compatible con contratos/imports previos.
- Módulos específicos de comandos, parser, montos hablados, descripciones, correcciones, faltantes, resumen, métricas y fallos.

Las lecturas de contexto independientes se paralelizan. Las claves comerciales de configuración se leen juntas. Siempre verificar que `job.user_id` coincida con el vínculo actual del teléfono.

## 9. Datos, RPC y endpoints

### 9.1. Dominios persistidos

| Dominio | Tablas principales | Función |
| --- | --- | --- |
| Identidad | `auth.users`, `profiles` | Cuenta, nombre, rol y membresía. |
| Finanzas | `transactions`, `categories`, `budgets` | Movimientos, categorías del usuario y presupuesto ARS. |
| Configuración | `app_settings`, `system_config` | Opciones de usuario y valores globales. |
| Invitaciones | `invitation_codes`, `invitation_check_attempts` | Activación, renovación, expiración y límite de consulta. |
| WhatsApp | `whatsapp_links`, `inbound_events` | Asociación de teléfono y eventos de recepción. |
| Borradores | `draft_groups`, `draft_items` | Lista, ítems y versiones. |
| Cola | `whatsapp_message_queue`, `whatsapp_worker_state`, `whatsapp_user_leases`, `whatsapp_queue_control` | Orden, checkpoint, exclusión y control. |
| Recibos PWA | `pwa_entry_requests`, `installment_plan_requests` | Altas/planes idempotentes. |
| Recibos de renovación | `admin_subscription_requests` | Solicitudes administrativas. |
| IA | `ai_quota_policy`, `ai_quota_days`, `ai_quota_reservations` | Política, contador y reserva previa a HTTP. |
| Operación | `whatsapp_ops_config`, `whatsapp_ops_metrics`, `whatsapp_ops_alerts`, `whatsapp_ops_notifications` | Incidentes, métricas y avisos técnicos. |

### 9.2. Campos y estados importantes

`transactions`: propietario, tipo, descripción, importe, moneda, fecha, categoría, estado y cuotas. Origen: `text`, `audio`, `image` o `pwa`. Estados: `pending`, `confirmed`, `cancelled`.

`draft_groups`: estado y versión de la lista. `draft_items`: propietario, grupo, posición, tipo, importe, moneda, fecha, categoría, cuotas, faltantes, origen y mensaje/operación. Las migraciones posteriores permiten conservar datos incompletos controladamente.

`whatsapp_message_queue`: ID WhatsApp, payload, orden, estado, intentos, resultado interpretado, efecto aplicado, respuesta pendiente/enviada y contexto de confirmación. La entrega durable usa esos campos: no inventar una tabla genérica de outbox diferente del diseño real.

Contadores, alertas y filas de revisión no son movimientos financieros.

### 9.3. RPC representativas

| Grupo | Funciones |
| --- | --- |
| Acceso | `has_active_subscription`, `is_admin`, `check_invitation_code`. |
| Alta | `bootstrap_user` como trigger de Auth, no RPC pública de reparación. |
| Membresía | `redeem_invitation_code`, `admin_renew_subscription` y puente privado de identidad. |
| Vínculo | `request_whatsapp_link_code`; aplicación durable de vinculación. |
| PWA | `submit_pwa_entry`. |
| Planes | `get_installment_plan`, `mutate_installment_plan`. |
| Borradores | `get_active_draft_group`, `confirm_draft_group`, `discard_draft_group`, `complete_pending_draft_item`, `edit_pending_draft_item`. |
| Cola | `enqueue_whatsapp_messages`, `claim_whatsapp_actor`, `next_whatsapp_job`, `checkpoint_whatsapp_job`, `apply_whatsapp_job`, `finish_whatsapp_job`, `fail_whatsapp_job`. |
| Worker/resumen | `whatsapp_summary_snapshot`, `mark_whatsapp_summary_sent`, `release_whatsapp_actor`, `due_whatsapp_actors`. |
| Finanzas | `whatsapp_monthly_summary`, `monthly_summary`. |
| IA | `reserve_whatsapp_ai_quota`, `whatsapp_ai_quota_dashboard`. |
| Operación | `whatsapp_ops_dashboard`, `whatsapp_ops_issue_details`, `configure_whatsapp_ops_alerts`, `acknowledge_whatsapp_ops_alert`, `prune_whatsapp_ops_content`. |

Consultar firma y permisos en la última migración que redefine cada función. Que figure aquí no significa que todos los roles puedan ejecutarla.

### 9.4. HTTP Edge

| Ruta / método | Contrato |
| --- | --- |
| `GET /functions/v1/whatsapp-webhook` | Handshake Meta con verify token. |
| `POST /functions/v1/whatsapp-webhook` | Firma HMAC sobre cuerpo original. |
| `POST ...?action=worker` | Worker privado, exige su secreto. |
| `POST ...?action=test-send` | Envío administrativo controlado; no ruta pública libre. |

Se despliega `verify_jwt=false` porque Meta no envía JWT de Supabase. **No significa sin autenticación:** cada vía tiene su protección propia.

### 9.5. Contratos que requieren especial cuidado

**Extracción normalizada:** el resultado del intérprete es una intención y una lista. Este ejemplo es ilustrativo de dominio, no una RPC pública ni una autorización para guardar:

```json
{
  "intent": "add_movements",
  "movements": [{
    "kind": "expense",
    "description": "Supermercado",
    "totalAmountArs": 15000,
    "currency": "ARS",
    "occurredOn": "2026-10-29",
    "category": "Alimentación",
    "installments": 1,
    "firstInstallmentMonth": null,
    "confidence": 1,
    "missingFields": []
  }]
}
```

Revisar `movement-types.ts`, esquemas del adaptador y normalización antes de modificar campos. Un resultado JSON válido todavía necesita validación de negocio, propietario y versión.

**Resumen financiero:** `whatsapp_monthly_summary` devuelve agregación completa por moneda y cantidades decimales como cadenas para conservar centavos; el consumidor usa tratamiento exacto. La RPC heredada `monthly_summary` conserva un contrato solo ARS. No sustituir una por otra suponiendo el mismo formato ni convertir cadenas monetarias con flotantes sin revisar la precisión.

**Solicitud idempotente:** el identificador de intento es estable durante su recuperación. La misma solicitud no puede cambiar de payload para simular un reintento, y una solicitud eliminada/cancelada no debe recrear la entidad. Las versiones e identidades de grupo no son descripciones visuales.

**Fechas:** `occurred_on` es fecha de operación; los timestamps de cola/creación/recepción son otra dimensión. Los filtros mensuales usan inicio incluido y primer día del mes siguiente excluido para evitar errores en meses cortos o bisiestos.

## 10. Fiabilidad e idempotencia

### 10.1. Recepción y orden

- Leer todos los mensajes pertinentes de un payload, no solo el primero.
- Acusar recibo después de persistir el lote completo atómicamente.
- Si no se puede persistir, devolver error; no fingir recepción exitosa.
- Deduplicar reentregas de Meta por identificador WhatsApp.
- Orden de encolado persistente y exclusión por actor/teléfono y usuario.
- Lease con token/vencimiento: un worker antiguo no sigue mutando tras perderlo.
- Conservar mensajes nuevos mientras se interpretan los anteriores.
- Resolver nuevamente contexto e identidad por mensaje; VINCULAR puede cambiar la asociación.
- Recuperación programada de lo interrumpido.
- `EdgeRuntime.waitUntil` ayuda al trabajo de fondo, pero no reemplaza cola y cron.

### 10.2. Efecto versus entrega

1. Interpretar y guardar checkpoint.
2. Aplicar efecto una sola vez.
3. Conservar respuesta pendiente.
4. Enviar a Meta.
5. Marcar entrega/finalización según el resultado.

Fallar al enviar después de guardar no debe reinterpretar ni crear movimientos. Error de negocio, fallo de base y fallo de entrega tienen tratamiento distinto.

Meta puede aceptar un envío y perderse el acuse. La protección de escritura no autoriza prometer exactamente una respuesta visible en cualquier falla distribuida imaginable.

### 10.3. Guardas que no deben romperse

- Usuario, acceso, grupo y versión válidos al confirmar.
- Revisión durable vigente de esa versión.
- Bloqueo si quedan operaciones incompletas.
- Identidad de operación dentro del mensaje para deduplicar cada extracción.
- Recibos de solicitud en PWA, planes y renovaciones.
- Una lista cerrada no se reabre por repetir un webhook.
- Esperas por capacidad no consumen el mismo presupuesto que fallos técnicos.
- La revisión manual no debe bloquear indefinidamente toda la conversación.
- Cancelar no autoriza borrar el historial de deduplicación.

## 11. Seguridad y privacidad

### 11.1. Identidad y permisos

- Supabase Auth maneja identidad y sesión; RLS/RPC restringen por usuario/rol.
- El navegador usa solo clave pública del entorno.
- Nunca incluir service role, secretos de Supabase, Meta o IA en `VITE_*` o bundle.
- Cola, borradores y operaciones internas tienen escrituras restringidas a backend/RPC autorizadas.
- `SECURITY DEFINER` exige ACL acotada y `search_path` seguro.
- El rol interno de renovación es limitado y sin login.
- Categoría, plan y movimiento deben pertenecer a la identidad autorizada.
- La firma de Meta se verifica sobre el cuerpo original.
- Gemini recibe la clave en header, no en la URL.
- Ocultar el panel en React no sustituye permisos del servidor.

### 11.2. Logs versus persistencia

Los logs usan campos/motivos controlados, duraciones, contadores, proveedor y etapa. No imprimir textos, comprobantes, transcripciones, claves, teléfonos ni SQLERRM crudo.

La cola conserva contenido necesario para procesar y recuperar. “Sin texto en logs” no significa “sin texto en ninguna tabla”. El panel de incidentes puede identificar al cliente autorizado para permitir atenderlo. Preferir conteos y diagnósticos saneados al compartir contexto.

### 11.3. Navegador y red

- CSP incorporada al HTML y política de referrer.
- Scripts propios, sin habilitar `unsafe-eval` o scripts inline por comodidad.
- Hay excepción de estilos inline para React/Recharts; no habilita scripts inline.
- Orígenes locales explícitos y HTTPS/WSS en producción.
- TLS SQL y restricciones de red se trabajaron en infraestructura; una IP/red nueva puede requerir revisar allowlist.
- GitHub Pages limita cabeceras HTTP de servidor y framing; una meta CSP no resuelve todo ese alcance.

### 11.4. Antecedentes que no deben reintroducirse

- La migración histórica 005 promueve usuarios Auth preexistentes en la instalación inicial. **No reejecutarla sobre clientes productivos para configurar un admin.**
- Antes de 039 el bootstrap podía ocultar un error y conservar Auth incompleto. 039 corrige atomicidad; 040 redefine nuevamente el alta para verificar expiración de invitación.
- No restaurar runtimes que omitan guardas de confirmación, cuota IA, permisos o idempotencia.
- El plan tiene encabezados viejos e historia: contrastar cada estado con código, validación reciente y despliegue, no leer toda mención de “pendiente” como estado presente.

## 12. Instalación, actualización y rendimiento

### 12.1. PWA e instalación

- Instalable en pantalla de inicio en dispositivos compatibles.
- Instrucciones de agregar a inicio en iPhone/iPad y mecanismo disponible para otros navegadores.
- Modales según plataforma/contexto, con mejoras de accesibilidad.
- Manifest, iconos y service worker estáticos.
- Cachear recursos no acredita una app financiera completamente offline: Auth/datos/escrituras necesitan backend.

### 12.2. Actualización protegida

- Consulta de versión publicada y coordinación de SW.
- Aviso de nueva versión y actualización explícita.
- No recargar sobre un formulario activo sin protección.
- Bloqueadores para borradores, guardados, modales y flujos pendientes.
- Borrador de Ajustes conservado al navegar dentro de la sesión.
- Alta pendiente conserva identificador para comprobar el mismo intento tras recargar.
- Aceptación física en Pesito instalado en iPhone: bloqueo con borrador, navegación, descarte y recarga manteniendo sesión.
- Esa prueba no certifica todas las versiones/dispositivos ni todos los escenarios offline.

### 12.3. Rendimiento

- Login, Dashboard, Ajustes, Admin y Paywall se cargan bajo demanda.
- Reintentos de chunks limitados, con UI de error/recuperación.
- Cachés por usuario/dominio e invalidación selectiva de categorías, meses, cuotas, bot y configuración.
- Polling de Dashboard a 30 s cuando corresponde; pausa con pestaña oculta.
- Lectura paginada y verificación de conteo para no publicar un mes truncado como completo.
- Lista de movimientos 50/página; clientes e invitaciones 20/página.
- Contexto del bot en paralelo, configuración conjunta y salida temprana de formatos incompatibles.

Menos consultas o menor descarga inicial no equivalen a Core Web Vitals ya medidos en todos los teléfonos.

## 13. Operación y recuperación

### 13.1. Panel y métricas

La pestaña Bot muestra cola, procesamiento, revisión manual, historial de incidentes, métricas, cupo y estado/configuración de avisos. Permite marcar alertas revisadas mediante el flujo disponible.

Alertas de demora, fallos repetidos, revisión manual, recuperación e interpretación fallida. Detalles con cliente cuando está disponible y hora argentina. Métricas de duraciones, reintentos, proveedor y operaciones.

No inferir infraestructura contratada de Prometheus, Grafana, Sentry u otra plataforma separada.

### 13.2. Cron

- Recuperación de cola: programación por minuto en su migración.
- Observación de salud: programación por minuto.
- Limpieza operativa: job/función preparados, sujetos al flag de habilitación.

No cada tick implica una invocación Edge con trabajo. Estos cron no son recordatorios comerciales a clientes.

### 13.3. Retención

Preparada una política 30/90: retirar contenido original de mensajes terminados después de 30 días y métricas/avisos terminados después de 90, preservando movimientos, pendientes y datos necesarios para deduplicar según contrato.

**Debe permanecer desactivada.** No activar ni purgar por este documento. Deshabilitar después no recupera contenido retirado.

### 13.4. Backups

- Hay runbook de deploy y rollback compatible de runtime.
- No quedó habilitada una solución operativa de backups externos automáticos; el propietario la aplazó.
- No prometer RPO de una hora, cero pérdida o restore cloud probado a partir de un plan/experimento anterior.
- Rollback de código no es restaurar una copia de la base.
- Conservar estado durable, recibos y evidencia; no borrar pendientes ni reprocesar cancelados como atajo.

## 14. Entornos, despliegue y pruebas

### 14.1. Herramientas

| Herramienta | Referencia del proyecto |
| --- | --- |
| Node CI | 22.23.3, `.node-version`. |
| Supabase CLI | 2.120.0, `.supabase-version`. |
| Deno CI | 2.9.6. |
| PostgreSQL concurrente | 17.11, imagen fijada por digest. |
| Vitest | Rango `^4.1.12`; exactitud en lockfile. |
| PGlite | 0.5.8. |

Usar `npm ci`; no regenerar lockfile sin razón.

### 14.2. Configuración: nombres, no valores

| Ámbito | Variables / archivo |
| --- | --- |
| PWA local | `VITE_APP_ENV`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. |
| Público de producción | `config/environments.json`, destino/clave publicable/URL del sitio; valores omitidos aquí. |
| Edge Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; `SUPABASE_SECRET_KEYS` en el contrato administrativo correspondiente. |
| Meta | `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_API_VERSION`. |
| Worker | `WHATSAPP_WORKER_SECRET` y transporte privado de recuperación. |
| IA | `GROQ_API_KEY`, `GEMINI_API_KEY`, según gate y selección ya descritos. |

Local exige loopback y configuración explícita; no hereda producción silenciosamente. No copiar `.env` ni credenciales como contexto para otro asistente.

### 14.3. Comandos

```bash
npm ci
# Antes de dev: preparar Supabase local y sus variables públicas locales.
npm run dev
npm run lint
npm test
npm run test:sql
npm run test:release:guards
npm run build

# Requiere PostgreSQL y variables del ensayo local descartable:
npm run test:concurrency

# Requiere checkout limpio, Node fijado y Docker local compatible:
npm run test:release

# Metadata del repo; no despliega:
npm run release:manifest -- production
```

Desde `supabase/functions/whatsapp-webhook`:

```bash
deno cache --config deno.ci.json --frozen index.ts queue_test.ts routing_test.ts
deno task --config deno.ci.json check
deno task --config deno.ci.json lint
deno task --config deno.ci.json test
```

Los ensayos rechazan destinos remotos. No quitar guardas para conectarlos a producción. Usar Docker para CI/local no significa que producción sea Docker Compose.

### 14.4. CI/CD

`.github/workflows/deploy-pages.yml` ejecuta:

1. **Frontend:** dependencias/audit, lint, tests, SQL, guards y build.
2. **Webhook:** Deno cache/check/lint/test acotados y red simulada en pruebas.
3. **PostgreSQL:** carreras en base descartable con fixtures.
4. **Ensayo de release:** migraciones completas, Auth/API local, candidato y rollback conservando datos.

El quinto job, **Publicar**, publica Pages desde `main` cuando corresponde y aprobaron los cuatro controles. Actions por SHA, permisos limitados y protección de rama.

**Subir a main publica PWA; no aplica automáticamente todas las migraciones ni despliega automáticamente el webhook.**

### 14.5. Cobertura

Tests de UI/dominio con Vitest/jsdom, SQL real con PGlite, carreras PostgreSQL y Supabase completo local. Las revisiones recientes superan las mil pruebas; el total cambia y no garantiza ausencia de fallos.

Hay casos de RLS/propiedad, monedas/centavos, cuotas, triggers fallidos/rollback, reintentos, confirmaciones simultáneas, listas viejas, 20+1, respuestas perdidas, multimedia/timeouts, componentes reales y proveedores simulados.

No es cobertura 100%, auditoría universal ni todos los teléfonos. FE-21/BE-17 mantienen alcance transversal abierto aunque existan muchas suites particulares.

### 14.6. Publicación y rollback

1. Revisar diff, contrato y riesgos.
2. Probar aislado y obtener cuatro controles aprobados.
3. Presentar propuesta concreta y autorizar los cambios productivos necesarios.
4. Aplicar primero SQL compatible y registrar historial.
5. Actualizar Edge si el bloque lo requiere.
6. Integrar/publicar PWA en orden compatible.
7. Verificar fuentes/ACL, historial, versión pública/SW/bundle y salud.
8. Conservar un runtime de rollback compatible con el esquema expandido y las guardas vigentes.

**Contrato de release revisado (rama, 29/10/2026):** candidato mínimo 042 por las operaciones múltiples de BE-22; rollback fijado en ecba42024d413ef05a2a4d1abeb04bdbb97e869e, mínimo 041. Ambos mínimos se contrastan con inventarios completos y SQL compartido sin modificar. El arnés exige tres filas: rollback sobre 041, candidato sobre 042 y rollback conservando la base 042. Incluye RPC reales, reintentos de envío sin reinterpretar/duplicar y controles de errores seguros/expiración. La matriz completa aprobó en CI #285/PR #71 sobre el código 3690a92: rollback sobre 041, candidato sobre 042 y rollback conservando 042. Ver `docs/planes/VALIDACION_CONTRATO_RELEASE_041_042.md` y su evidencia saneada. Un manifiesto o un mínimo numérico no certifica compatibilidad por sí solo; el CI tampoco acredita una publicación o el estado de producción. Antes de volver a un runtime anterior se exige quietud; no se promete compatibilidad de checkpoints múltiples BE-22 en vuelo. No se modifica producción ni ninguna migración aplicada.

## 15. Funcionalidades que no deben darse por existentes

No afirmar que ya hay:

- Sincronización/conciliación bancaria o movimiento de dinero.
- Checkout, cobros recurrentes o pasarela de pago integrada.
- Cotizaciones, conversión automática o monedas fuera de ARS/USD.
- Contabilidad fiscal o declaraciones impositivas.
- Exportación general de usuario a PDF/CSV/Excel, salvo un flujo futuro implementado y probado.
- Gestión completa de categorías personalizadas: tener tabla `categories` no acredita esa feature.
- Notificación automática de renovación al cliente.
- Recordatorios proactivos o resúmenes periódicos a todos los clientes.
- Centro completo de preferencias/avisos de cliente ni push por el solo hecho de ser PWA.
- Operación financiera completa offline o backups por instalar la app.
- Backups externos activos con RPO/restore certificados.
- Modelo propio entrenado, OCR offline propio o agente autónomo general.
- Gratuidad indefinida o capacidad ilimitada de proveedores.
- Compatibilidad universal o certificación completa de accesibilidad.

`src/main.tsx` todavía llama al bloqueo de zoom de `src/disableZoom.ts`. FE-14 pide permitir el zoom y sigue siendo un asunto a revisar. Contraste/modal accesible no lo resuelve por extensión.

## 16. Mejoras recientes y pendientes

### 16.1. Incorporadas

| Bloque | Resultado |
| --- | --- |
| BE-13 | Alta atómica y reintentos seguros; administrador inicial excluido. |
| BE-14 | Vinculación atómica, expiración y límites; 040. |
| BE-16 | Errores negocio/base/envío y privacidad; 041. |
| FE-13 | Validaciones de invitación sin respuestas antiguas. |
| FE-17 | Pantallas bajo demanda y recuperación de chunks. |
| FE-10 | Límite 2–60 y errores visibles coherentes. |
| FE-20 | Cancelación de timers y corrección del gesto de volver. |
| FE-16 / FE-22 | Contraste y pestañas de acceso. |
| FE-08 | Dependencias de pruebas actualizadas por auditoría. |
| FE-15 | Diálogos reutilizables, foco/teclado/roles y labels. |
| FE-18 | Cachés, consultas reducidas y paginación. |
| BE-18 | Modularización y contexto paralelo del webhook. |
| PR #66 | Cursor mensual por ID coherente antes del orden por fecha. |
| FE-23 / PR #67 | Soporte WhatsApp en Dashboard. |
| BE-22 / PR #68 | Lenguaje natural y simplificación en chatbot (bajas/ediciones múltiples, guarda de cancelación y comprobantes sin bloqueo de aclaración); 042. |

Los bloques anteriores de permisos, fiabilidad, cuotas y PWA conservan sus garantías y límites; no asumir que un refactor los reemplazó por completo.

### 16.2. Pendientes y decisiones

| ID | Propuesta | Falta |
| --- | --- | --- |
| BE-19 | Aviso WhatsApp al renovar. | Texto con días/fecha, vínculo vigente, idempotencia y entrega recuperable sin bloquear renovación. |
| FE-24 / BE-20 | Categorías ampliadas/personalizadas. | Catálogo, UI, propiedad, límites y reconocimiento dinámico del bot. Un máximo ejemplificado en el plan todavía no es una restricción real. |
| FE-25 / BE-21 / NOTIF-01 | Notificaciones proactivas. | Opt-out/preferencias, recordatorios, vencimientos, resumen mensual, tareas seguras y costos de canal. |
| FE-14 | Zoom accesible. | Revisar bloqueo y gestos. |
| FE-21 / BE-17 | Cobertura transversal. | Escenarios de UI/handler/migraciones aún no acreditados. |
| INF-13 pendiente | Hosting/headers/framing. | Aplazado al final por el propietario. |
| INF-08 | Backups/restore. | Aplazado al final; solución, costo y ensayo por acordar. |
| INF-14 activación | Retención 30/90. | Preparada pero false; decisión específica antes de retirar contenido. |

Hay seguimiento histórico de un código consumido sin usuario asociado, registrado en renovaciones. No reasignarlo ni corregir vencimientos automáticamente.

Leer cada bloque completo y evidencia reciente; no tomar el encabezado histórico del plan como única fuente de estado.

## 17. Mapa del repositorio

### 17.1. Cliente y dominio

| Archivo / carpeta | Responsabilidad |
| --- | --- |
| `README.md` | Introducción, arquitectura y comandos; completar con código/runbooks. |
| `PLAN_IMPLEMENTACION_SAAS.md` | Plan original SaaS; no es el estado actual completo. |
| `src/main.tsx` | Arranque React, estilos, actualización PWA y bloqueo de zoom actual. |
| `src/App.tsx` | Sesión, perfil, acceso, navegación y pantallas diferidas. |
| `src/Login.tsx`, `src/registration.ts` | Acceso/registro y mensajes seguros. |
| `src/Dashboard.tsx` | Resumen, movimientos, cuotas, formularios y soporte. |
| `src/dashboardData.ts`, `src/dashboardLoader.ts` | Lecturas, caché, contexto, paginación y descarte de resultados viejos. |
| `src/installmentPlans.ts`, `src/installmentPresentation.ts` | Contrato de planes y presentación de cuotas reales. |
| `src/pwaEntries.ts` | Intentos idempotentes de alta y comprobación posterior. |
| `src/Settings.tsx`, `src/profileDraft.ts`, `src/useProfileDraft.ts` | Cuenta, membresía, integración y borrador personal. |
| `src/AdminPanel.tsx` | Clientes, invitaciones, bot y configuración. |
| `src/BotOperations.tsx`, `src/AiQuotaUsage.tsx` | Incidentes, métricas y cupo compartido. |
| `src/subscription.ts`, `src/subscriptionRenewals.ts` | Acceso y renovación segura/idempotente. |
| `src/whatsappLink.ts` | Solicitud del código de vínculo. |
| `src/ModalDialog.tsx` | Diálogos accesibles reutilizables. |
| `src/lazyWithRetry.tsx` | Carga diferida con recuperación acotada. |
| `src/PwaUpdates.tsx`, `src/pwaUpdateCoordinator.ts` | Versión/SW, aviso y bloqueadores de actualización. |
| `src/browser-security.ts`, `src/environment.ts`, `src/supabase.ts` | CSP, validación de entorno y cliente de datos. |
| `src/usePwaInstall.ts`, `src/InstallAppModal.tsx` | Instalación e instrucciones según plataforma. |
| `src/useSwipeBack.ts`, `src/disableZoom.ts` | Gestos y comportamiento de zoom vigente. |
| `src/summaryPresentation.ts`, `lib/finance.ts`, `lib/types.ts` | Presentación y contratos financieros; atención a helpers/nombres heredados. |
| `app/*.css`, estilos de `src/` | Diseño y responsive. La carpeta `app/` no implica Next.js. |
| `public/` | Recursos estáticos, iconos, manifest y SW; confirmar nombres efectivos antes de editar. |

### 17.2. Servidor, SQL y operación

Los siguientes módulos del bot se ubican bajo `supabase/functions/whatsapp-webhook/`:

| Módulo / ruta | Responsabilidad |
| --- | --- |
| `index.ts` | Entrada HTTP Edge y dependencias. |
| `queue.ts`, `processor.ts`, `context-repository.ts` | Ejecución durable, preparación y contexto autorizado. |
| `local-movements.ts`, `local-commands.ts`, `intent.ts` | Parser, comandos y clasificación sin IA. |
| `spoken-amounts.ts`, `movement-description.ts` | Normalización de números hablados y conceptos breves. |
| `draft-normalization.ts`, `draft-corrections.ts`, `draft-edit.ts`, `draft-completion.ts`, `draft-summary.ts` | Lista pendiente, corrección, faltantes y resumen. |
| `groq.ts`, `gemini.ts`, `meta-client.ts` | Integraciones y adaptadores externos. |
| `limits.ts`, `failures.ts`, `logging.ts` | Límites, fallos tipados y logs controlados. |
| `operations.ts`, `issue-details.ts`, `ai-quota.ts`, `admin-send.ts` | Métricas, incidentes, reservas y envío autorizado. |
| `helpers.ts` | Fachada de compatibilidad. |

Otras rutas:

| Ruta | Contenido |
| --- | --- |
| `supabase/migrations/` | Tablas, constraints, RLS, funciones, triggers y cron; leer redefiniciones. |
| `tests/` y tests Deno del webhook | Regresiones UI/dominio/SQL/canal. |
| `scripts/rehearse-release.mjs`, `scripts/release-tools.mjs`, `scripts/prepare-local.mjs` | Matriz local de esquemas/runtimes, contratos y publicación con guardas. |
| `scripts/release-runtime-probe.mjs`, `scripts/release-sql-contract.mjs` | Probes locales de procesamiento/cola/RPC y protecciones 039–041; transporte externo denegado en el probe de runtime. |
| `.github/workflows/deploy-pages.yml` | Cuatro gates y Pages. |
| `config/environments.json`, `.node-version`, `.supabase-version` | Destinos, contrato y herramientas. |
| `docs/planes/PLAN_MEJORAS_PROYECTO.md` | Auditorías y backlog, incluidos registros históricos. |
| `docs/planes/PLAN_MEJORAS_VISUALES.md` | Plan visual dado por cerrado en sus bloques, con límites de aceptación. |
| `docs/planes/VALIDACION_*.md`, `docs/planes/evidencias/` | Qué se probó/publicó, cómo y cuándo. |
| `docs/operaciones/DEPLOY_Y_ROLLBACK.md` | Publicación y recuperación compatible. |
| `docs/operaciones/COSTOS_Y_CUPOS.md` | Restricciones beta y observaciones fechadas. |
| `docs/operaciones/LIMITES_MULTIMEDIA.md` | Tamaños, MIME, tiempos y recuperación. |
| `docs/operaciones/MONITOREO_Y_RETENCION.md` | Operación, alertas y retención. |
| `docs/operaciones/SEGURIDAD_NAVEGADOR.md` | CSP y límites del hosting. |

### 17.3. Lectura recomendada para una tarea

1. Este contexto y decisiones vigentes del propietario.
2. Bloque concreto del plan y última evidencia/validación.
3. Componente o módulo del flujo y sus llamadas de datos.
4. Función SQL, redefiniciones, permisos, triggers y constraints relacionados.
5. Pruebas del caso y ensayos de release.
6. Runbook antes de tocar producción.

## 18. Cómo usar este contexto con Claude

### 18.1. Prompt de arranque sugerido

```text
Estoy desarrollando Pesito, una PWA de finanzas personales integrada con WhatsApp.
Adjunto el contexto completo del producto y su implementación.

Usalo para entender el proyecto. No supongas que podés ejecutar comandos,
leer mi repositorio, acceder a Supabase o verificar producción si no tenés
herramientas y permisos. Distinguí código actual, observación fechada,
plan pendiente y propuesta tuya.

Para la tarea que voy a pedir:
1. Identificá flujos, archivos, contratos SQL y reglas afectados.
2. Explicá el cambio necesario y las decisiones que falten.
3. Conservá aislamiento por usuario, monedas separadas, atomicidad e idempotencia.
4. No des por existente una feature documentada como pendiente.
5. No cambies costos, proveedores, hosting, backups, retención o roles por defecto.
6. Si necesitás código, pedí archivos concretos, sin claves ni datos de clientes.
7. Proponé cómo probarlo en aislado antes de una publicación autorizada.

Mi próxima tarea es: [describir aquí el objetivo concreto].
```

### 18.2. Qué adjuntar según la tarea

- **Visual:** componente, estilos, captura sin datos sensibles y experiencia deseada.
- **Movimientos/cuotas:** Dashboard, dominio y últimas RPC/migraciones del contrato.
- **Bot:** reproducción ficticia, parser/procesador/cola y SQL relacionado.
- **Membresías/vínculo:** cliente y funciones actuales de alta/canje/renovación/vínculo, sin códigos reales.
- **Operación:** métricas saneadas, estado agregado y runbook, no volcado de conversaciones.
- **Feature nueva:** objetivo, ejemplos, alcance, restricciones de costo/canal y criterios de aceptación.

Este documento no reemplaza el diff o los archivos concretos al producir código. Actualizar fecha, commit y estados después de cambios relevantes; no asumir que un contexto largo sigue siendo exacto indefinidamente.

### 18.3. Glosario

| Término | Significado en Pesito |
| --- | --- |
| Movimiento | Registro de un gasto o ingreso; no una transferencia bancaria ejecutada. |
| Borrador/lista pendiente | Propuesta conversacional todavía no confirmada. |
| Grupo | Identidad de una lista o de un plan, según el dominio. No intercambiar ambos IDs. |
| Plan | Compra dividida en cuotas con cabecera técnica y filas programadas. |
| Confirmación | Autorización de guardar una revisión vigente; no simple detección de la palabra “sí”. |
| Recibo idempotente | Evidencia SQL de una solicitud y su resultado para comprobar reintentos. |
| Lease | Exclusión temporal/token de worker; vence y no debe permitir escrituras de un worker viejo. |
| Checkpoint | Interpretación/decisión persistida para no repetir extracción o efecto tras un fallo. |
| RPC | Función SQL expuesta bajo un contrato y permisos específicos. |
| RLS | Aislamiento de filas y operaciones por identidad/rol. |
| Retención | Política de retiro de contenido, distinta de backup y actualmente desactivada. |

---

## 19. Inventario de migraciones y tablas

Lista generada desde el repositorio de referencia. Una migración puede redefinir funciones anteriores: no ejecutar una aislada por nombre sin revisar precondiciones e historial.

| Versión | Archivo |
| --- | --- |
| 001 | `supabase/migrations/001_initial.sql` |
| 002 | `supabase/migrations/002_enable_realtime.sql` |
| 003 | `supabase/migrations/003_distinct_transaction_months.sql` |
| 004 | `supabase/migrations/004_add_currency.sql` |
| 005 | `supabase/migrations/005_admin_and_invitations.sql` |
| 006 | `supabase/migrations/006_fix_rls_recursion.sql` |
| 007 | `supabase/migrations/007_require_invitation_to_activate.sql` |
| 008 | `supabase/migrations/008_fix_subscription_status_check.sql` |
| 009 | `supabase/migrations/009_system_config.sql` |
| 010 | `supabase/migrations/010_atomic_invitation_redemption.sql` |
| 011 | `supabase/migrations/011_bot_active_config.sql` |
| 012 | `supabase/migrations/012_enforce_subscription_access.sql` |
| 013 | `supabase/migrations/013_secure_subscription_renewals.sql` |
| 014 | `supabase/migrations/014_draft_movement_batches.sql` |
| 015 | `supabase/migrations/015_allow_multiple_transactions_per_wa_message.sql` |
| 016 | `supabase/migrations/016_add_name_fields_to_profiles.sql` |
| 017 | `supabase/migrations/017_restrict_draft_rpc_execution.sql` |
| 018 | `supabase/migrations/018_request_whatsapp_link_code.sql` |
| 019 | `supabase/migrations/019_enforce_backend_writes_and_owner_links.sql` |
| 020 | `supabase/migrations/020_durable_whatsapp_queue.sql` |
| 021 | `supabase/migrations/021_whatsapp_queue_recovery.sql` |
| 022 | `supabase/migrations/022_whatsapp_recovery_private_transport.sql` |
| 023 | `supabase/migrations/023_idempotent_whatsapp_delivery.sql` |
| 024 | `supabase/migrations/024_private_bootstrap_warning.sql` |
| 025 | `supabase/migrations/025_cancel_stale_list_preserve_messages.sql` |
| 026 | `supabase/migrations/026_nonblocking_manual_review.sql` |
| 027 | `supabase/migrations/027_whatsapp_observability.sql` |
| 028 | `supabase/migrations/028_whatsapp_issue_details.sql` |
| 029 | `supabase/migrations/029_atomic_installment_plans.sql` |
| 030 | `supabase/migrations/030_idempotent_pwa_entries.sql` |
| 031 | `supabase/migrations/031_atomic_subscription_renewals.sql` |
| 032 | `supabase/migrations/032_subscription_identity_bridge.sql` |
| 033 | `supabase/migrations/033_require_current_review_for_confirmation.sql` |
| 034 | `supabase/migrations/034_incomplete_draft_items.sql` |
| 035 | `supabase/migrations/035_shared_ai_quota.sql` |
| 036 | `supabase/migrations/036_monthly_financial_summary.sql` |
| 037 | `supabase/migrations/037_versioned_draft_edits.sql` |
| 038 | `supabase/migrations/038_waiting_queue_recovery.sql` |
| 039 | `supabase/migrations/039_atomic_user_signup.sql` |
| 040 | `supabase/migrations/040_atomic_whatsapp_linking.sql` |
| 041 | `supabase/migrations/041_safe_business_errors.sql` |
| 042 | `supabase/migrations/042_bulk_draft_actions.sql` |

### 19.1. Tablas públicas declaradas

Inventario de creación, no de permisos efectivos actuales; no incluye los esquemas internos administrados por Supabase.

| Tabla | Migración de creación |
| --- | --- |
| `public.admin_subscription_requests` | `031_atomic_subscription_renewals.sql` |
| `public.ai_quota_days` | `035_shared_ai_quota.sql` |
| `public.ai_quota_policy` | `035_shared_ai_quota.sql` |
| `public.ai_quota_reservations` | `035_shared_ai_quota.sql` |
| `public.app_settings` | `001_initial.sql` |
| `public.budgets` | `001_initial.sql` |
| `public.categories` | `001_initial.sql` |
| `public.draft_groups` | `014_draft_movement_batches.sql` |
| `public.draft_items` | `014_draft_movement_batches.sql` |
| `public.inbound_events` | `001_initial.sql` |
| `public.installment_plan_requests` | `029_atomic_installment_plans.sql` |
| `public.invitation_check_attempts` | `040_atomic_whatsapp_linking.sql` |
| `public.invitation_codes` | `005_admin_and_invitations.sql` |
| `public.profiles` | `005_admin_and_invitations.sql` |
| `public.pwa_entry_requests` | `030_idempotent_pwa_entries.sql` |
| `public.system_config` | `009_system_config.sql` |
| `public.transactions` | `001_initial.sql` |
| `public.whatsapp_links` | `001_initial.sql` |
| `public.whatsapp_message_queue` | `014_draft_movement_batches.sql` |
| `public.whatsapp_ops_alerts` | `027_whatsapp_observability.sql` |
| `public.whatsapp_ops_config` | `027_whatsapp_observability.sql` |
| `public.whatsapp_ops_metrics` | `027_whatsapp_observability.sql` |
| `public.whatsapp_ops_notifications` | `027_whatsapp_observability.sql` |
| `public.whatsapp_queue_control` | `020_durable_whatsapp_queue.sql` |
| `public.whatsapp_user_leases` | `020_durable_whatsapp_queue.sql` |
| `public.whatsapp_worker_state` | `020_durable_whatsapp_queue.sql` |

### 19.2. Fuentes y alcance de esta entrega

Preparado a partir de README, package/configuración, pantallas, módulos del bot, reglas/límites, migraciones 001–042, pruebas y documentos de operación/validación. Sincronizado en commit `ebbefce` (PR #68).

Este trabajo agrega documentación. No cambia código de aplicación ni aplica migraciones/despliegues; no envía datos de clientes a IA, WhatsApp o correo. La evidencia fechada se distingue del contenido histórico o propuesto del plan.
