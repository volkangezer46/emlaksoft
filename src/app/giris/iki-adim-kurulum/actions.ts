"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { hashOtpForStorage, verifyOtpHash } from "@/lib/otp-hmac";
import { sendSignerSms } from "@/app/imza/_lib/sms";
import { now } from "@/lib/clock";
import {
  generateLoginCode,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MS,
  TWO_FACTOR_COOKIE,
  TWO_FACTOR_COOKIE_TTL_SECONDS,
  twoFactorBindingFromClaims,
  twoFactorCookieOptions,
  twoFactorCookieValue,
} from "@/lib/two-factor";
import { logLoginEvent } from "../_lib/login-events";
import { safeNextPath } from "@/lib/auth/safe-next";
import {
  deleteTotpFactors,
  hasVerifiedTotpFactor,
  issueTwoFactorSessionProof,
  replaceRecoveryCodes,
  claimsAreAal2,
} from "@/lib/two-factor-session";
import { logActivity } from "@/lib/activity";

/**
 * DG7 iki adımlı doğrulama KURULUMU (ofis politikası rolü için zorunlu kıldığında proxy buraya yönlendirir).
 * Telefon SAHİPLİĞİ önce doğrulanır: 1) numara kaydedilir ve koda SMS gider; 2) kod doğruysa SMS 2FA açılır ve bu
 * oturum doğrulanmış sayılır (es_2fa_ok + oturum kanıtı; dogrulama/actions.ts ile aynı bağlama). Yanlış numara
 * girilirse 2FA hiç açılmadığından kullanıcı kilitlenmez; numarayı düzeltip yeniden kod ister.
 */
export type SetupResult = { error?: string; sent?: true; masked?: string };

async function currentProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/giris");
  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("tenant_id, role, is_active, two_factor_sms, two_factor_version, phone")
    .eq("id", user.id)
    .maybeSingle();
  const tenantId = (user.app_metadata?.tenant_id as string | undefined) ?? null;
  const valid =
    !error &&
    profile?.is_active &&
    tenantId &&
    profile.tenant_id === tenantId &&
    profile.role === user.app_metadata?.role;
  return { supabase, admin, user, profile: valid ? profile : null, tenantId };
}

function mask(stored: string): string {
  const digits = stored.replace(/\D/g, "");
  return digits.length > 4 ? `${stored.slice(0, 3)}••• •• ${digits.slice(-2)}` : "•••";
}

/** 1. adım: numarayı kaydeder ve doğrulama kodunu SMS ile gönderir. */
export async function sendSetupCode(_prev: SetupResult, fd: FormData): Promise<SetupResult> {
  const { admin, user, profile, tenantId } = await currentProfile();
  if (!profile || !tenantId) return { error: "Hesap doğrulanamadı. Lütfen yeniden giriş yapın." };
  if (profile.two_factor_sms) return { error: "İki adımlı doğrulama zaten açık." };

  const parsed = parsePhoneStrict(String(fd.get("phone") ?? ""));
  if (!parsed.ok) return { error: parsed.error ?? "Geçerli bir cep telefonu numarası girin." };

  const { allowed } = await checkRateLimit(`2fa-setup-send:${user.id}`, { limit: 5, windowSec: 300, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok sık kod istendi. Lütfen birkaç dakika sonra tekrar deneyin." };

  if (parsed.stored !== profile.phone) {
    const { error: phoneError } = await admin
      .from("profiles")
      .update({ phone: parsed.stored })
      .eq("id", user.id)
      .eq("tenant_id", tenantId)
      .eq("is_active", true);
    if (phoneError) return { error: "Telefon kaydedilemedi. Lütfen tekrar deneyin." };
  }

  const code = generateLoginCode();
  let codeHash: string;
  try {
    codeHash = hashOtpForStorage(code, "login", user.id);
  } catch {
    return { error: "Kod güvenli şekilde oluşturulamadı. Lütfen yöneticinize başvurun." };
  }
  await admin.from("login_challenges").delete().eq("user_id", user.id);
  const { error: chError } = await admin.from("login_challenges").insert({
    user_id: user.id,
    code_hash: codeHash,
    expires_at: new Date(now() + LOGIN_CODE_TTL_MS).toISOString(),
  });
  if (chError) return { error: "Kod oluşturulamadı. Lütfen tekrar deneyin." };

  const sms = await sendSignerSms(tenantId, parsed.stored, `EmlakSoft doğrulama kodunuz: ${code}`, { source: "two_factor_setup", audience: "office" });
  if (!sms.ok) {
    await admin.from("login_challenges").delete().eq("user_id", user.id);
    return { error: "SMS gönderilemedi. Numarayı kontrol edin ya da ofis sahibinize SMS ayarını sorun." };
  }
  await logLoginEvent({
    userId: user.id,
    tenantId,
    ip: await clientIp(),
    userAgent: (await headers()).get("user-agent"),
    result: "2fa_pending",
  });
  return { sent: true, masked: mask(parsed.stored) };
}

/** 2. adım: kod doğruysa SMS 2FA açılır, bu oturum doğrulanmış sayılır ve kullanıcı kaldığı yere döner. */
export async function confirmSetupCode(_prev: SetupResult, fd: FormData): Promise<SetupResult> {
  const code = String(fd.get("code") ?? "").replace(/\D/g, "");
  const rawNext = String(fd.get("next") ?? "/app");
  const next = safeNextPath(rawNext);
  if (!/^\d{6}$/.test(code)) return { error: "6 haneli doğrulama kodunu girin.", sent: true };

  const { supabase, admin, user, profile, tenantId } = await currentProfile();
  if (!profile || !tenantId) return { error: "Hesap doğrulanamadı. Lütfen yeniden giriş yapın." };
  if (!profile.phone) return { error: "Önce telefon numaranızı girip kod isteyin." };

  const { allowed } = await checkRateLimit(`2fa-verify:${user.id}`, { limit: 15, windowSec: 60, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.", sent: true };

  const { data: challenge } = await admin
    .from("login_challenges")
    .select("id, code_hash, expires_at, attempts")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!challenge) return { error: "Bekleyen doğrulama kodu yok. Yeni kod isteyin." };
  if (new Date(challenge.expires_at).getTime() < now()) return { error: "Kodun süresi doldu. Yeni kod isteyin." };
  if (challenge.attempts >= LOGIN_CODE_MAX_ATTEMPTS) return { error: "Çok fazla hatalı deneme. Yeni kod isteyin." };

  let matches: boolean;
  try {
    matches = verifyOtpHash(code, challenge.code_hash, "login", user.id);
  } catch {
    return { error: "Doğrulama güvenli şekilde tamamlanamadı. Lütfen yöneticinize başvurun." };
  }
  // Deneme hakkı karşılaştırmadan ÖNCE atomik tüketilir (paralel istekle sınır aşılamaz).
  const { data: consumed } = await admin
    .from("login_challenges")
    .update({ attempts: challenge.attempts + 1 })
    .eq("id", challenge.id)
    .eq("attempts", challenge.attempts)
    .select("id")
    .maybeSingle();
  if (!consumed) return { error: "Eşzamanlı deneme algılandı. Lütfen tekrar deneyin.", sent: true };
  if (!matches) {
    const remaining = LOGIN_CODE_MAX_ATTEMPTS - challenge.attempts - 1;
    return { error: remaining > 0 ? `Kod hatalı. Kalan deneme hakkı: ${remaining}` : "Kod hatalı. Yeni kod isteyin.", sent: true };
  }

  // Telefon doğrulandı: 2FA açılır (tetik two_factor_version'ı artırır; bağlama yeni sürümle kurulur).
  const { data: enabled, error: enableError } = await admin
    .from("profiles")
    .update({ two_factor_sms: true, two_factor_method: "sms" })
    .eq("id", user.id)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .select("two_factor_version")
    .maybeSingle();
  if (enableError || !enabled) return { error: "İki adımlı doğrulama açılamadı. Lütfen tekrar deneyin." };

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const binding = claimsError ? null : twoFactorBindingFromClaims(user.id, enabled.two_factor_version, claimsData?.claims);
  await admin.from("login_challenges").delete().eq("user_id", user.id);
  const jar = await cookies();
  if (!binding) {
    // Bağlama kurulamadı: 2FA açık, normal doğrulama ekranı yeni kodla tamamlar.
    jar.delete(TWO_FACTOR_COOKIE);
    redirect(`/giris/dogrulama?next=${encodeURIComponent(next)}`);
  }
  let cookieValue: string;
  try {
    cookieValue = await twoFactorCookieValue(binding);
  } catch {
    redirect(`/giris/dogrulama?next=${encodeURIComponent(next)}`);
  }
  const verifiedAtMs = now();
  const sessionExpiresAtMs = binding.sessionExpiresAt ? binding.sessionExpiresAt * 1000 : verifiedAtMs + TWO_FACTOR_COOKIE_TTL_SECONDS * 1000;
  const expiresAtMs = Math.min(verifiedAtMs + TWO_FACTOR_COOKIE_TTL_SECONDS * 1000, sessionExpiresAtMs);
  const { error: proofError } =
    expiresAtMs > verifiedAtMs
      ? await admin.from("two_factor_verified_sessions").upsert(
          {
            session_id: binding.sessionId,
            user_id: user.id,
            profile_version: binding.profileVersion,
            verified_at: new Date(verifiedAtMs).toISOString(),
            expires_at: new Date(expiresAtMs).toISOString(),
          },
          { onConflict: "session_id" },
        )
      : { error: { message: "expired" } };
  if (proofError) redirect(`/giris/dogrulama?next=${encodeURIComponent(next)}`);
  jar.set(TWO_FACTOR_COOKIE, cookieValue, twoFactorCookieOptions());
  redirect(next);
}

export type SetupTotpResult = { error?: string; ok?: true; codes?: string[] };

/** Authenticator kurulumu öncesi: 2FA henüz kapalıyken eski/yarım TOTP faktörleri temizlenir. */
export async function prepareSetupTotp(): Promise<SetupTotpResult> {
  const { admin, user, profile, tenantId } = await currentProfile();
  if (!profile || !tenantId) return { error: "Hesap doğrulanamadı. Lütfen yeniden giriş yapın." };
  if (profile.two_factor_sms) return { error: "İki adımlı doğrulama zaten açık." };
  const { ok } = await deleteTotpFactors(admin, user.id);
  return ok ? { ok: true } : { error: "Authenticator kurulumu hazırlanamadı. Lütfen tekrar deneyin." };
}

/**
 * Authenticator kodu istemcide doğrulandıktan (AAL2) sonra: 2FA yöntemi TOTP olarak açılır, 10 kurtarma kodu üretilir
 * ve bu oturum doğrulanmış sayılır (proxy kurulum kapısı ile 2FA kapısını birlikte geçer).
 */
export async function activateSetupTotp(): Promise<SetupTotpResult> {
  const { supabase, admin, user, profile, tenantId } = await currentProfile();
  if (!profile || !tenantId) return { error: "Hesap doğrulanamadı. Lütfen yeniden giriş yapın." };
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsError ? null : ((claimsData?.claims as Record<string, unknown> | undefined) ?? null);
  if (!claimsAreAal2(claims) || !(await hasVerifiedTotpFactor(admin, user.id))) {
    return { error: "Authenticator doğrulaması tamamlanmadı. Kodu yeniden girin." };
  }
  const { data: enabled, error } = await admin
    .from("profiles")
    .update({ two_factor_sms: true, two_factor_method: "totp" })
    .eq("id", user.id)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .select("two_factor_version")
    .maybeSingle();
  if (error || !enabled) return { error: "İki adımlı doğrulama açılamadı. Lütfen tekrar deneyin." };

  const recovery = await replaceRecoveryCodes(admin, user.id);
  if (!recovery.ok) return { error: recovery.error };
  await admin.from("login_challenges").delete().eq("user_id", user.id);
  const proof = await issueTwoFactorSessionProof({ claims, admin, userId: user.id, profileVersion: enabled.two_factor_version });
  // Kanıt yazılamazsa 2FA yine açıktır: kodlar gösterilir, proxy kullanıcıyı normal doğrulama ekranına götürür.
  if (!proof.ok) console.error("activateSetupTotp proof", proof.error);
  await logActivity({
    tenantId,
    actorId: user.id,
    action: "security.two_factor_totp_enabled",
    entityType: "profile",
    entityId: user.id,
  });
  return { ok: true, codes: recovery.codes };
}
