// deno-lint-ignore-file no-console -- Esta fixture intercepta console para verificar que no escapa contenido privado.
// Sin red ni credenciales reales: deno test --allow-env --deny-net queue_test.ts
import { readMessages } from "./queue.ts";
import { parseDeterministicMovements, validSignature } from "./helpers.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("parser real conserva centavos y no omite una parte sin monto", () => {
  assert(
    parseDeterministicMovements("Gasté 10000,50 en súper", "2026-10-15")?.[0]
      .totalAmountArs === 10000.5,
    "Centavos perdidos",
  );
  assert(
    parseDeterministicMovements("Gasté 100 en súper y nafta", "2026-10-15") ===
      null,
    "No debe aceptar una extracción parcial",
  );
});

Deno.test("firma real rechaza mensajes modificados y falta de secreto", async () => {
  const previous = Deno.env.get("META_APP_SECRET");
  try {
    Deno.env.set("META_APP_SECRET", "synthetic-test-secret");
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("synthetic-test-secret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const raw = '{"entry":[]}';
    const signature = "sha256=" +
      Array.from(
        new Uint8Array(
          await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)),
        ),
      ).map((n) => n.toString(16).padStart(2, "0")).join("");
    assert(await validSignature(raw, signature), "Firma válida rechazada");
    assert(
      !await validSignature(raw + " ", signature),
      "Firma alterada aceptada",
    );
    Deno.env.delete("META_APP_SECRET");
    assert(!await validSignature(raw, signature), "Secreto ausente aceptado");
  } finally {
    if (previous === undefined) Deno.env.delete("META_APP_SECRET");
    else Deno.env.set("META_APP_SECRET", previous);
  }
});

Deno.test("endpoint real acusa recibo solo después de persistir y devuelve 503 al fallar", async () => {
  const previousServe = Deno.serve, previousFetch = globalThis.fetch;
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "META_APP_SECRET",
  ] as const;
  const previousEnv = names.map((name) => Deno.env.get(name));
  const runtime = Object.getOwnPropertyDescriptor(globalThis, "EdgeRuntime");
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const background: Promise<unknown>[] = [];
  try {
    Deno.env.set("SUPABASE_URL", "https://example.invalid");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key");
    Deno.env.set("META_APP_SECRET", "synthetic-secret");
    Deno.serve = ((fn: typeof handler) => {
      handler = fn;
      return {};
    }) as unknown as typeof Deno.serve;
    Object.defineProperty(globalThis, "EdgeRuntime", {
      configurable: true,
      value: { waitUntil: (task: Promise<unknown>) => background.push(task) },
    });
    await import("./index.ts");
    assert(handler, "Handler no registrado");
    let fail = false, saved = false;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      assert(
        url.includes("/rest/v1/rpc/enqueue_whatsapp_messages"),
        "Solicitud externa inesperada",
      );
      const sent = JSON.parse(String(init?.body)) as { p_messages: unknown[] };
      assert(sent.p_messages.length === 2, "Payload incompleto");
      if (fail) {
        return Promise.resolve(
          new Response('{"message":"synthetic-error"}', {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      saved = true;
      return Promise.resolve(
        new Response('{"actors":[]}', {
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;
    const raw = JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: "synthetic-1",
              from: "synthetic-a",
              type: "text",
              text: { body: "synthetic" },
            }],
          },
        }],
      }, {
        changes: [{
          value: {
            messages: [{
              id: "synthetic-2",
              from: "synthetic-b",
              type: "audio",
              audio: { id: "synthetic-media" },
            }],
          },
        }],
      }],
    });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("synthetic-secret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = "sha256=" +
      Array.from(
        new Uint8Array(
          await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)),
        ),
      ).map((n) => n.toString(16).padStart(2, "0")).join("");
    const request = () =>
      new Request("https://example.invalid/whatsapp-webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": signature },
        body: raw,
      });
    assert(
      (await handler(request())).status === 200 && saved,
      "No debe confirmar antes de persistir",
    );
    await Promise.all(background);
    fail = true;
    assert(
      (await handler(request())).status === 503,
      "Un fallo de persistencia debe pedir reenvío a Meta",
    );
    assert(
      (await handler(
        new Request("https://example.invalid/whatsapp-webhook?action=worker", {
          method: "POST",
        }),
      )).status === 401,
      "Worker sin secreto aceptado",
    );
    assert(readMessages(JSON.parse(raw)).length === 2, "Lectura incompleta");
  } finally {
    Deno.serve = previousServe;
    globalThis.fetch = previousFetch;
    names.forEach((name, index) => {
      const value = previousEnv[index];
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    });
    if (runtime) Object.defineProperty(globalThis, "EdgeRuntime", runtime);
    else Reflect.deleteProperty(globalThis, "EdgeRuntime");
  }
});

Deno.test("logs del endpoint conservan estado sin cuerpos, tokens, URL ni excepciones", async () => {
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "META_APP_SECRET",
    "WHATSAPP_VERIFY_TOKEN",
  ] as const;
  const previousEnv = names.map((name) => Deno.env.get(name));
  const previousServe = Deno.serve;
  const previous = {
    log: console.log,
    error: console.error,
    warn: console.warn,
  };
  const captured: unknown[][] = [];
  const canaries = [
    "PRIVATE_BODY_CANARY",
    "PRIVATE_VERIFY_CANARY",
    "PRIVATE_ERROR_CANARY",
    "PRIVATE_KEY_CANARY",
    "5490000000000",
    "PRIVATE_RECEIPT_CANARY",
  ];
  let completed = false;
  try {
    Deno.env.set("SUPABASE_URL", "https://example.invalid");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key");
    Deno.env.set("META_APP_SECRET", "synthetic-secret");
    Deno.env.set("WHATSAPP_VERIFY_TOKEN", canaries[1]);
    Deno.serve = (() => ({})) as unknown as typeof Deno.serve;
    const { handleRequest } = await import("./index.ts");
    console.log = (...args) => {
      captured.push(args);
    };
    console.error = (...args) => {
      captured.push(args);
    };
    console.warn = (...args) => {
      captured.push(args);
    };
    const verified = await handleRequest(
      new Request(
        `https://example.invalid/?hub.mode=subscribe&hub.verify_token=${
          canaries[1]
        }&hub.challenge=${canaries[0]}`,
      ),
    );
    assert(
      verified.status === 200 && await verified.text() === canaries[0],
      "Verificación alterada",
    );
    const denied = await handleRequest(
      new Request(`https://example.invalid/?key=${canaries[3]}`, {
        method: "POST",
        headers: { authorization: canaries[3] },
        body: JSON.stringify({
          text: canaries[0],
          from: canaries[4],
          receipt: canaries[5],
        }),
      }),
    );
    assert(denied.status === 401, "Firma inválida no rechazada");
    const broken = new Request("https://example.invalid/", {
      method: "POST",
      body: "{}",
    });
    Object.defineProperty(broken, "text", {
      value: () => Promise.reject(new Error(canaries.join(" "))),
    });
    const unavailable = await handleRequest(broken);
    assert(
      unavailable.status === 503,
      "Error imprevisto debe responder sin exponer excepción",
    );
    assert(
      !(await unavailable.text()).includes(canaries[2]),
      "Error crudo en respuesta",
    );
    completed = true;
  } finally {
    console.log = previous.log;
    console.error = previous.error;
    console.warn = previous.warn;
    Deno.serve = previousServe;
    names.forEach((name, index) => {
      const value = previousEnv[index];
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    });
  }
  assert(completed && captured.length === 3, "Eventos de petición incompletos");
  for (const canary of canaries) {
    assert(
      !JSON.stringify(captured).includes(canary),
      "Canario privado expuesto",
    );
  }
  const events = captured.map((args) => JSON.parse(String(args[0])));
  assert(
    events.map((event) => event.status).join(",") === "200,401,503",
    "Estados diagnósticos perdidos",
  );
  assert(
    events.every((event) =>
      Object.keys(event).every((key) =>
        ["event", "route", "status", "duration_ms"].includes(key)
      )
    ),
    "Campo no autorizado en logs",
  );
});
