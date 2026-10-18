import { LIMITS, timeoutSignal } from "./limits.ts";
import type { DatabaseOperation } from "./failures.ts";
import {
  failureMetadata,
  OperationalFailure,
  providerFailure,
} from "./failures.ts";
import { writeOperationalLog } from "./logging.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.114.0";
import type { Job } from "./queue.ts";
import { classifyTextQuery } from "./intent.ts";
import {
  looksLikeDraftCorrection,
  parseDraftCorrection,
} from "./draft-corrections.ts";
import {
  downloadWhatsAppMedia,
  extractFromGemini,
  formatDraftList,
  parseDeterministicMovements,
  sha256,
} from "./helpers.ts";
import type { DraftListItem, GeminiParsedOutput } from "./helpers.ts";

function checked<T>(
  result: { data: T; error: unknown },
  code: DatabaseOperation,
): T {
  if (result.error) {
    throw new OperationalFailure("database_read", "database", undefined, code);
  }
  return result.data;
}
const localDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export async function prepareMessage(
  db: SupabaseClient,
  job: Job,
  checkpoint: (result: unknown) => Promise<void>,
  parent?: AbortSignal,
): Promise<Record<string, unknown>> {
  const message = job.payload;
  const text = message.text?.body?.trim() ?? message.image?.caption?.trim() ??
    "";
  const reply = (body: string) => ({ kind: "reply", text: body });
  const blocked = (body: string | null) => ({
    kind: "reply",
    text: body,
    clear_summary: true,
  });
  const linkMatch = text.match(/^vincular\s+(\d{6})$/i);
  if (linkMatch) return { kind: "link", hash: await sha256(linkMatch[1]) };
  const link = checked(
    await db.from("whatsapp_links").select("user_id").eq("wa_id", message.from)
      .eq("status", "active").maybeSingle(),
    "QUEUE_LINK_READ",
  );
  if (!link) {
    return reply(
      "Tu número no está vinculado a Pesito. Podés vincularlo generando un código desde la app.",
    );
  }
  if (job.user_id && job.user_id !== link.user_id) {
    return reply(
      "El vínculo de tu cuenta cambió. No registré este mensaje. Revisá la cuenta vinculada y envialo nuevamente.",
    );
  }
  const profile = checked(
    await db.from("profiles").select(
      "role,subscription_status,subscription_until",
    ).eq("id", link.user_id).maybeSingle(),
    "QUEUE_PROFILE_READ",
  );
  if (!profile) {
    throw new OperationalFailure(
      "database_read",
      "database",
      undefined,
      "QUEUE_PROFILE_UNAVAILABLE",
    );
  }
  const support = async () => {
    const settings = checked(
      await db.from("system_config").select("key,value").in("key", [
        "support_phone",
        "payment_alias",
      ]),
      "QUEUE_CONFIG_READ",
    );
    const phone = settings?.find((row) => row.key === "support_phone")?.value
      ?.replace(/\D/g, "");
    const alias = settings?.find((row) => row.key === "payment_alias")?.value
      ?.trim();
    return `${
      phone ? `\n\n👉 Escribinos a soporte: https://wa.me/${phone}` : ""
    }${alias ? `\n💸 Alias para transferencias: *${alias}*` : ""}`;
  };
  if (profile.role !== "admin") {
    if (profile.subscription_status === "suspended") {
      return blocked(
        `Tu cuenta de Pesito se encuentra en pausa ⏸️.${await support()}`,
      );
    }
    if (
      profile.role !== "client" || profile.subscription_status !== "active" ||
      (profile.subscription_until !== null &&
        !(Date.parse(profile.subscription_until) > Date.now()))
    ) {
      return blocked(
        `Tu suscripción en Pesito ha finalizado ⏳.${await support()}`,
      );
    }
  }
  const bot = checked(
    await db.from("system_config").select("value").eq("key", "bot_active")
      .maybeSingle(),
    "QUEUE_CONFIG_READ",
  );
  if (bot?.value === "false" && profile.role !== "admin") {
    return blocked(
      "Pesito: El bot se encuentra temporalmente en pausa por mantenimiento. Intentá nuevamente más tarde.",
    );
  }
  const settings = checked(
    await db.from("app_settings").select("whatsapp_responses_enabled").eq(
      "user_id",
      link.user_id,
    ).maybeSingle(),
    "QUEUE_SETTINGS_READ",
  );
  if (settings?.whatsapp_responses_enabled === false) return blocked(null);

  const correctionIntent = !message.image?.id && !message.audio?.id &&
    looksLikeDraftCorrection(text);
  const query = correctionIntent ? null : classifyTextQuery(
    text,
    Boolean(message.image?.id || message.audio?.id),
  );
  if (query === "commercial") {
    return reply(
      `¡Hola! 👋 Para renovar tu membresía en Pesito o consultar planes y medios de pago:${await support()}\n\nComunicate con soporte para activar tu cuenta.`,
    );
  }
  if (/^retomar$/i.test(text)) return { kind: "resume" };
  if (/^descartar$/i.test(text)) return { kind: "discard" };
  if (
    /^(confirmar|confirmado|confirmo|si|sí|ok|dale|listo|de una|va|sisi|perfecto|👍[🏻🏼🏽🏾🏿]?|✅|✔️|👌[🏻🏼🏽🏾🏿]?)$/i
      .test(text)
  ) return { kind: "confirm" };
  if (
    /^(cancelar|cancelalo|cancela|cancel|no|borralo|borrar todo|anular|rechazar|❌|🚫)$/i
      .test(text)
  ) return { kind: "cancel" };
  if (/^(resumen|pendientes|ver lista|lista|ver)$/i.test(text)) {
    return { kind: "summary" };
  }
  const remove = text.match(
    /^(quit[aá]|borr[aá]|sac[aá]|elimin[aá])\s+(el\s+)?(\d+)$/i,
  );
  if (remove) return { kind: "remove", position: Number(remove[3]) };

  if (query === "balance") {
    const month = localDate().slice(0, 7);
    const next = new Date(`${month}-01T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const txs = checked(
      await db.from("transactions").select("amount_ars,kind,currency").eq(
        "user_id",
        link.user_id,
      ).eq("status", "confirmed")
        .gte("occurred_on", `${month}-01`).lt(
          "occurred_on",
          next.toISOString().slice(0, 10),
        ),
      "QUEUE_BALANCE_READ",
    );
    const budgetRow = checked(
      await db.from("budgets").select("amount_ars").eq("user_id", link.user_id)
        .eq("month", `${month}-01`).maybeSingle(),
      "QUEUE_BUDGET_READ",
    );
    const totals = (currency: string, kind: string) =>
      (txs ?? []).filter((t) => t.currency === currency && t.kind === kind)
        .reduce((sum, t) => sum + Number(t.amount_ars), 0);
    const expense = totals("ARS", "expense"),
      income = totals("ARS", "income"),
      budget = Number(budgetRow?.amount_ars ?? 0);
    let body = `📊 *Resumen de ${month}:*\n\n• Total gastado: $ ${
      expense.toLocaleString("es-AR")
    }\n• Total ingresos: $ ${
      income.toLocaleString("es-AR")
    }\n• Balance neto: $ ${(income - expense).toLocaleString("es-AR")}`;
    if ((txs ?? []).some((t) => t.currency === "USD")) {
      body += `\n\n• Gastos USD: US$ ${
        totals("USD", "expense").toLocaleString("es-AR")
      }\n• Ingresos USD: US$ ${
        totals("USD", "income").toLocaleString("es-AR")
      }`;
    }
    body += budget > 0
      ? `\n• *Disponible restante: $ ${
        (budget - expense).toLocaleString("es-AR")
      }*`
      : "\n\n💡 Podés fijar un presupuesto mensual en la app.";
    return reply(body);
  }

  const draft = checked(
    await db.rpc("get_active_draft_group", { p_user_id: link.user_id }),
    "QUEUE_DRAFT_READ",
  );
  if (draft?.is_stale) return { kind: "summary" }; // SQL retiene el mensaje antes de interpretarlo.
  const correction = correctionIntent ? parseDraftCorrection(text) : null;
  if (correction) return correction;
  if (!text && !message.image?.id && !message.audio?.id) {
    return reply(
      "Este tipo de mensaje no es compatible. Podés enviar texto, audio o una foto.",
    );
  }
  let result = job.parsed_result as GeminiParsedOutput | null;
  if (!result) {
    const signal = timeoutSignal(LIMITS.interpretationMs, parent);
    try {
      const mediaId = message.image?.id ?? message.audio?.id;
      const media = mediaId
        ? await downloadWhatsAppMedia(
          mediaId,
          message.audio?.id ? "audio" : "image",
          signal,
        )
        : undefined;
      const simple = text && !media && !correctionIntent &&
        !/[?¿]|(cu[aá]nto|c[oó]mo|d[oó]nde|por qu[eé]|explicame|ayuda)/i.test(
          text,
        ) &&
        !/^(el\s+\d|cambi[aá]|correg[ií]|modific[aá]|sac[aá]|quit[aá]|borr[aá])/i
          .test(text);
      const direct = simple
        ? parseDeterministicMovements(text, localDate())
        : null;
      result = direct?.length
        ? { intent: "add_movements", movements: direct }
        : await extractFromGemini({
          text,
          signal,
          mediaBase64: media?.base64,
          mimeType: media?.mimeType,
          activeDraftContext: formatDraftList(
            (draft?.items ?? []) as DraftListItem[],
          ),
        });
    } catch (error) {
      const failure = failureMetadata(
        signal.aborted ? providerFailure(error, "gemini", "timeout") : error,
      );
      if (failure.provider !== "gemini" && failure.provider !== "meta_media") {
        throw error;
      }
      writeOperationalLog("interpretation_fallback", failure);
      result = {
        intent: "request_text",
        movements: [],
        requestTextReason: failure.reason === "media_too_large"
          ? "size"
          : failure.reason === "unsupported_media"
          ? "type"
          : undefined,
      };
    }
    // Conservar la solicitud en la cola, sin bloquear el próximo texto ni
    // reintentar la IA si falla el guardado de la respuesta o su envío.
    if (
      result.intent === "unknown" ||
      (result.intent === "add_movements" &&
        (!Array.isArray(result.movements) || !result.movements.length ||
          result.movements.some((m) =>
            !Number.isFinite(m.totalAmountArs) || Number(m.totalAmountArs) <= 0
          )))
    ) {
      result = { intent: "request_text", movements: [] };
    }
    parent?.throwIfAborted();
    await checkpoint(result);
  }
  const requestText = () =>
    reply(
      result?.requestTextReason === "size"
        ? "El archivo es demasiado grande. Podés mandar una foto de hasta 5 MiB o un audio de hasta 10 MiB, o escribirme el concepto y el monto. No cargué movimientos de ese archivo."
        : result?.requestTextReason === "type"
        ? "No puedo leer ese formato de archivo. Mandame una foto JPG/PNG o escribime el gasto o ingreso con el concepto y el monto. No cargué movimientos de ese archivo."
        : message.audio?.id
        ? 'No pude interpretar tu audio. Escribime el gasto o ingreso con el concepto y el monto, por ejemplo: "Gasté 1500 en supermercado". Si eran varios, mandalos todos en texto. Todavía no cargué nada de ese audio.'
        : message.image?.id
        ? "No pude interpretar la imagen. Escribime el gasto o ingreso con el concepto y el monto. Si eran varios, mandalos todos en texto. Todavía no cargué nada de esa imagen."
        : 'No pude interpretar todos los datos. Escribime el gasto o ingreso con el concepto y el monto, por ejemplo: "Gasté 1500 en supermercado". Si eran varios, mandalos todos en texto. No cargué nada de ese mensaje.',
    );
  switch (result.intent) {
    case "request_text":
      return requestText();
    case "confirm":
      return { kind: "confirm" };
    case "cancel":
      return { kind: "cancel" };
    case "summary":
      return { kind: "summary" };
    case "remove_item":
      return result.removePosition
        ? { kind: "remove", position: result.removePosition }
        : reply("Indicame el número del movimiento que querés quitar.");
    case "edit_item": {
      const edit = result.edit;
      if (
        !edit?.targetPosition ||
        (edit.amount != null &&
          (!Number.isFinite(edit.amount) || edit.amount <= 0))
      ) {
        return reply(
          "Indicame el número del movimiento y el dato que querés corregir.",
        );
      }
      return {
        kind: "edit",
        position: edit.targetPosition,
        amount: edit.amount ?? null,
        description: edit.description ?? null,
      };
    }
    case "add_movements":
      if (correctionIntent) {
        return reply(
          'No pude identificar qué cambiar. Indicá el número y el dato a corregir, por ejemplo: "El 2 fue de 250". No agregué movimientos ni modifiqué la lista.',
        );
      }
      // No filtrar silenciosamente parte de un mensaje. BE-08 incorporará la
      // edición de datos faltantes; por ahora pedir el mensaje completo de nuevo.
      if (
        !Array.isArray(result.movements) || !result.movements.length ||
        result.movements.some((m) =>
          !Number.isFinite(m.totalAmountArs) || Number(m.totalAmountArs) <= 0
        )
      ) {
        return reply(
          "Falta el monto de alguna operación. No agregué parcialmente este mensaje. Reenviá la lista completa con sus importes.",
        );
      }
      return { kind: "add", items: result.movements };
    default:
      return requestText();
  }
}
