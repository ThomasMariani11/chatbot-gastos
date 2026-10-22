import { describe, expect, it, vi } from "vitest";
import { handleAdminSend } from "../supabase/functions/whatsapp-webhook/admin-send";
const key = "sb_secret_synthetic_default_1234567890";
const legacy = "synthetic-legacy-service-role";
const config = JSON.stringify({
  default: key,
  other: "sb_secret_synthetic_other",
});
const notice = { to: "5491111111111", body: "Aviso sintético" };
function request(headers: Record<string, string> = {}, body: unknown = notice) {
  return new Request("https://example.invalid?action=test-send", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
function fixture(secretKeysJson: string | undefined = config) {
  const send = vi.fn(async () => {});
  return {
    send,
    secretKeysJson: secretKeysJson as string | undefined,
    legacyServiceKey: legacy,
  };
}
describe("envío administrativo con credenciales ficticias y sin red", () => {
  it("acepta solo la default secreta por apikey, sin combinar claves", async () => {
    const deps = fixture();
    const response = await handleAdminSend(request({ apikey: key }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(deps.send.mock.calls).toEqual([[notice.to, notice.body]]);
  });
  it("la default vigente funciona aunque haya un Bearer legacy diferente", async () => {
    const deps = fixture();
    expect(
      (await handleAdminSend(
        request({ apikey: key, authorization: "Bearer legacy-desactualizada" }),
        deps,
      )).status,
    ).toBe(200);
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
  it("conserva la coincidencia exacta del Bearer legacy cuando no hay apikey", async () => {
    const deps = fixture();
    expect(
      (await handleAdminSend(
        request({ authorization: "Bearer " + legacy }),
        deps,
      )).status,
    ).toBe(200);
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
  it.each(
    [
      {},
      { apikey: "" },
      { apikey: "sb_secret_incorrecta" },
      { apikey: "sb_publishable_publica" },
      { apikey: "sb_secret_synthetic_other" },
      { authorization: "Bearer JWT-con-role-service_role-sin-firma" },
      { authorization: "Bearer legacy-desactualizada" },
      { apikey: "incorrecta", authorization: "Bearer " + legacy },
    ] as Record<string, string>[],
  )("rechaza credenciales inválidas sin enviar: %j", async (headers) => {
    const deps = fixture();
    const response = await handleAdminSend(request(headers), deps);
    expect(response.status).toBe(401);
    expect(deps.send).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "No autorizado." });
  });
  it.each([
    undefined,
    "",
    "{",
    "null",
    "[]",
    JSON.stringify({ other: key }),
    JSON.stringify({ default: 123 }),
    JSON.stringify({ default: "sb_publishable_publica" }),
    JSON.stringify({ default: "sb_secret_" }),
    JSON.stringify({ default: " " + key }),
  ])(
    "configuración secreta ausente o inválida falla cerrada: %s",
    async (raw) => {
      const deps = fixture();
      deps.secretKeysJson = raw;
      expect((await handleAdminSend(request({ apikey: key }), deps)).status)
        .toBe(401);
      expect(deps.send).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    [],
    {},
    { to: notice.to },
    { to: 123, body: "Aviso" },
    { to: "https://example.invalid", body: "Aviso" },
    { to: notice.to, body: 123 },
    { to: notice.to, body: "  " },
    { to: notice.to, body: "a".repeat(4097) },
  ])("rechaza avisos inválidos sin enviar: %j", async (body) => {
    const deps = fixture();
    expect((await handleAdminSend(request({ apikey: key }, body), deps)).status)
      .toBe(400);
    expect(deps.send).not.toHaveBeenCalled();
  });
  it("autentica antes de interpretar el cuerpo y rechaza JSON inválido", async () => {
    const deps = fixture();
    const url = "https://example.invalid?action=test-send";
    expect(
      (await handleAdminSend(
        new Request(url, { method: "POST", body: "{" }),
        deps,
      )).status,
    ).toBe(401);
    expect(
      (await handleAdminSend(
        new Request(url, {
          method: "POST",
          headers: { apikey: key },
          body: "{",
        }),
        deps,
      )).status,
    ).toBe(400);
    expect(deps.send).not.toHaveBeenCalled();
  });
  it("un fallo de envío no anuncia éxito, filtra el error ni repite la llamada", async () => {
    const deps = fixture();
    deps.send.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_BODY_AND_KEY"));
    const response = await handleAdminSend(request({ apikey: key }), deps);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("PRIVATE_");
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
  it("GET no envía avisos", async () => {
    const deps = fixture();
    expect(
      (await handleAdminSend(
        new Request("https://example.invalid", { headers: { apikey: key } }),
        deps,
      )).status,
    ).toBe(405);
    expect(deps.send).not.toHaveBeenCalled();
  });
});
