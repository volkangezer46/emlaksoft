import { createClient } from "@supabase/supabase-js";
import { guardedFetch } from "./fetch-guard";

/** Prefer independently rotatable Supabase secret keys; legacy JWT is fallback only. */
export function resolveSupabaseAdminKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  return env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined;
}

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = resolveSupabaseAdminKey();

  if (!url || !key) {
    throw new Error("Supabase admin env eksik (URL / SECRET_KEY)");
  }

  return createClient(url, key, {
    global: { fetch: guardedFetch },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
