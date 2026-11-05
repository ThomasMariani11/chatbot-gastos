import { useEffect, useState } from 'react';
import { Icon } from './Icons';
import { supabase } from './supabase';
import {
  dismissNotice,
  formatNoticeDate,
  isNoticeDismissed,
  loadReminderState,
  registrationReminder,
  subscriptionNotice,
  type ReminderState,
} from './clientNoticeRules';

type Profile = { role: string; subscription_status: string; subscription_until: string | null };

type Props = {
  userId: string;
  profile: Profile | null | undefined;
  /** Número del bot: el aviso de vencimiento abre WhatsApp con RENOVAR (flujo BE-19). */
  botPhone: string;
  botLinked: boolean;
  /** Cambia cuando cambian los movimientos cargados, para releer el último registro. */
  refreshKey: number;
  onOpenSettings: () => void;
  onAddMovement: () => void;
  /** Inyectable para pruebas. */
  client?: Parameters<typeof loadReminderState>[0];
  now?: () => number;
};

export function ClientNotices({ userId, profile, botPhone, botLinked, refreshKey, onOpenSettings, onAddMovement, client, now = Date.now }: Props) {
  const [reminder, setReminder] = useState<ReminderState>({ enabled: null, lastMovementAt: undefined });
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const reader = client ?? (supabase as unknown as Parameters<typeof loadReminderState>[0]);

  useEffect(() => {
    let active = true;
    void loadReminderState(reader, userId).then((state) => {
      if (active) setReminder(state);
    });
    return () => {
      active = false;
    };
    // `reader` es estable: el cliente de producción o el inyectado por las pruebas.
  }, [userId, refreshKey]);

  const at = now();
  const notices = [subscriptionNotice(profile, at), registrationReminder(reminder.enabled, reminder.lastMovementAt, at)]
    .filter((notice) => notice !== null)
    .filter((notice) => !dismissed[notice.id] && !isNoticeDismissed(userId, notice.id, at));

  if (notices.length === 0) return null;

  function hide(id: string) {
    dismissNotice(userId, id, now());
    setDismissed((current) => ({ ...current, [id]: true }));
  }

  const cleanBotPhone = botPhone.replace(/\D/g, '');
  const renewUrl = botLinked && cleanBotPhone ? `https://wa.me/${cleanBotPhone}?text=RENOVAR` : null;

  return (
    <div className="client-notices">
      {notices.map((notice) => {
        if (notice.id === 'registration') {
          return (
            <section key={notice.id} className="client-notice client-notice-info" role="status" aria-label="Recordatorio de registro">
              <span className="client-notice-icon" aria-hidden="true"><Icon name="message" size={18} /></span>
              <div className="client-notice-copy">
                <strong>{notice.kind === 'never' ? 'Todavía no registraste movimientos' : `Hace ${notice.days} días que no registrás movimientos`}</strong>
                <small>Anotá tus gastos e ingresos para que el resumen refleje tu mes.</small>
              </div>
              <div className="client-notice-actions">
                <button type="button" className="button-secondary" onClick={onAddMovement}>Cargar movimiento</button>
                <button type="button" className="text-button" onClick={() => hide(notice.id)}>Ocultar por hoy</button>
              </div>
            </section>
          );
        }
        const when = notice.daysLeft <= 1 ? 'Tu membresía vence en menos de 24 horas' : `Tu membresía vence en ${notice.daysLeft} días`;
        return (
          <section
            key={notice.id}
            className={`client-notice client-notice-${notice.level}`}
            role={notice.level === 'urgent' ? 'alert' : 'status'}
            aria-label="Aviso de vencimiento"
          >
            <span className="client-notice-icon" aria-hidden="true"><Icon name="card" size={18} /></span>
            <div className="client-notice-copy">
              <strong>{when}</strong>
              <small>Vence el {formatNoticeDate(notice.until)}. Renová para no perder el acceso.</small>
            </div>
            <div className="client-notice-actions">
              {renewUrl ? (
                <a className="button-secondary" href={renewUrl} target="_blank" rel="noopener noreferrer">Renovar por WhatsApp</a>
              ) : (
                <button type="button" className="button-secondary" onClick={onOpenSettings}>Ver cómo renovar</button>
              )}
              <button type="button" className="text-button" onClick={() => hide(notice.id)}>Ocultar por hoy</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
