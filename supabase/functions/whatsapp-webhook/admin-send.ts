// Autenticación del envío administrativo; nunca usa claves públicas ni JWT
// decodificados sin verificar. No registra credenciales ni contenido del aviso.
import { sameSecret } from "./secrets.ts";

export type AdminSendDependencies = {
  legacyServiceKey?: string;
  secretKeysJson?: string;
  send: (to: string, body: string) => Promise<void>;
};

function defaultBackendKey(raw: string | undefined): string | undefined {
  try {
    const keys: unknown = JSON.parse(raw ?? "");
    if (
      !keys || typeof keys !== "object" || Array.isArray(keys) ||
      !Object.hasOwn(keys, "default")
    ) return undefined;
    const value = (keys as Record<string, unknown>).default;
    return typeof value === "string" && value.startsWith("sb_secret_") &&
        value.length > "sb_secret_".length && value.trim() === value
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export async function handleAdminSend(
  request: Request,
  dependencies: AdminSendDependencies,
): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "Método no permitido." }, { status: 405 });
  }
  // apikey explícito selecciona solo la clave secreta default. Si es incorrecto,
  // no cae a otra credencial. Sin apikey se conserva el contrato legacy exacto.
  const authorized = request.headers.has("apikey")
    ? await sameSecret(
      request.headers.get("apikey"),
      defaultBackendKey(dependencies.secretKeysJson),
    )
    : await sameSecret(
      request.headers.get("authorization"),
      dependencies.legacyServiceKey
        ? "Bearer " + dependencies.legacyServiceKey
        : undefined,
    );
  if (!authorized) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    return Response.json({ error: "Aviso inválido." }, { status: 400 });
  }
  const notice = data as { to?: unknown; body?: unknown } | null;
  if (
    !notice || Array.isArray(notice) || typeof notice.to !== "string" ||
    !/^[0-9]{8,16}$/.test(notice.to) || typeof notice.body !== "string" ||
    !notice.body.trim() || notice.body.length > 4096
  ) {
    return Response.json({ error: "Aviso inválido." }, { status: 400 });
  }
  try {
    // Una sola llamada; un error/timeout no dispara reenvíos administrativos.
    await dependencies.send(notice.to, notice.body);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Envío no disponible." }, { status: 502 });
  }
}
