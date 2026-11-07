// Estado de la barra lateral: el bot (servicio global) y el WhatsApp de la cuenta se muestran por separado.

export type BotService = 'running' | 'paused' | 'unknown';
export type WhatsAppLinkState = 'active' | 'paused' | 'unlinked' | 'cost-blocked' | 'loading' | 'unknown';
export type StatusTone = 'active' | 'paused' | 'unlinked' | 'cost-blocked' | 'loading' | 'unknown';
export type StatusLine = { tone: StatusTone; title: string; detail: string };

/**
 * Lee `system_config.bot_active` con la misma regla que el panel admin y las RPC:
 * solo el valor "false" pausa el bot. Una respuesta ilegible no inventa un estado.
 */
export function botServiceFromConfig(rows: unknown): BotService {
  if (!Array.isArray(rows)) return 'unknown';
  const row = rows.find((item) => item && typeof item === 'object' && (item as { key?: unknown }).key === 'bot_active') as
    | { value?: unknown }
    | undefined;
  return row?.value === 'false' ? 'paused' : 'running';
}

const BOT_LINES: Record<BotService | 'loading', StatusLine> = {
  running: { tone: 'active', title: 'Bot funcionando', detail: 'Recibe mensajes de WhatsApp' },
  paused: { tone: 'paused', title: 'Bot en pausa', detail: 'Pausado temporalmente' },
  unknown: { tone: 'unknown', title: 'Estado del bot no disponible', detail: 'Reintentamos en breve' },
  loading: { tone: 'loading', title: 'Comprobando bot', detail: 'Consultando estado' },
};

const WHATSAPP_LINES: Record<WhatsAppLinkState, StatusLine> = {
  active: { tone: 'active', title: 'WhatsApp vinculado', detail: 'Respuestas activadas' },
  paused: { tone: 'paused', title: 'WhatsApp vinculado', detail: 'Respuestas desactivadas' },
  unlinked: { tone: 'unlinked', title: 'WhatsApp sin vincular', detail: 'Conectalo desde Configuración' },
  'cost-blocked': { tone: 'cost-blocked', title: 'WhatsApp bloqueado', detail: 'Mensajes pagos no autorizados' },
  loading: { tone: 'loading', title: 'Comprobando WhatsApp', detail: 'Consultando tu cuenta' },
  unknown: { tone: 'unknown', title: 'WhatsApp: estado no disponible', detail: 'Revisá la configuración' },
};

export function sidebarStatus(service: BotService | 'loading', link: WhatsAppLinkState): [StatusLine, StatusLine] {
  // Un valor inesperado (p. ej. un snapshot de una versión anterior) no rompe la barra: se muestra como no disponible.
  return [
    Object.hasOwn(BOT_LINES, service) ? BOT_LINES[service] : BOT_LINES.unknown,
    Object.hasOwn(WHATSAPP_LINES, link) ? WHATSAPP_LINES[link] : WHATSAPP_LINES.unknown,
  ];
}
