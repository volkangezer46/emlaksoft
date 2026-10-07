import { cache } from "react";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { AUTH_VERIFIED_HEADER, userFromClaims } from "@/lib/supabase/verified-request";

/**
 * Request başına TEK kimlik çözümü.
 *
 * Varsayılan: `auth.getUser()` (Supabase Auth sunucusuna ağ turu). Proxy aynı istekte ağ doğrulamasını ve aktif profil /
 * askıya alma / 2FA kapılarını geçirdiyse `AUTH_VERIFIED_HEADER` koyar; o zaman ikinci ağ turu yerine `getClaims()` ile
 * JWKS (ES256) yerel doğrulaması yapılır (bkz. `verified-request.ts`). İşaret yoksa (/api yolları, bayat token,
 * simetrik anahtar) davranış eskisiyle aynıdır. React `cache()` ile istek başına bir kez çalışır.
 */
export const getRequestUser = cache(async () => {
  const supabase = await createClient();
  let verifiedId: string | null = null;
  try {
    verifiedId = (await headers()).get(AUTH_VERIFIED_HEADER);
  } catch {
    verifiedId = null;
  }
  if (verifiedId) {
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims as Record<string, unknown> | undefined;
    if (!error && claims && claims.sub === verifiedId) {
      const user = userFromClaims(claims);
      if (user) return user;
    }
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
