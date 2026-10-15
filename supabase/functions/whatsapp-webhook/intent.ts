// Las consultas rápidas no deben interceptar operaciones ni comprobantes.
export function classifyTextQuery(
  raw: string,
  hasMedia = false,
): "commercial" | "balance" | null {
  if (hasMedia) return null;
  const text = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
  const completedAction =
    /\b(gaste|pague|compre|abone|cargue|cobre|recibi|ingreso|ingresaron|transfirieron|transferi|deposite|debitaron|acreditaron)\b/
      .test(text);
  const amountMovement = /\d/.test(text) &&
    (/\b(gasto|ingresos?|transferencia|deposito|sueldo|venta)\b/.test(text) ||
      /^\$?\s*\d/.test(text));
  if (completedAction || amountMovement) return null;
  if (
    /\b(renovar|renovacion|suscripcion|planes?|precios?|membresia|alias|cbu|datos de pago|medios de pago)\b|\bcuanto (sale|cuesta)\b|\bcomo (pago|abono|renuevo)\b|\bdonde (pago|transfiero)\b|\bquiero pagar\b/
      .test(text)
  ) return "commercial";
  if (
    /\b(saldo|disponible|balance)\b|\bcuant[ao]\s+(plata|dinero|me\s+queda)\b/
      .test(text)
  ) return "balance";
  return null;
}
