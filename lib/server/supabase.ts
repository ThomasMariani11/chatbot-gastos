import { createClient } from '@supabase/supabase-js';

export function createServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) throw new Error('Supabase no está configurado.');
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
