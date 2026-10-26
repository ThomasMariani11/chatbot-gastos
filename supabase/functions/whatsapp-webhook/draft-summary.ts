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
  let body = `Tenés ${
    active.length === 1 ? "1 movimiento" : `${active.length} movimientos`
  } para revisar:\n\n`;
  let incomplete = false;
  for (const item of active) {
    const missing = new Set(item.missing_fields ?? []);
    if (item.amount === null || !Number.isFinite(Number(item.amount))) {
      missing.add("amount");
    }
    if (item.occurred_on === null) missing.add("date");
    if (!item.description?.trim()) missing.add("description");
    incomplete ||= missing.size > 0;
    const amount = Number(item.amount);
    const decimals = Math.round(Math.abs(amount) * 100) % 100 !== 0;
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
          ? ` desde ${item.first_installment_month}`
          : ""
      })`
      : "";
    const date = missing.has("date")
      ? " · fecha pendiente"
      : item.occurred_on
      ? ` · ${item.occurred_on}`
      : "";
    body += `${item.position}. ${item.kind === "income" ? "🟢" : "🔴"} ${
      missing.has("description") ? "Concepto pendiente" : item.description
    } · ${value}${installments}${date}\n`;
    if (missing.size) {
      body += `   ⚠️ Falta: ${
        [...missing].map((field) => labels[field] ?? "aclaración").join(", ")
      }.\n`;
    }
  }
  if (incomplete) {
    body += '\nHay datos pendientes. No se guarda nada hasta completarlos o quitar el movimiento. Usá RESUMEN para revisar, "Quitá el 2" para quitar o CANCELAR para descartar la lista.';
  } else {
    body +=
      '\nPodés seguir agregando, corregir alguno (ej: "el 2 fue de 5.000"), quitar ("quitá el 2") o responder *CONFIRMAR* para guardar todo.';
  }
  return body;
}
