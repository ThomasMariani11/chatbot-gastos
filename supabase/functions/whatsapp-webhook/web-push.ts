// Web Push sin dependencias: cifrado aes128gcm (RFC 8291) y VAPID (RFC 8292)
// solo con WebCrypto, compatible con Deno (Edge) y Node (pruebas).

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };
export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

const encoder = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Bytes {
  const clean = value.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = clean + "=".repeat((4 - clean.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((size, part) => size + part.length, 0)));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
}

/** HKDF de un solo bloque (longitud <= 32), como usa RFC 8291. */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, Uint8Array.of(1)))).slice(0, length);
}

function publicJwk(publicKey: Uint8Array) {
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error("PUSH_INVALID_PUBLIC_KEY");
  return {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(publicKey.slice(1, 33)),
    y: base64UrlEncode(publicKey.slice(33, 65)),
  };
}

/** Cifra el payload para una suscripción (un solo registro, rs = 4096). */
export async function encryptPayload(
  payload: Bytes,
  subscription: Pick<PushSubscriptionKeys, "p256dh" | "auth">,
  overrides?: { salt?: Bytes; senderKeys?: CryptoKeyPair },
): Promise<Bytes> {
  if (payload.length > 3000) throw new Error("PUSH_PAYLOAD_TOO_LARGE");
  const receiverPublic = base64UrlDecode(subscription.p256dh);
  const authSecret = base64UrlDecode(subscription.auth);
  if (authSecret.length !== 16) throw new Error("PUSH_INVALID_AUTH");
  const receiverKey = await crypto.subtle.importKey(
    "jwk",
    { ...publicJwk(receiverPublic), ext: true },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const senderKeys = overrides?.senderKeys ??
    await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", senderKeys.publicKey));
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: receiverKey }, senderKeys.privateKey, 256),
  );
  const keyInfo = concat(encoder.encode("WebPush: info\0"), receiverPublic, senderPublic);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);
  const salt = overrides?.salt ?? crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // Delimitador 0x02: último (y único) registro.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, concat(payload, Uint8Array.of(2))),
  );
  const header = new Uint8Array(new ArrayBuffer(16 + 4 + 1));
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = senderPublic.length;
  return concat(header, senderPublic, ciphertext);
}

/** Firma el JWT VAPID (ES256) para el origen del endpoint. */
export async function vapidAuthorization(endpoint: string, vapid: VapidConfig, nowSeconds: number): Promise<string> {
  const publicKey = base64UrlDecode(vapid.publicKey);
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    { ...publicJwk(publicKey), d: vapid.privateKey.replace(/=+$/, ""), ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64UrlEncode(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: nowSeconds + 12 * 3600,
    sub: vapid.subject,
  })));
  const unsigned = `${header}.${claims}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, encoder.encode(unsigned)),
  );
  return `vapid t=${unsigned}.${base64UrlEncode(signature)}, k=${vapid.publicKey.replace(/=+$/, "")}`;
}

export type PushResult = "sent" | "gone" | "failed";

/** Envía una notificación. 404/410 indican suscripción caducada. */
export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  payload: string,
  vapid: VapidConfig,
  options: { fetch?: typeof fetch; ttlSeconds?: number; now?: () => number; signal?: AbortSignal } = {},
): Promise<PushResult> {
  const url = new URL(subscription.endpoint);
  if (url.protocol !== "https:") return "gone";
  const body = await encryptPayload(encoder.encode(payload), subscription);
  const response = await (options.fetch ?? fetch)(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: String(options.ttlSeconds ?? 24 * 3600),
      Urgency: "normal",
      Authorization: await vapidAuthorization(
        subscription.endpoint,
        vapid,
        Math.floor((options.now ?? Date.now)() / 1000),
      ),
    },
    body,
    signal: options.signal,
  });
  await response.body?.cancel();
  if (response.status === 404 || response.status === 410) return "gone";
  return response.ok ? "sent" : "failed";
}
