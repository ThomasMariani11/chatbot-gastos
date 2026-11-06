import { useEffect, useState } from 'react';
import { Icon } from './Icons';
import { enablePush, getPushState, type PushState } from './pushNotifications';
import { declinePushPrompt, pushPromptVariant, readPushPromptMemory, type PushPromptMemory } from './pushPromptRules';

type Props = {
  userId: string;
  accountCreatedAt: string | null | undefined;
  onboardingPending: boolean;
  /** Inyectables para pruebas. */
  getState?: () => Promise<PushState>;
  enable?: () => Promise<PushState>;
  now?: () => number;
};

const copy = {
  new: {
    title: '¿Querés que Pesito te avise?',
    text: 'Te recordamos registrar tus gastos al mediodía y a la noche, y te avisamos antes de que venza tu membresía.',
  },
  announcement: {
    title: 'Nuevo: ahora Pesito te avisa en el celular',
    text: 'Activá las notificaciones y te recordamos registrar tus gastos al mediodía y a la noche, y antes de que venza tu membresía.',
  },
  install: {
    title: 'Instalá Pesito para recibir avisos',
    text: 'En iPhone, las notificaciones funcionan con la app instalada: tocá Compartir → Agregar a inicio y abrí Pesito desde ese ícono.',
  },
} as const;

export function PushPrompt({ userId, accountCreatedAt, onboardingPending, getState = getPushState, enable = enablePush, now = Date.now }: Props) {
  const [state, setState] = useState<PushState | null>(null);
  const [memory, setMemory] = useState<PushPromptMemory>(() => readPushPromptMemory(userId));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    setMemory(readPushPromptMemory(userId));
    void getState().then((next) => { if (active) setState(next); }).catch(() => { if (active) setState('unsupported'); });
    return () => { active = false; };
  }, [userId, getState]);

  const variant = pushPromptVariant({ state, memory, accountCreatedAt, onboardingPending, now: now() });

  if (message) {
    return (
      <div className="client-notices">
        <section className="client-notice client-notice-info" role="status" aria-label="Notificaciones">
          <span className="client-notice-icon" aria-hidden="true"><Icon name="bell" size={18} /></span>
          <div className="client-notice-copy"><strong>{message}</strong></div>
          <div className="client-notice-actions">
            <button type="button" className="text-button" onClick={() => setMessage('')}>Cerrar</button>
          </div>
        </section>
      </div>
    );
  }
  if (!variant) return null;

  async function activate() {
    if (busy) return;
    setBusy(true);
    try {
      const next = await enable();
      setState(next);
      if (next === 'on') setMessage('Listo, te vamos a avisar en este celular.');
      else if (next === 'denied') setMessage('Las notificaciones quedaron bloqueadas. Podés habilitarlas desde la configuración del celular.');
    } catch {
      setMessage('No pudimos activar las notificaciones. Probá de nuevo desde Ajustes → Avisos.');
    } finally {
      setBusy(false);
    }
  }

  function decline() {
    setMemory(declinePushPrompt(userId, now()));
  }

  const text = copy[variant];
  return (
    <div className="client-notices">
      <section className="client-notice client-notice-info" role="region" aria-label="Activar notificaciones">
        <span className="client-notice-icon" aria-hidden="true"><Icon name="bell" size={18} /></span>
        <div className="client-notice-copy">
          <strong>{text.title}</strong>
          <small>{text.text}</small>
        </div>
        <div className="client-notice-actions">
          {variant !== 'install' && (
            <button type="button" className="button-secondary" disabled={busy} onClick={() => void activate()}>Activar</button>
          )}
          <button type="button" className="text-button" onClick={decline}>Ahora no</button>
        </div>
      </section>
    </div>
  );
}
