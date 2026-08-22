import type { SupabaseClient } from '@supabase/supabase-js';

// Supabase is disabled in the Moke build. Keep a typed, inert client so shared
// web-only routes continue to type-check without initializing Supabase or
// pulling credentials into the embedded reader.

type NoopQueryResult = { data: unknown[]; error: null };
type NoopSingleResult<T> = { data: T | null; error: null };

interface NoopBuilder {
  select(...args: unknown[]): NoopBuilder;
  insert(...args: unknown[]): NoopBuilder;
  update(...args: unknown[]): NoopBuilder;
  delete(...args: unknown[]): NoopBuilder;
  upsert(...args: unknown[]): NoopBuilder;
  eq(...args: unknown[]): NoopBuilder;
  neq(...args: unknown[]): NoopBuilder;
  gt(...args: unknown[]): NoopBuilder;
  gte(...args: unknown[]): NoopBuilder;
  lt(...args: unknown[]): NoopBuilder;
  lte(...args: unknown[]): NoopBuilder;
  like(...args: unknown[]): NoopBuilder;
  ilike(...args: unknown[]): NoopBuilder;
  is(...args: unknown[]): NoopBuilder;
  in(...args: unknown[]): NoopBuilder;
  contains(...args: unknown[]): NoopBuilder;
  overlaps(...args: unknown[]): NoopBuilder;
  order(...args: unknown[]): NoopBuilder;
  limit(...args: unknown[]): NoopBuilder;
  range(...args: unknown[]): NoopBuilder;
  returns(...args: unknown[]): NoopBuilder;
  or(...args: unknown[]): NoopBuilder;
  not(...args: unknown[]): NoopBuilder;
  filter(...args: unknown[]): NoopBuilder;
  match(...args: unknown[]): NoopBuilder;
  textSearch(...args: unknown[]): NoopBuilder;
  upload(...args: unknown[]): Promise<NoopSingleResult<unknown>>;
  download(...args: unknown[]): Promise<NoopSingleResult<Blob>>;
  list(...args: unknown[]): Promise<NoopQueryResult>;
  remove(...args: unknown[]): Promise<NoopQueryResult>;
  createSignedUrl(...args: unknown[]): Promise<NoopSingleResult<unknown>>;
  createSignedUrls(...args: unknown[]): Promise<NoopQueryResult>;
  move(...args: unknown[]): Promise<NoopSingleResult<unknown>>;
  copy(...args: unknown[]): Promise<NoopSingleResult<unknown>>;
  single<T = unknown>(): Promise<NoopSingleResult<T>>;
  maybeSingle<T = unknown>(): Promise<NoopSingleResult<T>>;
  maybeSingleValue<T = unknown>(): Promise<NoopSingleResult<T>>;
  then<TResult1 = NoopQueryResult, TResult2 = never>(
    onfulfilled?: ((value: NoopQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

const queryResult = (): NoopQueryResult => ({ data: [], error: null });
const singleResult = <T>(): NoopSingleResult<T> => ({ data: null, error: null });

const noopBuilder: NoopBuilder = {
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
  returns: () => noopBuilder,
  or: () => noopBuilder,
  not: () => noopBuilder,
  filter: () => noopBuilder,
  match: () => noopBuilder,
  textSearch: () => noopBuilder,
  upload: async () => singleResult(),
  download: async () => singleResult<Blob>(),
  list: async () => queryResult(),
  remove: async () => queryResult(),
  createSignedUrl: async () => singleResult(),
  createSignedUrls: async () => queryResult(),
  move: async () => singleResult(),
  copy: async () => singleResult(),
  single: async <T>() => singleResult<T>(),
  maybeSingle: async <T>() => singleResult<T>(),
  maybeSingleValue: async <T>() => singleResult<T>(),
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are intentionally awaitable.
  then: (onfulfilled, onrejected) => Promise.resolve(queryResult()).then(onfulfilled, onrejected),
};

const noopAuth = {
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  refreshSession: async () => ({ data: { session: null }, error: null }),
  signOut: async () => ({ error: null }),
  setSession: async () => ({ data: { session: null, user: null }, error: null }),
  getUser: async () => ({ data: { user: null }, error: null }),
  getSession: async () => ({ data: { session: null }, error: null }),
  signInWithOAuth: async () => ({ data: null, error: null }),
  signInWithPassword: async () => ({ data: { session: null, user: null }, error: null }),
  signUp: async () => ({ data: { session: null, user: null }, error: null }),
  resetPasswordForEmail: async () => ({ data: {}, error: null }),
  updateUser: async () => ({ data: { user: null }, error: null }),
  exchangeCodeForSession: async () => ({ data: { session: null, user: null }, error: null }),
  admin: {
    listUsers: async () => ({ data: { users: [] }, error: null }),
    getUserById: async () => ({ data: { user: null }, error: null }),
    updateUserById: async () => ({ data: { user: null }, error: null }),
    deleteUser: async () => ({ data: { user: null }, error: null }),
  },
};

const noopClient = {
  auth: noopAuth,
  from: () => noopBuilder,
  rpc: async () => singleResult(),
  storage: { from: () => noopBuilder },
  channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} }),
  removeChannel: () => {},
  getChannels: () => [],
  schema: () => noopClient,
} as unknown as SupabaseClient;

export const supabase: SupabaseClient = noopClient;
export const createSupabaseClient = (_accessToken?: string): SupabaseClient => noopClient;
export const createSupabaseAdminClient = (): SupabaseClient => noopClient;
