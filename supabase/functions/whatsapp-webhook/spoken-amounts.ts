// Conversión pura: no consulta modelos ni transforma una parte de una expresión
// numérica inválida. La gramática local rechaza las palabras numéricas restantes.
const SMALL: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
};
const TENS: Record<string, number> = {
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
};
const HUNDREDS: Record<string, number> = {
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
};
const normalize = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const has = (table: Record<string, number>, key: string) =>
  Object.hasOwn(table, key);
const numberWord = (word: string) =>
  has(SMALL, word) || has(TENS, word) ||
  has(HUNDREDS, word) ||
  /^(mil|miles|cientos|centenas|millares|decenas|millon|millones|billon|billones|trillon|trillones|coma|punto)$/
    .test(word);
const currency = (word: string) => /^(pesos?|dolar(?:es)?|ars|usd)$/.test(word);
const centUnit = (word: string) => /^(centavos?|centimos?)$/.test(word);
const normalizeLiteral = (word: string) =>
  /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(word)
    ? word.replaceAll(",", "")
    : /^\d{1,3}(?:\.\d{3})+$/.test(word)
    ? word.replaceAll(".", "")
    : word;
const integerLiteral = (word: string): number | null => {
  const value = normalizeLiteral(word);
  if (!/^\d+$/.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result < 1e12 ? result : null;
};

function underHundred(words: string[]): number | null {
  if (words.length === 1) {
    if (has(SMALL, words[0])) return SMALL[words[0]];
    if (has(TENS, words[0])) return TENS[words[0]];
    const value = integerLiteral(words[0]);
    return value !== null && value < 100 ? value : null;
  }
  if (words.length === 3 && words[1] === "y") {
    const tens = has(TENS, words[0])
      ? TENS[words[0]]
      : words[0] === "veinte"
      ? 20
      : null;
    const unit = underHundred([words[2]]);
    if (tens !== null && unit !== null && unit > 0 && unit < 10) {
      return tens + unit;
    }
  }
  return null;
}

function underThousand(words: string[]): number | null {
  if (!words.length) return 0;
  if (words.length === 1) {
    const value = integerLiteral(words[0]);
    if (value !== null && value < 1000) return value;
  }
  const hundred = has(HUNDREDS, words[0]) ? HUNDREDS[words[0]] : null;
  if (hundred !== null) {
    const tail = words.slice(words[1] === "y" ? 2 : 1);
    if (!tail.length) return words.length === 1 ? hundred : null;
    const remainder = underHundred(tail);
    return remainder !== null && remainder > 0 ? hundred + remainder : null;
  }
  return underHundred(words);
}

function underMillion(words: string[]): number | null {
  if (!words.length) return 0;
  const scale = words.indexOf("mil");
  if (scale !== -1) {
    if (words.lastIndexOf("mil") !== scale) return null;
    const prefix = scale === 0 ? 1 : underThousand(words.slice(0, scale));
    const suffix = underThousand(words.slice(scale + 1));
    return prefix !== null && prefix > 0 && suffix !== null
      ? prefix * 1000 + suffix
      : null;
  }
  const base = integerLiteral(words[0]);
  if (base !== null && base >= 1000 && base < 1e6) {
    if (words.length === 1) return base;
    // Whisper puede escribir "2000 quinientos treinta y cinco". No sumar
    // cantidades sin escala, artículos o una segunda cifra independiente.
    if (
      base % 1000 !== 0 || !numberWord(words[1]) ||
      /^(un|una|uno)$/.test(words[1])
    ) return null;
    const tail = underThousand(words.slice(1));
    return tail !== null && tail > 0 ? base + tail : null;
  }
  return underThousand(words);
}

function integerWords(words: string[]): number | null {
  if (!words.length) return null;
  const million = words.findIndex((word) => /^(millon|millones)$/.test(word));
  let value: number | null;
  if (million !== -1) {
    if (
      words.slice(million + 1).some((word) => /^(millon|millones)$/.test(word))
    ) return null;
    const prefix = million === 0 && words[million] === "millon"
      ? 1
      : underMillion(words.slice(0, million));
    const tail = underMillion(words.slice(million + 1));
    value = prefix !== null && prefix > 0 && tail !== null
      ? prefix * 1e6 + tail
      : null;
  } else {
    const base = integerLiteral(words[0]);
    if (words.length === 1 && base !== null) return base;
    if (
      base !== null && base >= 1e6 && base % 1e6 === 0 &&
      numberWord(words[1]) && !/^(un|una|uno)$/.test(words[1])
    ) {
      const tail = underMillion(words.slice(1));
      value = tail !== null && tail > 0 ? base + tail : null;
    } else value = underMillion(words);
  }
  return value !== null && Number.isSafeInteger(value) && value < 1e12
    ? value
    : null;
}

type Token = { raw: string; word: string; start: number; end: number };
const isNumber = (token: Token | undefined) =>
  Boolean(token && (numberWord(token.word) || /^\d/.test(token.word)));
function spanEnd(tokens: Token[], start: number, text: string): number {
  let end = start + 1;
  while (end < tokens.length) {
    if (
      !/^[^\S\r\n]*$/.test(text.slice(tokens[end - 1].end, tokens[end].start))
    ) {
      break;
    }
    if (isNumber(tokens[end])) end++;
    else if (/^(y|,)$/.test(tokens[end].word) && isNumber(tokens[end + 1])) {
      end++;
    } else break;
  }
  return end;
}

export function hasUnparsedNumberWords(text: string): boolean {
  return (normalize(text).match(/[a-z]+/g) ?? []).some((word) =>
    (numberWord(word) && !/^(un|una)$/.test(word)) || centUnit(word) ||
    /^(medio|media|mitad)$/.test(word)
  );
}

export function normalizeWhisperTranscript(raw: string): string {
  const text = raw.trim();
  const tokens: Token[] = [...text.matchAll(/\d+(?:[.,]\d+)*|[\p{L}]+|[^\s]/gu)]
    .map((match) => ({
      raw: match[0],
      word: normalize(match[0]),
      start: match.index!,
      end: match.index! + match[0].length,
    }));
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  for (let start = 0; start < tokens.length;) {
    if (!isNumber(tokens[start])) {
      start++;
      continue;
    }
    const end = spanEnd(tokens, start, text);
    const words = tokens.slice(start, end).map((token) => token.word);
    const amount = integerWords(words);
    const unit = tokens[end] && currency(tokens[end].word)
      ? tokens[end]
      : undefined;
    const afterUnit = end + (unit ? 1 : 0);
    let replacementEnd = end;
    let value: string | undefined;
    // Centavos se combinan con aritmética entera; no se acepta un fragmento
    // de una fracción ni se convierte "150 centavos" en "150 pesos".
    if (amount !== null && centUnit(tokens[end]?.word ?? "") && amount < 100) {
      value = `0,${String(amount).padStart(2, "0")}`;
      replacementEnd = end + 1;
    } else if (
      amount !== null && /^(con|y)$/.test(tokens[afterUnit]?.word ?? "") &&
      isNumber(tokens[afterUnit + 1])
    ) {
      const centsStart = afterUnit + 1;
      const centsEnd = spanEnd(tokens, centsStart, text);
      const cents = integerWords(
        tokens.slice(centsStart, centsEnd).map((token) => token.word),
      );
      if (
        centUnit(tokens[centsEnd]?.word ?? "") && cents !== null && cents < 100
      ) {
        value = `${amount},${String(cents).padStart(2, "0")}${
          unit ? ` ${unit.raw}` : ""
        }`;
        replacementEnd = centsEnd + 1;
      }
    } else if (
      amount !== null &&
      (amount >= 100 || unit ||
        words.some((word) => /^(mil|millon|millones)$/.test(word)))
    ) {
      value = String(amount);
    } else if (
      words.length === 1 && /^\d/.test(words[0]) &&
      normalizeLiteral(words[0]) !== words[0]
    ) {
      value = normalizeLiteral(words[0]);
    }
    if (
      value !== undefined &&
      !/[\r\n]/.test(
        text.slice(tokens[start].start, tokens[replacementEnd - 1].end),
      )
    ) {
      replacements.push({
        start: tokens[start].start,
        end: tokens[replacementEnd - 1].end,
        value,
      });
    }
    // Saltar toda la expresión, también si es inválida. No reinterpretar su cola.
    start = replacementEnd;
  }
  let result = text;
  for (const replacement of replacements.reverse()) {
    result = result.slice(0, replacement.start) + replacement.value +
      result.slice(replacement.end);
  }
  return result;
}
