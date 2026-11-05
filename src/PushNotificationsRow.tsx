import { useEffect, useState } from 'react';
import { disablePush, enablePush, getPushState, type PushState } from './pushNotifications';

type Props = {
  /** Inyectables para pruebas. */
  getState?: () => Promise<PushState>;
  enable?: () => Promise<PushState>;
  disable?: () => Promise<PushState>;
};

const help: Record<PushState, string> = {
  on: 'Te llegan al celular los avisos de vencimiento y los recordatorios, aunque Pesito esté cerrado.',
  off: 'Recibí en este celular los avisos de vencimiento y los recordatorios, aunque Pesito esté cerrado.',
  denied: 'Las notificaciones están bloqueadas para Pesito. Habilitalas desde la configuración del navegador o del celular.',
  'needs-install': 'En iPhone, primero instalá Pesito en la pantalla de inicio (Compartir → Agregar a inicio) y abrilo desde ahí.',
  unsupported: 'Este navegador no admite notificaciones de Pesito.',
};

export function PushNotificationsRow({ getState = getPushState, enable = enablePush, disable = disablePush }: Props) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void getState().then((next) => { if (active) setState(next); }).catch(() => { if (active) setState('unsupported'); });
    return () => { active = false; };
  }, [getState]);

  if (state === null) return null;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      setState(state === 'on' ? await disable() : await enable());
    } catch {
      setError('No pudimos actualizar las notificaciones. Intentá de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  const canToggle = state === 'on' || state === 'off';
  return (
    <div className="settings-bot-switch-row settings-switch-row-standalone">
      <div className="settings-bot-switch-copy">
        <strong>Notificaciones en este celular</strong>
        <small>{help[state]}</small>
        {error && <small className="settings-push-error" role="alert">{error}</small>}
      </div>
      {canToggle && (
        <button
          type="button"
          role="switch"
          aria-checked={state === 'on'}
          aria-label="Notificaciones en este celular"
          className={`settings-switch ${state === 'on' ? 'is-on' : ''}`}
          disabled={busy}
          onClick={() => void toggle()}
        >
          <span className="settings-switch-track">
            <span className="settings-switch-thumb" />
          </span>
        </button>
      )}
    </div>
  );
}
