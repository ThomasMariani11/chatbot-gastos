import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';

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
  const [enabled, setEnabled] = useState(true);
  const [paid, setPaid] = useState(false);
  const [status, setStatus] = useState('');
  const [botPhone, setBotPhone] = useState('');

  // Canje de código de renovación desde Ajustes
  const [showRedeemForm, setShowRedeemForm] = useState(false);
  const [renewalCode, setRenewalCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [redeemFeedback, setRedeemFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    supabase.from('app_settings').select('*').eq('user_id', userId).single().then(({ data, error }) => {
      if (error) return;
      setEnabled(data.whatsapp_responses_enabled);
      setPaid(data.paid_service_messages_authorized);
    });

    supabase.from('system_config').select('value').eq('key', 'whatsapp_bot_phone').maybeSingle().then(({ data }) => {
      if (data?.value) setBotPhone(data.value);
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

  async function updatePaidMessages(nextPaid: boolean) {
    const { error } = await supabase
      .from('app_settings')
      .update({ paid_service_messages_authorized: nextPaid, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) {
      setStatus('No pudimos guardar los cambios.');
      return;
    }
    setPaid(nextPaid);
    setStatus('Configuración guardada.');
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

    window.open(waUrl, '_blank');
    setStatus(`Abrimos WhatsApp con tu mensaje listo. Tocá 'Enviar' en el chat (Código: VINCULAR ${nextCode}).`);
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

  const cleanPhone = botPhone.replace(/\D/g, '');
  const renewalText = encodeURIComponent(
    `¡Hola! Quiero renovar mi suscripción a Pesito para la cuenta: ${userEmail || ''}`
  );
  const whatsappRenewalUrl = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${renewalText}`
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
          <div className="link-code" style={{ marginBottom: '16px' }}>
            VINCULAR {code}
          </div>
        )}

        <label className="switch-row" style={{ borderTop: 'none', padding: '8px 0 0' }}>
          <span>
            <strong>Respuestas del bot</strong>
            <small>Podés pausar las respuestas automáticas del bot temporalmente.</small>
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => void updateBotResponses(e.target.checked)}
          />
        </label>
      </section>

      {/* SECCIÓN TÉCNICA (SÓLO ADMINISTRADOR) */}
      {isAdmin && (
        <section className="settings-panel warning">
          <span style={{ fontSize: '10px', fontWeight: 800, color: '#b45309', textTransform: 'uppercase' }}>SÓLO ADMIN</span>
          <h2 style={{ margin: '2px 0 8px', fontSize: '14px' }}>Control de Costos de Mensajería</h2>
          <label className="switch-row" style={{ borderTop: 'none' }}>
            <span>
              <strong>Autorizar mensajes pagos de Meta</strong>
              <small>Habilita el envío de mensajes que superen la ventana gratuita de 24 horas.</small>
            </span>
            <input
              type="checkbox"
              checked={paid}
              onChange={(e) => void updatePaidMessages(e.target.checked)}
            />
          </label>
        </section>
      )}

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
