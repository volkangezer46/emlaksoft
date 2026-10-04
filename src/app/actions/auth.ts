"use server";

import { cookies, headers } from "next/headers";
import { isPlatformMfaRequired } from "@/lib/platform-mfa";
import { redirect } from "next/navigation";
import { logLoginEvent } from "@/app/giris/_lib/login-events";
import { sendSignerSms } from "@/app/imza/_lib/sms";
import {
  normalizeBillingCycle,
} from "@/lib/billing/plans";
import {
  normalizeRegistrationTeamSize,
  registrationPlanForTeamSize,
} from "@/lib/billing/registration-plan";
import { restoreImpersonationMetadata } from "@/lib/impersonation";
import { bootstrapPlatformStaffIfAllowed } from "@/lib/platform";
import { sendSms } from "@/lib/messaging/netgsm";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { PHONE_ERROR_MESSAGE, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  generateLoginCode,
  LOGIN_CODE_TTL_MS,
  TWO_FACTOR_COOKIE,
} from "@/lib/two-factor";
import { hashOtpForStorage } from "@/lib/otp-hmac";

const REGISTRATION_TERMS_VERSION = "kullanim-sartlari-2026-07-31";
const REGISTRATION_KVKK_VERSION = "kvkk-aydinlatma-2026-07-31";

function slugify(input: string) {
  return input
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/\u0131/g, "i")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export type AuthResult = { error?: string; ok?: true };

export async function signIn(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/app");

  if (!email || !password) {
    return { error: "E-posta ve şifre gerekli." };
  }
  if (!isValidEmail(email)) {
    return { error: EMAIL_ERROR_MESSAGE };
  }

  const ip = await clientIp();
  const userAgent = (await headers()).get("user-agent");
  const { allowed: loginAllowed } = await checkRateLimit(
    `signin:${ip}:${email.toLowerCase()}`,
    {
      limit: 10,
      windowSec: 300,
      failurePolicy: "deny",
    },
  );
  if (!loginAllowed) {
    await logLoginEvent({ ip, userAgent, result: "failed" });
    return { error: "Çok fazla giriş denemesi yapıldı. Lütfen biraz sonra tekrar deneyin." };
  }
  const supabase = await createClient();
  const { data: signInData, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    await logLoginEvent({ ip, userAgent, result: "failed" });
    return { error: "Giriş başarısız. E-posta veya şifreyi kontrol edin." };
  }

  const userId = signInData.user?.id ?? null;
  const target = /^\/(?![/\\])/.test(next) ? next : "/app";
  const cookieStore = await cookies();
  cookieStore.delete(TWO_FACTOR_COOKIE);
  let isPlatformStaff = false;

  if (userId) {
    const admin = createAdminClient();
    const [{ data: profile, error: profileError }, { data: staff, error: staffError }] =
      await Promise.all([
        admin
          .from("profiles")
          .select("two_factor_sms, two_factor_version, phone, tenant_id, role, is_active")
          .eq("id", userId)
          .maybeSingle(),
        admin
          .from("platform_staff")
          .select("id")
          .eq("id", userId)
          .eq("is_active", true)
          .maybeSingle(),
      ]);
    if (profileError || staffError) {
      console.error("signIn identity", profileError ?? staffError);
      await supabase.auth.signOut();
      return { error: "Giriş doğrulanamadı. Lütfen tekrar deneyin." };
    }

    const bootstrappedStaff = !staff && signInData.user?.email
      ? await bootstrapPlatformStaffIfAllowed(
          userId,
          signInData.user.email,
          String(signInData.user.user_metadata?.full_name ?? signInData.user.email),
        )
      : null;
    isPlatformStaff = Boolean(staff || bootstrappedStaff);
    const tenantId = (profile?.tenant_id as string | null) ?? null;

    // app_metadata is user-global. A new password login must not inherit an
    // impersonation snapshot owned by another/expired Supabase session.
    const currentMeta = (signInData.user?.app_metadata ?? {}) as Record<string, unknown>;
    if (isPlatformStaff && currentMeta.impersonating === true) {
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
      const currentSessionId = claimsData?.claims?.session_id;
      const { data: snapshot, error: snapshotError } = await admin
        .from("platform_impersonation_sessions")
        .select("auth_session_id, target_tenant_id, original_app_metadata, expires_at")
        .eq("staff_id", userId)
        .maybeSingle();
      if (claimsError || snapshotError) {
        console.error("signIn impersonation recovery read", claimsError ?? snapshotError);
        await supabase.auth.signOut();
        return { error: "Destek oturumu güvenli şekilde doğrulanamadı." };
      }

      if (
        typeof currentSessionId !== "string" ||
        !currentSessionId ||
        !snapshot ||
        snapshot.auth_session_id !== currentSessionId ||
        snapshot.target_tenant_id !== currentMeta.tenant_id ||
        new Date(snapshot.expires_at).getTime() <= Date.now()
      ) {
        let original: Record<string, unknown>;
        if (
          snapshot?.original_app_metadata &&
          typeof snapshot.original_app_metadata === "object"
        ) {
          original = snapshot.original_app_metadata as Record<string, unknown>;
        } else {
          original = { ...currentMeta };
          original.tenant_id = currentMeta.home_tenant_id ?? null;
          original.role = currentMeta.home_role ?? null;
          original.impersonating = false;
          delete original.home_tenant_id;
          delete original.home_role;
          delete original.impersonation_session_id;
        }

        const restored = restoreImpersonationMetadata(currentMeta, original);
        if (snapshot) {
          const { error: cleanupError } = await admin
            .from("platform_impersonation_sessions")
            .delete()
            .eq("staff_id", userId)
            .eq("auth_session_id", snapshot.auth_session_id);
          if (cleanupError) {
            console.error("signIn impersonation recovery cleanup", cleanupError);
            await supabase.auth.signOut();
            return { error: "Eski destek oturumu temizlenemedi." };
          }
        }

        const { error: restoreError } = await admin.auth.admin.updateUserById(userId, {
          app_metadata: restored,
        });
        if (restoreError) {
          console.error("signIn impersonation recovery claims", restoreError);
          await supabase.auth.signOut();
          return { error: "Eski destek oturumu sonlandırılamadı." };
        }
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) {
          console.error("signIn impersonation recovery refresh", refreshError);
          await supabase.auth.signOut();
          return { error: "Oturum yenilenemedi. Lütfen tekrar giriş yapın." };
        }
      }
    }

    if (!isPlatformStaff) {
      const claimedTenant = signInData.user?.app_metadata?.tenant_id;
      const claimedRole = signInData.user?.app_metadata?.role;
      if (
        !profile?.is_active ||
        !tenantId ||
        claimedTenant !== tenantId ||
        claimedRole !== profile.role
      ) {
        await supabase.auth.signOut();
        return { error: "Hesabınız pasif veya ofis kimliği geçersiz." };
      }

      const { data: tenant, error: tenantError } = await admin
        .from("tenants")
        .select("status")
        .eq("id", tenantId)
        .maybeSingle();
      if (tenantError || !tenant) {
        await supabase.auth.signOut();
        return { error: "Ofis durumu doğrulanamadı." };
      }
    }

    if (profile?.is_active && profile.two_factor_sms) {
      if (!profile.phone) {
        await supabase.auth.signOut();
        return {
          error: "İki adımlı doğrulama telefonu bulunamadı. Yöneticinize başvurun.",
        };
      }

      const { data: claimsData } = await supabase.auth.getClaims();
      const sessionId = claimsData?.claims?.session_id;
      if (typeof sessionId === "string" && sessionId) {
        const { error: proofClearError } = await admin
          .from("two_factor_verified_sessions")
          .delete()
          .eq("session_id", sessionId)
          .eq("user_id", userId);
        if (proofClearError) {
          console.error("signIn clear 2FA session proof", proofClearError);
          await supabase.auth.signOut();
          return { error: "İki adımlı doğrulama oturumu hazırlanamadı." };
        }
      }

      const { allowed } = await checkRateLimit(`2fa-send:${userId}`, {
        limit: 5,
        windowSec: 300,
        failurePolicy: "deny",
      });
      if (!allowed) {
        await supabase.auth.signOut();
        return { error: "Çok sık doğrulama kodu istendi. Lütfen biraz sonra tekrar deneyin." };
      }

      const code = generateLoginCode();
      await admin.from("login_challenges").delete().eq("user_id", userId);
      let codeHash: string;
      try {
        codeHash = hashOtpForStorage(code, "login", userId);
      } catch (hashError) {
        console.error("signIn 2fa OTP configuration", {
          error: hashError instanceof Error ? hashError.name : "unknown",
        });
        await supabase.auth.signOut();
        return { error: "Doğrulama güvenli şekilde başlatılamadı. Lütfen yöneticinize başvurun." };
      }
      const { error: challengeError } = await admin.from("login_challenges").insert({
        user_id: userId,
        code_hash: codeHash,
        expires_at: new Date(Date.now() + LOGIN_CODE_TTL_MS).toISOString(),
      });
      if (challengeError) {
        console.error("signIn 2fa challenge", challengeError);
        await supabase.auth.signOut();
        return { error: "Doğrulama başlatılamadı. Lütfen tekrar deneyin." };
      }

      const message = `EmlakSoft giriş kodunuz: ${code}`;
      const sms = tenantId
        ? await sendSignerSms(tenantId, profile.phone, message)
        : await sendSms(profile.phone, message);
      if (!sms.ok) {
        console.error("signIn 2fa sms", sms.error);
        await admin.from("login_challenges").delete().eq("user_id", userId);
        await supabase.auth.signOut();
        return { error: "Doğrulama SMS'i gönderilemedi. Lütfen tekrar deneyin." };
      }

      await logLoginEvent({ userId, tenantId, ip, userAgent, result: "2fa_pending" });
      redirect(`/giris/dogrulama?next=${encodeURIComponent(target)}`);
    }

    if (isPlatformStaff && isPlatformMfaRequired()) {
      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError || assurance.currentLevel !== "aal2") {
        const platformTarget = target === "/app" ? "/admin" : target;
        redirect(`/giris/mfa?next=${encodeURIComponent(platformTarget)}`);
      }
    }

    await logLoginEvent({ userId, tenantId, ip, userAgent, result: "success" });
  }

  const explicitTarget = target !== "/app";
  if (!explicitTarget && isPlatformStaff) redirect("/admin");
  redirect(target);
}

export async function signUp(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const fullName = String(formData.get("name") ?? "").trim();
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const company = String(formData.get("company") ?? "").trim();
  const requestedTeamSize = String(formData.get("agents") ?? "2-10");
  const requestedPlan = String(formData.get("plan") ?? "").trim();
  const requestedCycle = String(formData.get("cycle") ?? "").trim();
  const legalConsent = String(formData.get("legal_consent") ?? "");

  if (!fullName || !email || !password || !company) {
    return { error: "Ad, e-posta, şifre ve firma adı zorunlu." };
  }
  if (password.length < 8) {
    return { error: "Şifre en az 8 karakter olmalı." };
  }
  if (legalConsent !== "accepted") {
    return { error: "Kullanım şartları ve KVKK aydınlatma metni onayı zorunlu." };
  }

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`signup:${ip}`, {
    limit: 5,
    windowSec: 3600,
    failurePolicy: "deny",
  });
  if (!allowed) {
    return { error: "Çok fazla kayıt denemesi. Lütfen bir süre sonra tekrar deneyin." };
  }
  if (!isValidEmail(email)) {
    return { error: EMAIL_ERROR_MESSAGE };
  }
  // profiles.phone şu an DB'de yalnız TR cep (05XXXXXXXXX) kabul eder (profiles_phone_tr_format);
  // 2FA SMS'i de Netgsm (yalnız TR) ile gider. Yabancı numara için migration gerekir.
  let phone = "";
  if (rawPhone) {
    const parsed = parsePhoneStrict(rawPhone);
    if (!parsed.ok) return { error: parsed.error ?? PHONE_ERROR_MESSAGE };
    if (parsed.country !== "TR" || parsed.kind !== "mobile") return { error: TR_MOBILE_ERROR_MESSAGE };
    phone = parsed.stored;
  }
  const teamSize = normalizeRegistrationTeamSize(requestedTeamSize);
  const plan = registrationPlanForTeamSize(requestedPlan, teamSize);
  const billingCycle = normalizeBillingCycle(requestedCycle);
  const baseSlug = slugify(company) || "ofis";
  const userAgent = ((await headers()).get("user-agent") ?? "").slice(0, 512);
  const admin = createAdminClient();

  // Auth is the only resource outside the provisioning transaction. If the
  // atomic RPC fails, this pending Auth user is the sole compensation target.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone },
    app_metadata: { role: "owner", account_active: true },
  });
  if (createError || !created.user) {
    console.error("signUp auth", createError);
    return {
      error: createError?.message?.includes("already")
        ? "Bu e-posta zaten kayıtlı."
        : "Hesap oluşturulamadı.",
    };
  }

  const { data: provisioned, error: provisionError } = await admin.rpc(
    "provision_registration",
    {
      p_user_id: created.user.id,
      p_company: company,
      p_slug_base: baseSlug,
      p_full_name: fullName,
      p_phone: phone || null,
      p_plan: plan,
      p_billing_cycle: billingCycle,
      p_team_size: teamSize,
      p_terms_version: REGISTRATION_TERMS_VERSION,
      p_kvkk_version: REGISTRATION_KVKK_VERSION,
      p_ip_address: ip ? ip.slice(0, 128) : null,
      p_user_agent: userAgent || null,
    },
  );
  const tenantId =
    provisioned &&
    typeof provisioned === "object" &&
    !Array.isArray(provisioned) &&
    typeof (provisioned as Record<string, unknown>).tenantId === "string"
      ? ((provisioned as Record<string, unknown>).tenantId as string)
      : null;

  if (provisionError || !tenantId) {
    console.error("signUp provision_registration", provisionError);
    const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
    if (cleanupError) console.error("signUp auth compensation", cleanupError);
    return { error: "Ofis hesabı güvenli şekilde oluşturulamadı. Lütfen tekrar deneyin." };
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    return { error: "Hesap oluştu ancak giriş yapılamadı. Giriş sayfasından deneyin." };
  }

  (await cookies()).delete(TWO_FACTOR_COOKIE);
  await logLoginEvent({
    userId: created.user.id,
    tenantId,
    ip,
    userAgent,
    result: "success",
  });
  redirect("/app");
}

export async function signOut() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const sessionId = claimsData?.claims?.session_id;
  const userId = claimsData?.claims?.sub;
  if (
    typeof sessionId === "string" &&
    sessionId &&
    typeof userId === "string" &&
    userId
  ) {
    try {
      await createAdminClient()
        .from("two_factor_verified_sessions")
        .delete()
        .eq("session_id", sessionId)
        .eq("user_id", userId);
    } catch (proofError) {
      // Proof cleanup is best-effort; logout itself must always continue.
      console.error("signOut clear 2FA session proof", proofError);
    }
  }
  await supabase.auth.signOut();
  (await cookies()).delete(TWO_FACTOR_COOKIE);
  redirect("/");
}
