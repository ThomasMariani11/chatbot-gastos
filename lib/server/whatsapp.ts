const graphApiVersion = process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || 'v26.0';
const graphApiBase = `https://graph.facebook.com/${graphApiVersion}`;

export async function sendWhatsAppText(to: string, body: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) throw new Error('WhatsApp no está configurado.');
  const response = await fetch(`${graphApiBase}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body } }),
  });
  if (!response.ok) throw new Error(`WhatsApp respondió ${response.status}.`);
}

export async function downloadWhatsAppMedia(mediaId: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('WhatsApp no está configurado.');
  const metadata = await fetch(`${graphApiBase}/${mediaId}`, { headers: { authorization: `Bearer ${token}` } });
  if (!metadata.ok) throw new Error('No se pudo obtener el archivo de WhatsApp.');
  const { url, mime_type: mimeType } = await metadata.json() as { url: string; mime_type: string };
  const file = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!file.ok) throw new Error('No se pudo descargar el archivo de WhatsApp.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { base64: btoa(binary), mimeType };
}
