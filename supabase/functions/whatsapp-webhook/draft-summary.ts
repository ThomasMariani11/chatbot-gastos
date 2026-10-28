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
export function formatDraftList(items: DraftListItem[]): string {
  const active = items.filter((item) => item.status === "pending");
  if (!active.length) return "No tenés movimientos pendientes en tu lista.";
  if (active.length > 20) throw new Error("DRAFT_SUMMARY_CAPACITY");
  let body = `Tenés ${
    active.length === 1 ? "1 movimiento" : `${active.length} movimientos`
  } para revisar:\n\n`;
  const rowBudget = Math.floor((4000 - body.length - 600) / active.length);
  let incomplete = false, abbreviated = false;
  for (const item of active) {
    const missing = new Set(item.missing_fields ?? []);
    if (item.amount === null || !Number.isFinite(Number(item.amount))) {
      missing.add("amount");
    }
    if (item.occurred_on === null) missing.add("date");
    if (!item.description?.trim()) missing.add("description");
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
      } [USD]`
      : amount.toLocaleString("es-AR", {
        style: "currency",
        currency: "ARS",
        minimumFractionDigits: decimals ? 2 : 0,
        maximumFractionDigits: 2,
      });
    const installments = item.installments && item.installments > 1
      ? ` (${item.installments} cuotas${
        item.first_installment_month
          ? ` desde ${item.first_installment_month.slice(0, 7)}`
          : ""
      })`
      : "";
    const date = missing.has("date")
      ? " · fecha pendiente"
      : item.occurred_on
      ? ` · ${item.occurred_on}`
      : "";
    const prefix = `${item.position}. ${item.kind === "income" ? "🟢" : "🔴"} `;
    const category = item.category_name?.replace(/\s+/g, " ").trim();
    const categoryLimit = active.length > 10 ? 16 : 40;
    let clippedCategory = "";
    for (const char of category ?? "") {
      if (clippedCategory.length + char.length > categoryLimit - 1) break;
      clippedCategory += char;
    }
    const categoryText = category
      ? " · Cat: " +
        (category.length > categoryLimit ? clippedCategory + "…" : category)
      : "";
    if (category && category.length > categoryLimit) abbreviated = true;
    const suffix = ` · ${value}${installments}${date}${categoryText}\n`;
    const missingText = missing.size
      ? `   ⚠️ Falta: ${
        [...new Set([...missing].map((field) => labels[field] ?? "aclaración"))]
          .join(", ")
      }.\n`
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
  if (incomplete) {
    body +=
      '\nCompletá los datos indicando el número: "El 2 fue de 5000", "El 2 fecha 2026-10-26" o "El 2 concepto farmacia". Para aclarar toda una operación: "El 2: gasté 5000 en farmacia". Podés quitarla con "Quitá el 2". No se guarda nada hasta completar o quitar los incompletos y responder *CONFIRMAR*.';
  } else {
    body +=
      '\nPodés seguir agregando, corregir alguno (ej: "el 2 fue de 5.000"), quitar ("quitá el 2") o responder *CONFIRMAR* para guardar todo. También podés indicar concepto, categoría, moneda, fecha o cuotas: "El 2 moneda USD".';
  }
  if (abbreviated) body += "\nConceptos o categorías abreviados con …";
  if (body.length > 4096) throw new Error("DRAFT_SUMMARY_CAPACITY");
  return body;
}
