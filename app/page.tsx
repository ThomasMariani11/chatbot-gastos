'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { createBrowserSupabase } from '../lib/supabase/client';

type Movement = { id: string; title: string; category: string; amount: number; date: string; kind: 'expense' | 'income'; icon: string };

const initialMovements: Movement[] = [
  { id: '1', title: 'Supermercado Coto', category: 'Alimentación', amount: 48320, date: 'Hoy, 18:42', kind: 'expense', icon: '🛒' },
  { id: '2', title: 'Carga SUBE', category: 'Transporte', amount: 12000, date: 'Hoy, 09:15', kind: 'expense', icon: '🚌' },
  { id: '3', title: 'Sueldo', category: 'Ingresos', amount: 1250000, date: '1 sep', kind: 'income', icon: '↗' },
  { id: '4', title: 'Internet', category: 'Servicios', amount: 28900, date: '31 ago', kind: 'expense', icon: '⌁' },
];

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

export default function Home() {
  const [month, setMonth] = useState('Septiembre 2026');
  const [movements, setMovements] = useState(initialMovements);
  const [budget, setBudget] = useState(900000);
  const [showAdd, setShowAdd] = useState(false);
  const expenses = useMemo(() => movements.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amount, 0), [movements]);
  const income = useMemo(() => movements.filter((item) => item.kind === 'income').reduce((sum, item) => sum + item.amount, 0), [movements]);
  const progress = Math.round((expenses / budget) * 100);
  const chartData = useMemo(() => {
    const grouped = new Map<string, number>();
    movements.filter((item) => item.kind === 'expense').forEach((item) => grouped.set(item.category, (grouped.get(item.category) ?? 0) + item.amount));
    return Array.from(grouped, ([name, value]) => ({ name, value }));
  }, [movements]);
  const chartColors = ['#20b984', '#655ad8', '#f4b44d', '#ea7172', '#4f9bd8'];

  useEffect(() => {
    const supabase = createBrowserSupabase();
    if (!supabase) return;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const monthStart = '2026-09-01';
      const [transactions, budgets] = await Promise.all([
        supabase.from('transactions').select('id,description,amount_ars,occurred_on,kind,status,categories(name)').eq('user_id', data.user.id).eq('status', 'confirmed').gte('occurred_on', monthStart).lt('occurred_on', '2026-10-01').order('occurred_on', { ascending: false }),
        supabase.from('budgets').select('amount_ars').eq('user_id', data.user.id).eq('month', monthStart).maybeSingle(),
      ]);
      if (transactions.data?.length) setMovements(transactions.data.map((row: Record<string, unknown>) => ({ id: String(row.id), title: String(row.description), category: String((row.categories as { name?: string } | null)?.name ?? 'Otros'), amount: Number(row.amount_ars), date: String(row.occurred_on), kind: row.kind as 'expense' | 'income', icon: row.kind === 'income' ? '↗' : '•' })));
      if (budgets.data?.amount_ars) setBudget(Number(budgets.data.amount_ars));
    });
  }, []);

  async function editBudget() {
    const raw = window.prompt('Presupuesto mensual en pesos argentinos', String(budget));
    const next = Number(raw);
    if (!Number.isFinite(next) || next <= 0) return;
    setBudget(next);
    const supabase = createBrowserSupabase();
    if (!supabase) return;
    const { data } = await supabase.auth.getUser();
    if (data.user) await supabase.from('budgets').upsert({ user_id: data.user.id, month: '2026-09-01', amount_ars: next }, { onConflict: 'user_id,month' });
  }

  async function addMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const kind = form.get('kind') as 'expense' | 'income';
    const next: Movement = { id: crypto.randomUUID(), title: String(form.get('description')), category: String(form.get('category')), amount: Number(form.get('amount')), date: String(form.get('date')), kind, icon: kind === 'income' ? '↗' : '•' };
    setMovements((current) => [next, ...current]);
    setShowAdd(false);
    const supabase = createBrowserSupabase();
    if (!supabase) return;
    const { data } = await supabase.auth.getUser();
    if (data.user) await supabase.from('transactions').insert({ user_id: data.user.id, kind, description: next.title, amount_ars: next.amount, occurred_on: next.date, status: 'confirmed', source: 'pwa' });
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">P</span><span>Pesito</span></div>
        <nav aria-label="Navegación principal">
          <a className="nav-item active" href="#resumen"><span>⌂</span>Resumen</a>
          <a className="nav-item" href="#movimientos"><span>↕</span>Movimientos</a>
          <a className="nav-item" href="#cuotas"><span>▣</span>Cuotas</a>
          <a className="nav-item" href="#categorias"><span>◇</span>Categorías</a>
          <a className="nav-item" href="/configuracion"><span>⚙</span>Configuración</a>
        </nav>
        <div className="bot-status"><span className="status-dot"/><div><strong>Bot conectado</strong><small>WhatsApp activo</small></div></div>
        <button className="profile" type="button"><span>TS</span><div><strong>Tomás</strong><small>Mi cuenta</small></div><b>›</b></button>
      </aside>

      <section className="content" id="resumen">
        <header className="topbar">
          <div><p className="eyebrow">TU RESUMEN</p><h1>Hola, Tomás <span>👋</span></h1><p>Así vienen tus finanzas este mes.</p></div>
          <div className="top-actions"><select aria-label="Mes" value={month} onChange={(event) => setMonth(event.target.value)}><option>Septiembre 2026</option><option>Agosto 2026</option></select><button aria-label="Notificaciones" className="icon-button">♢</button></div>
        </header>

        <section className="summary-grid" aria-label="Resumen mensual">
          <article className="summary-card expense"><div className="card-heading"><span className="metric-icon">↘</span><small>GASTOS DEL MES</small></div><strong>{money.format(expenses)}</strong><p><span className="trend up">↑ 8,4%</span> vs. mes anterior</p></article>
          <article className="summary-card income"><div className="card-heading"><span className="metric-icon">↗</span><small>INGRESOS DEL MES</small></div><strong>{money.format(income)}</strong><p><span className="trend down">↓ 2,1%</span> vs. mes anterior</p></article>
          <article className="summary-card balance"><div className="card-heading"><span className="metric-icon">◎</span><small>BALANCE</small></div><strong>{money.format(income - expenses)}</strong><p>Disponible este mes</p></article>
        </section>

        <section className="main-grid">
          <article className="panel budget-card">
            <div className="panel-title"><div><h2>Presupuesto mensual</h2><p>Tu límite de gastos para septiembre</p></div><button className="text-button" onClick={editBudget}>Editar</button></div>
            <div className="budget-numbers"><div><span>Gastado</span><strong>{money.format(expenses)}</strong></div><div className="align-right"><span>Presupuesto</span><strong>{money.format(budget)}</strong></div></div>
            <div className="progress-track"><span style={{ width: `${Math.min(progress, 100)}%` }}/></div>
            <div className="progress-copy"><span>{progress}% utilizado</span><span>Te quedan <strong>{money.format(budget - expenses)}</strong></span></div>
          </article>

          <article className="panel category-card">
            <div className="panel-title"><div><h2>Gastos por categoría</h2><p>Distribución del mes</p></div><button className="more-button">•••</button></div>
            <div className="chart-row">
              <div className="donut-chart" role="img" aria-label="Gráfico de gastos por categoría"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={chartData} dataKey="value" nameKey="name" innerRadius={37} outerRadius={58} stroke="none">{chartData.map((entry, index) => <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />)}</Pie></PieChart></ResponsiveContainer><div><strong>{money.format(expenses)}</strong><span>Total</span></div></div>
              <ul className="legend">{chartData.slice(0, 4).map((entry, index) => <li key={entry.name}><i style={{ background: chartColors[index % chartColors.length] }}/>{entry.name}<strong>{expenses ? Math.round(entry.value / expenses * 100) : 0}%</strong></li>)}</ul>
            </div>
          </article>

          <article className="panel movements-card" id="movimientos">
            <div className="panel-title"><div><h2>Últimos movimientos</h2><p>Tus operaciones más recientes</p></div><button className="text-button">Ver todos →</button></div>
            <div className="movement-list">{movements.map((item) => <div className="movement" key={item.id}><span className={`movement-icon ${item.kind}`}>{item.icon}</span><div><strong>{item.title}</strong><small>{item.category} · {item.date}</small></div><b className={item.kind}>{item.kind === 'expense' ? '−' : '+'}{money.format(item.amount)}</b></div>)}</div>
          </article>

          <article className="panel installments-card" id="cuotas">
            <div className="panel-title"><div><h2>Próximas cuotas</h2><p>Compromisos para octubre</p></div><span className="pill">3 activas</span></div>
            <div className="installment"><span>▤</span><div><strong>Notebook</strong><small>Cuota 3 de 12</small></div><b>{money.format(82500)}</b></div>
            <div className="installment"><span>▤</span><div><strong>Zapatillas</strong><small>Cuota 2 de 3</small></div><b>{money.format(28400)}</b></div>
            <div className="future-total"><span>Total comprometido</span><strong>{money.format(110900)}</strong></div>
          </article>
        </section>
      </section>
      <nav className="mobile-nav" aria-label="Navegación móvil"><a className="active" href="#resumen">⌂<span>Inicio</span></a><a href="#movimientos">↕<span>Movimientos</span></a><button aria-label="Agregar movimiento" onClick={() => setShowAdd(true)}>＋</button><a href="#cuotas">▣<span>Cuotas</span></a><a href="/configuracion">⚙<span>Ajustes</span></a></nav>
      <button className="desktop-add" onClick={() => setShowAdd(true)}>＋ Agregar movimiento</button>
      {showAdd && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowAdd(false)}><form className="movement-form" onSubmit={addMovement} onMouseDown={(event) => event.stopPropagation()}><div><p className="eyebrow">NUEVO MOVIMIENTO</p><h2>Registrá una operación</h2></div><label>Descripción<input name="description" required placeholder="Ej. Verdulería" /></label><div className="form-grid"><label>Monto ARS<input name="amount" required min="0.01" step="0.01" type="number" /></label><label>Tipo<select name="kind"><option value="expense">Gasto</option><option value="income">Ingreso</option></select></label></div><div className="form-grid"><label>Categoría<input name="category" required placeholder="Alimentación" /></label><label>Fecha<input name="date" required type="date" defaultValue="2026-09-02" /></label></div><div className="form-actions"><button type="button" onClick={() => setShowAdd(false)}>Cancelar</button><button className="primary-button" type="submit">Guardar</button></div></form></div>}
    </main>
  );
}
