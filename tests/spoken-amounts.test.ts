import { describe, expect, it } from "vitest";
import { normalizeWhisperTranscript, hasUnparsedNumberWords } from "../supabase/functions/whatsapp-webhook/spoken-amounts";
import { parseDeterministicMovements } from "../supabase/functions/whatsapp-webhook/local-movements";
const parse = (text: string) => parseDeterministicMovements(normalizeWhisperTranscript(text), "2026-10-20");

describe("importes hablados completos", () => {
  it.each([
    ["Gasté un millón doscientos mil en alquiler", 1200000],
    ["Gasté 1 millón 200 mil en alquiler", 1200000],
    ["Gasté dos millones trescientos catorce mil doscientos cincuenta en alquiler", 2314250],
    ["Gasté 1000000 doscientos mil en alquiler", 1200000],
    ["Gasté un millón 200000 quinientos en alquiler", 1200500],
    ["Gasté mil millones en alquiler", 1000000000],
    ["Gasté 2000 quinientos treinta y cinco en super", 2535],
    ["Gasté 2 mil quinientos treinta y cinco en super", 2535],
    ["Gasté 2 mil 535 en super", 2535],
    ["Gasté trescientos y veinte en super", 320],
    ["Gasté trescientos veinte en super", 320],
    ["Gasté ciento y treinta y dos en super", 132],
    ["Gasté doscientos pesos con cincuenta centavos en panadería", 200.5],
    ["Gasté 1.234 pesos con cincuenta centavos en super", 1234.5],
    ["Gasté 200 pesos y 50 centavos en panadería", 200.5],
    ["Gasté doscientos con cinco centavos en panadería", 200.05],
    ["Gasté cero pesos con cincuenta centavos en panadería", 0.5],
    ["Gasté cincuenta centavos en panadería", 0.5],
    ["Gasté un centavo en panadería", 0.01],
    ["Gasté 1,200,000 en alquiler", 1200000],
    ["Gasté 1,234.50 en super", 1234.5],
    ["Gasté 1.234,50 en super", 1234.5],
    ["Gasté 200,50 en super", 200.5],
    ["Gasté doscientos pesos con cero centavos en super", 200],
  ])("%s", (text, amount) => {
    expect(parse(String(text))).toMatchObject([{ totalAmountArs: amount, currency: "ARS", kind: "expense" }]);
    const normalized = normalizeWhisperTranscript(String(text));
    expect(normalizeWhisperTranscript(normalized)).toBe(normalized);
  });
  it("separa operaciones y conserva monedas, conceptos y total de cuotas", () => {
    expect(parse("Gasté doscientos pesos con cincuenta centavos en pan y leche y cobré cien dólares con veinticinco centavos por diseño; pagué silla total doce mil en 3 cuotas")?.map(i => [i.kind, i.totalAmountArs, i.currency, i.description, i.installments])).toEqual([
      ["expense", 200.5, "ARS", "Pan y leche", 1],
      ["income", 100.25, "USD", "Diseño", 1],
      ["expense", 12000, "ARS", "Silla", 3],
    ]);
  });
  it("conserva contexto no numérico, fechas y artículos", () => {
    expect(normalizeWhisperTranscript("Gasté 250 en una farmacia el 19/10/2026")).toBe("Gasté 250 en una farmacia el 19/10/2026");
    expect(normalizeWhisperTranscript("Compré dos cafés y un té")).toBe("Compré dos cafés y un té");
    expect(normalizeWhisperTranscript("El 2 fue de un millón doscientos mil")).toBe("El 2 fue de 1200000");
    expect(parse("Me ingresó 70 mil de una transferencia")).toMatchObject([{ kind: "income", totalAmountArs: 70000 }]);
  });
});

describe("ninguna interpretación local parcial", () => {
  it.each([
    "Gasté un billón doscientos mil en alquiler",
    "Gasté dos mil treinta y noventa en super",
    "Gasté 2000 treinta y noventa en super",
    "Gasté doscientos pesos con ciento cincuenta centavos en super",
    "Gasté 200 pesos con cincuenta y treinta centavos en super",
    "Gasté mil millones millones en alquiler",
    "Gasté dos mil, quinientos en super",
    "Gasté 200 coma cincuenta en super",
    "Gasté 200 y medio en super",
    "Gasté un millón doscientos mil billones en alquiler",
    "Gasté -doscientos pesos en super",
    "No gasté doscientos pesos en super",
    "Gasté cero pesos en super",
    "Gasté 200 cientos en super",
    "Gasté 200 miles en super",
  ])("%s", text => expect(parse(text)).toBeNull());
  it.each([
    "Gasté un millón 200000 en alquiler",
    "Gasté 200 pesos con cincuenta centavos en super",
    "Gasté 2000 treinta y cinco en super",
    "Gasté 300 y veinte en super",
    "Gasté 200 en super y un billón 100 en alquiler",
  ])("texto sin transcribir tampoco guarda un fragmento: %s", text => {
    expect(parseDeterministicMovements(text, "2026-10-20")).toBeNull();
  });
  it("detecta residuos sin confundir artículos", () => {
    expect(hasUnparsedNumberWords("Un millón en alquiler")).toBe(true);
    expect(hasUnparsedNumberWords("Con cincuenta centavos")).toBe(true);
    expect(hasUnparsedNumberWords("Treinta y cinco en super")).toBe(true);
    expect(hasUnparsedNumberWords("Una compra en un supermercado")).toBe(false);
  });
});

it("respeta separadores de operaciones y no junta un importe a través de un salto de línea", () => {
  expect(normalizeWhisperTranscript("Gasté dos mil\nquinientos en nafta")).toBe("Gasté 2000\n500 en nafta");
  expect(parse("Gasté doscientos en super\nPagué cincuenta pesos en nafta")?.map(i => i.totalAmountArs)).toEqual([200, 50]);
});
