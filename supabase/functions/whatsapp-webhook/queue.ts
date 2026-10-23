import { writeOperationalLog } from "./logging.ts";
import { LIMITS, timeoutSignal, withinSignal } from "./limits.ts";
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
  stopStartingSignal?: AbortSignal;
  rpc: <T>(
    name: string,
    args?: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<T>;
  prepare: (
    job: Job,
    checkpoint: (result: unknown) => Promise<void>,
    signal?: AbortSignal,
  ) => Promise<Record<string, unknown>>;
  send: (
    recipient: string,
    text: string,
    signal?: AbortSignal,
  ) => Promise<void>;
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
  if (deps.stopStartingSignal?.aborted) return;
  const token = deps.token();
  const started = deps.now();
  if (
    !await deps.rpc<boolean>("claim_whatsapp_actor", {
      p_wa_id: waId,
      p_token: token,
    })
  ) return;
  try {
    while (deps.now() - started < 45000 && !deps.stopStartingSignal?.aborted) {
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
        if (deps.stopStartingSignal?.aborted) return;
        await deps.sleep(3000);
        if (deps.stopStartingSignal?.aborted) return;
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

async function recordIssue(
  job: Job,
  token: string,
  deps: QueueDependencies,
  issue: Record<string, unknown>,
): Promise<void> {
  const signal = timeoutSignal(1500);
  try {
    await withinSignal(
      () =>
        deps.rpc("record_whatsapp_job_issue", {
          p_id: job.id,
          p_token: token,
          p_issue: issue,
        }, signal),
      signal,
    );
  } catch {
    writeOperationalLog("ops_error", { stage: "monitor" });
  }
}

async function processJob(
  job: Job,
  token: string,
  deps: QueueDependencies,
): Promise<boolean> {
  const start = deps.now();
  const signal = timeoutSignal(LIMITS.jobMs);
  const scoped: QueueDependencies = {
    ...deps,
    rpc: <T>(name: string, args?: Record<string, unknown>) =>
      withinSignal(() => deps.rpc<T>(name, args, signal), signal),
    prepare: (job, checkpoint) =>
      withinSignal(() => deps.prepare(job, checkpoint, signal), signal),
    send: (recipient, text) =>
      withinSignal(() => deps.send(recipient, text, signal), signal),
  };
  const received = Date.parse(job.received_at ?? "");
  if (Number.isFinite(received)) {
    deps.metric("queue_wait", { duration_ms: Math.max(0, start - received) });
  }
  let stage: FailureStage = "interpret";
  try {
    let applied = job;
    if (!job.effect_applied) {
      const interpretStart = deps.now();
      const action = await scoped.prepare(job, async (result) => {
        stage = "checkpoint";
        await scoped.rpc("checkpoint_whatsapp_job", {
          p_id: job.id,
          p_token: token,
          p_result: result,
        });
        if (
          result && typeof result === "object" &&
          (result as { intent?: unknown }).intent === "request_text"
        ) {
          const diagnostic =
            (result as { operationalFailure?: Record<string, unknown> })
              .operationalFailure;
          await recordIssue(job, token, deps, {
            ...diagnostic,
            kind: "clarification",
            stage: "interpret",
            reason: diagnostic?.reason ?? "invalid_response",
          });
          const source = job.payload.type;
          deps.metric("queue_clarification", {
            source_kind: source === "audio" || source === "image"
              ? source
              : "text",
          });
        }
        stage = "interpret";
      });
      deps.metric("queue_interpret", {
        duration_ms: deps.now() - interpretStart,
        operations: Array.isArray(action.items) ? action.items.length : 0,
      });
      stage = "apply";
      applied = await scoped.rpc<Job>("apply_whatsapp_job", {
        p_id: job.id,
        p_token: token,
        p_action: action,
      });
    }
    if (applied.reply_text) {
      stage = "send";
      const sendStart = deps.now();
      await scoped.send(job.wa_id, applied.reply_text);
      deps.metric("queue_send", { duration_ms: deps.now() - sendStart });
    }
    stage = "finish";
    await scoped.rpc("finish_whatsapp_job", { p_id: job.id, p_token: token });
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
      ...(signal.aborted
        ? { reason: "timeout" as const }
        : failureMetadata(error)),
    });
    await recordIssue(job, token, deps, {
      ...(signal.aborted ? { reason: "timeout" } : failureMetadata(error)),
      kind: "retry",
      stage,
    });
    await deps.rpc("fail_whatsapp_job", { p_id: job.id, p_token: token });
    return false;
  }
}
