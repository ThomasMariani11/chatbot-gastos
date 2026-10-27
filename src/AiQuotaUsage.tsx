import { useEffect, useState } from 'react';
import { supabase } from './supabase';

type QuotaLane = { lane: 'qwen' | 'whisper'; used: number; limit: number; enabled: boolean; level: 'ok' | 'warning' | 'critical' | 'exhausted' };
export type AiQuotaSnapshot = { day: string; resets_at: string; lanes: QuotaLane[] };

export function parseAiQuotaSnapshot(value: unknown): AiQuotaSnapshot {
  const v = value as AiQuotaSnapshot;
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v.day) || !Number.isFinite(Date.parse(v.resets_at)) || !Array.isArray(v.lanes) || v.lanes.length !== 2) throw Error('INVALID_QUOTA_SNAPSHOT');
  const lanes = new Set<string>();
  for (const row of v.lanes) {
    if (!row || !['qwen', 'whisper'].includes(row.lane) || lanes.has(row.lane) || !Number.isSafeInteger(row.used) || row.used < 0 || !Number.isSafeInteger(row.limit) || row.limit < 1 || row.limit > 10000 || typeof row.enabled !== 'boolean' || !['ok', 'warning', 'critical', 'exhausted'].includes(row.level)) throw Error('INVALID_QUOTA_SNAPSHOT');
    lanes.add(row.lane);
  }
  return v;
}

export function AiQuotaView({ snapshot }: { snapshot: AiQuotaSnapshot }) {
  const warnings = snapshot.lanes.filter(r => r.used * 100 >= r.limit * 75 || !r.enabled);
  const critical = warnings.some(r => r.used * 100 >= r.limit * 90 || !r.enabled);
  return <section className="bot-ops-quota" aria-label="Cupo diario de IA">
    <h3>Cupo diario de IA</h3>
    <p className="bot-ops-meta">Compartido · Reinicia a las 00:00 de Argentina</p>
    <ul>{snapshot.lanes.map(row => <li key={row.lane}>
      <span>{row.lane === 'qwen' ? 'Textos complejos y fotos' : 'Audios a texto'}</span>
      <strong>{row.used} / {row.limit}</strong>
      <progress value={Math.min(row.used, row.limit)} max={row.limit} aria-label={row.lane === 'qwen' ? 'Uso de consultas complejas' : 'Uso de transcripciones'} />
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
  if (error) return <div className="bot-ops-quota" role="alert">
    <p>No pude actualizar el cupo de IA.</p>
    <button type="button" className="bot-ops-button" onClick={() => setRevision(v => v + 1)}>Reintentar</button>
  </div>;
  return snapshot ? <AiQuotaView snapshot={snapshot} /> : <p className="bot-ops-meta" role="status">Consultando cupo de IA…</p>;
}
