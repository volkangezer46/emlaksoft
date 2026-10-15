import "server-only";
import { cookies } from "next/headers";
import type { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import {
  TWO_FACTOR_COOKIE,
  TWO_FACTOR_COOKIE_TTL_SECONDS,
  twoFactorBindingFromClaims,
  twoFactorCookieOptions,
  twoFactorCookieValue,
} from "@/lib/two-factor";
import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/two-factor-recovery";

type AdminClient = ReturnType<typeof createAdminClient>;

export type TwoFactorMethod = "sms" | "totp";

export function isTwoFactorMethod(value: unknown): value is TwoFactorMethod {
  return value === "sms" || value === "totp";
}

/**
 * Bu Supabase oturumunu 2FA tamamlanmış sayar: oturuma + profil 2FA sürümüne bağlı imzalı çerez (proxy/kimlik kapısı)
 * ve aynı bağlamayla DB kanıtı (RLS `current_session_two_factor_satisfied`). SMS kodu, authenticator ve kurtarma kodu
 * yolları bu TEK yardımcıyı kullanır (dogrulama/actions.ts SMS yolu ile aynı bağlama kuralları).
 */
export async function issueTwoFactorSessionProof(input: {
  /** Çağıranın bu istekte doğruladığı JWT claim'leri (bu modül Auth sunucusuna tur atmaz). */
  claims: Record<string, unknown> | null | undefined;
  admin: AdminClient;
  userId: string;
  profileVersion: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const binding = input.claims ? twoFactorBindingFromClaims(input.userId, input.profileVersion, input.claims) : null;
  if (!binding) return { ok: false, error: "Oturum doğrulanamadı. Lütfen yeniden giriş yapın." };

  let cookieValue: string;
  try {
    cookieValue = await twoFactorCookieValue(binding);
  } catch (cookieError) {
    console.error("issueTwoFactorSessionProof cookie", cookieError instanceof Error ? cookieError.message : cookieError);
    return { ok: false, error: "İki adımlı doğrulama güvenli şekilde tamamlanamadı." };
  }

  const verifiedAtMs = now();
  const sessionExpiresAtMs = binding.sessionExpiresAt
    ? binding.sessionExpiresAt * 1000
    : verifiedAtMs + TWO_FACTOR_COOKIE_TTL_SECONDS * 1000;
  const expiresAtMs = Math.min(verifiedAtMs + TWO_FACTOR_COOKIE_TTL_SECONDS * 1000, sessionExpiresAtMs);
  if (expiresAtMs <= verifiedAtMs) return { ok: false, error: "Oturumun süresi doldu. Lütfen yeniden giriş yapın." };

  const { error: proofError } = await input.admin.from("two_factor_verified_sessions").upsert(
    {
      session_id: binding.sessionId,
      user_id: input.userId,
      profile_version: binding.profileVersion,
      verified_at: new Date(verifiedAtMs).toISOString(),
      expires_at: new Date(expiresAtMs).toISOString(),
    },
    { onConflict: "session_id" },
  );
  if (proofError) {
    console.error("issueTwoFactorSessionProof proof", proofError.message);
    return { ok: false, error: "İki adımlı doğrulama güvenli şekilde tamamlanamadı." };
  }
  (await cookies()).set(TWO_FACTOR_COOKIE, cookieValue, twoFactorCookieOptions());
  return { ok: true };
}

/** Oturum authenticator ile AAL2'ye yükseltilmiş mi (çağıranın doğruladığı JWT claim'inden). */
export function claimsAreAal2(claims: Record<string, unknown> | null | undefined): boolean {
  return claims?.aal === "aal2";
}

/** Kullanıcının doğrulanmış TOTP faktörü var mı (admin API; oturum düzeyinden bağımsız). */
export async function hasVerifiedTotpFactor(admin: AdminClient, userId: string): Promise<boolean> {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) return false;
  return (data?.factors ?? []).some((f) => f.factor_type === "totp" && f.status === "verified");
}

/** Kullanıcının TÜM TOTP faktörlerini siler (yöntem SMS'e döndüğünde / kapatıldığında / yeniden kurulumda). */
export async function deleteTotpFactors(admin: AdminClient, userId: string): Promise<{ ok: boolean }> {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) return { ok: false };
  let ok = true;
  for (const factor of data?.factors ?? []) {
    if (factor.factor_type !== "totp") continue;
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (deleteError) ok = false;
  }
  return { ok };
}

/** Yeni 10'lu kurtarma seti üretir (eskiler silinir); düz kodlar YALNIZ bir kez, çağırana döner. */
export async function replaceRecoveryCodes(
  admin: AdminClient,
  userId: string,
): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  const codes = generateRecoveryCodes();
  let rows: { user_id: string; code_hash: string }[];
  try {
    rows = codes.map((code) => ({ user_id: userId, code_hash: hashRecoveryCode(code, userId) }));
  } catch {
    return { ok: false, error: "Kurtarma kodları güvenli şekilde oluşturulamadı. Lütfen yöneticinize başvurun." };
  }
  const { error: deleteError } = await admin.from("two_factor_recovery_codes").delete().eq("user_id", userId);
  if (deleteError) return { ok: false, error: "Kurtarma kodları yenilenemedi. Lütfen tekrar deneyin." };
  const { error: insertError } = await admin.from("two_factor_recovery_codes").insert(rows);
  if (insertError) return { ok: false, error: "Kurtarma kodları kaydedilemedi. Lütfen tekrar deneyin." };
  return { ok: true, codes };
}

export async function countUnusedRecoveryCodes(admin: AdminClient, userId: string): Promise<number> {
  const { count } = await admin
    .from("two_factor_recovery_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("used_at", null);
  return count ?? 0;
}
