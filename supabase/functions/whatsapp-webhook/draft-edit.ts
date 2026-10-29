import {
  looksLikeDraftCorrection,
  parseDraftCorrection,
} from "./draft-corrections.ts";
import { validDraftDate } from "./draft-normalization.ts";
import type { DraftListItem } from "./draft-summary.ts";
export type EditContext = {
  group_id?: string;
  version?: number;
  items?: DraftListItem[];
};
export type DraftPatch = {
  amount?: number;
  description?: string;
  category?: string;
  currency?: "ARS" | "USD";
  occurred_on?: string;
  installments?: number;
  first_installment_month?: string;
  kind?: "expense" | "income";
};
export type PendingEdit = {
  kind: "edit";
  position: number;
  group_id: string;
  version: number;
  patch: DraftPatch;
  edits?: Array<{ position: number; patch: DraftPatch }>;
};
const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const clarify = () => ({
  kind: "reply" as const,
  text:
    'Indicá el número y el cambio: "El 2 fue de 250", "El 2 concepto farmacia", "El 2 categoría Salud", "El 2 moneda USD", "El 2 fecha 2026-10-26" o "El 2 cuotas 3 desde 2026-11". Para varios cambios: "El 2: importe 250; moneda USD". No agregué movimientos. No modifiqué la lista.',
});
export function buildPendingEdit(
  position: number,
  patch: DraftPatch,
  context: EditContext,
): PendingEdit | { kind: "reply"; text: string } {
  if (
    !Number.isSafeInteger(position) || position < 1 || position > 2147483647 ||
    !context.group_id || !Number.isSafeInteger(context.version) ||
    context.version! < 1 ||
    !(context.items ?? []).some((i) =>
      i.position === position && i.status === "pending"
    )
  ) {
    return {
      kind: "reply",
      text:
        "No encontré ese movimiento pendiente en la lista actual. Revisala con RESUMEN; no modifiqué nada.",
    };
  }
  const keys = Object.keys(patch),
    allowed = [
      "amount",
      "description",
      "category",
      "currency",
      "occurred_on",
      "installments",
      "first_installment_month",
      "kind",
    ];
  if (
    !keys.length || keys.some((k) => !allowed.includes(k)) ||
    ("amount" in patch &&
      (typeof patch.amount !== "number" || !Number.isFinite(patch.amount) ||
        patch.amount <= 0 || patch.amount >= 1e12 ||
        Number(patch.amount.toFixed(2)) !== patch.amount)) ||
    ("description" in patch &&
      (typeof patch.description !== "string" || !patch.description.trim() ||
        patch.description.length > 160)) ||
    ("category" in patch &&
      (typeof patch.category !== "string" || !patch.category.trim() ||
        patch.category.length > 40)) ||
    ("currency" in patch && !["ARS", "USD"].includes(patch.currency!)) ||
    ("kind" in patch && !["expense", "income"].includes(patch.kind!)) ||
    ("occurred_on" in patch && !validDraftDate(patch.occurred_on)) ||
    ("installments" in patch &&
      (!Number.isInteger(patch.installments) || patch.installments! < 1 ||
        patch.installments! > 60)) ||
    ("first_installment_month" in patch &&
      (typeof patch.first_installment_month !== "string" ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(patch.first_installment_month) ||
        !validDraftDate(patch.first_installment_month + "-01") ||
        patch.installments === 1))
  ) return clarify();
  return {
    kind: "edit",
    position,
    group_id: context.group_id,
    version: context.version!,
    patch,
  };
}
function field(raw: string): DraftPatch | null {
  const m = raw.trim().match(
    /^(importe|monto|concepto|descripci[oó]n|categor[ií]a|moneda|fecha|cuotas|tipo)\s+(.+)$/i,
  );
  if (!m) return null;
  const name = norm(m[1]), value = m[2].trim(), normalized = norm(value);
  if (name === "importe" || name === "monto") {
    const money = parseDraftCorrection("El 1 fue de " + value);
    return money?.kind === "edit" ? { amount: money.amount } : null;
  }
  if (name === "concepto" || name === "descripcion") {
    return value.length <= 160 && !/[\r\n;]/.test(value)
      ? { description: value }
      : null;
  }
  if (name === "categoria") {
    return value.length <= 40 && !/[\r\n;]/.test(value)
      ? { category: value }
      : null;
  }
  if (name === "moneda") {
    return /^(ars|pesos?)$/.test(normalized)
      ? { currency: "ARS" }
      : /^(usd|dolares?)$/.test(normalized)
      ? { currency: "USD" }
      : null;
  }
  if (name === "fecha") {
    return validDraftDate(value) ? { occurred_on: value } : null;
  }
  if (name === "tipo") {
    return /^(gasto|egreso)$/.test(normalized)
      ? { kind: "expense" }
      : /^ingreso$/.test(normalized)
      ? { kind: "income" }
      : null;
  }
  const installments = normalized.match(
    /^(\d{1,2})(?:\s+desde\s+(\d{4}-(?:0[1-9]|1[0-2])))?$/,
  );
  if (!installments) return null;
  const n = Number(installments[1]), month = installments[2];
  if (
    n < 1 || n > 60 || (n === 1 && month) ||
    (month && !validDraftDate(month + "-01"))
  ) return null;
  return {
    installments: n,
    ...(month ? { first_installment_month: month } : {}),
  };
}
export function parsePendingEdit(
  raw: string,
  context: EditContext,
): ReturnType<typeof buildPendingEdit> | null {
  if (!looksLikeDraftCorrection(raw)) return null;
  if (/[\r\n]/.test(raw) || /\b(?:y|,)\s*(?:el|la)\s+\d+\b/i.test(raw)) {
    return clarify();
  }
  const amount = parseDraftCorrection(raw);
  if (amount?.kind === "edit") {
    return buildPendingEdit(
      amount.position,
      { amount: amount.amount },
      context,
    );
  }
  const m = raw.trim().match(
    /^(?:(?:cambi[aá]|correg[ií]|corrige|modific[aá]|edit[aá])\s+)?(?:el|la)\s+(?:(?:movimiento|operaci[oó]n|gasto|ingreso)\s+)?(\d+)\s*(?::\s*|\s+)(.+)$/i,
  );
  if (!m) return clarify();
  const patch: DraftPatch = {};
  for (const part of m[2].split(";")) {
    const parsed = field(part);
    if (!parsed || Object.keys(parsed).some((k) => k in patch)) {
      return clarify();
    }
    Object.assign(patch, parsed);
  }
  if (!Object.keys(patch).length) return clarify();
  return buildPendingEdit(Number(m[1]), patch, context);
}
