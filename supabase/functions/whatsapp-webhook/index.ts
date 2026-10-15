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

declare const EdgeRuntime: { waitUntil: (task: Promise<unknown>) => void };

export async function handleRequest(request: Request): Promise<Response> {
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
  });
  async function rpc<T>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const result = await db.rpc(name, args);
    if (result.error) throw new Error(`QUEUE_RPC_${name}`);
    return result.data as T;
  }
  const run = async (actors: string[]) => {
    const results = await Promise.allSettled(
      [...new Set(actors)].map((waId) =>
        runActor(waId, {
          rpc,
          prepare: (job, checkpoint) => prepareMessage(db, job, checkpoint),
          send: sendWhatsAppText,
          format: (draft) =>
            formatDraftList((draft.items ?? []) as DraftListItem[]),
          now: Date.now,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          token: () => crypto.randomUUID(),
          metric: (event, data) =>
            console.log(JSON.stringify({ event, ...data })),
        })
      ),
    );
    if (results.some((result) => result.status === "rejected")) {
      console.error("QUEUE_WORKER_INTERRUPTED");
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
  // Diagnóstico existente; comparación exacta, sin devolver teléfono ni errores del proveedor.
  if (url.searchParams.get("action") === "test-send") {
    if (request.headers.get("authorization") !== `Bearer ${serviceKey}`) {
      return json({ error: "No autorizado." }, 401);
    }
    try {
      const data = await request.json();
      await sendWhatsAppText(data.to, data.body || "Prueba de Pesito");
      return json({ ok: true });
    } catch {
      return json({ error: "Envío no disponible." }, 502);
    }
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

Deno.serve(handleRequest);
