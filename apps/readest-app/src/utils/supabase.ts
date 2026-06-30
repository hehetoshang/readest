// Supabase has been removed. This stub exports no-op client objects.
// TODO: Replace with talebook server API client when ready.

/* Original imports kept for reference:
import { createClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from '@/services/runtimeConfig';

const supabaseUrl = getRuntimeConfig()?.supabaseUrl || ...
const supabaseAnonKey = getRuntimeConfig()?.supabaseAnonKey || ...
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export const createSupabaseClient = (accessToken?: string) => createClient(...);
export const createSupabaseAdminClient = () => createClient(...);
*/

const noopAuth = {
  onAuthStateChange: (_event: unknown, _callback: unknown) => ({
    data: { subscription: { unsubscribe: () => {} } },
  }),
  refreshSession: async () => ({ data: { session: null }, error: null }),
  signOut: async () => ({ error: null }),
  setSession: async () => ({ data: { session: null, user: null }, error: null }),
  getUser: async () => ({ data: { user: null }, error: null }),
  getSession: async () => ({ data: { session: null }, error: null }),
  signInWithOAuth: async () => ({ data: null, error: null }),
};

export const supabase = {
  auth: noopAuth,
};

export const createSupabaseClient = (_accessToken?: string) => ({ auth: noopAuth });
export const createSupabaseAdminClient = () => ({ auth: noopAuth });
