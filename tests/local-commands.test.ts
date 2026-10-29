import { describe, expect, it } from "vitest";
import { parseLocalCommand } from "../supabase/functions/whatsapp-webhook/local-commands";

describe("comandos locales sin IA", () => {
  it.each([
    ["¡Sí!", "confirm"], ["Confirmar.", "confirm"], ["👍🏽", "confirm"],
    ["CANCELAR TODO", "cancel"], ["cancelalo", "cancel"], ["resumen", "summary"],
    ["ver la lista", "summary"], ["mis pendientes", "summary"], ["retomar", "resume"], ["descartar", "discard"],
  ])("%s", (text, kind) => expect(parseLocalCommand(text)).toEqual({ kind }));
  it.each(["Quitá el 2", "sacame el movimiento 2", "eliminá la operación 2", "borrá el gasto 2", "Cancela el 2"])("quita un número estable: %s", text => {
    expect(parseLocalCommand(text)).toEqual({ kind: "remove", position: 2 });
  });
  it.each([
    ["Quitá el 2 y el 3", [2, 3]],
    ["Cancela el 5 y el 6", [5, 6]],
    ["Cancela 4.5.6", [4, 5, 6]],
    ["borrá 1, 2", [1, 2]],
  ])("quita múltiples números estables: %s", (text, positions) => {
    expect(parseLocalCommand(text)).toEqual({ kind: "remove", position: positions[0], positions });
  });
  it.each(["Quitá el 0", "Quitá el 999999999999999999", "Borrá lo último"])("no elimina parcialmente: %s", text => {
    expect(parseLocalCommand(text)).toMatchObject({ kind: "reply" });
  });
  it.each(["hola", "buenas", "ayuda", "comandos", "gracias"])("resuelve conversación básica: %s", text => {
    expect(parseLocalCommand(text)).toMatchObject({ kind: "reply" });
  });
  it.each(["si?", "no canceles", "confirmar o cancelar", "dale gasté 5000", "Gasté 1000 en super", "El 2 fue de 250"])("no convierte frases en comandos: %s", text => {
    expect(parseLocalCommand(text)).toBeNull();
  });
});
