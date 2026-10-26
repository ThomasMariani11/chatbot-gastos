import { parseDeterministicMovements } from "./local-movements.ts";

const commercialTopic =
  /\b(renovar|renovacion|suscripcion|planes?|precios?|membresia|alias|cbu|datos de pago|medios de pago)\b|\bcuanto (sale|cuesta)\b|\bcomo (pago|abono|renuevo)\b|\bdonde (pago|transfiero)\b|\bquiero pagar\b/;
const balanceTopic =
  /\b(saldo|disponible|balance)\b|\bcuant[ao]\s+(plata|dinero|me\s+queda)\b/;
const completedAction =
  /\b(gaste|pague|compre|abone|cargue|cobre|recibi|vendi|ingreso|ingresaron|pagaron|transfirieron|transferi|deposite|depositaron|debitaron|acreditaron)\b/;
// Separar solo cláusulas: nunca usar la coma decimal como separador de importes.
// Esta gramática de consultas es finita; lo no reconocido sigue al extractor.
const requestStart =
  "(?:[¿?¡!]\\s*)?(?:(?:hola|che|por favor)[,!.:\\s]+)*(?:cuant[oa]s?\\b|como\\b|donde\\b|cuales?\\b|(?:me\\s+)?(?:podes|podrias)\\b|(?:pasame|dame|mandame|decime|mostrame|enviame)\\b|(?:quiero|quisiera|necesito)\\s+(?:saber|consultar|ver|renovar|pagar|conocer)\\b)";
const requestHead = new RegExp("^" + requestStart);
const movementStart =
  "(?:gaste|pague|compre|abone|cargue|cobre|recibi|vendi|ingreso|sueldo|salario|haberes|venta)\\b|me\\s+(?:ingreso|ingresaron|pagaron|transfirieron|depositaron|acreditaron)\\b|(?:ars|usd|us\\$|\\$)?\\s*\\d|(?:suscripcion|saldo)\\b(?=[^;\\n]*\\d)";
const bareQueryEnd =
  "(?:el\\s+)?(?:saldo(?:\\s+disponible)?|mi\\s+balance|alias|cbu|planes)[.!?]*\\s*$";
const clauseSeparator = new RegExp(
  "[;\\n]+|\\.\\s+|(?:,\\s*|\\s+(?:y|ademas|tambien)\\s+)(?=" +
    requestStart + "|" + movementStart + "|" + bareQueryEnd + ")",
);
const bareQueryWithAmount =
  /^(?:(?:mi|el)\s+)?(?:saldo(?:\s+disponible)?|balance|disponible|planes?|suscripcion|membresia)\s*[:=]?\s*(?:ars|usd|us\$|\$)?\s*\d/;

// Las consultas rápidas no deben interceptar operaciones ni comprobantes.
export function classifyTextQuery(
  raw: string,
  hasMedia = false,
  today = new Date().toISOString().slice(0, 10),
): "commercial" | "balance" | "clarify" | null {
  if (hasMedia) return null;
  const text = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
  const queries = new Set<"commercial" | "balance">();
  let hasMovement = false, ambiguous = false, unrecognizedClause = false;
  for (const clause of text.split(clauseSeparator).filter((s) => s.trim())) {
    const part = clause.trim();
    const commercial = commercialTopic.test(part);
    const balance = balanceTopic.test(part);
    const request = requestHead.test(part);
    if (request && completedAction.test(part) && (commercial || balance)) {
      // Una pregunta sobre un gasto pasado no pide precios ni el saldo general.
      ambiguous = true;
      continue;
    }
    // Una consulta explícita puede mencionar un importe.
    // Las propuestas claras reutilizan el parser productivo, sin otra gramática.
    const movement = !request && !bareQueryWithAmount.test(part) &&
      (completedAction.test(part) ||
        (/\d/.test(part) &&
          (/\b(gasto|ingresos?|transferencia|deposito|sueldo|venta)\b/.test(
            part,
          ) ||
            /^\$?\s*\d/.test(part))) ||
        Boolean(parseDeterministicMovements(part, today)?.length));
    if (movement) {
      hasMovement = true;
    } else if (commercial || balance) {
      if (!request && /\d/.test(part)) ambiguous = true;
      else {
        if (commercial) queries.add("commercial");
        if (balance) queries.add("balance");
      }
    } else if (!/^(?:hola|buenas|gracias|por favor)[.!¡?¿]*$/.test(part)) {
      unrecognizedClause = true;
    }
  }
  if (
    ambiguous || queries.size > 1 ||
    (queries.size && (hasMovement || unrecognizedClause))
  ) {
    return "clarify";
  }
  if (hasMovement) return null;
  return queries.values().next().value ?? null;
}
