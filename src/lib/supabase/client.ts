import { createBrowserClient } from "@supabase/ssr";
import { resolveSupabasePublicKey } from "./keys";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    resolveSupabasePublicKey()!,
  );
}
