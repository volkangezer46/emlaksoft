import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { resolveSupabasePublicKey, supabaseAuthCookieName } from "./keys";
import { guardedFetch } from "./fetch-guard";

/**
 * Sunucu (RSC / server action / route) istemcisi. URL genel köktür; taşıma `guardedFetch` ile isteğe bağlı iç ağdan gider
 * (`SUPABASE_INTERNAL_URL`, PERF-3). Çerez adı genel URL'den sabitlenir (`supabaseAuthCookieName`): oturumlar korunur.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const cookieName = supabaseAuthCookieName();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    resolveSupabasePublicKey()!,
    {
      global: { fetch: guardedFetch },
      ...(cookieName ? { cookieOptions: { name: cookieName } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component — cookie set ignore
          }
        },
      },
    },
  );
}
