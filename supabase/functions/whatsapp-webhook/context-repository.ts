import { OperationalFailure } from "./failures.ts";
import type { DatabaseOperation } from "./failures.ts";
import type { Job } from "./queue.ts";

export type WebhookDatabaseQuery<T = unknown> = PromiseLike<{
  data: T;
  error: unknown;
}> & {
  select: (columns: string) => WebhookDatabaseQuery<T>;
  eq: (column: string, value: unknown) => WebhookDatabaseQuery<T>;
  in?: (column: string, values: string[]) => PromiseLike<{
    data: T;
    error: unknown;
  }>;
  maybeSingle: () => PromiseLike<{ data: T; error: unknown }>;
};

export type WebhookDatabaseClient = {
  from: <T = unknown>(table: string) => WebhookDatabaseQuery<T>;
  rpc: <T = unknown>(
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: T; error: unknown }>;
};

export function checkedDbResult<T>(
  result: { data: T; error: unknown },
  code: DatabaseOperation,
): T {
  if (result.error) {
    throw new OperationalFailure("database_read", "database", undefined, code);
  }
  return result.data;
}

export type SystemConfigSnapshot = {
  botActive: boolean;
  supportPhone?: string;
  paymentAlias?: string;
};

export type ActorAccessOutcome =
  | {
    allowed: true;
    userId: string;
    role: string;
    supportDetails: string;
  }
  | {
    allowed: false;
    action: Record<string, unknown>;
  };

function parseSystemConfigRows(
  rows: unknown,
): { parsed: SystemConfigSnapshot | null } {
  if (!Array.isArray(rows) || rows.length === 0) return { parsed: null };
  const validRows = rows.filter(
    (r): r is { key: string; value: string } =>
      Boolean(
        r &&
          typeof r === "object" &&
          typeof (r as { key?: unknown }).key === "string" &&
          typeof (r as { value?: unknown }).value === "string",
      ),
  );
  if (validRows.length === 0) return { parsed: null };
  const botRow = validRows.find((r) => r.key === "bot_active");
  const phoneRow = validRows.find((r) => r.key === "support_phone");
  const aliasRow = validRows.find((r) => r.key === "payment_alias");
  return {
    parsed: {
      botActive: botRow ? botRow.value !== "false" : true,
      supportPhone: phoneRow?.value?.replace(/\D/g, ""),
      paymentAlias: aliasRow?.value?.trim(),
    },
  };
}

export function formatSupportContact(
  supportPhone?: string,
  paymentAlias?: string,
): string {
  const cleanPhone = supportPhone?.replace(/\D/g, "");
  const cleanAlias = paymentAlias?.trim();
  return `${
    cleanPhone ? `\n\n👉 Escribinos a soporte: https://wa.me/${cleanPhone}` : ""
  }${cleanAlias ? `\n💸 Alias para transferencias: *${cleanAlias}*` : ""}`;
}

async function readSupportDetailsFallback(
  db: WebhookDatabaseClient,
  cached?: SystemConfigSnapshot | null,
): Promise<string> {
  if (
    cached &&
    (cached.supportPhone !== undefined || cached.paymentAlias !== undefined)
  ) {
    return formatSupportContact(cached.supportPhone, cached.paymentAlias);
  }
  const query = db.from("system_config").select("key,value");
  const settings = typeof query.in === "function"
    ? checkedDbResult(
      await query.in("key", ["support_phone", "payment_alias"]),
      "QUEUE_CONFIG_READ",
    )
    : [];
  const phone = Array.isArray(settings)
    ? (settings as Array<{ key?: string; value?: string }>).find((row) =>
      row.key === "support_phone"
    )?.value
    : undefined;
  const alias = Array.isArray(settings)
    ? (settings as Array<{ key?: string; value?: string }>).find((row) =>
      row.key === "payment_alias"
    )?.value
    : undefined;
  return formatSupportContact(phone, alias);
}

/**
 * Resuelve la identidad vinculada, el estado de suscripción, el estado global
 * del bot y las preferencias del usuario ejecutando las lecturas en paralelo
 * cuando el job ya trae user_id asignado por el actor de la cola.
 */
export async function resolveActorAccess(
  db: WebhookDatabaseClient,
  job: Job,
): Promise<ActorAccessOutcome> {
  const message = job.payload;
  const reply = (body: string) => ({ kind: "reply", text: body });
  const blocked = (body: string | null) => ({
    kind: "reply",
    text: body,
    clear_summary: true,
  });

  const readConfigBatch = async (): Promise<SystemConfigSnapshot> => {
    const query = db.from("system_config").select("key,value");
    if (typeof query.in === "function") {
      const batchRes = checkedDbResult(
        await query.in("key", [
          "bot_active",
          "support_phone",
          "payment_alias",
        ]),
        "QUEUE_CONFIG_READ",
      );
      const { parsed } = parseSystemConfigRows(batchRes);
      if (parsed) return parsed;
    }
    const singleBot = checkedDbResult(
      await db
        .from<{ value?: string } | null>("system_config")
        .select("value")
        .eq("key", "bot_active")
        .maybeSingle(),
      "QUEUE_CONFIG_READ",
    );
    return {
      botActive: singleBot?.value !== "false",
    };
  };

  let link: { user_id: string } | null = null;
  let profile: {
    role: string;
    subscription_status: string;
    subscription_until: string | null;
  } | null = null;
  let configSnapshot: SystemConfigSnapshot | null = null;
  let settings: { whatsapp_responses_enabled?: boolean } | null = null;

  if (job.user_id) {
    // Ejecutar las 4 lecturas de contexto en paralelo (1 round-trip de red en lugar de 4 secuenciales)
    const [linkRes, profileRes, configRes, settingsRes] = await Promise.all([
      db
        .from<{ user_id: string } | null>("whatsapp_links")
        .select("user_id")
        .eq("wa_id", message.from)
        .eq("status", "active")
        .maybeSingle(),
      db
        .from<{
          role: string;
          subscription_status: string;
          subscription_until: string | null;
        } | null>("profiles")
        .select("role,subscription_status,subscription_until")
        .eq("id", job.user_id)
        .maybeSingle(),
      readConfigBatch(),
      db
        .from<{ whatsapp_responses_enabled?: boolean } | null>("app_settings")
        .select("whatsapp_responses_enabled")
        .eq("user_id", job.user_id)
        .maybeSingle(),
    ]);

    link = checkedDbResult(linkRes, "QUEUE_LINK_READ");
    if (!link) {
      return {
        allowed: false,
        action: reply(
          "Tu número no está vinculado a Pesito. Podés vincularlo generando un código desde la app.",
        ),
      };
    }
    if (job.user_id !== link.user_id) {
      return {
        allowed: false,
        action: reply(
          "El vínculo de tu cuenta cambió. No registré este mensaje. Revisá la cuenta vinculada y envialo nuevamente.",
        ),
      };
    }
    profile = checkedDbResult(profileRes, "QUEUE_PROFILE_READ");
    configSnapshot = configRes;
    settings = checkedDbResult(settingsRes, "QUEUE_SETTINGS_READ");
  } else {
    link = checkedDbResult(
      await db
        .from<{ user_id: string } | null>("whatsapp_links")
        .select("user_id")
        .eq("wa_id", message.from)
        .eq("status", "active")
        .maybeSingle(),
      "QUEUE_LINK_READ",
    );
    if (!link) {
      return {
        allowed: false,
        action: reply(
          "Tu número no está vinculado a Pesito. Podés vincularlo generando un código desde la app.",
        ),
      };
    }
    const [profileRes, configRes, settingsRes] = await Promise.all([
      db
        .from<{
          role: string;
          subscription_status: string;
          subscription_until: string | null;
        } | null>("profiles")
        .select("role,subscription_status,subscription_until")
        .eq("id", link.user_id)
        .maybeSingle(),
      readConfigBatch(),
      db
        .from<{ whatsapp_responses_enabled?: boolean } | null>("app_settings")
        .select("whatsapp_responses_enabled")
        .eq("user_id", link.user_id)
        .maybeSingle(),
    ]);
    profile = checkedDbResult(profileRes, "QUEUE_PROFILE_READ");
    configSnapshot = configRes;
    settings = checkedDbResult(settingsRes, "QUEUE_SETTINGS_READ");
  }

  if (!profile) {
    throw new OperationalFailure(
      "database_read",
      "database",
      undefined,
      "QUEUE_PROFILE_UNAVAILABLE",
    );
  }

  if (profile.role !== "admin") {
    if (profile.subscription_status === "suspended") {
      const support = await readSupportDetailsFallback(db, configSnapshot);
      return {
        allowed: false,
        action: blocked(
          `Tu cuenta de Pesito se encuentra en pausa ⏸️.${support}`,
        ),
      };
    }
    if (
      profile.role !== "client" ||
      profile.subscription_status !== "active" ||
      (profile.subscription_until !== null &&
        !(Date.parse(profile.subscription_until) > Date.now()))
    ) {
      const support = await readSupportDetailsFallback(db, configSnapshot);
      return {
        allowed: false,
        action: blocked(
          `Tu suscripción en Pesito ha finalizado ⏳.${support}`,
        ),
      };
    }
  }

  if (configSnapshot && !configSnapshot.botActive && profile.role !== "admin") {
    return {
      allowed: false,
      action: blocked(
        "Pesito: El bot se encuentra temporalmente en pausa por mantenimiento. Intentá nuevamente más tarde.",
      ),
    };
  }

  if (settings?.whatsapp_responses_enabled === false) {
    return {
      allowed: false,
      action: blocked(null),
    };
  }

  const supportDetails =
    configSnapshot &&
      (configSnapshot.supportPhone !== undefined ||
        configSnapshot.paymentAlias !== undefined)
      ? formatSupportContact(
        configSnapshot.supportPhone,
        configSnapshot.paymentAlias,
      )
      : "";

  return {
    allowed: true,
    userId: link.user_id,
    role: profile.role,
    supportDetails,
  };
}

export async function resolveSupportContact(
  db: WebhookDatabaseClient,
  preloadedSupportDetails: string,
): Promise<string> {
  if (preloadedSupportDetails) return preloadedSupportDetails;
  return await readSupportDetailsFallback(db, null);
}
