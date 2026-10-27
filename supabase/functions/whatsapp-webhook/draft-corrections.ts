const normalize = (text: string) =>
  text.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

export function looksLikeDraftCorrection(text: string): boolean {
  return /^(?:(?:el|la)\s+(?:(?:movimiento|operacion|gasto|ingreso)\s+)?\d+\b|(?:cambia|corregi|corrige|modifica|edita)\b)/
    .test(normalize(text));
}

type Correction = {
  kind: "edit";
  position: number;
  amount: number;
  description: null;
} | { kind: "reply"; text: string };
export function parseDraftCorrection(text: string): Correction | null {
  const match = normalize(text).match(
    /^(?:el\s+(?:movimiento\s+)?(\d+)\s+(?:fue|era|es)(?:\s+de)?|(?:cambia|corregi|modifica)\s+(?:el\s+)?(?:movimiento\s+)?(\d+)\s+(?:a|por))\s+(.+)$/,
  );
  if (!match && !looksLikeDraftCorrection(text)) return null;
  const clarify: Correction = {
    kind: "reply",
    text:
      'Para cambiar el monto, indicá un movimiento y un importe positivo. Por ejemplo: "El 2 fue de 250". No agregué movimientos. No modifiqué la lista.',
  };
  if (!match) return clarify;
  const position = Number(match[1] ?? match[2]);
  const money = match[3].match(
    /^\$?\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(k|mil|lucas?)?\s*$/,
  );
  if (
    !Number.isSafeInteger(position) || position < 1 || position > 2147483647 ||
    !money
  ) return clarify;
  let number = money[1];
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(number)) {
    number = number.replaceAll(".", "");
  }
  const amount = Number(number.replace(",", ".")) * (money[2] ? 1000 : 1);
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1000000000000) {
    return clarify;
  }
  return { kind: "edit", position, amount, description: null };
}
