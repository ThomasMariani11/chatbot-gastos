import type { PendingEdit } from "./draft-edit.ts";
import type { BeforeAiRequest } from "./ai-quota.ts";
import { normalizeDraftMovements } from "./draft-normalization.ts";
import type { CompletionAction } from "./draft-completion.ts";
import { cleanDescription } from "./movement-description.ts";
export { cleanDescription } from "./movement-description.ts";
import type { FailureMetadata } from "./failures.ts";
import type { ExtractedMovement } from "./movement-types.ts";
export type { ExtractedMovement } from "./movement-types.ts";
import { parseDeterministicMovements } from "./local-movements.ts";
export {
  parseDeterministicMovement,
  parseDeterministicMovements,
} from "./local-movements.ts";
import {
  boundedBytes,
  boundedJson,
  bytesToBase64,
  LIMITS,
  mediaPolicy,
  timeoutSignal,
  withinSignal,
} from "./limits.ts";
import {
  failureMetadata,
  httpFailure,
  OperationalFailure,
  providerFailure,
} from "./failures.ts";
import { writeOperationalLog } from "./logging.ts";
import {
  buildStrictSchema,
  extractWithGroq,
  resetGroqBudgetForTests,
  validateAgainstSchema,
} from "./groq.ts";
export { resetGroqBudgetForTests };

export type GeminiParsedOutput = {
  intent:
    | "add_movements"
    | "edit_item"
    | "edit_pending"
    | "remove_item"
    | "confirm"
    | "cancel"
    | "summary"
    | "unknown"
    | "complete_item"
    | "clarify_completion"
    | "request_text"; // Checkpoint interno: nunca vuelve a invocar IA.
  movements: ExtractedMovement[];
  completion?: CompletionAction;
  pendingEdit?: PendingEdit;
  completionReply?: string;
  requestTextReason?: "size" | "type" | "quota";
  operationalFailure?: FailureMetadata; // Solo diagnóstico interno controlado por el procesador.
  edit?: {
    targetPosition?: number | null;
    amount?: number | null;
    description?: string | null;
    category?: string | null;
  } | null;
  removePosition?: number | null;
  clarification?: string | null;
};

export { formatDraftList } from "./draft-summary.ts";
export type { DraftListItem } from "./draft-summary.ts";

const graphVersion = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") || "v26.0";
const graphBase = `https://graph.facebook.com/${graphVersion}`;
const encoder = new TextEncoder();

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function validSignature(raw: string, signature: string | null) {
  const secret = Deno.env.get("META_APP_SECRET");
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(raw));
  const expected = `sha256=${
    Array.from(new Uint8Array(digest)).map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("")
  }`;
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function sendWhatsAppText(
  to: string,
  body: string,
  parent?: AbortSignal,
) {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) {
    throw new OperationalFailure("configuration", "meta_send");
  }
  // Un solo presupuesto para envío, respuesta y variante argentina, sin reiniciarlo.
  const signal = timeoutSignal(LIMITS.sendMs, parent);
  const recipients = [to];
  if (to.startsWith("549")) recipients.push(to.replace(/^549/, "54"));
  else if (to.startsWith("54")) recipients.push(to.replace(/^54/, "549"));
  let status = 502;
  try {
    for (const recipient of recipients) {
      signal.throwIfAborted();
      const response = await withinSignal(
        () =>
          fetch(`${graphBase}/${phoneNumberId}/messages`, {
            method: "POST",
            signal,
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: recipient,
              type: "text",
              text: { preview_url: false, body },
            }),
          }),
        signal,
      );
      status = response.status;
      if (response.ok) {
        void response.body?.cancel().catch(() => {});
        return;
      }
      // Se drena hasta un máximo, sin persistir ni registrar el cuerpo del proveedor.
      try {
        await boundedJson(response, LIMITS.sendJsonBytes, signal, "meta_send");
      } catch {
        signal.throwIfAborted();
      }
    }
    throw httpFailure(status, "meta_send");
  } catch (error) {
    throw providerFailure(error, "meta_send", "network");
  }
}

export async function downloadWhatsAppMedia(
  mediaId: string,
  kind?: "audio" | "image",
  parent?: AbortSignal,
) {
  const signal = timeoutSignal(LIMITS.downloadMs, parent);
  try {
    const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    if (!token) throw new OperationalFailure("configuration", "meta_media");
    const metadata = await withinSignal(() =>
      fetch(`${graphBase}/${mediaId}`, {
        headers: { authorization: `Bearer ${token}` },
        signal,
      }), signal);
    if (!metadata.ok) {
      void metadata.body?.cancel().catch(() => {});
      throw httpFailure(metadata.status, "meta_media");
    }
    const info = await boundedJson<
      { url?: unknown; mime_type?: unknown; file_size?: unknown }
    >(metadata, LIMITS.metadataBytes, signal, "meta_media");
    const { mimeType, maximum } = mediaPolicy(info.mime_type, kind);
    if (info.file_size !== undefined) {
      const size =
        typeof info.file_size === "string" && /^\d+$/.test(info.file_size)
          ? Number(info.file_size)
          : info.file_size;
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
        throw new OperationalFailure("invalid_response", "meta_media");
      }
      if (size > maximum) {
        throw new OperationalFailure("media_too_large", "meta_media");
      }
    }
    if (typeof info.url !== "string") {
      throw new OperationalFailure("invalid_response", "meta_media");
    }
    const url = new URL(info.url);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new OperationalFailure("invalid_response", "meta_media");
    }
    const file = await withinSignal(() =>
      fetch(url, {
        headers: { authorization: `Bearer ${token}` },
        signal,
      }), signal);
    if (!file.ok) {
      void file.body?.cancel().catch(() => {});
      throw httpFailure(file.status, "meta_media");
    }
    const contentType = file.headers.get("content-type")?.split(";", 1)[0]
      .trim().toLowerCase();
    if (
      contentType && contentType !== "application/octet-stream" &&
      contentType !== mimeType
    ) {
      void file.body?.cancel().catch(() => {});
      throw new OperationalFailure("unsupported_media", "meta_media");
    }
    const bytes = await boundedBytes(file, maximum, signal, "meta_media").catch(
      (error) => {
        if (failureMetadata(error).reason === "payload_too_large") {
          throw new OperationalFailure("media_too_large", "meta_media");
        }
        throw error;
      },
    );
    if (!bytes.length) {
      throw new OperationalFailure("invalid_response", "meta_media");
    }
    const base64 = bytesToBase64(bytes);
    signal.throwIfAborted();
    return { base64, mimeType };
  } catch (error) {
    throw providerFailure(error, "meta_media", "network");
  }
}

const multiResponseJsonSchema = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: [
        "add_movements",
        "edit_item",
        "remove_item",
        "confirm",
        "cancel",
        "summary",
        "unknown",
      ],
    },
    movements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["expense", "income"] },
          description: { type: "string" },
          totalAmountArs: { type: ["number", "null"] },
          currency: { type: "string", enum: ["ARS", "USD"] },
          occurredOn: { type: ["string", "null"] },
          category: { type: ["string", "null"] },
          installments: { type: "integer", minimum: 1, maximum: 60 },
          firstInstallmentMonth: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          clarification: { type: ["string", "null"] },
          missingFields: {
            type: "array",
            items: {
              type: "string",
              enum: ["amount", "date", "category", "description", "review"],
            },
          },
        },
        required: [
          "kind",
          "description",
          "totalAmountArs",
          "currency",
          "occurredOn",
          "category",
          "installments",
          "firstInstallmentMonth",
          "confidence",
          "missingFields",
        ],
      },
    },
    edit: {
      type: "object",
      properties: {
        targetPosition: { type: ["integer", "null"] },
        amount: { type: ["number", "null"] },
        description: { type: ["string", "null"] },
        category: { type: ["string", "null"] },
      },
    },
    removePosition: { type: ["integer", "null"] },
    clarification: { type: ["string", "null"] },
  },
  required: ["intent", "movements"],
};

export async function extractFromGemini(input: {
  text?: string;
  mediaBase64?: string;
  mimeType?: string;
  activeDraftContext?: string;
  resolveCompletion?: (text: string) => GeminiParsedOutput | null;
  beforeAiRequest?: BeforeAiRequest;
  signal?: AbortSignal;
}): Promise<GeminiParsedOutput> {
  input.signal?.throwIfAborted();
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!groqKey && !apiKey) {
    throw new OperationalFailure("configuration", "gemini");
  }

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const prompt = `Fecha local: ${today}.
Analizá el mensaje o audio del usuario para gestionar sus operaciones financieras (gastos e ingresos) en Pesito.

Borrador actual del usuario:
${input.activeDraftContext || "Sin movimientos pendientes actualmente."}

INTENCIONES POSIBLES ("intent"):
1. "add_movements": El usuario menciona uno o más gastos o ingresos nuevos (ej: "gasté 15000 en el súper y 4000 de nafta", "me entraron 80k de diseño"). Extraé cada uno como un elemento del array "movements".
2. "edit_item": El usuario pide corregir o cambiar un movimiento existente del borrador (ej: "el 2 fue de 5000", "el 1 no es súper es farmacia", "cambiá el 3 a 12000"). Indicá en "edit" el targetPosition y los campos modificados.
3. "remove_item": El usuario pide quitar o borrar un movimiento específico del borrador (ej: "quitá el 2", "sacá la nafta", "borrá el 1"). Indicá en "removePosition" el número de la posición.
4. "confirm": El usuario pide confirmar o guardar (ej: "confirmar", "dale guardá", "listo", "de una").
5. "cancel": El usuario pide cancelar o descartar todo el borrador (ej: "cancelar", "borrá todo", "descartar").
6. "summary": El usuario pide ver la lista o el resumen (ej: "resumen", "qué tengo pendiente", "mostrame la lista").
7. "unknown": Ruido incomprensible, saludo suelto o mensaje que no corresponde a ninguna acción financiera.

REGLAS PARA OPERACIONES ("movements"):
- TIPO ("kind"): "income" (sueldo, cobro, freelance, depósito, transferencia recibida, venta) o "expense" (compras, servicios, pagos, salidas).
- CONCEPTO / DETALLE ("description"): ÚNICAMENTE el concepto, producto, servicio, comercio o lugar (ej: "Súper", "Carnicería", "Nafta YPF", "Farmacia", "Almuerzo", "Sueldo"). PROHIBIDO incluir verbos de acción ("gasté", "pagué", "cobré") y PROHIBIDO incluir el importe de la operación en la descripción. Conservá los números que identifican el concepto (iPhone 15, colectivo 60, Ruta 9 o referencia 10/10); no los uses como monto ni como fecha.
- MONEDA Y MONTOS: Solo ARS (pesos argentinos) y USD (dólares estadounidenses). "Dólares" o u$s sin otro calificador significan USD; sin indicación de moneda, ARS. Si menciona una moneda distinta o contradictoria, devolvé intent="unknown" y movements=[]: no la conviertas ni la reemplaces por ARS/USD. Interpretá "lucas" y "k" como miles de ARS (ej: "20 lucas" = 20000, "5k" = 5000). Admití montos con decimales (centavos), ej: "10000,50" o "10000.50" = 10000.5.
- CATEGORÍAS:
  * Gasto: Alimentación, Transporte, Vivienda, Servicios, Salud, Educación, Ocio, Compras, Impuestos, Deudas, Otros.
  * Ingreso: Sueldo, Freelance, Ventas, Rendimientos, Otros.
- CUOTAS: Si es en cuotas, indicá installments y firstInstallmentMonth. De lo contrario installments = 1.
- FALTANTES: conservá TODAS las operaciones, incluidas las incompletas. Importe desconocido: totalAmountArs=null y missingFields=["amount"]. Fecha explícita ambigua: occurredOn=null y missingFields incluye "date"; sin fecha, usá la fecha local. Concepto desconocido: description="" y missingFields incluye "description". Sin categoría: Otros, sin preguntar. Conservá confidence=0. Registrá dudas en clarification; no inventes valores ni omitas una parte. Para correcciones/completado usá el número estable; si no es inequívoco, unknown.
- COMPROBANTES: Si el usuario envía una imagen de un comprobante o ticket, interpretalo como UNA sola operación por el total del ticket; no dividas sus productos individuales. Si la imagen muestra varios comprobantes separados, extraé cada uno como una operación independiente.

Mensaje del usuario: ${input.text ?? ""}`;

  let lastError: Error | null = null;
  if (groqKey) {
    try {
      const groqResult = await extractWithGroq({
        apiKey: groqKey,
        today,
        text: input.text,
        mediaBase64: input.mediaBase64,
        mimeType: input.mimeType,
        activeDraftContext: input.activeDraftContext,
        resolveCompletion: input.resolveCompletion,
        beforeAiRequest: input.beforeAiRequest,
        signal: input.signal,
        baseSchema: multiResponseJsonSchema,
        strictSchema: buildStrictSchema(multiResponseJsonSchema),
        buildPrompt: (text: string) =>
          prompt.replace(
            `Mensaje del usuario: ${input.text ?? ""}`,
            () => `Mensaje del usuario: ${text}`,
          ),
        cleanDescription,
      });
      if (groqResult.output) return groqResult.output;
    } catch (err) {
      lastError = err instanceof Error
        ? err
        : new OperationalFailure("unknown", "groq");
      input.signal?.throwIfAborted();
      if (input.text && !input.mediaBase64) {
        const fallbackMovements = parseDeterministicMovements(
          input.text,
          today,
        );
        if (fallbackMovements && fallbackMovements.length > 0) {
          return {
            intent: "add_movements",
            movements: fallbackMovements,
          };
        }
      }
      throw lastError;
    }
  }

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (input.mediaBase64 && input.mimeType) {
    parts.push({
      inlineData: { mimeType: input.mimeType, data: input.mediaBase64 },
    });
  }

  // Flash Lite primero; Flash como respaldo. Los medios necesitan más margen.
  const candidateModels = [
    { id: "gemini-3.1-flash-lite", label: "flash_lite" },
    {
      id: "gemini-3.8-flash",
      label: "flash",
    },
  ] as const;
  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: multiResponseJsonSchema,
      temperature: 0.1,
    },
  });
  if (encoder.encode(body).byteLength > LIMITS.geminiRequestBytes) {
    throw new OperationalFailure("payload_too_large", "gemini");
  }

  for (const model of candidateModels) {
    input.signal?.throwIfAborted();
    const started = performance.now();
    let phase: "request" | "parse" = "request";
    try {
      input.signal?.throwIfAborted();
      const signal = timeoutSignal(
        input.mediaBase64 ? 10000 : 3500,
        input.signal,
      );
      const response = await withinSignal(async () => {
        await input.beforeAiRequest?.("gemini", signal);
        signal.throwIfAborted();
        return fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal,
            body,
          },
        );
      }, signal);

      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw httpFailure(response.status, "gemini");
      }

      phase = "parse";
      const payload = await boundedJson<{
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      }>(response, LIMITS.providerJsonBytes, signal, "gemini");
      const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) throw new OperationalFailure("invalid_response", "gemini");
      const parsed = JSON.parse(raw) as GeminiParsedOutput;
      if (parsed?.intent === "add_movements") {
        parsed.movements = normalizeDraftMovements(
          parsed.movements,
          today,
          parsed.clarification,
        );
        delete parsed.clarification; // No reaplicar una duda global ya distribuida.
      }
      if (
        validateAgainstSchema(parsed, multiResponseJsonSchema).length ||
        (parsed.intent !== "add_movements" && parsed.movements.length)
      ) throw new OperationalFailure("invalid_response", "gemini");

      if (parsed.movements && Array.isArray(parsed.movements)) {
        for (const mov of parsed.movements) {
          mov.description = cleanDescription(mov.description, mov.kind);
        }
      }

      writeOperationalLog("ai_attempt", {
        model: model.label,
        provider: "gemini",
        result: "success",
        status: response.status,
        duration_ms: performance.now() - started,
      });
      return parsed;
    } catch (err) {
      lastError = providerFailure(
        err,
        "gemini",
        phase === "request" ? "network" : "invalid_response",
      );
      writeOperationalLog("ai_attempt", {
        model: model.label,
        result: "failure",
        duration_ms: performance.now() - started,
        ...failureMetadata(lastError),
      });
    }
  }

  // Si fallaron los modelos de IA y es un mensaje de texto (ej. 503 sobrecarga de Google), usar parser determinista
  input.signal?.throwIfAborted();
  if (input.text && !input.mediaBase64) {
    const fallbackMovements = parseDeterministicMovements(input.text, today);
    if (fallbackMovements && fallbackMovements.length > 0) {
      return {
        intent: "add_movements",
        movements: fallbackMovements,
      };
    }
  }

  throw lastError ?? new OperationalFailure("unknown", "gemini");
}

// El operador aprueba un número de prueba concreto. Verificar el remitente real
// antes de cada aviso evita que cambiar el phoneNumberId active envíos de pago.
export async function isVerifiedOperationalTestSender(
  expected: string,
): Promise<boolean> {
  if (!/^1555[0-9]{7}$/.test(expected)) return false;
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN"),
    phone = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phone) return false;
  const signal = timeoutSignal(LIMITS.rpcMs);
  try {
    const response = await fetch(
      graphBase + "/" + phone + "?fields=display_phone_number",
      { headers: { authorization: "Bearer " + token }, signal },
    );
    if (!response.ok) throw httpFailure(response.status, "meta_send");
    const data = await boundedJson(
      response,
      LIMITS.metadataBytes,
      signal,
      "meta_send",
    ) as { display_phone_number?: unknown };
    return typeof data.display_phone_number === "string" &&
      data.display_phone_number.replace(/[^0-9]/g, "") === expected;
  } catch (error) {
    throw providerFailure(error, "meta_send", "network");
  }
}
