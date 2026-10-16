import {
  failureMetadata,
  httpFailure,
  OperationalFailure,
  providerFailure,
} from "./failures.ts";
import { writeOperationalLog } from "./logging.ts";

export type ExtractedMovement = {
  kind: "expense" | "income";
  description: string;
  totalAmountArs: number | null;
  currency: "ARS" | "USD";
  occurredOn: string | null;
  category: string | null;
  installments: number;
  firstInstallmentMonth: string | null;
  confidence: number;
  missingFields: string[];
};

export type GeminiParsedOutput = {
  intent:
    | "add_movements"
    | "edit_item"
    | "remove_item"
    | "confirm"
    | "cancel"
    | "summary"
    | "unknown";
  movements: ExtractedMovement[];
  edit?: {
    targetPosition?: number | null;
    amount?: number | null;
    description?: string | null;
    category?: string | null;
  } | null;
  removePosition?: number | null;
  clarification?: string | null;
};

export type DraftListItem = {
  id?: string;
  position: number;
  kind: "expense" | "income";
  description: string;
  amount: number;
  currency: string;
  installments?: number;
  first_installment_month?: string | null;
  category_name?: string | null;
  status: string;
  missing_fields?: string[];
};

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

export async function sendWhatsAppText(to: string, body: string) {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) {
    throw new Error("WhatsApp no está configurado.");
  }
  const send = (recipient: string) =>
    fetch(`${graphBase}/${phoneNumberId}/messages`, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
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
    });

  let response = await send(to);
  let failureJson: { error?: { code?: number } } | null = null;

  if (!response.ok) {
    failureJson = await response.clone().json().catch(() => null);

    // Si es de Argentina (+54), probar alternando con o sin el '9'
    if (to.startsWith("549")) {
      const altTo = to.replace(/^549/, "54");
      const altResponse = await send(altTo);
      if (altResponse.ok) {
        return;
      }
      failureJson = (await altResponse.clone().json().catch(() => null)) ||
        failureJson;
      response = altResponse;
    } else if (to.startsWith("54") && !to.startsWith("549")) {
      const altTo = to.replace(/^54/, "549");
      const altResponse = await send(altTo);
      if (altResponse.ok) {
        return;
      }
      failureJson = (await altResponse.clone().json().catch(() => null)) ||
        failureJson;
      response = altResponse;
    }
  }

  if (!response.ok) {
    const code = failureJson?.error?.code || response.status;
    throw new Error(`WHATSAPP_SEND_${code}`);
  }
}

export async function downloadWhatsAppMedia(mediaId: string) {
  try {
    const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    if (!token) throw new OperationalFailure("configuration", "meta_media");
    const metadata = await fetch(`${graphBase}/${mediaId}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!metadata.ok) {
      await metadata.body?.cancel().catch(() => {});
      throw httpFailure(metadata.status, "meta_media");
    }
    const { url, mime_type: mimeType } = await metadata.json() as {
      url: string;
      mime_type: string;
    };
    const file = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!file.ok) {
      await file.body?.cancel().catch(() => {});
      throw httpFailure(file.status, "meta_media");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { base64: btoa(binary), mimeType };
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
          missingFields: {
            type: "array",
            items: { type: "string", enum: ["amount", "date", "category"] },
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

export function cleanDescription(
  desc: string,
  kind: "expense" | "income",
): string {
  if (!desc) return kind === "expense" ? "Gasto general" : "Ingreso general";
  let cleaned = desc.trim();
  // Quitar prefijos de acción comunes como "gasté ... en ", "pagué ... en ", etc.
  cleaned = cleaned.replace(
    /^(gast[eé]|pagu[eé]|compr[eé]|abone|abon[eé]|carg[uú]e|pagar|gastar)\s+(\d+[\d.,]*\s*(k|mil|lucas?)?\s*(pesos?|ars|usd|dolares|dólares)?\s*(en|de)?\s*)?/i,
    "",
  );
  cleaned = cleaned.replace(
    /^(ingres[oó]|me\s+ingresaron|me\s+ingres[oó]|cobr[eé]|me\s+pagaron|me\s+transfirieron|dep[oó]sito\s+de)\s+(\d+[\d.,]*\s*(k|mil|lucas?)?\s*(pesos?|ars|usd|dolares|dólares)?\s*(en|de|por)?\s*)?/i,
    "",
  );
  cleaned = cleaned.replace(/^(en\s+|de\s+|por\s+)/i, "");
  cleaned = cleaned.replace(
    /\s+(\d+[\d.,]*\s*(k|mil|lucas?)?\s*(pesos?|ars|usd|dolares|dólares)?)$/i,
    "",
  );
  cleaned = cleaned.trim();
  if (!cleaned) return kind === "expense" ? "Gasto general" : "Ingreso general";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function parseDeterministicMovement(
  rawText: string,
  today: string,
): ExtractedMovement | null {
  const text = rawText.trim();
  if (!text) return null;

  const isIncome =
    /^(ingres[oó]|me\s+ingresaron|me\s+ingres[oó]|cobr[eé]|me\s+pagaron|me\s+transfirieron|dep[oó]sito|sueldo|venta)(?=\s|$)/i
      .test(text);
  const kind: "expense" | "income" = isIncome ? "income" : "expense";
  const isUsd = /\b(usd|d[oó]lares?|u\$s|greens?)\b/i.test(text);
  const currency: "ARS" | "USD" = isUsd ? "USD" : "ARS";

  // Buscar monto numérico
  const amountRegex =
    /(?:^|\s|\$)(?:usd|u\$s)?\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(k|mil|lucas?)?\s*(?:pesos?|ars|usd|d[oó]lares?)?(?:\s|$)/i;
  const match = text.match(amountRegex);
  if (!match) return null;

  let rawNum = match[1];
  const multiplier = match[2]?.toLowerCase();

  // Normalizar número argentino
  if (rawNum.includes(".") && rawNum.includes(",")) {
    rawNum = rawNum.replace(/\./g, "").replace(",", ".");
  } else if (rawNum.includes(".")) {
    if (/^\d{1,3}(?:\.\d{3})+$/.test(rawNum)) {
      rawNum = rawNum.replace(/\./g, "");
    }
  } else if (rawNum.includes(",")) {
    rawNum = rawNum.replace(",", ".");
  }

  let num = parseFloat(rawNum);
  if (!Number.isFinite(num) || num <= 0) return null;

  if (
    multiplier === "k" || multiplier === "mil" || multiplier === "luca" ||
    multiplier === "lucas"
  ) {
    num *= 1000;
  }

  // Quitar el monto del texto para obtener la descripción
  let desc = text.replace(match[0], " ").trim();
  desc = cleanDescription(desc, kind);

  // Inferir categoría
  const lowerDesc = desc.toLowerCase();
  let category = "Otros";
  if (kind === "income") {
    if (/sueldo|salario|haberes|quincena/.test(lowerDesc)) category = "Sueldo";
    else if (/freelance|diseño|proyecto|cliente/.test(lowerDesc)) {
      category = "Freelance";
    } else if (/venta|vendo|mercadolibre/.test(lowerDesc)) category = "Ventas";
  } else {
    if (
      /super|chango|coto|vea|dia|disco|carrefour|almacen|verduleria|carniceria|panaderia|comida|almuerzo|cena|merienda|desayuno|cafe|restaurant|pedidosya|rappi|mcdonalds|mostaza|burger|helado|facturas|kiosco|caramelos/
        .test(lowerDesc)
    ) category = "Alimentación";
    else if (
      /nafta|combustible|ypf|shell|axion|uber|cabify|didi|taxi|colectivo|subte|tren|peaje|estacionamiento|cochera|sube/
        .test(lowerDesc)
    ) category = "Transporte";
    else if (
      /luz|gas|agua|internet|wifi|fibertel|telecentro|flow|cable|claro|personal|movistar|expensas|edenor|edesur|metrogas/
        .test(lowerDesc)
    ) category = "Servicios";
    else if (/alquiler|inmobiliaria/.test(lowerDesc)) category = "Vivienda";
    else if (
      /farmacia|remedio|medicamento|medico|doctor|dentista|odontologo|psicologo|consulta|analisis|creatina|suplementos?|proteina|optica/
        .test(lowerDesc)
    ) category = "Salud";
    else if (
      /colegio|facultad|universidad|cuota|curso|taller|capacitacion|libro|apunte/
        .test(lowerDesc)
    ) category = "Educación";
    else if (
      /cine|teatro|boliche|recital|salida|bar|cerveza|juego|steam|playstation|netflix|spotify|disney|hbo|prime/
        .test(lowerDesc)
    ) category = "Ocio";
    else if (
      /ropa|zapatillas|remera|pantalon|shopping|zapatos|camisa|buzo|campera/
        .test(lowerDesc)
    ) category = "Compras";
    else if (
      /afip|rentas|monotributo|arba|iibb|impuesto|tasa|patente/.test(lowerDesc)
    ) category = "Impuestos";
    else if (/prestamo|tarjeta|cuota tarjeta|deuda/.test(lowerDesc)) {
      category = "Deudas";
    }
  }

  return {
    kind,
    description: desc,
    totalAmountArs: num,
    currency,
    occurredOn: today,
    category,
    installments: 1,
    firstInstallmentMonth: null,
    confidence: 0.95,
    missingFields: [],
  };
}

export function parseDeterministicMovements(
  text: string,
  today: string,
): ExtractedMovement[] | null {
  const parts = text.split(
    /\n|(?:\s+y\s+)|,\s*(?=[a-záéíóúñ])|(?<=[^\d]),\s*(?=\d)/i,
  ).map((p) => p.trim()).filter(Boolean);
  const results: ExtractedMovement[] = [];
  for (const part of parts) {
    const mov = parseDeterministicMovement(part, today);
    if (!mov) return null;
    results.push(mov);
  }
  return results.length > 0 ? results : null;
}

export async function extractFromGemini(input: {
  text?: string;
  mediaBase64?: string;
  mimeType?: string;
  activeDraftContext?: string;
}): Promise<GeminiParsedOutput> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new OperationalFailure("configuration", "gemini");

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
- CONCEPTO / DETALLE ("description"): ÚNICAMENTE el concepto, producto, servicio, comercio o lugar (ej: "Súper", "Carnicería", "Nafta YPF", "Farmacia", "Almuerzo", "Sueldo"). PROHIBIDO incluir verbos de acción ("gasté", "pagué", "cobré") y PROHIBIDO incluir el monto numérico en la descripción.
- MONEDA Y MONTOS: "USD" si menciona dólares o u$s; por defecto "ARS". Interpretá "lucas" y "k" como miles de ARS (ej: "20 lucas" = 20000, "5k" = 5000). Admití montos con decimales (centavos), ej: "10000,50" o "10000.50" = 10000.5.
- CATEGORÍAS:
  * Gasto: Alimentación, Transporte, Vivienda, Servicios, Salud, Educación, Ocio, Compras, Impuestos, Deudas, Otros.
  * Ingreso: Sueldo, Freelance, Ventas, Rendimientos, Otros.
- CUOTAS: Si es en cuotas, indicá installments y firstInstallmentMonth. De lo contrario installments = 1.
- COMPROBANTES: Si el usuario envía una imagen de un comprobante o ticket, interpretalo como UNA sola operación por el total del ticket; no dividas sus productos individuales. Si la imagen muestra varios comprobantes separados, extraé cada uno como una operación independiente.

Mensaje del usuario: ${input.text ?? ""}`;

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (input.mediaBase64 && input.mimeType) {
    parts.push({
      inlineData: { mimeType: input.mimeType, data: input.mediaBase64 },
    });
  }

  // Modelos candidatos ordenados por rapidez y capacidad (gemini-3.8-flash y gemini-3.1-flash-lite)
  const candidateModels = [{ id: "gemini-3.8-flash", label: "flash" }, {
    id: "gemini-3.1-flash-lite",
    label: "flash_lite",
  }] as const;
  let lastError: Error | null = null;

  for (const model of candidateModels) {
    const started = performance.now();
    let phase: "request" | "parse" = "request";
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(3500), // Timeout ágil de 3.5s para no demorar al usuario
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: multiResponseJsonSchema,
              temperature: 0.1,
            },
          }),
        },
      );

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw httpFailure(response.status, "gemini");
      }

      phase = "parse";
      const payload = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) throw new OperationalFailure("invalid_response", "gemini");
      const parsed = JSON.parse(raw) as GeminiParsedOutput;

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

export function formatDraftList(items: DraftListItem[]): string {
  const activeItems = items.filter((it) => it.status === "pending");
  if (activeItems.length === 0) {
    return "No tenés movimientos pendientes en tu lista.";
  }

  const count = activeItems.length;
  const countText = count === 1
    ? "1 movimiento para revisar:"
    : `${count} movimientos para revisar:`;

  let out = `Tenés ${countText}\n\n`;

  for (const it of activeItems) {
    const isUsd = it.currency === "USD";
    const icon = it.kind === "income" ? "🟢" : "🔴";
    const hasDecimals = Math.round(Math.abs(it.amount) * 100) % 100 !== 0;
    const amountStr = isUsd
      ? `US$ ${
        it.amount.toLocaleString("es-AR", {
          minimumFractionDigits: hasDecimals ? 2 : 0,
          maximumFractionDigits: 2,
        })
      } [USD]`
      : it.amount.toLocaleString("es-AR", {
        style: "currency",
        currency: "ARS",
        minimumFractionDigits: hasDecimals ? 2 : 0,
        maximumFractionDigits: 2,
      });

    const instText = (it.installments && it.installments > 1)
      ? ` (${it.installments} cuotas)`
      : "";
    out +=
      `${it.position}. ${icon} ${it.description} · ${amountStr}${instText}\n`;
  }

  out +=
    `\nPodés seguir agregando, corregir alguno (ej: "el 2 fue de 5.000"), quitar ("quitá el 2") o responder *CONFIRMAR* para guardar todo.`;
  return out;
}
