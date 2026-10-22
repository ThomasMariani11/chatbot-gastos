import { handleAdminSend } from "./admin-send.ts";
import { LIMITS, processActorsLimited, timeoutSignal } from "./limits.ts";
import { createClient } from "npm:@supabase/supabase-js@2.114.0";
import {
  formatDraftList,
  json,
  sendWhatsAppText,
  validSignature,
} from "./helpers.ts";
import type { DraftListItem } from "./helpers.ts";
import { readMessages, runActor } from "./queue.ts";
import { prepareMessage } from "./processor.ts";
import { writeOperationalLog } from "./logging.ts";

declare const EdgeRuntime: { waitUntil: (task: Promise<unknown>) => void };

async function routeRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const verify = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    return verify && url.searchParams.get("hub.mode") === "subscribe" &&
        url.searchParams.get("hub.verify_token") === verify
      ? new Response(url.searchParams.get("hub.challenge") ?? "")
      : json({ error: "Verificación rechazada." }, 403);
  }
  if (request.method !== "POST") {
    return json({ error: "Método no permitido." }, 405);
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceKey || !supabaseUrl) {
    return json({ error: "Configuración incompleta." }, 503);
  }
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: timeoutSignal(LIMITS.rpcMs, init?.signal),
        }),
    },
  });
  async function rpc<T>(
    name: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const result = await db.rpc(name, args).abortSignal(
      timeoutSignal(LIMITS.rpcMs, signal),
    );
    if (result.error) throw new Error(`QUEUE_RPC_${name}`);
    return result.data as T;
  }
  const run = async (actors: string[]) => {
    const stopStartingSignal = timeoutSignal(LIMITS.workerWindowMs);
    const results = await processActorsLimited(
      [...new Set(actors)],
      (waId) =>
        runActor(waId, {
          rpc,
          stopStartingSignal,
          prepare: (job, checkpoint, signal) =>
            prepareMessage(db, job, checkpoint, signal),
          send: sendWhatsAppText,
          format: (draft) =>
            formatDraftList((draft.items ?? []) as DraftListItem[]),
          now: Date.now,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          token: () => crypto.randomUUID(),
          metric: writeOperationalLog,
        }),
    );
    if (results.failed) {
      writeOperationalLog("worker_interrupted", { workers: results.failed });
    }
  };
  if (url.searchParams.get("action") === "worker") {
    const secret = Deno.env.get("WHATSAPP_WORKER_SECRET");
    if (!secret || request.headers.get("x-worker-secret") !== secret) {
      return json({ error: "No autorizado." }, 401);
    }
    try {
      const actors = await rpc<string[]>("due_whatsapp_actors");
      EdgeRuntime.waitUntil(run(actors));
      return json({ accepted: true });
    } catch {
      return json({ error: "Cola no disponible." }, 503);
    }
  }
  if (url.searchParams.get("action") === "test-send") {
    return handleAdminSend(request, {
      legacyServiceKey: serviceKey,
      secretKeysJson: Deno.env.get("SUPABASE_SECRET_KEYS"),
      send: sendWhatsAppText,
    });
  }
  const raw = await request.text();
  if (!await validSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return json({ error: "Firma inválida." }, 401);
  }
  let messages;
  try {
    messages = readMessages(JSON.parse(raw));
  } catch {
    return json({ error: "Payload inválido." }, 400);
  }
  if (!messages.length) return json({ received: true });
  try {
    const queued = await rpc<{ actors: string[] }>(
      "enqueue_whatsapp_messages",
      { p_messages: messages },
    );
    // Solo se acusa recibo después de persistir el payload completo atómicamente.
    EdgeRuntime.waitUntil(run(queued.actors));
    return json({ received: true });
  } catch {
    return json({ error: "Recepción no disponible. Reintentar." }, 503);
  }
}

export async function handleRequest(request: Request): Promise<Response> {
  const started = performance.now();
  let route: "webhook" | "worker" | "test_send" | "verification" = "webhook";
  try {
    const action = new URL(request.url).searchParams.get("action");
    route = action === "worker"
      ? "worker"
      : action === "test-send"
      ? "test_send"
      : request.method === "GET"
      ? "verification"
      : "webhook";
    const response = await routeRequest(request);
    writeOperationalLog("http_request", {
      route,
      status: response.status,
      duration_ms: performance.now() - started,
    });
    return response;
  } catch {
    // Interceptar también errores de lectura/SDK sin exponer stack, URL o body
    // al logger automático de excepciones no manejadas del runtime.
    writeOperationalLog("http_request_failed", {
      route,
      status: 503,
      duration_ms: performance.now() - started,
    });
    return json({ error: "Servicio no disponible. Reintentar." }, 503);
  }
}

Deno.serve(handleRequest);
