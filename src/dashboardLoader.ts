export type LoadView = { context: string; status: 'loading' | 'ready' | 'error'; refreshing: boolean };
export const canShowDashboard = (view: LoadView, context: string) => view.context === context && view.status === 'ready';

/** Una lectura por contexto. Coalesce invalidaciones sin perder la que llega durante un fallback. */
export function createDashboardLoader<T>(options: {
  read: (signal: AbortSignal) => Promise<T>;
  start: () => void; commit: (data: T) => void; fail: () => void;
}) {
  let active = true, busy = false, again = false;
  let controller: AbortController | null = null;
  async function refresh(): Promise<void> {
    if (!active) return;
    if (busy) { again = true; return; }
    busy = true;
    controller = new AbortController();
    const requestController = controller;
    const timeout = setTimeout(() => requestController.abort(), 15000);
    let rejectAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error('Lectura cancelada'));
      requestController.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    options.start();
    try {
      const snapshot = await Promise.race([options.read(requestController.signal), aborted]);
      if (active) options.commit(snapshot);
    } catch {
      if (active) options.fail();
    } finally {
      clearTimeout(timeout);
      if (rejectAbort) requestController.signal.removeEventListener('abort', rejectAbort);
      busy = false;
      if (active && again) { again = false; void refresh(); }
    }
  }
  return { refresh, stop() { active = false; again = false; controller?.abort(); } };
}