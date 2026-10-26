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


describe("BE-05: conceptos financieros y consultas completas", () => {
  it.each([
    "Suscripción Netflix 5000",
    "Saldo SUBE 1500",
    "Vendí 5000 por planes de diseño",
    "Me pagaron 5000 por planes de diseño",
    "Me depositaron 5000 por planes de diseño",
    "Me acreditaron 5000 por planes de diseño",
    "Gasté 5000 en Netflix y 1000 en saldo SUBE",
    "5000 suscripción Netflix; 1500 saldo SUBE",
    "Suscripción Netflix 5000 USD",
    "Gasté 100,50 en super y 200,25 en saldo SUBE",
    "Pagué 5000 del saldo de la tarjeta",
  ])("no intercepta la operación: %s", (text) => {
    expect(classifyTextQuery(text)).toBeNull();
  });
  it.each([
    "¿Cuánto cuesta el plan de 5000?",
    "Cómo pago el plan de 5000",
    "Quiero renovar mi membresía de 5000",
    "Pasame el alias para pagar 5000",
    "¿Cuáles son los precios de los 2 planes?",
    "Necesito saber el precio de los planes",
    "Hola; pasame el alias; gracias",
  ])("conserva la consulta comercial con cifras: %s", (text) => {
    expect(classifyTextQuery(text)).toBe("commercial");
  });
  it.each([
    "Gasté 1000 en super; pasame el alias",
    "Gasté 1000 en super y cuánto saldo me queda",
    "Gasté 1000 en super, pasame el alias",
    "Pasame el alias; gasté 1000 en super",
    "Pasame el alias y gasté 1000 en super",
    "Cuánto saldo me queda y cobré 5000",
    "Pasame el alias, suscripción Netflix 5000",
    "Pasame el alias y 1000 en super",
    "Pasame el alias y saldo SUBE 1500",
    "Suscripción Netflix 5000; ¿cuánto saldo me queda?",
    "Saldo SUBE 1500; quiero renovar mi membresía",
    "Cobré 80000 por transferencia; saldo",
    "Gasté 1000 en super y saldo",
    "Gasté 1000 en super. Pasame el alias",
    "Gasté 1000 en super\nPasame el alias",
    "Suscripción Netflix 5000 y cuánto cuesta el plan",
    "Pasame el alias y cuánto saldo me queda",
    "Saldo disponible 5000",
    "¿Cuánto gasté en la suscripción de Netflix?",
    "Mostrame el saldo de lo que cobré por planes",
    "Planes 5000",
    "Pasame el alias; nafta sin importe",
    "Saldo; compré algo sin decir cuánto",
    "Suscripción Netflix 5000 euros",
    "Suscripción Netflix 5000 y nafta sin importe",
  ])("pide separar o aclarar sin elegir una parte: %s", (text) => {
    expect(classifyTextQuery(text)).toBe("clarify");
  });
  it.each(["Gasté 1000; pasame el alias", "saldo disponible", "planes 5000"])(
    "con multimedia conserva el extractor: %s",
    (text) => expect(classifyTextQuery(text, true)).toBeNull(),
  );
});
