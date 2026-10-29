type LocalCommand =
  | { kind: "confirm" | "cancel" | "summary" | "resume" | "discard" }
  | { kind: "remove"; position: number; positions?: number[] }
  | { kind: "reply"; text: string };

export function parseLocalCommand(raw: string): LocalCommand | null {
  const text = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/^[¡!]+|[.!]+$/g, "").trim().replace(
      /\s+/g,
      " ",
    );
  if (
    /^(confirmar|confirmado|confirmo|si|ok|dale|listo|de una|va|sisi|perfecto|👍[🏻🏼🏽🏾🏿]?|✅|✔️|👌[🏻🏼🏽🏾🏿]?)$/u
      .test(text)
  ) return { kind: "confirm" };
  if (
    /^(cancelar(?: todo)?|cancelalo|cancela|cancel|no|borralo|borrar todo|anular|rechazar|❌|🚫)$/
      .test(text)
  ) return { kind: "cancel" };
  if (
    /^(resumen|pendientes|ver (?:la )?lista|lista|ver|mis pendientes)$/.test(
      text,
    )
  ) return { kind: "summary" };
  if (text === "retomar") return { kind: "resume" };
  if (text === "descartar") return { kind: "discard" };
  if (
    /^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|ayuda|menu|comandos)$/
      .test(text)
  ) {
    return {
      kind: "reply",
      text:
        'Podés mandarme gastos e ingresos juntos, por ejemplo: "Gasté 1500 en super y cobré 10000 por diseño". Quedan pendientes hasta que respondas CONFIRMAR. Usá RESUMEN para verlos, "El 2 fue de 250" para corregir, "Quitá el 2" para quitar o CANCELAR para descartar la lista.',
    };
  }
  if (/^(gracias|muchas gracias|genial)$/.test(text)) {
    return {
      kind: "reply",
      text: "¡De nada! Cuando quieras, podés seguir cargando tus movimientos.",
    };
  }
  if (
    /^(quita|quitame|borra|borrame|saca|sacame|elimina|eliminame|cancela|cancelame|anula|anulame)\b/.test(text)
  ) {
    const singleMatch = text.match(
      /^(?:quita|quitame|borra|borrame|saca|sacame|elimina|eliminame|cancela|cancelame|anula|anulame)\s+(?:el\s+|la\s+)?(?:(?:movimiento|gasto|ingreso|operacion)\s+)?(\d+)$/,
    );
    if (singleMatch) {
      const position = Number(singleMatch[1]);
      if (Number.isSafeInteger(position) && position > 0 && position <= 2147483647) {
        return { kind: "remove", position };
      }
    }
    const numbers = [...text.matchAll(/\b\d+\b/g)]
      .map((m) => Number(m[0]))
      .filter((n) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647);
    if (numbers.length === 1) {
      return { kind: "remove", position: numbers[0] };
    }
    if (numbers.length > 1) {
      const unique = [...new Set(numbers)];
      return { kind: "remove", position: unique[0], positions: unique };
    }
    return {
      kind: "reply",
      text:
        'Indicá el número del movimiento para quitar, por ejemplo: "Quitá el 2". No modifiqué la lista.',
    };
  }
  return null;
}
