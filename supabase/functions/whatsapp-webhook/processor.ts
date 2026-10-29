import { formatOverLimitReply } from "./draft-summary.ts";
import { buildPendingEdit, parsePendingEdit } from "./draft-edit.ts";
import { formatMonthlySnapshot } from "./monthly-summary.ts";
import { AiQuotaExceeded } from "./ai-quota.ts";
import type { BeforeAiRequest } from "./ai-quota.ts";
import { parseDraftCompletion } from "./draft-completion.ts";
import { normalizeDraftMovements } from "./draft-normalization.ts";
import { parseDraftMovements } from "./local-movements.ts";
import { parseLocalCommand } from "./local-commands.ts";
import { LIMITS, timeoutSignal } from "./limits.ts";
import type { DatabaseOperation, FailureMetadata } from "./failures.ts";
import {
  failureMetadata,
  providerFailure,
} from "./failures.ts";
import { writeOperationalLog } from "./logging.ts";
import type { Job } from "./queue.ts";
import { classifyTextQuery } from "./intent.ts";
import { looksLikeDraftCorrection } from "./draft-corrections.ts";
import {
  downloadWhatsAppMedia,
  extractFromGemini,
  formatDraftList,
  sha256,
} from "./helpers.ts";
import type { DraftListItem, GeminiParsedOutput } from "./helpers.ts";
import {
  checkedDbResult,
  resolveActorAccess,
  resolveSupportContact,
  type WebhookDatabaseClient,
} from "./context-repository.ts";

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

type ActiveDraftRecord = {
  group_id?: string;
  version?: number;
  items?: DraftListItem[];
  is_stale?: boolean;
};

function checked<T>(
  result: { data: T; error: unknown },
  code: DatabaseOperation,
): T {
  return checkedDbResult(result, code);
}
const localDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export async function prepareMessage(
  db: WebhookDatabaseClient,
  job: Job,
  checkpoint: (result: unknown) => Promise<void>,
  parent?: AbortSignal,
  beforeAiRequest?: BeforeAiRequest,
): Promise<Record<string, unknown>> {
  const message = job.payload;
  const text = message.text?.body?.trim() ?? message.image?.caption?.trim() ??
    "";
  const reply = (body: string) => ({ kind: "reply", text: body });
  const linkMatch = text.match(/^vincular\s+(\d{6})$/i);
  if (linkMatch) return { kind: "link", hash: await sha256(linkMatch[1]) };

  const access = await resolveActorAccess(db, job);
  if (!access.allowed) return access.action;

  const correctionIntent = !message.image?.id && !message.audio?.id &&
    looksLikeDraftCorrection(text);
  const query = correctionIntent ? null : classifyTextQuery(
    text,
    Boolean(message.image?.id || message.audio?.id),
    localDate(),
  );
  if (query === "clarify") {
    return reply(
      "No agregué ni modifiqué movimientos de este mensaje. Mandame el gasto o ingreso y la consulta por separado. Si solo querías cargar un movimiento, indicá el concepto y el importe. Tu lista pendiente se conserva; podés verla con RESUMEN.",
    );
  }
  if (query === "commercial") {
    const support = await resolveSupportContact(db, access.supportDetails);
    return reply(
      `¡Hola! 👋 Para renovar tu membresía en Pesito o consultar planes y medios de pago:${support}\n\nComunicate con soporte para activar tu cuenta.`,
    );
  }
  const command = !message.image?.id && !message.audio?.id
    ? parseLocalCommand(text)
    : null;
  if (command) {
    writeOperationalLog("local_rule", { rule: "command" });
    return command;
  }

  if (query === "balance") {
    const month = localDate().slice(0, 7);
    const snapshot = checked(
      await db.rpc("whatsapp_monthly_summary", {
        p_user_id: access.userId,
        p_month: month + "-01",
      }),
      "QUEUE_BALANCE_READ",
    );
    return reply(formatMonthlySnapshot(snapshot, month));
  }

  // Verificar compatibilidad de mensaje antes de consultar el borrador en la base de datos.
  if (!text && !message.image?.id && !message.audio?.id) {
    return reply(
      "Este tipo de mensaje no es compatible. Podés enviar texto, audio o una foto.",
    );
  }

  const draft = checked(
    await db.rpc<ActiveDraftRecord | null>("get_active_draft_group", {
      p_user_id: access.userId,
    }),
    "QUEUE_DRAFT_READ",
  );
  if (draft?.is_stale) return { kind: "summary" }; // SQL retiene el mensaje antes de interpretarlo.
  if (!message.image?.id && !message.audio?.id) {
    const completion = parseDraftCompletion(text, draft ?? {}, localDate());
    if (completion) return completion;
  }
  const correction = correctionIntent
    ? parsePendingEdit(text, draft ?? {})
    : null;
  if (correction?.kind === "edit") {
    writeOperationalLog("local_rule", { rule: "correction" });
    return correction;
  }
  let result = job.parsed_result as GeminiParsedOutput | null;
  if (!result) {
    let interpretationIssue: FailureMetadata | undefined;
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
      const direct = text && !media && !correctionIntent
        ? parseDraftMovements(text, localDate())
        : null;
      if (direct?.length) {
        writeOperationalLog("local_rule", {
          rule: "movements",
          operations: direct.length,
        });
      }
      result = direct?.length
        ? { intent: "add_movements", movements: direct }
        : await extractFromGemini({
          text,
          signal,
          beforeAiRequest,
          mediaBase64: media?.base64,
          mimeType: media?.mimeType,
          resolveCompletion: (transcript) => {
            const completion = parseDraftCompletion(
              transcript,
              draft ?? {},
              localDate(),
            );
            const edit = completion
              ? null
              : parsePendingEdit(transcript, draft ?? {});
            if (edit) {
              return edit.kind === "edit"
                ? { intent: "edit_pending", movements: [], pendingEdit: edit }
                : {
                  intent: "clarify_completion",
                  movements: [],
                  completionReply: edit.text,
                };
            }
            return completion
              ? completion.kind === "complete"
                ? { intent: "complete_item", movements: [], completion }
                : {
                  intent: "clarify_completion",
                  movements: [],
                  completionReply: completion.text,
                }
              : null;
          },
          activeDraftContext: formatDraftList(
            (draft?.items ?? []) as DraftListItem[],
          ),
        });
    } catch (error) {
      const failure = failureMetadata(
        signal.aborted
          ? providerFailure(
            error,
            Deno.env.get("GROQ_API_KEY") ? "groq" : "gemini",
            "timeout",
          )
          : error,
      );
      if (
        failure.provider !== "gemini" &&
        failure.provider !== "groq" &&
        failure.provider !== "meta_media"
      ) {
        throw error;
      }
      interpretationIssue = failure;
      writeOperationalLog("interpretation_fallback", failure);
      result = {
        intent: "request_text",
        movements: [],
        requestTextReason: error instanceof AiQuotaExceeded
          ? "quota"
          : failure.reason === "media_too_large"
          ? "size"
          : failure.reason === "unsupported_media"
          ? "type"
          : undefined,
      };
    }
    // Conservar la solicitud en la cola, sin bloquear el próximo texto ni
    // reintentar la IA si falla el guardado de la respuesta o su envío.
    if (result.intent === "add_movements" && result.movements?.length <= 20) {
      try {
        if (result.movements?.every((m) => m.totalAmountArs != null && m.occurredOn != null && m.description)) {
          delete result.clarification;
          for (const m of result.movements) {
            if (m.totalAmountArs != null && m.occurredOn != null && m.description) {
              m.clarification = null;
              if (Array.isArray(m.missingFields)) {
                m.missingFields = m.missingFields.filter((f) => f !== "review");
              }
            }
          }
        }
        result.movements = normalizeDraftMovements(
          result.movements,
          localDate(),
          result.clarification,
        );
        delete result.clarification;
      } catch {
        result = { intent: "request_text", movements: [] };
      }
    }
    if (result.intent === "unknown") {
      result = { intent: "request_text", movements: [] };
    }
    if (result.intent === "request_text") {
      result.operationalFailure = interpretationIssue ??
        { reason: "invalid_response" };
    }
    if (result.intent === "edit_item") {
      const editList = Array.isArray(result.edits) && result.edits.length > 0
        ? result.edits
        : result.edit?.targetPosition != null
        ? [result.edit]
        : [];
      if (editList.length > 0) {
        const validatedEdits = [];
        for (const e of editList) {
          const patch = {
            ...(e?.amount != null ? { amount: e.amount } : {}),
            ...(e?.description != null ? { description: e.description } : {}),
            ...(e?.category != null ? { category: e.category } : {}),
          };
          const action = buildPendingEdit(
            e.targetPosition ?? 0,
            patch,
            draft ?? {},
          );
          if (action.kind === "edit") {
            validatedEdits.push({ position: action.position, patch: action.patch });
          }
        }
        if (validatedEdits.length > 0 && draft?.group_id && draft?.version) {
          result = {
            intent: "edit_pending",
            movements: [],
            pendingEdit: {
              kind: "edit",
              position: validatedEdits[0].position,
              group_id: draft.group_id,
              version: draft.version,
              patch: validatedEdits[0].patch,
              edits: validatedEdits,
            },
          };
        } else {
          result = {
            intent: "clarify_completion",
            movements: [],
            completionReply:
              "No pude aplicar las modificaciones a la lista. Revisala con RESUMEN.",
          };
        }
      }
    }
    parent?.throwIfAborted();
    await checkpoint(result);
  }
  const requestText = () =>
    reply(
      result?.requestTextReason === "quota"
        ? 'Llegamos al cupo diario de interpretación automática. Tus pendientes se conservan. Pasame el gasto o ingreso en texto simple, por ejemplo: "Gasté 1500 en supermercado". Podés seguir revisando, confirmando o cancelando tu lista. No cargué movimientos de este mensaje.'
        : result?.requestTextReason === "size"
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
    case "edit_pending":
      return result.pendingEdit ??
        reply("No pude aplicar la corrección. Revisá tu lista con RESUMEN.");
    case "complete_item":
      return result.completion ??
        reply(
          "Indicá el movimiento y el dato faltante. No modifiqué la lista.",
        );
    case "clarify_completion":
      return reply(
        result.completionReply ??
          "Indicá el movimiento y el dato faltante. No modifiqué la lista.",
      );
    case "request_text":
      return requestText();
    case "confirm":
      return { kind: "confirm" };
    case "cancel":
      return { kind: "cancel" };
    case "summary":
      return { kind: "summary" };
    case "remove_item": {
      const positions = Array.isArray(result.removePositions) && result.removePositions.length > 0
        ? result.removePositions
        : result.removePosition
        ? [result.removePosition]
        : [];
      if (positions.length > 0) {
        return {
          kind: "remove",
          position: positions[0],
          positions,
        };
      }
      return reply("Indicame el número del movimiento que querés quitar.");
    }
    case "edit_item":
      // Checkpoint anterior al contrato versionado: no reinterpretar su destino.
      return reply(
        "Revisá la lista con RESUMEN y repetí la corrección indicando el número y el dato. No modifiqué la lista.",
      );
    case "add_movements":
      if (result.movements?.length > 20) {
        return reply(formatOverLimitReply(result.movements.length));
      }
      if (correctionIntent) {
        return reply(
          'No pude identificar qué cambiar. Indicá el número y el dato a corregir, por ejemplo: "El 2 fue de 250". No agregué movimientos ni modifiqué la lista.',
        );
      }
      try {
        if (result.movements?.every((m) => m.totalAmountArs != null && m.occurredOn != null && m.description)) {
          delete result.clarification;
          for (const m of result.movements) {
            if (m.totalAmountArs != null && m.occurredOn != null && m.description) {
              m.clarification = null;
              if (Array.isArray(m.missingFields)) {
                m.missingFields = m.missingFields.filter((f) => f !== "review");
              }
            }
          }
        }
        result.movements = normalizeDraftMovements(
          result.movements,
          localDate(),
          result.clarification,
        );
      } catch {
        return requestText();
      }
      return { kind: "add", items: result.movements };
    default:
      return requestText();
  }
}
