import { useEffect, useState } from 'react';
import { supabase } from './supabase';

type Props = { userId: string; onBack: () => void; onSignOut?: () => void };

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function Settings({ userId, onBack, onSignOut }: Props) {
  const [code, setCode] = useState<string>();
  const [enabled, setEnabled] = useState(true);
  const [paid, setPaid] = useState(false);
  const [status, setStatus] = useState('Cargando configuración…');

  useEffect(() => {
    supabase.from('app_settings').select('*').eq('user_id', userId).single().then(({ data, error }) => {
      if (error) return setStatus('No pudimos cargar la configuración.');
      setEnabled(data.whatsapp_responses_enabled);
      setPaid(data.paid_service_messages_authorized);
      setStatus('Configuración sincronizada.');
    });
  }, [userId]);

  async function update(nextEnabled: boolean, nextPaid: boolean) {
    const { error } = await supabase.from('app_settings').update({ whatsapp_responses_enabled: nextEnabled, paid_service_messages_authorized: nextPaid, updated_at: new Date().toISOString() }).eq('user_id', userId);
    if (error) return setStatus('No pudimos guardar los cambios.');
    setEnabled(nextEnabled);
    setPaid(nextPaid);
    setStatus('Cambios guardados.');
  }

  async function generateCode() {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    const nextCode = String(100000 + (values[0] % 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error } = await supabase.from('whatsapp_links').upsert({ user_id: userId, link_code_hash: await sha256(nextCode), link_code_expires_at: expires, status: 'pending' }, { onConflict: 'user_id' });
    if (error) return setStatus('No se pudo generar el código.');
    setCode(nextCode);
    setStatus('Código generado. Enviá el mensaje desde tu WhatsApp.');
  }

  return (
    <main className="settings-page">
      <button className="back-link button-link" type="button" onClick={onBack}>← Volver al resumen</button>
      <header>
        <p className="eyebrow">CONFIGURACIÓN</p>
        <h1>WhatsApp y costos</h1>
        <p>Controlá la conexión y evitá cargos inesperados.</p>
      </header>
      <section className="settings-panel warning">
        <strong>Corte automático programado</strong>
        <p>Las respuestas se bloquearán el 30 de septiembre de 2026 a las 23:50 si no autorizás mensajes pagos.</p>
      </section>
      <section className="settings-panel">
        <h2>Estado del bot</h2>
        <label className="switch-row">
          <span><strong>Responder por WhatsApp</strong><small>Podés pausarlo en cualquier momento.</small></span>
          <input type="checkbox" checked={enabled} onChange={(event) => void update(event.target.checked, paid)} />
        </label>
        <label className="switch-row">
          <span><strong>Autorizar mensajes pagos</strong><small>Solo se usa después del 1 de octubre.</small></span>
          <input type="checkbox" checked={paid} onChange={(event) => void update(enabled, event.target.checked)} />
        </label>
      </section>
      <section className="settings-panel">
        <h2>Vincular tu número</h2>
        <p>Generá un código y enviá <b>VINCULAR código</b> al número del bot. Vence en 10 minutos.</p>
        <button className="primary-button" onClick={() => void generateCode()}>Generar código</button>
        {code && <div className="link-code">VINCULAR {code}</div>}
      </section>
      {onSignOut && (
        <section className="settings-panel">
          <h2>Sesión</h2>
          <p>Tu sesión permanece activa en este dispositivo hasta que decidas salir.</p>
          <button className="danger-button" type="button" onClick={onSignOut}>
            Cerrar sesión
          </button>
        </section>
      )}
      <p className="settings-status" role="status">{status}</p>
    </main>
  );
}
