import { OperationalFailure } from "./failures.ts";
export type AiLane = "qwen" | "whisper" | "gemini";
export type BeforeAiRequest = (
  lane: AiLane,
  signal?: AbortSignal,
) => Promise<void>;
export type PreparationContext = {
  token: string;
  rpc: <T>(
    name: string,
    args?: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<T>;
};
export class AiQuotaExceeded extends OperationalFailure {
  constructor() {
    super("rate_limit", "groq");
  }
}
export function createAiQuotaGate(
  context: PreparationContext,
  job: { id: string; attempts: number },
): BeforeAiRequest {
  return async (lane, signal) => {
    signal?.throwIfAborted();
    const result = await context.rpc<{ allowed: boolean; reason?: string }>(
      "reserve_whatsapp_ai_quota",
      {
        p_id: job.id,
        p_token: context.token,
        p_attempt: job.attempts,
        p_lane: lane,
      },
      signal,
    );
    signal?.throwIfAborted();
    if (result?.allowed === true) return;
    if (result?.reason === "exhausted") throw new AiQuotaExceeded();
    throw new OperationalFailure(
      "configuration",
      lane === "gemini" ? "gemini" : "groq",
    );
  };
}
