import { Icon } from './Icons';
import { useUpdateBlocker } from './PwaUpdates';
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
  queue_delay: 'Respuestas demoradas',
  repeated_failures: 'Fallos repetidos',
  manual_review: 'Requiere revisión',
  recovery_failure: 'Revisar recuperación',
  interpretation_fallback: 'Problemas de interpretación',
};
const metricLabels: Record<string, string> = {
  queue_wait: 'Espera en cola', queue_interpret: 'Interpretación', queue_send: 'Envío de respuestas',
};
function issueSummary(issue: OperationalIssue): string {
  if (!issue.diagnostic_available) return 'Causa no registrada. Requiere revisión.';
  const summaries: Record<string, string> = {
    timeout: 'El servicio tardó demasiado en responder.',
    unavailable: issue.provider === 'gemini' || issue.provider === 'groq' ? 'La IA no estaba disponible.' : 'El servicio no estaba disponible.',
    authentication: 'El servicio rechazó el acceso.', rate_limit: 'Se alcanzó el límite de uso del servicio.',
    network: 'Falló la conexión con el servicio.', invalid_response: 'No se pudo interpretar el mensaje.',
    database_read: 'No se pudieron consultar los datos.', configuration: 'Falta configurar el servicio.',
    request_rejected: 'El servicio rechazó la solicitud.', media_too_large: 'El archivo es demasiado grande.',
    payload_too_large: 'La respuesta del servicio es demasiado grande.', unsupported_media: 'El formato del archivo no es compatible.',
  };
  return summaries[issue.reason ?? ''] ?? 'No se pudo completar el mensaje.';
}
function IssueDetail({ issue }: { issue: OperationalIssue }) {
  const name = safeClientName(issue.client_name);
  return <article className="bot-ops-issue" aria-label={'Incidente de ' + name}>
    <strong className="bot-ops-client">{name}</strong>
    <p className="bot-ops-issue-summary">{issueSummary(issue)}</p>
    <p className="bot-ops-meta">{issueSource(issue.source_kind)} · {issue.time_source === 'received' && 'Recibido: '}<time dateTime={issue.occurred_at} title="Hora de Argentina">{issueTimestamp(issue.occurred_at)}</time></p>
    <details className="bot-ops-technical"><summary><span>Detalle técnico</span><Icon name="chevronDown" size={16} className="admin-summary-chevron" /></summary>
      <p>{issueDescription(issue)}</p>
      <p className="bot-ops-meta">{issue.attempts} intentos · {issue.state === 'processed' ? 'Mensaje terminado' : issue.state === 'waiting' ? 'En revisión' : issue.state === 'processing' ? 'En proceso' : issue.state === 'failed' ? 'Con fallos' : 'En cola'}{issue.client_reference && ' · Ref. ' + issue.client_reference}</p>
    </details>
  </article>;
}
export function BotOperations() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  useUpdateBlocker(busy, "Esperá a que termine la acción del bot para actualizar.");

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
  const lastScan = snapshot?.config.last_scan_at;
  const stale = !lastScan || !Number.isFinite(Date.parse(lastScan)) || Date.now() - Date.parse(lastScan) > 180000;
  const noticeState = snapshot?.recent_notifications[0]?.state;
  const deliveryProblem = ['failed', 'uncertain', 'blocked'].includes(noticeState ?? '');
  const statusText = !snapshot ? 'Sin datos' : error || stale ? 'Sin actualizar' : snapshot.alerts.length ? 'Requiere atención' : deliveryProblem ? 'Revisar avisos' : 'Sin alertas';
  const statusTone = !snapshot || error || stale ? 'neutral' : snapshot.alerts.length || deliveryProblem ? 'warning' : 'good';
  const ownNotices = snapshot?.config.whatsapp_enabled && snapshot.config.is_recipient;
  return (
    <section className="admin-generator-card bot-ops" aria-labelledby="bot-operations-heading">
      <div className="bot-ops-header">
        <div className="bot-ops-title"><h2 id="bot-operations-heading">Estado del bot</h2><span className={'bot-ops-badge ' + statusTone}>{statusText}</span></div>
      </div>
      {error && <p className="bot-ops-warning" role="alert">{error}</p>}
      {!snapshot ? <p role="status">{error ? 'Estado no disponible.' : 'Cargando…'}</p> : <>
        <div className="bot-ops-counts" aria-label="Mensajes del bot">
          <div><strong>{snapshot.queue.pending}</strong><span>En cola</span></div>
          <div><strong>{snapshot.queue.processing}</strong><span>Procesando</span></div>
          <div className={snapshot.queue.failed + snapshot.queue.manual_review ? 'needs-attention' : ''}><strong>{snapshot.queue.failed + snapshot.queue.manual_review}</strong><span>Para revisar</span></div>
        </div>
        {snapshot.queue.waiting_customer > 0 && <p className="bot-ops-meta">{snapshot.queue.waiting_customer} mensajes esperan al cliente.</p>}
        {stale && !error && <p className="bot-ops-warning" role="alert">El monitoreo está sin actualizar. Revisá la recuperación.</p>}
        {deliveryProblem && <p className="bot-ops-warning" role="alert">{noticeState === 'uncertain' ? 'Un aviso de WhatsApp quedó sin confirmar.' : noticeState === 'blocked' ? 'WhatsApp bloqueado: falta verificar el emisor de prueba.' : 'No se pudo enviar el último aviso por WhatsApp.'}</p>}
        {snapshot.alerts.length > 0 && <div className="bot-ops-alerts">{snapshot.alerts.map(alert => <section className={'bot-ops-alert ' + (alert.severity === 'critical' ? 'critical' : '')} key={alert.code} aria-label={labels[alert.code] ?? 'Incidente'}>
          <div className="bot-ops-alert-header"><h3>{labels[alert.code] ?? 'Incidente técnico'} <span className="bot-ops-alert-count">{alert.affected}</span></h3>
            {alert.acknowledged_at ? <span className="bot-ops-reviewed">Revisada</span> : <button type="button" className="bot-ops-button" disabled={busy} aria-label={'Marcar como revisada: ' + (labels[alert.code] ?? 'Incidente')} onClick={() => void action('acknowledge_whatsapp_ops_alert', { p_code: alert.code })}>Marcar revisada</button>}
          </div>
          {alert.code === 'recovery_failure' && <p className="bot-ops-issue-summary">La recuperación no tiene una ejecución reciente. Afecta al servicio general.</p>}
          {alert.details?.map(issue => <IssueDetail key={issue.id} issue={issue} />)}
          {(alert.details_total ?? 0) > (alert.details?.length ?? 0) && alert.code !== 'recovery_failure' && <p className="bot-ops-meta">{alert.details?.length ?? 0} de {alert.details_total} casos. Más información en el historial.</p>}
        </section>)}</div>}
        <div className="bot-ops-footer">
          <div className="bot-ops-whatsapp"><span>WhatsApp</span><span className={'bot-ops-badge ' + (!snapshot.config.cost_verified ? 'warning' : ownNotices && snapshot.config.window_open ? 'good' : 'neutral')}>{!snapshot.config.cost_verified ? 'Por verificar' : ownNotices ? snapshot.config.window_open ? 'Avisos activos' : 'Ventana cerrada' : 'Desactivado'}</span></div>
          <button type="button" className="bot-ops-button" disabled={busy} aria-label={ownNotices ? 'Desactivar mis avisos por WhatsApp' : 'Activar avisos en mi WhatsApp'} onClick={() => void action('configure_whatsapp_ops_alerts', { p_enabled: !ownNotices })}>{ownNotices ? 'Desactivar avisos' : 'Activar avisos'}</button>
        </div>
        {snapshot.config.whatsapp_enabled && !snapshot.config.window_open && <p className="bot-ops-meta">Escribile al bot para volver a recibir avisos durante 24 horas.</p>}
        <div className="bot-ops-more">
          <details><summary><span>Historial <span className="bot-ops-summary-count">{snapshot.recent_issues?.length ?? 0}</span></span><Icon name="chevronDown" size={18} className="admin-summary-chevron" /></summary>
            <p className="bot-ops-meta">Últimas 24 horas y mensajes sin resolver · Hasta 50 casos · Hora de Argentina.</p>
            {snapshot.recent_issues?.length ? snapshot.recent_issues.map(issue => <IssueDetail key={issue.id} issue={issue} />) : <p className="bot-ops-meta">Sin errores recientes.</p>}
          </details>
          <details><summary><span>Ajustes y métricas</span><Icon name="chevronDown" size={18} className="admin-summary-chevron" /></summary>
            <div className="bot-ops-settings">
              <p>Los avisos llegan al WhatsApp de tu cuenta administradora. Incluyen cliente y diagnóstico, sin gastos ni comprobantes.</p>
              <p>Intervalo mínimo: 30 minutos. Marcar revisada silencia esa alerta; no modifica movimientos.</p>
              {!snapshot.config.cost_verified && <p>Los envíos esperan la verificación del número de prueba para mantener costo $0.</p>}
              {noticeState === 'uncertain' && <p>El envío sin confirmar no se repetirá automáticamente para evitar duplicados.</p>}
              <p>Limpieza automática: <strong>{snapshot.config.retention_enabled ? 'activa' : 'desactivada'}</strong> · Plazo propuesto: {snapshot.config.retention_days} días · {snapshot.retention_eligible} registros aptos.</p>
              <p>Mensajes con fallos: {snapshot.queue.failed} · En revisión manual: {snapshot.queue.manual_review}.</p>
              {snapshot.metrics.filter(m => metricLabels[m.event]).length === 0 ? <p>Sin muestras de tiempos todavía.</p> : <div className="bot-ops-table"><table><caption>Tiempos de las últimas 24 horas, por intento</caption><thead><tr><th scope="col">Etapa</th><th scope="col">Muestras</th><th scope="col">Promedio</th><th scope="col">Máximo</th></tr></thead><tbody>{snapshot.metrics.filter(m => metricLabels[m.event]).map(m => <tr key={m.event}><th scope="row">{metricLabels[m.event]}</th><td>{m.samples}</td><td>{Math.round(m.average_ms).toLocaleString('es-AR')} ms</td><td>{Math.round(m.maximum_ms).toLocaleString('es-AR')} ms</td></tr>)}</tbody></table></div>}
            </div>
          </details>
        </div>
        <p className="bot-ops-updated" title="Hora de Argentina · Actualización automática cada 30 segundos">{lastScan ? 'Actualizado ' + issueTimestamp(lastScan) : 'Todavía sin revisión'}</p>
      </>}
    </section>
  );
}
