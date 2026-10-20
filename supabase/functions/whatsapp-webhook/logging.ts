import type { FailureMetadata } from "./failures.ts";

// La salida acepta solo eventos y campos operativos conocidos. Nunca serializar
// errores, request/response, teléfonos, IDs, URLs, prompts ni contenido financiero.
export type QueueMetricEvent =
  | "queue_worker"
  | "queue_wait"
  | "queue_interpret"
  | "queue_send"
  | "queue_message"
  | "queue_retry";
export type FailureStage =
  | "interpret"
  | "checkpoint"
  | "apply"
  | "send"
  | "finish";
export type QueueMetricData = Partial<FailureMetadata> & {
  duration_ms?: number;
  operations?: number;
  attempts?: number;
  stage?: FailureStage;
};
type Event =
  | QueueMetricEvent
  | "http_request"
  | "http_request_failed"
  | "worker_interrupted"
  | "local_rule"
  | "ai_attempt"
  | "interpretation_fallback";
type Validator = (value: unknown) => boolean;
const numeric = (maximum: number, integer = false): Validator => (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 &&
  value <= maximum && (!integer || Number.isInteger(value));
const duration = numeric(2147483647);
const attempts = numeric(1000000, true);
const oneOf = (...allowed: string[]): Validator => (value) =>
  typeof value === "string" && allowed.includes(value);
const failureSchema = {
  operation: oneOf(
    "QUEUE_LINK_READ",
    "QUEUE_PROFILE_READ",
    "QUEUE_PROFILE_UNAVAILABLE",
    "QUEUE_CONFIG_READ",
    "QUEUE_SETTINGS_READ",
    "QUEUE_BALANCE_READ",
    "QUEUE_BUDGET_READ",
    "QUEUE_DRAFT_READ",
  ),
  reason: oneOf(
    "configuration",
    "timeout",
    "authentication",
    "rate_limit",
    "unavailable",
    "request_rejected",
    "network",
    "invalid_response",
    "database_read",
    "unknown",
    "media_too_large",
    "payload_too_large",
    "unsupported_media",
  ),
  provider: oneOf("gemini", "meta_media", "meta_send", "database"),
  status: (v: unknown) => numeric(599, true)(v) && (v as number) >= 100,
};
const schemas: Record<Event, Record<string, Validator>> = {
  interpretation_fallback: { ...failureSchema },
  local_rule: {
    rule: oneOf("command", "correction", "movements"),
    operations: numeric(10000, true),
  },
  ai_attempt: {
    ...failureSchema,
    model: oneOf("flash", "flash_lite"),
    result: oneOf("success", "failure"),
    duration_ms: duration,
  },

  queue_worker: { duration_ms: duration },
  queue_wait: { duration_ms: duration },
  queue_interpret: { duration_ms: duration, operations: numeric(20, true) },
  queue_send: { duration_ms: duration },
  queue_message: { duration_ms: duration, attempts },
  queue_retry: {
    ...failureSchema,
    attempts,
    stage: oneOf("interpret", "checkpoint", "apply", "send", "finish"),
  },
  http_request: {
    duration_ms: duration,
    status: (v) => numeric(599, true)(v) && (v as number) >= 100,
    route: oneOf("webhook", "worker", "test_send", "verification"),
  },
  http_request_failed: {
    duration_ms: duration,
    status: (v) => v === 503,
    route: oneOf("webhook", "worker", "test_send", "verification"),
  },
  worker_interrupted: { workers: numeric(100, true) },
};

export function createLogWriter(write: (line: string) => void) {
  return (event: Event, metadata: Record<string, unknown> = {}): boolean => {
    try {
      if (typeof event !== "string" || !Object.hasOwn(schemas, event)) {
        return false;
      }
      const entry: Record<string, unknown> = Object.create(null);
      entry.event = event;
      for (const [field, valid] of Object.entries(schemas[event])) {
        // No invocar getters ni toJSON suministrados por otra capa.
        const descriptor = Object.getOwnPropertyDescriptor(metadata, field);
        if (descriptor && "value" in descriptor && valid(descriptor.value)) {
          entry[field] = descriptor.value;
        }
      }
      write(JSON.stringify(entry));
      return true;
    } catch {
      // Un fallo de telemetría no puede provocar un reintento financiero.
      return false;
    }
  };
}

// deno-lint-ignore no-console -- Único destino; serializa exclusivamente el contrato validado arriba.
export const writeOperationalLog = createLogWriter((line) => console.log(line));
