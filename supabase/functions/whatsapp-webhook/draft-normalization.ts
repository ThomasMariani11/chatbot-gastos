import type { ExtractedMovement } from "./movement-types.ts";
export const MISSING_FIELDS = [
  "amount",
  "date",
  "description",
  "review",
] as const;
export function validDraftDate(value: unknown): value is string {
  if (
    typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000")
  ) return false;
  const d = new Date(value + "T12:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function invalid(): never {
  throw new Error("INVALID_DRAFT_EXTRACTION");
}
export function normalizeDraftMovements(
  raw: unknown,
  today: string,
  clarification?: unknown,
): ExtractedMovement[] {
  if (
    !Array.isArray(raw) || !raw.length || raw.length > 100 ||
    !validDraftDate(today)
  ) return invalid();
  if (clarification != null && typeof clarification !== "string") {
    return invalid();
  }
  const question = typeof clarification === "string"
    ? clarification.trim().slice(0, 500)
    : null;
  const items = raw.map((value): ExtractedMovement => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return invalid();
    }
    const m = value as Record<string, unknown>;
    if (m.kind !== "expense" && m.kind !== "income") return invalid();
    if (m.description != null && typeof m.description !== "string") {
      return invalid();
    }
    const flags = m.missingFields ?? [];
    if (
      !Array.isArray(flags) ||
      flags.some((f) =>
        typeof f !== "string" || ![...MISSING_FIELDS, "category"].includes(f)
      )
    ) return invalid();
    const missing = new Set<string>(flags.filter((f) => f !== "category"));
    let amount = m.totalAmountArs ?? null;
    if (
      amount !== null &&
      (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 ||
        amount >= 1e12 ||
        Number(amount.toFixed(2)) !== amount)
    ) return invalid();
    if (amount === null || missing.has("amount")) {
      amount = null;
      missing.add("amount");
    }
    let description = typeof m.description === "string"
      ? m.description.trim().replace(/\s+/g, " ")
      : "";
    if (!description || missing.has("description")) {
      description = "Concepto pendiente";
      missing.add("description");
    }
    if (description.length > 160) return invalid();
    const currency = m.currency ?? "ARS";
    if (currency !== "ARS" && currency !== "USD") return invalid();
    let date = m.occurredOn ?? null;
    if (date !== null && !validDraftDate(date)) return invalid();
    if (missing.has("date")) date = null;
    else date ??= today;
    const installments = m.installments ?? 1;
    if (
      typeof installments !== "number" || !Number.isInteger(installments) ||
      installments < 1 || installments > 60 ||
      (m.kind === "income" && installments > 1)
    ) return invalid();
    let month = m.firstInstallmentMonth ?? null;
    if (
      month !== null &&
      (typeof month !== "string" || !validDraftDate(month + "-01"))
    ) return invalid();
    if (installments === 1) month = null;
    else month ??= typeof date === "string" ? date.slice(0, 7) : null;
    const confidence = m.confidence ?? 0;
    if (
      typeof confidence !== "number" || !Number.isFinite(confidence) ||
      confidence < 0 || confidence > 1
    ) return invalid();
    const category = m.category ?? "Otros";
    if (typeof category !== "string" || category.length > 80) return invalid();
    const categoryQuestionOnly = flags.includes("category") &&
      missing.size === 0;
    const itemQuestion = categoryQuestionOnly
      ? null
      : m.clarification ?? (missing.size ? question : null);
    if (itemQuestion != null && typeof itemQuestion !== "string") {
      return invalid();
    }
    if (
      typeof m.clarification === "string" && m.clarification.trim() &&
      missing.size === 0 && !flags.includes("category")
    ) missing.add("review");
    return {
      kind: m.kind,
      description,
      totalAmountArs: amount as number | null,
      currency,
      occurredOn: date as string | null,
      category: category.trim() || "Otros",
      installments,
      firstInstallmentMonth: month as string | null,
      confidence,
      missingFields: [...missing],
      ...(itemQuestion
        ? { clarification: String(itemQuestion).trim().slice(0, 500) }
        : {}),
    };
  });
  const categoryOnly =
    raw.some((m) =>
      Array.isArray(m?.missingFields) && m.missingFields.includes("category")
    ) && raw.every((m) =>
      !m.missingFields?.some((f: string) => f !== "category")
    );
  if (
    question && !categoryOnly && items.every((i) => !i.missingFields.length)
  ) {
    for (const item of items) {
      item.missingFields = ["review"];
      item.clarification = question;
    }
  }
  return items;
}
