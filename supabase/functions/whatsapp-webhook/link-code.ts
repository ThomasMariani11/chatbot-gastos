// Comando de vinculación de WhatsApp: "VINCULAR <código>".
// El código tiene 12 caracteres del alfabeto de la migración 054, en grupos de
// 4 separados por guion o todo junto (sin distinguir mayúsculas). Devuelve el
// código normalizado (mayúsculas, sin guiones) o null si el texto no tiene
// forma de código; en ese caso el mensaje sigue el camino normal y no suma
// intentos. El hash que calcula el llamador es sobre el valor devuelto.
const GROUP = "[23456789abcdefghjklmnpqrstuvwxyz]{4}";
const LINK_COMMAND = new RegExp(
  `^vincular\\s+(${GROUP}-${GROUP}-${GROUP}|${GROUP}${GROUP}${GROUP})$`,
  "i",
);

// SEC-06: forma aproximada de un intento de vinculación (con errores de formato:
// sin la palabra, con espacios o con caracteres fuera del alfabeto). Solo decide si
// un número no vinculado recibe otra vez la guía; no valida ni suma intentos.
const CODE_SHAPE =
  /(^|[^a-z0-9])[a-z0-9]{4}[\s-]*[a-z0-9]{4}[\s-]*[a-z0-9]{4}($|[^a-z0-9])/i;

export function looksLikeLinkAttempt(text: string): boolean {
  if (/vincul/i.test(text)) return true;
  const shape = text.match(CODE_SHAPE)?.[0] ?? "";
  return /[0-9]/.test(shape) && /[a-z]/i.test(shape);
}

export function parseLinkCommand(text: string): string | null {
  const match = text.trim().match(LINK_COMMAND);
  return match ? match[1].replaceAll("-", "").toUpperCase() : null;
}
