import { Icon } from './Icons';
import { useUpdateBlocker } from './PwaUpdates';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { registrationErrorMessage } from './registration';
import { ACCOUNT_DELETED_MESSAGE, clearAccountDeletedNotice, hasAccountDeletedNotice } from './accountDeletedNotice';
import { isStrongPassword, PASSWORD_RULE } from './passwordPolicy';

type AuthMode = 'login' | 'register';

interface CodeCheckState {
  checking: boolean;
  valid: boolean | null;
  message: string;
  durationDays?: number | null;
  code?: string;
}

export function Login() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const inviteCodeRef = useRef('');
  const [codeState, setCodeState] = useState<CodeCheckState>({
    checking: false,
    valid: null,
    message: '',
    code: '',
  });

  // 3.2: después de borrar la cuenta, el ingreso lo confirma una vez.
  const [message, setMessage] = useState(() => (hasAccountDeletedNotice() ? ACCOUNT_DELETED_MESSAGE : ''));
  const [isError, setIsError] = useState(false);
  const [sending, setSending] = useState(false);
  // Recuperación de contraseña con un código de un solo uso enviado por correo.
  const [recovery, setRecovery] = useState<null | 'request' | 'verify'>(null);
  const [recoveryCode, setRecoveryCode] = useState('');

  useUpdateBlocker(sending || Boolean(email || password || (mode === 'register' && (firstName || lastName || confirmPassword || inviteCode))), "Completá o limpiá el formulario de acceso antes de actualizar.");

  const registeringRef = useRef(false);
  const codeRequestRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loginTabRef = useRef<HTMLButtonElement | null>(null);
  const registerTabRef = useRef<HTMLButtonElement | null>(null);

  function selectAuthMode(nextMode: AuthMode, focusTarget = false) {
    setMode(nextMode);
    setMessage('');
    setIsError(false);
    if (nextMode === 'login') {
      ++codeRequestRef.current;
      abortControllerRef.current?.abort();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (focusTarget) loginTabRef.current?.focus();
    } else {
      if (inviteCode) void checkCode(inviteCode).catch(() => undefined);
      if (focusTarget) registerTabRef.current?.focus();
    }
  }

  useEffect(() => { clearAccountDeletedNotice(); }, []);

  useEffect(() => () => {
    ++codeRequestRef.current;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    abortControllerRef.current?.abort();
  }, []);

  // 1. Detectar si vino código por parámetro en la URL (?invitacion=PESO-… o ?code=PESO-…)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      // ?code= también lo usa Supabase para completar el ingreso o la confirmación del correo (PKCE):
      // solo se toma como invitación si tiene forma de código de invitación.
      const legacyCode = params.get('code');
      const codeFromUrl = params.get('invitacion') || params.get('invite')
        || (legacyCode && /^PESO-/i.test(legacyCode.trim()) ? legacyCode : null);
      if (codeFromUrl) {
        const clean = codeFromUrl.trim().toUpperCase();
        inviteCodeRef.current = clean;
        setMode('register');
        setInviteCode(clean);
        void checkCode(clean).catch(() => undefined);
      }
    } catch {
      // ignore
    }
  }, []);

  // 2. Función de verificación de código de invitación vía RPC
  async function checkCode(codeToValidate: string) {
    const clean = codeToValidate.trim().toUpperCase();
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (!clean) {
      ++codeRequestRef.current;
      abortControllerRef.current?.abort();
      setCodeState({ checking: false, valid: null, message: '', code: '' });
      return false;
    }

    if (clean.length < 4) {
      ++codeRequestRef.current;
      abortControllerRef.current?.abort();
      setCodeState({ checking: false, valid: null, message: '', code: clean });
      return false;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const request = ++codeRequestRef.current;
    const isCurrent = () => request === codeRequestRef.current && clean === inviteCodeRef.current;

    if (isCurrent()) {
      setCodeState({ checking: true, valid: null, message: 'Verificando código…', code: clean });
    }

    try {
      let rpcBuilder = supabase.rpc('check_invitation_code', { p_code: clean });
      if (rpcBuilder && typeof (rpcBuilder as unknown as { abortSignal?: (s: AbortSignal) => unknown }).abortSignal === 'function') {
        rpcBuilder = (rpcBuilder as unknown as { abortSignal: (s: AbortSignal) => typeof rpcBuilder }).abortSignal(controller.signal);
      }
      const { data, error } = await rpcBuilder;
      if (controller.signal.aborted || !isCurrent()) return false;
      if (error || !data) throw new Error('CODE_CHECK_UNAVAILABLE');
      if (data.valid) {
        const durationText = data.duration_days ? `Licencia de ${data.duration_days} días` : 'Licencia vitalicia (sin vencimiento)';
        if (isCurrent()) {
          setCodeState({ checking: false, valid: true, message: `Código válido: ${durationText}`, durationDays: data.duration_days, code: clean });
        }
        return true;
      }
      if (isCurrent()) {
        setCodeState({ checking: false, valid: false, message: (typeof data.error === 'string' && data.error) ? data.error : 'Código inválido o ya utilizado.', code: clean });
      }
      return false;
    } catch {
      if (controller.signal.aborted || !isCurrent()) return false;
      if (isCurrent()) {
        setCodeState({ checking: false, valid: null, message: 'No pudimos verificar el código. Comprobá tu conexión e intentá de nuevo.', code: clean });
      }
      throw new Error('CODE_CHECK_UNAVAILABLE');
    }
  }

  // Manejar cambio en el input de código con debounce
  function handleCodeChange(val: string) {
    const clean = val.toUpperCase().replace(/\s+/g, '');
    inviteCodeRef.current = clean;
    setInviteCode(clean);
    setMessage('');
    setIsError(false);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    abortControllerRef.current?.abort();
    ++codeRequestRef.current;

    setCodeState({ checking: false, valid: null, message: '', code: clean });

    if (clean.length >= 4) {
      debounceTimerRef.current = setTimeout(() => {
        void checkCode(clean).catch(() => undefined);
      }, 400);
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
      return PASSWORD_RULE;
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

  // 4. Recuperar la contraseña: código de un solo uso por correo, después contraseña nueva.
  async function requestRecoveryCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setMessage('');
    setIsError(false);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    setSending(false);
    if (error) {
      setIsError(true);
      setMessage(getErrorMessage(error));
      return;
    }
    setRecovery('verify');
    setRecoveryCode('');
    setPassword('');
    setConfirmPassword('');
    setMessage('Si el correo está registrado, te enviamos un código. Escribilo acá junto con tu contraseña nueva.');
  }

  async function resetPasswordWithCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = recoveryCode.replace(/\s+/g, '');
    const validation = !/^\d{6,10}$/.test(token) ? 'Escribí el código que te enviamos por correo.'
      : !isStrongPassword(password) ? PASSWORD_RULE
      : password !== confirmPassword ? 'Las contraseñas no coinciden.' : '';
    if (validation) { setIsError(true); setMessage(validation); return; }
    setSending(true);
    setMessage('');
    setIsError(false);
    try {
      const verified = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'recovery' });
      if (verified.error) {
        setIsError(true);
        setMessage('El código no es válido o ya venció. Pedí uno nuevo.');
        return;
      }
      const updated = await supabase.auth.updateUser({ password });
      if (updated.error) {
        setIsError(true);
        setMessage(updated.error.message.toLowerCase().includes('password') ? PASSWORD_RULE : getErrorMessage(updated.error));
        return;
      }
      setIsError(false);
      setMessage('Listo, tu contraseña quedó cambiada.');
    } finally {
      setSending(false);
    }
  }

  function toggleRecovery(next: null | 'request') {
    setRecovery(next);
    setRecoveryCode('');
    setMessage('');
    setIsError(false);
  }

  async function submitRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (registeringRef.current) return;
    registeringRef.current = true;
    setSending(true);
    setMessage('');
    setIsError(false);
    const cleanFirstName = firstName.trim(), cleanLastName = lastName.trim();
    const cleanEmail = email.trim(), cleanCode = inviteCode.trim().toUpperCase();
    let submitted = false;
    try {
      const validation = !cleanFirstName ? 'Por favor, ingresá tu nombre.'
        : !cleanLastName ? 'Por favor, ingresá tu apellido.'
        : !cleanCode ? 'Ingresá tu código de invitación para activar tu cuenta.'
        : !isStrongPassword(password) ? PASSWORD_RULE
        : password !== confirmPassword ? 'Las contraseñas no coinciden.' : '';
      if (validation) { setIsError(true); setMessage(validation); return; }
      // Preflight orientativo. La validez se vuelve a comprobar bajo bloqueo en Auth.
      if (!await checkCode(cleanCode)) {
        setIsError(true);
        setMessage('El código no está disponible. Si ya intentaste crear esta cuenta, probá iniciar sesión o confirmar tu correo antes de usar otro código.');
        return;
      }
      submitted = true;
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail, password,
        options: { data: { first_name: cleanFirstName, last_name: cleanLastName,
          full_name: `${cleanFirstName} ${cleanLastName}`, invitation_code: cleanCode } },
      });
      if (error) { setIsError(true); setMessage(registrationErrorMessage(error, true)); return; }
      if (!data.user) throw new Error('SIGNUP_RESPONSE_MISSING');
      // Auth puede ocultar cuentas ya existentes con identities vacías. No anunciar un alta.
      if (!data.session && data.user.identities?.length === 0) {
        setIsError(true);
        setMessage('Si ya tenés una cuenta con este correo, iniciá sesión o confirmá el correo que recibiste. No uses otro código para repetir el alta.');
        return;
      }
      if (data.session) {
        setMessage('¡Cuenta creada! Ingresando…');
      } else {
        // Sin sesión no se promete licencia ni entrega del email: Auth puede ocultar duplicados.
        setMessage('Revisá tu correo para confirmar la cuenta y luego iniciá sesión. Si ya estabas registrado, ingresá con tus datos.');
        setMode('login');
        setPassword(''); setConfirmPassword('');
      }
    } catch (error) {
      setIsError(true);
      setMessage(registrationErrorMessage(error, submitted));
    } finally {
      registeringRef.current = false;
      setSending(false);
    }
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
            : recovery === 'request'
            ? 'Escribí tu correo y te enviamos un código para elegir una contraseña nueva.'
            : recovery === 'verify'
            ? 'Escribí el código que te enviamos y tu contraseña nueva.'
            : 'Ingresá con tu usuario y contraseña para acceder a tus finanzas.'}
        </p>

        {/* Pestañas Iniciar Sesión / Registrarse */}
        <div
          className="auth-tabs"
          role="tablist"
          aria-label="Modo de acceso"
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              selectAuthMode(mode === 'login' ? 'register' : 'login', true);
            } else if (e.key === 'Home') {
              e.preventDefault();
              selectAuthMode('login', true);
            } else if (e.key === 'End') {
              e.preventDefault();
              selectAuthMode('register', true);
            }
          }}
        >
          <button
            ref={loginTabRef}
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectAuthMode('login')}
          >
            Iniciar sesión
          </button>
          <button
            ref={registerTabRef}
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectAuthMode('register')}
          >
            Crear cuenta
          </button>
        </div>

        {/* Modo 1: INICIAR SESIÓN */}
        {mode === 'login' && (
          <>
            {recovery === null && (
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
            )}
            {recovery === 'request' && (
              <form onSubmit={requestRecoveryCode}>
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
                  {sending ? 'Enviando código…' : 'Enviar código'}
                </button>
              </form>
            )}
            {recovery === 'verify' && (
              <form onSubmit={resetPasswordWithCode}>
                <label>
                  Código que te enviamos
                  <input
                    required
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={14}
                    value={recoveryCode}
                    onChange={(event) => setRecoveryCode(event.target.value)}
                    placeholder="123456"
                  />
                </label>
                <label>
                  Contraseña nueva
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="8+ con mayúscula, minúscula y número"
                  />
                </label>
                <label>
                  Confirmar contraseña nueva
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Repetí la contraseña"
                  />
                </label>
                <button type="submit" disabled={sending}>
                  {sending ? 'Guardando…' : 'Guardar contraseña nueva'}
                </button>
              </form>
            )}

            <div className="auth-footer-links">
              <button
                type="button"
                className="button-link auth-switch-link"
                onClick={() => toggleRecovery(recovery ? null : 'request')}
              >
                {recovery ? '← Volver a iniciar sesión' : '¿Olvidaste tu contraseña?'}
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
                  placeholder="PESO-XXXX-XXXX-XXXX"
                  value={inviteCode}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  onBlur={() => {
                    if (inviteCode && inviteCode.length >= 4 && (codeState.code !== inviteCode || codeState.valid === null)) {
                      void checkCode(inviteCode).catch(() => undefined);
                    }
                  }}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck="false"
                />
              </label>

              {/* Feedback visual del código */}
              {codeState.checking && codeState.code === inviteCode && (
                <div className="code-feedback-badge checking">
                  <span><Icon name="clock" /></span>
                  <span>Verificando código…</span>
                </div>
              )}
              {!codeState.checking && codeState.valid === true && codeState.code === inviteCode && (
                <div className="code-feedback-badge valid">
                  <span><Icon name="check" /></span>
                  <span>{codeState.message}</span>
                </div>
              )}
              {!codeState.checking && codeState.valid !== true && Boolean(codeState.message) && codeState.code === inviteCode && (
                <div className="code-feedback-badge invalid">
                  <span><Icon name="alert" /></span>
                  <span>{codeState.message}</span>
                </div>
              )}

              <div className="form-row-2" style={{ marginTop: '6px' }}>
                <label>
                  Nombre
                  <input
                    required
                    type="text"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder="Ej. María"
                  />
                </label>
                <label>
                  Apellido
                  <input
                    required
                    type="text"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder="Ej. González"
                  />
                </label>
              </div>

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
                  placeholder="8+ con mayúscula, minúscula y número"
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
                disabled={sending || (codeState.checking && codeState.code === inviteCode) || (codeState.valid === false && codeState.code === inviteCode)}
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
                <span><Icon name="message" /></span> Solicitar acceso por WhatsApp
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
                  abortControllerRef.current?.abort();
                  if (debounceTimerRef.current) {
                    clearTimeout(debounceTimerRef.current);
                    debounceTimerRef.current = null;
                  }
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
