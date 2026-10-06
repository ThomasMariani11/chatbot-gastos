import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { usePwaInstall } from './usePwaInstall';
import { InstallAppModal } from './InstallAppModal';

export type UserProfile = {
  id: string;
  email: string | null;
  role: 'admin' | 'client';
  subscription_status: 'active' | 'expired' | 'suspended' | 'pending_code';
  subscription_until: string | null;
  phone_number: string | null;
};

type Props = {
  userId: string;
  userEmail?: string | null;
  userProfile?: UserProfile | null;
  onBack: () => void;
  onSignOut?: () => void;
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
  onRefreshProfile?: () => void;
};

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function formatPhone(phone: string | null): string {
  if (!phone) return 'Sin vincular';
  if (phone.startsWith('549')) {
    return `+54 9 ${phone.slice(3, 5)} ${phone.slice(5, 9)}-${phone.slice(9)}`;
  }
  return `+${phone}`;
}

export function Settings({
  userId,
  userEmail,
  userProfile,
  onBack,
  onSignOut,
  isAdmin,
  onOpenAdmin,
  onRefreshProfile,
}: Props) {
  const [code, setCode] = useState<string>();
  const [waDirectUrl, setWaDirectUrl] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState('');
  const [botPhone, setBotPhone] = useState('');
  const [supportPhone, setSupportPhone] = useState('');
  const [paymentAlias, setPaymentAlias] = useState('');

  // PWA Install hook
  const {
    canInstall,
    isIos,
    triggerInstall,
    showIosModal,
    setShowIosModal,
    showDesktopModal,
    setShowDesktopModal,
  } = usePwaInstall();

  // Canje de código de renovación desde Ajustes
  const [showRedeemForm, setShowRedeemForm] = useState(false);
  const [renewalCode, setRenewalCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [redeemFeedback, setRedeemFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    supabase.from('app_settings').select('*').eq('user_id', userId).single().then(({ data, error }) => {
      if (error) return;
      setEnabled(data.whatsapp_responses_enabled);
    });

    supabase.from('system_config').select('key, value').in('key', ['whatsapp_bot_phone', 'support_phone', 'payment_alias']).then(({ data }) => {
      data?.forEach((row) => {
        if (row.key === 'whatsapp_bot_phone' && row.value) setBotPhone(row.value);
        if (row.key === 'support_phone' && row.value) setSupportPhone(row.value);
        if (row.key === 'payment_alias' && row.value) setPaymentAlias(row.value);
      });
    });
  }, [userId]);

  async function updateBotResponses(nextEnabled: boolean) {
    const { error } = await supabase
      .from('app_settings')
      .update({ whatsapp_responses_enabled: nextEnabled, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) {
      setStatus('No pudimos guardar los cambios.');
      return;
    }
    setEnabled(nextEnabled);
    setStatus(nextEnabled ? 'Bot activado.' : 'Bot pausado.');
    setTimeout(() => setStatus(''), 3000);
  }

  async function connectWhatsAppOneTouch() {
    setStatus('Generando enlace de vinculación…');
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    const nextCode = String(100000 + (values[0] % 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error } = await supabase.from('whatsapp_links').upsert({
      user_id: userId,
      link_code_hash: await sha256(nextCode),
      link_code_expires_at: expires,
      status: 'pending',
    }, { onConflict: 'user_id' });

    if (error) {
      setStatus('No se pudo generar el código.');
      return;
    }
    setCode(nextCode);

    const cleanPhone = botPhone.replace(/\D/g, '');
    const waUrl = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=VINCULAR%20${nextCode}`
      : `https://wa.me/?text=VINCULAR%20${nextCode}`;

    setWaDirectUrl(waUrl);
    setStatus(`Listo. Abrimos WhatsApp con tu mensaje. Tocá 'Enviar' en el chat (Código: VINCULAR ${nextCode}).`);

    // En móviles o PWAs, window.open tras una promesa async es bloqueado como popup por Safari/Chrome.
    // Modificar window.location.href abre directamente el Universal Link de WhatsApp de forma nativa.
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.matchMedia('(display-mode: standalone)').matches;
    if (isMobile) {
      window.location.href = waUrl;
    } else {
      const win = window.open(waUrl, '_blank');
      if (!win) {
        window.location.href = waUrl;
      }
    }
  }

  async function handleRedeemRenewal(e: FormEvent) {
    e.preventDefault();
    const clean = renewalCode.trim().toUpperCase();
    if (!clean) return;

    setIsRedeeming(true);
    setRedeemFeedback(null);

    const { data: checkData, error: checkError } = await supabase.rpc('check_invitation_code', {
      p_code: clean,
    });

    if (checkError || !checkData?.valid) {
      setIsRedeeming(false);
      setRedeemFeedback({
        type: 'error',
        message: checkData?.error || 'Código no válido o ya utilizado.',
      });
      return;
    }

    const { data: redeemData, error: redeemError } = await supabase.rpc('redeem_invitation_code', {
      p_code: clean,
      p_user_id: userId,
    });

    setIsRedeeming(false);

    if (redeemError || (redeemData && !redeemData.success)) {
      setRedeemFeedback({
        type: 'error',
        message: 'Error al activar código: ' + (redeemError?.message || redeemData?.error || 'Intentá nuevamente.'),
      });
      return;
    }

    const durationText = redeemData.duration_days ? `${redeemData.duration_days} días` : 'vitalicio';
    setRedeemFeedback({
      type: 'success',
      message: `¡Código activado con éxito! Se sumó acceso ${durationText}.`,
    });
    setRenewalCode('');
    if (onRefreshProfile) onRefreshProfile();
  }

  // Cálculos de suscripción
  const subscriptionInfo = useMemo(() => {
    if (isAdmin || !userProfile?.subscription_until) {
      return {
        isLifetime: true,
        daysLeft: null,
        formattedUntil: null,
        isExpiringSoon: false,
      };
    }
    const until = new Date(userProfile.subscription_until);
    const now = new Date();
    const diffMs = until.getTime() - now.getTime();
    const daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const formattedUntil = until.toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    return {
      isLifetime: false,
      daysLeft,
      formattedUntil,
      isExpiringSoon: daysLeft <= 7,
    };
  }, [isAdmin, userProfile]);

  const targetRenewalPhone = (supportPhone || botPhone).replace(/\D/g, '');
  const renewalText = encodeURIComponent(
    `¡Hola! Quiero renovar mi suscripción a Pesito para la cuenta: ${userEmail || ''}`
  );
  const whatsappRenewalUrl = targetRenewalPhone
    ? `https://wa.me/${targetRenewalPhone}?text=${renewalText}`
    : `https://wa.me/?text=${renewalText}`;

  return (
    <main className="settings-page">
      <button className="back-link button-link" type="button" onClick={onBack}>← Volver al resumen</button>
      <header>
        <p className="eyebrow">CONFIGURACIÓN</p>
        <h1>Ajustes y suscripción</h1>
        <p>Controlá tu cuenta, conexión con WhatsApp y estado de tu membresía.</p>
      </header>

      {/* ACCESO EXCLUSIVO ADMIN */}
      {isAdmin && onOpenAdmin && (
        <section className="settings-panel admin-highlight-box" style={{ background: '#0f172a', color: '#ffffff', border: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '1px', color: '#38bdf8', textTransform: 'uppercase' }}>ADMINISTRADOR</span>
              <h2 style={{ color: '#ffffff', margin: '2px 0 4px', fontSize: '18px' }}>Panel de Control</h2>
              <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>Gestioná licencias, códigos y clientes.</p>
            </div>
            <button
              type="button"
              className="primary-button"
              style={{ background: '#38bdf8', color: '#0f172a', fontWeight: 800, whiteSpace: 'nowrap' }}
              onClick={onOpenAdmin}
            >
              🛠️ Abrir Panel Admin
            </button>
          </div>
        </section>
      )}

      {/* SECCIÓN 1: MI SUSCRIPCIÓN */}
      <section className="settings-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--mint-dark)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              MEMBRESÍA
            </span>
            <h2 style={{ margin: '4px 0 6px' }}>Mi Suscripción</h2>
          </div>
          <div>
            {subscriptionInfo.isLifetime ? (
              <span className="status-pill green" style={{ fontSize: '12px' }}>🌟 Plan Vitalicio</span>
            ) : subscriptionInfo.isExpiringSoon ? (
              <span className="status-pill orange" style={{ fontSize: '12px' }}>⚠️ Vence pronto</span>
            ) : (
              <span className="status-pill green" style={{ fontSize: '12px' }}>🟢 Plan Activo</span>
            )}
          </div>
        </div>

        {subscriptionInfo.isLifetime ? (
          <p style={{ margin: '8px 0 16px' }}>
            Tu cuenta cuenta con acceso ilimitado y permanente a todas las funciones de Pesito.
          </p>
        ) : (
          <div style={{ margin: '10px 0 16px', background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '13px', color: '#64748b' }}>Fecha de vencimiento:</span>
              <strong style={{ fontSize: '13px', color: '#0f172a' }}>{subscriptionInfo.formattedUntil}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', color: '#64748b' }}>Días restantes:</span>
              <strong style={{ fontSize: '13px', color: subscriptionInfo.isExpiringSoon ? '#ea580c' : '#059669' }}>
                {subscriptionInfo.daysLeft} {subscriptionInfo.daysLeft === 1 ? 'día' : 'días'} de servicio
              </strong>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {!subscriptionInfo.isLifetime && (
            <a
              href={whatsappRenewalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="whatsapp-request-btn"
              style={{ padding: '10px 16px', fontSize: '13px' }}
            >
              <span>💬</span> Renovar por WhatsApp
            </a>
          )}
          <button
            type="button"
            className="button-link"
            style={{ fontSize: '12px', fontWeight: 700 }}
            onClick={() => setShowRedeemForm(!showRedeemForm)}
          >
            {showRedeemForm ? 'Cerrar formulario de código' : '¿Tenés un código de renovación?'}
          </button>
        </div>

        {paymentAlias && !subscriptionInfo.isLifetime && (
          <div style={{
            marginTop: '10px',
            padding: '8px 12px',
            background: '#f8fafc',
            borderRadius: '8px',
            fontSize: '12px',
            color: '#334155',
            border: '1px solid #e2e8f0',
            display: 'inline-block',
          }}>
            💸 Alias para transferencias: <strong style={{ color: '#0f172a' }}>{paymentAlias}</strong>
          </div>
        )}

        {/* Formulario colapsable para canjear código */}
        {showRedeemForm && (
          <form onSubmit={handleRedeemRenewal} style={{ marginTop: '16px', padding: '14px', background: '#f0fdf4', borderRadius: '12px', border: '1px dashed #86efac' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#166534', marginBottom: '8px' }}>
              Ingresá tu código de renovación
              <input
                type="text"
                required
                className="invite-code-input"
                placeholder="PESO-XXXX"
                value={renewalCode}
                onChange={(e) => setRenewalCode(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                style={{ width: '100%', boxSizing: 'border-box', marginTop: '6px' }}
              />
            </label>
            <button
              type="submit"
              className="primary-button"
              disabled={isRedeeming}
              style={{ marginTop: '8px', width: '100%' }}
            >
              {isRedeeming ? 'Validando…' : 'Canjear y extender suscripción'}
            </button>
            {redeemFeedback && (
              <p
                className={`form-message ${redeemFeedback.type === 'error' ? 'form-message-error' : ''}`}
                style={redeemFeedback.type === 'success' ? { background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', marginTop: '10px' } : { marginTop: '10px' }}
              >
                {redeemFeedback.type === 'success' ? '✅ ' : '❌ '}
                {redeemFeedback.message}
              </p>
            )}
          </form>
        )}
      </section>

      {/* SECCIÓN 2: CONEXIÓN WHATSAPP */}
      <section className="settings-panel">
        <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--mint-dark)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          INTEGRACIÓN
        </span>
        <h2 style={{ margin: '4px 0 6px' }}>Conexión con WhatsApp</h2>
        <p style={{ margin: '0 0 14px' }}>
          Tu WhatsApp te permite enviar audios, fotos y textos para registrar gastos en cualquier momento.
        </p>

        <div style={{ padding: '12px 14px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>NÚMERO VINCULADO</span>
            <strong style={{ fontSize: '14px', color: '#0f172a' }}>
              {userProfile?.phone_number ? formatPhone(userProfile.phone_number) : 'Sin vincular todavía'}
            </strong>
          </div>
          <button
            type="button"
            className="primary-button"
            style={{ background: '#25d366', color: '#fff', border: 'none', padding: '9px 15px', fontSize: '12px' }}
            onClick={() => void connectWhatsAppOneTouch()}
          >
            {userProfile?.phone_number ? '🔄 Cambiar número' : '🟢 Conectar en 1 toque'}
          </button>
        </div>

        {code && (
          <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div className="link-code">
              VINCULAR {code}
            </div>
            {waDirectUrl && (
              <a
                href={waDirectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="primary-button"
                style={{ background: '#25d366', color: '#fff', textAlign: 'center', textDecoration: 'none', fontWeight: 800, padding: '10px 16px', display: 'block' }}
              >
                💬 Abrir chat en WhatsApp
              </a>
            )}
          </div>
        )}
      </section>

      {/* SECCIÓN TÉCNICA (SÓLO ADMINISTRADOR) */}
      {isAdmin && (
        <section className="settings-panel warning">
          <span style={{ fontSize: '10px', fontWeight: 800, color: '#b45309', textTransform: 'uppercase' }}>SÓLO ADMIN</span>
          <h2 style={{ margin: '2px 0 8px', fontSize: '14px' }}>Control Técnico y Costos (Admin)</h2>
          <label className="switch-row" style={{ borderTop: 'none', padding: '8px 0 0' }}>
            <span>
              <strong>Respuestas del bot (Modo prueba)</strong>
              <small>Pausar respuestas automáticas del bot temporalmente para tu cuenta.</small>
            </span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => void updateBotResponses(e.target.checked)}
            />
          </label>
        </section>
      )}

      {/* SECCIÓN: INSTALACIÓN DE LA APP (PWA) */}
      <section className="settings-panel">
        <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--mint-dark)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          ACCESO RÁPIDO
        </span>
        <h2 style={{ margin: '4px 0 6px' }}>📲 Instalar Pesito en tu celular</h2>
        <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#64748b' }}>
          Instalá Pesito en tu pantalla de inicio para entrar más rápido, en pantalla completa y con la experiencia de una app nativa.
        </p>

        {canInstall ? (
          <button
            type="button"
            className="primary-button"
            onClick={triggerInstall}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 18px', fontSize: '13px' }}
          >
            📲 Instalar en este dispositivo
          </button>
        ) : (
          <div style={{ padding: '12px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', color: '#166534', fontWeight: 700, fontSize: '13px' }}>
            ✅ Pesito ya está instalado como app en este dispositivo.
          </div>
        )}
      </section>

      <InstallAppModal
        isOpen={showIosModal || showDesktopModal}
        onClose={() => {
          setShowIosModal(false);
          setShowDesktopModal(false);
        }}
        isIos={showIosModal}
      />

      {/* SECCIÓN 3: CUENTA Y SESIÓN */}
      <section className="settings-panel">
        <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          CUENTA
        </span>
        <h2 style={{ margin: '4px 0 6px' }}>Sesión</h2>
        <p style={{ margin: '0 0 14px' }}>
          Sesión iniciada con: <strong>{userEmail || userProfile?.email || 'Tu correo'}</strong>
        </p>
        {onSignOut && (
          <button className="danger-button" type="button" onClick={onSignOut}>
            Cerrar sesión
          </button>
        )}
      </section>

      {status && <p className="settings-status" role="status">{status}</p>}
    </main>
  );
}
