import { parseDraftCorrection } from "./draft-corrections.ts";
import { parseDeterministicMovements } from "./local-movements.ts";
import {
  normalizeDraftMovements,
  validDraftDate,
} from "./draft-normalization.ts";
import type { DraftListItem } from "./draft-summary.ts";
import type { ExtractedMovement } from "./movement-types.ts";
export type CompletionContext = {
  group_id?: string;
  version?: number;
  items?: DraftListItem[];
};
export type CompletionAction = {
  kind: "complete";
  position: number;
  group_id: string;
  version: number;
  patch: {
    amount?: number;
    occurred_on?: string;
    description?: string;
    movement?: ExtractedMovement;
  };
};
const clarify = () => ({
  kind: "reply" as const,
  text:
    'Indicá un movimiento y el dato que falta: "El 2 fue de 5000", "El 2 fecha 2026-10-26" o "El 2 concepto farmacia". Para aclararlo completo: "El 2: gasté 5000 en farmacia". No modifiqué la lista.',
});
export function parseDraftCompletion(
  raw: string,
  context: CompletionContext,
  today: string,
): CompletionAction | { kind: "reply"; text: string } | null {
  const items = (context.items ?? []).filter((i) => i.status === "pending");
  const incomplete = items.filter((i) =>
    (i.missing_fields?.length ?? 0) > 0 || i.amount === null ||
    i.occurred_on === null
  );
  if (!incomplete.length) return null;
  const norm = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
    .toLowerCase();
  const full = raw.trim().match(/^(?:el|la)\s+(\d+)\s*:\s*(.+)$/i);
  const explicit = norm.match(
    /^(?:el|la)\s+(\d+)\s+(fecha|concepto|descripcion)\s+(.+)$/,
  );
  const correction = parseDraftCorrection(raw);
  let position: number | undefined,
    field: string | undefined,
    patch: CompletionAction["patch"] | undefined;
  if (
    full &&
    /^(?:importe|monto|concepto|descripci[oó]n|categor[ií]a|moneda|fecha|cuotas|tipo)\s/i
      .test(full[2])
  ) return null;
  if (
    explicit &&
    items.some((i) =>
      i.position === Number(explicit[1]) && !incomplete.includes(i)
    )
  ) return null;
  if (full) {
    const parsed = parseDeterministicMovements(full[2], today);
    if (parsed?.length !== 1) return clarify();
    position = Number(full[1]);
    field = "movement";
    patch = { movement: normalizeDraftMovements(parsed, today)[0] };
  } else if (explicit) {
    position = Number(explicit[1]);
    if (explicit[2] === "fecha") {
      if (!validDraftDate(explicit[3])) return clarify();
      field = "date";
      patch = { occurred_on: explicit[3] };
    } else {
      const desc = raw.trim().match(
        /^(?:el|la)\s+\d+\s+(?:concepto|descripci[oó]n)\s+(.+)$/i,
      )?.[1].trim();
      if (!desc || desc.length > 160 || /[\r\n;]/.test(desc)) return clarify();
      field = "description";
      patch = { description: desc };
    }
  } else if (correction?.kind === "edit") {
    const target = incomplete.find((i) => i.position === correction.position);
    if (
      !target?.missing_fields?.includes("amount") && target?.amount !== null
    ) return null;
    position = correction.position;
    field = "amount";
    patch = { amount: correction.amount };
  } else {
    const money = parseDraftCorrection("El 1 fue de " + raw);
    if (money?.kind === "edit") {
      field = "amount";
      patch = { amount: money.amount };
    } else if (validDraftDate(norm)) {
      field = "date";
      patch = { occurred_on: norm };
    } else return null;
    const candidates = incomplete.filter((i) =>
      i.missing_fields?.includes(field!) ||
      (field === "amount" && i.amount === null) ||
      (field === "date" && i.occurred_on === null)
    );
    if (candidates.length !== 1) return clarify();
    position = candidates[0].position;
  }
  const target = incomplete.find((i) => i.position === position);
  if (
    !target || !Number.isSafeInteger(position) || (position ?? 0) < 1 ||
    !context.group_id || !Number.isInteger(context.version)
  ) return clarify();
  if (
    field !== "movement" && !target.missing_fields?.includes(field!) &&
    !(field === "amount" && target.amount === null) &&
    !(field === "date" && target.occurred_on === null)
  ) return null;
  return {
    kind: "complete",
    position: position!,
    group_id: context.group_id,
    version: context.version!,
    patch: patch!,
  };
}
