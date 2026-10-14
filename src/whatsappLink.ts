import { supabase } from './supabase';

export async function requestWhatsAppLinkCode(): Promise<{ code: string; expiresAt: string }> {
  const { data, error } = await supabase.rpc('request_whatsapp_link_code');
  if (error) throw new Error('No pudimos generar el código de vinculación.');
  const result: unknown = data;
  if (!result || typeof result !== 'object' || !('code' in result) || !('expires_at' in result)
    || typeof result.code !== 'string' || !/^\d{6}$/.test(result.code)
    || typeof result.expires_at !== 'string' || !Number.isFinite(Date.parse(result.expires_at))) {
    throw new Error('No recibimos un código de vinculación válido.');
  }
  return { code: result.code, expiresAt: result.expires_at };
}
