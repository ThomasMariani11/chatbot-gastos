import { createClient } from '@supabase/supabase-js';

export function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key || !/^https?:\/\//i.test(url)) return null;
  return createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
}
