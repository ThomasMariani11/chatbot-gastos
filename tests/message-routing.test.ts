import { describe, expect, it } from "vitest";
import { classifyTextQuery } from "../supabase/functions/whatsapp-webhook/intent";
const fixture =
  "Gasté 1100 en librería, 2200 en té y me ingresó 33mil de una transferencia";
describe("enrutamiento de consultas sin interceptar movimientos", () => {
  it.each([
    fixture,
    "Pagué 1200 por transferencia en farmacia",
    "Cobré 3400 por transferencia",
    "Gasté 5600 en la suscripción del gimnasio",
    "Pagué 7800 del saldo de la tarjeta",
    "Gasté 900 en el balanceador",
    "1200 transferencia recibida",
  ])("prioriza movimiento: %s", (text) => {
    expect(classifyTextQuery(text)).toBeNull();
  });
  it.each([
    "¿Cómo pago Pesito?",
    "Quiero renovar mi membresía",
    "Pasame el alias",
    "¿Cuáles son los precios de los planes?",
  ])("conserva consulta comercial: %s", (text) => {
    expect(classifyTextQuery(text)).toBe("commercial");
  });
  it.each(["¿Cuánto dinero me queda?", "saldo disponible", "mi balance"])(
    "conserva consulta de saldo: %s",
    (text) => {
      expect(classifyTextQuery(text)).toBe("balance");
    },
  );
  it("no usa el caption de un comprobante para descartar su imagen", () => {
    expect(classifyTextQuery("suscripción", true)).toBeNull();
  });
});
