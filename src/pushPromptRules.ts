// FE-26: invitación a activar notificaciones desde el Resumen, sin pasar por Ajustes.
// Los navegadores exigen que el permiso salga de un toque de la persona: la tarjeta
// solo ofrece el botón; nunca se pide permiso sola ni se activa sin consentimiento.
import type { PushState } from './pushNotifications';

/** Cuentas creadas antes de esta fecha ven la tarjeta como novedad. */
export const PUSH_LAUNCH_AT = Date.parse('2026-11-07T00:00:00-03:00');
export const PUSH_PROMPT_SNOOZE_MS = 7 * 86_400_000;
export const PUSH_PROMPT_MAX_DECLINES = 3;

export type PushPromptMemory = { declines: number; until: number };
export type PushPromptVariant = 'new' | 'announcement' | 'install';

const key = (userId: string) => `pesito:push-invitacion:${userId}`;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readPushPromptMemory(userId: string): PushPromptMemory {
  try {
    const raw = storage()?.getItem(key(userId));
    const parsed = raw ? JSON.parse(raw) as Partial<PushPromptMemory> : null;
    const declines = Number(parsed?.declines), until = Number(parsed?.until);
    return {
      declines: Number.isInteger(declines) && declines > 0 ? declines : 0,
      until: Number.isFinite(until) && until > 0 ? until : 0,
    };
  } catch {
    return { declines: 0, until: 0 };
  }
}

/** "Ahora no": vuelve en 7 días; al tercer rechazo no vuelve a aparecer. */
export function declinePushPrompt(userId: string, now: number): PushPromptMemory {
  const previous = readPushPromptMemory(userId);
  const next = { declines: previous.declines + 1, until: now + PUSH_PROMPT_SNOOZE_MS };
  try {
    storage()?.setItem(key(userId), JSON.stringify(next));
  } catch {
    // Sin almacenamiento la tarjeta se oculta solo hasta recargar.
  }
  return next;
}

export function pushPromptVariant(input: {
  state: PushState | null;
  memory: PushPromptMemory;
  accountCreatedAt: string | null | undefined;
  /** La bienvenida de WhatsApp tiene prioridad en el primer uso. */
  onboardingPending: boolean;
  now: number;
}): PushPromptVariant | null {
  const { state, memory, accountCreatedAt, onboardingPending, now } = input;
  if (onboardingPending) return null;
  if (state !== 'off' && state !== 'needs-install') return null;
  if (memory.declines >= PUSH_PROMPT_MAX_DECLINES || now < memory.until) return null;
  if (state === 'needs-install') return 'install';
  const created = accountCreatedAt ? Date.parse(accountCreatedAt) : NaN;
  return Number.isFinite(created) && created < PUSH_LAUNCH_AT ? 'announcement' : 'new';
}
