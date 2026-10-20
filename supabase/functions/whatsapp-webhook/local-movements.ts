import { hasUnparsedNumberWords } from "./spoken-amounts.ts";
import type { ExtractedMovement } from "./movement-types.ts";
import { looksLikeDraftCorrection } from "./draft-corrections.ts";

const normalize = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const expenseAction = /^(?:gaste|pague|compre|abone|cargue|gasto)\b\s*/;
const incomeAction =
  /^(?:me\s+(?:ingreso|ingresaron|pagaron|transfirieron|depositaron|acreditaron)|cobre|recibi|vendi|ingreso)\b\s*/;
const startsMovement =
  /^(?:(?:gaste|pague|compre|abone|cargue|gasto|cobre|recibi|vendi|ingreso|sueldo|salario|haberes|venta)\b|me\s+(?:ingreso|ingresaron|pagaron|transfirieron|depositaron|acreditaron)\b|(?:ars|usd|u\$s|us\$|\$)?\s*\d)/i;
const moneyPattern =
  /(?:(?:ars|usd|u\$s|us\$|\$)\s*)?(?:\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*(?:k|mil|lucas?))?(?:\s*(?:pesos?|ars|usd|d[oó]lar(?:es)?))?/gi;

function validDate(value: string): boolean {
  const date = new Date(`${value}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function dateIn(text: string, today: string) {
  if (!validDate(today)) return null;
  const dates = [
    ...text.matchAll(
      /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{4})?|hoy|ayer|anteayer)\b/gi,
    ),
  ];
  if (dates.length > 1) return null;
  if (!dates.length) return { text, occurredOn: today };
  const match = dates[0];
  let occurredOn = normalize(match[0]);
  if (/^(hoy|ayer|anteayer)$/.test(occurredOn)) {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(
      date.getUTCDate() -
        (occurredOn === "ayer" ? 1 : occurredOn === "anteayer" ? 2 : 0),
    );
    occurredOn = date.toISOString().slice(0, 10);
  } else if (occurredOn.includes("/")) {
    const [day, month, year = today.slice(0, 4)] = occurredOn.split("/");
    occurredOn = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  if (!validDate(occurredOn)) return null;
  const before = text.slice(0, match.index).replace(/\bel\s*$/i, "");
  return {
    text: `${before} ${text.slice(match.index! + match[0].length)}`.trim(),
    occurredOn,
  };
}

function categoryFor(description: string, kind: "expense" | "income"): string {
  const text = normalize(description);
  const categories: Array<[string, RegExp]> = kind === "income"
    ? [
      ["Sueldo", /\b(sueldo|salario|haberes|quincena)\b/],
      ["Freelance", /\b(freelance|diseno|proyecto|cliente)\b/],
      ["Ventas", /\b(venta|mercadolibre)\b/],
    ]
    : [
      [
        "Alimentación",
        /\b(super|supermercado|chango|coto|vea|dia|disco|carrefour|almacen|verduleria|carniceria|panaderia|comida|almuerzo|cena|merienda|desayuno|cafe|cafes|restaurant|restaurante|pedidosya|rappi|mcdonalds|mostaza|burger|helado|facturas|kiosco|caramelos)\b/,
      ],
      [
        "Transporte",
        /\b(nafta|combustible|ypf|shell|axion|uber|cabify|didi|taxi|colectivo|subte|tren|peaje|estacionamiento|cochera|sube)\b/,
      ],
      [
        "Servicios",
        /\b(luz|gas|agua|internet|wifi|fibertel|telecentro|flow|cable|claro|personal|movistar|expensas|edenor|edesur|metrogas)\b/,
      ],
      ["Vivienda", /\b(alquiler|inmobiliaria)\b/],
      [
        "Salud",
        /\b(farmacia|remedio|medicamento|medico|doctor|dentista|odontologo|psicologo|consulta|analisis|creatina|suplementos?|proteinas?|optica)\b/,
      ],
      [
        "Educación",
        /\b(colegio|facultad|universidad|curso|taller|capacitacion|libro|apunte)\b/,
      ],
      [
        "Ocio",
        /\b(cine|teatro|boliche|recital|salida|bar|cerveza|juego|steam|playstation|netflix|spotify|disney|hbo|prime)\b/,
      ],
      [
        "Compras",
        /\b(ropa|zapatillas|remera|pantalon|shopping|zapatos|camisa|buzo|campera)\b/,
      ],
      [
        "Impuestos",
        /\b(afip|rentas|monotributo|arba|iibb|impuesto|tasa|patente)\b/,
      ],
      ["Deudas", /\b(prestamo|tarjeta|deuda)\b/],
    ];
  return categories.find(([, rule]) => rule.test(text))?.[0] ?? "Otros";
}

// Gramática conservadora: si queda un número/dato sin entender, se deriva el
// mensaje completo. Nunca tomar el primer número y descartar el resto.
export function parseDeterministicMovement(
  raw: string,
  today: string,
): ExtractedMovement | null {
  let text = raw.trim().replace(/[.!]+$/, "").trim();
  const normalized = normalize(text);
  if (
    !text || looksLikeDraftCorrection(text) || /[?¿]/.test(text) ||
    /\b(no|nunca|quizas|tal vez|creo|si|cuanto|como|donde|cuando|cual|cuales|mostra|mostrame|decime|dime|pasame|ayuda|explicame|cancelar|confirmar|quitar|borrar|saca|quita|borra|elimina|cambia|corregi|modifica|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|semana|mes|eur|euros?|brl|reales|gbp|uruguayos|chilenos|mexicanos|guaranies|yenes)\b/
      .test(normalized) ||
    /\b(voy a|tengo que|debo|quiero|podria|deberia|iba a|me deben|por cobrar|por pagar|cada cuota|por cuota|de las cuales|en total entre)\b/
      .test(normalized)
  ) return null;
  const dated = dateIn(text, today);
  if (!dated) return null;
  text = dated.text;
  const start = normalize(text);
  const expense = start.match(expenseAction);
  const income = start.match(incomeAction);
  const namedIncome = /^(sueldo|salario|haberes|venta)\b/.test(start);
  const kind = income || namedIncome ? "income" : "expense";
  const action = income ?? expense;
  if (action) text = text.slice(action[0].length).trim();
  // Sin dirección, una transferencia/depósito puede ser entre cuentas propias.
  if (!action && /\b(transferencia|deposito)\b/.test(normalize(text))) {
    return null;
  }

  let installments = 1;
  if (/\bcuotas?\b/.test(normalize(text))) {
    const quota = text.match(/\b(?:en\s+)?(\d{1,2})\s+cuotas\b/i);
    if (!quota || kind === "income" || !/\btotal\b/i.test(text)) return null;
    installments = Number(quota[1]);
    if (installments < 2 || installments > 60) return null;
    text = text.replace(quota[0], " ").replace(
      /\b(?:por\s+un\s+)?total(?:\s+de)?\b/i,
      " ",
    ).trim();
    if (/\bcuotas?\b/.test(text)) return null;
  }
  const amounts = [...text.matchAll(moneyPattern)];
  if (amounts.length !== 1) return null;
  const match = amounts[0], index = match.index!;
  // No aceptar fragmentos de números mal escritos, negativos, fechas o modelos.
  if (
    /[\p{L}\p{N}.,/+$-]/u.test(text[index - 1] ?? "") ||
    /[\p{L}\p{N}.,/]/u.test(text[index + match[0].length] ?? "")
  ) return null;
  const token = normalize(match[0]);
  const usd = /usd|u\$s|us\$|dolar(?:es)?/.test(token);
  const ars = /ars|pesos?/.test(token);
  if (usd && ars) return null;
  const number = token.match(/\d[\d.,]*/)?.[0];
  if (!number) return null;
  const numeric = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(number)
    ? number.replaceAll(".", "").replace(",", ".")
    : number.replace(",", ".");
  const amount = Math.round(
    Number(numeric) *
      (/\b(k|mil|lucas?)\b/.test(token.replace(number, " ")) ? 1000 : 1) *
      100,
  ) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e12) return null;
  let description = `${text.slice(0, index)} ${
    text.slice(index + match[0].length)
  }`
    .replace(/\s+/g, " ").trim()
    .replace(/^(?:en|de|por)\s+/i, "")
    .replace(/\s+(?:en|de|por)$/i, "").trim();
  if (
    /\d|[$€£/]/.test(description) ||
    /\b(ars|usd|pesos?|dolar(?:es)?|total|cuotas?)\b/.test(
      normalize(description),
    )
  ) return null;
  if (
    !action && !namedIncome &&
    (!description || /^(?:me|se|nos|le|les)\b/.test(normalize(description)) ||
      /\b(tuve|tengo|tenia|tendre|gane|facture|encontre|perdi|devolvi|devolvieron|reintegro|sobro|faltan|falta|quedan|deben|debo|deuda|deudas|precio|precios|cuesta|vale|costaria|costara|seria|fue|eran|ejemplo|cotizacion|presupuesto|pendiente|pendientes)\b/
        .test(normalize(description)) ||
      /\b(gaste|pague|compre|cobre|ingreso|ingresaron|recibi|transferi|deposite|pagar|gastar|cobrar|gastado|pagado|gastamos|pagamos|cobramos|gastos|ingresos)\b/
        .test(normalize(description)))
  ) return null;
  // No absorber magnitudes/fracciones desconocidas dentro del concepto.
  if (hasUnparsedNumberWords(description)) return null;
  // Un segundo verbo sin separador puede indicar otra operación incompleta.
  if (
    /\b(gaste|pague|compre|cobre|ingreso|ingresaron|recibi|me pagaron|me transfirieron)\b/
      .test(normalize(description))
  ) return null;
  const concepts = description.split(/\s+y\s+/i).map((part) =>
    categoryFor(part, kind)
  );
  const knownCategories = new Set(
    concepts.filter((category) => category !== "Otros"),
  );
  if (knownCategories.size > 1) return null;
  if (!description) {
    description = kind === "expense" ? "Gasto general" : "Ingreso general";
  }
  description = description.charAt(0).toUpperCase() + description.slice(1);
  return {
    kind,
    description,
    totalAmountArs: amount,
    currency: usd ? "USD" : "ARS",
    occurredOn: dated.occurredOn,
    category: categoryFor(description, kind),
    installments,
    firstInstallmentMonth: installments > 1
      ? dated.occurredOn.slice(0, 7)
      : null,
    confidence: 0.95,
    missingFields: [],
  };
}

export function parseDeterministicMovements(
  text: string,
  today: string,
): ExtractedMovement[] | null {
  // No separar decimales ni conceptos como "pan y leche". Las comas/y solo
  // abren otra operación cuando sigue un importe o una acción reconocida.
  const parts: string[] = [];
  let from = 0;
  for (const separator of text.matchAll(/\r?\n|;|,\s*|\s+y\s+/gi)) {
    const index = separator.index!;
    const rest = text.slice(index + separator[0].length).trimStart();
    const decimal = separator[0] === "," && /\d/.test(text[index - 1] ?? "") &&
      /^\d/.test(rest);
    if (
      decimal ||
      (!/\n|;/.test(separator[0]) && !startsMovement.test(normalize(rest)))
    ) continue;
    parts.push(text.slice(from, index));
    from = index + separator[0].length;
  }
  parts.push(text.slice(from));
  const results: ExtractedMovement[] = [];
  for (const part of parts) {
    const cleaned = part.trim().replace(/^(?:[-•]\s+|\d+[.)]\s+)/, "");
    if (!cleaned) return null;
    const movement = parseDeterministicMovement(cleaned, today);
    if (!movement) return null;
    // No heredar silenciosamente el tipo en una lista de ingresos abreviada.
    if (
      results.at(-1)?.kind === "income" &&
      !expenseAction.test(normalize(cleaned)) && movement.kind !== "income"
    ) return null;
    // En continuaciones sin verbo, no adivinar si una fecha/moneda aplica
    // también al resto de la frase ("ayer gasté 100 super y 200 nafta").
    const previous = results.at(-1);
    if (
      previous && !expenseAction.test(normalize(cleaned)) &&
      !incomeAction.test(normalize(cleaned)) &&
      (previous.occurredOn !== movement.occurredOn ||
        previous.currency !== movement.currency)
    ) return null;
    results.push(movement);
  }
  return results.length ? results : null;
}
