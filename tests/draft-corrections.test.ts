import { describe, expect, it } from "vitest";
import {
  looksLikeDraftCorrection,
  parseDraftCorrection,
} from "../supabase/functions/whatsapp-webhook/draft-corrections";
describe("corregir un pendiente sin agregar otro", () => {
  it.each([
    ["el 2 fue de 250", 250],
    ["El 2 era 5.000", 5000],
    ["El movimiento 2 es de $ 1.234,50", 1234.5],
    ["Cambiá el 2 a 2 mil", 2000],
    ["Corregí el 2 por 25,50", 25.5],
  ])("monto y posición: %s", (text, amount) => {
    expect(parseDraftCorrection(String(text))).toEqual({
      kind: "edit",
      position: 2,
      amount,
      description: null,
    });
  });
  it.each([
    "El 2 fue de -250",
    "El 2 fue de 0",
    "El 0 fue de 250",
    "El 2 fue de 250 y el 3 de 500",
    "El 2 fue de 25 USD",
  ])("no modifica una instrucción inválida o ambigua: %s", (text) => {
    expect(parseDraftCorrection(text)?.kind).toBe("reply");
  });
  it("distingue correcciones generales y gastos normales", () => {
    expect(looksLikeDraftCorrection("Cambiá el 2 por suscripción")).toBe(true);
    expect(looksLikeDraftCorrection("Gasté 250 en dos cafés")).toBe(false);
    expect(parseDraftCorrection("Gasté 250 en dos cafés")).toBeNull();
  });
});
