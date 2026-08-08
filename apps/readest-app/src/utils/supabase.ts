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
  admin: {
    listUsers: async () => ({ data: { users: [] }, error: null }),
    getUserById: async () => ({ data: { user: null }, error: null }),
    updateUserById: async () => ({ data: { user: null }, error: null }),
    deleteUser: async () => ({ data: { user: null }, error: null }),
  },
};

// No-op PostgREST query builder. Moke doesn't talk to Supabase; the stub only
// exists so the (web-only) server routes type-check. The builder's query
// methods are `any` so generic calls like `.maybeSingle<T>()` and row access on
// results don't collapse to `never` under `strict`. The runtime never actually
// resolves; these routes are never invoked in Moke.
const noopBuilder: any = {
  select: () => noopBuilder,
  insert: () => noopBuilder,
  update: () => noopBuilder,
  delete: () => noopBuilder,
  upsert: () => noopBuilder,
  eq: () => noopBuilder,
  neq: () => noopBuilder,
  gt: () => noopBuilder,
  gte: () => noopBuilder,
  lt: () => noopBuilder,
  lte: () => noopBuilder,
  like: () => noopBuilder,
  ilike: () => noopBuilder,
  is: () => noopBuilder,
  in: () => noopBuilder,
  contains: () => noopBuilder,
  overlaps: () => noopBuilder,
  order: () => noopBuilder,
  limit: () => noopBuilder,
  range: () => noopBuilder,
  single: () => Promise.resolve({ data: null, error: null }),
  maybeSingle: () => Promise.resolve({ data: null, error: null }),
  maybeSingleValue: () => Promise.resolve({ data: null, error: null }),
  returns: () => noopBuilder,
  or: () => noopBuilder,
  not: () => noopBuilder,
  filter: () => noopBuilder,
  match: () => noopBuilder,
  textSearch: () => noopBuilder,
  then: (onfulfilled?: (value: { data: any[]; error: null }) => unknown) =>
    Promise.resolve({ data: [] as any[], error: null }).then(onfulfilled as any),
};

const noopClient: any = {
  auth: noopAuth,
  from: () => noopBuilder,
  rpc: () => Promise.resolve({ data: null, error: null }),
  storage: {
    from: () => noopBuilder,
  },
  channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} }),
  removeChannel: () => {},
  getChannels: () => [],
  schema: () => noopClient,
};

export const supabase: any = noopClient;

export const createSupabaseClient = (_accessToken?: string): any => noopClient;
export const createSupabaseAdminClient = (): any => noopClient;
