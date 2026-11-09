import { BOT_MESSAGES, listFooter, overLimitMessage } from "./bot-messages.ts";
export type DraftListItem = {
  id?: string;
  position: number;
  kind: "expense" | "income";
  description: string;
  amount: number | null;
  currency: string;
  occurred_on?: string | null;
  installments?: number;
  first_installment_month?: string | null;
  category_name?: string | null;
  status: string;
  missing_fields?: string[];
  clarification?: string | null;
};

const labels: Record<string, string> = {
  amount: "importe",
  date: "fecha",
  description: "concepto",
  review: "aclaración",
};
const MONTHS = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."];

// Fecha local de Argentina (AAAA-MM-DD), igual criterio que el resto del bot.
function argentinaToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

function shiftDays(isoDate: string, days: number): string {
  const date = new Date(isoDate + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// "hoy", "ayer", "07/11" o "07/11/2025" si es de otro año.
export function friendlyDate(isoDate: string, today: string): string {
  if (isoDate === today) return "hoy";
  if (isoDate === shiftDays(today, -1)) return "ayer";
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  return `${day}/${month}` + (year === today.slice(0, 4) ? "" : `/${year}`);
}

function monthName(yearMonth: string, today: string): string {
  const [year, month] = yearMonth.slice(0, 7).split("-");
  const name = MONTHS[Number(month) - 1] ?? yearMonth;
  return year === today.slice(0, 4) ? name : `${name} ${year}`;
}

export function formatDraftList(
  items: DraftListItem[],
  today: string = argentinaToday(),
): string {
  const active = items.filter((item) => item.status === "pending");
  if (!active.length) return BOT_MESSAGES.emptyList;
  if (active.length > 20) throw new Error("DRAFT_SUMMARY_CAPACITY");
  let body = `📝 Tenés ${
    active.length === 1 ? "1 movimiento" : `${active.length} movimientos`
  } para guardar:\n\n`;
  const rowBudget = Math.floor((4000 - body.length - 600) / active.length);
  let incomplete = false, abbreviated = false;
  let example = active[0].position;
  for (const item of active) {
    const missing = new Set(item.missing_fields ?? []);
    if (item.amount === null || !Number.isFinite(Number(item.amount))) {
      missing.add("amount");
    }
    if (item.occurred_on === null) missing.add("date");
    if (!item.description?.trim()) missing.add("description");
    if (missing.size > 0 && !incomplete) example = item.position;
    incomplete ||= missing.size > 0;
    const amount = Number(item.amount),
      decimals = Math.round(Math.abs(amount) * 100) % 100 !== 0;
    const value = missing.has("amount")
      ? "importe pendiente"
      : item.currency === "USD"
      ? `US$ ${
        amount.toLocaleString("es-AR", {
          minimumFractionDigits: decimals ? 2 : 0,
          maximumFractionDigits: 2,
        })
      }`
      : amount.toLocaleString("es-AR", {
        style: "currency",
        currency: "ARS",
        minimumFractionDigits: decimals ? 2 : 0,
        maximumFractionDigits: 2,
      });
    // "desde" solo si las cuotas empiezan en otro mes que el de la compra.
    const firstMonth = item.first_installment_month?.slice(0, 7);
    const installments = item.installments && item.installments > 1
      ? ` en ${item.installments} cuotas${
        firstMonth && firstMonth !== item.occurred_on?.slice(0, 7)
          ? ` desde ${monthName(firstMonth, today)}`
          : ""
      }`
      : "";
    // Si falta la fecha no se muestra: la línea "⚠️ Falta" ya lo indica.
    const date = !missing.has("date") && item.occurred_on
      ? ` · ${friendlyDate(item.occurred_on, today)}`
      : "";
    const prefix = `${item.position}. *${item.kind === "income" ? "Ingreso" : "Gasto"}* `;
    const category = item.category_name?.replace(/\s+/g, " ").trim();
    const categoryLimit = active.length > 10 ? 16 : 40;
    let clippedCategory = "";
    for (const char of category ?? "") {
      if (clippedCategory.length + char.length > categoryLimit - 1) break;
      clippedCategory += char;
    }
    const categoryText = category
      ? " · " +
        (category.length > categoryLimit ? clippedCategory + "…" : category)
      : "";
    if (category && category.length > categoryLimit) abbreviated = true;
    const suffix = ` — ${value}${installments}${categoryText}${date}\n`;
    const missingText = missing.size
      ? `    ⚠️ Falta: ${
        [...new Set([...missing].map((field) => labels[field] ?? "aclaración"))]
          .join(", ")
      }\n`
      : "";
    const limit = rowBudget - prefix.length - suffix.length -
      missingText.length;
    if (limit < 1) throw new Error("DRAFT_SUMMARY_CAPACITY");
    let description = missing.has("description")
      ? "Concepto pendiente"
      : item.description.replace(/\s+/g, " ").trim();
    if (description.length > limit) {
      let clipped = "";
      for (const char of description) {
        if (clipped.length + char.length > limit - 1) break;
        clipped += char;
      }
      description = clipped + "…";
      abbreviated = true;
    }
    body += prefix + description + suffix + missingText;
  }
  if (abbreviated) body += "\n" + BOT_MESSAGES.abbreviated + "\n";
  body += "\n" + listFooter(active.length, incomplete, example);
  if (body.length > 4096) throw new Error("DRAFT_SUMMARY_CAPACITY");
  return body;
}

export function formatOverLimitReply(count: number): string {
  if (!Number.isSafeInteger(count) || count <= 20) {
    throw new Error("INVALID_OVERSIZED_BATCH");
  }
  return overLimitMessage(count);
}
