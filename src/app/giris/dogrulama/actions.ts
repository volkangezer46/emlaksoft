"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
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
import { hashOtpForStorage, verifyOtpHash } from "@/lib/otp-hmac";
import { sendSignerSms } from "@/app/imza/_lib/sms";
import { sendSms } from "@/lib/messaging/netgsm";
import { logLoginEvent } from "../_lib/login-events";
import { OFFICE_IP_LOGIN_ERROR, officeLoginIpAllowed } from "@/lib/office-security/enforce";
import { safeNextPath } from "@/lib/auth/safe-next";
import { afterSafe } from "@/lib/after-safe";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { recordLoginAudit } from "@/lib/office-security/new-device";
import { claimsAreAal2, countUnusedRecoveryCodes, issueTwoFactorSessionProof } from "@/lib/two-factor-session";
import { hashRecoveryCode, normalizeRecoveryCode } from "@/lib/two-factor-recovery";

export type VerifyResult = { error?: string; ok?: true; resent?: true; next?: string };

/**
 * SMS ile gönderilen 6 haneli giriş kodunu doğrular. Doğruysa es_2fa_ok
 * çerezi set edilir ve middleware panel erişimini açar. 5 hatalı denemede
 * kod geçersiz sayılır (yeni kod istenmeli).
 */
export async function verifyLoginCode(
  _prev: VerifyResult,
  fd: FormData,
): Promise<VerifyResult> {
  const code = String(fd.get("code") ?? "").replace(/\D/g, "");
  const rawNext = String(fd.get("next") ?? "/app");
  // Açık yönlendirme koruması: tek süzgeç (kontrol karakteri, ters bölü, %XX kaçışı ve origin denetimi).
  const next = safeNextPath(rawNext);
  if (!/^\d{6}$/.test(code)) return { error: "6 haneli doğrulama kodunu girin." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/giris");

  const ip = await clientIp();
  const userAgent = (await headers()).get("user-agent");
  const tenantId = (user.app_metadata?.tenant_id as string | undefined) ?? null;

  const { allowed } = await checkRateLimit(`2fa-verify:${user.id}`, {
    limit: 15,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const [{ data: challenge }, { data: profile, error: profileError }] = await Promise.all([
    admin
      .from("login_challenges")
      .select("id, code_hash, expires_at, attempts")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("tenant_id, role, is_active, two_factor_sms, two_factor_method, two_factor_version, phone")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  if (
    profileError ||
    !profile?.is_active ||
    !profile.two_factor_sms ||
    profile.two_factor_method === "totp" ||
    !profile.phone ||
    profile.tenant_id !== tenantId ||
    profile.role !== user.app_metadata?.role
  ) {
    await supabase.auth.signOut();
    (await cookies()).delete(TWO_FACTOR_COOKIE);
    return { error: "Hesap veya iki adımlı doğrulama ayarı geçersiz." };
  }

  // DG7: kod adımında da ofis IP kısıtı (giriş ile kod arasında ağ değişmiş olabilir); oturum açık bırakılmaz.
  if (!(await officeLoginIpAllowed({ tenantId, role: profile.role, headers: await headers() }))) {
    await supabase.auth.signOut();
    (await cookies()).delete(TWO_FACTOR_COOKIE);
    await logLoginEvent({ userId: user.id, tenantId, ip, userAgent, result: "failed" });
    return { error: OFFICE_IP_LOGIN_ERROR };
  }

  if (!challenge) return { error: "Bekleyen doğrulama kodu yok. Yeni kod isteyin." };
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    return { error: "Kodun süresi doldu. Lütfen yeni kod isteyin." };
  }
  if (challenge.attempts >= LOGIN_CODE_MAX_ATTEMPTS) {
    return { error: "Çok fazla hatalı deneme. Lütfen yeni kod isteyin." };
  }

  let codeMatches: boolean;
  try {
    codeMatches = verifyOtpHash(code, challenge.code_hash, "login", user.id);
  } catch (hashError) {
    console.error("verifyLoginCode OTP configuration", {
      error: hashError instanceof Error ? hashError.name : "unknown",
    });
    return { error: "Doğrulama güvenli şekilde tamamlanamadı. Lütfen yöneticinize başvurun." };
  }

  // Deneme hakkı HASH kontrolünden ÖNCE atomik tüketilir (optimistic lock):
  // paralel isteklerle sayaç yarışı 5 deneme sınırını aşamaz.
  const { data: consumed } = await admin
    .from("login_challenges")
    .update({ attempts: challenge.attempts + 1 })
    .eq("id", challenge.id)
    .eq("attempts", challenge.attempts)
    .select("id")
    .maybeSingle();
  if (!consumed) {
    return { error: "Eşzamanlı deneme algılandı. Lütfen tekrar deneyin." };
  }

  if (!codeMatches) {
    await logLoginEvent({ userId: user.id, tenantId, ip, userAgent, result: "2fa_failed" });
    const remaining = LOGIN_CODE_MAX_ATTEMPTS - challenge.attempts - 1;
    return {
      error:
        remaining > 0
          ? `Kod hatalı. Kalan deneme hakkı: ${remaining}`
          : "Kod hatalı. Deneme hakkı bitti — yeni kod isteyin.",
    };
  }

  // Doğru kod: challenge temizlenir, çerez set edilir, giriş tamamlanır
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const binding = claimsError
    ? null
    : twoFactorBindingFromClaims(
        user.id,
        profile.two_factor_version,
        claimsData?.claims,
      );
  if (!binding) return { error: "Oturum doğrulanamadı. Lütfen yeniden giriş yapın." };

  let cookieValue: string;
  try {
    cookieValue = await twoFactorCookieValue(binding);
  } catch (cookieError) {
    console.error("verifyLoginCode cookie", cookieError);
    return { error: "İki adımlı doğrulama güvenli şekilde tamamlanamadı." };
  }

  // PostgREST/RLS cannot inspect the HTTP-only cookie. Persist the same
  // session/version-bound proof through the service role so database access
  // also requires this exact Supabase session to have completed SMS 2FA.
  const verifiedAtMs = Date.now();
  const sessionExpiresAtMs = binding.sessionExpiresAt
    ? binding.sessionExpiresAt * 1000
    : verifiedAtMs + TWO_FACTOR_COOKIE_TTL_SECONDS * 1000;
  const expiresAtMs = Math.min(
    verifiedAtMs + TWO_FACTOR_COOKIE_TTL_SECONDS * 1000,
    sessionExpiresAtMs,
  );
  if (expiresAtMs <= verifiedAtMs) {
    return { error: "Oturumun süresi doldu. Lütfen yeniden giriş yapın." };
  }

  const { error: proofError } = await admin.from("two_factor_verified_sessions").upsert(
    {
      session_id: binding.sessionId,
      user_id: user.id,
      profile_version: binding.profileVersion,
      verified_at: new Date(verifiedAtMs).toISOString(),
      expires_at: new Date(expiresAtMs).toISOString(),
    },
    { onConflict: "session_id" },
  );
  if (proofError) {
    console.error("verifyLoginCode session proof", proofError);
    return { error: "İki adımlı doğrulama güvenli şekilde tamamlanamadı." };
  }

  await admin.from("login_challenges").delete().eq("user_id", user.id);
  (await cookies()).set(TWO_FACTOR_COOKIE, cookieValue, twoFactorCookieOptions());
  await logLoginEvent({ userId: user.id, tenantId, ip, userAgent, result: "success" });
  if (tenantId) {
    const acceptLanguage = (await headers()).get("accept-language");
    const auditTenantId = tenantId;
    const userId = user.id;
    afterSafe(() => recordLoginAudit({ tenantId: auditTenantId, userId, userAgent, acceptLanguage, ip, method: "two_factor" }), "auth.login");
  }

  redirect(next);
}

/** Yeni 6 haneli kod üretir ve kayıtlı telefona SMS ile gönderir. */
export async function resendLoginCode(
  _prev: VerifyResult,
  _fd: FormData,
): Promise<VerifyResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/giris");

  const { allowed } = await checkRateLimit(`2fa-send:${user.id}`, {
    limit: 5,
    windowSec: 300,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok sık kod istendi. Lütfen birkaç dakika sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("two_factor_sms, two_factor_method, phone, tenant_id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (
    !profile?.is_active ||
    !profile.two_factor_sms ||
    profile.two_factor_method === "totp" ||
    !profile.phone ||
    profile.tenant_id !== user.app_metadata?.tenant_id ||
    profile.role !== user.app_metadata?.role
  ) {
    return { error: "Bu hesap için SMS doğrulaması gerekli değil." };
  }

  const code = generateLoginCode();
  await admin.from("login_challenges").delete().eq("user_id", user.id);
  let codeHash: string;
  try {
    codeHash = hashOtpForStorage(code, "login", user.id);
  } catch (hashError) {
    console.error("resendLoginCode OTP configuration", {
      error: hashError instanceof Error ? hashError.name : "unknown",
    });
    return { error: "Kod güvenli şekilde oluşturulamadı. Lütfen yöneticinize başvurun." };
  }
  const { error: chError } = await admin.from("login_challenges").insert({
    user_id: user.id,
    code_hash: codeHash,
    expires_at: new Date(Date.now() + LOGIN_CODE_TTL_MS).toISOString(),
  });
  if (chError) {
    console.error("resendLoginCode challenge", chError);
    return { error: "Kod oluşturulamadı. Lütfen tekrar deneyin." };
  }

  const tenantId = (profile.tenant_id as string | null) ?? null;
  const text = `EmlakSoft giriş kodunuz: ${code}`;
  const LOGIN_OTP_LOG = { source: "login_otp", audience: "office" } as const;
  const sms = tenantId ? await sendSignerSms(tenantId, profile.phone, text, LOGIN_OTP_LOG) : await sendSms(profile.phone, text, LOGIN_OTP_LOG);
  if (!sms.ok) {
    console.error("resendLoginCode sms", sms.error);
    return { error: "SMS gönderilemedi. Lütfen tekrar deneyin." };
  }

  await logLoginEvent({
    userId: user.id,
    tenantId,
    ip: await clientIp(),
    userAgent: (await headers()).get("user-agent"),
    result: "2fa_pending",
  });
  return { ok: true, resent: true };
}

/** Doğrulamadan vazgeç — oturumu kapatır ve giriş sayfasına döner. */
export async function cancelLoginVerification(): Promise<void> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const sessionId = claimsData?.claims?.session_id;
  const userId = claimsData?.claims?.sub;
  if (typeof sessionId === "string" && sessionId && typeof userId === "string" && userId) {
    try {
      await createAdminClient()
        .from("two_factor_verified_sessions")
        .delete()
        .eq("session_id", sessionId)
        .eq("user_id", userId);
    } catch (proofError) {
      console.error("cancelLoginVerification clear session proof", proofError);
    }
  }
  await supabase.auth.signOut();
  (await cookies()).delete(TWO_FACTOR_COOKIE);
  redirect("/giris");
}

/**
 * Authenticator (TOTP) yöntemli ofis kullanıcısı için ortak giriş bağlamı: kanonik profil, kiracı/rol eşleşmesi ve
 * ofis IP kısıtı. Geçersizse oturum kapatılır (SMS yolu ile aynı kural).
 */
async function totpLoginContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/giris");
  const admin = createAdminClient();
  const tenantId = (user.app_metadata?.tenant_id as string | undefined) ?? null;
  const ip = await clientIp();
  const hdrs = await headers();
  const userAgent = hdrs.get("user-agent");
  const { data: profile, error } = await admin
    .from("profiles")
    .select("tenant_id, role, is_active, two_factor_sms, two_factor_method, two_factor_version")
    .eq("id", user.id)
    .maybeSingle();
  if (
    error ||
    !profile?.is_active ||
    !profile.two_factor_sms ||
    profile.two_factor_method !== "totp" ||
    profile.tenant_id !== tenantId ||
    profile.role !== user.app_metadata?.role
  ) {
    await supabase.auth.signOut();
    (await cookies()).delete(TWO_FACTOR_COOKIE);
    return { error: "Hesap veya iki adımlı doğrulama ayarı geçersiz." } as const;
  }
  if (!(await officeLoginIpAllowed({ tenantId, role: profile.role, headers: hdrs }))) {
    await supabase.auth.signOut();
    (await cookies()).delete(TWO_FACTOR_COOKIE);
    await logLoginEvent({ userId: user.id, tenantId, ip, userAgent, result: "failed" });
    return { error: OFFICE_IP_LOGIN_ERROR } as const;
  }
  return { supabase, admin, user, profile, tenantId, ip, userAgent } as const;
}

async function finishTotpLogin(
  ctx: Exclude<Awaited<ReturnType<typeof totpLoginContext>>, { error: string }>,
): Promise<VerifyResult> {
  const { data: claimsData, error: claimsError } = await ctx.supabase.auth.getClaims();
  const proof = await issueTwoFactorSessionProof({
    claims: claimsError ? null : ((claimsData?.claims as Record<string, unknown> | undefined) ?? null),
    admin: ctx.admin,
    userId: ctx.user.id,
    profileVersion: ctx.profile.two_factor_version,
  });
  if (!proof.ok) return { error: proof.error };
  await logLoginEvent({ userId: ctx.user.id, tenantId: ctx.tenantId, ip: ctx.ip, userAgent: ctx.userAgent, result: "success" });
  if (ctx.tenantId) {
    const acceptLanguage = (await headers()).get("accept-language");
    const auditTenantId = ctx.tenantId;
    const userId = ctx.user.id;
    const { userAgent, ip } = ctx;
    afterSafe(() => recordLoginAudit({ tenantId: auditTenantId, userId, userAgent, acceptLanguage, ip, method: "two_factor" }), "auth.login");
  }
  return { ok: true };
}

/**
 * Authenticator kodu istemcide (`supabase.auth.mfa.verify`) doğrulandıktan sonra çağrılır: oturumun gerçekten AAL2
 * olduğu SUNUCUDA doğrulanır, oturum kanıtı + çerez yazılır ve kullanıcı hedefe gider.
 */
export async function completeTotpLogin(rawNext: string): Promise<VerifyResult> {
  const next = safeNextPath(rawNext);
  const ctx = await totpLoginContext();
  if ("error" in ctx) return { error: ctx.error };
  const { data: claimsData, error: claimsError } = await ctx.supabase.auth.getClaims();
  if (claimsError || !claimsAreAal2(claimsData?.claims as Record<string, unknown> | undefined)) {
    await logLoginEvent({ userId: ctx.user.id, tenantId: ctx.tenantId, ip: ctx.ip, userAgent: ctx.userAgent, result: "2fa_failed" });
    return { error: "Authenticator doğrulaması tamamlanmadı. Kodu yeniden girin." };
  }
  const done = await finishTotpLogin(ctx);
  // İstemci doğrudan çağırdığı için yönlendirme istemcide yapılır (router.replace); hedef süzülmüş döner.
  return done.ok ? { ok: true, next } : done;
}

/** Telefonu yanında olmayan kullanıcı: tek kullanımlık kurtarma kodu (10 karakter) ile girişi tamamlar. */
export async function verifyRecoveryCode(_prev: VerifyResult, fd: FormData): Promise<VerifyResult> {
  const next = safeNextPath(String(fd.get("next") ?? "/app"));
  const normalized = normalizeRecoveryCode(String(fd.get("recovery_code") ?? ""));
  if (!normalized) return { error: "Kurtarma kodu 10 karakterdir (ör. ABCDE-FGHJK)." };

  const ctx = await totpLoginContext();
  if ("error" in ctx) return { error: ctx.error };

  const { allowed } = await checkRateLimit(`2fa-recovery:${ctx.user.id}`, { limit: 5, windowSec: 900, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok fazla deneme yapıldı. Lütfen 15 dakika sonra tekrar deneyin." };

  let codeHash: string;
  try {
    codeHash = hashRecoveryCode(normalized, ctx.user.id);
  } catch {
    return { error: "Doğrulama güvenli şekilde tamamlanamadı. Lütfen yöneticinize başvurun." };
  }
  // Tek kullanım: yalnız kullanılmamış kod, tek UPDATE ile atomik işaretlenir (paralel istekte ikinci istek boş döner).
  const { data: used, error } = await ctx.admin
    .from("two_factor_recovery_codes")
    .update({ used_at: new Date(now()).toISOString() })
    .eq("user_id", ctx.user.id)
    .eq("code_hash", codeHash)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (error || !used) {
    await logLoginEvent({ userId: ctx.user.id, tenantId: ctx.tenantId, ip: ctx.ip, userAgent: ctx.userAgent, result: "2fa_failed" });
    return { error: "Kurtarma kodu geçersiz ya da daha önce kullanılmış." };
  }
  if (ctx.tenantId) {
    const left = await countUnusedRecoveryCodes(ctx.admin, ctx.user.id);
    afterSafe(
      () =>
        logActivity({
          tenantId: ctx.tenantId!,
          actorId: ctx.user.id,
          action: "security.recovery_code_used",
          entityType: "profile",
          entityId: ctx.user.id,
          newValue: { remaining: left },
        }),
      "auth.recovery-code",
    );
  }
  const done = await finishTotpLogin(ctx);
  if (!done.ok) return done;
  redirect(next);
}
