import { createContext, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { PwaUpdater } from './pwaUpdateCoordinator';
import './pwaUpdates.css';
const UpdateContext = createContext<PwaUpdater | null>(null);
export function useUpdateBlocker(blocked: boolean, reason = 'Guardá o cerrá lo que estás editando para actualizar.') {
  const updater = useContext(UpdateContext);
  const owner = useRef(Symbol('form'));
  useLayoutEffect(() => {
    const id = owner.current;
    updater?.block(id, blocked ? reason : null);
    return () => updater?.block(id, null);
  }, [updater, blocked, reason]);
}
export function PwaUpdates({ updater, children }: { updater: PwaUpdater; children: ReactNode }) {
  const state = useSyncExternalStore(updater.subscribe, updater.snapshot, updater.snapshot);
  useEffect(() => { updater.start(); return () => updater.stop(); }, [updater]);
  return <UpdateContext.Provider value={updater}>
    {children}
    {state.available && <aside className="pwa-update-notice" aria-label="Actualización de Pesito">
      <div role="status" aria-live="polite">
        <strong>Hay una nueva versión de Pesito</strong>
        <p>{state.reason || 'Actualizá cuando quieras. La pantalla se va a recargar.'}</p>
        {state.error && <p className="pwa-update-error">{state.error}</p>}
      </div>
      <button type="button" disabled={Boolean(state.reason) || state.applying} onClick={() => void updater.apply()}>
        {state.applying ? 'Actualizando…' : 'Actualizar'}
      </button>
    </aside>}
  </UpdateContext.Provider>;
}
