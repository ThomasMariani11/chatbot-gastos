import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { supabase } from './supabase';

type Movement = { id: string; title: string; category: string; amount: number; date: string; kind: 'expense' | 'income'; icon: string };
type Props = { userId: string; onOpenSettings: () => void; onSignOut: () => void };

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const monthLabel = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' });

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(key: string, offset: number) {
  const [year, month] = key.split('-').map(Number);
  return monthKey(new Date(year, month - 1 + offset, 1));
}

function labelForMonth(key: string) {
  const [year, month] = key.split('-').map(Number);
  const label = monthLabel.format(new Date(year, month - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}

export function Dashboard({ userId, onOpenSettings, onSignOut }: Props) {
  const currentMonth = monthKey(new Date());
  const [month, setMonth] = useState(currentMonth);
  const [movements, setMovements] = useState<Movement[]>([]);
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
      const [transactions, budgets] = await Promise.all([
        supabase.from('transactions').select('id,description,amount_ars,occurred_on,kind,categories(name)').eq('user_id', userId).eq('status', 'confirmed').gte('occurred_on', monthStart).lt('occurred_on', monthEnd).order('occurred_on', { ascending: false }),
        supabase.from('budgets').select('amount_ars').eq('user_id', userId).eq('month', monthStart).maybeSingle(),
      ]);
      loading = false;
      if (!active) return;
      if (!transactions.error) setMovements((transactions.data ?? []).map((row: Record<string, unknown>) => ({ id: String(row.id), title: String(row.description), category: String((row.categories as { name?: string } | null)?.name ?? 'Otros'), amount: Number(row.amount_ars), date: String(row.occurred_on), kind: row.kind as 'expense' | 'income', icon: row.kind === 'income' ? '↗' : '•' })));
      if (!budgets.error) setBudget(budgets.data?.amount_ars ? Number(budgets.data.amount_ars) : 0);
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
        <a className="nav-item active" href="#resumen"><span>⌂</span>Resumen</a>
        <a className="nav-item" href="#movimientos"><span>↕</span>Movimientos</a>
        <a className="nav-item" href="#cuotas"><span>▣</span>Cuotas</a>
        <button className="nav-item nav-button" type="button" onClick={onOpenSettings}><span>⚙</span>Configuración</button>
      </nav>
      <div className="bot-status"><span className="status-dot"/><div><strong>Bot conectado</strong><small>WhatsApp activo</small></div></div>
      <button className="profile logout-button" type="button" onClick={onSignOut}><span>TS</span><div><strong>Thomas</strong><small>Cerrar sesión</small></div><b>›</b></button>
    </aside>
    <section className="content" id="resumen">
      <header className="topbar"><div><p className="eyebrow">TU RESUMEN</p><h1>Hola, Thomas <span>👋</span></h1><p>Así vienen tus finanzas este mes.</p></div><div className="top-actions"><select aria-label="Mes" value={month} onChange={(event) => setMonth(event.target.value)}><option value={currentMonth}>{labelForMonth(currentMonth)}</option><option value={shiftMonth(currentMonth, -1)}>{labelForMonth(shiftMonth(currentMonth, -1))}</option></select><button aria-label="Notificaciones" className="icon-button">♢</button></div></header>
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
        <article className="panel movements-card" id="movimientos"><div className="panel-title"><div><h2>Últimos movimientos</h2><p>Tus operaciones más recientes</p></div></div><div className="movement-list">{movements.length === 0 ? <p className="empty-movements">Todavía no hay movimientos en este mes.</p> : movements.map((item) => <div className="movement" key={item.id}><span className={`movement-icon ${item.kind}`}>{item.icon}</span><div><strong>{item.title}</strong><small>{item.category} · {item.date}</small></div><b className={item.kind}>{item.kind === 'expense' ? '−' : '+'}{money.format(item.amount)}</b><button className="movement-delete" type="button" disabled={deletingId === item.id} onClick={() => void deleteMovement(item)} aria-label={`Eliminar ${item.title}`}>{deletingId === item.id ? '…' : 'Eliminar'}</button></div>)}</div></article>
        <article className="panel installments-card" id="cuotas"><div className="panel-title"><div><h2>Próximas cuotas</h2><p>Compromisos futuros</p></div><span className="pill">0 activas</span></div><div className="installments-empty"><span>✓</span><strong>No tenés cuotas pendientes</strong><small>Cuando registres una compra en cuotas, aparecerá acá.</small></div></article>
      </section>
    </section>
    <nav className="mobile-nav" aria-label="Navegación móvil"><a className="active" href="#resumen">⌂<span>Inicio</span></a><a href="#movimientos">↕<span>Movimientos</span></a><button aria-label="Agregar movimiento" onClick={() => setShowAdd(true)}>＋</button><a href="#cuotas">▣<span>Cuotas</span></a><button aria-label="Ajustes" onClick={onOpenSettings}>⚙<span>Ajustes</span></button></nav>
    <button className="desktop-add" onClick={() => setShowAdd(true)}>＋ Agregar movimiento</button>
    {showAdd && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowAdd(false)}><form className="movement-form" onSubmit={addMovement} onMouseDown={(event) => event.stopPropagation()}><div><p className="eyebrow">NUEVO MOVIMIENTO</p><h2>Registrá una operación</h2></div><label>Descripción<input name="description" required placeholder="Ej. Verdulería" /></label><div className="form-grid"><label>Monto ARS<input name="amount" required min="0.01" step="0.01" type="number" /></label><label>Tipo<select name="kind"><option value="expense">Gasto</option><option value="income">Ingreso</option></select></label></div><div className="form-grid"><label>Categoría<input name="category" required placeholder="Alimentación" /></label><label>Fecha<input name="date" required type="date" defaultValue={todayKey()} /></label></div><div className="form-actions"><button type="button" onClick={() => setShowAdd(false)}>Cancelar</button><button className="primary-button" type="submit">Guardar</button></div></form></div>}
  </main>;
}
