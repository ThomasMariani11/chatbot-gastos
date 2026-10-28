import { INSTALLMENT_BOUNDS_ERROR, isValidInstallmentSchedule } from './installmentPlans';
import { supabase } from './supabase';

export type EntryDraft = { type: 'movement' | 'plan'; payload: Record<string, unknown> };
export type EntryAttempt = EntryDraft & { version: 1; userId: string; requestId: string };
export type EntryResult = { state: 'saved' | 'removed' | 'cancelled'; entity_id: string | null; entry_type: 'movement' | 'plan'; replayed: boolean };
export type EntryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const key = (userId: string) => `pesito.pending-entry.v1:${userId}`;
const storageMessage = 'No pudimos conservar o recuperar el envío en este navegador. No enviamos otro movimiento. Revisá tus movimientos antes de borrar datos del navegador.';

export const browserEntryStorage: EntryStorage = {
  getItem: name => window.sessionStorage.getItem(name),
  setItem: (name, value) => window.sessionStorage.setItem(name, value),
  removeItem: name => window.sessionStorage.removeItem(name),
};

export function validateDraft(draft: EntryDraft): void {
  const p = draft.payload;
  const date = draft.type === 'plan' ? p.reference_date : p.occurred_on;
  const amount = Number(p.amount);
  if (!['movement', 'plan'].includes(draft.type) || typeof p.description !== 'string' || !p.description.trim() || p.description.trim().length > 160
    || !uuid.test(String(p.category_id)) || !['ARS','USD'].includes(String(p.currency)) || !Number.isFinite(amount) || amount <= 0 || amount > 999999999999.99
    || Number(amount.toFixed(2)) !== amount || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Revisá descripción, categoría, importe, moneda y fecha.');
  }
  const [year, month, day] = date.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31][month-1]) throw new Error('Ingresá una fecha válida.');
  if (draft.type === 'movement' && !['expense','income'].includes(String(p.kind))) throw new Error('Seleccioná un tipo válido.');
  if (draft.type === 'plan' && (!isValidInstallmentSchedule(p.installment_count, p.reference_number)
    || !['total','quota'].includes(String(p.amount_mode)))) throw new Error(INSTALLMENT_BOUNDS_ERROR);
}

export function readEntryAttempt(storage: EntryStorage, userId: string): EntryAttempt | null {
  try {
    const raw = storage.getItem(key(userId));
    if (raw === null) return null;
    if (raw.length > 8192) throw new Error('Invalid attempt');
    const attempt = JSON.parse(raw) as EntryAttempt;
    if (!attempt || attempt.version !== 1 || attempt.userId !== userId || !uuid.test(attempt.requestId) || !attempt.payload || typeof attempt.payload !== 'object' || Array.isArray(attempt.payload)) throw new Error('Invalid attempt');
    validateDraft(attempt);
    return attempt;
  } catch { throw new Error(storageMessage); }
}

function parseResult(data: unknown): EntryResult {
  if (!data || typeof data !== 'object') throw new Error('No pudimos comprobar el resultado del envío.');
  const r = data as EntryResult;
  if (!['saved','removed','cancelled'].includes(r.state) || !['movement','plan'].includes(r.entry_type) || typeof r.replayed !== 'boolean'
    || (r.state === 'cancelled' ? r.entity_id !== null : !uuid.test(String(r.entity_id)))) throw new Error('No pudimos comprobar el resultado del envío.');
  return r;
}

export async function sendEntryAttempt(attempt: EntryAttempt, cancel: boolean): Promise<EntryResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    const { data, error } = await supabase.rpc('submit_pwa_entry', {
      p_request_id: attempt.requestId, p_entry_type: attempt.type, p_payload: cancel ? {} : attempt.payload, p_cancel: cancel,
    }).abortSignal(controller.signal);
    if (error) throw error;
    return parseResult(data);
  } finally { window.clearTimeout(timer); }
}

/** Un UUID por intención. Se persiste antes de enviar y se borra solo tras un resultado válido. */
export class EntrySender {
  busy = false;
  private active = true;
  private generation = 0;
  activate() { this.active = true; this.generation++; }
  deactivate() { this.active = false; this.generation++; }
  constructor(readonly userId: string, private storage: EntryStorage, private send = sendEntryAttempt, private newId = () => crypto.randomUUID()) {}
  pending(): EntryAttempt | null { return readEntryAttempt(this.storage, this.userId); }
  async run(draft?: EntryDraft, cancel = false): Promise<{ result: EntryResult; attempt: EntryAttempt } | null> {
    if (this.busy || !this.active) return null;
    const generation = this.generation;
    this.busy = true;
    try {
      let attempt = this.pending();
      if (!attempt) {
        if (!draft || cancel) return null;
        validateDraft(draft);
        attempt = JSON.parse(JSON.stringify({ ...draft, version: 1, userId: this.userId, requestId: this.newId() })) as EntryAttempt;
        try {
          this.storage.setItem(key(this.userId), JSON.stringify(attempt));
          if (this.pending()?.requestId !== attempt.requestId) throw new Error('Persistence failed');
        } catch { throw new Error(storageMessage); }
      } else if (draft && (attempt.type !== draft.type || JSON.stringify(attempt.payload) !== JSON.stringify(draft.payload))) {
        throw new Error('Primero comprobá o cancelá el envío pendiente. No se envió otro movimiento.');
      }
      const result = parseResult(await this.send(attempt, cancel));
      if (!this.active || generation !== this.generation) return null;
      if (result.entry_type !== attempt.type) throw new Error('No pudimos comprobar el resultado del envío.');
      try {
        const current = this.pending();
        if (current && current.requestId !== attempt.requestId) throw new Error('Attempt changed');
        this.storage.removeItem(key(this.userId));
        if (this.storage.getItem(key(this.userId)) !== null) throw new Error('Removal failed');
      } catch { throw new Error('El servidor respondió, pero no pudimos cerrar el envío en este navegador. Volvé a comprobarlo; no crees otra operación.'); }
      return { result, attempt };
    } finally { this.busy = false; }
  }
}

export function entryError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === '42501') return 'Revisá que tu cuenta esté activa y que la categoría te pertenezca. El envío sigue pendiente de comprobación.';
  if (['22023','22P02','22003','22008'].includes(code)) return 'El servidor rechazó los datos. Cancelá este envío para corregirlos sin duplicar movimientos.';
  if (['PGRST202','42883'].includes(code)) return 'El guardado seguro todavía no está disponible. Conservamos el envío para comprobarlo más tarde.';
  return error instanceof Error && !code && !/fetch|network|abort|timeout/i.test(error.message) ? error.message
    : 'No pudimos confirmar si se guardó. Comprobá el envío o cancelalo antes de cargar otro.';
}
