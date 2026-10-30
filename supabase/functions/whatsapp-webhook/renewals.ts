import { failureMetadata } from "./failures.ts";
import { writeOperationalLog } from "./logging.ts";

type Rpc = <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
type RenewalNotice = {
  id: string;
  to: string;
  test_sender_digits: string;
  code: string;
  duration_days: number | null;
};

export function isRenewalRequest(text: string): boolean {
  return /^(?:quiero\s+)?renovar[.!]?$/i.test(text.trim());
}

export function formatRenewalReceipt(code: string, days: number | null): string {
  return "✅ Pago confirmado — Pesito\n\n" +
    (days === null
      ? "Recibimos tu pago por acceso sin vencimiento."
      : `Recibimos tu pago por ${days} días.`) +
    `\nTu código de renovación es: ${code}\n\n` +
    "Canjealo en Ajustes → ¿Tenés un código de renovación? para activar tu suscripción. " +
    "El nuevo vencimiento aparecerá en la app después del canje.";
}

export async function deliverRenewalNotices(
  rpc: Rpc,
  send: (to: string, body: string) => Promise<void>,
  verifyTestSender: (expected: string) => Promise<boolean>,
): Promise<void> {
  // Presupuesto para iniciar entregas; cada llamada remota conserva su timeout.
  // Cron recupera los siguientes sin monopolizar Edge.
  const deadline = Date.now() + 20_000;
  for (let index = 0; index < 5 && Date.now() < deadline; index++) {
    const token = crypto.randomUUID();
    let notice: RenewalNotice | null;
    try {
      notice = await rpc<RenewalNotice | null>("claim_subscription_renewal_notice", { p_token: token });
    } catch {
      writeOperationalLog("ops_error", { stage: "notification" });
      return;
    }
    if (!notice) return;
    let outcome = "blocked", sendStarted = false;
    try {
      if (await verifyTestSender(notice.test_sender_digits)) {
        const allowed = await rpc<boolean>("authorize_subscription_renewal_notice", { p_id: notice.id, p_token: token });
        if (!allowed) continue;
        sendStarted = true;
        await send(notice.to, formatRenewalReceipt(notice.code, notice.duration_days));
        outcome = "sent";
      }
    } catch (error) {
      const failure = failureMetadata(error);
      // Solo un rechazo explícito 4xx (salvo 408) habilita reintento.
      // Un 5xx, timeout o corte de red puede ocultar una entrega ya aceptada.
      outcome = !sendStarted || (failure.status !== undefined && failure.status >= 400 && failure.status < 500 && failure.status !== 408)
        ? "failed" : "uncertain";
      writeOperationalLog("ops_error", { stage: "notification", ...failure });
    }
    try {
      await rpc("finish_subscription_renewal_notice", { p_id: notice.id, p_token: token, p_outcome: outcome });
    } catch {
      // El lease expira a uncertain; no reenviar un mensaje posiblemente entregado.
      writeOperationalLog("ops_error", { stage: "notification" });
      return;
    }
  }
}
