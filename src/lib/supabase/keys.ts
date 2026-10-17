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

/**
 * Oturum çerezinin adı (PERF-3): supabase-js varsayılanıyla BİREBİR aynı türetim (`sb-<genel URL alt alanı>-auth-token`,
 * ör. https://api.emlaksoft.com.tr → `sb-api-auth-token`). Sunucu istemcileri bunu `cookieOptions.name` ile sabitler:
 * istemci URL'i ileride iç adrese çevrilse de çerez adı (ve mevcut oturumlar) değişmez. URL yoksa / bozuksa undefined
 * (supabase-js kendi varsayılanına döner).
 */
export function supabaseAuthCookieName(url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    return `sb-${new URL(url.trim()).hostname.split(".")[0]}-auth-token`;
  } catch {
    return undefined;
  }
}
