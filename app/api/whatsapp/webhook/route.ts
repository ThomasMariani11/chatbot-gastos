import { NextRequest, NextResponse } from 'next/server';
import { addMonths, serviceMessagesAllowed, splitInstallments } from '../../../../lib/finance';
import { extractFinancialProposal } from '../../../../lib/server/gemini';
import { createServiceSupabase } from '../../../../lib/server/supabase';
import { downloadWhatsAppMedia, sendWhatsAppText } from '../../../../lib/server/whatsapp';

type IncomingMessage = {
  id: string;
  from: string;
  type: 'text' | 'image' | 'audio' | string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
};

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const token = request.nextUrl.searchParams.get('hub.verify_token');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ error: 'Verificación rechazada.' }, { status: 403 });
}

async function validSignature(raw: string, signature: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signature?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const expected = `sha256=${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}

function readMessage(payload: unknown): IncomingMessage | null {
  const data = payload as { entry?: Array<{ changes?: Array<{ value?: { messages?: IncomingMessage[] } }> }> };
  return data.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ?? null;
}

function formatProposal(proposal: Awaited<ReturnType<typeof extractFinancialProposal>>) {
  const amount = proposal.totalAmountArs == null ? 'Falta indicar' : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(proposal.totalAmountArs);
  const type = proposal.kind === 'expense' ? 'Gasto' : 'Ingreso';
  const installments = proposal.installments > 1 ? `\nCuotas: ${proposal.installments} desde ${proposal.firstInstallmentMonth}` : '';
  return `¿Confirmás esta operación?\n\n${type}: ${proposal.description}\nMonto: ${amount}\nCategoría: ${proposal.category ?? 'Falta indicar'}\nFecha: ${proposal.occurredOn ?? 'Falta indicar'}${installments}\n\nRespondé CONFIRMAR, CANCELAR o escribí la corrección.`;
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!(await validSignature(raw, request.headers.get('x-hub-signature-256')))) return NextResponse.json({ error: 'Firma inválida.' }, { status: 401 });
  const message = readMessage(JSON.parse(raw));
  if (!message) return NextResponse.json({ received: true });

  const supabase = createServiceSupabase();
  const { data: inserted } = await supabase.from('inbound_events').upsert({ wa_message_id: message.id, wa_id: message.from, status: 'processing' }, { onConflict: 'wa_message_id', ignoreDuplicates: true }).select('id').maybeSingle();
  if (!inserted) return NextResponse.json({ received: true, duplicate: true });

  try {
    let { data: link } = await supabase.from('whatsapp_links').select('user_id').eq('wa_id', message.from).eq('status', 'active').maybeSingle();
    const initialText = message.text?.body?.trim() ?? '';
    const linkMatch = initialText.match(/^vincular\s+(\d{6})$/i);
    if (!link && linkMatch) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(linkMatch[1]));
      const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const { data: candidate } = await supabase.from('whatsapp_links').select('user_id').eq('link_code_hash', hash).gt('link_code_expires_at', new Date().toISOString()).maybeSingle();
      if (candidate) {
        await supabase.from('whatsapp_links').update({ wa_id: message.from, status: 'active', linked_at: new Date().toISOString(), link_code_hash: null, link_code_expires_at: null }).eq('user_id', candidate.user_id);
        link = candidate;
        await sendWhatsAppText(message.from, '¡Listo! Tu WhatsApp quedó vinculado con Pesito ✅');
        await supabase.from('inbound_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
        return NextResponse.json({ received: true, linked: true });
      }
    }
    if (!link) throw new Error('Número no vinculado.');
    const { data: settings } = await supabase.from('app_settings').select('whatsapp_responses_enabled,paid_service_messages_authorized').eq('user_id', link.user_id).maybeSingle();
    const enabled = settings?.whatsapp_responses_enabled ?? true;
    const paidAuthorized = settings?.paid_service_messages_authorized ?? false;
    if (!enabled || !serviceMessagesAllowed(new Date(), paidAuthorized)) {
      await supabase.from('inbound_events').update({ status: 'blocked_cost_guard', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
      return NextResponse.json({ received: true, blocked: true });
    }

    const text = message.text?.body?.trim() ?? message.image?.caption?.trim() ?? '';
    if (/^(confirmar|si|sí)$/i.test(text)) {
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
    } else if (/^cancelar$/i.test(text)) {
      await supabase.from('transactions').update({ status: 'cancelled' }).eq('user_id', link.user_id).eq('status', 'pending');
      await sendWhatsAppText(message.from, 'Operación cancelada.');
    } else {
      let media: { base64: string; mimeType: string } | undefined;
      const mediaId = message.image?.id ?? message.audio?.id;
      if (mediaId) media = await downloadWhatsAppMedia(mediaId);
      if (!text && !media) throw new Error('Tipo de mensaje no compatible.');
      const proposal = await extractFinancialProposal({ text, mediaBase64: media?.base64, mimeType: media?.mimeType });
      const { data: category } = await supabase.from('categories').select('id').eq('user_id', link.user_id).eq('kind', proposal.kind).ilike('name', proposal.category ?? 'Otros').maybeSingle();
      await supabase.from('transactions').insert({ user_id: link.user_id, kind: proposal.kind, description: proposal.description, amount_ars: proposal.totalAmountArs, occurred_on: proposal.occurredOn, category_id: category?.id ?? null, status: 'pending', source: message.type, confidence: proposal.confidence, installment_count: proposal.installments, first_installment_month: proposal.firstInstallmentMonth ?? proposal.occurredOn?.slice(0, 7), wa_message_id: message.id });
      await sendWhatsAppText(message.from, formatProposal(proposal));
    }
    await supabase.from('inbound_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
  } catch (error) {
    await supabase.from('inbound_events').update({ status: 'failed', error_code: error instanceof Error ? error.message.slice(0, 160) : 'unknown', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
  }
  return NextResponse.json({ received: true });
}
