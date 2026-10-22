import { createLogWriter, writeOperationalLog } from "./logging.ts";
import type { QueueMetricData, QueueMetricEvent } from "./logging.ts";
import { failureMetadata } from "./failures.ts";

type Rpc = <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
export function createOperationalMetrics() {
  const samples: Record<string, unknown>[] = [];
  let dropped = 0;
  const capture = createLogWriter((line) => {
    if (samples.length < 256) samples.push(JSON.parse(line));
    else dropped++;
  });
  return {
    metric(event: QueueMetricEvent, data: QueueMetricData) {
      writeOperationalLog(event, data);
      capture(event, data);
    },
    async flush(rpc: Rpc) {
      // Retirar antes del await: nunca repetir una llamada cuyo commit es incierto.
      const batch = samples.splice(0);
      if (dropped) {
        writeOperationalLog("ops_error", { stage: "metrics", dropped });
      }
      if (!batch.length) return;
      try {
        await rpc("record_whatsapp_ops_metrics", { p_samples: batch });
      } catch {
        writeOperationalLog("ops_error", { stage: "metrics" });
      }
    },
  };
}
export const OPERATIONAL_ALERT_LABELS: Record<string, string> = {
  queue_delay: "Mensajes demorados más de 2 minutos",
  repeated_failures: "Mensajes con fallos repetidos",
  manual_review: "Mensajes para revisión manual",
  recovery_failure: "Recuperación programada sin respuesta reciente",
  interpretation_fallback: "Varios mensajes necesitaron pasarse a texto",
};
type Notice = {
  id: string;
  to: string;
  test_sender_digits: string;
  snapshot: Array<{ code: string; affected: number; oldest_seconds: number }>;
};
export async function deliverOperationalNotice(
  rpc: Rpc,
  send: (to: string, body: string) => Promise<void>,
  verifyTestSender: (expected: string) => Promise<boolean>,
  token: string = crypto.randomUUID(),
): Promise<void> {
  let notice: Notice | null;
  try {
    notice = await rpc<Notice | null>("claim_whatsapp_ops_notice", {
      p_token: token,
    });
  } catch {
    writeOperationalLog("ops_error", { stage: "notification" });
    return;
  }
  if (!notice) return;
  let outcome = "sent";
  let sendStarted = false;
  try {
    if (!await verifyTestSender(notice.test_sender_digits)) {
      await rpc("finish_whatsapp_ops_notice", {
        p_id: notice.id,
        p_token: token,
        p_outcome: "blocked",
      });
      return;
    }
    const lines = notice.snapshot.map((a) =>
      "• " + (OPERATIONAL_ALERT_LABELS[a.code] ?? "Incidente del bot") + ": " +
      a.affected + (a.oldest_seconds > 0
        ? " (más antiguo: " + Math.max(1, Math.floor(a.oldest_seconds / 60)) +
          " min)"
        : "")
    );
    sendStarted = true;
    await send(
      notice.to,
      "⚠️ Pesito: alerta técnica del bot\n\n" + lines.join("\n") +
        "\n\nRevisá Estado del bot en el panel de administrador. No se incluyeron textos ni datos financieros de clientes.",
    );
  } catch (error) {
    const failure = failureMetadata(error);
    outcome = !sendStarted || (failure.status && failure.status >= 400)
      ? "failed"
      : "uncertain";
    writeOperationalLog("ops_error", { stage: "notification", ...failure });
  }
  try {
    await rpc("finish_whatsapp_ops_notice", {
      p_id: notice.id,
      p_token: token,
      p_outcome: outcome,
    });
  } catch {
    writeOperationalLog("ops_error", { stage: "notification" });
  }
}
