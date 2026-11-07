// Avisos posteriores a guardar un movimiento desde la PWA.

export const ENTRY_SAVED = 'Movimiento guardado.';
export const ENTRY_REPLAYED = 'Envío comprobado. Se guardó una sola vez.';
export const ENTRY_ALREADY_SAVED = 'El envío ya estaba guardado. Lo comprobamos sin duplicarlo.';
export const ENTRY_REMOVED_BEFORE = 'Ese envío ya se había guardado y después se eliminó. No lo volvimos a crear.';

/** Tiempo que permanece visible un aviso de éxito antes de ocultarse solo. */
export const ENTRY_NOTICE_TTL_MS = 5000;

const TRANSIENT = new Set([ENTRY_SAVED, ENTRY_REPLAYED, ENTRY_ALREADY_SAVED, ENTRY_REMOVED_BEFORE]);

/** Los avisos de éxito se ocultan solos y al cambiar de sección; los errores quedan hasta el próximo intento. */
export function isTransientEntryNotice(message: string): boolean {
  return TRANSIENT.has(message);
}
