import { FormEvent, useState } from 'react';
import { supabase } from './supabase';

export function Login() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setMessage('');
    const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).toString();
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    setMessage(error ? error.message : 'Revisá tu correo y abrí el enlace en este mismo dispositivo.');
    setSending(false);
  }

  return <main className="auth-page"><section className="auth-card"><img className="login-icon" src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" /><p className="eyebrow">BIENVENIDO A PESITO</p><h1>Tu dinero, más simple.</h1><p>Ingresá con tu correo para ver tus movimientos y conectar WhatsApp.</p><form onSubmit={submit}><label>Correo electrónico<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="vos@correo.com" /></label><button type="submit" disabled={sending}>{sending ? 'Enviando…' : 'Enviar enlace de acceso'}</button></form>{message && <p className="form-message" role="status">{message}</p>}</section></main>;
}
