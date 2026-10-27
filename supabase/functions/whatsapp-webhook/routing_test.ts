// deno-lint-ignore-file no-console -- Captura de logs para verificar ausencia de datos privados.
import {
  downloadWhatsAppMedia,
  formatDraftList,
  isVerifiedOperationalTestSender,
  resetGroqBudgetForTests,
  sendWhatsAppText,
} from "./helpers.ts";
import { LIMITS } from "./limits.ts";
import { failureMetadata } from "./failures.ts";
import { extractFromGemini } from "./helpers.ts";
import { prepareMessage } from "./processor.ts";
import { parseDeterministicMovements } from "./helpers.ts";
import { normalizeWhisperTranscript } from "./groq.ts";
import type { Job } from "./queue.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
// Comprobar por separado el contrato de negocio y su nuevo diagnóstico interno.
function checkpointBusiness(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(checkpointBusiness);
  if (value && typeof value === "object") {
    const { operationalFailure: _diagnostic, ...business } = value as Record<
      string,
      unknown
    >;
    void _diagnostic;
    return business;
  }
  return value;
}
const semanticJson = (value: unknown): string =>
  JSON.stringify(
    value,
    (_key, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
        : v,
  );
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
        gte: () => chain,
        lt: () => Promise.resolve({ data: [], error: null }),
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
      JSON.stringify(checkpoints).includes('"reason":"authentication"') &&
        JSON.stringify(checkpoints).includes('"status":403'),
      "No conservó el diagnóstico seguro de descarga",
    );
    assert(
      calls === 1 &&
        JSON.stringify(checkpointBusiness(checkpoints)) ===
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
      JSON.stringify(checkpointBusiness(checkpoint)) ===
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

Deno.test("audio: ruido pide texto y operaciones incompletas se conservan junto a completas", async () => {
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
      if (parsed.intent === "add_movements") {
        const items = result.items as Array<
          { totalAmountArs: number | null; missingFields: string[] }
        >;
        assert(
          result.kind === "add" && items.length === 2 &&
            items[0].totalAmountArs === 123 &&
            items[1].totalAmountArs === null &&
            items[1].missingFields.includes("amount"),
          "Perdió el completo o el incompleto",
        );
        assert(
          (saved as { movements: unknown[] }).movements.length === 2,
          "Checkpoint perdió operaciones",
        );
        continue;
      }
      assert(
        result.kind === "reply" && String(result.text).includes("Escribime"),
        "No pide texto",
      );
      assert(
        JSON.stringify(checkpointBusiness(saved)) ===
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
        occurredOn: "2026-10-26",
        category: "Otros",
        confidence: 0,
        firstInstallmentMonth: null,
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
        semanticJson(result.items) === semanticJson(parsed.movements),
      "Audio válido perdido",
    );
    assert(
      semanticJson(checkpointBusiness(saved)) === semanticJson(parsed),
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

// Todas las solicitudes se sustituyen; no envía audios ni mensajes reales.
async function withMediaFixture(work: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const names = [
    "GEMINI_API_KEY",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
  ] as const;
  const previous = names.map((name) => Deno.env.get(name));
  try {
    for (const name of names) Deno.env.set(name, "synthetic-fixture");
    await work();
  } finally {
    globalThis.fetch = previousFetch;
    names.forEach((name, index) => {
      if (previous[index] === undefined) Deno.env.delete(name);
      else Deno.env.set(name, previous[index]!);
    });
  }
}
Deno.test("multimedia: tamaño declarado excesivo pide texto sin descargar ni invocar IA", () =>
  withMediaFixture(async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      return Promise.resolve(
        Response.json({
          url: "https://media.example.invalid",
          mime_type: "image/jpeg",
          file_size: LIMITS.imageBytes + 1,
        }),
      );
    }) as typeof fetch;
    const fixture = job("");
    fixture.payload = {
      id: "synthetic-image",
      from: "synthetic-route",
      type: "image",
      image: { id: "media" },
    };
    let checkpoint: unknown;
    const action = await prepareMessage(database().db, fixture, (v) => {
      checkpoint = v;
      return Promise.resolve();
    });
    assert(
      calls === 1 && action.kind === "reply" &&
        String(action.text).includes("5 MiB"),
      "No cortó antes de descargar",
    );
    assert(
      JSON.stringify(checkpointBusiness(checkpoint)) ===
        JSON.stringify({
          intent: "request_text",
          movements: [],
          requestTextReason: "size",
        }),
      "Perdió estado de tamaño",
    );
  }));
Deno.test("multimedia: tamaño declarado falso no evade límite de bytes ni deja altas parciales", () =>
  withMediaFixture(async () => {
    let calls = 0, cancelled = false;
    globalThis.fetch = (() => {
      calls++;
      return Promise.resolve(
        calls === 1
          ? Response.json({
            url: "https://media.example.invalid",
            mime_type: "image/jpeg",
            file_size: 1,
          })
          : new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(LIMITS.imageBytes));
                controller.enqueue(new Uint8Array(1));
              },
              cancel() {
                cancelled = true;
              },
            }),
            {
              headers: { "content-type": "image/jpeg", "content-length": "1" },
            },
          ),
      );
    }) as typeof fetch;
    const fixture = job("");
    fixture.payload = {
      id: "synthetic-image",
      from: "synthetic-route",
      type: "image",
      image: { id: "media" },
    };
    let checkpoint: unknown;
    const action = await prepareMessage(database().db, fixture, (v) => {
      checkpoint = v;
      return Promise.resolve();
    });
    assert(
      calls === 2 && cancelled && action.kind === "reply",
      "No canceló descarga sobredimensionada",
    );
    assert(
      (checkpoint as { requestTextReason?: string }).requestTextReason ===
        "size",
      "No conservó pedido de texto",
    );
  }));
Deno.test("multimedia: tipo incorrecto se rechaza antes de descargar", () =>
  withMediaFixture(async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      return Promise.resolve(
        Response.json({
          url: "https://media.example.invalid",
          mime_type: "image/jpeg",
        }),
      );
    }) as typeof fetch;
    let failure: unknown;
    try {
      await downloadWhatsAppMedia("synthetic-media", "audio");
    } catch (e) {
      failure = e;
    }
    assert(
      calls === 1 && failureMetadata(failure).reason === "unsupported_media",
      "Aceptó imagen como audio",
    );
  }));
Deno.test("multimedia: descarga válida comparte presupuesto y mantiene contenido y MIME", () =>
  withMediaFixture(async () => {
    const signals: AbortSignal[] = [];
    globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init!.signal!);
      return Promise.resolve(
        signals.length === 1
          ? Response.json({
            url: "https://media.example.invalid",
            mime_type: "audio/ogg; codecs=opus",
            file_size: 3,
          })
          : new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": "audio/ogg" },
          }),
      );
    }) as typeof fetch;
    const media = await downloadWhatsAppMedia("synthetic-media", "audio");
    assert(
      media.base64 === "AQID" && media.mimeType === "audio/ogg",
      "Alteró el audio",
    );
    assert(
      signals.length === 2 && signals[0] === signals[1],
      "Reinició el timeout entre metadata y archivo",
    );
  }));
Deno.test("multimedia: aborta cuerpo lento y cancela su lectura", () =>
  withMediaFixture(async () => {
    const controller = new AbortController();
    let calls = 0, cancelled = false;
    globalThis.fetch = (() => {
      calls++;
      return Promise.resolve(
        calls === 1
          ? Response.json({
            url: "https://media.example.invalid",
            mime_type: "audio/ogg",
          })
          : new Response(
            new ReadableStream<Uint8Array>({
              pull() {
                setTimeout(
                  () =>
                    controller.abort(
                      new DOMException("synthetic", "TimeoutError"),
                    ),
                  0,
                );
                return new Promise(() => {});
              },
              cancel() {
                cancelled = true;
              },
            }),
          ),
      );
    }) as typeof fetch;
    let failure: unknown;
    try {
      await downloadWhatsAppMedia("media", "audio", controller.signal);
    } catch (e) {
      failure = e;
    }
    assert(
      failureMetadata(failure).reason === "timeout" && cancelled,
      "No interrumpió/canceló el cuerpo lento",
    );
  }));
Deno.test("interpretación: presupuesto agotado evita segundo modelo y conserva pedido de texto", () =>
  withMediaFixture(async () => {
    const controller = new AbortController();
    let calls = 0;
    globalThis.fetch = ((url: RequestInfo | URL) => {
      if (String(url).includes("graph.facebook.com")) {
        return Promise.resolve(
          Response.json({
            url: "https://media.example.invalid",
            mime_type: "audio/ogg",
          }),
        );
      }
      if (String(url).includes("media.example.invalid")) {
        return Promise.resolve(new Response(new Uint8Array([1])));
      }
      calls++;
      controller.abort(new DOMException("synthetic", "TimeoutError"));
      return Promise.resolve(new Response("synthetic", { status: 503 }));
    }) as typeof fetch;
    // El padre simula el presupuesto global agotado: el checkpoint no se escribe tarde.
    const fixture = job("");
    fixture.payload = {
      id: "audio",
      from: "synthetic-route",
      type: "audio",
      audio: { id: "media" },
    };
    let checkpoints = 0, failure: unknown;
    try {
      await prepareMessage(database().db, fixture, () => {
        checkpoints++;
        return Promise.resolve();
      }, controller.signal);
    } catch (e) {
      failure = e;
    }
    assert(
      calls === 1 && checkpoints === 0 && failure instanceof DOMException,
      "Inició respaldo o checkpoint fuera de presupuesto",
    );
  }));
Deno.test("envío: variante argentina comparte timeout y nunca registra el cuerpo del proveedor", () =>
  withMediaFixture(async () => {
    const signals: AbortSignal[] = [];
    let calls = 0;
    globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      signals.push(init!.signal!);
      return Promise.resolve(
        calls === 1
          ? Response.json({ error: { message: "PRIVATE_PROVIDER_BODY" } }, {
            status: 400,
          })
          : Response.json({ messages: [{ id: "PRIVATE_RESPONSE_ID" }] }),
      );
    }) as typeof fetch;
    await sendWhatsAppText("5491111111111", "synthetic");
    assert(
      calls === 2 && signals[0] === signals[1],
      "Reinició presupuesto de envío",
    );
  }));
Deno.test("envío: timeout no dispara un segundo envío argentino", () =>
  withMediaFixture(async () => {
    const controller = new AbortController();
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      controller.abort(new DOMException("synthetic", "TimeoutError"));
      return new Promise(() => {});
    }) as typeof fetch;
    let failure: unknown;
    try {
      await sendWhatsAppText("5491111111111", "synthetic", controller.signal);
    } catch (e) {
      failure = e;
    }
    assert(
      calls === 1 && failureMetadata(failure).provider === "meta_send" &&
        failureMetadata(failure).reason === "timeout",
      "Repitió envío agotado",
    );
  }));

Deno.test("interpretación: límite propio de 30 s conserva pedido de texto con presupuesto de trabajo vigente", () =>
  withMediaFixture(async () => {
    const controller = new AbortController(),
      previousTimeout = AbortSignal.timeout;
    let calls = 0;
    try {
      AbortSignal.timeout = ((ms: number) =>
        ms === LIMITS.interpretationMs
          ? controller.signal
          : previousTimeout(ms)) as typeof AbortSignal.timeout;
      globalThis.fetch = ((url: RequestInfo | URL) => {
        if (String(url).includes("graph.facebook.com")) {
          return Promise.resolve(
            Response.json({
              url: "https://media.example.invalid",
              mime_type: "audio/ogg",
            }),
          );
        }
        if (String(url).includes("media.example.invalid")) {
          return Promise.resolve(new Response(new Uint8Array([1])));
        }
        calls++;
        controller.abort(
          new DOMException("synthetic-interpretation-timeout", "TimeoutError"),
        );
        return Promise.resolve(new Response("synthetic", { status: 503 }));
      }) as typeof fetch;
      const fixture = job("");
      fixture.payload = {
        id: "audio",
        from: "synthetic-route",
        type: "audio",
        audio: { id: "media" },
      };
      let checkpoint: unknown;
      const result = await prepareMessage(database().db, fixture, (v) => {
        checkpoint = v;
        return Promise.resolve();
      }, new AbortController().signal);
      assert(
        calls === 1 && result.kind === "reply" &&
          (checkpoint as { intent?: string }).intent === "request_text",
        "No pidió texto tras el límite de interpretación",
      );
    } finally {
      AbortSignal.timeout = previousTimeout;
    }
  }));

Deno.test("reglas locales reales: cero llamadas a proveedores para comandos, correcciones y lotes", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (() => {
      calls++;
      throw new Error("NO_PROVIDER_EXPECTED");
    }) as typeof fetch;
    for (
      const [body, kind] of [
        ["¡Sí!", "confirm"],
        ["cancelar todo", "cancel"],
        ["ver la lista", "summary"],
        ["retomar", "resume"],
        ["descartar", "discard"],
        ["hola", "reply"],
        ["ayuda", "reply"],
        ["sacame el movimiento 2", "remove"],
        ["Quitá el 2 y el 3", "reply"],
        ["Cambiá la descripción del 2", "reply"],
        ["El 2 fue de 250", "edit"],
        ["Gasté 250,50 en pan y leche y 4000 de nafta", "add"],
        [
          "Cobré 100 USD por diseño; pagué silla total 12000 en 3 cuotas",
          "add",
        ],
        ["Ayer gasté 100 en super", "add"],
        [
          Array.from({ length: 21 }, (_, n) => `Gasté ${n + 1} en super`).join(
            "\n",
          ),
          "reply",
        ],
      ]
    ) {
      let checkpoints = 0;
      const result = await prepareMessage(database().db, job(body), () => {
        checkpoints++;
        return Promise.resolve();
      });
      assert(
        result.kind === kind,
        `Ruta inesperada para caso sintético ${kind}`,
      );
      assert(
        checkpoints === (kind === "add" || body.includes("\n") ? 1 : 0),
        "Checkpoint no esperado",
      );
    }
    assert(calls === 0, "Una regla local consumió IA o descargó medios");
    for (const body of ["hola", "Gasté 100 super", "si", "El 2 fue de 250"]) {
      const action = await prepareMessage(
        database(true).db,
        job(body),
        () => Promise.resolve(),
      );
      assert(
        action.kind === "reply" && action.clear_summary === true &&
          String(action.text).includes("pausa"),
        "Regla local omitió el bloqueo",
      );
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

Deno.test("texto ambiguo usa el respaldo, sin aceptar el primer importe localmente", async () => {
  const prev = globalThis.fetch, key = Deno.env.get("GEMINI_API_KEY");
  const previousLog = console.log;
  try {
    Deno.env.set("GEMINI_API_KEY", "synthetic-key");
    console.log = () => {};
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      return Promise.resolve(
        Response.json({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({ intent: "unknown", movements: [] }),
              }],
            },
          }],
        }),
      );
    }) as typeof fetch;
    for (
      const body of [
        "¿Gasté 5000 en super?",
        "Compré silla 12000 en 3 cuotas",
      ]
    ) {
      const before = calls;
      const action = await prepareMessage(
        database().db,
        job(body),
        () => Promise.resolve(),
      );
      assert(
        action.kind === "reply" && calls === before + 1,
        "Mensaje ambiguo aceptado como alta local",
      );
    }
  } finally {
    globalThis.fetch = prev;
    console.log = previousLog;
    if (key === undefined) Deno.env.delete("GEMINI_API_KEY");
    else Deno.env.set("GEMINI_API_KEY", key);
  }
});

Deno.test("caption de imagen no ejecuta un comando local ni omite el comprobante", () =>
  withMediaFixture(async () => {
    const previousLog = console.log;
    try {
      console.log = () => {};
      let calls = 0;
      globalThis.fetch = (() => {
        calls++;
        return Promise.resolve(new Response("synthetic", { status: 503 }));
      }) as typeof fetch;
      const input = job("");
      input.payload = {
        id: "synthetic-image",
        from: "synthetic-route",
        type: "image",
        image: { id: "synthetic-media", caption: "confirmar" },
      };
      const action = await prepareMessage(
        database().db,
        input,
        () => Promise.resolve(),
      );
      assert(
        action.kind === "reply" && String(action.text).includes("imagen") &&
          calls === 1,
        "Caption confirmó movimientos sin procesar la imagen",
      );
    } finally {
      console.log = previousLog;
    }
  }));

Deno.test("error de IA no activa un parser permisivo para preguntas o instrucciones", async () => {
  const prev = globalThis.fetch,
    key = Deno.env.get("GEMINI_API_KEY"),
    previousLog = console.log;
  try {
    Deno.env.set("GEMINI_API_KEY", "synthetic-key");
    console.log = () => {};
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      return Promise.resolve(new Response("synthetic", { status: 503 }));
    }) as typeof fetch;
    for (
      const text of [
        "¿Gasté 5000 super?",
        "El 2 fue de 250",
        "Gasté 5000 super y pagué alquiler",
      ]
    ) {
      let failure: unknown;
      try {
        await extractFromGemini({ text });
      } catch (error) {
        failure = error;
      }
      assert(
        failureMetadata(failure).reason === "unavailable",
        "Respaldo convirtió una duda en movimiento",
      );
    }
    assert(calls === 6, "No simuló ambos modelos para cada rechazo");
  } finally {
    globalThis.fetch = prev;
    console.log = previousLog;
    if (key === undefined) Deno.env.delete("GEMINI_API_KEY");
    else Deno.env.set("GEMINI_API_KEY", key);
  }
});

Deno.test("Groq audio: Whisper transcribe y reglas locales resuelven sin invocar Qwen", async () => {
  const prev = globalThis.fetch,
    groqKey = Deno.env.get("GROQ_API_KEY"),
    token = Deno.env.get("WHATSAPP_ACCESS_TOKEN"),
    previousLog = console.log;
  const logs: string[] = [];
  try {
    resetGroqBudgetForTests();
    Deno.env.set("GROQ_API_KEY", "gsk_synthetic_test_key_123456");
    Deno.env.set("WHATSAPP_ACCESS_TOKEN", "synthetic-token");
    console.log = (line: unknown) => logs.push(String(line));
    const endpoints: string[] = [];
    globalThis.fetch = ((url: RequestInfo | URL) => {
      const target = String(url);
      endpoints.push(target);
      if (target.includes("graph.facebook.com")) {
        return Promise.resolve(
          Response.json({
            url: "https://media.example.invalid/audio",
            mime_type: "audio/ogg",
          }),
        );
      }
      if (target.includes("media.example.invalid")) {
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
      }
      if (target.includes("audio/transcriptions")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              text:
                "Gasté dos mil quinientos en panadería y me ingresó 70,000 de transferencia",
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
                "x-ratelimit-remaining-requests": "1999",
              },
            },
          ),
        );
      }
      throw new Error("UNEXPECTED_QWEN_CALL");
    }) as typeof fetch;
    const fixture = job("");
    fixture.payload = {
      id: "audio-groq-local",
      from: "synthetic-route",
      type: "audio",
      audio: { id: "media" },
    };
    const result = await prepareMessage(
      database().db,
      fixture,
      () => Promise.resolve(),
    );
    assert(
      result.kind === "add" && (result.items as unknown[]).length === 2,
      "Audio claro con Whisper no generó las dos operaciones por reglas locales",
    );
    assert(
      !endpoints.some((u) => u.includes("chat/completions")),
      "Invocó Qwen innecesariamente para un audio claro",
    );
    const parsedLogs = logs.map((l) => JSON.parse(l));
    assert(
      parsedLogs.some((e) =>
        e.event === "ai_attempt" && e.provider === "groq" &&
        e.model === "whisper" && e.result === "success"
      ) &&
        parsedLogs.some((e) =>
          e.event === "local_rule" && e.rule === "movements" &&
          e.operations === 2
        ),
      "No registró métricas de Whisper + local_rule",
    );
  } finally {
    resetGroqBudgetForTests();
    globalThis.fetch = prev;
    console.log = previousLog;
    if (groqKey === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", groqKey);
    if (token === undefined) Deno.env.delete("WHATSAPP_ACCESS_TOKEN");
    else Deno.env.set("WHATSAPP_ACCESS_TOKEN", token);
  }
});

Deno.test("Groq imagen y presupuesto: adapta edit=null, preserva USD y bloquea ante 429 largo", async () => {
  const prev = globalThis.fetch,
    groqKey = Deno.env.get("GROQ_API_KEY"),
    gemKey = Deno.env.get("GEMINI_API_KEY"),
    previousLog = console.log;
  const logs: string[] = [];
  try {
    resetGroqBudgetForTests();
    Deno.env.set("GROQ_API_KEY", "gsk_synthetic_test_key_123456");
    Deno.env.delete("GEMINI_API_KEY");
    console.log = (line: unknown) => logs.push(String(line));
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      if (calls === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{
                message: {
                  content: JSON.stringify({
                    intent: "add_movements",
                    movements: [{
                      kind: "income",
                      description: "Cobré diseño",
                      totalAmountArs: 100,
                      currency: "USD",
                      occurredOn: null,
                      category: null,
                      installments: 1,
                      firstInstallmentMonth: null,
                      confidence: 0.95,
                      missingFields: [],
                    }],
                    edit: null,
                    removePosition: null,
                    clarification: null,
                  }),
                },
              }],
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
                "x-ratelimit-remaining-tokens": "6500",
                "x-ratelimit-remaining-requests": "999",
              },
            },
          ),
        );
      }
      return Promise.resolve(
        new Response("PRIVATE_RATE_LIMIT_BODY", {
          status: 429,
          headers: { "retry-after": "15" },
        }),
      );
    }) as typeof fetch;

    const ok = await extractFromGemini({
      mediaBase64: "AQID",
      mimeType: "image/png",
    });
    assert(
      ok.intent === "add_movements" &&
        ok.edit === undefined &&
        ok.movements[0].totalAmountArs === 100 &&
        ok.movements[0].currency === "USD" &&
        ok.movements[0].category === "Otros" &&
        typeof ok.movements[0].occurredOn === "string",
      "No normalizó edit=null, USD o defaults de Qwen",
    );

    let first429: unknown;
    try {
      await extractFromGemini({ text: "¿Gasté 5000 en super?" });
    } catch (e) {
      first429 = e;
    }
    assert(
      failureMetadata(first429).provider === "groq" &&
        failureMetadata(first429).reason === "rate_limit" &&
        calls === 2,
      "No clasificó 429 de Groq",
    );

    let second429: unknown;
    try {
      await extractFromGemini({ text: "¿Gasté 6000 en super?" });
    } catch (e) {
      second429 = e;
    }
    assert(
      failureMetadata(second429).reason === "rate_limit" && calls === 2,
      "No respetó la ventana de enfriamiento compartida sin hacer red",
    );
    assert(
      !logs.join("").includes("PRIVATE") && !logs.join("").includes("gsk_"),
      "Se filtró clave o cuerpo de Groq",
    );
  } finally {
    resetGroqBudgetForTests();
    globalThis.fetch = prev;
    console.log = previousLog;
    if (groqKey === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", groqKey);
    if (gemKey === undefined) Deno.env.delete("GEMINI_API_KEY");
    else Deno.env.set("GEMINI_API_KEY", gemKey);
  }
});

Deno.test("UTF-8 y normalización de montos hablados de Whisper", async () => {
  for (
    const [input, expectedAmount, expectedKind] of [
      ["Gasté dos mil quinientos en panadería", 2500, "expense"],
      ["Gasté 2000 quinientos en panadería", 2500, "expense"],
      ["Gasté 2 mil quinientos en panadería", 2500, "expense"],
      ["Gasté 2,500 en panadería", 2500, "expense"],
      ["Gasté 2 mil 500 en panadería", 2500, "expense"],
      ["Gasté 2000 quinientos cincuenta en panadería", 2550, "expense"],
      ["Me ingresó 70 mil de una transferencia", 70000, "income"],
      ["Me ingresó setenta mil de una transferencia", 70000, "income"],
    ] as const
  ) {
    const normalized = normalizeWhisperTranscript(input);
    const items = parseDeterministicMovements(normalized, "2026-10-20");
    assert(
      items?.length === 1 &&
        items[0].totalAmountArs === expectedAmount &&
        items[0].kind === expectedKind,
      `No normalizó correctamente: ${input} -> ${normalized}`,
    );
  }
  const prev = globalThis.fetch,
    groqKey = Deno.env.get("GROQ_API_KEY");
  try {
    resetGroqBudgetForTests();
    Deno.env.set("GROQ_API_KEY", "gsk_synthetic_test_key_123456");
    globalThis.fetch = ((url: RequestInfo | URL) => {
      if (String(url).includes("audio/transcriptions")) {
        return Promise.resolve(
          Response.json({ text: "El 2 fue de 6,500" }),
        );
      }
      throw new Error("UNEXPECTED_QWEN_ON_AUDIO_CORRECTION");
    }) as typeof fetch;
    const edited = await extractFromGemini({
      mediaBase64: "AQID",
      mimeType: "audio/ogg",
    });
    assert(
      edited.intent === "edit_item" &&
        edited.edit?.targetPosition === 2 &&
        edited.edit?.amount === 6500,
      "Audio de corrección no se resolvió localmente tras Whisper",
    );
  } finally {
    resetGroqBudgetForTests();
    globalThis.fetch = prev;
    if (groqKey === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", groqKey);
  }
  const summary = formatDraftList([
    {
      position: 1,
      kind: "expense",
      description: "Panadería",
      amount: 2500,
      currency: "ARS",
      status: "pending",
    },
  ]);
  assert(
    summary.includes("Tenés 1 movimiento") &&
      summary.includes("1. 🔴 Panadería ·") &&
      summary.includes("Podés seguir agregando") &&
      summary.includes('("quitá el 2")') &&
      !summary.includes("\u00c3") &&
      !summary.includes("\u00f0\u0178"),
    "El resumen de borrador tiene caracteres UTF-8 corruptos",
  );
});

Deno.test("importes hablados: millones, centavos y centenas completas", () => {
  for (
    const [text, amount, currency] of [
      ["Gasté un millón doscientos mil en alquiler", 1200000, "ARS"],
      ["Gasté 1 millón 200 mil en alquiler", 1200000, "ARS"],
      [
        "Gasté doscientos pesos con cincuenta centavos en panadería",
        200.5,
        "ARS",
      ],
      ["Gasté cincuenta centavos en panadería", 0.5, "ARS"],
      ["Cobré cien dólares con veinticinco centavos por diseño", 100.25, "USD"],
      ["Gasté trescientos y veinte en super", 320, "ARS"],
    ] as const
  ) {
    const items = parseDeterministicMovements(
      normalizeWhisperTranscript(text),
      "2026-10-20",
    );
    assert(
      items?.length === 1 && items[0].totalAmountArs === amount &&
        items[0].currency === currency,
      `Importe incompleto en ejemplo ficticio; esperado ${amount}`,
    );
  }
});

Deno.test("audio: importes exactos y residuos ambiguos sin propuestas parciales", async () => {
  const previousFetch = globalThis.fetch, previousLog = console.log;
  const key = Deno.env.get("GROQ_API_KEY"),
    token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  try {
    Deno.env.set("GROQ_API_KEY", "gsk_synthetic_test_key_123456");
    Deno.env.set("WHATSAPP_ACCESS_TOKEN", "synthetic-token");
    console.log = () => {};
    for (
      const [transcript, expected] of [
        ["Gasté un millón doscientos mil en alquiler", 1200000],
        ["Gasté doscientos pesos con cincuenta centavos en panadería", 200.5],
        ["Gasté trescientos y veinte en super", 320],
        ["Gasté un billón doscientos mil en alquiler", null],
        ["Gasté 100 super y un billón doscientos mil en alquiler", null],
        ["Compré tornillos 10/10 por 1500", null],
        ["Gasté cien dólares canadienses en super", null],
        ["Gasté cien pesos colombianos en super", null],
        ["Gasté 100 super; cobré 50 CAD por diseño", null],
        ["Gasté 100 pesos argentinos en super", 100],
      ] as const
    ) {
      resetGroqBudgetForTests();
      let extractionCalls = 0;
      globalThis.fetch = ((url: RequestInfo | URL) => {
        const target = String(url);
        if (target.includes("graph.facebook.com")) {
          return Promise.resolve(
            Response.json({
              url: "https://media.example.invalid/audio",
              mime_type: "audio/ogg",
            }),
          );
        }
        if (target.includes("media.example.invalid")) {
          return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
        }
        if (target.includes("audio/transcriptions")) {
          return Promise.resolve(Response.json({ text: transcript }));
        }
        extractionCalls++;
        return Promise.resolve(
          Response.json({
            choices: [{
              message: {
                content: JSON.stringify({ intent: "unknown", movements: [] }),
              },
            }],
          }),
        );
      }) as typeof fetch;
      const fixture = job("");
      fixture.payload = {
        id: "synthetic-audio",
        from: "synthetic-route",
        type: "audio",
        audio: { id: "synthetic-media" },
      };
      let saved: unknown;
      const action = await prepareMessage(database().db, fixture, (value) => {
        saved = value;
        return Promise.resolve();
      });
      if (expected === null) {
        assert(
          action.kind === "reply" && extractionCalls === 1,
          "No derivó el mensaje numérico ambiguo completo",
        );
        assert(
          JSON.stringify(checkpointBusiness(saved)) ===
            JSON.stringify({ intent: "request_text", movements: [] }),
          "Conservó una propuesta parcial",
        );
      } else {
        assert(
          action.kind === "add" && extractionCalls === 0,
          "Importe claro consumió Qwen",
        );
        const items = action.items as Array<{ totalAmountArs: number }>;
        assert(
          items.length === 1 && items[0].totalAmountArs === expected,
          "Propuso un importe incompleto",
        );
      }
    }
  } finally {
    resetGroqBudgetForTests();
    globalThis.fetch = previousFetch;
    console.log = previousLog;
    if (key === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", key);
    if (token === undefined) Deno.env.delete("WHATSAPP_ACCESS_TOKEN");
    else Deno.env.set("WHATSAPP_ACCESS_TOKEN", token);
  }
});

Deno.test("avisos operativos: solo el emisor de prueba aprobado, sin red real ni POST", async () => {
  const previousFetch = globalThis.fetch;
  const names = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"];
  const previous = names.map((name) => Deno.env.get(name));
  let requests = 0;
  try {
    names.forEach((name) => Deno.env.set(name, "synthetic-fixture"));
    globalThis.fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
      requests++;
      assert(!init?.method || init.method === "GET", "No debe enviar mensajes");
      assert(
        String(url).includes("fields=display_phone_number"),
        "Campo inesperado",
      );
      return Promise.resolve(
        Response.json({ display_phone_number: "+1 555 000 0000" }),
      );
    }) as typeof fetch;
    assert(
      !await isVerifiedOperationalTestSender("5490000000000"),
      "Número normal habilitado",
    );
    assert(requests === 0, "No debe consultar números no aprobados");
    assert(
      await isVerifiedOperationalTestSender("15550000000"),
      "Número aprobado rechazado",
    );
    assert(
      !await isVerifiedOperationalTestSender("15550000001"),
      "Emisor distinto aprobado",
    );
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({ error: { message: "PRIVATE_ERROR" } }, { status: 401 }),
      )) as typeof fetch;
    let rejected = false;
    try {
      await isVerifiedOperationalTestSender("15550000000");
    } catch (error) {
      rejected = true;
      assert(
        !String(error).includes("PRIVATE_ERROR"),
        "Error privado expuesto",
      );
    }
    assert(rejected, "Error de verificación debe cerrar el envío");
  } finally {
    globalThis.fetch = previousFetch;
    names.forEach((name, i) =>
      previous[i] === undefined
        ? Deno.env.delete(name)
        : Deno.env.set(name, previous[i]!)
    );
  }
});

Deno.test("BE-04: fechas y monedas explícitas siguen sin consumir IA", async () => {
  const previousFetch = globalThis.fetch, previousLog = console.log;
  try {
    console.log = () => {};
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      throw new Error("UNEXPECTED_PROVIDER");
    }) as typeof fetch;
    const action = await prepareMessage(
      database().db,
      job(
        "Gasté 100 pesos argentinos en super el día 19/10/2026; cobré 50 dólares estadounidenses por diseño con fecha 19/10/2026",
      ),
      () => Promise.resolve(),
    );
    assert(action.kind === "add" && calls === 0, "Texto claro derivado a IA");
    const items = action.items as Array<
      {
        description: string;
        currency: string;
        occurredOn: string;
        totalAmountArs: number;
      }
    >;
    assert(
      JSON.stringify(
        items.map(
          (i) => [i.description, i.totalAmountArs, i.currency, i.occurredOn],
        ),
      ) ===
        JSON.stringify([["Super", 100, "ARS", "2026-10-19"], [
          "Diseño",
          50,
          "USD",
          "2026-10-19",
        ]]),
      "Cambió los datos explícitos",
    );
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  }
});
Deno.test("BE-04: contexto ambiguo y 503 no habilitan propuestas locales parciales", async () => {
  const previousFetch = globalThis.fetch, previousLog = console.log;
  const key = Deno.env.get("GEMINI_API_KEY"),
    groq = Deno.env.get("GROQ_API_KEY");
  try {
    Deno.env.set("GEMINI_API_KEY", "synthetic-key");
    Deno.env.delete("GROQ_API_KEY");
    console.log = () => {};
    for (const unavailable of [false, true]) {
      let calls = 0;
      globalThis.fetch = (() => {
        calls++;
        return Promise.resolve(
          unavailable
            ? new Response("synthetic", { status: 503 })
            : Response.json({
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({ intent: "unknown", movements: [] }),
                  }],
                },
              }],
            }),
        );
      }) as typeof fetch;
      for (
        const text of [
          "Compré tornillos 10/10 por 1500",
          "Gasté 100 dólares canadienses en super",
          "Gasté 100 COP en super",
          "Gasté 250 en super; cobré 100 pesos colombianos por diseño",
        ]
      ) {
        const before = calls, saved: unknown[] = [];
        const action = await prepareMessage(
          database().db,
          job(text),
          (value) => {
            saved.push(value);
            return Promise.resolve();
          },
        );
        assert(
          action.kind === "reply" &&
            String(action.text).includes("No cargué nada") &&
            calls === before + (unavailable ? 2 : 1),
          "Aceptó un alta local ambigua o ignoró el error",
        );
        assert(
          saved.length === 1 &&
            JSON.stringify(checkpointBusiness(saved[0])) ===
              JSON.stringify({ intent: "request_text", movements: [] }),
          "Conservó una parte de la lista",
        );
      }
    }
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
    if (key === undefined) Deno.env.delete("GEMINI_API_KEY");
    else Deno.env.set("GEMINI_API_KEY", key);
    if (groq === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", groq);
  }
});
for (const provider of ["gemini", "groq"] as const) {
  Deno.test(
    "BE-04: " + provider +
      " conserva identificadores numéricos después de extraer",
    async () => {
      const previousFetch = globalThis.fetch, previousLog = console.log;
      const key = Deno.env.get("GEMINI_API_KEY"),
        groq = Deno.env.get("GROQ_API_KEY");
      try {
        resetGroqBudgetForTests();
        console.log = () => {};
        Deno.env.set("GEMINI_API_KEY", "synthetic-key");
        if (provider === "groq") {
          Deno.env.set("GROQ_API_KEY", "gsk_synthetic_test_key_123456");
        } else Deno.env.delete("GROQ_API_KEY");
        const expected = ["IPhone 15", "Colectivo 60", "Ruta 9"];
        const parsed = {
          intent: "add_movements",
          movements: expected.map((description, index) => ({
            kind: "expense",
            description,
            totalAmountArs: [1200000, 500, 100][index],
            currency: "ARS",
            occurredOn: "2026-10-25",
            category: "Otros",
            installments: 1,
            firstInstallmentMonth: null,
            confidence: 0.95,
            missingFields: [],
          })),
        };
        let calls = 0;
        globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
          calls++;
          assert(
            String(init?.body).includes(
              "no los uses como monto ni como fecha",
            ) &&
              String(init?.body).includes("moneda distinta o contradictoria"),
            "Instrucción del extractor divergente",
          );
          return Promise.resolve(Response.json(
            provider === "groq"
              ? { choices: [{ message: { content: JSON.stringify(parsed) } }] }
              : {
                candidates: [{
                  content: { parts: [{ text: JSON.stringify(parsed) }] },
                }],
              },
          ));
        }) as typeof fetch;
        const action = await prepareMessage(
          database().db,
          job(
            "Compré iPhone 15 por 1200000; pagué 500 en colectivo 60; gasté 100 en Ruta 9",
          ),
          () => Promise.resolve(),
        );
        assert(
          action.kind === "add" && calls === 1,
          "No recorrió el extractor simulado",
        );
        const items = action.items as Array<
          { description: string; totalAmountArs: number }
        >;
        assert(
          JSON.stringify(items.map((i) => i.description)) ===
            JSON.stringify(expected),
          "El limpiador borró identificadores",
        );
        assert(
          JSON.stringify(items.map((i) => i.totalAmountArs)) ===
            JSON.stringify([1200000, 500, 100]),
          "El identificador reemplazó el importe",
        );
      } finally {
        resetGroqBudgetForTests();
        globalThis.fetch = previousFetch;
        console.log = previousLog;
        if (key === undefined) {
          Deno.env.delete("GEMINI_API_KEY");
        } else Deno.env.set("GEMINI_API_KEY", key);
        if (groq === undefined) Deno.env.delete("GROQ_API_KEY");
        else Deno.env.set("GROQ_API_KEY", groq);
      }
    },
  );
}

Deno.test("BE-05: propuestas con suscripción/saldo conservan importes y tipos sin IA", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = (() => {
      throw new Error("NO_PROVIDER_FOR_CLEAR_MOVEMENTS");
    }) as typeof fetch;
    const cases: Array<[string, string, number, string]> = [
      ["Suscripción Netflix 5000", "expense", 5000, "ARS"],
      ["Saldo SUBE 1500", "expense", 1500, "ARS"],
      ["Vendí 5000 por planes de diseño", "income", 5000, "ARS"],
      ["Me pagaron 5000 por planes de diseño", "income", 5000, "ARS"],
      ["Me depositaron 5000 por planes de diseño", "income", 5000, "ARS"],
      ["Me acreditaron 5000 por planes de diseño", "income", 5000, "ARS"],
      ["Suscripción Netflix 50 USD", "expense", 50, "USD"],
      ["Pagué 5000 del saldo de la tarjeta", "expense", 5000, "ARS"],
    ];
    for (const [text, kind, amount, currency] of cases) {
      const { db, reads } = database();
      let checkpoints = 0;
      const result = await prepareMessage(db, job(text), () => {
        checkpoints++;
        return Promise.resolve();
      });
      const items = result.items as Array<{
        kind: string;
        totalAmountArs: number;
        currency: string;
      }>;
      assert(
        result.kind === "add" && items.length === 1 &&
          items[0].kind === kind && items[0].totalAmountArs === amount &&
          items[0].currency === currency && checkpoints === 1,
        "El clasificador interceptó o alteró la propuesta",
      );
      assert(!reads.includes("transactions"), "Se sustituyó por saldo");
    }
  } finally {
    globalThis.fetch = previous;
  }
});
Deno.test("BE-05: mezcla y ambigüedad piden aclarar sin tocar ni reinterpretar pendientes", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = (() => {
      throw new Error("NO_PROVIDER_FOR_CLARIFICATION");
    }) as typeof fetch;
    for (
      const text of [
        "Gasté 1000 en super; pasame el alias",
        "Gasté 1000 en super y cuánto saldo me queda",
        "Pasame el alias y gasté 1000 en super",
        "Cuánto saldo me queda y cobré 5000",
        "Saldo SUBE 1500; quiero renovar mi membresía",
        "Suscripción Netflix 5000; ¿cuánto saldo me queda?",
        "Pasame el alias y cuánto saldo me queda",
        "Saldo disponible 5000",
        "Suscripción Netflix 5000 euros",
        "Suscripción Netflix 5000 y nafta sin importe",
        "¿Cuánto gasté en la suscripción de Netflix?",
        "Pasame el alias; nafta sin importe",
      ]
    ) {
      const { db, reads, draftReads } = database();
      const input = job(text);
      const result = await prepareMessage(db, input, () => {
        throw new Error("NO_EXTRACTION_CHECKPOINT");
      });
      assert(
        result.kind === "reply" && Object.keys(result).length === 2 &&
          String(result.text).includes("No agregué ni modifiqué") &&
          String(result.text).includes("RESUMEN"),
        "La aclaración creó un efecto o limpió el resumen pendiente",
      );
      assert(
        draftReads() === 0 && !reads.includes("transactions"),
        "Se interpretó o consultó saldo antes de aclarar",
      );
      const retried = await prepareMessage(db, input, () => {
        throw new Error("NO_NEW_CHECKPOINT_ON_RETRY");
      });
      assert(
        JSON.stringify(result) === JSON.stringify(retried),
        "El reintento cambió la aclaración",
      );
    }
  } finally {
    globalThis.fetch = previous;
  }
});
Deno.test("BE-05: consultas comerciales completas con cifras no usan IA ni borradores", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = (() => {
      throw new Error("NO_PROVIDER_FOR_SUPPORT");
    }) as typeof fetch;
    for (
      const text of [
        "¿Cuánto cuesta el plan de 5000?",
        "Cómo pago el plan de 5000",
        "Quiero renovar mi membresía de 5000",
        "Pasame el alias para pagar 5000",
      ]
    ) {
      const { db, reads, draftReads } = database();
      const result = await prepareMessage(db, job(text), () => {
        throw new Error("NO_SUPPORT_CHECKPOINT");
      });
      assert(
        result.kind === "reply" && String(result.text).includes("soporte"),
        "Se convirtió una consulta en operación",
      );
      assert(
        draftReads() === 0 && !reads.includes("transactions"),
        "Consulta comercial cambió de ruta",
      );
    }
  } finally {
    globalThis.fetch = previous;
  }
});
Deno.test("BE-05: saldo auténtico lee solo la cuenta y conserva ARS/USD separados", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = (() => {
      throw new Error("NO_PROVIDER_FOR_BALANCE");
    }) as typeof fetch;
    const fixture = database();
    const original = fixture.db.from.bind(fixture.db);
    const filters: Array<[string, string, unknown]> = [];
    fixture.db.from = ((table: string) => {
      if (table !== "transactions" && table !== "budgets") {
        return original(table);
      }
      const data = table === "transactions"
        ? [
          { kind: "expense", currency: "ARS", amount_ars: 125.5 },
          { kind: "income", currency: "ARS", amount_ars: 500 },
          { kind: "expense", currency: "USD", amount_ars: 10 },
          { kind: "income", currency: "USD", amount_ars: 20 },
        ]
        : { amount_ars: 1000 };
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => {
          filters.push([table, key, value]);
          return chain;
        },
        gte: () => chain,
        lt: () => Promise.resolve({ data, error: null }),
        maybeSingle: () => Promise.resolve({ data, error: null }),
      };
      return chain;
    }) as typeof fixture.db.from;
    const result = await prepareMessage(
      fixture.db,
      job("¿Cuánto dinero me queda?"),
      () => {
        throw new Error("NO_BALANCE_CHECKPOINT");
      },
    );
    const body = String(result.text);
    assert(
      result.kind === "reply" && body.includes("$ 125,5") &&
        body.includes("$ 500") && body.includes("$ 374,5") &&
        body.includes("US$ 10") && body.includes("US$ 20") &&
        body.includes("$ 874,5") && fixture.draftReads() === 0,
      "Se mezclaron monedas, pendientes o totales",
    );
    for (const table of ["transactions", "budgets"]) {
      assert(
        filters.some(([t, key, value]) =>
          t === table && key === "user_id" && value === "fixture-user"
        ),
        "Lectura de saldo sin filtro de propietario",
      );
    }
    assert(
      filters.some(([t, key, value]) =>
        t === "transactions" && key === "status" && value === "confirmed"
      ),
      "El saldo incluyó propuestas",
    );
  } finally {
    globalThis.fetch = previous;
  }
});
Deno.test("BE-05: correcciones con palabra suscripción y comandos conservan sus rutas", async () => {
  for (
    const [text, kind] of [
      ["CONFIRMAR", "confirm"],
      ["CANCELAR", "cancel"],
      ["RESUMEN", "summary"],
      ["El 2 fue de 250", "edit"],
      ["Cambiá la descripción del 2 a suscripción Netflix", "reply"],
    ]
  ) {
    const result = await prepareMessage(database().db, job(text), () => {
      throw new Error("NO_COMMAND_CHECKPOINT");
    });
    assert(result.kind === kind, "El ruteo interceptó comando/corrección");
    assert(
      !String(result.text).includes("Comunicate con soporte"),
      "Corrección desviada a soporte",
    );
  }
});
Deno.test("BE-05: cuenta suspendida se bloquea antes de la aclaración", async () => {
  const fixture = database(true);
  const result = await prepareMessage(
    fixture.db,
    job("Gasté 1000 en super; pasame el alias"),
    () => {
      throw new Error("NO_BLOCKED_CHECKPOINT");
    },
  );
  assert(
    result.kind === "reply" && result.clear_summary === true &&
      String(result.text).includes("pausa") && fixture.draftReads() === 0,
    "La aclaración eludió la suspensión",
  );
});
Deno.test("BE-05: caption de foto y audio conservan interpretación multimedia", () =>
  withMediaFixture(async () => {
    const groq = Deno.env.get("GROQ_API_KEY");
    try {
      Deno.env.delete("GROQ_API_KEY");
      for (const type of ["image", "audio"] as const) {
        let calls = 0;
        const parsed = {
          intent: "add_movements",
          movements: [{
            kind: "expense",
            description: "Suscripción Netflix",
            totalAmountArs: 5000,
            currency: "ARS",
            installments: 1,
            missingFields: [],
          }],
        };
        globalThis.fetch = ((url: RequestInfo | URL) => {
          calls++;
          return Promise.resolve(
            String(url).includes("graph.facebook.com")
              ? Response.json({
                url: "https://media.example.invalid",
                mime_type: type === "image" ? "image/jpeg" : "audio/ogg",
              })
              : String(url).includes("media.example.invalid")
              ? new Response(new Uint8Array([1]))
              : Response.json({
                candidates: [{
                  content: { parts: [{ text: JSON.stringify(parsed) }] },
                }],
              }),
          );
        }) as typeof fetch;
        const input = job("");
        input.payload = {
          id: "synthetic-media",
          from: "synthetic-route",
          type,
          ...(type === "image"
            ? {
              image: {
                id: "media",
                caption: "Pasame el alias; saldo disponible",
              },
            }
            : { audio: { id: "media" } }),
        };
        let checkpoints = 0;
        const result = await prepareMessage(database().db, input, () => {
          checkpoints++;
          return Promise.resolve();
        });
        assert(
          result.kind === "add" && calls === 3 && checkpoints === 1 &&
            (result.items as Array<{ totalAmountArs: number }>)[0]
                .totalAmountArs === 5000,
          "Caption o audio fueron interceptados por una consulta rápida",
        );
      }
    } finally {
      if (groq === undefined) Deno.env.delete("GROQ_API_KEY");
      else Deno.env.set("GROQ_API_KEY", groq);
    }
  }));

Deno.test("BE-08: lista mixta incompleta se propone entera localmente, sin IA", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = (() => {
      throw Error("NO_PROVIDER");
    }) as typeof fetch;
    let saved: unknown;
    const result = await prepareMessage(
      database().db,
      job("Gasté 101 en super y pagué alquiler"),
      (v) => {
        saved = v;
        return Promise.resolve();
      },
    );
    const items = result.items as Array<
      { totalAmountArs: number | null; missingFields: string[] }
    >;
    assert(
      result.kind === "add" && items.length === 2 &&
        items[0].totalAmountArs === 101 && items[1].totalAmountArs === null &&
        items[1].missingFields.includes("amount"),
      "Perdió una parte",
    );
    assert(
      (saved as { movements: unknown[] }).movements.length === 2,
      "Checkpoint parcial",
    );
  } finally {
    globalThis.fetch = previous;
  }
});
Deno.test("BE-08: completar por texto no agrega otro gasto ni llama a IA", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = (() => {
      throw Error("NO_PROVIDER");
    }) as typeof fetch;
    for (const multiple of [false, true]) {
      const fixture = database();
      fixture.db.rpc = (() =>
        Promise.resolve({
          data: {
            group_id: "synthetic-group",
            version: 2,
            is_stale: false,
            items: [
              {
                position: 2,
                kind: "expense",
                description: "Nafta",
                amount: null,
                status: "pending",
                missing_fields: ["amount"],
              },
              ...(multiple
                ? [{
                  position: 4,
                  kind: "income",
                  description: "Diseño",
                  amount: null,
                  status: "pending",
                  missing_fields: ["amount"],
                }]
                : []),
            ],
          },
          error: null,
        })) as unknown as typeof fixture.db.rpc;
      const result = await prepareMessage(fixture.db, job("5000"), () => {
        throw Error("NO_CHECKPOINT");
      });
      assert(
        multiple
          ? result.kind === "reply"
          : result.kind === "complete" && result.position === 2 &&
            result.version === 2,
        "Completado ambiguo o alta falsa",
      );
      const addition = await prepareMessage(
        fixture.db,
        job("Gasté 300 en farmacia"),
        () => Promise.resolve(),
      );
      assert(addition.kind === "add", "Interceptó un gasto nuevo");
    }
  } finally {
    globalThis.fetch = previous;
  }
});
for (const provider of ["gemini", "groq"] as const) {
  Deno.test(
    "BE-08: " + provider +
      " conserva completos/incompletos y reintenta desde checkpoint",
    async () => {
      const previous = globalThis.fetch,
        key = Deno.env.get("GEMINI_API_KEY"),
        groq = Deno.env.get("GROQ_API_KEY");
      try {
        resetGroqBudgetForTests();
        Deno.env.set("GEMINI_API_KEY", "synthetic-key");
        if (provider === "groq") {
          Deno.env.set("GROQ_API_KEY", "gsk_synthetic_key");
        } else Deno.env.delete("GROQ_API_KEY");
        let calls = 0;
        const parsed = {
          intent: "add_movements",
          movements: [{
            kind: "expense",
            description: "Super",
            totalAmountArs: 101,
            currency: "ARS",
            occurredOn: "2026-10-26",
            category: "Otros",
            confidence: 0,
            installments: 1,
            firstInstallmentMonth: null,
            missingFields: [] as string[],
          }, {
            kind: "income",
            description: "Diseño",
            totalAmountArs: null,
            currency: "USD",
            occurredOn: null,
            category: "Otros",
            confidence: 0,
            installments: 1,
            firstInstallmentMonth: null,
            missingFields: ["amount", "date"],
          }],
          clarification: "PRIVATE_QUESTION",
        };
        globalThis.fetch = (() => {
          calls++;
          return Promise.resolve(
            Response.json(
              provider === "groq"
                ? {
                  choices: [{ message: { content: JSON.stringify(parsed) } }],
                }
                : {
                  candidates: [{
                    content: { parts: [{ text: JSON.stringify(parsed) }] },
                  }],
                },
            ),
          );
        }) as typeof fetch;
        const input = job(
          "Hay operaciones para interpretar en un mensaje complejo",
        );
        let checkpoint: unknown;
        const result = await prepareMessage(database().db, input, (v) => {
          checkpoint = v;
          return Promise.resolve();
        });
        const items = result.items as Array<
          {
            totalAmountArs: number | null;
            occurredOn: string | null;
            confidence: number;
            missingFields: string[];
            clarification?: string;
          }
        >;
        assert(
          result.kind === "add" && items.length === 2 &&
            items[0].totalAmountArs === 101 && items[0].confidence === 0 &&
            items[1].totalAmountArs === null && items[1].occurredOn === null &&
            items[1].missingFields.includes("date"),
          "Filtró o completó artificialmente",
        );
        assert(
          items[1].clarification === "PRIVATE_QUESTION" && calls === 1,
          "No conservó la duda o repitió IA",
        );
        const mockProvider = globalThis.fetch;
        input.parsed_result = checkpoint;
        globalThis.fetch = (() => {
          throw Error("NO_PROVIDER_RETRY");
        }) as typeof fetch;
        const retry = await prepareMessage(database().db, input, () => {
          throw Error("NO_NEW_CHECKPOINT");
        });
        assert(
          semanticJson(result) === semanticJson(retry),
          "El reintento cambió datos",
        );
        // Una duda de categoría no debe reaparecer al validar/checkpointear otra vez.
        parsed.movements = [{
          ...parsed.movements[0],
          missingFields: ["category"],
        }];
        parsed.clarification = "¿Qué categoría?";
        globalThis.fetch = mockProvider;
        const categoryResult = await prepareMessage(
          database().db,
          job("Operación compleja sintética"),
          () => Promise.resolve(),
        );
        const categoryItems = categoryResult.items as Array<
          { missingFields: string[]; clarification?: string }
        >;
        assert(
          categoryResult.kind === "add" &&
            categoryItems[0].missingFields.length === 0 &&
            !categoryItems[0].clarification,
          "Una categoría opcional volvió a bloquear el lote",
        );
      } finally {
        globalThis.fetch = previous;
        if (key === undefined) Deno.env.delete("GEMINI_API_KEY");
        else Deno.env.set("GEMINI_API_KEY", key);
        if (groq === undefined) Deno.env.delete("GROQ_API_KEY");
        else Deno.env.set("GROQ_API_KEY", groq);
      }
    },
  );
}
Deno.test("BE-08: Whisper completa un importe pendiente sin Qwen ni otro gasto", () =>
  withMediaFixture(async () => {
    const key = Deno.env.get("GROQ_API_KEY");
    try {
      resetGroqBudgetForTests();
      Deno.env.set("GROQ_API_KEY", "gsk_synthetic_key");
      let calls = 0;
      globalThis.fetch = ((url: RequestInfo | URL) => {
        calls++;
        const u = String(url);
        return Promise.resolve(
          u.includes("graph.facebook.com")
            ? Response.json({
              url: "https://media.example.invalid",
              mime_type: "audio/ogg",
            })
            : u.includes("media.example.invalid")
            ? new Response(new Uint8Array([1]))
            : u.includes("/audio/transcriptions")
            ? Response.json({ text: "El 2 fue de 5000" })
            : new Response("UNEXPECTED_PROVIDER", { status: 503 }),
        );
      }) as typeof fetch;
      const fixture = database();
      fixture.db.rpc = (() =>
        Promise.resolve({
          data: {
            group_id: "synthetic-group",
            version: 2,
            items: [{
              position: 2,
              kind: "expense",
              description: "Nafta",
              amount: null,
              status: "pending",
              missing_fields: ["amount"],
            }],
          },
          error: null,
        })) as unknown as typeof fixture.db.rpc;
      const input = job("");
      input.payload = {
        id: "synthetic-audio",
        from: "synthetic-route",
        type: "audio",
        audio: { id: "media" },
      };
      let saved: unknown;
      const result = await prepareMessage(fixture.db, input, (v) => {
        saved = v;
        return Promise.resolve();
      });
      assert(
        result.kind === "complete" && result.position === 2 && calls === 3 &&
          (saved as { intent: string }).intent === "complete_item",
        "No completó con la transcripción o llamó a otro modelo",
      );
    } finally {
      if (key === undefined) Deno.env.delete("GROQ_API_KEY");
      else Deno.env.set("GROQ_API_KEY", key);
    }
  }));
Deno.test("BE-08: un proveedor no puede fabricar una intención interna de completado", async () => {
  const previous = globalThis.fetch,
    key = Deno.env.get("GEMINI_API_KEY"),
    groq = Deno.env.get("GROQ_API_KEY");
  try {
    Deno.env.set("GEMINI_API_KEY", "synthetic-key");
    Deno.env.delete("GROQ_API_KEY");
    globalThis.fetch = (() =>
      Promise.resolve(Response.json({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                intent: "complete_item",
                movements: [],
                completion: {
                  kind: "complete",
                  position: 1,
                  group_id: "invented",
                  version: 1,
                  patch: { amount: 5000 },
                },
              }),
            }],
          },
        }],
      }))) as typeof fetch;
    const result = await prepareMessage(
      database().db,
      job("Algo para interpretar"),
      () => Promise.resolve(),
    );
    assert(
      result.kind === "reply" && String(result.text).includes("No cargué"),
      "El proveedor obtuvo un atajo de escritura",
    );
  } finally {
    globalThis.fetch = previous;
    if (key === undefined) Deno.env.delete("GEMINI_API_KEY");
    else Deno.env.set("GEMINI_API_KEY", key);
    if (groq === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", groq);
  }
});

// INF-15: agotamiento de cuota/configuración doble sin cambiar a otro proveedor.
for (const status of [429, 503]) {
  Deno.test(
    "INF-15: Groq " + status + " pide texto una vez sin recurrir a Gemini",
    async () => {
      const previousFetch = globalThis.fetch;
      const groq = Deno.env.get("GROQ_API_KEY"),
        gemini = Deno.env.get("GEMINI_API_KEY");
      try {
        resetGroqBudgetForTests();
        Deno.env.set("GROQ_API_KEY", "gsk_synthetic_cost_review");
        Deno.env.set("GEMINI_API_KEY", "synthetic_gemini_cost_review");
        const requests: string[] = [];
        globalThis.fetch = ((url: RequestInfo | URL) => {
          requests.push(String(url));
          assert(
            String(url) === "https://api.groq.com/openai/v1/chat/completions",
            "Cambió de proveedor al fallar Groq",
          );
          return Promise.resolve(
            new Response("PRIVATE_QUOTA_ERROR", {
              status,
              headers: { "retry-after": "60" },
            }),
          );
        }) as typeof fetch;
        const input = job("¿Gasté 5000 en farmacia?");
        let saved: unknown;
        const first = await prepareMessage(database().db, input, (value) => {
          saved = value;
          return Promise.resolve();
        });
        assert(
          first.kind === "reply" &&
            String(first.text).includes("No cargué nada"),
          "No aclaró que el mensaje no se cargó",
        );
        assert(
          (saved as { intent?: string })?.intent === "request_text",
          "No conservó el checkpoint",
        );
        input.parsed_result = saved;
        globalThis.fetch = (() => {
          throw new Error("No debe repetir IA al recuperar el checkpoint");
        }) as typeof fetch;
        const retry = await prepareMessage(database().db, input, () => {
          throw new Error("Checkpoint repetido");
        });
        assert(
          semanticJson(first) === semanticJson(retry) && requests.length === 1,
          "El reintento cambió la respuesta o consumió cuota otra vez",
        );
      } finally {
        resetGroqBudgetForTests();
        globalThis.fetch = previousFetch;
        if (groq === undefined) Deno.env.delete("GROQ_API_KEY");
        else Deno.env.set("GROQ_API_KEY", groq);
        if (gemini === undefined) Deno.env.delete("GEMINI_API_KEY");
        else Deno.env.set("GEMINI_API_KEY", gemini);
      }
    },
  );
}
Deno.test("INF-15: rechazo de ventana de Meta no activa plantillas", () =>
  withMediaFixture(async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(
        Response.json({
          error: { code: 131047, message: "PRIVATE_WINDOW_ERROR" },
        }, { status: 400 }),
      );
    }) as typeof fetch;
    let failure: unknown;
    try {
      await sendWhatsAppText("5491111111111", "Solo prueba ficticia");
    } catch (error) {
      failure = error;
    }
    assert(
      failureMetadata(failure).provider === "meta_send",
      "Ocultó el rechazo de Meta",
    );
    assert(
      bodies.length === 2 &&
        bodies.every((body) =>
          body.type === "text" && !Object.hasOwn(body, "template")
        ),
      "Activó plantillas u otros envíos al rechazar el texto",
    );
    assert(
      new Set(bodies.map((body) => body.to)).size === 2,
      "Repitió una variante de destino",
    );
  }));
import { AiQuotaExceeded, createAiQuotaGate } from "./ai-quota.ts";

for (
  const body of [
    "CONFIRMAR",
    "CANCELAR",
    "RESUMEN",
    "Gasté 123 en supermercado",
    "el 2 fue de 250",
    "quitá el 2",
  ]
) {
  Deno.test("INF-15: regla local no reserva cupo: " + body, async () => {
    let reservations = 0;
    const result = await prepareMessage(
      database().db,
      job(body),
      () => Promise.resolve(),
      undefined,
      () => {
        reservations++;
        throw new AiQuotaExceeded();
      },
    );
    assert(
      reservations === 0 && result.kind !== "reply",
      "La vía local depende del cupo de IA",
    );
  });
}
Deno.test("INF-15: reserva Qwen antes de HTTP, agotamiento persistido y sin repetición", async () => {
  const oldFetch = globalThis.fetch, oldKey = Deno.env.get("GROQ_API_KEY");
  try {
    resetGroqBudgetForTests();
    Deno.env.set("GROQ_API_KEY", "gsk_synthetic_quota_key");
    let calls = 0, reserved = 0;
    globalThis.fetch = (() => {
      calls++;
      throw Error("No debe enviar HTTP");
    }) as typeof fetch;
    const input = job("¿Gasté 5000 en farmacia?");
    let saved: unknown;
    const gate = createAiQuotaGate({
      token: "synthetic-lease",
      rpc: <T>(name: string, args?: Record<string, unknown>) => {
        assert(
          name === "reserve_whatsapp_ai_quota" &&
            args?.p_token === "synthetic-lease" && args.p_id === input.id &&
            args.p_attempt === 1 && args.p_lane === "qwen",
          "Reserva sin identidad del trabajo/lease",
        );
        reserved++;
        return Promise.resolve({ allowed: false, reason: "exhausted" } as T);
      },
    }, input);
    const first = await prepareMessage(
      database().db,
      input,
      (v) => {
        saved = v;
        return Promise.resolve();
      },
      undefined,
      gate,
    );
    assert(
      first.kind === "reply" && String(first.text).includes("cupo diario") &&
        String(first.text).includes("pendientes se conservan"),
      "No dio una salida local al cliente",
    );
    assert(
      (saved as { requestTextReason: string }).requestTextReason === "quota",
      "No persistió el motivo",
    );
    input.parsed_result = saved;
    const replay = await prepareMessage(
      database().db,
      input,
      () => {
        throw Error("Checkpoint repetido");
      },
      undefined,
      gate,
    );
    assert(
      semanticJson(first) === semanticJson(replay) && calls === 0 &&
        reserved === 1,
      "Reinterpretó un mensaje agotado",
    );
  } finally {
    globalThis.fetch = oldFetch;
    resetGroqBudgetForTests();
    if (oldKey === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", oldKey);
  }
});
Deno.test("INF-15: fallo de reserva no invoca proveedor ni lo oculta como cupo agotado", async () => {
  const oldFetch = globalThis.fetch, oldKey = Deno.env.get("GROQ_API_KEY");
  try {
    resetGroqBudgetForTests();
    Deno.env.set("GROQ_API_KEY", "gsk_synthetic_quota_key");
    let calls = 0, checkpoints = 0;
    globalThis.fetch = (() => {
      calls++;
      throw Error("HTTP inesperado");
    }) as typeof fetch;
    const { OperationalFailure } = await import("./failures.ts");
    const gate = createAiQuotaGate({
      token: "synthetic",
      rpc: () => {
        throw new OperationalFailure(
          "database_read",
          "database",
          undefined,
          "QUEUE_DRAFT_READ",
        );
      },
    }, job("Complejo"));
    let failure: unknown;
    try {
      await prepareMessage(
        database().db,
        job("¿Gasté 5000 en farmacia?"),
        () => {
          checkpoints++;
          return Promise.resolve();
        },
        undefined,
        gate,
      );
    } catch (error) {
      failure = error;
    }
    assert(
      calls === 0 && checkpoints === 0 &&
        failureMetadata(failure).provider === "database",
      "Falló abierto o perdió la causa SQL",
    );
  } finally {
    globalThis.fetch = oldFetch;
    resetGroqBudgetForTests();
    if (oldKey === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", oldKey);
  }
});
Deno.test("INF-15: aborto tras reservar conserva la unidad y no envía HTTP", async () => {
  const oldFetch = globalThis.fetch, oldKey = Deno.env.get("GROQ_API_KEY");
  try {
    resetGroqBudgetForTests();
    Deno.env.set("GROQ_API_KEY", "gsk_synthetic_quota_key");
    let calls = 0, reservations = 0;
    const controller = new AbortController();
    globalThis.fetch = (() => {
      calls++;
      throw Error("HTTP inesperado");
    }) as typeof fetch;
    const gate = createAiQuotaGate({
      token: "synthetic",
      rpc: <T>() => {
        reservations++;
        controller.abort();
        return Promise.resolve({ allowed: true } as T);
      },
    }, job("Complejo"));
    try {
      await extractFromGemini({
        text: "¿Gasté 5000 en farmacia?",
        beforeAiRequest: gate,
        signal: controller.signal,
      });
    } catch { /* cancelación esperada */ }
    assert(
      reservations === 1 && calls === 0,
      "Consumió proveedor después del aborto o devolvió reserva incierta",
    );
  } finally {
    globalThis.fetch = oldFetch;
    resetGroqBudgetForTests();
    if (oldKey === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", oldKey);
  }
});
Deno.test("INF-15: Gemini sin política no consume Google aunque falte Groq", async () => {
  const oldFetch = globalThis.fetch,
    groq = Deno.env.get("GROQ_API_KEY"),
    gemini = Deno.env.get("GEMINI_API_KEY");
  try {
    Deno.env.delete("GROQ_API_KEY");
    Deno.env.set("GEMINI_API_KEY", "gsk_synthetic_quota_key");
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      throw Error("HTTP inesperado");
    }) as typeof fetch;
    const gate = createAiQuotaGate({
      token: "synthetic",
      rpc: <T>(_name: string, args?: Record<string, unknown>) => {
        assert(args?.p_lane === "gemini", "Ruta inesperada");
        return Promise.resolve(
          { allowed: false, reason: "provider_disabled" } as T,
        );
      },
    }, job("Complejo"));
    const result = await prepareMessage(
      database().db,
      job("¿Gasté 5000 en farmacia?"),
      () => Promise.resolve(),
      undefined,
      gate,
    );
    assert(
      calls === 0 && result.kind === "reply",
      "Habilitó un proveedor sin política",
    );
  } finally {
    globalThis.fetch = oldFetch;
    if (groq === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", groq);
    if (gemini === undefined) Deno.env.delete("GEMINI_API_KEY");
    else Deno.env.set("GEMINI_API_KEY", gemini);
  }
});
for (
  const transcript of [
    "Gasté 123 en supermercado",
    "Esto necesita interpretación contextual",
  ]
) {
  Deno.test("INF-15: audio reserva Whisper y solo usa Qwen si no resuelve local", async () => {
    const oldFetch = globalThis.fetch, oldKey = Deno.env.get("GROQ_API_KEY");
    try {
      resetGroqBudgetForTests();
      Deno.env.set("GROQ_API_KEY", "gsk_synthetic_quota_key");
      const order: string[] = [];
      globalThis.fetch = ((url: RequestInfo | URL) => {
        const lane = String(url).includes("audio/transcriptions")
          ? "whisper"
          : "qwen";
        order.push("http:" + lane);
        return Promise.resolve(
          Response.json(
            lane === "whisper" ? { text: transcript } : {
              choices: [{
                message: {
                  content: JSON.stringify({
                    intent: "unknown",
                    movements: [],
                  }),
                },
              }],
            },
          ),
        );
      }) as typeof fetch;
      await extractFromGemini({
        text: "",
        mimeType: "audio/ogg",
        mediaBase64: "AQID",
        beforeAiRequest: (lane) => {
          order.push("reserve:" + lane);
          return Promise.resolve();
        },
      });
      const expected = transcript.startsWith("Gasté")
        ? ["reserve:whisper", "http:whisper"]
        : ["reserve:whisper", "http:whisper", "reserve:qwen", "http:qwen"];
      assert(
        JSON.stringify(order) === JSON.stringify(expected),
        "No reservó por solicitud o gastó Qwen en texto local",
      );
    } finally {
      globalThis.fetch = oldFetch;
      resetGroqBudgetForTests();
      if (oldKey === undefined) Deno.env.delete("GROQ_API_KEY");
      else Deno.env.set("GROQ_API_KEY", oldKey);
    }
  });
}
Deno.test("INF-15: audio/foto con cupo agotado no invoca proveedor", async () => {
  const oldFetch = globalThis.fetch, oldKey = Deno.env.get("GROQ_API_KEY");
  try {
    resetGroqBudgetForTests();
    Deno.env.set("GROQ_API_KEY", "gsk_synthetic_quota_key");
    let calls = 0;
    const lanes: string[] = [];
    globalThis.fetch = (() => {
      calls++;
      throw Error("HTTP inesperado");
    }) as typeof fetch;
    for (const mimeType of ["audio/ogg", "image/jpeg"]) {
      let error: unknown;
      try {
        await extractFromGemini({
          text: "",
          mimeType,
          mediaBase64: "AQID",
          beforeAiRequest: (lane) => {
            lanes.push(lane);
            throw new AiQuotaExceeded();
          },
        });
      } catch (e) {
        error = e;
      }
      assert(error instanceof AiQuotaExceeded, "Perdió el motivo agotamiento");
    }
    assert(
      calls === 0 &&
        JSON.stringify(lanes) === JSON.stringify(["whisper", "qwen"]),
      "Gastó cupo externo pese al bloqueo",
    );
  } finally {
    globalThis.fetch = oldFetch;
    resetGroqBudgetForTests();
    if (oldKey === undefined) Deno.env.delete("GROQ_API_KEY");
    else Deno.env.set("GROQ_API_KEY", oldKey);
  }
});
Deno.test("INF-15: trabajador entrega lease e identidad al gate y conserva señal de solicitud", async () => {
  const { runActor } = await import("./queue.ts");
  const stop = new AbortController(), request = new AbortController();
  const input = job("Complejo"), calls: string[] = [];
  await runActor(input.wa_id, {
    stopStartingSignal: stop.signal,
    token: () => "synthetic-lease",
    now: () => 0,
    sleep: () => Promise.resolve(),
    metric: () => {},
    format: () => "",
    send: () => {
      throw Error("Envío inesperado");
    },
    rpc: <T>(
      name: string,
      args?: Record<string, unknown>,
      signal?: AbortSignal,
    ) => {
      calls.push(name);
      let value: unknown = true;
      if (name === "next_whatsapp_job") value = input;
      if (name === "reserve_whatsapp_ai_quota") {
        assert(
          signal === request.signal && args?.p_token === "synthetic-lease" &&
            args.p_id === input.id,
          "Perdió señal/identidad",
        );
        value = { allowed: true };
      }
      if (name === "apply_whatsapp_job") {
        value = { ...input, effect_applied: true };
      }
      if (name === "finish_whatsapp_job") stop.abort();
      return Promise.resolve(value as T);
    },
    prepare: async (q, _checkpoint, signal, context) => {
      assert(context && signal, "Contexto de reserva ausente");
      await createAiQuotaGate(context, q)("qwen", request.signal);
      return { kind: "reply", text: null };
    },
  });
  assert(
    calls.includes("reserve_whatsapp_ai_quota") &&
      calls.includes("finish_whatsapp_job") &&
      calls.at(-1) === "release_whatsapp_actor",
    "El gate no atraviesa el worker real",
  );
});
