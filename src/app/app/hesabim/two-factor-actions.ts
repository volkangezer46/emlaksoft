"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNetgsmConfig } from "@/lib/messaging/netgsm";
import { getTenantNetgsmConfig } from "@/lib/messaging/tenant-providers";
import { TWO_FACTOR_COOKIE } from "@/lib/two-factor";
import { requireActiveTenant } from "@/lib/tenant-guard";
import { readOfficeSecurityPolicyCached } from "@/lib/office-security/policy-cache";
import { logActivity } from "@/lib/activity";
import {
  countUnusedRecoveryCodes,
  deleteTotpFactors,
  hasVerifiedTotpFactor,
  issueTwoFactorSessionProof,
  replaceRecoveryCodes,
  claimsAreAal2,
} from "@/lib/two-factor-session";

export type TwoFactorToggleResult = { error?: string; ok?: true };

export async function setTwoFactorSms(
  _prev: TwoFactorToggleResult,
  fd: FormData,
): Promise<TwoFactorToggleResult> {
  const enable = String(fd.get("enable") ?? "") === "1";
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== gate.userId) return { error: "Oturum bulunamadi." };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("phone, tenant_id, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_active || profile.tenant_id !== gate.tenantId) {
    return { error: "Aktif kullanici profili dogrulanamadi." };
  }

  // DG7: ofis politikası bu rol için 2FA'yı zorunlu kıldıysa kapatılamaz (kapatılsa proxy kurulum ekranına döndürürdü).
  if (!enable) {
    const policy = await readOfficeSecurityPolicyCached(gate.tenantId);
    if (policy && policy.mfaRoles.includes(gate.role)) {
      return { error: "Ofisinizin güvenlik politikası rolünüz için iki adımlı doğrulamayı zorunlu kılıyor; kapatılamaz." };
    }
  }

  if (enable) {
    if (!profile.phone) {
      return { error: "Iki adimli dogrulama icin once profilinize telefon ekleyin." };
    }
    const tenantCfg = await getTenantNetgsmConfig(profile.tenant_id);
    const smsReady = tenantCfg !== null || (await getNetgsmConfig()) !== null;
    if (!smsReady) {
      return { error: "SMS servisi yapilandirilmamis. Ayarlar > Entegrasyonlar bolumunu kontrol edin." };
    }
  }

  // SMS'e geçiş ya da kapatma: yöntem 'sms' olur; authenticator faktörleri ve kurtarma kodları temizlenir.
  const { error } = await admin
    .from("profiles")
    .update({ two_factor_sms: enable, two_factor_method: "sms" })
    .eq("id", user.id)
    .eq("tenant_id", gate.tenantId)
    .eq("is_active", true);
  if (error) {
    console.error("setTwoFactorSms", error);
    return { error: "Ayar kaydedilemedi. Lutfen tekrar deneyin." };
  }
  await deleteTotpFactors(admin, user.id);
  await admin.from("two_factor_recovery_codes").delete().eq("user_id", user.id);
  await logActivity({
    tenantId: gate.tenantId,
    actorId: user.id,
    action: enable ? "security.two_factor_sms_enabled" : "security.two_factor_disabled",
    entityType: "profile",
    entityId: user.id,
  });

  // Migration trigger'i profil 2FA surumunu artirir. Mevcut oturum otomatik
  // dogrulanmis sayilmaz; enable sonrasi yeni SMS kodu gerekir.
  (await cookies()).delete(TWO_FACTOR_COOKIE);
  revalidatePath("/app/hesabim");
  return { ok: true };
}

export type TotpActionResult = { error?: string; ok?: true; codes?: string[] };

async function totpContext() {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error } as const;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== gate.userId) return { error: "Oturum bulunamadı." } as const;
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("tenant_id, is_active, two_factor_sms, two_factor_method")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_active || profile.tenant_id !== gate.tenantId) {
    return { error: "Aktif kullanıcı profili doğrulanamadı." } as const;
  }
  const totpActive = Boolean(profile.two_factor_sms) && profile.two_factor_method === "totp";
  return { gate, supabase, admin, user, totpActive } as const;
}

/**
 * Authenticator kurulumundan ÖNCE: yöntem henüz TOTP değilse eski/yarım faktörler silinir (aynı adla ikinci faktör
 * GoTrue'da reddedilir; doğrulanmış eski faktör varken yeni kayıt AAL2 ister). Açık TOTP'ye dokunulmaz.
 */
export async function prepareTotpEnrollment(): Promise<TotpActionResult> {
  const ctx = await totpContext();
  if ("error" in ctx) return { error: ctx.error };
  if (ctx.totpActive) return { error: "Authenticator ile doğrulama zaten açık." };
  const { ok } = await deleteTotpFactors(ctx.admin, ctx.user.id);
  if (!ok) return { error: "Authenticator kurulumu hazırlanamadı. Lütfen tekrar deneyin." };
  return { ok: true };
}

/**
 * Authenticator kodu istemcide doğrulandıktan (oturum AAL2) SONRA: 2FA yöntemi TOTP olur, 10 kurtarma kodu üretilir
 * (yalnız bu yanıtta, bir kez gösterilir) ve bu oturum yeni 2FA sürümüyle doğrulanmış sayılır.
 */
export async function activateTotpTwoFactor(): Promise<TotpActionResult> {
  const ctx = await totpContext();
  if ("error" in ctx) return { error: ctx.error };
  const { gate, supabase, admin, user } = ctx;
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsError ? null : ((claimsData?.claims as Record<string, unknown> | undefined) ?? null);
  if (!claimsAreAal2(claims) || !(await hasVerifiedTotpFactor(admin, user.id))) {
    return { error: "Authenticator doğrulaması tamamlanmadı. Kodu yeniden girin." };
  }

  const { data: updated, error } = await admin
    .from("profiles")
    .update({ two_factor_sms: true, two_factor_method: "totp" })
    .eq("id", user.id)
    .eq("tenant_id", gate.tenantId)
    .eq("is_active", true)
    .select("two_factor_version")
    .maybeSingle();
  if (error || !updated) {
    console.error("activateTotpTwoFactor", error?.message);
    return { error: "Ayar kaydedilemedi. Lütfen tekrar deneyin." };
  }

  const recovery = await replaceRecoveryCodes(admin, user.id);
  if (!recovery.ok) return { error: recovery.error };
  await admin.from("login_challenges").delete().eq("user_id", user.id);

  const proof = await issueTwoFactorSessionProof({ claims, admin, userId: user.id, profileVersion: updated.two_factor_version });
  if (!proof.ok) (await cookies()).delete(TWO_FACTOR_COOKIE);

  await logActivity({
    tenantId: gate.tenantId,
    actorId: user.id,
    action: "security.two_factor_totp_enabled",
    entityType: "profile",
    entityId: user.id,
  });
  revalidatePath("/app/hesabim");
  return { ok: true, codes: recovery.codes };
}

/** Yeni kurtarma seti (eskiler geçersiz olur). Yalnız authenticator yöntemi açıkken. */
export async function regenerateRecoveryCodes(): Promise<TotpActionResult> {
  const ctx = await totpContext();
  if ("error" in ctx) return { error: ctx.error };
  if (!ctx.totpActive) return { error: "Kurtarma kodları yalnız authenticator ile doğrulamada kullanılır." };
  const recovery = await replaceRecoveryCodes(ctx.admin, ctx.user.id);
  if (!recovery.ok) return { error: recovery.error };
  await logActivity({
    tenantId: ctx.gate.tenantId,
    actorId: ctx.user.id,
    action: "security.recovery_codes_regenerated",
    entityType: "profile",
    entityId: ctx.user.id,
  });
  revalidatePath("/app/hesabim");
  return { ok: true, codes: recovery.codes };
}

/** Hesabım güvenlik kartı için kalan kurtarma kodu sayısı. */
export async function unusedRecoveryCodeCount(): Promise<number> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return 0;
  return countUnusedRecoveryCodes(createAdminClient(), gate.userId);
}
