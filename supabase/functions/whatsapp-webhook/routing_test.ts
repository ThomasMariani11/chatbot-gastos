// deno-lint-ignore-file no-console -- Captura de logs para verificar ausencia de datos privados.
import {
  downloadWhatsAppMedia,
  formatDraftList,
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
      JSON.stringify(checkpoint) ===
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
        "Gasté 5000 super y pagué alquiler",
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
              text: "Gasté dos mil quinientos en panadería y me ingresó 70,000 de transferencia",
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
