import {
  failureMetadata,
  httpFailure,
  OperationalFailure,
  providerFailure,
} from "./failures.ts";
import {
  boundedJson,
  LIMITS,
  timeoutSignal,
  withinSignal,
} from "./limits.ts";
import {
  looksLikeDraftCorrection,
  parseDraftCorrection,
} from "./draft-corrections.ts";
import { parseLocalCommand } from "./local-commands.ts";
import { parseDeterministicMovements } from "./local-movements.ts";
import { writeOperationalLog } from "./logging.ts";
import type { GeminiParsedOutput } from "./helpers.ts";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const WHISPER_MODEL = "whisper-large-v3-turbo";
const QWEN_MODEL = "qwen/qwen3.8-27b";
const MIN_QWEN_TOKENS_RESERVE = 1600;
const MAX_BUDGET_WAIT_MS = 3500;
const encoder = new TextEncoder();

type SchemaNode = {
  type?: string | string[];
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: SchemaNode;
};

const budgetState = {
  whisperBlockedUntilMs: 0,
  qwenBlockedUntilMs: 0,
};

export function resetGroqBudgetForTests() {
  budgetState.whisperBlockedUntilMs = 0;
  budgetState.qwenBlockedUntilMs = 0;
}

export function buildStrictSchema(node: SchemaNode): SchemaNode {
  const copy = structuredClone(node);
  if (copy.properties) {
    const required = new Set(copy.required || []);
    for (const [key, value] of Object.entries(copy.properties)) {
      copy.properties[key] = buildStrictSchema(value);
      if (!required.has(key)) {
        const current = copy.properties[key].type;
        const types = Array.isArray(current)
          ? current
          : current
          ? [current]
          : [];
        copy.properties[key].type = [...new Set([...types, "null"])];
      }
    }
    copy.required = Object.keys(copy.properties);
    copy.additionalProperties = false;
  }
  if (copy.items) {
    copy.items = buildStrictSchema(copy.items);
  }
  return copy;
}

export function validateAgainstSchema(
  value: unknown,
  schema: SchemaNode,
  path = "",
): string[] {
  const list: string[] = [];
  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type
    ? [schema.type]
    : [];
  const actual = value === null
    ? "null"
    : Array.isArray(value)
    ? "array"
    : typeof value;
  if (
    !types.some((t) =>
      t === actual ||
      (t === "integer" && actual === "number" && Number.isInteger(value))
    )
  ) {
    return [`${path}:type`];
  }
  if (schema.enum && !schema.enum.includes(value)) {
    list.push(`${path}:enum`);
  }
  if (
    actual === "number" &&
    (!Number.isFinite(value as number) ||
      (schema.minimum !== undefined && (value as number) < schema.minimum) ||
      (schema.maximum !== undefined && (value as number) > schema.maximum))
  ) {
    list.push(`${path}:range`);
  }
  if (actual === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required || []) {
      if (!Object.hasOwn(record, key)) {
        list.push(`${path}/${key}:missing`);
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (schema.properties?.[key]) {
        list.push(
          ...validateAgainstSchema(
            child,
            schema.properties[key],
            `${path}/${key}`,
          ),
        );
      } else if (schema.additionalProperties === false) {
        list.push(`${path}/${key}:extra`);
      }
    }
  }
  if (actual === "array" && schema.items) {
    (value as unknown[]).forEach((item, index) => {
      list.push(
        ...validateAgainstSchema(item, schema.items!, `${path}/${index}`),
      );
    });
  }
  return list;
}

export function normalizeGroqOutput(
  parsed: unknown,
  today: string,
): GeminiParsedOutput {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new OperationalFailure("invalid_response", "groq");
  }
  const clone = structuredClone(parsed) as Record<string, unknown>;
  if (clone.edit === null && clone.intent !== "edit_item") {
    delete clone.edit;
  }
  if (Array.isArray(clone.movements)) {
    for (const item of clone.movements) {
      if (typeof item === "object" && item !== null) {
        const mov = item as Record<string, unknown>;
        if (mov.occurredOn === null) mov.occurredOn = today;
        if (mov.category === null) mov.category = "Otros";
        if (mov.installments === 1) mov.firstInstallmentMonth = null;
      }
    }
  }
  return clone as unknown as GeminiParsedOutput;
}

function parseDurationHeaderMs(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(60_000, Math.ceil(seconds * 1000));
    }
  }
  let totalMs = 0;
  let matched = false;
  for (
    const match of trimmed.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h)/gi)
  ) {
    matched = true;
    const val = Number(match[1]);
    const unit = match[2].toLowerCase();
    const factor = unit === "ms"
      ? 1
      : unit === "s"
      ? 1000
      : unit === "m"
      ? 60_000
      : 3_600_000;
    totalMs += val * factor;
  }
  return matched && Number.isFinite(totalMs)
    ? Math.min(60_000, Math.ceil(totalMs))
    : undefined;
}

function parseHeaderInt(raw: string | null): number | undefined {
  if (!raw || !/^\d+$/.test(raw.trim())) return undefined;
  const num = Number(raw.trim());
  return Number.isSafeInteger(num) && num >= 0 ? num : undefined;
}

function updateGroqBudget(
  target: "whisper" | "qwen",
  headers: Headers,
  status: number,
) {
  const retryAfterMs = parseDurationHeaderMs(headers.get("retry-after"));
  const tokensRemaining = parseHeaderInt(
    headers.get("x-ratelimit-remaining-tokens"),
  );
  const requestsRemaining = parseHeaderInt(
    headers.get("x-ratelimit-remaining-requests"),
  );
  const resetTokensMs = parseDurationHeaderMs(
    headers.get("x-ratelimit-reset-tokens"),
  );
  const resetRequestsMs = parseDurationHeaderMs(
    headers.get("x-ratelimit-reset-requests"),
  );
  let waitMs = 0;
  if (status === 429) {
    waitMs = retryAfterMs ?? resetTokensMs ?? resetRequestsMs ?? 5000;
  } else if (requestsRemaining !== undefined && requestsRemaining <= 0) {
    waitMs = resetRequestsMs ?? 2000;
  } else if (
    target === "qwen" &&
    tokensRemaining !== undefined &&
    tokensRemaining < MIN_QWEN_TOKENS_RESERVE
  ) {
    waitMs = resetTokensMs ?? 4000;
  }
  if (waitMs > 0) {
    const until = Date.now() + Math.min(60_000, waitMs);
    if (target === "whisper") {
      budgetState.whisperBlockedUntilMs = Math.max(
        budgetState.whisperBlockedUntilMs,
        until,
      );
    } else {
      budgetState.qwenBlockedUntilMs = Math.max(
        budgetState.qwenBlockedUntilMs,
        until,
      );
    }
  }
  return { retryAfterMs, tokensRemaining, requestsRemaining };
}

async function waitForGroqBudget(
  target: "whisper" | "qwen",
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const blockedUntil = target === "whisper"
    ? budgetState.whisperBlockedUntilMs
    : budgetState.qwenBlockedUntilMs;
  const remainingMs = blockedUntil - Date.now();
  if (remainingMs <= 0) return;
  if (remainingMs > MAX_BUDGET_WAIT_MS) {
    throw new OperationalFailure("rate_limit", "groq", 429);
  }
  await withinSignal(
    () => new Promise<void>((resolve) => setTimeout(resolve, remainingMs)),
    signal,
  );
}

function base64ToBytes(base64: string, maxBytes: number): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new OperationalFailure("invalid_response", "meta_media");
  }
  if (binary.length === 0 || binary.length > maxBytes) {
    throw new OperationalFailure("media_too_large", "meta_media");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function audioExtension(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.trim() || "ogg";
  if (subtype === "mpeg") return "mp3";
  if (subtype === "x-m4a") return "m4a";
  if (subtype === "opus") return "ogg";
  return subtype;
}

const SPANISH_HUNDREDS: Record<string, number> = {
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

const SPANISH_TENS: Record<string, number> = {
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
};

const SPANISH_SMALL: Record<string, number> = {
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

function parseUnderThousandWords(words: string[]): {
  value: number;
  consumed: number;
} | null {
  let i = 0;
  let total = 0;
  if (i < words.length && SPANISH_HUNDREDS[words[i]] !== undefined) {
    total += SPANISH_HUNDREDS[words[i]];
    i++;
  }
  if (i < words.length && SPANISH_TENS[words[i]] !== undefined) {
    total += SPANISH_TENS[words[i]];
    i++;
    if (
      i + 1 < words.length &&
      words[i] === "y" &&
      SPANISH_SMALL[words[i + 1]] !== undefined &&
      SPANISH_SMALL[words[i + 1]] < 10
    ) {
      total += SPANISH_SMALL[words[i + 1]];
      i += 2;
    }
  } else if (i < words.length && SPANISH_SMALL[words[i]] !== undefined) {
    total += SPANISH_SMALL[words[i]];
    i++;
  }
  return i > 0 ? { value: total, consumed: i } : null;
}

export function normalizeWhisperTranscript(raw: string): string {
  // 1. Reemplazar separador de miles con coma estilo inglés (ej. 2,500 -> 2500; 1,200,000 -> 1200000)
  let text = raw
    .trim()
    .replace(/\b\d{1,3}(?:,\d{3})+\b/g, (m) => m.replaceAll(",", ""));
  // 2. Combinar patrones híbridos en dígitos como "2 mil 500" -> "2500"
  text = text.replace(
    /\b(\d{1,3})\s+mil\s+(\d{1,3})\b/gi,
    (_, k, rem) => String(Number(k) * 1000 + Number(rem)),
  );
  // 3. Convertir secuencias de números hablados con "mil" o centenas (sin romper "70 mil")
  const tokens = text.split(/(\s+)/);
  const wordIndices: number[] = [];
  const normWords: string[] = [];
  for (let idx = 0; idx < tokens.length; idx++) {
    if (!/^\s+$/.test(tokens[idx])) {
      wordIndices.push(idx);
      normWords.push(
        tokens[idx]
          .replace(/^[.,;:¡!¿?]+|[.,;:¡!¿?]+$/g, "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase(),
      );
    }
  }
  let w = 0;
  while (w < normWords.length) {
    let consumed = 0;
    let numericValue = 0;
    if (/^\d{1,3}000$/.test(normWords[w])) {
      const tail = parseUnderThousandWords(normWords.slice(w + 1));
      if (tail) {
        numericValue = Number(normWords[w]) + tail.value;
        consumed = 1 + tail.consumed;
      }
    } else if (
      /^\d{1,3}$/.test(normWords[w]) &&
      w + 1 < normWords.length &&
      normWords[w + 1] === "mil"
    ) {
      const tail = parseUnderThousandWords(normWords.slice(w + 2));
      if (tail) {
        numericValue = Number(normWords[w]) * 1000 + tail.value;
        consumed = 2 + tail.consumed;
      } else {
        // Conservar "<dígitos> mil" (ej. "70 mil") sin convertir "mil" en "1000" suelto
        w += 2;
        continue;
      }
    } else if (normWords[w] === "mil") {
      numericValue = 1000;
      consumed = 1;
      const tail = parseUnderThousandWords(normWords.slice(w + 1));
      if (tail) {
        numericValue += tail.value;
        consumed += tail.consumed;
      } else if (
        w + 1 < normWords.length && /^\d{1,3}$/.test(normWords[w + 1])
      ) {
        numericValue += Number(normWords[w + 1]);
        consumed += 1;
      }
    } else {
      const head = parseUnderThousandWords(normWords.slice(w));
      if (
        head &&
        w + head.consumed < normWords.length &&
        normWords[w + head.consumed] === "mil"
      ) {
        numericValue = head.value * 1000;
        consumed = head.consumed + 1;
        const tail = parseUnderThousandWords(normWords.slice(w + consumed));
        if (tail) {
          numericValue += tail.value;
          consumed += tail.consumed;
        } else if (
          w + consumed < normWords.length &&
          /^\d{1,3}$/.test(normWords[w + consumed])
        ) {
          numericValue += Number(normWords[w + consumed]);
          consumed += 1;
        }
      } else if (head && head.value >= 100) {
        numericValue = head.value;
        consumed = head.consumed;
      }
    }
    if (consumed > 0 && numericValue >= 100) {
      const firstTokenIdx = wordIndices[w];
      const lastTokenIdx = wordIndices[w + consumed - 1];
      const trailingPunct =
        tokens[lastTokenIdx].match(/[.,;:¡!¿?]+$/)?.[0] ?? "";
      tokens[firstTokenIdx] = String(numericValue) + trailingPunct;
      for (
        let clearIdx = firstTokenIdx + 1;
        clearIdx <= lastTokenIdx;
        clearIdx++
      ) {
        tokens[clearIdx] = "";
      }
      w += consumed;
    } else {
      w++;
    }
  }
  return tokens.join("").replace(/\s{2,}/g, " ").trim();
}

export const GROQ_COMPATIBILITY_RULES = (today: string) =>
  `\nREGLAS DE COMPATIBILIDAD DE PESITO:\n- totalAmountArs es un NOMBRE HISTORICO. Siempre contiene el importe numérico en la moneda indicada por currency. Si cobró 100 dólares: totalAmountArs=100 y currency=USD. No conviertas monedas ni dejes ese importe en null.\n- Respetá el monto exacto mencionado (ej. 2500 o "dos mil quinientos" = 2500; nunca redondees 2500 a 2000).\n- Es el TOTAL de la compra. Si el total es 12000 en 3 cuotas: totalAmountArs=12000 e installments=3. No lo dividas por tres.\n- Si no dice fecha, occurredOn=${today} y no incluyas date en missingFields. Solo preguntá fecha si el usuario indicó una fecha ambigua.\n- Si no se identifica categoría, usá Otros y no incluyas category en missingFields.\n- Sin cuotas: installments=1 y firstInstallmentMonth=null. Con cuotas y sin mes explícito: firstInstallmentMonth=${
    today.slice(0, 7)
  }.\n- Datos esenciales faltantes se conservan: monto desconocido => totalAmountArs=null y missingFields incluye amount. Nunca inventes importes.\n- Un ticket es un movimiento por el total; no conviertas sus productos en movimientos separados.\nDevolvé únicamente el objeto JSON solicitado.`;

export async function extractWithGroq(input: {
  apiKey: string;
  today: string;
  text?: string;
  mediaBase64?: string;
  mimeType?: string;
  activeDraftContext?: string;
  signal?: AbortSignal;
  baseSchema: SchemaNode;
  strictSchema: SchemaNode;
  buildPrompt: (text: string) => string;
  cleanDescription: (desc: string, kind: "expense" | "income") => string;
}): Promise<{ output?: GeminiParsedOutput; transcribedText?: string }> {
  input.signal?.throwIfAborted();
  if (!/^gsk_[A-Za-z0-9_-]+$/.test(input.apiKey.trim())) {
    throw new OperationalFailure("configuration", "groq");
  }
  const key = input.apiKey.trim();
  let effectiveText = input.text?.trim() ?? "";
  let transcribedText: string | undefined;
  const isAudio = Boolean(
    input.mediaBase64 && input.mimeType?.startsWith("audio/"),
  );
  const isImage = Boolean(
    input.mediaBase64 && input.mimeType?.startsWith("image/"),
  );

  if (isAudio) {
    await waitForGroqBudget("whisper", input.signal);
    const started = performance.now();
    let phase: "request" | "parse" = "request";
    let status: number | undefined;
    let quotaMeta: {
      retryAfterMs?: number;
      tokensRemaining?: number;
      requestsRemaining?: number;
    } = {};
    try {
      const audioBytes = base64ToBytes(input.mediaBase64!, LIMITS.audioBytes);
      const form = new FormData();
      form.append(
        "file",
        new Blob([audioBytes as Uint8Array<ArrayBuffer>], {
          type: input.mimeType!,
        }),
        `audio.${audioExtension(input.mimeType!)}`,
      );
      form.append("model", WHISPER_MODEL);
      form.append("language", "es");
      form.append("temperature", "0");
      form.append("response_format", "json");

      const signal = timeoutSignal(10_000, input.signal);
      const response = await withinSignal(
        () =>
          fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
            method: "POST",
            headers: { authorization: `Bearer ${key}` },
            body: form,
            signal,
          }),
        signal,
      );
      status = response.status;
      quotaMeta = updateGroqBudget("whisper", response.headers, status);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw httpFailure(status, "groq");
      }
      phase = "parse";
      const payload = await boundedJson<{ text?: unknown }>(
        response,
        LIMITS.providerJsonBytes,
        signal,
        "groq",
      );
      if (typeof payload.text !== "string") {
        throw new OperationalFailure("invalid_response", "groq");
      }
      writeOperationalLog("ai_attempt", {
        model: "whisper",
        provider: "groq",
        result: "success",
        status,
        duration_ms: performance.now() - started,
        ...(quotaMeta.requestsRemaining !== undefined
          ? { requests_remaining: quotaMeta.requestsRemaining }
          : {}),
      });
      effectiveText = normalizeWhisperTranscript(payload.text);
      transcribedText = effectiveText;
      if (!effectiveText) {
        return {
          output: { intent: "unknown", movements: [] },
          transcribedText: "",
        };
      }
      const localCmd = parseLocalCommand(effectiveText);
      if (
        localCmd?.kind === "confirm" ||
        localCmd?.kind === "cancel" ||
        localCmd?.kind === "summary"
      ) {
        writeOperationalLog("local_rule", { rule: "command" });
        return {
          output: { intent: localCmd.kind, movements: [] },
          transcribedText,
        };
      }
      if (localCmd?.kind === "remove") {
        writeOperationalLog("local_rule", { rule: "command" });
        return {
          output: {
            intent: "remove_item",
            movements: [],
            removePosition: localCmd.position,
          },
          transcribedText,
        };
      }
      if (looksLikeDraftCorrection(effectiveText)) {
        const corr = parseDraftCorrection(effectiveText);
        if (corr?.kind === "edit") {
          writeOperationalLog("local_rule", { rule: "correction" });
          return {
            output: {
              intent: "edit_item",
              movements: [],
              edit: {
                targetPosition: corr.position,
                amount: corr.amount,
                description: null,
                category: null,
              },
            },
            transcribedText,
          };
        }
      } else {
        const direct = parseDeterministicMovements(effectiveText, input.today);
        if (direct?.length) {
          writeOperationalLog("local_rule", {
            rule: "movements",
            operations: direct.length,
          });
          return {
            output: { intent: "add_movements", movements: direct },
            transcribedText,
          };
        }
      }
    } catch (err) {
      const failure = providerFailure(
        err,
        "groq",
        phase === "request" ? "network" : "invalid_response",
      );
      writeOperationalLog("ai_attempt", {
        model: "whisper",
        result: "failure",
        duration_ms: performance.now() - started,
        ...failureMetadata(failure),
        ...(quotaMeta.retryAfterMs !== undefined
          ? { retry_after_ms: quotaMeta.retryAfterMs }
          : {}),
        ...(quotaMeta.requestsRemaining !== undefined
          ? { requests_remaining: quotaMeta.requestsRemaining }
          : {}),
      });
      throw failure;
    }
  }

  await waitForGroqBudget("qwen", input.signal);
  const started = performance.now();
  let phase: "request" | "parse" = "request";
  let status: number | undefined;
  let quotaMeta: {
    retryAfterMs?: number;
    tokensRemaining?: number;
    requestsRemaining?: number;
  } = {};
  try {
    const promptText = input.buildPrompt(effectiveText) +
      GROQ_COMPATIBILITY_RULES(input.today);
    const content = isImage
      ? [
        { type: "text", text: promptText },
        {
          type: "image_url",
          image_url: {
            url: `data:${input.mimeType};base64,${input.mediaBase64}`,
          },
        },
      ]
      : promptText;
    const body = JSON.stringify({
      model: QWEN_MODEL,
      messages: [{ role: "user", content }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "pesito_movements",
          strict: true,
          schema: input.strictSchema,
        },
      },
      max_completion_tokens: 4096,
      temperature: 0.1,
    });
    if (encoder.encode(body).byteLength > LIMITS.geminiRequestBytes) {
      throw new OperationalFailure("payload_too_large", "groq");
    }
    const signal = timeoutSignal(isImage ? 10_000 : 6_000, input.signal);
    const response = await withinSignal(
      () =>
        fetch(`${GROQ_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body,
          signal,
        }),
      signal,
    );
    status = response.status;
    quotaMeta = updateGroqBudget("qwen", response.headers, status);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw httpFailure(status, "groq");
    }
    phase = "parse";
    const payload = await boundedJson<{
      choices?: Array<{ message?: { content?: unknown } }>;
    }>(response, LIMITS.providerJsonBytes, signal, "groq");
    const raw = payload.choices?.[0]?.message?.content;
    if (typeof raw !== "string" || !raw.trim()) {
      throw new OperationalFailure("invalid_response", "groq");
    }
    const normalized = normalizeGroqOutput(JSON.parse(raw), input.today);
    const schemaErrors = validateAgainstSchema(normalized, input.baseSchema);
    if (
      schemaErrors.length > 0 ||
      (normalized.intent === "edit_item" &&
        (!normalized.edit ||
          typeof normalized.edit.targetPosition !== "number" ||
          normalized.edit.targetPosition < 1 ||
          (normalized.edit.amount === null &&
            normalized.edit.description === null &&
            normalized.edit.category === null)))
    ) {
      throw new OperationalFailure("invalid_response", "groq");
    }
    if (Array.isArray(normalized.movements)) {
      for (const mov of normalized.movements) {
        mov.description = input.cleanDescription(mov.description, mov.kind);
      }
    }
    writeOperationalLog("ai_attempt", {
      model: "qwen",
      provider: "groq",
      result: "success",
      status,
      duration_ms: performance.now() - started,
      ...(quotaMeta.tokensRemaining !== undefined
        ? { tokens_remaining: quotaMeta.tokensRemaining }
        : {}),
      ...(quotaMeta.requestsRemaining !== undefined
        ? { requests_remaining: quotaMeta.requestsRemaining }
        : {}),
    });
    return { output: normalized, transcribedText };
  } catch (err) {
    const failure = providerFailure(
      err,
      "groq",
      phase === "request" ? "network" : "invalid_response",
    );
    writeOperationalLog("ai_attempt", {
      model: "qwen",
      result: "failure",
      duration_ms: performance.now() - started,
      ...failureMetadata(failure),
      ...(quotaMeta.retryAfterMs !== undefined
        ? { retry_after_ms: quotaMeta.retryAfterMs }
        : {}),
      ...(quotaMeta.tokensRemaining !== undefined
        ? { tokens_remaining: quotaMeta.tokensRemaining }
        : {}),
      ...(quotaMeta.requestsRemaining !== undefined
        ? { requests_remaining: quotaMeta.requestsRemaining }
        : {}),
    });
    throw failure;
  }
}
