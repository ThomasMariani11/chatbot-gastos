import { createClient } from 'npm:@supabase/supabase-js@2.114.0';

type IncomingMessage = {
  id: string;
  from: string;
  type: 'text' | 'image' | 'audio' | string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
};

type ExtractedMovement = {
  kind: 'expense' | 'income';
  description: string;
  totalAmountArs: number | null;
  currency: 'ARS' | 'USD';
  occurredOn: string | null;
  category: string | null;
  installments: number;
  firstInstallmentMonth: string | null;
  confidence: number;
  missingFields: string[];
};

type GeminiParsedOutput = {
  intent: 'add_movements' | 'edit_item' | 'remove_item' | 'confirm' | 'cancel' | 'summary' | 'unknown';
  movements: ExtractedMovement[];
  edit?: {
    targetPosition?: number | null;
    amount?: number | null;
    description?: string | null;
    category?: string | null;
  } | null;
  removePosition?: number | null;
  clarification?: string | null;
};

type DraftListItem = {
  id?: string;
  position: number;
  kind: 'expense' | 'income';
  description: string;
  amount: number;
  currency: string;
  installments?: number;
  first_installment_month?: string | null;
  category_name?: string | null;
  status: string;
  missing_fields?: string[];
};

const graphVersion = Deno.env.get('WHATSAPP_GRAPH_API_VERSION') || 'v26.0';
const graphBase = `https://graph.facebook.com/${graphVersion}`;
const encoder = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function readMessages(payload: unknown): IncomingMessage[] {
  const data = payload as { entry?: Array<{ changes?: Array<{ value?: { messages?: IncomingMessage[] } }> }> };
  return data.entry?.[0]?.changes?.[0]?.value?.messages ?? [];
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
  let failureJson: any = null;

  if (!response.ok) {
    failureJson = await response.clone().json().catch(() => null);
    console.error(`WhatsApp send failed to ${to}:`, JSON.stringify(failureJson));

    // Si es de Argentina (+54), probar alternando con o sin el '9'
    if (to.startsWith('549')) {
      const altTo = to.replace(/^549/, '54');
      const altResponse = await send(altTo);
      if (altResponse.ok) {
        console.log(`WhatsApp send succeeded with alt format ${altTo}`);
        return;
      }
      failureJson = (await altResponse.clone().json().catch(() => null)) || failureJson;
      response = altResponse;
    } else if (to.startsWith('54') && !to.startsWith('549')) {
      const altTo = to.replace(/^54/, '549');
      const altResponse = await send(altTo);
      if (altResponse.ok) {
        console.log(`WhatsApp send succeeded with alt format ${altTo}`);
        return;
      }
      failureJson = (await altResponse.clone().json().catch(() => null)) || failureJson;
      response = altResponse;
    }
  }

  if (!response.ok) {
    const errorDetails = failureJson?.error?.message || failureJson?.error?.error_user_msg || JSON.stringify(failureJson) || 'Sin detalle';
    const code = failureJson?.error?.code || response.status;
    throw new Error(`WhatsApp error ${code}: ${errorDetails}`);
  }
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

const multiResponseJsonSchema = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ['add_movements', 'edit_item', 'remove_item', 'confirm', 'cancel', 'summary', 'unknown'],
    },
    movements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['expense', 'income'] },
          description: { type: 'string' },
          totalAmountArs: { type: ['number', 'null'] },
          currency: { type: 'string', enum: ['ARS', 'USD'] },
          occurredOn: { type: ['string', 'null'] },
          category: { type: ['string', 'null'] },
          installments: { type: 'integer', minimum: 1, maximum: 60 },
          firstInstallmentMonth: { type: ['string', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          missingFields: { type: 'array', items: { type: 'string', enum: ['amount', 'date', 'category'] } },
        },
        required: ['kind', 'description', 'totalAmountArs', 'currency', 'occurredOn', 'category', 'installments', 'firstInstallmentMonth', 'confidence', 'missingFields'],
      },
    },
    edit: {
      type: 'object',
      properties: {
        targetPosition: { type: ['integer', 'null'] },
        amount: { type: ['number', 'null'] },
        description: { type: ['string', 'null'] },
        category: { type: ['string', 'null'] },
      },
    },
    removePosition: { type: ['integer', 'null'] },
    clarification: { type: ['string', 'null'] },
  },
  required: ['intent', 'movements'],
};

function cleanDescription(desc: string, kind: 'expense' | 'income'): string {
  if (!desc) return kind === 'expense' ? 'Gasto general' : 'Ingreso general';
  let cleaned = desc.trim();
  // Quitar prefijos de acción comunes como "gasté ... en ", "pagué ... en ", etc.
  cleaned = cleaned.replace(/^(gast[eé]|pagu[eé]|compr[eé]|abone|abon[eé]|carg[uú]e|pagar|gastar)\s+(\d+[\d.,]*\s*(k|mil|lucas?)?\s*(pesos?|ars|usd|dolares|dólares)?\s*(en|de)?\s*)?/i, '');
  cleaned = cleaned.replace(/^(ingres[oó]|me\s+ingresaron|cobr[eé]|me\s+pagaron|me\s+transfirieron|dep[oó]sito\s+de)\s+(\d+[\d.,]*\s*(k|mil|lucas?)?\s*(pesos?|ars|usd|dolares|dólares)?\s*(en|de|por)?\s*)?/i, '');
  cleaned = cleaned.replace(/^(en\s+|de\s+|por\s+)/i, '');
  cleaned = cleaned.replace(/\s+(\d+[\d.,]*\s*(k|mil|lucas?)?\s*(pesos?|ars|usd|dolares|dólares)?)$/i, '');
  cleaned = cleaned.trim();
  if (!cleaned) return kind === 'expense' ? 'Gasto general' : 'Ingreso general';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

async function extractFromGemini(input: {
  text?: string;
  mediaBase64?: string;
  mimeType?: string;
  activeDraftContext?: string;
}): Promise<GeminiParsedOutput> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('Gemini no está configurado.');

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const prompt = `Fecha local: ${today}.
Analizá el mensaje o audio del usuario para gestionar sus operaciones financieras (gastos e ingresos) en Pesito.

Borrador actual del usuario:
${input.activeDraftContext || 'Sin movimientos pendientes actualmente.'}

INTENCIONES POSIBLES ("intent"):
1. "add_movements": El usuario menciona uno o más gastos o ingresos nuevos (ej: "gasté 15000 en el súper y 4000 de nafta", "me entraron 80k de diseño"). Extraé cada uno como un elemento del array "movements".
2. "edit_item": El usuario pide corregir o cambiar un movimiento existente del borrador (ej: "el 2 fue de 5000", "el 1 no es súper es farmacia", "cambiá el 3 a 12000"). Indicá en "edit" el targetPosition y los campos modificados.
3. "remove_item": El usuario pide quitar o borrar un movimiento específico del borrador (ej: "quitá el 2", "sacá la nafta", "borrá el 1"). Indicá en "removePosition" el número de la posición.
4. "confirm": El usuario pide confirmar o guardar (ej: "confirmar", "dale guardá", "listo", "de una").
5. "cancel": El usuario pide cancelar o descartar todo el borrador (ej: "cancelar", "borrá todo", "descartar").
6. "summary": El usuario pide ver la lista o el resumen (ej: "resumen", "qué tengo pendiente", "mostrame la lista").
7. "unknown": Ruido incomprensible, saludo suelto o mensaje que no corresponde a ninguna acción financiera.

REGLAS PARA OPERACIONES ("movements"):
- TIPO ("kind"): "income" (sueldo, cobro, freelance, depósito, transferencia recibida, venta) o "expense" (compras, servicios, pagos, salidas).
- CONCEPTO / DETALLE ("description"): ÚNICAMENTE el concepto, producto, servicio, comercio o lugar (ej: "Súper", "Carnicería", "Nafta YPF", "Farmacia", "Almuerzo", "Sueldo"). PROHIBIDO incluir verbos de acción ("gasté", "pagué", "cobré") y PROHIBIDO incluir el monto numérico en la descripción.
- MONEDA Y MONTOS: "USD" si menciona dólares o u$s; por defecto "ARS". Interpretá "lucas" y "k" como miles de ARS (ej: "20 lucas" = 20000, "5k" = 5000).
- CATEGORÍAS:
  * Gasto: Alimentación, Transporte, Vivienda, Servicios, Salud, Educación, Ocio, Compras, Impuestos, Deudas, Otros.
  * Ingreso: Sueldo, Freelance, Ventas, Rendimientos, Otros.
- CUOTAS: Si es en cuotas, indicá installments y firstInstallmentMonth. De lo contrario installments = 1.
- COMPROBANTES: Si el usuario envía una imagen de un comprobante o ticket, interpretalo como UNA sola operación por el total del ticket; no dividas sus productos individuales. Si la imagen muestra varios comprobantes separados, extraé cada uno como una operación independiente.

Mensaje del usuario: ${input.text ?? ''}`;

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (input.mediaBase64 && input.mimeType) {
    parts.push({ inlineData: { mimeType: input.mimeType, data: input.mediaBase64 } });
  }

  const candidateModels = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
  let lastError: Error | null = null;

  for (const model of candidateModels) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: multiResponseJsonSchema,
            temperature: 0.1,
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        console.error(`Gemini (${model}) returned status ${response.status}: ${errorBody.slice(0, 200)}`);
        throw new Error(`Gemini respondió ${response.status}.`);
      }

      const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) throw new Error('Gemini no devolvió respuesta.');
      const parsed = JSON.parse(raw) as GeminiParsedOutput;

      if (parsed.movements && Array.isArray(parsed.movements)) {
        for (const mov of parsed.movements) {
          mov.description = cleanDescription(mov.description, mov.kind);
        }
      }

      return parsed;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Intento con ${model} falló, probando siguiente modelo si disponible...`, lastError.message);
    }
  }

  throw lastError ?? new Error('Gemini no pudo procesar la solicitud.');
}

function formatDraftList(items: DraftListItem[]): string {
  const activeItems = items.filter((it) => it.status === 'pending');
  if (activeItems.length === 0) {
    return 'No tenés movimientos pendientes en tu lista.';
  }

  const count = activeItems.length;
  const countText = count === 1 ? '1 movimiento para revisar:' : `${count} movimientos para revisar:`;

  let out = `Tenés ${countText}\n\n`;

  for (const it of activeItems) {
    const isUsd = it.currency === 'USD';
    const icon = it.kind === 'income' ? '🟢' : '🔴';
    const amountStr = isUsd
      ? `US$ ${it.amount.toLocaleString('es-AR', { minimumFractionDigits: it.amount % 1 !== 0 ? 2 : 0, maximumFractionDigits: 2 })} [USD]`
      : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(it.amount);

    const instText = (it.installments && it.installments > 1) ? ` (${it.installments} cuotas)` : '';
    out += `${it.position}. ${icon} ${it.description} · ${amountStr}${instText}\n`;
  }

  out += `\nPodés seguir agregando, corregir alguno (ej: "el 2 fue de 5.000"), quitar ("quitá el 2") o responder *CONFIRMAR* para guardar todo.`;
  return out;
}

Deno.serve(async (request) => {
  const url = new URL(request.url);

  // Endpoint de diagnóstico protegido
  if (url.searchParams.get('action') === 'test-send' && request.method === 'POST') {
    const authHeader = request.headers.get('authorization') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceKey || !authHeader.includes(serviceKey)) {
      return json({ error: 'No autorizado.' }, 401);
    }
    try {
      const data = await request.json();
      await sendWhatsAppText(data.to, data.body || 'Prueba de Pesito');
      return json({ ok: true, sent_to: data.to });
    } catch (err: any) {
      return json({ ok: false, error: err.message }, 400);
    }
  }

  // Verificación de Webhook Meta
  if (request.method === 'GET') {
    const valid = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === Deno.env.get('WHATSAPP_VERIFY_TOKEN');
    return valid ? new Response(url.searchParams.get('hub.challenge') ?? '') : json({ error: 'Verificación rechazada.' }, 403);
  }

  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const raw = await request.text();
  if (!(await validSignature(raw, request.headers.get('x-hub-signature-256')))) return json({ error: 'Firma inválida.' }, 401);

  const messages = readMessages(JSON.parse(raw));
  if (!messages || messages.length === 0) return json({ received: true });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase no está configurado.' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Procesar cada mensaje del payload
  for (const message of messages) {
    const { data: inserted } = await supabase.from('inbound_events').upsert(
      { wa_message_id: message.id, wa_id: message.from, status: 'processing' },
      { onConflict: 'wa_message_id', ignoreDuplicates: true }
    ).select('id').maybeSingle();

    if (!inserted) continue;

    try {
      const initialText = message.text?.body?.trim() ?? '';

      // 1. Comando de Vinculación de cuenta
      const linkMatch = initialText.match(/^vincular\s+(\d{6})$/i);
      if (linkMatch) {
        const { data: candidate } = await supabase.from('whatsapp_links').select('user_id').eq('link_code_hash', await sha256(linkMatch[1])).gt('link_code_expires_at', new Date().toISOString()).maybeSingle();
        if (candidate) {
          await supabase.from('whatsapp_links').update({ wa_id: null, status: 'pending' }).eq('wa_id', message.from).neq('user_id', candidate.user_id);
          await supabase.from('profiles').update({ phone_number: null }).eq('phone_number', message.from).neq('id', candidate.user_id);

          await supabase.from('whatsapp_links').update({ wa_id: message.from, status: 'active', linked_at: new Date().toISOString(), link_code_hash: null, link_code_expires_at: null }).eq('user_id', candidate.user_id);
          await supabase.from('profiles').update({ phone_number: message.from }).eq('id', candidate.user_id);
          await sendWhatsAppText(message.from, '¡Listo! Tu WhatsApp quedó vinculado con Pesito ✅');
          await supabase.from('inbound_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
          continue;
        } else {
          await sendWhatsAppText(message.from, 'El código de vinculación no es válido o ya venció (duran 10 minutos). Generá uno nuevo desde la app.');
          await supabase.from('inbound_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
          continue;
        }
      }

      // 2. Verificar usuario vinculado
      const { data: link } = await supabase.from('whatsapp_links').select('user_id').eq('wa_id', message.from).eq('status', 'active').maybeSingle();
      if (!link) throw new Error('Número no vinculado.');

      // 3. Verificar estado de suscripción
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, subscription_status, subscription_until')
        .eq('id', link.user_id)
        .maybeSingle();

      if (profileError || !profile) {
        await supabase.from('inbound_events').update({ status: 'blocked_profile_unavailable', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
        await sendWhatsAppText(message.from, 'No pudimos verificar tu suscripción. Intentá nuevamente en unos minutos; no registramos ninguna operación.');
        continue;
      }

      if (profile.role !== 'admin') {
        const isSuspended = profile.subscription_status === 'suspended';
        const isExpired =
          profile.role !== 'client' ||
          profile.subscription_status === 'active' === false ||
          (profile.subscription_until !== null && !(Date.parse(profile.subscription_until) > Date.now()));

        if (isSuspended || isExpired) {
          const [supportRes, aliasRes] = await Promise.all([
            supabase.from('system_config').select('value').eq('key', 'support_phone').maybeSingle(),
            supabase.from('system_config').select('value').eq('key', 'payment_alias').maybeSingle(),
          ]);
          const supportPhone = supportRes.data?.value ? supportRes.data.value.replace(/\D/g, '') : null;
          const alias = aliasRes.data?.value?.trim();

          let contactInfo = '';
          if (supportPhone) contactInfo += `\n\n👉 Escribinos a soporte para renovar o reactivar: https://wa.me/${supportPhone}`;
          if (alias) contactInfo += `\n💸 Alias para transferencias: *${alias}*`;

          if (isSuspended) {
            await sendWhatsAppText(message.from, `Tu cuenta de Pesito se encuentra en pausa ⏸️.${contactInfo || ' Si necesitás reactivarla, comunicate con soporte desde la app.'}`);
            await supabase.from('inbound_events').update({ status: 'blocked_suspended', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
            continue;
          }

          if (isExpired) {
            await sendWhatsAppText(message.from, `Tu suscripción en Pesito ha finalizado ⏳.${contactInfo || ' Para seguir registrando tus gastos y consultando tus finanzas, renová tu membresía desde la app.'}`);
            await supabase.from('inbound_events').update({ status: 'blocked_expired', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
            continue;
          }
        }
      }

      // 4. Corte General del Bot (exclusivo admin)
      const { data: botActiveConfig } = await supabase.from('system_config').select('value').eq('key', 'bot_active').maybeSingle();
      const isBotActiveGlobally = botActiveConfig ? botActiveConfig.value !== 'false' : true;
      if (!isBotActiveGlobally && profile?.role !== 'admin') {
        await sendWhatsAppText(message.from, 'Pesito: El bot se encuentra temporalmente en pausa por corte de seguridad o mantenimiento. Por favor, intentá nuevamente más tarde.');
        await supabase.from('inbound_events').update({ status: 'blocked_bot_paused', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
        continue;
      }

      // 5. Configuración individual de respuestas del bot
      const { data: settings } = await supabase.from('app_settings').select('whatsapp_responses_enabled').eq('user_id', link.user_id).maybeSingle();
      if (!(settings?.whatsapp_responses_enabled ?? true)) {
        await supabase.from('inbound_events').update({ status: 'blocked_paused', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
        continue;
      }

      const text = message.text?.body?.trim() ?? message.image?.caption?.trim() ?? '';

      // 6. Detección de intenciones comerciales de renovación
      const isRenewalIntent = /(renovar|renovaci[oó]n|suscripci[oó]n|planes?|precios?|cu[aá]nto (sale|cuesta)|c[oó]mo (pago|abono|renuevo)|d[oó]nde (pago|transfiero)|quiero pagar|alias|cbu|datos de pago|transferir|transferencia|membres[ií]a)/i.test(text);
      if (isRenewalIntent) {
        const [supportRes, aliasRes] = await Promise.all([
          supabase.from('system_config').select('value').eq('key', 'support_phone').maybeSingle(),
          supabase.from('system_config').select('value').eq('key', 'payment_alias').maybeSingle(),
        ]);
        const supportPhone = supportRes.data?.value ? supportRes.data.value.replace(/\D/g, '') : null;
        const alias = aliasRes.data?.value?.trim();

        let reply = '¡Hola! 👋 Para renovar tu membresía en Pesito o consultar planes y medios de pago:\n';
        if (supportPhone) reply += `\n👉 Escribinos directamente a soporte por WhatsApp: https://wa.me/${supportPhone}`;
        if (alias) reply += `\n💸 Alias para transferencias: *${alias}*`;
        reply += '\n\nApenas nos envíes el comprobante o te pongas en contacto, te activamos tu cuenta al instante 🚀';

        await sendWhatsAppText(message.from, reply);
        await supabase.from('inbound_events').update({ status: 'processed_renewal_intent', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
        continue;
      }

      // 7. Consultar borrador activo del usuario
      const { data: draftInfo } = await supabase.rpc('get_active_draft_group', { p_user_id: link.user_id });
      const hasActiveDraft = Boolean(draftInfo?.found);
      const isDraftStale = Boolean(draftInfo?.is_stale);
      const draftItems: DraftListItem[] = draftInfo?.items ?? [];

      // Si el borrador tiene más de 24 horas sin actividad
      if (hasActiveDraft && isDraftStale) {
        if (/^retomar$/i.test(text)) {
          await supabase.from('draft_groups').update({ last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', draftInfo.group_id);
          await sendWhatsAppText(message.from, `¡Retomamos tu lista pendiente!\n\n${formatDraftList(draftItems)}`);
          await supabase.from('inbound_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
          continue;
        } else if (/^descartar$/i.test(text)) {
          await supabase.rpc('discard_draft_group', { p_group_id: draftInfo.group_id, p_user_id: link.user_id });
          await sendWhatsAppText(message.from, 'Lista anterior descartada 🗑️. Ya podés enviar tus nuevos gastos o ingresos.');
          await supabase.from('inbound_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
          continue;
        } else {
          // Preguntar si quiere retomar o descartar
          const stalePrompt = `Tenías estos movimientos pendientes de hace más de 24 horas:\n\n${formatDraftList(draftItems)}\n\n¿Querés responder *RETOMAR* para seguir con esa lista, o *DESCARTAR* para empezar de nuevo?`;
          await sendWhatsAppText(message.from, stalePrompt);
          await supabase.from('inbound_events').update({ status: 'stale_inquiry', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
          continue;
        }
      }

      // 8. Comandos rápidos directos
      const isConfirm = /^(confirmar|confirmado|confirmo|si|sí|ok|dale|listo|de una|va|sisi|perfecto|👍)$/i.test(text);
      const isCancel = /^(cancelar|cancelalo|cancela|cancel|no|borralo|borrar todo|anular|rechazar)$/i.test(text);
      const isSummary = /^(resumen|pendientes|ver lista|lista)$/i.test(text);
      const removeMatch = text.match(/^(quit[aá]|borr[aá]|sac[aá]|elimin[aá])\s+(el\s+)?(\d{1,2})$/i);

      if (isConfirm) {
        if (!hasActiveDraft || draftItems.length === 0) {
          // Compatibilidad: verificar si había transacción pendiente en modelo previo
          const { data: legacyPending } = await supabase.from('transactions').select('*').eq('user_id', link.user_id).eq('status', 'pending').limit(1).maybeSingle();
          if (legacyPending) {
            await supabase.from('transactions').update({ status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('id', legacyPending.id);
            await sendWhatsAppText(message.from, 'Listo, quedó registrado ✅');
          } else {
            await sendWhatsAppText(message.from, 'No tenés movimientos pendientes para guardar.');
          }
        } else {
          const { data: confirmResult, error: confirmErr } = await supabase.rpc('confirm_draft_group', {
            p_group_id: draftInfo.group_id,
            p_user_id: link.user_id,
            p_expected_version: draftInfo.version,
          });

          if (confirmErr || !confirmResult?.success) {
            const errMsg = confirmResult?.error || confirmErr?.message || 'No se pudieron confirmar los movimientos.';
            await sendWhatsAppText(message.from, `No pudimos guardar: ${errMsg}`);
          } else {
            const count = confirmResult.confirmed_movements ?? draftItems.length;
            const countText = count === 1 ? '1 movimiento' : `${count} movimientos`;
            await sendWhatsAppText(message.from, `¡Listo! Se guardaron ${countText} en tu cuenta de Pesito ✅💰`);
          }
        }
        await supabase.from('inbound_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
        continue;
      }

      if (isCancel) {
        if (hasActiveDraft) {
          await supabase.rpc('discard_draft_group', { p_group_id: draftInfo.group_id, p_user_id: link.user_id });
        }
        await supabase.from('transactions').update({ status: 'cancelled' }).eq('user_id', link.user_id).eq('status', 'pending');
        await sendWhatsAppText(message.from, 'Se descartaron los movimientos pendientes 🗑️.');
        await supabase.from('inbound_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
        continue;
      }

      if (isSummary) {
        if (!hasActiveDraft || draftItems.length === 0) {
          await sendWhatsAppText(message.from, 'No tenés movimientos pendientes en tu lista.');
        } else {
          await sendWhatsAppText(message.from, formatDraftList(draftItems));
        }
        await supabase.from('inbound_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
        continue;
      }

      if (removeMatch) {
        const targetPos = parseInt(removeMatch[3], 10);
        const itemExists = draftItems.some((it) => it.position === targetPos && it.status === 'pending');
        if (!itemExists) {
          await sendWhatsAppText(message.from, `No encontré el movimiento #${targetPos} en tu lista pendiente.`);
        } else {
          await supabase.from('draft_items').update({ status: 'removed', updated_at: new Date().toISOString() }).eq('group_id', draftInfo.group_id).eq('position', targetPos);
          await supabase.from('draft_groups').update({ version: (draftInfo.version || 1) + 1, last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', draftInfo.group_id);

          const { data: updatedDraft } = await supabase.rpc('get_active_draft_group', { p_user_id: link.user_id });
          const remainingItems = updatedDraft?.items ?? [];
          if (remainingItems.length === 0) {
            await sendWhatsAppText(message.from, `Movimiento #${targetPos} eliminado. No quedan más pendientes en la lista.`);
          } else {
            await sendWhatsAppText(message.from, `Movimiento #${targetPos} eliminado.\n\n${formatDraftList(remainingItems)}`);
          }
        }
        await supabase.from('inbound_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
        continue;
      }

      // 9. Descarga de multimedia si corresponde
      let media: { base64: string; mimeType: string } | undefined;
      const mediaId = message.image?.id ?? message.audio?.id;
      if (mediaId) media = await downloadWhatsAppMedia(mediaId);
      if (!text && !media) throw new Error('Tipo de mensaje no compatible.');

      // 10. Inserción en cola persistente y Debounce (espera de 3 segundos)
      await supabase.from('whatsapp_message_queue').insert({
        wa_message_id: message.id,
        wa_id: message.from,
        user_id: link.user_id,
        payload: message,
        status: 'pending',
      });

      // Esperar 3 segundos para acumular ráfagas rápidas de mensajes del mismo usuario
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Verificar si hay mensajes más nuevos de este usuario en la cola
      const { data: newerPending } = await supabase
        .from('whatsapp_message_queue')
        .select('id')
        .eq('user_id', link.user_id)
        .eq('status', 'pending')
        .gt('received_at', new Date(Date.now() - 3200).toISOString())
        .neq('wa_message_id', message.id);

      if (newerPending && newerPending.length > 0) {
        await supabase.from('whatsapp_message_queue').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
        await supabase.from('inbound_events').update({ status: 'batched', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
        continue;
      }

      // 11. Interpretación inteligente con Gemini
      const activeDraftContext = draftItems.length > 0
        ? draftItems.map((it) => `${it.position}. ${it.kind === 'income' ? 'Ingreso' : 'Gasto'}: ${it.description} $${it.amount}`).join('\n')
        : '';

      const geminiResult = await extractFromGemini({
        text,
        mediaBase64: media?.base64,
        mimeType: media?.mimeType,
        activeDraftContext,
      });

      // Procesar intención detectada por Gemini
      if (geminiResult.intent === 'confirm') {
        if (!hasActiveDraft || draftItems.length === 0) {
          await sendWhatsAppText(message.from, 'No tenés movimientos pendientes para guardar.');
        } else {
          const { data: confirmResult, error: confirmErr } = await supabase.rpc('confirm_draft_group', {
            p_group_id: draftInfo.group_id,
            p_user_id: link.user_id,
            p_expected_version: draftInfo.version,
          });

          if (confirmErr || !confirmResult?.success) {
            const errMsg = confirmResult?.error || confirmErr?.message || 'No se pudieron confirmar los movimientos.';
            await sendWhatsAppText(message.from, `No pudimos guardar: ${errMsg}`);
          } else {
            const count = confirmResult.confirmed_movements ?? draftItems.length;
            const countText = count === 1 ? '1 movimiento' : `${count} movimientos`;
            await sendWhatsAppText(message.from, `¡Listo! Se guardaron ${countText} en tu cuenta de Pesito ✅💰`);
          }
        }
      } else if (geminiResult.intent === 'cancel') {
        if (hasActiveDraft) {
          await supabase.rpc('discard_draft_group', { p_group_id: draftInfo.group_id, p_user_id: link.user_id });
        }
        await sendWhatsAppText(message.from, 'Se descartaron los movimientos pendientes 🗑️.');
      } else if (geminiResult.intent === 'summary') {
        await sendWhatsAppText(message.from, formatDraftList(draftItems));
      } else if (geminiResult.intent === 'remove_item' && geminiResult.removePosition) {
        const targetPos = geminiResult.removePosition;
        await supabase.from('draft_items').update({ status: 'removed', updated_at: new Date().toISOString() }).eq('group_id', draftInfo.group_id).eq('position', targetPos);
        await supabase.from('draft_groups').update({ version: (draftInfo.version || 1) + 1, last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', draftInfo.group_id);

        const { data: updatedDraft } = await supabase.rpc('get_active_draft_group', { p_user_id: link.user_id });
        const remainingItems = updatedDraft?.items ?? [];
        await sendWhatsAppText(message.from, `Movimiento #${targetPos} eliminado.\n\n${formatDraftList(remainingItems)}`);
      } else if (geminiResult.intent === 'edit_item' && geminiResult.edit?.targetPosition) {
        const targetPos = geminiResult.edit.targetPosition;
        const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (geminiResult.edit.amount) updatePayload.amount = geminiResult.edit.amount;
        if (geminiResult.edit.description) updatePayload.description = geminiResult.edit.description;

        await supabase.from('draft_items').update(updatePayload).eq('group_id', draftInfo.group_id).eq('position', targetPos);
        await supabase.from('draft_groups').update({ version: (draftInfo.version || 1) + 1, last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', draftInfo.group_id);

        const { data: updatedDraft } = await supabase.rpc('get_active_draft_group', { p_user_id: link.user_id });
        await sendWhatsAppText(message.from, `Movimiento #${targetPos} modificado.\n\n${formatDraftList(updatedDraft?.items ?? [])}`);
      } else if (geminiResult.intent === 'add_movements') {
        const newMovements = geminiResult.movements.filter((m) => m.totalAmountArs && m.totalAmountArs > 0);

        if (newMovements.length === 0) {
          throw new Error('No se pudo identificar un monto u operación válida en el mensaje/audio.');
        }

        // Obtener o crear grupo de borrador activo
        let targetGroupId = draftInfo?.group_id;
        let currentVersion = draftInfo?.version || 1;

        if (!hasActiveDraft) {
          const { data: newGroup, error: groupErr } = await supabase.from('draft_groups').insert({
            user_id: link.user_id,
            status: 'open',
            version: 1,
          }).select('id, version').single();

          if (groupErr || !newGroup) throw new Error('No se pudo crear el grupo de movimientos.');
          targetGroupId = newGroup.id;
          currentVersion = newGroup.version;
        }

        // Calcular posición máxima actual en el borrador
        const { data: existingItems } = await supabase
          .from('draft_items')
          .select('position')
          .eq('group_id', targetGroupId)
          .order('position', { ascending: false })
          .limit(1);

        const currentMaxPos = existingItems?.[0]?.position ?? 0;

        // Validar límite de 20 movimientos por lote
        if (currentMaxPos + newMovements.length > 20) {
          await sendWhatsAppText(
            message.from,
            `Llegaste al límite de 20 movimientos por lote. Por favor respondé *CONFIRMAR* para guardar los actuales antes de seguir agregando.`
          );
          await supabase.from('inbound_events').update({ status: 'limit_exceeded', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
          continue;
        }

        // Cargar categorías del usuario para mapeo
        const { data: userCategories } = await supabase.from('categories').select('id, name, kind').eq('user_id', link.user_id);

        // Insertar cada movimiento extraído
        let posOffset = currentMaxPos;
        for (const mov of newMovements) {
          posOffset += 1;
          let categoryId: string | null = null;
          if (mov.category && userCategories) {
            const matched = userCategories.find((c) => c.kind === mov.kind && c.name.toLowerCase() === mov.category?.toLowerCase());
            categoryId = matched?.id ?? null;
          }
          if (!categoryId && userCategories) {
            const defaultCat = userCategories.find((c) => c.kind === mov.kind && c.name === 'Otros');
            categoryId = defaultCat?.id ?? null;
          }

          await supabase.from('draft_items').insert({
            group_id: targetGroupId,
            user_id: link.user_id,
            position: posOffset,
            kind: mov.kind,
            description: mov.description || (mov.kind === 'expense' ? 'Gasto general' : 'Ingreso general'),
            amount: mov.totalAmountArs,
            currency: mov.currency || 'ARS',
            occurred_on: mov.occurredOn || new Date().toISOString().slice(0, 10),
            category_id: categoryId,
            installments: mov.installments || 1,
            first_installment_month: mov.firstInstallmentMonth ?? mov.occurredOn?.slice(0, 7),
            confidence: mov.confidence || 1.0,
            source: message.type,
            wa_message_id: message.id,
            status: 'pending',
          });
        }

        // Actualizar versión y marca de actividad del grupo
        await supabase.from('draft_groups').update({
          version: currentVersion + 1,
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', targetGroupId);

        // Obtener lista completa y responder al usuario
        const { data: refreshedDraft } = await supabase.rpc('get_active_draft_group', { p_user_id: link.user_id });
        await sendWhatsAppText(message.from, formatDraftList(refreshedDraft?.items ?? []));
      } else {
        throw new Error('No se pudo identificar una operación clara en el mensaje.');
      }

      await supabase.from('whatsapp_message_queue').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
      await supabase.from('inbound_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'unknown';
      console.error('Error processing inbound message:', errorMsg);
      await supabase.from('inbound_events').update({ status: 'failed', error_code: errorMsg.slice(0, 160), processed_at: new Date().toISOString() }).eq('wa_message_id', message.id);
      if (message?.from) {
        try {
          const userNotice = errorMsg.includes('Número no vinculado')
            ? 'Tu número no está vinculado a Pesito. Podés vincularlo generando un código desde la app.'
            : 'No pude interpretar el mensaje o comprobante 😕. Probá escribiendo los gastos o ingresos (ej: "Gasté 15000 en súper y 4000 de nafta") o reenviando el audio.';
          await sendWhatsAppText(message.from, userNotice);
        } catch {
          // Ignorar errores secundarios al enviar aviso
        }
      }
    }
  }

  return json({ received: true });
});
