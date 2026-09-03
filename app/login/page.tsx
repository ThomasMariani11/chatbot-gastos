'use client';

import { FormEvent, useState } from 'react';
import { createBrowserSupabase } from '../../lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    const supabase = createBrowserSupabase();
    if (!supabase) return setMessage('Configurá Supabase para activar el acceso por correo.');
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/` } });
    setMessage(error ? error.message : 'Revisá tu correo: te enviamos el enlace de acceso.');
  }
  return <main className="auth-page"><section className="auth-card"><span className="brand-mark">P</span><p className="eyebrow">BIENVENIDO A PESITO</p><h1>Tu dinero, más simple.</h1><p>Ingresá con tu correo para ver tus movimientos y conectar WhatsApp.</p><form onSubmit={submit}><label>Correo electrónico<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="vos@correo.com" /></label><button type="submit">Enviar enlace de acceso</button></form>{message && <p className="form-message" role="status">{message}</p>}<a href="/">Volver a la demostración</a></section></main>;
}
