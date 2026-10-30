import { useCallback, useEffect, useRef, useState } from 'react';
import { ModalDialog } from './ModalDialog';
import { useUpdateBlocker } from './PwaUpdates';
import { confirmPayment, PAYMENT_PAGE_SIZE, paymentDeliveryLabel, readPaymentRenewals, wakePaymentDelivery, type PaymentRenewal } from './paymentRenewals';

export function SubscriptionPayments({ refreshTick = 0 }: { refreshTick?: number }) {
  const [items, setItems] = useState<PaymentRenewal[]>([]);
  const [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PaymentRenewal | null>(null);
  const [days, setDays] = useState('30'), [lifetime, setLifetime] = useState(false);
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  const mounted = useRef(false), submitting = useRef(false), sequence = useRef(0);
  const loadController = useRef<AbortController | null>(null), paymentController = useRef<AbortController | null>(null);
  useUpdateBlocker(Boolean(selected) || busy, 'Terminá o cerrá la confirmación del pago para actualizar.');
  const load = useCallback(async () => {
    const current = ++sequence.current;
    loadController.current?.abort();
    const controller = new AbortController(); loadController.current = controller;
    try {
      const result = await readPaymentRenewals(page, controller.signal);
      if (mounted.current && current === sequence.current) {
        setItems(result.items); setTotal(result.total); setError('');
        if (page > 1 && result.items.length === 0) setPage(1);
      }
    } catch (cause) {
      if (mounted.current && current === sequence.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'No pudimos cargar las solicitudes.');
    } finally { if (mounted.current && current === sequence.current) setLoading(false); }
  }, [page]);
  useEffect(() => {
    mounted.current = true; void load();
    const refresh = () => { if (document.visibilityState !== 'hidden' && !submitting.current) void load(); };
    const timer = window.setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => { mounted.current = false; ++sequence.current; loadController.current?.abort(); paymentController.current?.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [load, refreshTick]);
  async function submit() {
    const n = Number(days);
    if (!selected || submitting.current || (!lifetime && (!Number.isInteger(n) || n < 1 || n > 3650))) return;
    submitting.current = true; setBusy(true); setFeedback('');
    const controller = new AbortController(); paymentController.current = controller;
    try {
      await confirmPayment(selected.id, lifetime ? null : n, controller.signal);
      if (mounted.current) { setSelected(null); setFeedback('Pago confirmado. El código se enviará por WhatsApp cuando la ventana esté habilitada. La membresía se activa al canjearlo.'); }
      // El cron recupera el envío incluso si esta pestaña se cierra aquí.
      void wakePaymentDelivery().catch(() => {}).then(() => { if (mounted.current) void load(); });
      if (mounted.current) await load();
    } catch (cause) {
      if (mounted.current) setFeedback(cause instanceof Error ? cause.message : 'No pudimos comprobar el pago. Actualizá antes de repetir.');
    } finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="admin-workspace-card renewal-payments" aria-label="Solicitudes de renovación" data-no-swipe>
    <div className="renewal-payments-heading"><h2>Renovaciones</h2><button type="button" className="button-secondary" disabled={busy} onClick={() => void load()}>Actualizar solicitudes</button></div>
    {error && <p role="alert">{error}</p>}
    {feedback && !selected && <p role="status">{feedback}</p>}
    {loading ? <p role="status">Cargando solicitudes…</p> : !items.length && !error ? <p>No hay solicitudes de renovación. El cliente debe escribir RENOVAR al bot.</p> : null}
    <div className="renewal-payments-list">{items.map(item => <article className="renewal-payment-row" key={item.id}>
      <div><strong>{item.client_name || 'Cliente sin nombre'}</strong><p>{paymentDeliveryLabel(item)}</p><small>Solicitud: {new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(item.requested_at))}</small>
        {!item.window_open && item.state !== 'redeemed' && <p>El cliente debe volver a escribir RENOVAR para habilitar el envío.</p>}
      </div>
      {item.state === 'requested' && <button type="button" className="primary-button" disabled={busy} onClick={() => { setSelected(item); setDays('30'); setLifetime(false); setFeedback(''); }}>Confirmar pago y enviar código</button>}
    </article>)}</div>
    {total > PAYMENT_PAGE_SIZE && <div className="renewal-payments-pages"><button type="button" className="button-secondary" disabled={page === 1 || busy} onClick={() => setPage(p => p - 1)}>Anterior</button><span>Página {page} de {Math.max(1, Math.ceil(total / PAYMENT_PAGE_SIZE))}</span><button type="button" className="button-secondary" disabled={page * PAYMENT_PAGE_SIZE >= total || busy} onClick={() => setPage(p => p + 1)}>Siguiente</button></div>}
    {selected && <ModalDialog as="form" titleId="renewal-payment-title" busy={busy} onClose={() => { if (!busy) setSelected(null); }} onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h2 id="renewal-payment-title">Confirmar pago de {selected.client_name || 'cliente'}</h2>
      <p>Confirmá solo si ya verificaste el pago. Emitimos un código para ese cliente; sus días se activan cuando lo canjee en Ajustes.</p>
      {feedback && <p role="alert">{feedback}</p>}
      <label htmlFor="renewal-payment-days">Días contratados</label><input id="renewal-payment-days" type="number" min="1" max="3650" required={!lifetime} disabled={busy || lifetime} value={days} onChange={event => setDays(event.target.value)} />
      <label className="switch-row"><span>Acceso sin vencimiento</span><input type="checkbox" checked={lifetime} disabled={busy} onChange={event => setLifetime(event.target.checked)} /></label>
      {!selected.window_open && <p>La ventana venció. Conservaremos el pago y el código, pero el cliente debe volver a escribir RENOVAR para recibirlo.</p>}
      <div className="renewal-payments-pages"><button type="button" className="button-secondary" disabled={busy} onClick={() => setSelected(null)}>Cancelar</button><button type="submit" className="primary-button" disabled={busy || (!lifetime && (!Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 3650))}>{busy ? 'Confirmando…' : 'Confirmar pago y enviar código'}</button></div>
    </ModalDialog>}
  </section>;
}
