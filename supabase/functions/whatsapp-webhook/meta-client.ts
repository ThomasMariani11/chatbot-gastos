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

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

const graphVersion =
  (typeof Deno !== "undefined"
    ? Deno.env.get("WHATSAPP_GRAPH_API_VERSION")
    : undefined) || "v26.0";
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
  options: { exactRecipient?: boolean } = {},
) {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) {
    throw new OperationalFailure("configuration", "meta_send");
  }
  // Un solo presupuesto para envío, respuesta y variante argentina, sin reiniciarlo.
  const signal = timeoutSignal(LIMITS.sendMs, parent);
  const recipients = [to];
  if (!options.exactRecipient) {
    if (to.startsWith("549")) recipients.push(to.replace(/^549/, "54"));
    else if (to.startsWith("54")) recipients.push(to.replace(/^54/, "549"));
  }
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
