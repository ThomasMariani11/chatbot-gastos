'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabase } from '../../lib/supabase/client';

export default function SettingsPage() {
  const [code, setCode] = useState<string>();
  const [enabled, setEnabled] = useState(true);
  const [paid, setPaid] = useState(false);
  const [status, setStatus] = useState('Cargando configuración…');
  const supabase = createBrowserSupabase();

  useEffect(() => {
    if (!supabase) return setStatus('Modo demostración: conectá Supabase para guardar cambios.');
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return setStatus('Iniciá sesión para administrar la conexión.');
      const { data: settings } = await supabase.from('app_settings').select('*').eq('user_id', data.user.id).single();
      if (settings) { setEnabled(settings.whatsapp_responses_enabled); setPaid(settings.paid_service_messages_authorized); }
      setStatus('Configuración sincronizada.');
    });
  }, []);

  async function update(nextEnabled: boolean, nextPaid: boolean) {
    if (!supabase) return;
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    await supabase.from('app_settings').update({ whatsapp_responses_enabled: nextEnabled, paid_service_messages_authorized: nextPaid, updated_at: new Date().toISOString() }).eq('user_id', data.user.id);
    setEnabled(nextEnabled); setPaid(nextPaid); setStatus('Cambios guardados.');
  }

  async function generateCode() {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const response = await fetch('/api/link-code', { method: 'POST', headers: { authorization: `Bearer ${data.session?.access_token}` } });
    const body = await response.json() as { code?: string; error?: string };
    if (body.code) setCode(body.code); else setStatus(body.error ?? 'No se pudo generar el código.');
  }

  return <main className="settings-page"><a className="back-link" href="/">← Volver al resumen</a><header><p className="eyebrow">CONFIGURACIÓN</p><h1>WhatsApp y costos</h1><p>Controlá la conexión y evitá cargos inesperados.</p></header><section className="settings-panel warning"><strong>Corte automático programado</strong><p>Las respuestas se bloquearán el 30 de septiembre de 2026 a las 23:50 si no autorizás mensajes pagos.</p></section><section className="settings-panel"><h2>Estado del bot</h2><label className="switch-row"><span><strong>Responder por WhatsApp</strong><small>Podés pausarlo en cualquier momento.</small></span><input type="checkbox" checked={enabled} onChange={(event) => update(event.target.checked, paid)} /></label><label className="switch-row"><span><strong>Autorizar mensajes pagos</strong><small>Solo se usa después del 1 de octubre.</small></span><input type="checkbox" checked={paid} onChange={(event) => update(enabled, event.target.checked)} /></label></section><section className="settings-panel"><h2>Vincular tu número</h2><p>Generá un código y enviá <b>VINCULAR código</b> al número del bot. Vence en 10 minutos.</p><button className="primary-button" onClick={generateCode}>Generar código</button>{code && <div className="link-code">VINCULAR {code}</div>}</section><p className="settings-status" role="status">{status}</p></main>;
}
