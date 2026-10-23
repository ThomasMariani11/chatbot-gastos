import { issueDescription, issueSource, issueTimestamp, safeClientName } from '../supabase/functions/whatsapp-webhook/issue-details.ts';
import type { OperationalIssue } from '../supabase/functions/whatsapp-webhook/issue-details.ts';
import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

type Alert = { code: string; severity: string; affected: number; oldest_seconds: number; acknowledged_at: string | null; details?: OperationalIssue[]; details_total?: number };
type Metric = { event: string; samples: number; average_ms: number; maximum_ms: number; operations: number };
type Snapshot = {
  observed_at: string;
  config: { whatsapp_enabled: boolean; cost_verified: boolean; window_open: boolean; is_recipient: boolean; last_scan_at: string | null; retention_enabled: boolean; retention_days: number };
  queue: { pending: number; processing: number; failed: number; manual_review: number; waiting_customer: number };
  alerts: Alert[]; metrics: Metric[]; recent_issues?: OperationalIssue[];
  recent_notifications: Array<{ state: string; attempts: number; created_at: string }>;
  retention_eligible: number;
};
const labels: Record<string, string> = {
  queue_delay: 'Mensajes demorados más de dos minutos',
  repeated_failures: 'Mensajes con fallos repetidos',
  manual_review: 'Mensajes para revisión manual',
  recovery_failure: 'Recuperación programada sin respuesta reciente',
  interpretation_fallback: 'Varios mensajes necesitaron pasarse a texto',
};
const metricLabels: Record<string, string> = {
  queue_wait: 'Espera en cola', queue_interpret: 'Interpretación', queue_send: 'Envío de respuestas',
};
function IssueDetail({issue}:{issue:OperationalIssue}) {
  const name=safeClientName(issue.client_name);
  return <article aria-label={'Incidente de '+name} style={{padding:'12px 0',borderBottom:'1px solid #e5e7eb',overflowWrap:'anywhere'}}>
    <strong>{name}</strong>{issue.client_reference && <small> · Ref. {issue.client_reference}</small>}
    <p style={{margin:'6px 0'}}>{issueSource(issue.source_kind)} · {issue.time_source==='received'?'Recibido':'Error registrado'}: <time dateTime={issue.occurred_at}>{issueTimestamp(issue.occurred_at)}</time> (Argentina)</p>
    <p style={{margin:'6px 0'}}>{issueDescription(issue)}</p>
    <small>Intentos del mensaje: {issue.attempts} · {issue.state==='processed'?'Mensaje terminado':issue.state==='waiting'?'En revisión':issue.state==='processing'?'En proceso':issue.state==='failed'?'Con fallos':'En cola'}</small>
  </article>;
}
export function BotOperations() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true, fetching = false;
    const controller = new AbortController();
    async function load() {
      if (fetching || document.visibilityState === 'hidden') return;
      fetching = true;
      try {
        const result = await supabase.rpc('whatsapp_ops_dashboard').abortSignal(controller.signal);
        if (!active) return;
        if (result.error) { setError('No pude actualizar el estado del bot. Volvé a intentar.'); return; }
        setSnapshot(result.data as Snapshot); setError(null);
      } catch { if (active) setError('No pude actualizar el estado del bot. Volvé a intentar.'); }
      finally { fetching = false; }
    }
    void load();
    const timer = window.setInterval(() => { void load(); }, 30000);
    document.addEventListener('visibilitychange', load);
    return () => { active = false; controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [refresh]);
  async function action(name: 'configure_whatsapp_ops_alerts' | 'acknowledge_whatsapp_ops_alert', args: Record<string, unknown>) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await supabase.rpc(name, args);
      if (!mounted.current) return;
      if (result.error) { setError(name === 'configure_whatsapp_ops_alerts' ? 'No pude cambiar las alertas. Verificá que tu WhatsApp esté vinculado.' : 'No pude marcar la alerta como revisada.'); return; }
      setRefresh(v => v + 1);
    } catch { if (mounted.current) setError('No pude completar la acción. Volvé a intentar.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  const stale = !snapshot?.config.last_scan_at || Date.now() - Date.parse(snapshot.config.last_scan_at) > 180000;
  const deliveryProblem = snapshot?.recent_notifications[0] && ['failed', 'uncertain', 'blocked'].includes(snapshot.recent_notifications[0].state);
  return (
    <section className="admin-generator-card" aria-labelledby="bot-operations-heading" style={{ marginBottom: 24 }}>
      <div className="generator-header">
        <div><p className="eyebrow">MONITOREO</p><h2 id="bot-operations-heading">Estado del bot</h2><p>Se actualiza cada 30 segundos mientras este panel está visible.</p></div>
        <button type="button" className="admin-header-btn secondary" onClick={() => setRefresh(v => v + 1)}>Actualizar estado</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!snapshot ? <p role="status">{error ? 'Estado no disponible.' : 'Cargando estado del bot…'}</p> : <>
        <p>En cola: <strong>{snapshot.queue.pending}</strong> · En proceso: <strong>{snapshot.queue.processing}</strong> · Con fallos: <strong>{snapshot.queue.failed}</strong> · En revisión: <strong>{snapshot.queue.manual_review}</strong></p>
        {snapshot.queue.waiting_customer > 0 && <p>{snapshot.queue.waiting_customer} mensajes esperan una decisión del cliente sobre su lista.</p>}
        <p>Última revisión: {snapshot.config.last_scan_at ? issueTimestamp(snapshot.config.last_scan_at) : 'todavía sin datos'}.</p>
        {stale && <p role="alert">El monitoreo no tiene una actualización reciente. Revisá la recuperación y el cron.</p>}
        {deliveryProblem && <p role="alert">El último aviso por WhatsApp {snapshot.recent_notifications[0].state === 'uncertain' ? 'quedó sin confirmación de envío y no se repetirá automáticamente' : snapshot.recent_notifications[0].state === 'blocked' ? 'se detuvo porque no se pudo verificar que el emisor fuera el número de prueba' : 'no se pudo enviar'}. Las alertas siguen disponibles acá.</p>}
        {snapshot.alerts.length === 0 ? <p>Sin incidentes detectados en la última revisión.</p> : <ul>{snapshot.alerts.map(alert => <li key={alert.code} style={{ marginBottom: 12 }}>
          <strong>{alert.severity === 'critical' ? '🔴 ' : '🟡 '}{labels[alert.code] ?? 'Incidente técnico'}: {alert.affected}</strong>
          {alert.oldest_seconds > 0 && <span> · Más antiguo: {Math.max(1, Math.floor(alert.oldest_seconds / 60))} min</span>}
          {' '}{alert.acknowledged_at ? <span>Revisada</span> : <button type="button" disabled={busy} aria-label={'Marcar como revisada: ' + (labels[alert.code] ?? 'Incidente')} onClick={() => void action('acknowledge_whatsapp_ops_alert', { p_code: alert.code })}>Marcar como revisada</button>}
          {alert.code==='recovery_failure' && <p>Servicio general: sin un cliente individual asociado. No se registró una ejecución SQL exitosa reciente de la recuperación.</p>}
          {alert.details?.map(issue=><IssueDetail key={issue.id} issue={issue} />)}
          {(alert.details_total??0)>(alert.details?.length??0)&&alert.code!=='recovery_failure'&&<p>Mostrando {alert.details?.length??0} de {alert.details_total} casos. Consultá también los errores recientes.</p>}
        </li>)}</ul>}
        <details style={{margin:'16px 0'}}><summary>Errores recientes y mensajes sin resolver ({snapshot.recent_issues?.length??0})</summary>
          <p>Últimas 24 horas y casos todavía sin resolver, hasta 50 mensajes. Las fechas y horas corresponden a Argentina.</p>
          {snapshot.recent_issues?.length ? snapshot.recent_issues.map(issue=><IssueDetail key={issue.id} issue={issue} />) : <p>No hay diagnósticos recientes ni mensajes sin resolver.</p>}
        </details>
        {!snapshot.config.cost_verified && <p role="status">Avisos por WhatsApp pendientes de verificar el número de prueba y costo $0. Las alertas del panel siguen activas.</p>}
        {snapshot.config.whatsapp_enabled && !snapshot.config.window_open && <p role="status">Para habilitar avisos por WhatsApp, escribile al bot desde tu cuenta. La ventana de atención se cierra a las 24 horas; el panel sigue mostrando las alertas.</p>}
        <p>Los avisos incluyen el cliente afectado, fecha, hora y diagnóstico técnico. No incluyen textos de gastos, comprobantes ni credenciales. Se agrupan con al menos 30 minutos entre incidentes nuevos.</p>
        <button type="button" disabled={busy} className="admin-header-btn secondary" onClick={() => void action('configure_whatsapp_ops_alerts', { p_enabled: !(snapshot.config.whatsapp_enabled && snapshot.config.is_recipient) })}>
          {snapshot.config.whatsapp_enabled && snapshot.config.is_recipient ? 'Desactivar mis avisos por WhatsApp' : 'Recibir alertas en mi WhatsApp'}
        </button>
        <p>Destino: el WhatsApp vinculado a tu cuenta administradora. Marcar una alerta como revisada silencia ese incidente; no descarta movimientos.</p>
        <details style={{ marginTop: 16 }}><summary>Tiempos de las últimas 24 horas</summary>
          {snapshot.metrics.filter(m => metricLabels[m.event]).length === 0 ? <p>Todavía no hay muestras de tiempos.</p> : <div style={{ overflowX: 'auto' }}><table><caption>Tiempos por intento, no por movimiento guardado</caption><thead><tr><th scope="col">Etapa</th><th scope="col">Muestras</th><th scope="col">Promedio</th><th scope="col">Máximo</th></tr></thead><tbody>{snapshot.metrics.filter(m => metricLabels[m.event]).map(m => <tr key={m.event}><th scope="row">{metricLabels[m.event]}</th><td>{m.samples}</td><td>{Math.round(m.average_ms).toLocaleString('es-AR')} ms</td><td>{Math.round(m.maximum_ms).toLocaleString('es-AR')} ms</td></tr>)}</tbody></table></div>}
        </details>
        <p>Conservación propuesta: contenido técnico terminado durante {snapshot.config.retention_days} días. Limpieza automática: <strong>{snapshot.config.retention_enabled ? 'activa' : 'desactivada, pendiente de aprobar'}</strong>. Hoy habría {snapshot.retention_eligible} registros aptos.</p>
      </>}
    </section>
  );
}