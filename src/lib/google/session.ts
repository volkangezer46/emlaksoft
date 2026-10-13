import "server-only";
import { derivePlatformHmac } from "@/lib/platform-secrets";
import { createClient } from "@/lib/supabase/server";
import type { StateBinding, StateSigner } from "./state";

/**
 * OAuth akışının oturum bağı (sunucu). `state` personel kimliği + Supabase oturum kimliğine (JWT `session_id`) bağlanır;
 * imza platform sırrından alan-ayrımlı türetilir. Anahtar yoksa imzalayıcı null döner → bağlama reddedilir.
 */

export const GOOGLE_PKCE_COOKIE = "es_google_pkce";
export const GOOGLE_CALLBACK_PATH = "/api/admin/google/callback";

export const googleStateSigner: StateSigner = (input) => derivePlatformHmac("google-oauth-state", input);

export async function currentSessionBinding(staffId: string): Promise<StateBinding | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims as Record<string, unknown> | undefined;
    if (error || !claims || claims.sub !== staffId) return null;
    const sessionId = typeof claims.session_id === "string" ? claims.session_id : "";
    return sessionId ? { staffId, sessionId } : null;
  } catch {
    return null;
  }
}

export const PKCE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: GOOGLE_CALLBACK_PATH,
  maxAge: 600,
};
