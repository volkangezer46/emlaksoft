export type SupabaseKeyEnvironment = Readonly<Record<string, string | undefined>>;

/** Prefer the independently rotatable publishable key; legacy anon is fallback only. */
export function resolveSupabasePublicKey(
  env?: SupabaseKeyEnvironment,
): string | undefined {
  const publishable = env
    ? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const legacyAnon = env
    ? env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return publishable?.trim()
    || legacyAnon?.trim()
    || undefined;
}
