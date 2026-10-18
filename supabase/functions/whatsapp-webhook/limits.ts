import { OperationalFailure } from "./failures.ts";
import type { FailureProvider } from "./failures.ts";

export const LIMITS = Object.freeze({
  imageBytes: 5 * 1024 * 1024,
  audioBytes: 10 * 1024 * 1024,
  metadataBytes: 16 * 1024,
  providerJsonBytes: 256 * 1024,
  sendJsonBytes: 16 * 1024,
  geminiRequestBytes: 19_000_000,
  downloadMs: 10_000,
  interpretationMs: 30_000,
  jobMs: 60_000,
  rpcMs: 5_000,
  sendMs: 10_000,
});

export function timeoutSignal(ms: number, parent?: AbortSignal | null) {
  const timeout = AbortSignal.timeout(ms);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

// Limita también promesas/cuerpos que no reaccionen automáticamente al abort.
// Los efectos mutables conservan su idempotencia SQL y su fencing por lease.
export async function withinSignal<T>(
  work: () => PromiseLike<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return await work();
  return await new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return work();
    }).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function boundedBytes(
  response: Response,
  maximum: number,
  signal: AbortSignal,
  provider: FailureProvider,
): Promise<Uint8Array> {
  let completed = false;
  const reader = response.body?.getReader();
  if (!reader) throw new OperationalFailure("invalid_response", provider);
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const declared = response.headers.get("content-length");
    if (declared !== null) {
      if (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared))) {
        throw new OperationalFailure("invalid_response", provider);
      }
      if (Number(declared) > maximum) {
        throw new OperationalFailure("payload_too_large", provider);
      }
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await withinSignal(() => reader.read(), signal);
      signal.throwIfAborted();
      if (done) {
        completed = true;
        break;
      }
      total += value.byteLength;
      if (total > maximum) {
        throw new OperationalFailure("payload_too_large", provider);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!completed) cancel();
    reader.releaseLock();
  }
}

export async function boundedJson<T>(
  response: Response,
  maximum: number,
  signal: AbortSignal,
  provider: FailureProvider,
): Promise<T> {
  const bytes = await boundedBytes(response, maximum, signal, provider);
  signal.throwIfAborted();
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export function mediaPolicy(raw: unknown, kind?: "audio" | "image") {
  if (typeof raw !== "string") {
    throw new OperationalFailure("unsupported_media", "meta_media");
  }
  const mimeType = raw.split(";", 1)[0].trim().toLowerCase();
  const image = ["image/jpeg", "image/png"].includes(mimeType);
  const audio = [
    "audio/aac",
    "audio/mp4",
    "audio/mpeg",
    "audio/amr",
    "audio/ogg",
    "audio/wav",
    "audio/flac",
    "audio/webm",
    "audio/mp3",
    "audio/m4a",
    "audio/x-m4a",
    "audio/opus",
  ].includes(mimeType);
  if (
    (!image && !audio) || (kind === "audio" && !audio) ||
    (kind === "image" && !image)
  ) throw new OperationalFailure("unsupported_media", "meta_media");
  return { mimeType, maximum: image ? LIMITS.imageBytes : LIMITS.audioBytes };
}

export function bytesToBase64(bytes: Uint8Array) {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  }
  return btoa(parts.join(""));
}
