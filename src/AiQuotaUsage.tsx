import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from './supabase';

type QuotaLane = { lane: 'qwen' | 'whisper'; used: number; limit: number; enabled: boolean; level: 'ok' | 'warning' | 'critical' | 'exhausted'; per_user_limit?: number; top_users?: QuotaTopUser[] };
type QuotaTopUser = { user_id: string; name: string; used: number };
export type SaveResult = 'invalid' | 'denied' | 'failed' | null;
type OnSave = (lane: 'qwen' | 'whisper', daily: number, perUser: number) => Promise<SaveResult | void>;
const LANE_TEXT = { qwen: 'textos complejos y fotos', whisper: 'audios a texto' } as const;
export type AiQuotaSnapshot = { day: string; resets_at: string; lanes: QuotaLane[] };

export function parseAiQuotaSnapshot(value: unknown): AiQuotaSnapshot {
  const v = value as AiQuotaSnapshot;
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v.day) || !Number.isFinite(Date.parse(v.resets_at)) || !Array.isArray(v.lanes) || v.lanes.length !== 2) throw Error('INVALID_QUOTA_SNAPSHOT');
  const lanes = new Set<string>();
  for (const row of v.lanes) {
    if (!row || !['qwen', 'whisper'].includes(row.lane) || lanes.has(row.lane) || !Number.isSafeInteger(row.used) || row.used < 0 || !Number.isSafeInteger(row.limit) || row.limit < 1 || row.limit > 10000 || typeof row.enabled !== 'boolean' || !['ok', 'warning', 'critical', 'exhausted'].includes(row.level)) throw Error('INVALID_QUOTA_SNAPSHOT');
    if (row.per_user_limit !== undefined && (!Number.isSafeInteger(row.per_user_limit) || row.per_user_limit < 1 || row.per_user_limit > 10000)) throw Error('INVALID_QUOTA_SNAPSHOT');
    if (row.top_users !== undefined && (!Array.isArray(row.top_users) || row.top_users.length > 5 || row.top_users.some(u => !u || typeof u.user_id !== 'string' || typeof u.name !== 'string' || !Number.isSafeInteger(u.used) || u.used < 0))) throw Error('INVALID_QUOTA_SNAPSHOT');
    lanes.add(row.lane);
  }
  return v;
}

const LANE_LABEL = { qwen: 'Textos complejos y fotos', whisper: 'Audios a texto' } as const;
const RANGE_MESSAGE = 'Revisá los valores: entre 1 y 10000, y por cliente no mayor que el global.';
const isLimit = (n: number) => Number.isInteger(n) && n >= 1 && n <= 10000;

function LaneLimitsForm({ row, onSave }: { row: QuotaLane; onSave: OnSave }) {
  const [daily, setDaily] = useState(String(row.limit));
  const [perUser, setPerUser] = useState(String(row.per_user_limit ?? row.limit));
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const errorId = `ai-limits-error-${row.lane}`;
  const edit = (set: (v: string) => void) => (value: string) => { set(value); setMessage(null); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const d = daily.trim() === '' ? NaN : Number(daily), p = perUser.trim() === '' ? NaN : Number(perUser);
    if (!isLimit(d) || !isLimit(p) || p > d) { setMessage(RANGE_MESSAGE); return; }
    setSaving(true); setMessage(null);
    let result: SaveResult | void;
    try { result = await onSave(row.lane, d, p); } catch { result = 'failed'; }
    setSaving(false);
    setMessage(result === 'invalid' ? RANGE_MESSAGE : result === 'denied' ? 'No tenés permiso para cambiar los límites.' : result === 'failed' ? 'No pude guardar los límites. Probá de nuevo más tarde.' : null);
  }
  const invalid = message ? { 'aria-invalid': true, 'aria-describedby': errorId } : {};
  return <form className="bot-ops-limits" data-lane={row.lane} onSubmit={submit} noValidate aria-label={`Límites de ${LANE_TEXT[row.lane]}`}>
    <label>Límite global
      <input type="number" inputMode="numeric" min={1} max={10000} step={1} name={`${row.lane}-daily`} value={daily} onChange={e => edit(setDaily)(e.target.value)} {...invalid} />
    </label>
    <label>Límite por cliente
      <input type="number" inputMode="numeric" min={1} max={10000} step={1} name={`${row.lane}-per-user`} value={perUser} onChange={e => edit(setPerUser)(e.target.value)} {...invalid} />
    </label>
    <button type="submit" className="bot-ops-button" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
    {message && <p className="bot-ops-warning" role="alert" id={errorId}>{message}</p>}
  </form>;
}

// El aviso va junto al formulario del carril guardado: arriba de la sección quedaba fuera de la vista en el celular.
type SaveNotice = { lane: 'qwen' | 'whisper'; text: string };

export function AiQuotaView({ snapshot, onSave, stale = false, notice = null }: { snapshot: AiQuotaSnapshot; onSave?: OnSave; stale?: boolean; notice?: SaveNotice | null }) {
  const warnings = stale ? [] : snapshot.lanes.filter(r => r.used * 100 >= r.limit * 75 || !r.enabled);
  const critical = warnings.some(r => r.used * 100 >= r.limit * 90 || !r.enabled);
  return <section className="bot-ops-quota" aria-label="Cupo diario de IA">
    <h3>Cupo diario de IA</h3>
    <p className="bot-ops-meta">Global compartido · Reinicia a las 00:00 de Argentina</p>
    <ul>{snapshot.lanes.map(row => <li key={row.lane}>
      <span>{LANE_LABEL[row.lane]}</span>
      {!stale && <strong>{row.used} / {row.limit}</strong>}
      {!stale && <progress value={Math.min(row.used, row.limit)} max={row.limit} aria-label={row.lane === 'qwen' ? 'Uso de consultas complejas' : 'Uso de transcripciones'} />}
      {row.per_user_limit !== undefined && <span className="bot-ops-meta">Por cliente: {row.per_user_limit} por día</span>}
      {!stale && row.top_users && row.top_users.length > 0 && <ol className="bot-ops-top" aria-label={`Clientes con más uso: ${LANE_LABEL[row.lane]}`}>{row.top_users.map(u => <li key={u.user_id}>{u.name} — {u.used}</li>)}</ol>}
      {onSave && row.per_user_limit === undefined && <p className="bot-ops-meta">La edición de límites todavía no está disponible.</p>}
      {onSave && row.per_user_limit !== undefined && <details><summary>{`Editar límites: ${LANE_TEXT[row.lane]}`}</summary><LaneLimitsForm key={`${row.lane}-${row.limit}-${row.per_user_limit}`} row={row} onSave={onSave} /></details>}
      {notice?.lane === row.lane && <p className="bot-ops-meta bot-ops-saved" role="status">{notice.text}</p>}
    </li>)}</ul>
    {warnings.length > 0 && <p className="bot-ops-warning" role={critical ? 'alert' : 'status'}>
      {warnings.some(r => !r.enabled) ? 'La interpretación automática está pausada.'
        : warnings.some(r => r.used >= r.limit) ? 'Cupo alcanzado. Los textos simples y las confirmaciones siguen disponibles.'
        : critical ? 'Se usó al menos el 90% del cupo diario.' : 'Se usó al menos el 75% del cupo diario.'}
    </p>}
    <details><summary>Cómo se cuenta</summary><p className="bot-ops-meta">Se reserva una unidad antes de cada solicitud de IA, incluso si luego falla. Los textos simples, consultas locales y comandos no usan este cupo. Son límites de la app, no un importe facturado.</p></details>
  </section>;
}

export function AiQuotaUsage() {
  const [snapshot, setSnapshot] = useState<AiQuotaSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<SaveNotice | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    let active = true, fetching = false;
    const controller = new AbortController();
    async function load() {
      if (fetching || document.visibilityState === 'hidden') return;
      fetching = true;
      try {
        const result = await supabase.rpc('whatsapp_ai_quota_dashboard').abortSignal(controller.signal);
        if (!active) return;
        if (result.error) throw Error('QUOTA_READ');
        setSnapshot(parseAiQuotaSnapshot(result.data));
        setError(false);
      } catch {
        if (active) setError(true);
      } finally { fetching = false; }
    }
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    document.addEventListener('visibilitychange', load);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [revision]);
  async function save(lane: 'qwen' | 'whisper', daily: number, perUser: number): Promise<SaveResult> {
    const result = await supabase.rpc('admin_update_ai_quota_policy', { p_lane: lane, p_daily_limit: daily, p_per_user_daily_limit: perUser });
    if (result.error) return result.error.code === '22023' ? 'invalid' : result.error.code === '42501' ? 'denied' : 'failed';
    setNotice({ lane, text: `Límites de ${LANE_TEXT[lane]} guardados.` });
    setRevision(v => v + 1);
    return null;
  }
  // Ante un fallo no se muestran números viejos (INF-15), pero el formulario conserva lo tipeado.
  const failure = error && <div className="bot-ops-quota" role="alert">
    <p>No pude actualizar el cupo de IA.</p>
    <button type="button" className="bot-ops-button" onClick={() => setRevision(v => v + 1)}>Reintentar</button>
  </div>;
  if (!snapshot) return failure || <p className="bot-ops-meta" role="status">Consultando cupo de IA…</p>;
  return <>{failure}<AiQuotaView snapshot={snapshot} onSave={save} stale={error} notice={notice} /></>;
}
