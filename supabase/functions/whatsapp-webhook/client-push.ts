// FE-25 / NOTIF-01: notificaciones push al celular del cliente.
// SQL decide a quién avisar (enqueue_client_notifications) y deja la bandeja;
// acá solo se reclaman, se envían y se cierran. Sin datos financieros ni nombres.
import { writeOperationalLog } from "./logging.ts";
import { sendWebPush, type PushResult, type PushSubscriptionKeys, type VapidConfig } from "./web-push.ts";

type Rpc = <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
export type ClientNotification = {
  id: string;
  kind: "subscription_7" | "subscription_1" | "registration_noon" | "registration_night";
  days: number | null;
  subscriptions: PushSubscriptionKeys[];
};
type Send = (subscription: PushSubscriptionKeys, payload: string) => Promise<PushResult>;

export function formatClientPush(notification: Pick<ClientNotification, "kind" | "days">): {
  title: string;
  body: string;
  url: string;
  tag: string;
} {
  if (notification.kind === "registration_noon") {
    return {
      title: "¿Cómo viene el día?",
      body: "Todavía no registraste movimientos hoy. Anotá tus gastos de la mañana en Pesito.",
      url: "./",
      tag: "pesito-registro",
    };
  }
  if (notification.kind === "registration_night") {
    return {
      title: "Antes de cerrar el día",
      body: "Hoy no registraste movimientos. Anotá tus gastos e ingresos para tener tu resumen al día.",
      url: "./",
      tag: "pesito-registro",
    };
  }
  const days = notification.days ?? 1;
  return {
    title: notification.kind === "subscription_1"
      ? "Tu membresía de Pesito vence en menos de 24 horas"
      : `Tu membresía de Pesito vence en ${days} ${days === 1 ? "día" : "días"}`,
    body: "Renová para no perder el acceso. Tocá para ver cómo.",
    url: "./#settings",
    tag: "pesito-vencimiento",
  };
}

export function readVapidConfig(get: (name: string) => string | undefined): VapidConfig | null {
  const publicKey = get("VAPID_PUBLIC_KEY"), privateKey = get("VAPID_PRIVATE_KEY"), subject = get("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

export async function deliverClientPush(
  rpc: Rpc,
  send: Send,
  options: { deadlineMs?: number; now?: () => number } = {},
): Promise<{ sent: number; failed: number }> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? 25_000);
  const totals = { sent: 0, failed: 0 };
  for (let round = 0; round < 5 && now() < deadline; round++) {
    const token = crypto.randomUUID();
    let batch: ClientNotification[];
    try {
      batch = (await rpc<ClientNotification[] | null>("claim_client_notifications", { p_token: token, p_limit: 50 })) ?? [];
    } catch {
      writeOperationalLog("ops_error", { stage: "notification" });
      return totals;
    }
    if (batch.length === 0) return totals;
    for (const notification of batch) {
      const payload = JSON.stringify(formatClientPush(notification));
      const gone: string[] = [];
      let delivered = 0;
      for (const subscription of notification.subscriptions ?? []) {
        let result: PushResult = "failed";
        try {
          result = await send(subscription, payload);
        } catch {
          result = "failed";
        }
        if (result === "sent") delivered++;
        if (result === "gone") gone.push(subscription.endpoint);
      }
      const outcome = delivered > 0 ? "sent" : (notification.subscriptions ?? []).length === gone.length ? "skipped" : "failed";
      if (outcome === "sent") totals.sent++;
      if (outcome === "failed") {
        totals.failed++;
        writeOperationalLog("ops_error", { stage: "notification" });
      }
      try {
        await rpc("finish_client_notification", {
          p_id: notification.id,
          p_token: token,
          p_outcome: outcome,
          p_gone_endpoints: gone,
        });
      } catch {
        // El lease vence y SQL lo cierra como fallido: no se reenvía.
        writeOperationalLog("ops_error", { stage: "notification" });
        return totals;
      }
    }
  }
  return totals;
}

export function createPushSender(vapid: VapidConfig, signalFor: () => AbortSignal): Send {
  return (subscription, payload) => sendWebPush(subscription, payload, vapid, { signal: signalFor() });
}
