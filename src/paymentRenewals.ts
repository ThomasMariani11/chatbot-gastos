import { supabase } from './supabase';

export type PaymentRenewal = {
  id: string;
  user_id: string;
  client_name: string | null;
  state: 'requested' | 'paid' | 'redeemed';
  requested_at: string;
  paid_at: string | null;
  duration_days: number | null;
  redeemed_at: string | null;
  delivery_state: 'pending' | 'waiting_window' | 'sending' | 'sent' | 'uncertain' | 'blocked' | 'failed' | 'cancelled' | null;
  attempts: number | null;
  window_open: boolean;
};
export type PaymentRenewalPage = { total: number; items: PaymentRenewal[] };
export const PAYMENT_PAGE_SIZE = 10;

export async function readPaymentRenewals(page: number, signal: AbortSignal): Promise<PaymentRenewalPage> {
  const { data, error } = await supabase.rpc('admin_subscription_renewals', {
    p_limit: PAYMENT_PAGE_SIZE, p_offset: (page - 1) * PAYMENT_PAGE_SIZE,
  }).abortSignal(signal);
  if (error || !data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0) {
    throw new Error('No pudimos cargar las solicitudes. Actualizá para volver a intentar.');
  }
  for (const item of data.items) {
    if (!item || typeof item.id !== 'string' || typeof item.user_id !== 'string' ||
      !['requested', 'paid', 'redeemed'].includes(item.state) || typeof item.window_open !== 'boolean' ||
      typeof item.requested_at !== 'string' || !Number.isFinite(Date.parse(item.requested_at)) ||
      ![null, 'pending', 'waiting_window', 'sending', 'sent', 'uncertain', 'blocked', 'failed', 'cancelled'].includes(item.delivery_state) ||
      (item.client_name !== null && typeof item.client_name !== 'string') ||
      (item.duration_days !== null && (!Number.isInteger(item.duration_days) || item.duration_days < 1 || item.duration_days > 3650))) {
      throw new Error('No pudimos comprobar las solicitudes. Actualizá para volver a intentar.');
    }
  }
  return data as PaymentRenewalPage;
}

export async function confirmPayment(id: string, days: number | null, signal: AbortSignal): Promise<void> {
  const { data, error } = await supabase.rpc('admin_confirm_renewal_payment', {
    p_request_id: id, p_days: days,
  }).abortSignal(signal);
  if (error || data?.request_id !== id || typeof data?.replayed !== 'boolean' || !['paid', 'redeemed'].includes(data?.state)) {
    throw new Error('No pudimos comprobar el pago. Actualizá la solicitud antes de repetir; si se registró, se conservarán el mismo código y envío.');
  }
}

export async function wakePaymentDelivery(): Promise<void> {
  // Operación posterior a confirmar; su fallo no revierte ni duplica el pago.
  await supabase.rpc('wake_subscription_renewals').abortSignal(AbortSignal.timeout(10000));
}

export function paymentDeliveryLabel(item: PaymentRenewal): string {
  if (item.state === 'redeemed') return 'Canjeado';
  if (item.state === 'requested') return 'Solicitado';
  return ({ pending: 'Pago confirmado · pendiente de envío', waiting_window: 'Esperando RENOVAR del cliente', sending: 'Enviando código', sent: 'Código enviado', uncertain: 'Envío incierto · revisar', blocked: 'Envío bloqueado · revisar vínculo y permisos', failed: 'No se pudo enviar · revisar', cancelled: 'Envío cancelado' } as Record<string, string>)[item.delivery_state ?? ''] ?? 'Pago confirmado';
}
