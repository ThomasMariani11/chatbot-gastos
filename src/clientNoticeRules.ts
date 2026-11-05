// FE-25: avisos de cliente en la PWA (vencimiento de membresía y recordatorio de registro).
// Lógica pura + lectura acotada. Sin envío por WhatsApp: eso queda para una etapa posterior.

const DAY_MS = 86_400_000;
export const SUBSCRIPTION_NOTICE_DAYS = 7;
export const REGISTRATION_REMINDER_DAYS = 3;

type SubscriptionProfile = {
  role: string;
  subscription_status: string;
  subscription_until: string | null;
};

export type SubscriptionNotice = {
  id: 'subscription-7' | 'subscription-1';
  level: 'warning' | 'urgent';
  daysLeft: number;
  until: string;
};

/** Aviso de vencimiento para clientes activos a 7 días o menos (urgente a 1 día o menos). */
export function subscriptionNotice(profile: SubscriptionProfile | null | undefined, now = Date.now()): SubscriptionNotice | null {
  if (!profile || profile.role !== 'client' || profile.subscription_status !== 'active') return null;
  if (!profile.subscription_until) return null;
  const until = Date.parse(profile.subscription_until);
  if (!Number.isFinite(until) || until <= now) return null;
  const daysLeft = Math.ceil((until - now) / DAY_MS);
  if (daysLeft > SUBSCRIPTION_NOTICE_DAYS) return null;
  const urgent = daysLeft <= 1;
  return { id: urgent ? 'subscription-1' : 'subscription-7', level: urgent ? 'urgent' : 'warning', daysLeft, until: profile.subscription_until };
}

export type RegistrationReminder = { id: 'registration'; kind: 'never' | 'stale'; days: number };

/**
 * Recordatorio de registro. `enabled` null significa preferencia desconocida
 * (lectura fallida o migración 045 sin aplicar): no se muestra nada.
 * `lastMovementAt` undefined significa lectura fallida; null, que no hay movimientos.
 */
export function registrationReminder(
  enabled: boolean | null,
  lastMovementAt: string | null | undefined,
  now = Date.now(),
): RegistrationReminder | null {
  if (enabled !== true || lastMovementAt === undefined) return null;
  if (lastMovementAt === null) return { id: 'registration', kind: 'never', days: 0 };
  const last = Date.parse(lastMovementAt);
  if (!Number.isFinite(last)) return null;
  const days = Math.floor((now - last) / DAY_MS);
  return days >= REGISTRATION_REMINDER_DAYS ? { id: 'registration', kind: 'stale', days } : null;
}

export function formatNoticeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

/** Fecha local argentina (YYYY-MM-DD) usada para ocultar un aviso solo por el día. */
export function noticeDay(now = Date.now()): string {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

const dismissKey = (userId: string, noticeId: string) => `pesito:aviso-oculto:${userId}:${noticeId}`;

export function isNoticeDismissed(userId: string, noticeId: string, now = Date.now()): boolean {
  try {
    return window.localStorage.getItem(dismissKey(userId, noticeId)) === noticeDay(now);
  } catch {
    return false;
  }
}

export function dismissNotice(userId: string, noticeId: string, now = Date.now()): void {
  try {
    window.localStorage.setItem(dismissKey(userId, noticeId), noticeDay(now));
  } catch {
    // Sin almacenamiento: el aviso se oculta solo en esta vista.
  }
}

type QueryResult = { data: unknown; error: unknown };
type ReminderClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<QueryResult>;
        eq(column: string, value: string): {
          order(column: string, options: { ascending: boolean }): {
            limit(count: number): PromiseLike<QueryResult>;
          };
        };
      };
    };
  };
};

export type ReminderState = { enabled: boolean | null; lastMovementAt: string | null | undefined };

/**
 * Lee la preferencia y, solo si está activa, la fecha del último movimiento confirmado.
 * Cualquier error deja el aviso oculto en lugar de afirmar algo incierto.
 */
export async function loadReminderState(client: ReminderClient, userId: string): Promise<ReminderState> {
  let enabled: boolean | null = null;
  try {
    const settings = await client.from('app_settings').select('client_reminders_enabled').eq('user_id', userId).maybeSingle();
    const value = (settings.data as { client_reminders_enabled?: unknown } | null)?.client_reminders_enabled;
    if (!settings.error && typeof value === 'boolean') enabled = value;
  } catch {
    enabled = null;
  }
  if (enabled !== true) return { enabled, lastMovementAt: undefined };

  try {
    const latest = await client
      .from('transactions')
      .select('created_at')
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(1);
    if (latest.error || !Array.isArray(latest.data)) return { enabled, lastMovementAt: undefined };
    const row = latest.data[0] as { created_at?: unknown } | undefined;
    if (!row) return { enabled, lastMovementAt: null };
    return { enabled, lastMovementAt: typeof row.created_at === 'string' ? row.created_at : undefined };
  } catch {
    return { enabled, lastMovementAt: undefined };
  }
}
