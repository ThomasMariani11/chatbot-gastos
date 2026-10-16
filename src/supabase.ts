import { createClient } from '@supabase/supabase-js';
import type { resolveEnvironment } from './environment';

declare const __APP_CONFIG__: ReturnType<typeof resolveEnvironment>;

const config = __APP_CONFIG__;
export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});
