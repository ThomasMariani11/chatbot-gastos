// Solo metadata controlada. Nunca conservar cause, message/stack ni respuestas crudas.
export type FailureReason =
  | "configuration"
  | "timeout"
  | "authentication"
  | "rate_limit"
  | "unavailable"
  | "request_rejected"
  | "network"
  | "invalid_response"
  | "database_read"
  | "unknown";
export type FailureProvider = "gemini" | "meta_media" | "database";
export type DatabaseOperation =
  | "QUEUE_LINK_READ"
  | "QUEUE_PROFILE_READ"
  | "QUEUE_PROFILE_UNAVAILABLE"
  | "QUEUE_CONFIG_READ"
  | "QUEUE_SETTINGS_READ"
  | "QUEUE_BALANCE_READ"
  | "QUEUE_BUDGET_READ"
  | "QUEUE_DRAFT_READ";
export type FailureMetadata = {
  reason: FailureReason;
  provider?: FailureProvider;
  status?: number;
  operation?: DatabaseOperation;
};
const metadata = new WeakMap<object, FailureMetadata>();

export class OperationalFailure extends Error {
  constructor(
    reason: FailureReason,
    provider: FailureProvider,
    status?: number,
    operation?: DatabaseOperation,
  ) {
    super("OPERATIONAL_FAILURE");
    metadata.set(this, {
      reason,
      provider,
      ...(status === undefined ? {} : { status }),
      ...(operation === undefined ? {} : { operation }),
    });
  }
}
export function failureMetadata(error: unknown): FailureMetadata {
  if (typeof error === "object" && error !== null) {
    const known = metadata.get(error);
    if (known) return { ...known };
  }
  return { reason: "unknown" };
}
export function providerFailure(
  error: unknown,
  provider: FailureProvider,
  fallback: FailureReason,
): OperationalFailure {
  if (typeof error === "object" && error !== null && metadata.has(error)) {
    return error as OperationalFailure;
  }
  let reason = fallback;
  try {
    if (
      error instanceof DOMException &&
      ["TimeoutError", "AbortError"].includes(error.name)
    ) reason = "timeout";
    else if (error instanceof SyntaxError) reason = "invalid_response";
  } catch { /* El error ajeno no puede romper el diagnóstico. */ }
  return new OperationalFailure(reason, provider);
}
export function httpFailure(
  status: number,
  provider: FailureProvider,
): OperationalFailure {
  const reason = status === 401 || status === 403
    ? "authentication"
    : status === 429
    ? "rate_limit"
    : status === 408 || status === 504
    ? "timeout"
    : status >= 500
    ? "unavailable"
    : "request_rejected";
  return new OperationalFailure(reason, provider, status);
}
