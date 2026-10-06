import { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

type AuthMode = 'login' | 'register';

interface CodeCheckState {
  checking: boolean;
  valid: boolean | null;
  message: string;
  durationDays?: number | null;
}

export function Login() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [codeState, setCodeState] = useState<CodeCheckState>({
    checking: false,
    valid: null,
    message: '',
  });

  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [sending, setSending] = useState(false);
  const [useOtp, setUseOtp] = useState(false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. Detectar si vino código por parámetro en la URL (?invitacion=PESO-XXXX o ?code=PESO-XXXX)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const codeFromUrl = params.get('invitacion') || params.get('code') || params.get('invite');
      if (codeFromUrl) {
        const clean = codeFromUrl.trim().toUpperCase();
        setMode('register');
        setInviteCode(clean);
        void checkCode(clean);
      }
    } catch {
      // ignore
    }
  }, []);

  // 2. Función de verificación de código de invitación vía RPC
  async function checkCode(codeToValidate: string) {
    const clean = codeToValidate.trim().toUpperCase();
    if (!clean) {
      setCodeState({ checking: false, valid: null, message: '' });
      return false;
    }

    setCodeState({ checking: true, valid: null, message: 'Verificando código…' });

    const { data, error } = await supabase.rpc('check_invitation_code', { p_code: clean });

    if (error || !data) {
      setCodeState({
        checking: false,
        valid: false,
        message: 'No pudimos verificar el código. Comprobá tu conexión.',
      });
      return false;
    }

    if (data.valid) {
      const durationText = data.duration_days
        ? `Licencia de ${data.duration_days} días`
        : 'Licencia vitalicia (sin vencimiento)';

      setCodeState({
        checking: false,
        valid: true,
        message: `Código válido: ${durationText}`,
        durationDays: data.duration_days,
      });
      return true;
    } else {
      setCodeState({
        checking: false,
        valid: false,
        message: data.error || 'Código inválido o ya utilizado.',
      });
      return false;
    }
  }

  // Manejar cambio en el input de código con debounce
  function handleCodeChange(val: string) {
    const clean = val.toUpperCase().replace(/\s+/g, '');
    setInviteCode(clean);
    setMessage('');
    setIsError(false);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (clean.length >= 4) {
      debounceTimerRef.current = setTimeout(() => {
        void checkCode(clean);
      }, 400);
    } else {
      setCodeState({ checking: false, valid: null, message: '' });
    }
  }

  function getErrorMessage(error: { message: string }) {
    const raw = error.message || '';
    const lower = raw.toLowerCase();
    if (lower.includes('invalid login credentials')) {
      return 'Correo o contraseña incorrectos.';
    }
    if (
      lower.includes('load failed') ||
      lower.includes('failed to fetch') ||
      lower.includes('network') ||
      lower.includes('abort')
    ) {
      return 'No se pudo conectar con el servidor. Es probable que el proyecto de Supabase esté pausado por inactividad o que haya un problema de red.';
    }
    if (lower.includes('email not confirmed')) {
      return 'El correo electrónico todavía no fue confirmado. Revisá tu casilla.';
    }
    if (lower.includes('user already registered') || lower.includes('already registered')) {
      return 'Ya existe una cuenta con este correo electrónico. Probá iniciar sesión.';
    }
    if (lower.includes('password should be at least')) {
      return 'La contraseña debe tener al menos 6 caracteres.';
    }
    return raw;
  }

  // 3. Login con contraseña
  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setMessage('');
    setIsError(false);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setIsError(true);
      setMessage(getErrorMessage(error));
    }
    setSending(false);
  }

  // 4. Login con Magic Link (OTP)
  async function submitOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setMessage('');
    setIsError(false);

    const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).toString();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      setIsError(true);
      setMessage(getErrorMessage(error));
    } else {
      setIsError(false);
      setMessage('Revisá tu correo y abrí el enlace para entrar.');
    }
    setSending(false);
  }

  // 5. Registro con código de invitación (FASE 3)
  async function submitRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setMessage('');
    setIsError(false);

    const cleanEmail = email.trim();
    const cleanCode = inviteCode.trim().toUpperCase();

    if (!cleanCode) {
      setIsError(true);
      setMessage('Ingresá tu código de invitación para activar tu cuenta.');
      setSending(false);
      return;
    }

    if (password.length < 6) {
      setIsError(true);
      setMessage('La contraseña debe tener al menos 6 caracteres.');
      setSending(false);
      return;
    }

    if (password !== confirmPassword) {
      setIsError(true);
      setMessage('Las contraseñas no coinciden.');
      setSending(false);
      return;
    }

    // Comprobar validez del código antes de crear el usuario
    const isCodeValid = await checkCode(cleanCode);
    if (!isCodeValid) {
      setIsError(true);
      setMessage('El código de invitación ingresado no es válido o ya fue utilizado.');
      setSending(false);
      return;
    }

    // Crear usuario en Supabase Auth pasando el código de invitación para canje atómico
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          invitation_code: cleanCode,
        },
      },
    });

    if (authError || !authData.user) {
      setIsError(true);
      setMessage(authError ? getErrorMessage(authError) : 'No se pudo crear la cuenta.');
      setSending(false);
      return;
    }

    // Respaldo por si el trigger no procesó los metadatos
    try {
      await supabase.rpc('redeem_invitation_code', {
        p_code: cleanCode,
        p_user_id: authData.user.id,
      });
    } catch {
      // El trigger atómico ya procesó el canje
    }

    // Éxito: Si Supabase retornó sesión activa, entrará automáticamente
    if (authData.session) {
      setIsError(false);
      setMessage('¡Cuenta creada y código activado con éxito! Ingresando…');
    } else {
      // Si requiere confirmación de email
      setIsError(false);
      setMessage(
        '¡Cuenta creada y licencia activada! Te enviamos un correo de confirmación. Confirmalo y luego iniciá sesión.'
      );
      setMode('login');
      setPassword('');
      setConfirmPassword('');
    }

    setSending(false);
  }

  const whatsappRequestUrl = `https://wa.me/?text=${encodeURIComponent(
    '¡Hola! Quiero probar Pesito para gestionar mis finanzas personales. ¿Cómo puedo obtener un código de invitación?'
  )}`;

  return (
    <main className="auth-page">
      <section className="auth-card">
        <img className="login-icon" src={`${import.meta.env.BASE_URL}icon-192.png`} alt="Pesito" />
        <p className="eyebrow">PESITO</p>
        <h1>Tu dinero, más simple.</h1>
        <p>
          {mode === 'register'
            ? 'Activá tu cuenta con tu código de invitación exclusivo.'
            : useOtp
            ? 'Te enviaremos un enlace a tu correo para ingresar directamente.'
            : 'Ingresá con tu usuario y contraseña para acceder a tus finanzas.'}
        </p>

        {/* Pestañas Iniciar Sesión / Registrarse */}
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => {
              setMode('login');
              setMessage('');
              setIsError(false);
            }}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => {
              setMode('register');
              setMessage('');
              setIsError(false);
              if (inviteCode) void checkCode(inviteCode);
            }}
          >
            Crear cuenta
          </button>
        </div>

        {/* Modo 1: INICIAR SESIÓN */}
        {mode === 'login' && (
          <>
            {!useOtp ? (
              <form onSubmit={submitPassword}>
                <label>
                  Correo o usuario
                  <input
                    required
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="vos@correo.com"
                  />
                </label>
                <label>
                  Contraseña
                  <input
                    required
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Tu contraseña"
                  />
                </label>
                <button type="submit" disabled={sending}>
                  {sending ? 'Iniciando sesión…' : 'Iniciar sesión'}
                </button>
              </form>
            ) : (
              <form onSubmit={submitOtp}>
                <label>
                  Correo electrónico
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="vos@correo.com"
                  />
                </label>
                <button type="submit" disabled={sending}>
                  {sending ? 'Enviando enlace…' : 'Enviar enlace de acceso'}
                </button>
              </form>
            )}

            <div className="auth-footer-links">
              <button
                type="button"
                className="button-link auth-switch-link"
                onClick={() => {
                  setUseOtp(!useOtp);
                  setMessage('');
                  setIsError(false);
                }}
              >
                {useOtp ? '← Volver a ingresar con contraseña' : '¿Preferís recibir un enlace por correo?'}
              </button>
              <button
                type="button"
                className="button-link auth-switch-link"
                style={{ marginTop: '8px', color: 'var(--mint-dark)', fontWeight: 700 }}
                onClick={() => {
                  setMode('register');
                  setMessage('');
                  setIsError(false);
                }}
              >
                ¿Tenés un código de invitación? Creá tu cuenta acá →
              </button>
            </div>
          </>
        )}

        {/* Modo 2: REGISTRO CON CÓDIGO DE INVITACIÓN (FASE 3) */}
        {mode === 'register' && (
          <>
            <form onSubmit={submitRegister}>
              <label>
                Código de invitación
                <input
                  required
                  type="text"
                  className="invite-code-input"
                  placeholder="PESO-XXXX"
                  value={inviteCode}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  onBlur={() => {
                    if (inviteCode) void checkCode(inviteCode);
                  }}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck="false"
                />
              </label>

              {/* Feedback visual del código */}
              {codeState.checking && (
                <div className="code-feedback-badge checking">
                  <span>⏳</span>
                  <span>Verificando código…</span>
                </div>
              )}
              {!codeState.checking && codeState.valid === true && (
                <div className="code-feedback-badge valid">
                  <span>✅</span>
                  <span>{codeState.message}</span>
                </div>
              )}
              {!codeState.checking && codeState.valid === false && (
                <div className="code-feedback-badge invalid">
                  <span>❌</span>
                  <span>{codeState.message}</span>
                </div>
              )}

              <label style={{ marginTop: '4px' }}>
                Correo electrónico
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="vos@correo.com"
                />
              </label>

              <label>
                Contraseña
                <input
                  required
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Mínimo 6 caracteres"
                />
              </label>

              <label>
                Confirmar contraseña
                <input
                  required
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repetí tu contraseña"
                />
              </label>

              <button
                type="submit"
                disabled={sending || codeState.checking || codeState.valid === false}
                style={{ marginTop: '8px' }}
              >
                {sending ? 'Activando cuenta…' : 'Crear cuenta y comenzar'}
              </button>
            </form>

            {/* Ayuda para quienes no tienen código */}
            <div className="auth-no-code-box">
              <strong>¿No tenés un código de invitación?</strong>
              <p>Pesito funciona con acceso exclusivo o membresía privada.</p>
              <a
                href={whatsappRequestUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="whatsapp-request-btn"
              >
                <span>💬</span> Solicitar acceso por WhatsApp
              </a>
            </div>

            <div className="auth-footer-links" style={{ marginTop: '16px' }}>
              <button
                type="button"
                className="button-link auth-switch-link"
                onClick={() => {
                  setMode('login');
                  setMessage('');
                  setIsError(false);
                }}
              >
                ← ¿Ya tenés cuenta? Iniciar sesión
              </button>
            </div>
          </>
        )}

        {message && (
          <p
            className={`form-message ${isError ? 'form-message-error' : ''}`}
            style={
              !isError
                ? { background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }
                : undefined
            }
            role="status"
          >
            {message}
          </p>
        )}
      </section>
    </main>
  );
}
