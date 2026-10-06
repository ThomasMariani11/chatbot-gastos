import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';

type ClientProfile = {
  id: string;
  email: string | null;
  role: 'admin' | 'client';
  subscription_status: 'active' | 'expired' | 'suspended' | 'pending_code';
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

  // Configuración de WhatsApp Bot
  const [botPhone, setBotPhone] = useState('');
  const [savingBotPhone, setSavingBotPhone] = useState(false);
  const [botPhoneSuccess, setBotPhoneSuccess] = useState<string | null>(null);

  // Corte general del bot (exclusivo admin)
  const [botActive, setBotActive] = useState(true);
  const [togglingBot, setTogglingBot] = useState(false);
  const [botStatusFeedback, setBotStatusFeedback] = useState<string | null>(null);

  // Modales interactivos (Extender Días y Pausar/Reactivar)
  const [extendingClient, setExtendingClient] = useState<ClientProfile | null>(null);
  const [selectedDaysOption, setSelectedDaysOption] = useState<number | 'lifetime' | 'custom'>(30);
  const [customDays, setCustomDays] = useState<number>(30);
  const [isSubmittingExtend, setIsSubmittingExtend] = useState(false);

  const [suspendingClient, setSuspendingClient] = useState<ClientProfile | null>(null);
  const [isSubmittingSuspend, setIsSubmittingSuspend] = useState(false);

  const [actionToast, setActionToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  async function loadData() {
    setLoading(true);
    setErrorMsg(null);

    const [profilesRes, codesRes, botPhoneRes, botActiveRes] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('invitation_codes').select('*').order('created_at', { ascending: false }),
      supabase.from('system_config').select('value').eq('key', 'whatsapp_bot_phone').maybeSingle(),
      supabase.from('system_config').select('value').eq('key', 'bot_active').maybeSingle(),
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

    if (botPhoneRes.data?.value) {
      setBotPhone(botPhoneRes.data.value);
    }

    if (botActiveRes.data?.value !== undefined) {
      setBotActive(botActiveRes.data.value !== 'false');
    }

    setLoading(false);
  }

  async function handleToggleBotActive() {
    setTogglingBot(true);
    setBotStatusFeedback(null);
    const nextActive = !botActive;
    const { error } = await supabase
      .from('system_config')
      .upsert({
        key: 'bot_active',
        value: String(nextActive),
        updated_at: new Date().toISOString(),
      });

    if (error) {
      setErrorMsg('No se pudo cambiar el estado del bot: ' + error.message);
    } else {
      setBotActive(nextActive);
      setBotStatusFeedback(
        nextActive
          ? '🟢 Bot reanudado: todos los clientes pueden enviar gastos.'
          : '🛑 Corte activado: el bot está pausado para los clientes.'
      );
      setTimeout(() => setBotStatusFeedback(null), 4000);
    }
    setTogglingBot(false);
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

  // Guardar número de WhatsApp del bot
  async function handleSaveBotPhone(e: FormEvent) {
    e.preventDefault();
    setSavingBotPhone(true);
    setBotPhoneSuccess(null);
    const cleanNumber = botPhone.trim().replace(/[^\d+]/g, '');
    const { error } = await supabase
      .from('system_config')
      .upsert({
        key: 'whatsapp_bot_phone',
        value: cleanNumber,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

    setSavingBotPhone(false);
    if (error) {
      window.alert('Error al guardar el número del bot: ' + error.message);
    } else {
      setBotPhone(cleanNumber);
      setBotPhoneSuccess('¡Número del bot guardado exitosamente!');
      setTimeout(() => setBotPhoneSuccess(null), 3500);
    }
  }

  // Cálculo dinámico de extensión para el modal
  const extendPreview = useMemo(() => {
    if (!extendingClient) return null;
    if (selectedDaysOption === 'lifetime') {
      return { isLifetime: true, text: '🌟 Plan Vitalicio (Permanente sin vencimiento)' };
    }
    const days = selectedDaysOption === 'custom' ? Math.max(1, customDays || 1) : selectedDaysOption;
    let baseDate = new Date();
    let isAccumulated = false;
    if (extendingClient.subscription_until) {
      const currentUntil = new Date(extendingClient.subscription_until);
      if (currentUntil > baseDate) {
        baseDate = currentUntil;
        isAccumulated = true;
      }
    }
    const targetDate = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
    const formatted = new Intl.DateTimeFormat('es-AR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(targetDate);

    return {
      isLifetime: false,
      days,
      text: `${formatted} (+${days} ${days === 1 ? 'día' : 'días'}${isAccumulated ? ' acumulados' : ''})`,
    };
  }, [extendingClient, selectedDaysOption, customDays]);

  function handleOpenExtendModal(client: ClientProfile) {
    setExtendingClient(client);
    setSelectedDaysOption(30);
    setCustomDays(30);
  }

  function handleOpenSuspendModal(client: ClientProfile) {
    setSuspendingClient(client);
  }

  async function handleConfirmExtendDays() {
    if (!extendingClient) return;
    setIsSubmittingExtend(true);
    setActionToast(null);

    let nextUntil: string | null = null;
    let daysAdded = 0;

    if (selectedDaysOption === 'lifetime') {
      nextUntil = null;
    } else {
      daysAdded = selectedDaysOption === 'custom' ? Math.max(1, customDays || 1) : selectedDaysOption;
      let baseDate = new Date();
      if (extendingClient.subscription_until) {
        const currentUntil = new Date(extendingClient.subscription_until);
        if (currentUntil > baseDate) {
          baseDate = currentUntil;
        }
      }
      nextUntil = new Date(baseDate.getTime() + daysAdded * 24 * 60 * 60 * 1000).toISOString();
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        subscription_status: 'active',
        subscription_until: nextUntil,
        updated_at: new Date().toISOString(),
      })
      .eq('id', extendingClient.id);

    setIsSubmittingExtend(false);

    if (error) {
      setActionToast({ type: 'error', message: 'No se pudo actualizar la suscripción: ' + error.message });
    } else {
      const msg = selectedDaysOption === 'lifetime'
        ? `🌟 Plan cambiado a Vitalicio para ${extendingClient.email}.`
        : `✅ Se sumaron ${daysAdded} días de servicio a ${extendingClient.email}.`;
      setActionToast({ type: 'success', message: msg });
      setExtendingClient(null);
      void loadData();
      setTimeout(() => setActionToast(null), 4000);
    }
  }

  async function handleConfirmToggleSuspend() {
    if (!suspendingClient) return;
    setIsSubmittingSuspend(true);
    setActionToast(null);

    const isCurrentlySuspended = suspendingClient.subscription_status === 'suspended';
    const nextStatus = isCurrentlySuspended ? 'active' : 'suspended';

    const { error } = await supabase
      .from('profiles')
      .update({
        subscription_status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', suspendingClient.id);

    setIsSubmittingSuspend(false);

    if (error) {
      setActionToast({ type: 'error', message: 'No se pudo actualizar el estado: ' + error.message });
    } else {
      const msg = isCurrentlySuspended
        ? `🟢 Cuenta reactivada para ${suspendingClient.email}.`
        : `⏸️ Cuenta pausada para ${suspendingClient.email}.`;
      setActionToast({ type: 'success', message: msg });
      setSuspendingClient(null);
      void loadData();
      setTimeout(() => setActionToast(null), 4000);
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
          <button
            type="button"
            className="admin-header-btn secondary"
            onClick={() => void loadData()}
            disabled={loading}
          >
            <span>{loading ? '⏳' : '🔄'}</span>
            <span>{loading ? 'Actualizando…' : 'Actualizar'}</span>
          </button>
          <button
            type="button"
            className="admin-header-btn danger"
            onClick={onSignOut}
          >
            <span>🚪</span>
            <span>Cerrar sesión</span>
          </button>
        </div>
      </header>

      {errorMsg && (
        <div className="admin-alert-banner danger">
          <span>⚠️ {errorMsg}</span>
        </div>
      )}

      {actionToast && (
        <div
          className={`admin-alert-banner ${actionToast.type === 'error' ? 'danger' : ''}`}
          style={actionToast.type === 'success' ? { background: '#ecfdf5', borderColor: '#a7f3d0', color: '#065f46' } : {}}
        >
          <span>{actionToast.message}</span>
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

      {/* CORTE GENERAL DEL BOT (EXCLUSIVO ADMIN) */}
      <section
        className="admin-generator-card"
        style={{
          marginBottom: '24px',
          border: `1px solid ${botActive ? '#e2e8f0' : '#fca5a5'}`,
        }}
      >
        <div className="generator-header">
          <div>
            <p className="eyebrow" style={{ color: 'var(--mint-dark)' }}>CONTROL DE DISPONIBILIDAD</p>
            <h2>Corte General del Bot (Interruptor Maestro)</h2>
            <p style={{ color: '#64748b', fontSize: '13px', margin: '4px 0 0' }}>
              Solo vos como administrador podés activar el corte del bot o reanudar las respuestas para todos los clientes.
            </p>
          </div>
          <div>
            {botActive ? (
              <span className="status-pill green" style={{ fontSize: '12px' }}>🟢 Bot Operativo</span>
            ) : (
              <span className="status-pill red" style={{ fontSize: '12px' }}>🛑 Corte Activado</span>
            )}
          </div>
        </div>

        <div
          style={{
            marginTop: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            background: botActive ? '#f8fafc' : '#fef2f2',
            padding: '14px 18px',
            borderRadius: '12px',
            border: `1px solid ${botActive ? '#e2e8f0' : '#fecaca'}`,
          }}
        >
          <div>
            <strong style={{ display: 'block', fontSize: '14px', color: botActive ? '#0f172a' : '#991b1b' }}>
              {botActive
                ? 'El bot está procesando mensajes y gastos normalmente'
                : 'Corte activo: El bot está pausado para clientes'}
            </strong>
            <small style={{ color: botActive ? '#64748b' : '#b91c1c' }}>
              {botActive
                ? 'Cualquier cliente con membresía activa puede enviar gastos, audios y tickets.'
                : 'Los mensajes de clientes recibirán un aviso de mantenimiento y no registrarán operaciones.'}
            </small>
          </div>
          <button
            type="button"
            className={botActive ? 'danger-button' : 'primary-button'}
            style={{ padding: '9px 18px', fontSize: '13px', fontWeight: 700 }}
            disabled={togglingBot}
            onClick={() => void handleToggleBotActive()}
          >
            {togglingBot
              ? 'Guardando…'
              : botActive
              ? '🛑 Activar corte del bot'
              : '🟢 Desactivar corte (Reanudar)'}
          </button>
        </div>
        {botStatusFeedback && (
          <p style={{ margin: '10px 0 0', fontSize: '13px', fontWeight: 600, color: botActive ? '#059669' : '#dc2626' }}>
            {botStatusFeedback}
          </p>
        )}
      </section>

      {/* CONFIGURACIÓN DEL NÚMERO DE WHATSAPP DEL BOT (FASE 4) */}
      <section className="admin-generator-card" style={{ marginBottom: '24px' }}>
        <div className="generator-header">
          <div>
            <p className="eyebrow" style={{ color: 'var(--mint-dark)' }}>CONFIGURACIÓN DEL SISTEMA</p>
            <h2>Número de WhatsApp del Bot</h2>
            <p style={{ color: '#64748b', fontSize: '13px', margin: '4px 0 0' }}>
              Este es el número al que tus clientes enviarán sus gastos y audios. El botón <strong>"Conectar mi WhatsApp en 1 toque"</strong> abrirá este chat automáticamente.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveBotPhone} className="generator-form">
          <div className="form-grid">
            <label>
              Número de WhatsApp (con código de país sin espacios ni signos, ej. 5491122334455 o 15551234567)
              <input
                type="text"
                placeholder="Ej. 5491122334455"
                value={botPhone}
                onChange={(e) => setBotPhone(e.target.value)}
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap' }}>
            <button className="primary-button" type="submit" disabled={savingBotPhone}>
              {savingBotPhone ? 'Guardando…' : '💾 Guardar número del bot'}
            </button>
            {botPhoneSuccess && (
              <span style={{ fontSize: '13px', color: '#16a34a', fontWeight: 700 }}>
                {botPhoneSuccess}
              </span>
            )}
            {botPhone && (
              <a
                href={`https://wa.me/${botPhone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="button-link"
                style={{ fontSize: '12px', fontWeight: 700 }}
              >
                Probar chat en WhatsApp ↗
              </a>
            )}
          </div>
        </form>
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
                            {client.subscription_status === 'pending_code' ? (
                              <span className="status-pill orange">🟡 Pendiente activación</span>
                            ) : client.subscription_status === 'suspended' ? (
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
                                title="Sumar días de suscripción"
                                onClick={() => handleOpenExtendModal(client)}
                              >
                                ＋ Días
                              </button>
                              <button
                                type="button"
                                className="action-btn small secondary"
                                onClick={() => handleOpenSuspendModal(client)}
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
      {/* MODAL: EXTENDER DÍAS DE SUSCRIPCIÓN */}
      {extendingClient && (
        <div className="admin-modal-backdrop" onClick={() => !isSubmittingExtend && setExtendingClient(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <div>
                <h3>Sumar días de suscripción</h3>
                <p>Cliente: <strong>{extendingClient.email}</strong></p>
              </div>
              <button
                type="button"
                className="admin-modal-close"
                disabled={isSubmittingExtend}
                onClick={() => setExtendingClient(null)}
              >
                ✕
              </button>
            </div>

            <div>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '8px' }}>
                Elegí cuánto tiempo querés sumar:
              </span>
              <div className="admin-days-grid">
                {[
                  { value: 15, label: '+15 días', desc: 'Quincena' },
                  { value: 30, label: '+30 días', desc: '1 Mes' },
                  { value: 60, label: '+60 días', desc: '2 Meses' },
                  { value: 90, label: '+90 días', desc: '3 Meses (Trimestre)' },
                  { value: 180, label: '+180 días', desc: '6 Meses (Semestre)' },
                  { value: 365, label: '+365 días', desc: '1 Año' },
                  { value: 'lifetime', label: '🌟 Vitalicio', desc: 'Sin vencimiento' },
                  { value: 'custom', label: '✏️ Personalizado', desc: 'Elegir días' },
                ].map((opt) => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    className={`admin-day-chip ${selectedDaysOption === opt.value ? 'active' : ''}`}
                    onClick={() => setSelectedDaysOption(opt.value as number | 'lifetime' | 'custom')}
                  >
                    <span>{opt.label}</span>
                    <small>{opt.desc}</small>
                  </button>
                ))}
              </div>

              {selectedDaysOption === 'custom' && (
                <div className="admin-custom-days-row">
                  <label>
                    Cantidad exacta de días:
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      className="admin-custom-days-input"
                      value={customDays}
                      onChange={(e) => setCustomDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    />
                    <span>días</span>
                  </label>
                </div>
              )}
            </div>

            {extendPreview && (
              <div className="admin-date-preview-card">
                <span className="preview-label">Nuevo vencimiento proyectado</span>
                <strong className="preview-value">{extendPreview.text}</strong>
                <small style={{ color: '#047857', fontSize: '11px', marginTop: '2px' }}>
                  Vencimiento actual: {formatDate(extendingClient.subscription_until)}
                </small>
              </div>
            )}

            <div className="admin-modal-actions">
              <button
                type="button"
                className="admin-btn-cancel"
                disabled={isSubmittingExtend}
                onClick={() => setExtendingClient(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={isSubmittingExtend}
                onClick={() => void handleConfirmExtendDays()}
              >
                {isSubmittingExtend ? 'Guardando…' : 'Confirmar y sumar días'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: PAUSAR / REACTIVAR CUENTA */}
      {suspendingClient && (
        <div className="admin-modal-backdrop" onClick={() => !isSubmittingSuspend && setSuspendingClient(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <div>
                <h3>
                  {suspendingClient.subscription_status === 'suspended'
                    ? '🟢 Reactivar cuenta'
                    : '⏸️ Pausar cuenta'}
                </h3>
                <p>Cliente: <strong>{suspendingClient.email}</strong></p>
              </div>
              <button
                type="button"
                className="admin-modal-close"
                disabled={isSubmittingSuspend}
                onClick={() => setSuspendingClient(null)}
              >
                ✕
              </button>
            </div>

            <div className={`admin-date-preview-card ${suspendingClient.subscription_status === 'suspended' ? '' : 'danger'}`}>
              <span className="preview-label">
                {suspendingClient.subscription_status === 'suspended' ? 'Efecto de la reactivación' : 'Efecto de la pausa'}
              </span>
              <p style={{ margin: '4px 0 0', fontSize: '13px', lineHeight: 1.5, color: '#334155' }}>
                {suspendingClient.subscription_status === 'suspended'
                  ? 'El bot volverá a responder los mensajes de WhatsApp de este cliente y se habilitará su acceso a la app.'
                  : 'El bot dejará de responder los mensajes de WhatsApp de este cliente y se mostrará un aviso de cuenta pausada al entrar a la app. Podrás reactivarlo en cualquier momento.'}
              </p>
            </div>

            <div className="admin-modal-actions">
              <button
                type="button"
                className="admin-btn-cancel"
                disabled={isSubmittingSuspend}
                onClick={() => setSuspendingClient(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={suspendingClient.subscription_status === 'suspended' ? 'primary-button' : 'danger-button'}
                disabled={isSubmittingSuspend}
                onClick={() => void handleConfirmToggleSuspend()}
              >
                {isSubmittingSuspend
                  ? 'Guardando…'
                  : suspendingClient.subscription_status === 'suspended'
                  ? '🟢 Sí, reactivar cuenta'
                  : '⏸️ Sí, pausar cuenta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
