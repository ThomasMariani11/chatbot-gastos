import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';

type ClientProfile = {
  id: string;
  email: string | null;
  role: 'admin' | 'client';
  subscription_status: 'active' | 'expired' | 'suspended';
  subscription_until: string | null;
  phone_number: string | null;
  created_at: string;
  updated_at: string;
};

type InvitationCode = {
  id: string;
  code: string;
  duration_days: number | null;
  is_used: boolean;
  used_by: string | null;
  used_at: string | null;
  created_by: string | null;
  notes: string | null;
  created_at: string;
};

type Props = {
  userId: string;
  onBack: () => void;
  onSignOut: () => void;
};

function generateRandomCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const yearSuffix = new Date().getFullYear();
  return `PESO-${rand}-${yearSuffix}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Sin vencimiento (Vitalicio)';
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatPhone(phone: string | null): string {
  if (!phone) return 'Sin vincular';
  if (phone.startsWith('549')) {
    return `+54 9 ${phone.slice(3, 5)} ${phone.slice(5, 9)}-${phone.slice(9)}`;
  }
  return `+${phone}`;
}

export function AdminPanel({ userId, onBack, onSignOut }: Props) {
  const [profiles, setProfiles] = useState<ClientProfile[]>([]);
  const [codes, setCodes] = useState<InvitationCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Tabs y Filtros
  const [activeTab, setActiveTab] = useState<'clients' | 'codes'>('clients');
  const [clientSearch, setClientSearch] = useState('');
  const [codeFilter, setCodeFilter] = useState<'all' | 'available' | 'used'>('all');

  // Formulario Generador
  const [durationDays, setDurationDays] = useState<number | 'lifetime'>(30);
  const [clientNote, setClientNote] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setErrorMsg(null);

    const [profilesRes, codesRes] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('invitation_codes').select('*').order('created_at', { ascending: false }),
    ]);

    if (profilesRes.error) {
      setErrorMsg('No se pudieron cargar los perfiles: ' + profilesRes.error.message);
    } else {
      setProfiles((profilesRes.data ?? []) as ClientProfile[]);
    }

    if (codesRes.error) {
      setErrorMsg((prev) => (prev ? prev + ' | ' : '') + 'No se pudieron cargar los códigos: ' + codesRes.error.message);
    } else {
      setCodes((codesRes.data ?? []) as InvitationCode[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  // Métricas
  const now = new Date();
  const clientsOnly = useMemo(() => profiles.filter((p) => p.role === 'client'), [profiles]);

  const activeClientsCount = useMemo(() => {
    return clientsOnly.filter((p) => {
      if (p.subscription_status === 'suspended') return false;
      if (!p.subscription_until) return true;
      return new Date(p.subscription_until) > now;
    }).length;
  }, [clientsOnly, now]);

  const expiringSoonCount = useMemo(() => {
    return clientsOnly.filter((p) => {
      if (!p.subscription_until || p.subscription_status === 'suspended') return false;
      const until = new Date(p.subscription_until);
      const diffMs = until.getTime() - now.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays > 0 && diffDays <= 7;
    }).length;
  }, [clientsOnly, now]);

  const availableCodesCount = useMemo(() => {
    return codes.filter((c) => !c.is_used).length;
  }, [codes]);

  // Generar Código
  async function handleCreateCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsGenerating(true);
    setCopyFeedback(null);

    const newCode = generateRandomCode();
    const finalDays = durationDays === 'lifetime' ? null : Number(durationDays);

    const { error } = await supabase.from('invitation_codes').insert({
      code: newCode,
      duration_days: finalDays,
      notes: clientNote.trim() || null,
      created_by: userId,
    });

    setIsGenerating(false);

    if (error) {
      window.alert('Error al generar código: ' + error.message);
      return;
    }

    setGeneratedCode(newCode);
    setClientNote('');
    void loadData();
  }

  // Copiar mensaje listo para WhatsApp
  function copyWhatsAppMessage(code: string) {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?invitacion=${code}`;
    const text = `¡Hola! Gracias por sumarte a Pesito 💰.\n\nPara activar tu cuenta:\n1. Entrá a este enlace exclusivo:\n${inviteUrl}\n2. Creá tu contraseña.\n3. Tocá 'Instalar' para tenerla como app en tu celular.\n4. ¡Listo! Ya podés registrar tus gastos por audio y texto por WhatsApp.`;

    void navigator.clipboard.writeText(text);
    setCopyFeedback('¡Mensaje copiado al portapapeles!');
    setTimeout(() => setCopyFeedback(null), 4000);
  }

  function copyOnlyLink(code: string) {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?invitacion=${code}`;
    void navigator.clipboard.writeText(inviteUrl);
    setCopyFeedback('¡Enlace copiado al portapapeles!');
    setTimeout(() => setCopyFeedback(null), 3000);
  }

  // Extender suscripción (+30 días)
  async function handleExtendDays(client: ClientProfile, daysToAdd = 30) {
    const confirm = window.confirm(`¿Querés sumar ${daysToAdd} días de suscripción a ${client.email}?`);
    if (!confirm) return;

    let baseDate = new Date();
    if (client.subscription_until) {
      const currentUntil = new Date(client.subscription_until);
      if (currentUntil > baseDate) {
        baseDate = currentUntil;
      }
    }

    const newDate = new Date(baseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);

    const { error } = await supabase
      .from('profiles')
      .update({
        subscription_status: 'active',
        subscription_until: newDate.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', client.id);

    if (error) {
      window.alert('No se pudo actualizar: ' + error.message);
    } else {
      void loadData();
    }
  }

  // Pausar / Reactivar cuenta
  async function handleToggleSuspend(client: ClientProfile) {
    const nextStatus = client.subscription_status === 'suspended' ? 'active' : 'suspended';
    const actionText = nextStatus === 'suspended' ? 'pausar el acceso de' : 'reactivar';
    const confirm = window.confirm(`¿Seguro que querés ${actionText} a ${client.email}?`);
    if (!confirm) return;

    const { error } = await supabase
      .from('profiles')
      .update({
        subscription_status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', client.id);

    if (error) {
      window.alert('No se pudo cambiar el estado: ' + error.message);
    } else {
      void loadData();
    }
  }

  // Eliminar código no utilizado
  async function handleDeleteCode(codeItem: InvitationCode) {
    if (codeItem.is_used) {
      window.alert('No podés eliminar un código que ya fue canjeado por un cliente.');
      return;
    }
    const confirm = window.confirm(`¿Anular y borrar el código ${codeItem.code}?`);
    if (!confirm) return;

    const { error } = await supabase.from('invitation_codes').delete().eq('id', codeItem.id);
    if (error) {
      window.alert('Error al borrar código: ' + error.message);
    } else {
      void loadData();
    }
  }

  // Filtros de clientes
  const filteredClients = useMemo(() => {
    return clientsOnly.filter((c) => {
      const q = clientSearch.toLowerCase().trim();
      if (!q) return true;
      return (c.email ?? '').toLowerCase().includes(q) || (c.phone_number ?? '').includes(q);
    });
  }, [clientsOnly, clientSearch]);

  // Filtros de códigos
  const filteredCodes = useMemo(() => {
    return codes.filter((c) => {
      if (codeFilter === 'available') return !c.is_used;
      if (codeFilter === 'used') return c.is_used;
      return true;
    });
  }, [codes, codeFilter]);

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <button className="back-link button-link" type="button" onClick={onBack}>
            ← Volver a mi Dashboard
          </button>
          <div className="admin-title-row">
            <span className="admin-badge">ADMIN</span>
            <h1>Panel de Control · Pesito</h1>
          </div>
          <p className="admin-subtitle">Gestión de licencias, clientes y suscripciones del negocio.</p>
        </div>
        <div className="admin-header-actions">
          <button className="secondary-button" type="button" onClick={() => void loadData()}>
            🔄 Actualizar
          </button>
          <button className="danger-button" type="button" onClick={onSignOut}>
            Cerrar sesión
          </button>
        </div>
      </header>

      {errorMsg && (
        <div className="admin-alert-banner danger">
          <span>⚠️ {errorMsg}</span>
        </div>
      )}

      {/* KPI CARDS */}
      <section className="admin-kpi-grid">
        <div className="admin-kpi-card">
          <span className="kpi-icon">👥</span>
          <div>
            <strong className="kpi-value">{activeClientsCount}</strong>
            <span className="kpi-label">Clientes activos</span>
          </div>
        </div>
        <div className="admin-kpi-card">
          <span className="kpi-icon">⚠️</span>
          <div>
            <strong className="kpi-value" style={{ color: expiringSoonCount > 0 ? '#d97706' : 'inherit' }}>
              {expiringSoonCount}
            </strong>
            <span className="kpi-label">Vencen en 7 días</span>
          </div>
        </div>
        <div className="admin-kpi-card">
          <span className="kpi-icon">🎟️</span>
          <div>
            <strong className="kpi-value">{availableCodesCount}</strong>
            <span className="kpi-label">Códigos disponibles</span>
          </div>
        </div>
        <div className="admin-kpi-card">
          <span className="kpi-icon">📊</span>
          <div>
            <strong className="kpi-value">{clientsOnly.length}</strong>
            <span className="kpi-label">Total registrados</span>
          </div>
        </div>
      </section>

      {/* GENERADOR DE CÓDIGOS */}
      <section className="admin-generator-card">
        <div className="generator-header">
          <div>
            <p className="eyebrow" style={{ color: 'var(--mint-dark)' }}>NUEVA LICENCIA</p>
            <h2>Generar Código de Invitación</h2>
            <p style={{ color: '#64748b', fontSize: '13px', margin: '4px 0 0' }}>
              Creá un código de un solo uso para enviarle a un cliente que acaba de abonar.
            </p>
          </div>
        </div>

        <form onSubmit={handleCreateCode} className="generator-form">
          <div className="form-grid">
            <label>
              Duración del plan
              <select
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value === 'lifetime' ? 'lifetime' : Number(e.target.value))}
              >
                <option value={30}>1 mes (30 días)</option>
                <option value={90}>3 meses (90 días)</option>
                <option value={180}>6 meses (180 días)</option>
                <option value={365}>1 año (365 días)</option>
                <option value="lifetime">Vitalicio (Sin vencimiento)</option>
              </select>
            </label>
            <label>
              Nota interna (opcional)
              <input
                type="text"
                placeholder="Ej. Pago Juan Pérez - MP"
                value={clientNote}
                onChange={(e) => setClientNote(e.target.value)}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '12px' }}>
            <button className="primary-button" type="submit" disabled={isGenerating}>
              {isGenerating ? 'Generando…' : '✨ Generar Código'}
            </button>
          </div>
        </form>

        {generatedCode && (
          <div className="generated-code-box">
            <div className="code-display">
              <span className="code-label">Código generado listo para enviar:</span>
              <strong className="code-token">{generatedCode}</strong>
            </div>
            <div className="code-actions">
              <button
                type="button"
                className="primary-button"
                style={{ background: '#25D366' }}
                onClick={() => copyWhatsAppMessage(generatedCode)}
              >
                📲 Copiar mensaje para WhatsApp
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => copyOnlyLink(generatedCode)}
              >
                🔗 Copiar solo enlace
              </button>
            </div>
            {copyFeedback && <p className="copy-feedback">✅ {copyFeedback}</p>}
          </div>
        )}
      </section>

      {/* PESTAÑAS DE NAVEGACIÓN TABULAR */}
      <section className="admin-content-tabs">
        <div className="tabs-header">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'clients' ? 'active' : ''}`}
            onClick={() => setActiveTab('clients')}
          >
            👥 Clientes ({clientsOnly.length})
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'codes' ? 'active' : ''}`}
            onClick={() => setActiveTab('codes')}
          >
            🎟️ Códigos de Invitación ({codes.length})
          </button>
        </div>

        {/* TAB 1: CLIENTES */}
        {activeTab === 'clients' && (
          <div className="tab-pane">
            <div className="table-controls">
              <input
                type="text"
                className="search-input"
                placeholder="🔍 Buscar cliente por email o WhatsApp…"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
              />
            </div>

            {loading ? (
              <p className="loading-copy">Cargando clientes…</p>
            ) : filteredClients.length === 0 ? (
              <div className="empty-state">
                <p>No se encontraron clientes registrados aún.</p>
              </div>
            ) : (
              <div className="admin-table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>WhatsApp</th>
                      <th>Estado</th>
                      <th>Vencimiento</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClients.map((client) => {
                      const isExpired = client.subscription_until && new Date(client.subscription_until) < now;
                      const isExpiringSoon =
                        !isExpired &&
                        client.subscription_until &&
                        (new Date(client.subscription_until).getTime() - now.getTime()) / (1000 * 60 * 60 * 24) <= 7;

                      return (
                        <tr key={client.id}>
                          <td>
                            <strong>{client.email ?? 'Sin email'}</strong>
                            <small className="cell-subtext">Alta: {formatDate(client.created_at)}</small>
                          </td>
                          <td>
                            {client.phone_number ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span className="status-pill green">🟢 {formatPhone(client.phone_number)}</span>
                                <a
                                  href={`https://wa.me/${client.phone_number}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="wa-link-btn"
                                  title="Abrir chat en WhatsApp"
                                >
                                  💬
                                </a>
                              </div>
                            ) : (
                              <span className="status-pill gray">⚪ Sin vincular</span>
                            )}
                          </td>
                          <td>
                            {client.subscription_status === 'suspended' ? (
                              <span className="status-pill gray">⏸️ Suspendido</span>
                            ) : isExpired ? (
                              <span className="status-pill red">🔴 Vencido</span>
                            ) : isExpiringSoon ? (
                              <span className="status-pill orange">⚠️ Vence pronto</span>
                            ) : (
                              <span className="status-pill green">🟢 Activo</span>
                            )}
                          </td>
                          <td>
                            <span>{formatDate(client.subscription_until)}</span>
                          </td>
                          <td>
                            <div className="action-buttons-group">
                              <button
                                type="button"
                                className="action-btn small"
                                title="Sumar 30 días"
                                onClick={() => void handleExtendDays(client, 30)}
                              >
                                ＋ 30 días
                              </button>
                              <button
                                type="button"
                                className="action-btn small secondary"
                                onClick={() => void handleToggleSuspend(client)}
                              >
                                {client.subscription_status === 'suspended' ? 'Reactivar' : 'Pausar'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: CÓDIGOS DE INVITACIÓN */}
        {activeTab === 'codes' && (
          <div className="tab-pane">
            <div className="table-controls">
              <div className="filter-pills">
                <button
                  type="button"
                  className={`pill-btn ${codeFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setCodeFilter('all')}
                >
                  Todos ({codes.length})
                </button>
                <button
                  type="button"
                  className={`pill-btn ${codeFilter === 'available' ? 'active' : ''}`}
                  onClick={() => setCodeFilter('available')}
                >
                  🟢 Disponibles ({availableCodesCount})
                </button>
                <button
                  type="button"
                  className={`pill-btn ${codeFilter === 'used' ? 'active' : ''}`}
                  onClick={() => setCodeFilter('used')}
                >
                  ⚪ Usados ({codes.length - availableCodesCount})
                </button>
              </div>
            </div>

            {loading ? (
              <p className="loading-copy">Cargando códigos…</p>
            ) : filteredCodes.length === 0 ? (
              <div className="empty-state">
                <p>No hay códigos en este filtro.</p>
              </div>
            ) : (
              <div className="admin-table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Duración</th>
                      <th>Nota</th>
                      <th>Estado</th>
                      <th>Fecha creación</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCodes.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong className="code-token-sm">{item.code}</strong>
                        </td>
                        <td>
                          <span>{item.duration_days ? `${item.duration_days} días` : 'Vitalicio'}</span>
                        </td>
                        <td>
                          <span style={{ color: '#64748b' }}>{item.notes ?? '—'}</span>
                        </td>
                        <td>
                          {item.is_used ? (
                            <span className="status-pill gray">⚪ Canjeado ({formatDate(item.used_at)})</span>
                          ) : (
                            <span className="status-pill green">🟢 Disponible</span>
                          )}
                        </td>
                        <td>
                          <small>{formatDate(item.created_at)}</small>
                        </td>
                        <td>
                          <div className="action-buttons-group">
                            <button
                              type="button"
                              className="action-btn small"
                              onClick={() => copyWhatsAppMessage(item.code)}
                            >
                              📲 WhatsApp
                            </button>
                            <button
                              type="button"
                              className="action-btn small secondary"
                              onClick={() => copyOnlyLink(item.code)}
                            >
                              🔗 Link
                            </button>
                            {!item.is_used && (
                              <button
                                type="button"
                                className="action-btn small danger"
                                title="Anular código"
                                onClick={() => void handleDeleteCode(item)}
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
