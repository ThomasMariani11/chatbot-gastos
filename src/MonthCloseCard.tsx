// NOTIF-02: tarjeta de cierre del mes arriba del Resumen, del día 1 al 7.
import { useEffect, useState } from 'react';
import { formatMoney } from '../lib/finance';
import { supabase } from './supabase';
import {
  closedMonth,
  dismissMonthClose,
  isMonthCloseDismissed,
  loadMonthClose,
  monthLabel,
  shortMonthLabel,
  type CurrencyClose,
  type MonthClose,
} from './monthCloseRules';

type Props = {
  userId: string;
  /** Lleva el selector del Resumen al mes cerrado ('YYYY-MM'). */
  onViewMonth: (month: string) => void;
  /** Inyectables para pruebas. */
  client?: Parameters<typeof loadMonthClose>[0];
  now?: number;
};

const CURRENCY_NAMES: Record<CurrencyClose['currency'], string> = { ARS: 'Pesos', USD: 'Dólares' };

function changeText(change: number, previousMonth: string): string {
  const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '=';
  return `${arrow} ${Math.abs(change)}% vs ${shortMonthLabel(previousMonth)}`;
}

export function MonthCloseCard({ userId, onViewMonth, client, now }: Props) {
  // Se guarda la cuenta junto al resultado para no mostrar el cierre de otra cuenta al cambiar de usuario.
  const [loaded, setLoaded] = useState<{ userId: string; close: MonthClose | null } | null>(null);
  const [hiddenMonth, setHiddenMonth] = useState<string | null>(null);
  const reader = client ?? (supabase as unknown as Parameters<typeof loadMonthClose>[0]);

  useEffect(() => {
    const at = now ?? Date.now();
    const month = closedMonth(at);
    if (!month || isMonthCloseDismissed(userId, month)) return;
    let active = true;
    void loadMonthClose(reader, userId, at).then((close) => {
      if (active) setLoaded({ userId, close });
    });
    return () => {
      active = false;
    };
    // `reader` y `now` son estables: el cliente de producción o los inyectados por las pruebas.
  }, [userId]);

  const close = loaded?.userId === userId ? loaded.close : null;
  if (!close || close.month !== closedMonth(now ?? Date.now())) return null;
  if (hiddenMonth === close.month || isMonthCloseDismissed(userId, close.month)) return null;

  const month = close.month;
  const label = monthLabel(month);

  function hide() {
    dismissMonthClose(userId, month);
    setHiddenMonth(month);
  }

  return (
    <section className="client-notice client-notice-info month-close" aria-label="Cierre del mes">
      <span className="client-notice-icon" aria-hidden="true">📊</span>
      <div className="client-notice-copy">
        <strong>Cerraste {label}</strong>
        {close.currencies.map((item) => (
          <div key={item.currency} className="month-close-currency">
            <span className="month-close-currency-name">{CURRENCY_NAMES[item.currency]}</span>
            <dl className="month-close-grid">
              <div>
                <dt><span aria-hidden="true">💸 </span>Gastos</dt>
                <dd>
                  {formatMoney(item.expenses, item.currency)}
                  {item.expenseChange !== null && (
                    <small className="month-close-change">{changeText(item.expenseChange, close.previousMonth)}</small>
                  )}
                </dd>
              </div>
              <div>
                <dt><span aria-hidden="true">💰 </span>Ingresos</dt>
                <dd>{formatMoney(item.income, item.currency)}</dd>
              </div>
              <div>
                <dt><span aria-hidden="true">📈 </span>Balance</dt>
                <dd>{formatMoney(item.balance, item.currency)}</dd>
              </div>
            </dl>
          </div>
        ))}
        {close.budget && (
          <p className="month-close-budget">
            {close.budget.left >= 0
              ? <><span aria-hidden="true">🎯 </span>Te sobraron {formatMoney(close.budget.left, 'ARS')} del presupuesto</>
              : <><span aria-hidden="true">⚠️ </span>Te pasaste {formatMoney(Math.abs(close.budget.left), 'ARS')} del presupuesto</>}
          </p>
        )}
      </div>
      <div className="client-notice-actions">
        <button type="button" className="button-secondary" onClick={() => onViewMonth(month)}>Ver {label}</button>
        <button type="button" className="text-button" onClick={hide}>Cerrar</button>
      </div>
    </section>
  );
}
