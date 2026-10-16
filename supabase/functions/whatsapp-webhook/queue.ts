import { failureMetadata } from "./failures.ts";
import type {
  FailureStage,
  QueueMetricData,
  QueueMetricEvent,
} from "./logging.ts";

export type IncomingMessage = {
  id: string;
  from: string;
  type: string;
  timestamp?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
};

export function readMessages(payload: unknown): IncomingMessage[] {
  const data = payload as {
    entry?: Array<
      { changes?: Array<{ value?: { messages?: IncomingMessage[] } }> }
    >;
  };
  const messages = (data?.entry ?? []).flatMap((entry) =>
    (entry.changes ?? []).flatMap((change) => change.value?.messages ?? [])
  );
  if (
    !messages.every((m) =>
      m && typeof m.id === "string" && m.id && typeof m.from === "string" &&
      m.from && typeof m.type === "string"
    )
  ) {
    throw new Error("QUEUE_INVALID_MESSAGE");
  }
  // Meta no garantiza entrega global ordenada. Dentro de un payload usamos su
  // timestamp; entre recepciones, el orden durable asignado por PostgreSQL.
  return messages.map((message, index) => ({ message, index })).sort((a, b) =>
    Number(a.message.timestamp ?? 0) - Number(b.message.timestamp ?? 0) ||
    a.index - b.index
  ).map((row) => row.message);
}

export type Job = {
  id: string;
  wa_id: string;
  payload: IncomingMessage;
  attempts: number;
  effect_applied: boolean;
  parsed_result: unknown;
  reply_text: string | null;
  user_id?: string | null;
  received_at?: string;
};
export type DraftSnapshot = {
  found: boolean;
  group_id?: string;
  version?: number;
  items?: unknown[];
};
export type QueueDependencies = {
  rpc: <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
  prepare: (
    job: Job,
    checkpoint: (result: unknown) => Promise<void>,
  ) => Promise<Record<string, unknown>>;
  send: (recipient: string, text: string) => Promise<void>;
  format: (draft: DraftSnapshot) => string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  token: () => string;
  metric: (event: QueueMetricEvent, data: QueueMetricData) => void;
};

export async function runActor(
  waId: string,
  deps: QueueDependencies,
): Promise<void> {
  const token = deps.token();
  const started = deps.now();
  if (
    !await deps.rpc<boolean>("claim_whatsapp_actor", {
      p_wa_id: waId,
      p_token: token,
    })
  ) return;
  try {
    while (deps.now() - started < 45000) {
      // Renovar y resolver el usuario actual antes de cada mensaje (VINCULAR
      // puede haber cambiado la identidad durante la iteración anterior).
      if (
        !await deps.rpc<boolean>("claim_whatsapp_actor", {
          p_wa_id: waId,
          p_token: token,
        })
      ) return;
      const job = await deps.rpc<Job | null>("next_whatsapp_job", {
        p_wa_id: waId,
        p_token: token,
      });
      if (!job) {
        const draft = await deps.rpc<DraftSnapshot | null>(
          "whatsapp_summary_snapshot",
          { p_wa_id: waId, p_token: token },
        );
        if (draft) {
          await deps.send(waId, deps.format(draft));
          await deps.rpc("mark_whatsapp_summary_sent", {
            p_wa_id: waId,
            p_token: token,
            p_group_id: draft.group_id ?? null,
            p_version: draft.version ?? null,
          });
          return;
        }
        // Solo una espera corta como optimización; cron recupera todo lo que
        // quede durable si se termina la instancia durante la espera.
        await deps.sleep(3000);
        const afterWait = await deps.rpc<Job | null>("next_whatsapp_job", {
          p_wa_id: waId,
          p_token: token,
        });
        if (afterWait) {
          // next es idempotente dentro del lease: se procesa abajo sin perderlo.
          if (!await processJob(afterWait, token, deps)) return;
          continue;
        }
        const ready = await deps.rpc<DraftSnapshot | null>(
          "whatsapp_summary_snapshot",
          { p_wa_id: waId, p_token: token },
        );
        if (ready) {
          await deps.send(waId, deps.format(ready));
          await deps.rpc("mark_whatsapp_summary_sent", {
            p_wa_id: waId,
            p_token: token,
            p_group_id: ready.group_id ?? null,
            p_version: ready.version ?? null,
          });
        }
        return;
      }
      if (!await processJob(job, token, deps)) return;
    }
  } finally {
    await deps.rpc("release_whatsapp_actor", { p_wa_id: waId, p_token: token });
    deps.metric("queue_worker", { duration_ms: deps.now() - started });
  }
}

async function processJob(
  job: Job,
  token: string,
  deps: QueueDependencies,
): Promise<boolean> {
  const start = deps.now();
  const received = Date.parse(job.received_at ?? "");
  if (Number.isFinite(received)) {
    deps.metric("queue_wait", { duration_ms: Math.max(0, start - received) });
  }
  let stage: FailureStage = "interpret";
  try {
    let applied = job;
    if (!job.effect_applied) {
      const interpretStart = deps.now();
      const action = await deps.prepare(job, async (result) => {
        stage = "checkpoint";
        await deps.rpc("checkpoint_whatsapp_job", {
          p_id: job.id,
          p_token: token,
          p_result: result,
        });
        stage = "interpret";
      });
      deps.metric("queue_interpret", {
        duration_ms: deps.now() - interpretStart,
        operations: Array.isArray(action.items) ? action.items.length : 0,
      });
      stage = "apply";
      applied = await deps.rpc<Job>("apply_whatsapp_job", {
        p_id: job.id,
        p_token: token,
        p_action: action,
      });
    }
    if (applied.reply_text) {
      stage = "send";
      const sendStart = deps.now();
      await deps.send(job.wa_id, applied.reply_text);
      deps.metric("queue_send", { duration_ms: deps.now() - sendStart });
    }
    stage = "finish";
    await deps.rpc("finish_whatsapp_job", { p_id: job.id, p_token: token });
    deps.metric("queue_message", {
      duration_ms: deps.now() - start,
      attempts: job.attempts,
    });
    return true;
  } catch (error) {
    // No registrar mensajes, teléfonos, comprobantes, respuestas del proveedor
    // ni excepciones que puedan incluir credenciales o contenido del usuario.
    deps.metric("queue_retry", {
      attempts: job.attempts,
      stage,
      ...failureMetadata(error),
    });
    await deps.rpc("fail_whatsapp_job", { p_id: job.id, p_token: token });
    return false;
  }
}
