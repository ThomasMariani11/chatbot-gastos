import { FormEvent, useState } from 'react';
import { supabase } from './supabase';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [sending, setSending] = useState(false);
  const [useOtp, setUseOtp] = useState(false);

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
      return 'No se pudo conectar con el servidor. Es probable que el proyecto de Supabase esté pausado por inactividad (podés reactivarlo desde supabase.com/dashboard) o que haya un problema de conexión.';
    }
    if (lower.includes('email not confirmed')) {
      return 'El correo electrónico todavía no fue confirmado.';
    }
    return raw;
  }

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

  return (
    <main className="auth-page">
      <section className="auth-card">
        <img className="login-icon" src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" />
        <p className="eyebrow">BIENVENIDO A PESITO</p>
        <h1>Tu dinero, más simple.</h1>
        <p>
          {useOtp
            ? 'Te enviaremos un enlace a tu correo para ingresar directamente.'
            : 'Ingresá con tu usuario y contraseña para acceder a tus finanzas.'}
        </p>

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
        </div>

        {message && (
          <p className={`form-message ${isError ? 'form-message-error' : ''}`} role="status">
            {message}
          </p>
        )}
      </section>
    </main>
  );
}
