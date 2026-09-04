import { createClient } from 'npm:@supabase/supabase-js@2.114.0';

type IncomingMessage = {
  id: string;
  from: string;
  type: 'text' | 'image' | 'audio' | string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
};

type FinancialProposal = {
  kind: 'expense' | 'income';
  description: string;
  totalAmountArs: number | null;
  occurredOn: string | null;
  category: string | null;
  installments: number;
  firstInstallmentMonth: string | null;
  confidence: number;
  missingFields: string[];
};

const graphVersion = Deno.env.get('WHATSAPP_GRAPH_API_VERSION') || 'v26.0';
const graphBase = `https://graph.facebook.com/${graphVersion}`;
const encoder = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function readMessage(payload: unknown): IncomingMessage | null {
  const data = payload as { entry?: Array<{ changes?: Array<{ value?: { messages?: IncomingMessage[] } }> }> };
  return data.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ?? null;
}

async function validSignature(raw: string, signature: string | null) {
  const secret = Deno.env.get('META_APP_SECRET');
  if (!secret || !signature?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(raw));
  const expected = `sha256=${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sendWhatsAppText(to: string, body: string) {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  if (!token || !phoneNumberId) throw new Error('WhatsApp no está configurado.');
  const send = (recipient: string) => fetch(`${graphBase}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'text', text: { preview_url: false, body } }),
  });
  let response = await send(to);
  if (!response.ok && to.startsWith('549')) {
    const failure = await response.clone().json().catch(() => null) as { error?: { code?: number } } | null;
    if (failure?.error?.code === 131030) response = await send(to.replace(/^549/, '54'));
  }
  if (!response.ok) throw new Error(`WhatsApp respondió ${response.status}.`);
}

async function downloadWhatsAppMedia(mediaId: string) {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  if (!token) throw new Error('WhatsApp no está configurado.');
  const metadata = await fetch(`${graphBase}/${mediaId}`, { headers: { authorization: `Bearer ${token}` } });
  if (!metadata.ok) throw new Error('No se pudo obtener el archivo de WhatsApp.');
  const { url, mime_type: mimeType } = await metadata.json() as { url: string; mime_type: string };
  const file = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!file.ok) throw new Error('No se pudo descargar el archivo de WhatsApp.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { base64: btoa(binary), mimeType };
}

const responseJsonSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['expense', 'income'] },
    description: { type: 'string' },
    totalAmountArs: { type: ['number', 'null'] },
    occurredOn: { type: ['string', 'null'] },
    category: { type: ['string', 'null'] },
    installments: { type: 'integer', minimum: 1, maximum: 60 },
    firstInstallmentMonth: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    missingFields: { type: 'array', items: { type: 'string', enum: ['amount', 'date', 'category'] } },
  },
  required: ['kind', 'description', 'totalAmountArs', 'occurredOn', 'category', 'installments', 'firstInstallmentMonth', 'confidence', 'missingFields'],
};

async function extractFinancialProposal(input: { text?: string; mediaBase64?: string; mimeType?: string }): Promise<FinancialProposal> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('Gemini no está configurado.');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const prompt = `Fecha local: ${today}. Extraé una sola operación financiera argentina. Interpretá “lucas” y “k” como miles de ARS. Si la fecha no está expresada, usá la fecha local. Categorías de gasto: Alimentación, Transporte, Vivienda, Servicios, Salud, Educación, Ocio, Compras, Impuestos, Deudas, Otros. Categorías de ingreso: Sueldo, Freelance, Ventas, Rendimientos, Otros. Si es una compra en cuotas y el usuario menciona que ya pagó N cuotas (ej. "en 6 cuotas y ya pagué 2"), calculá firstInstallmentMonth restando N meses a la fecha actual para que la primera cuota comience en el mes histórico correspondiente. Si el mensaje o audio no contiene una operación financiera clara, o es solo ruido de fondo, murmullo o incomprensible, devolvé totalAmountArs null y confidence 0. ${input.text ?? ''}`;

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (input.mediaBase64 && input.mimeType) parts.push({ inlineData: { mimeType: input.mimeType, data: input.mediaBase64 } });
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema, temperature: 0.1 } }),
  });
  if (!response.ok) throw new Error(`Gemini respondió ${response.status}.`);
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Gemini no devolvió una propuesta.');
  return JSON.parse(raw) as FinancialProposal;
}

function splitInstallments(total: number, count: number) {
  const totalCents = Math.round(total * 100);
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => (base + (index === count - 1 ? remainder : 0)) / 100);
}

function addMonths(month: string, offset: number) {
  const [year, rawMonth] = month.split('-').map(Number);
  const date = new Date(year, rawMonth - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const DEFAULT_COST_GUARD_DATE = '2026-09-30T23:50:00-03:00';

function serviceMessagesAllowed(costGuardDate: string | null | undefined, override: boolean) {
  if (override) return true;
  const configuredDate = new Date(costGuardDate ?? DEFAULT_COST_GUARD_DATE);
  const cutoff = Number.isNaN(configuredDate.getTime())
    ? new Date(DEFAULT_COST_GUARD_DATE)
    : configuredDate;
  return new Date() < cutoff;
}

function formatProposal(proposal: FinancialProposal) {
  const amount = proposal.totalAmountArs == null ? 'Falta indicar' : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(proposal.totalAmountArs);
  const type = proposal.kind === 'expense' ? 'Gasto' : 'Ingreso';
  const installments = proposal.installments > 1 ? `\nCuotas: ${proposal.installments} desde ${proposal.firstInstallmentMonth}` : '';
  return `¿Confirmás esta operación?\n\n${type}: ${proposal.description}\nMonto: ${amount}\nCategoría: ${proposal.category ?? 'Falta indicar'}\nFecha: ${proposal.occurredOn ?? 'Falta indicar'}${installments}\n\nRespondé CONFIRMAR, CANCELAR o escribí la corrección.`;
}

Deno.serve(async (request) => {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const valid = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === Deno.env.get('WHATSAPP_VERIFY_TOKEN');
    return valid ? new Response(url.searchParams.get('hub.challenge') ?? '') : json({ error: 'Verificación rechazada.' }, 403);
  }
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const raw = await request.text();
  if (!(await validSignature(raw, request.headers.get('x-hub-signature-256')))) return json({ error: 'Firma inválida.' }, 401);
  const message = readMessage(JSON.parse(raw));
  if (!message) return json({ received: true });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase no está configurado.' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: inserted } = await supabase.from('inbound_events').upsert({ wa_message_id: message.id, wa_id: message.from, status: 'processing' }, { onConflict: 'wa_message_id', ignoreDuplicates: true }).select('id').maybeSingle();
  if (!inserted) return json({ received: true, duplicate: true });

  try {
    let { data: link } = await supabase.from('whatsapp_links').select('user_id').eq('wa_id', message.from).eq('status', 'active').maybeSingle();
    const initialText = message.text?.body?.trim() ?? '';
    const linkMatch = initialText.match(/^vincular\s+(\d{6})$/i);
    if (!link && linkMatch) {
      const { data: candidate } = await supabase.from('whatsapp_links').select('user_id').eq('link_code_hash', await sha256(linkMatch[1])).gt('link_code_expires_at', new Date().toISOString()).maybeSingle();
      if (candidate) {
        await supabase.from('whatsapp_links').update({ wa_id: message.from, status: 'active', linked_at: new Date().toISOString(), link_code_hash: null, link_code_expires_at: null }).eq('user_id', candidate.user_id);
        link = candidate;
        await sendWhatsAppText(message.from, '¡Listo! Tu WhatsApp quedó vinculado con Pesito ✅');
        await supabase.from('inbound_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
        return json({ received: true, linked: true });
      }
    }
    if (!link) throw new Error('Número no vinculado.');
    const { data: settings } = await supabase.from('app_settings').select('whatsapp_responses_enabled,paid_service_messages_authorized,cost_guard_date').eq('user_id', link.user_id).maybeSingle();
    if (!(settings?.whatsapp_responses_enabled ?? true)) {
      await supabase.from('inbound_events').update({ status: 'blocked_paused', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
      return json({ received: true, blocked: true });
    }
    if (!serviceMessagesAllowed(settings?.cost_guard_date, settings?.paid_service_messages_authorized ?? false)) {
      await supabase.from('inbound_events').update({ status: 'blocked_cost_guard', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
      await sendWhatsAppText(message.from, 'Pesito: Se activó el corte de seguridad programado para evitar costos extras. Si querés seguir usándolo, podés autorizar los mensajes desde la app en Configuración.');
      return json({ received: true, blocked: true });
    }

    const text = message.text?.body?.trim() ?? message.image?.caption?.trim() ?? '';
    const isConfirm = /^(confirmar|confirmado|confirmo|si|sí|ok|dale|listo|de una|va|sisi|perfecto|👍)$/i.test(text);
    const isCancel = /^(cancelar|cancelalo|cancela|cancel|no|borralo|borrar|borra|anular|rechazar)$/i.test(text);

    if (isConfirm) {
      const { data: pending } = await supabase.from('transactions').select('*').eq('user_id', link.user_id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!pending) await sendWhatsAppText(message.from, 'No tenés ninguna operación pendiente.');
      else if ((pending.installment_count ?? 1) > 1) {
        const values = splitInstallments(Number(pending.amount_ars), pending.installment_count);
        const rows = values.map((amount, index) => ({ user_id: link.user_id, kind: pending.kind, description: pending.description, amount_ars: amount, occurred_on: `${addMonths(pending.first_installment_month, index)}-01`, category_id: pending.category_id, status: 'confirmed', source: pending.source, installment_group_id: pending.id, installment_number: index + 1, installment_count: values.length }));
        await supabase.from('transactions').insert(rows);
        await supabase.from('transactions').update({ status: 'cancelled' }).eq('id', pending.id);
        await sendWhatsAppText(message.from, `Listo: registré ${values.length} cuotas de ${new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(values[0])}.`);
      } else {
        await supabase.from('transactions').update({ status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('id', pending.id);
        await sendWhatsAppText(message.from, 'Listo, quedó registrado ✅');
      }
    } else if (isCancel) {
      await supabase.from('transactions').update({ status: 'cancelled' }).eq('user_id', link.user_id).eq('status', 'pending');
      await sendWhatsAppText(message.from, 'Operación cancelada.');
    } else {
      let media: { base64: string; mimeType: string } | undefined;
      const mediaId = message.image?.id ?? message.audio?.id;
      if (mediaId) media = await downloadWhatsAppMedia(mediaId);
      if (!text && !media) throw new Error('Tipo de mensaje no compatible.');
      const proposal = await extractFinancialProposal({ text, mediaBase64: media?.base64, mimeType: media?.mimeType });
      if (!proposal.totalAmountArs || (proposal.confidence ?? 0) < 0.5) {
        throw new Error('No se pudo identificar un monto o gasto válido en el mensaje/audio.');
      }
      const { data: category } = await supabase.from('categories').select('id').eq('user_id', link.user_id).eq('kind', proposal.kind).ilike('name', proposal.category ?? 'Otros').maybeSingle();
      // Cancelar cualquier propuesta previa que haya quedado pendiente
      await supabase.from('transactions').update({ status: 'cancelled' }).eq('user_id', link.user_id).eq('status', 'pending');
      await supabase.from('transactions').insert({ user_id: link.user_id, kind: proposal.kind, description: proposal.description, amount_ars: proposal.totalAmountArs, occurred_on: proposal.occurredOn, category_id: category?.id ?? null, status: 'pending', source: message.type, confidence: proposal.confidence, installment_count: proposal.installments, first_installment_month: proposal.firstInstallmentMonth ?? proposal.occurredOn?.slice(0, 7), wa_message_id: message.id });
      await sendWhatsAppText(message.from, formatProposal(proposal));
    }
    await supabase.from('inbound_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'unknown';
    await supabase.from('inbound_events').update({ status: 'failed', error_code: errorMsg.slice(0, 160), processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
    if (message?.from) {
      try {
        const userNotice = errorMsg.includes('Número no vinculado')
          ? 'Tu número no está vinculado a Pesito. Podés vincularlo generando un código desde la app.'
          : 'No pude interpretar el mensaje o comprobante 😕. Probá escribiendo el gasto (ej: "Gasté 15000 en súper") o reenviando el audio.';
        await sendWhatsAppText(message.from, userNotice);
      } catch {
        // Ignorar silenciosamente errores secundarios al enviar aviso por WhatsApp
      }
    }
  }

  return json({ received: true });
});
