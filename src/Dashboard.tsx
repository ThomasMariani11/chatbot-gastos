import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { supabase } from './supabase';

type Movement = {
  id: string;
  title: string;
  category: string;
  amount: number;
  date: string;
  kind: 'expense' | 'income';
  icon: string;
  installmentNumber?: number | null;
  installmentCount?: number | null;
};

type InstallmentPlan = {
  groupId: string;
  description: string;
  totalAmount: number;
  installmentCount: number;
  vanCount: number;
  monthlyAmount: number;
  quedanCount: number;
  quedanTotal: number;
  progressPercent: number;
  currentDateStr: string;
};

type Props = { userId: string; onOpenSettings: () => void; onSignOut: () => void };

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const monthLabel = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' });

function formatShortDate(dateStr: string) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const monthAbbr = months[(m - 1) % 12];
  const shortYear = String(y).slice(-2);
  return `${d}/${monthAbbr}/${shortYear}`;
}

function monthKey(date: Date) {

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(key: string, offset: number) {
  const [year, month] = key.split('-').map(Number);
  return monthKey(new Date(year, month - 1 + offset, 1));
}

function labelForMonth(key: string) {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  const monthName = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(date);
  return `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`;
}

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}

function IconHome({ className = 'nav-icon' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1V9.5z" />
    </svg>
  );
}

function IconMovements({ className = 'nav-icon' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4v16M7 4L3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4" />
    </svg>
  );
}

function IconInstallments({ className = 'nav-icon' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

function IconSettings({ className = 'nav-icon' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}


export function Dashboard({ userId, onOpenSettings, onSignOut }: Props) {
  const currentMonth = monthKey(new Date());
  const [month, setMonth] = useState(currentMonth);
  const availableMonths = useMemo(() => {
    const startYear = 2026;
    const startMonth = 9; // Inicio de Pesito: Septiembre 2026
    const [currYear, currMonthNum] = currentMonth.split('-').map(Number);
    const list: string[] = [];
    let y = startYear;
    let m = startMonth;
    while (y < currYear || (y === currYear && m <= currMonthNum)) {
      list.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    if (!list.includes(currentMonth)) list.push(currentMonth);
    return list;
  }, [currentMonth]);

  const [movements, setMovements] = useState<Movement[]>([]);
  const [installmentPlans, setInstallmentPlans] = useState<InstallmentPlan[]>([]);
  const [budget, setBudget] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const expenses = useMemo(() => movements.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amount, 0), [movements]);
  const income = useMemo(() => movements.filter((item) => item.kind === 'income').reduce((sum, item) => sum + item.amount, 0), [movements]);
  const progress = budget > 0 ? Math.round((expenses / budget) * 100) : 0;
  const chartData = useMemo(() => {
    const grouped = new Map<string, number>();
    movements.filter((item) => item.kind === 'expense').forEach((item) => grouped.set(item.category, (grouped.get(item.category) ?? 0) + item.amount));
    return Array.from(grouped, ([name, value]) => ({ name, value }));
  }, [movements]);
  const chartColors = ['#20b984', '#655ad8', '#f4b44d', '#ea7172', '#4f9bd8'];

  useEffect(() => {
    let active = true;
    let loading = false;
    const monthStart = `${month}-01`;
    const monthEnd = `${shiftMonth(month, 1)}-01`;
    const loadDashboard = async () => {
      if (loading) return;
      loading = true;
      const [transactions, budgets, allInstallments] = await Promise.all([
        supabase.from('transactions').select('id,description,amount_ars,occurred_on,kind,categories(name),installment_number,installment_count').eq('user_id', userId).eq('status', 'confirmed').gte('occurred_on', monthStart).lt('occurred_on', monthEnd).order('occurred_on', { ascending: false }),
        supabase.from('budgets').select('amount_ars').eq('user_id', userId).eq('month', monthStart).maybeSingle(),
        supabase.from('transactions').select('id,description,amount_ars,occurred_on,installment_number,installment_count,installment_group_id').eq('user_id', userId).eq('status', 'confirmed').gt('installment_count', 1).order('occurred_on', { ascending: true }),
      ]);
      loading = false;
      if (!active) return;
      if (!transactions.error) {
        setMovements((transactions.data ?? []).map((row: Record<string, unknown>) => ({
          id: String(row.id),
          title: String(row.description),
          category: String((row.categories as { name?: string } | null)?.name ?? 'Otros'),
          amount: Number(row.amount_ars),
          date: String(row.occurred_on),
          kind: row.kind as 'expense' | 'income',
          icon: row.kind === 'income' ? '↗' : '•',
          installmentNumber: row.installment_number ? Number(row.installment_number) : null,
          installmentCount: row.installment_count ? Number(row.installment_count) : null,
        })));
      }
      if (!budgets.error) setBudget(budgets.data?.amount_ars ? Number(budgets.data.amount_ars) : 0);
      if (!allInstallments.error && allInstallments.data) {
        const groups = new Map<string, Array<Record<string, unknown>>>();
        allInstallments.data.forEach((row: Record<string, unknown>) => {
          const key = String(row.installment_group_id || row.description);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(row);
        });
        const currentKey = monthKey(new Date());
        const computedPlans: InstallmentPlan[] = [];
        groups.forEach((rows, groupId) => {
          const totalCount = Number(rows[0]?.installment_count ?? rows.length);
          const desc = String(rows[0]?.description ?? 'Compra en cuotas');
          const monthlyAmount = Number(rows[0]?.amount_ars ?? 0);
          const paidRows = rows.filter((r) => String(r.occurred_on).slice(0, 7) < currentKey);
          const remainingRows = rows.filter((r) => String(r.occurred_on).slice(0, 7) >= currentKey);
          const currentRow = rows.find((r) => String(r.occurred_on).slice(0, 7) === currentKey);

          const paidCount = paidRows.length;
          const currentNumber = currentRow?.installment_number ? Number(currentRow.installment_number) : Math.min(paidCount + 1, totalCount);
          const vanCount = currentNumber;
          const quedanCount = Math.max(totalCount - vanCount, 0);
          const quedanTotal = quedanCount * monthlyAmount;
          const progressPercent = Math.round((vanCount / totalCount) * 100);
          const currentDateStr = currentRow ? String(currentRow.occurred_on) : String(remainingRows[0]?.occurred_on ?? '');

          if (remainingRows.length > 0) {
            computedPlans.push({
              groupId,
              description: desc,
              totalAmount: rows.reduce((sum, r) => sum + Number(r.amount_ars), 0),
              installmentCount: totalCount,
              vanCount,
              monthlyAmount,
              quedanCount,
              quedanTotal,
              progressPercent,
              currentDateStr,
            });
          }
        });


        setInstallmentPlans(computedPlans);
      }
    };
    void loadDashboard();
    const channel = supabase.channel(`dashboard-${userId}-${month}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${userId}` }, loadDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budgets', filter: `user_id=eq.${userId}` }, loadDashboard)
      .subscribe();
    const interval = window.setInterval(loadDashboard, 5000);
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void loadDashboard(); };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      void supabase.removeChannel(channel);
    };
  }, [month, userId]);

  async function editBudget() {
    const raw = window.prompt('Presupuesto mensual en pesos argentinos', String(budget));
    const next = Number(raw);
    if (!Number.isFinite(next) || next <= 0) return;
    const { error } = await supabase.from('budgets').upsert({ user_id: userId, month: `${month}-01`, amount_ars: next }, { onConflict: 'user_id,month' });
    if (error) return window.alert('No pudimos guardar el presupuesto.');
    setBudget(next);
  }

  async function addMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const kind = form.get('kind') as 'expense' | 'income';
    const { error } = await supabase.from('transactions').insert({ user_id: userId, kind, description: String(form.get('description')), amount_ars: Number(form.get('amount')), occurred_on: String(form.get('date')), status: 'confirmed', source: 'pwa' });
    if (error) return window.alert('No pudimos guardar el movimiento.');
    setShowAdd(false);
  }

  async function deleteMovement(item: Movement) {
    if (!window.confirm(`¿Eliminar "${item.title}"? Esta acción no se puede deshacer.`)) return;
    const previous = movements;
    setDeletingId(item.id);
    setMovements((current) => current.filter((movement) => movement.id !== item.id));
    const { error } = await supabase.from('transactions').delete().eq('id', item.id).eq('user_id', userId);
    if (error) {
      setMovements(previous);
      window.alert('No pudimos eliminar el movimiento. Intentá nuevamente.');
    }
    setDeletingId(null);
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">P</span><span>Pesito</span></div>
      <nav aria-label="Navegación principal">
        <a className="nav-item active" href="#resumen"><span><IconHome /></span>Resumen</a>
        <a className="nav-item" href="#movimientos"><span><IconMovements /></span>Movimientos</a>
        <a className="nav-item" href="#cuotas"><span><IconInstallments /></span>Cuotas</a>
        <button className="nav-item nav-button" type="button" onClick={onOpenSettings}><span><IconSettings /></span>Configuración</button>
      </nav>
      <div className="bot-status"><span className="status-dot"/><div><strong>Bot conectado</strong><small>WhatsApp activo</small></div></div>
      <button className="profile logout-button" type="button" onClick={onSignOut}><span>TS</span><div><strong>Thomas</strong><small>Cerrar sesión</small></div><b>›</b></button>
    </aside>
    <section className="content" id="resumen">
      <header className="topbar">
        <div>
          <p className="eyebrow">TU RESUMEN</p>
          <h1>Hola, Thomas <span>👋</span></h1>
          <p>Así vienen tus finanzas este mes.</p>
        </div>
        <div className="top-actions">
          <select aria-label="Mes" value={month} onChange={(event) => setMonth(event.target.value)}>
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {labelForMonth(m)}
              </option>
            ))}
          </select>
          <button aria-label="Notificaciones" className="icon-button">♢</button>
        </div>
      </header>
      <section className="summary-grid" aria-label="Resumen mensual">
        <article className="summary-card expense"><div className="card-heading"><span className="metric-icon">↘</span><small>GASTOS DEL MES</small></div><strong>{money.format(expenses)}</strong><p>Actualizado automáticamente</p></article>
        <article className="summary-card income"><div className="card-heading"><span className="metric-icon">↗</span><small>INGRESOS DEL MES</small></div><strong>{money.format(income)}</strong><p>Actualizado automáticamente</p></article>
        <article className="summary-card balance"><div className="card-heading"><span className="metric-icon">◎</span><small>BALANCE</small></div><strong>{money.format(income - expenses)}</strong><p>Disponible este mes</p></article>
      </section>
      <section className="main-grid">
        <article className="panel budget-card"><div className="panel-title"><div><h2>Presupuesto mensual</h2><p>Tu límite de gastos para {labelForMonth(month).toLowerCase()}</p></div><button className="text-button" onClick={editBudget}>Editar</button></div><div className="budget-numbers"><div><span>Gastado</span><strong>{money.format(expenses)}</strong></div><div className="align-right"><span>Presupuesto</span><strong>{money.format(budget)}</strong></div></div><div className="progress-track"><span style={{ width: `${Math.min(progress, 100)}%` }}/></div><div className="progress-copy"><span>{progress}% utilizado</span><span>Te quedan <strong>{money.format(budget - expenses)}</strong></span></div></article>
        <article className="panel category-card">
          <div className="panel-title">
            <div>
              <h2>Gastos por categoría</h2>
              <p>Distribución del mes</p>
            </div>
          </div>
          <div className="chart-row">
            <div className="donut-chart" role="img" aria-label="Gráfico de gastos por categoría">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="60%"
                    outerRadius="85%"
                    paddingAngle={chartData.length > 1 ? 2 : 0}
                    stroke="none"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div>
                <strong>{money.format(expenses)}</strong>
                <span>Total</span>
              </div>
            </div>
            <ul className="legend">
              {chartData.slice(0, 4).map((entry, index) => (
                <li key={entry.name}>
                  <i style={{ background: chartColors[index % chartColors.length] }} />
                  {entry.name}
                  <strong>{expenses ? Math.round((entry.value / expenses) * 100) : 0}%</strong>
                </li>
              ))}
            </ul>
          </div>
        </article>
        <article className="panel movements-card" id="movimientos">
          <div className="panel-title">
            <div>
              <h2>Últimos movimientos</h2>
              <p>Tus operaciones más recientes</p>
            </div>
          </div>
          <div className="movement-list">
            {movements.length === 0 ? (
              <p className="empty-movements">Todavía no hay movimientos en este mes.</p>
            ) : (
              movements.map((item) => (
                <div className="movement" key={item.id}>
                  <span className={`movement-icon ${item.kind}`}>{item.icon}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {item.category} · {item.date}
                      {item.installmentCount && item.installmentCount > 1 ? ` · Cuota ${item.installmentNumber ?? 1}/${item.installmentCount}` : ''}
                    </small>
                  </div>
                  <b className={item.kind}>{item.kind === 'expense' ? '−' : '+'}{money.format(item.amount)}</b>
                  <button className="movement-delete" type="button" disabled={deletingId === item.id} onClick={() => void deleteMovement(item)} aria-label={`Eliminar ${item.title}`}>{deletingId === item.id ? '…' : 'Eliminar'}</button>
                </div>
              ))
            )}
          </div>
        </article>
        <article className="panel installments-card" id="cuotas">
          <div className="panel-title">
            <div>
              <h2>Próximas cuotas</h2>
              <p>Compromisos futuros</p>
            </div>
            <span className="pill">{installmentPlans.length} {installmentPlans.length === 1 ? 'activa' : 'activas'}</span>
          </div>
          {installmentPlans.length === 0 ? (
            <div className="installments-empty">
              <span>✓</span>
              <strong>No tenés cuotas pendientes</strong>
              <small>Cuando registres una compra en cuotas, aparecerá acá.</small>
            </div>
          ) : (
            <div className="installments-list">
              {installmentPlans.map((plan) => (
                <div className="installment-item" key={plan.groupId}>
                  <div className="installment-header">
                    <div className="installment-info-col">
                      {plan.currentDateStr && (
                        <span className="installment-date">{formatShortDate(plan.currentDateStr)}</span>
                      )}
                      <strong className="installment-title">{plan.description}</strong>
                      <small className="installment-subtitle">Total compra: {money.format(plan.totalAmount)}</small>
                    </div>
                    <div className="installment-amount-col">
                      <strong className="installment-amount">{money.format(plan.monthlyAmount)}</strong>
                      <span className="installment-cuota-badge">Cuota {plan.vanCount}/{plan.installmentCount}</span>
                    </div>
                  </div>
                  <div className="installment-progress-bar">
                    <div
                      className="installment-progress-fill"
                      style={{ width: `${Math.min(plan.progressPercent, 100)}%` }}
                    />
                  </div>
                  <div className="installment-footer">
                    <span>Van {plan.vanCount} de {plan.installmentCount} cuotas</span>
                    <span>{plan.quedanCount > 0 ? `Quedan ${plan.quedanCount} cuotas (${money.format(plan.quedanTotal)})` : '¡Última cuota este mes!'}</span>
                  </div>
                </div>

              ))}
            </div>
          )}
        </article>

      </section>
    </section>
    <nav className="mobile-nav" aria-label="Navegación móvil">
      <a className="active" href="#resumen">
        <IconHome />
        <span>Inicio</span>
      </a>
      <a href="#movimientos">
        <IconMovements />
        <span>Movimientos</span>
      </a>
      <button aria-label="Agregar movimiento" onClick={() => setShowAdd(true)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <a href="#cuotas">
        <IconInstallments />
        <span>Cuotas</span>
      </a>
      <button aria-label="Ajustes" onClick={onOpenSettings}>
        <IconSettings />
        <span>Ajustes</span>
      </button>
    </nav>
    <button className="desktop-add" onClick={() => setShowAdd(true)}>＋ Agregar movimiento</button>
    {showAdd && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowAdd(false)}><form className="movement-form" onSubmit={addMovement} onMouseDown={(event) => event.stopPropagation()}><div><p className="eyebrow">NUEVO MOVIMIENTO</p><h2>Registrá una operación</h2></div><label>Descripción<input name="description" required placeholder="Ej. Verdulería" /></label><div className="form-grid"><label>Monto ARS<input name="amount" required min="0.01" step="0.01" type="number" /></label><label>Tipo<select name="kind"><option value="expense">Gasto</option><option value="income">Ingreso</option></select></label></div><div className="form-grid"><label>Categoría<input name="category" required placeholder="Alimentación" /></label><label>Fecha<input name="date" required type="date" defaultValue={todayKey()} /></label></div><div className="form-actions"><button type="button" onClick={() => setShowAdd(false)}>Cancelar</button><button className="primary-button" type="submit">Guardar</button></div></form></div>}
  </main>;
}
