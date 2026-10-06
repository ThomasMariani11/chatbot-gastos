import { FormEvent, useEffect, useState } from 'react';
import { supabase } from './supabase';

interface Props {
  userId: string;
  userEmail?: string | null;
  subscriptionStatus: 'active' | 'expired' | 'suspended' | 'pending_code';
  subscriptionUntil: string | null;
  onSuccess: () => void;
  onSignOut: () => void;
}

export function Paywall({
  userId,
  userEmail,
  subscriptionStatus,
  subscriptionUntil,
  onSuccess,
  onSignOut,
}: Props) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [botPhone, setBotPhone] = useState<string>('');

  useEffect(() => {
    supabase
      .from('system_config')
      .select('value')
      .eq('key', 'whatsapp_bot_phone')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) setBotPhone(data.value);
      });
  }, []);

  async function handleRedeemCode(e: FormEvent) {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
      setErrorMsg('Ingresá un código de renovación o invitación.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    // 1. Verificar primero si el código existe y es válido
    const { data: checkData, error: checkError } = await supabase.rpc('check_invitation_code', {
      p_code: cleanCode,
    });

    if (checkError || !checkData?.valid) {
      setSubmitting(false);
      setErrorMsg(checkData?.error || 'El código no es válido o ya fue utilizado.');
      return;
    }

    // 2. Canjear el código para este usuario
    const { data: redeemData, error: redeemError } = await supabase.rpc('redeem_invitation_code', {
      p_code: cleanCode,
      p_user_id: userId,
    });

    setSubmitting(false);

    if (redeemError || (redeemData && !redeemData.success)) {
      setErrorMsg(
        'No se pudo activar el código: ' +
          (redeemError?.message || redeemData?.error || 'Intentá nuevamente.')
      );
      return;
    }

    const daysText = redeemData.duration_days
      ? `por ${redeemData.duration_days} días`
      : 'vitalicia';
    setSuccessMsg(`¡Membresía activada con éxito (${daysText})!`);

    setTimeout(() => {
      onSuccess();
    }, 1200);
  }

  function formatExpiration(dateStr: string | null) {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('es-AR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }

  const cleanPhone = botPhone.replace(/\D/g, '');
  const renewalText = encodeURIComponent(
    `¡Hola! Quiero renovar mi suscripción a Pesito para la cuenta: ${userEmail || ''}`
  );
  const whatsappUrl = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${renewalText}`
    : `https://wa.me/?text=${renewalText}`;

  const isSuspended = subscriptionStatus === 'suspended';
  const isPending = subscriptionStatus === 'pending_code';

  return (
    <main className="auth-page paywall-page">
      <section className="auth-card paywall-card">
        <img className="login-icon" src={`${import.meta.env.BASE_URL}icon-192.png`} alt="Pesito" />

        {isSuspended ? (
          <>
            <p className="eyebrow" style={{ color: '#ea580c' }}>CUENTA PAUSADA</p>
            <h1>Acceso suspendido ⏸️</h1>
            <p>
              Tu acceso a Pesito se encuentra temporalmente en pausa. Si creés que se trata de un error o deseás reactivarlo, comunicate por WhatsApp.
            </p>
          </>
        ) : isPending ? (
          <>
            <p className="eyebrow" style={{ color: 'var(--mint-dark)' }}>ACTIVACIÓN REQUERIDA</p>
            <h1>Activá tu cuenta 🔑</h1>
            <p>
              Pesito es un servicio privado. Para comenzar a usar la aplicación, ingresá tu código de invitación o solicitalo por WhatsApp.
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow" style={{ color: '#dc2626' }}>SUSCRIPCIÓN FINALIZADA</p>
            <h1>Tu plan ha vencido ⏳</h1>
            <p>
              {subscriptionUntil
                ? `Tu período de acceso finalizó el ${formatExpiration(subscriptionUntil)}.`
                : 'Tu período de acceso a Pesito ha finalizado.'}{' '}
              Renová tu membresía para seguir registrando tus gastos por WhatsApp y accediendo a tu panel.
            </p>
          </>
        )}

        {/* Formulario de canje de código */}
        <div className="paywall-section">
          <h3>¿Tenés un código de renovación?</h3>
          <p className="paywall-hint">Ingresá el código que te enviamos para desbloquear tu cuenta al instante.</p>
          <form onSubmit={handleRedeemCode} className="paywall-form">
            <input
              type="text"
              required
              className="invite-code-input"
              placeholder="PESO-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ''))}
              autoCapitalize="characters"
              spellCheck="false"
              autoCorrect="off"
            />
            <button type="submit" disabled={submitting}>
              {submitting ? 'Activando…' : 'Activar membresía'}
            </button>
          </form>

          {errorMsg && (
            <p className="form-message form-message-error" style={{ marginTop: '10px' }}>
              {errorMsg}
            </p>
          )}

          {successMsg && (
            <p
              className="form-message"
              style={{
                marginTop: '10px',
                background: '#ecfdf5',
                color: '#065f46',
                border: '1px solid #a7f3d0',
              }}
            >
              ✅ {successMsg}
            </p>
          )}
        </div>

        {/* Contacto directo por WhatsApp */}
        <div className="paywall-whatsapp-box">
          <p>¿Querés renovar tu plan o consultar opciones?</p>
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="whatsapp-request-btn"
            style={{ width: '100%', boxSizing: 'border-box' }}
          >
            <span>💬</span> Renovar por WhatsApp
          </a>
        </div>

        <div className="auth-footer-links" style={{ marginTop: '20px' }}>
          <button type="button" className="button-link auth-switch-link" onClick={onSignOut}>
            ← Cerrar sesión ({userEmail || 'usuario'})
          </button>
        </div>
      </section>
    </main>
  );
}
