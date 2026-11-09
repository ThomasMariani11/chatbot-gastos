// Textos que el bot envía al cliente al cargar, corregir y cuando no entiende un mensaje.
// Los marcados como "también en SQL" se repiten en 049_friendlier_bot_messages.sql;
// tests/durable-queue.test.ts verifica que ambos coincidan (049 aplicada sobre PGlite).

const EXAMPLE = '👉 "Gasté 1500 en súper"';

export const BOT_MESSAGES = {
  emptyList: "No tenés nada pendiente 👌\nMandame un gasto o ingreso cuando quieras.",
  abbreviated: "(Algunos nombres están recortados con …)",
  editUnclear:
    'Uy, no me quedó claro qué cambiar 🤔\nDecime el número y el dato nuevo, por ejemplo:\n👉 "el 2 fue de 250"\n👉 "el 2 categoría Salud"',
  completionUnclear:
    'Decime qué movimiento completar y el dato que falta, por ejemplo:\n👉 "el 2 fue de 5000"\n👉 "el 2 concepto farmacia"',
  amountUnclear:
    'Para cambiar el monto, decime el número y el importe nuevo:\n👉 "el 2 fue de 250"',
  // También en SQL.
  itemNotFound: "No encontré ese número en tu lista 🤔\nEscribí RESUMEN para verla.",
  removeWithoutNumber: '¿Cuál querés sacar? Decime el número:\n👉 "quitá el 2"',
  // También en SQL.
  listChanged: "Tu lista cambió mientras tanto.\nMirala con RESUMEN y repetí el cambio.",
  // También en SQL.
  changeFailed: "No pude aplicar ese cambio 😕\nMirá tu lista con RESUMEN y probá de nuevo.",
  // También en SQL.
  listCapacityWaiting:
    "Con este mensaje tu lista pasaría de 20 movimientos 😅\nGuardé el mensaje para después.\n\nConfirmá o sacá algunos movimientos y lo proceso solo.",
  unsupportedType: "Ese tipo de mensaje no lo puedo leer 🤔\nMandame texto, un audio o una foto.",
  fileTooLarge:
    "El archivo es muy pesado 📎\nMandame una foto de hasta 5 MB, un audio de hasta 10 MB o escribime el gasto.",
  fileFormat: `No puedo abrir ese archivo 📎\nMandame una foto JPG o PNG, o escribime el gasto:\n${EXAMPLE}`,
  audioUnclear: `No logré entender el audio 🎧\n¿Me lo escribís? Por ejemplo:\n${EXAMPLE}`,
  imageUnclear: `No logré leer la foto 📷\n¿Me escribís el gasto? Por ejemplo:\n${EXAMPLE}`,
  textUnclear: `No terminé de entender el mensaje 🤔\nEscribime el concepto y el monto, por ejemplo:\n${EXAMPLE}`,
  aiQuota:
    `Por hoy llegué a mi límite para leer audios, fotos y mensajes largos 🙏\nEscribime el gasto simple, por ejemplo:\n${EXAMPLE}\n\nTus pendientes siguen ahí.`,
  // También en SQL.
  manualReview:
    "No pude procesar este mensaje 😕 Lo guardé para revisarlo.\nMientras tanto, escribime el gasto con el concepto y el monto.\n\nTu lista sigue igual.",
  mixedQuery: "Mandame la consulta y el gasto por separado, así no me confundo 🙂\nTu lista sigue igual.",
} as const;

// `example` es un número que existe en la lista (el primer incompleto, o el primero).
export function listFooter(count: number, incomplete: boolean, example = 2): string {
  if (incomplete) {
    return `Me faltan algunos datos 🤔\nCompletalos con el número del movimiento:\n👉 "el ${example} fue de 5000"\n👉 "el ${example} concepto farmacia"\n\nSi alguno no va, sacalo con "quitá el ${example}".\nCuando esté todo, respondé *CONFIRMAR*.`;
  }
  return `¿Está todo bien? Respondé *CONFIRMAR* para ${count === 1 ? "guardarlo" : "guardarlos"} ✅\n\n✏️ Para corregir: "el ${example} fue de 5000"\n🗑️ Para sacar uno: "quitá el ${example}"`;
}

// También en SQL (whatsapp_over_limit_reply).
export function overLimitMessage(count: number): string {
  return `¡Son muchos! 😅 Me mandaste ${count} y puedo anotar hasta 20 por lista.\n\nMandámelos en mensajes más cortos.\nSi ya tenés pendientes, confirmalos primero para hacer lugar.`;
}
