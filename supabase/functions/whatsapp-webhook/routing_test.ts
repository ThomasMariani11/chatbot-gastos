// deno-lint-ignore-file no-console -- Captura de logs para verificar ausencia de datos privados.
import { failureMetadata } from "./failures.ts";
import { extractFromGemini } from "./helpers.ts";
import { prepareMessage } from "./processor.ts";
import { parseDeterministicMovements } from "./helpers.ts";
import type { Job } from "./queue.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const fixture =
  "Gasté 1100 en librería, 2200 en té y me ingresó 33mil de una transferencia";
function database(suspended = false) {
  const reads: string[] = [];
  let draftReads = 0;
  const db = {
    from: (table: string) => {
      reads.push(table);
      const data = table === "whatsapp_links"
        ? { user_id: "fixture-user" }
        : table === "profiles"
        ? {
          role: "client",
          subscription_status: suspended ? "suspended" : "active",
          subscription_until: null,
        }
        : table === "app_settings"
        ? { whatsapp_responses_enabled: true }
        : table === "system_config"
        ? { value: "true" }
        : null;
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data, error: null }),
        in: () => Promise.resolve({ data: [], error: null }),
      };
      return chain;
    },
    rpc: () => {
      draftReads++;
      return Promise.resolve({
        data: { items: [], is_stale: false },
        error: null,
      });
    },
  };
  return {
    db: db as unknown as Parameters<typeof prepareMessage>[0],
    reads,
    draftReads: () => draftReads,
  };
}
function job(body: string): Job {
  return {
    id: "synthetic-job",
    wa_id: "synthetic-route",
    user_id: "fixture-user",
    payload: {
      id: "synthetic-message",
      from: "synthetic-route",
      type: "text",
      text: { body },
    },
    attempts: 1,
    effect_applied: false,
    parsed_result: null,
    reply_text: null,
  };
}
Deno.test("procesador real: tres movimientos mixtos, sin consultas comerciales ni red", async () => {
  const { db, reads } = database();
  let checkpoints = 0;
  const result = await prepareMessage(db, job(fixture), () => {
    checkpoints++;
    return Promise.resolve();
  });
  assert(result.kind === "add", "El movimiento fue interceptado");
  const items = result.items as Array<
    { kind: string; totalAmountArs: number; description: string }
  >;
  assert(
    JSON.stringify(items.map((i) => [i.kind, i.totalAmountArs])) ===
      JSON.stringify([["expense", 1100], ["expense", 2200], ["income", 33000]]),
    "Se perdió o clasificó mal una operación",
  );
  assert(
    !items[2].description.toLowerCase().includes("me ingres"),
    "Descripción sin limpiar",
  );
  assert(checkpoints === 1, "Checkpoint incorrecto");
  assert(
    !reads.includes("transactions"),
    "Se consultó el saldo en vez de cargar",
  );
});
for (
  const text of [
    "Cobré 3400 por transferencia",
    "Me ingresó 3400 de una transferencia",
    "Me ingreso 3400 de una transferencia",
  ]
) {
  Deno.test(`parser real reconoce ingreso: ${text.split(" 3400")[0]}`, () => {
    const item = parseDeterministicMovements(text, "2026-10-15")?.[0];
    assert(
      item?.kind === "income" && item.totalAmountArs === 3400,
      "Ingreso clasificado incorrectamente",
    );
  });
}
Deno.test("consulta comercial real conserva soporte sin interpretar movimientos", async () => {
  const { db, draftReads } = database();
  const result = await prepareMessage(
    db,
    job("¿Cómo renuevo mi membresía?"),
    () => Promise.resolve(),
  );
  assert(
    result.kind === "reply" && String(result.text).includes("renovar"),
    "Consulta comercial rota",
  );
  assert(
    draftReads() === 0,
    "No corresponde interpretar una consulta comercial",
  );
});
Deno.test("clasificación no permite operaciones en cuentas suspendidas", async () => {
  const { db, draftReads } = database(true);
  const result = await prepareMessage(
    db,
    job(fixture),
    () => Promise.resolve(),
  );
  assert(
    result.kind === "reply" && String(result.text).includes("pausa"),
    "Se omitió el bloqueo",
  );
  assert(
    draftReads() === 0,
    "Se interpretó una operación de cuenta suspendida",
  );
});

Deno.test("corrección por posición no invoca IA ni crea un checkpoint de alta", async () => {
  const { db } = database();
  let checkpoints = 0;
  const result = await prepareMessage(db, job("el 2 fue de 250"), () => {
    checkpoints++;
    return Promise.resolve();
  });
  assert(
    result.kind === "edit" && result.position === 2 && result.amount === 250,
    "Corrección interpretada como alta",
  );
  assert(
    result.description === null && checkpoints === 0,
    "Se reinterpretó o cambió el concepto",
  );
});
Deno.test("una corrección incompleta no modifica ni se convierte en gasto", async () => {
  const { db } = database();
  const input = job("Cambiá la descripción del 2");
  input.parsed_result = {
    intent: "add_movements",
    movements: [{
      kind: "expense",
      description: "No debe agregarse",
      totalAmountArs: 2,
    }],
  };
  const result = await prepareMessage(db, input, () => Promise.resolve());
  assert(
    result.kind === "reply" && String(result.text).includes("No agregué"),
    "Una respuesta IA inválida agregó un gasto",
  );
});
Deno.test("dos correcciones juntas piden aclarar y conservan la lista", async () => {
  const { db } = database();
  const result = await prepareMessage(
    db,
    job("El 2 fue de 250 y el 3 de 500"),
    () => Promise.resolve(),
  );
  assert(
    result.kind === "reply" && String(result.text).includes("No modifiqué"),
    "Se aceptó parcialmente una instrucción ambigua",
  );
});

Deno.test("audio: descarga fallida pide texto con checkpoint, sin interpretación", async () => {
  const previousFetch = globalThis.fetch,
    previousToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  try {
    Deno.env.set("WHATSAPP_ACCESS_TOKEN", "PRIVATE_TEST_TOKEN");
    let calls = 0;
    const checkpoints: unknown[] = [];
    globalThis.fetch = (() => {
      calls++;
      return Promise.resolve(
        new Response("PRIVATE_PROVIDER_BODY", { status: 403 }),
      );
    }) as typeof fetch;
    const fixture = job("");
    fixture.payload = {
      id: "synthetic-audio",
      from: "synthetic-route",
      type: "audio",
      audio: { id: "PRIVATE_MEDIA_ID" },
    };
    const result = await prepareMessage(database().db, fixture, (value) => {
      checkpoints.push(value);
      return Promise.resolve();
    });
    assert(
      result.kind === "reply" && String(result.text).includes("Escribime"),
      "No pidió texto",
    );
    assert(
      calls === 1 &&
        JSON.stringify(checkpoints) ===
          JSON.stringify([{ intent: "request_text", movements: [] }]),
      "Checkpoint incorrecto",
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) Deno.env.delete("WHATSAPP_ACCESS_TOKEN");
    else Deno.env.set("WHATSAPP_ACCESS_TOKEN", previousToken);
  }
});

Deno.test("Gemini real: 429 activa respaldo y logs no contienen solicitud ni credenciales", async () => {
  const previousFetch = globalThis.fetch,
    previousKey = Deno.env.get("GEMINI_API_KEY"),
    previousLog = console.log;
  const lines: string[] = [];
  try {
    Deno.env.set("GEMINI_API_KEY", "PRIVATE_TEST_KEY");
    console.log = (line: unknown) => lines.push(String(line));
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      return Promise.resolve(
        calls === 1
          ? new Response("PRIVATE_PROVIDER_BODY", { status: 429 })
          : Response.json({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    intent: "unknown",
                    movements: [],
                    clarification: "Indicar operación",
                  }),
                }],
              },
            }],
          }),
      );
    }) as typeof fetch;
    const result = await extractFromGemini({
      text: "PRIVATE_FINANCIAL_TEXT",
      activeDraftContext: "PRIVATE_DRAFT",
    });
    assert(
      result.intent === "unknown" && calls === 2,
      "No utilizó el respaldo",
    );
    const entries = lines.map((line) => JSON.parse(line));
    assert(
      entries[0].reason === "rate_limit" && entries[0].status === 429 &&
        entries[0].model === "flash_lite",
      "Falta motivo permitido del primer modelo",
    );
    assert(
      entries[1].result === "success" && entries[1].model === "flash",
      "Falta resultado del respaldo",
    );
    assert(!lines.join("").includes("PRIVATE"), "Se filtró contenido o clave");
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
    if (previousKey === undefined) Deno.env.delete("GEMINI_API_KEY");
    else Deno.env.set("GEMINI_API_KEY", previousKey);
  }
});

Deno.test("Gemini real: timeout y respuesta inválida quedan diferenciados sin cuerpos crudos", async () => {
  const previousFetch = globalThis.fetch,
    previousKey = Deno.env.get("GEMINI_API_KEY"),
    previousLog = console.log;
  const lines: string[] = [];
  try {
    Deno.env.set("GEMINI_API_KEY", "PRIVATE_TEST_KEY");
    console.log = (line: unknown) => lines.push(String(line));
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      if (calls === 1) throw new DOMException("PRIVATE_ERROR", "TimeoutError");
      return Promise.resolve(
        Response.json({
          candidates: [{
            content: { parts: [{ text: "PRIVATE_INVALID_JSON" }] },
          }],
        }),
      );
    }) as typeof fetch;
    let failure: unknown;
    try {
      await extractFromGemini({ text: "PRIVATE_INPUT" });
    } catch (error) {
      failure = error;
    }
    assert(
      failureMetadata(failure).reason === "invalid_response",
      "Falta diagnóstico de respuesta inválida",
    );
    const entries = lines.map((line) => JSON.parse(line));
    assert(
      entries[0].reason === "timeout" &&
        entries[1].reason === "invalid_response",
      "Se confundieron las causas",
    );
    assert(
      calls === 2 && !lines.join("").includes("PRIVATE"),
      "Llamada o log inesperado",
    );
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
    if (previousKey === undefined) Deno.env.delete("GEMINI_API_KEY");
    else Deno.env.set("GEMINI_API_KEY", previousKey);
  }
});

Deno.test("procesador real: fallo de RPC se diferencia de Gemini y no interpreta", async () => {
  const fixture = database();
  fixture.db.rpc = (() =>
    Promise.resolve({
      data: null,
      error: { message: "PRIVATE_DATABASE_ERROR" },
    })) as unknown as typeof fixture.db.rpc;
  let failure: unknown;
  try {
    await prepareMessage(
      fixture.db,
      job("Consulta sintética"),
      () => Promise.resolve(),
    );
  } catch (error) {
    failure = error;
  }
  assert(
    JSON.stringify(failureMetadata(failure)) ===
      JSON.stringify({
        reason: "database_read",
        provider: "database",
        operation: "QUEUE_DRAFT_READ",
      }),
    "Se perdió la operación interna segura",
  );
});

Deno.test("audio: 503 en ambos modelos conserva checkpoint y pide texto sin reintentar IA", async () => {
  const previousFetch = globalThis.fetch,
    previousLog = console.log,
    previousTimeout = AbortSignal.timeout;
  const key = Deno.env.get("GEMINI_API_KEY"),
    token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const logs: string[] = [];
  const models: string[] = [];
  const timeouts: number[] = [];
  try {
    Deno.env.set("GEMINI_API_KEY", "PRIVATE_KEY");
    Deno.env.set("WHATSAPP_ACCESS_TOKEN", "PRIVATE_TOKEN");
    console.log = (line: unknown) => logs.push(String(line));
    AbortSignal.timeout = ((ms: number) => {
      timeouts.push(ms);
      return new AbortController().signal;
    }) as typeof AbortSignal.timeout;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("graph.facebook.com")) {
        return Promise.resolve(
          Response.json({
            url: "https://media.example.invalid/audio",
            mime_type: "audio/ogg",
          }),
        );
      }
      if (url.includes("media.example.invalid")) {
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
      }
      models.push(url.split("/models/")[1].split(":")[0]);
      return Promise.resolve(new Response("PRIVATE_ERROR", { status: 503 }));
    }) as typeof fetch;
    const fixture = job("");
    fixture.payload = {
      id: "synthetic-audio",
      from: "synthetic-route",
      type: "audio",
      audio: { id: "PRIVATE_MEDIA" },
    };
    let checkpoint: unknown;
    const result = await prepareMessage(database().db, fixture, (value) => {
      checkpoint = value;
      return Promise.resolve();
    });
    assert(
      result.kind === "reply" && String(result.text).includes("Escribime") &&
        String(result.text).includes("Todavía no cargué"),
      "No pidió reemplazo textual",
    );
    assert(
      models.join(",") === "gemini-3.1-flash-lite,gemini-3.8-flash",
      "Orden de modelos incorrecto",
    );
    assert(
      timeouts.slice(-2).join(",") === "10000,10000",
      "Audio con timeout de texto",
    );
    assert(
      JSON.stringify(checkpoint) ===
        JSON.stringify({ intent: "request_text", movements: [] }),
      "No conserva decisión",
    );
    fixture.parsed_result = checkpoint;
    globalThis.fetch = (() => {
      throw new Error("NO_NETWORK_ON_RETRY");
    }) as typeof fetch;
    const retried = await prepareMessage(database().db, fixture, () => {
      throw new Error("NO_NEW_CHECKPOINT");
    });
    assert(
      JSON.stringify(result) === JSON.stringify(retried),
      "Reintento cambió respuesta",
    );
    const replacement = await prepareMessage(
      database().db,
      job("Gasté 123 en prueba audio"),
      () => Promise.resolve(),
    );
    assert(
      replacement.kind === "add" &&
        (replacement.items as unknown[]).length === 1,
      "Texto de reemplazo no se procesa",
    );
    assert(!logs.join("").includes("PRIVATE"), "Filtró datos del audio");
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
    AbortSignal.timeout = previousTimeout;
    if (key === undefined) Deno.env.delete("GEMINI_API_KEY");
    else Deno.env.set("GEMINI_API_KEY", key);
    if (token === undefined) Deno.env.delete("WHATSAPP_ACCESS_TOKEN");
    else Deno.env.set("WHATSAPP_ACCESS_TOKEN", token);
  }
});

Deno.test("audio ambiguo o con monto faltante pide texto sin cargar parcialmente", async () => {
  const prev = globalThis.fetch,
    key = Deno.env.get("GEMINI_API_KEY"),
    token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  try {
    Deno.env.set("GEMINI_API_KEY", "synthetic-key");
    Deno.env.set("WHATSAPP_ACCESS_TOKEN", "synthetic-token");
    for (
      const parsed of [
        {
          intent: "unknown",
          movements: [],
          clarification: "PRIVATE_CLARIFICATION",
        },
        {
          intent: "add_movements",
          movements: [{
            kind: "expense",
            description: "Completo",
            totalAmountArs: 123,
          }, {
            kind: "income",
            description: "Incompleto",
            totalAmountArs: null,
          }],
        },
      ]
    ) {
      globalThis.fetch = ((url: RequestInfo | URL) =>
        Promise.resolve(
          String(url).includes("graph.facebook.com")
            ? Response.json({
              url: "https://media.example.invalid",
              mime_type: "audio/ogg",
            })
            : String(url).includes("media.example.invalid")
            ? new Response(new Uint8Array([1]))
            : Response.json({
              candidates: [{
                content: { parts: [{ text: JSON.stringify(parsed) }] },
              }],
            }),
        )) as typeof fetch;
      const fixture = job("");
      fixture.payload = {
        id: "audio",
        from: "synthetic-route",
        type: "audio",
        audio: { id: "media" },
      };
      let saved: unknown;
      const result = await prepareMessage(database().db, fixture, (v) => {
        saved = v;
        return Promise.resolve();
      });
      assert(
        result.kind === "reply" && String(result.text).includes("Escribime"),
        "No pide texto",
      );
      assert(
        JSON.stringify(saved) ===
          JSON.stringify({ intent: "request_text", movements: [] }),
        "Se conservó una extracción parcial para guardar",
      );
      assert(
        !String(result.text).includes("PRIVATE"),
        "Repitió respuesta cruda",
      );
    }
  } finally {
    globalThis.fetch = prev;
    if (key === undefined) Deno.env.delete("GEMINI_API_KEY");
    else Deno.env.set("GEMINI_API_KEY", key);
    if (token === undefined) Deno.env.delete("WHATSAPP_ACCESS_TOKEN");
    else Deno.env.set("WHATSAPP_ACCESS_TOKEN", token);
  }
});

Deno.test("audio válido sigue creando propuesta y no se convierte en pedido de texto", async () => {
  const prev = globalThis.fetch,
    key = Deno.env.get("GEMINI_API_KEY"),
    token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  try {
    Deno.env.set("GEMINI_API_KEY", "synthetic-key");
    Deno.env.set("WHATSAPP_ACCESS_TOKEN", "synthetic-token");
    const parsed = {
      intent: "add_movements",
      movements: [{
        kind: "income",
        description: "Diseño",
        totalAmountArs: 80,
        currency: "USD",
        installments: 1,
        missingFields: [],
      }],
    };
    globalThis.fetch = ((url: RequestInfo | URL) =>
      Promise.resolve(
        String(url).includes("graph.facebook.com")
          ? Response.json({
            url: "https://media.example.invalid",
            mime_type: "audio/ogg",
          })
          : String(url).includes("media.example.invalid")
          ? new Response(new Uint8Array([1]))
          : Response.json({
            candidates: [{
              content: { parts: [{ text: JSON.stringify(parsed) }] },
            }],
          }),
      )) as typeof fetch;
    const fixture = job("");
    fixture.payload = {
      id: "audio-valid",
      from: "synthetic-route",
      type: "audio",
      audio: { id: "media" },
    };
    let saved: unknown;
    const result = await prepareMessage(database().db, fixture, (v) => {
      saved = v;
      return Promise.resolve();
    });
    assert(
      result.kind === "add" &&
        JSON.stringify(result.items) === JSON.stringify(parsed.movements),
      "Audio válido perdido",
    );
    assert(
      JSON.stringify(saved) === JSON.stringify(parsed),
      "Checkpoint alterado",
    );
  } finally {
    globalThis.fetch = prev;
    if (key === undefined) Deno.env.delete("GEMINI_API_KEY");
    else Deno.env.set("GEMINI_API_KEY", key);
    if (token === undefined) Deno.env.delete("WHATSAPP_ACCESS_TOKEN");
    else Deno.env.set("WHATSAPP_ACCESS_TOKEN", token);
  }
});
Deno.test("un fallo del checkpoint no se oculta como error de IA", async () => {
  const prev = globalThis.fetch, token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  try {
    Deno.env.set("WHATSAPP_ACCESS_TOKEN", "synthetic-token");
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("synthetic", { status: 503 }),
      )) as typeof fetch;
    const fixture = job("");
    fixture.payload = {
      id: "audio",
      from: "synthetic-route",
      type: "audio",
      audio: { id: "media" },
    };
    let error: unknown;
    try {
      await prepareMessage(database().db, fixture, () => {
        throw Error("CHECKPOINT_UNAVAILABLE");
      });
    } catch (e) {
      error = e;
    }
    assert(
      error instanceof Error && error.message === "CHECKPOINT_UNAVAILABLE",
      "Ocultó fallo de persistencia",
    );
  } finally {
    globalThis.fetch = prev;
    if (token === undefined) Deno.env.delete("WHATSAPP_ACCESS_TOKEN");
    else Deno.env.set("WHATSAPP_ACCESS_TOKEN", token);
  }
});
