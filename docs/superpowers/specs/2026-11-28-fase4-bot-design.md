# Fase 4, grupo del bot — diseño

Fecha: 28/11/2026. Hallazgos SEC-20 a SEC-24 (P3) del plan de remediación. SEC-27 (contenido de los avisos en la pantalla bloqueada): el propietario decidió dejarlo como está y declararlo en la política de privacidad (3.1); los avisos no muestran montos ni nombres.

Solo el webhook (`supabase/functions/whatsapp-webhook`). Sin migración ni cambios en la PWA.

| # | Hoy | Cambio |
| --- | --- | --- |
| SEC-20 | `x-worker-secret` (`/worker`, `/client-push`) y el verify token de Meta se comparan con `===`/`!==` | `sameSecret` (SHA-256 + XOR, tiempo constante), movida de `admin-send.ts` a `secrets.ts` y usada en los tres lugares |
| SEC-21 | La descarga de multimedia manda el token a cualquier URL `https` que devuelva Meta; `mediaId` sin validar | `mediaId` solo dígitos; la URL de descarga debe ser `https` de un dominio de Meta (`fbsbx.com`, `fbcdn.net`, `whatsapp.net`, `facebook.com` o subdominios). Si no, `unsupported_media`: el bot pide escribir el gasto y queda la incidencia (sin la URL) |
| SEC-22 | El tipo de imagen se toma de lo que declara Meta | Las imágenes tienen que empezar con la firma JPEG (`FF D8 FF`) o PNG (`89 50 4E 47 0D 0A 1A 0A`) que corresponde a su tipo; si no, `unsupported_media` |
| SEC-23 | Un envío fallido a `54…` se reintenta a `549…` y viceversa | Solo `549…` → `54…` (mismo número); `54…` ya no se reintenta |
| SEC-24 | No se compara el `phone_number_id` del evento | `readMessages` descarta los mensajes cuyo `metadata.phone_number_id` no es `WHATSAPP_PHONE_NUMBER_ID` (si la variable falta, no filtra, como hoy); cada descarte deja `foreign_number_dropped` con la cantidad en el log, para que un ID mal configurado no pierda mensajes en silencio |

## Compatibilidad y publicación

Deploy del webhook con smoke 401. Rollback: volver a v81 (sin cambios de esquema). Riesgo a vigilar: si Meta sirviera la multimedia desde un dominio fuera de la lista, las fotos y audios pasarían a pedir texto; aparecería como incidencias `unsupported_media` en el panel.

## Pruebas (Vitest, con `Deno` y `fetch` simulados)

Envío: `549…` fallido reintenta a `54…`; `54…` fallido no reintenta. Descarga: `mediaId` con letras rechazado sin llamar a Meta; URL de otro dominio rechazada sin mandarle el token; dominio de Meta aceptado; JPEG/PNG verdaderos aceptados, contenido distinto rechazado. `readMessages` filtra por `phone_number_id`. `sameSecret` y que `index.ts` ya no compare secretos con `===`/`!==`.
