// Contrato compartido por el panel y los avisos. Sin payloads ni excepciones crudas.
export type OperationalIssue = {
  id: string;
  client_name: string;
  client_reference: string | null;
  occurred_at: string;
  time_source: "error" | "received";
  source_kind: string;
  state: string;
  attempts: number;
  diagnostic_available: boolean;
  stage: string | null;
  reason: string | null;
  provider: string | null;
  status: number | null;
  operation: string | null;
};
const reasons: Record<string, string> = {
  configuration: "Falta configurar el servicio",
  timeout: "El servicio no respondió dentro del tiempo límite",
  authentication: "El proveedor rechazó la credencial o el permiso",
  rate_limit: "Se alcanzó el límite de solicitudes del proveedor",
  unavailable: "El proveedor no estaba disponible",
  request_rejected: "El proveedor rechazó la solicitud",
  network: "Falló la conexión con el servicio",
  invalid_response:
    "No se pudo interpretar una respuesta válida o faltaron datos",
  database_read: "No se pudieron consultar los datos necesarios",
  unknown: "No se registró una causa técnica específica",
  media_too_large: "El archivo supera el tamaño permitido",
  payload_too_large: "La respuesta supera el tamaño permitido",
  unsupported_media: "El formato del archivo no está admitido",
};
const stages: Record<string, string> = {
  interpret: "Interpretación",
  checkpoint: "Conservación de la interpretación",
  apply: "Preparación o confirmación de movimientos",
  send: "Envío de respuesta",
  finish: "Registro del resultado del envío",
};
const providers: Record<string, string> = {
  gemini: "Gemini",
  groq: "Groq",
  meta_media: "Descarga desde WhatsApp",
  meta_send: "WhatsApp",
  database: "Base de datos",
};
const operations: Record<string, string> = {
  QUEUE_LINK_READ: "vínculo",
  QUEUE_PROFILE_READ: "perfil",
  QUEUE_PROFILE_UNAVAILABLE: "perfil no disponible",
  QUEUE_CONFIG_READ: "configuración del bot",
  QUEUE_SETTINGS_READ: "preferencias",
  QUEUE_BALANCE_READ: "saldo",
  QUEUE_BUDGET_READ: "presupuesto",
  QUEUE_DRAFT_READ: "lista pendiente",
};
export function safeClientName(value: unknown): string {
  return typeof value === "string"
    ? value.replace(
      // deno-lint-ignore no-control-regex -- Quitar controles y bidi es intencional en nombres mostrados.
      /[\u0000-\u001f\u007f-\u009f\u200e-\u200f\u202a-\u202e\u2066-\u2069*_~`]/g,
      " ",
    ).replace(/\s+/g, " ").trim().slice(0, 120) || "Cliente sin nombre"
    : "Cliente sin nombre";
}
export function issueSource(value: string): string {
  return ({ audio: "Audio", image: "Foto", text: "Texto" } as Record<
    string,
    string
  >)[value] ?? "Mensaje";
}
export function issueTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Fecha no registrada";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
export function issueDescription(issue: OperationalIssue): string {
  if (!issue.diagnostic_available) {
    return "Causa técnica no registrada para este mensaje. Revisar el incidente.";
  }
  const prefix = [stages[issue.stage ?? ""], providers[issue.provider ?? ""]]
    .filter(Boolean).join(" · ");
  const detail = reasons[issue.reason ?? ""] ?? reasons.unknown;
  const status =
    Number.isInteger(issue.status) && Number(issue.status) >= 100 &&
      Number(issue.status) <= 599
      ? " (HTTP " + issue.status + ")"
      : "";
  const operation = operations[issue.operation ?? ""];
  return (prefix ? prefix + ": " : "") + detail + status +
    (operation ? " · Consulta de " + operation : "");
}
