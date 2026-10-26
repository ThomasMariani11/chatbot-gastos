// Limpieza conservadora compartida por las respuestas de Gemini y Groq.
// Un número sin marcador puede ser modelo, línea, ruta o parte del concepto.
export function cleanDescription(
  desc: string,
  kind: "expense" | "income",
): string {
  const fallback = kind === "expense" ? "Gasto general" : "Ingreso general";
  if (!desc) return fallback;
  let cleaned = desc.trim();
  const action =
    /^(?:gast[eé]|pagu[eé]|compr[eé]|abon[eé]|abone|cargu[eé]|pagar|gastar|ingres[oó]|me\s+ingresaron|me\s+ingres[oó]|cobr[eé]|me\s+pagaron|me\s+transfirieron|dep[oó]sito\s+de)\s+/i;
  const hadAction = action.test(cleaned);
  cleaned = cleaned.replace(action, "");
  const number = String.raw`\d[\d.,]*(?:\s*(?:k|mil|lucas?))?`;
  const unit = String
    .raw`(?:ars|usd|u\$s|us\$|\$|pesos?(?:\s+argentinos?)?|d[oó]lar(?:es)?(?:\s+estadounidenses?)?)(?![\p{L}])`;
  const markedAmount = String
    .raw`(?:${unit}\s*${number}(?:\s*${unit})?|${number}\s*${unit})`;
  if (hadAction) {
    cleaned = cleaned.replace(
      new RegExp(
        String.raw`^${markedAmount}(?:\s+(?:en|de|por))?(?:\s+|$)`,
        "iu",
      ),
      "",
    ).replace(new RegExp(String.raw`^${number}\s+(?:en|de|por)\s+`, "i"), "");
  }
  cleaned = cleaned.replace(/^(?:en|de|por)\s+/i, "").replace(
    new RegExp(String.raw`\s+${markedAmount}$`, "iu"),
    "",
  ).trim();
  if (!cleaned) return fallback;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
