import { cache } from "react";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  AUTH_VERIFIED_HEADER,
  readVerifiedRequest,
  userFromClaims,
  verifyAccessToken,
  type AuthClaims,
  type AuthVerifier,
  type VerifiedFacts,
} from "@/lib/supabase/verified-request";
import { now } from "@/lib/clock";

/**
 * Request başına TEK kimlik çözümü (SK1/B019; ayrıntı verified-request.ts).
 *
 * Proxy aynı istekte JWT'yi yerel doğrulayıp oturum canlılığı + aktif profil / askı / 2FA kapılarını geçirdiyse
 * doğrulanmış claim'leri İMZALI `AUTH_VERIFIED_HEADER` ile taşır: burada YENİDEN doğrulama yapılmaz (Auth sunucusuna ağ
 * turu yok, getClaims/getUser çağrılmaz). Başlık yoksa ya da imzası tutmuyorsa (proxy dışı /api yolları, sır
 * tanımsız) yedek yol: çerezdeki erişim belirteci `getUser` ile doğrulanır, sonuç belirteç özetiyle süreç içinde
 * ≤60 sn önbelleklidir (iptal edilen oturum en geç 60 sn içinde reddedilir). React `cache()` ile istek başına bir kez.
 */
const resolveRequestAuth = cache(async (): Promise<{ claims: AuthClaims | null; facts: VerifiedFacts }> => {
  let headerValue: string | null = null;
  try {
    headerValue = (await headers()).get(AUTH_VERIFIED_HEADER);
  } catch {
    headerValue = null;
  }
  const fromHeader = headerValue ? await readVerifiedRequest(headerValue, now()) : null;
  if (fromHeader) return fromHeader;

  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return { claims: null, facts: {} };
  const verified = await verifyAccessToken(supabase.auth as unknown as AuthVerifier, token, { nowMs: now(), mode: "network" });
  return { claims: verified?.claims ?? null, facts: {} };
});

/** Doğrulanmış JWT claim'leri (session_id, aal, amr, app_metadata…); oturum yoksa null. */
export const getRequestClaims = cache(async (): Promise<AuthClaims | null> => (await resolveRequestAuth()).claims);

/**
 * Proxy'nin bu istekte gördüğü "aktif platform personeli mi" olgusu; bilinmiyorsa (başlık yok) null. YALNIZ "personel
 * değil" kısayolu içindir (platform_staff okuması atlanır); personel yetkisi her zaman kendi sorgusuyla kurulur.
 */
export const getRequestStaffFact = cache(async (): Promise<boolean | null> => {
  const { facts } = await resolveRequestAuth();
  return typeof facts.staff === "boolean" ? facts.staff : null;
});

export const getRequestUser = cache(async () => {
  const claims = await getRequestClaims();
  return claims ? userFromClaims(claims) : null;
});
