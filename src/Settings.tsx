import { Icon } from './Icons';
import { useUpdateBlocker } from './PwaUpdates';
import type { ProfileDraft, ProfileDraftState } from './profileDraft';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { requestWhatsAppLinkCode } from './whatsappLink';
import { usePwaInstall } from './usePwaInstall';
import { InstallAppModal } from './InstallAppModal';
import { useSwipeBack } from './useSwipeBack';

export type UserProfile = {
  id: string;
  email: string | null;
  first_name?: string | null;
  last_name?: string | null;
  role: 'admin' | 'client';
  subscription_status: 'active' | 'expired' | 'suspended' | 'pending_code';
  subscription_until: string | null;
  phone_number: string | null;
};

type Props = {
  userId: string;
  userEmail?: string | null;
  userProfile?: UserProfile | null;
  nameDraft: { draft: ProfileDraft; state: ProfileDraftState };
  onBack: () => void;
  onSignOut?: () => void;
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
  onRefreshProfile?: () => void;
};

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
  nameDraft,
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

  const { draft, state: profileDraft } = nameDraft;
  useUpdateBlocker(showRedeemForm || isRedeeming || showIosModal || showDesktopModal);

  // Gesto táctil swipe back para volver deslizando la pantalla
  const { dragOffset, isSwiping } = useSwipeBack({ onBack });

  function navigateToDashboardSection(sectionHash: '#resumen' | '#movimientos' | '#cuotas') {
    window.history.pushState({ view: 'dashboard' }, '', sectionHash);
    window.dispatchEvent(new PopStateEvent('popstate', { state: { view: 'dashboard' } }));
  }

  async function handleSaveName(e: FormEvent) {
    e.preventDefault();
    if (await draft.save()) onRefreshProfile?.();
  }

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
    let nextCode: string;
    try {
      ({ code: nextCode } = await requestWhatsAppLinkCode());
    } catch {
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

    if (redeemError || redeemData?.success !== true) {
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
    <main
      className="settings-page"
      style={
        dragOffset > 0
          ? {
              transform: `translateX(${dragOffset}px)`,
              transition: isSwiping ? 'none' : 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
              willChange: 'transform',
            }
          : undefined
      }
    >
      <button className="back-link button-link" type="button" onClick={onBack}>← Volver al resumen</button>
      <header>
        <p className="eyebrow">CONFIGURACIÓN</p>
        <h1>Ajustes y suscripción</h1>
        <p>Controlá tu cuenta, conexión con WhatsApp y estado de tu membresía.</p>
      </header>

      {/* GRUPO 1: CUENTA */}
      <section className="settings-group" aria-labelledby="settings-group-cuenta">
        <h2 className="settings-group-title" id="settings-group-cuenta">Cuenta</h2>

        {/* MI SUSCRIPCIÓN */}
        <article className="settings-panel">
          <div className="settings-card-header">
            <h3>Mi Suscripción</h3>
            <div>
              {subscriptionInfo.isLifetime ? (
                <span className="status-pill green">Plan sin vencimiento</span>
              ) : subscriptionInfo.isExpiringSoon ? (
                <span className="status-pill orange">Vence pronto</span>
              ) : (
                <span className="status-pill green">Plan activo</span>
              )}
            </div>
          </div>

          {subscriptionInfo.isLifetime ? (
            <p className="settings-card-subtitle">
              Tu cuenta cuenta con acceso ilimitado y permanente a todas las funciones de Pesito.
            </p>
          ) : (
            <div className="settings-subscription-details">
              <div className="settings-subscription-row">
                <span>Fecha de vencimiento:</span>
                <strong>{subscriptionInfo.formattedUntil}</strong>
              </div>
              <div className="settings-subscription-row">
                <span>Días restantes:</span>
                <strong className={subscriptionInfo.isExpiringSoon ? 'expiring' : 'active'}>
                  {subscriptionInfo.daysLeft} {subscriptionInfo.daysLeft === 1 ? 'día' : 'días'} de servicio
                </strong>
              </div>
            </div>
          )}

          <div className="settings-subscription-actions">
            {!subscriptionInfo.isLifetime && (
              <a
                href={whatsappRenewalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="whatsapp-request-btn"
              >
                <span><Icon name="message" /></span> Renovar por WhatsApp
              </a>
            )}
            <button
              type="button"
              className="button-link renewal-code-link"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowRedeemForm(!showRedeemForm)}
            >
              {showRedeemForm ? 'Cerrar formulario de código' : '¿Tenés un código de renovación?'}
            </button>
          </div>

          {paymentAlias && !subscriptionInfo.isLifetime && (
            <div className="settings-alias-badge">
              <Icon name="card" size={16} /> Alias para transferencias: <strong>{paymentAlias}</strong>
            </div>
          )}

          {showRedeemForm && (
            <form onSubmit={handleRedeemRenewal} className="settings-redeem-form">
              <label className="settings-redeem-label">
                Ingresá tu código de renovación
                <input
                  type="text"
                  required
                  className="invite-code-input"
                  placeholder="PESO-XXXX"
                  value={renewalCode}
                  onChange={(e) => setRenewalCode(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                />
              </label>
              <button
                type="submit"
                className="primary-button settings-redeem-submit"
                disabled={isRedeeming}
              >
                {isRedeeming ? 'Validando…' : 'Canjear y extender suscripción'}
              </button>
              {redeemFeedback && (
                <p
                  className={`form-message ${redeemFeedback.type === 'error' ? 'form-message-error' : 'form-message-success'}`}
                >
                  <Icon name={redeemFeedback.type === 'success' ? 'check' : 'alert'} />
                  {redeemFeedback.message}
                </p>
              )}
            </form>
          )}
        </article>

        {/* MIS DATOS PERSONALES */}
        <article className="settings-panel">
          <h3>Mis Datos Personales</h3>
          <p className="settings-card-subtitle">
            Tu nombre se usará en el saludo de bienvenida y para identificar tu cuenta en Pesito.
          </p>

          <form onSubmit={handleSaveName} className="settings-profile-form">
            <div className="settings-name-grid">
              <label className="settings-label">
                <span>Nombre</span>
                <input
                  type="text"
                  className="settings-input"
                  value={profileDraft.value.first_name}
                  disabled={profileDraft.saving}
                  onChange={(e) => draft.edit('first_name', e.target.value)}
                  placeholder="Ej. María"
                  autoComplete="given-name"
                />
              </label>
              <label className="settings-label">
                <span>Apellido</span>
                <input
                  type="text"
                  className="settings-input"
                  value={profileDraft.value.last_name}
                  disabled={profileDraft.saving}
                  onChange={(e) => draft.edit('last_name', e.target.value)}
                  placeholder="Ej. González"
                  autoComplete="family-name"
                />
              </label>
            </div>

            {profileDraft.conflict && <p role="status" className="settings-draft-notice">Los datos de tu cuenta cambiaron. Conservamos lo que estabas escribiendo. Podés guardarlo o usar los datos actualizados.</p>}
            {profileDraft.error && <p role="alert" className="form-message form-message-error">{profileDraft.error}</p>}
            <div className="settings-profile-actions">
              <button
                className="settings-save-button"
                type="submit"
                disabled={profileDraft.saving || !profileDraft.dirty}
              >
                {profileDraft.saving ? 'Guardando…' : 'Guardar mis datos'}
              </button>
              {(profileDraft.dirty || profileDraft.conflict) && <button type="button" className="button-link" disabled={profileDraft.saving} onClick={() => draft.discard()}>{profileDraft.conflict ? 'Usar datos actualizados' : 'Descartar cambios'}</button>}
              {profileDraft.message && (
                <span className="settings-save-feedback">
                  {profileDraft.message}
                </span>
              )}
            </div>
          </form>
        </article>

        {/* SESIÓN */}
        <article className="settings-panel settings-compact-row">
          <div className="settings-compact-copy">
            <h3>Sesión</h3>
            <p>
              Sesión iniciada con <strong>{userEmail || userProfile?.email || 'Tu correo'}</strong>
            </p>
          </div>
          {onSignOut && (
            <button className="danger-button" type="button" onClick={onSignOut}>
              Cerrar sesión
            </button>
          )}
        </article>
      </section>

      {/* GRUPO 2: INTEGRACIONES */}
      <section className="settings-group" aria-labelledby="settings-group-integraciones">
        <h2 className="settings-group-title" id="settings-group-integraciones">Integraciones</h2>

        <article className="settings-panel">
          <h3>Conexión con WhatsApp</h3>
          <p className="settings-card-subtitle">
            Tu WhatsApp te permite enviar audios, fotos y textos para registrar gastos en cualquier momento.
          </p>

          <div className="settings-wa-box">
            <div>
              <span className="settings-wa-label">NÚMERO VINCULADO</span>
              <strong className="settings-wa-phone">
                {userProfile?.phone_number ? formatPhone(userProfile.phone_number) : 'Sin vincular todavía'}
              </strong>
            </div>
            <button
              type="button"
              className="button-secondary"
              onClick={() => void connectWhatsAppOneTouch()}
            >
              <Icon name={userProfile?.phone_number ? 'refresh' : 'message'} /> {userProfile?.phone_number ? 'Cambiar número' : 'Conectar en 1 toque'}
            </button>
          </div>

          {code && (
            <div className="settings-wa-code-wrap">
              <div className="link-code">
                VINCULAR {code}
              </div>
              {waDirectUrl && (
                <a
                  href={waDirectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button-secondary"
                >
                  <Icon name="message" /> Abrir chat en WhatsApp
                </a>
              )}
            </div>
          )}

          {isAdmin && (
            <div className="settings-bot-switch-row">
              <div className="settings-bot-switch-copy">
                <strong>Respuestas del bot (Modo prueba)</strong>
                <small>Pausar respuestas automáticas del bot temporalmente para tu cuenta.</small>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label="Respuestas del bot (Modo prueba)"
                className={`settings-switch ${enabled ? 'is-on' : ''}`}
                onClick={() => void updateBotResponses(!enabled)}
              >
                <span className="settings-switch-track">
                  <span className="settings-switch-thumb" />
                </span>
              </button>
            </div>
          )}
        </article>
      </section>

      {/* GRUPO 3: APP (SÓLO SI NO ESTÁ INSTALADA) */}
      {canInstall && (
        <section className="settings-group" aria-labelledby="settings-group-app">
          <h2 className="settings-group-title" id="settings-group-app">App</h2>
          <article className="settings-panel settings-compact-row">
            <div className="settings-compact-copy">
              <h3>Instalar Pesito en tu celular</h3>
              <p>
                Instalá Pesito en tu pantalla de inicio para entrar más rápido y en pantalla completa.
              </p>
            </div>
            <button
              type="button"
              className="button-secondary"
              onClick={triggerInstall}
            >
              <Icon name="smartphone" /> Instalar en este dispositivo
            </button>
          </article>
        </section>
      )}

      <InstallAppModal
        isOpen={showIosModal || showDesktopModal}
        onClose={() => {
          setShowIosModal(false);
          setShowDesktopModal(false);
        }}
        isIos={showIosModal}
      />

      {/* ACCESO EXCLUSIVO ADMIN (FILA COMPACTA AL PIE) */}
      {isAdmin && onOpenAdmin && (
        <section className="settings-panel admin-highlight-box settings-admin-row" aria-label="Panel de Control">
          <div className="settings-compact-copy">
            <h3>Panel de Control</h3>
            <p>Gestioná licencias, códigos y clientes.</p>
          </div>
          <button
            type="button"
            className="button-secondary"
            onClick={onOpenAdmin}
          >
            <Icon name="shield" /> Abrir Panel Admin
          </button>
        </section>
      )}

      {status && <p className="settings-status" role="status">{status}</p>}

      <nav className="mobile-nav" aria-label="Navegación móvil">
        <a
          href="#resumen"
          onClick={(e) => {
            e.preventDefault();
            navigateToDashboardSection('#resumen');
          }}
        >
          <Icon name="home" className="nav-icon" />
          <span>Inicio</span>
        </a>
        <a
          href="#movimientos"
          onClick={(e) => {
            e.preventDefault();
            navigateToDashboardSection('#movimientos');
          }}
        >
          <Icon name="movements" className="nav-icon" />
          <span>Movimientos</span>
        </a>
        <button
          type="button"
          aria-label="Agregar movimiento"
          onClick={() => navigateToDashboardSection('#resumen')}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <a
          href="#cuotas"
          onClick={(e) => {
            e.preventDefault();
            navigateToDashboardSection('#cuotas');
          }}
        >
          <Icon name="card" className="nav-icon" />
          <span>Cuotas</span>
        </a>
        <button
          type="button"
          className="active"
          aria-current="page"
          aria-label="Ajustes"
        >
          <Icon name="settings" className="nav-icon" />
          <span>Ajustes</span>
        </button>
      </nav>
    </main>
  );
}
