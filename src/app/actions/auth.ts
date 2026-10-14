"use server";

import { cookies, headers } from "next/headers";
import { isPlatformMfaRequiredNow } from "@/lib/platform-mfa";
import { redirect } from "next/navigation";
import { logLoginEvent } from "@/app/giris/_lib/login-events";
import { sendSignerSms } from "@/app/imza/_lib/sms";
import { restoreImpersonationMetadata } from "@/lib/impersonation";
import { bootstrapPlatformStaffIfAllowed, isPlatformAllowlistedEmail } from "@/lib/platform";
import { hasGoogleIdentity, isDemoIdentityEmail, isGoogleAuthEnabled } from "@/lib/auth/google-auth";
import { provisionOfficeForUser } from "@/lib/registration/provision-office";
import { sendSms } from "@/lib/messaging/netgsm";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { PHONE_ERROR_MESSAGE, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { isRegistrationOpen } from "@/lib/platform-flags";
import { REGISTRATION_CLOSED_MESSAGE } from "@/lib/platform-setting-keys";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { opaqueRateLimitPart } from "@/lib/public-request-security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  generateLoginCode,
  LOGIN_CODE_TTL_MS,
  TWO_FACTOR_COOKIE,
} from "@/lib/two-factor";
import { hashOtpForStorage } from "@/lib/otp-hmac";
import type { SignupField } from "@/lib/signup-errors";
import { actionErrorMessage } from "@/lib/action-errors";
import { IDLE_COOKIE } from "@/lib/platform-security/admin-access";
import { now } from "@/lib/clock";
import { APP_IDLE_COOKIE } from "@/lib/office-security/policy";
import { OFFICE_IP_LOGIN_ERROR, officeLoginIpAllowed } from "@/lib/office-security/enforce";

export type AuthResult = {
  error?: string;
  ok?: true;
  /** Kayıt sihirbazı: hata bir alana aitse alan adı (adım + alan altı gösterim, `@/lib/signup-errors`). */
  field?: SignupField;
};

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
  // AD11/DG7: önceki oturumdan kalan boşta kalma çerezleri yeni oturumu hemen kapatmasın.
  cookieStore.delete(IDLE_COOKIE);
  cookieStore.delete(APP_IDLE_COOKIE);
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
      return { error: actionErrorMessage(profileError, "Giriş doğrulanamadı. Lütfen tekrar deneyin.") };
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
        return { error: actionErrorMessage(claimsError, "Destek oturumu güvenli şekilde doğrulanamadı.") };
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
          // AD11 geçmiş: kurtarılan/süresi dolan destek oturumu açık kalmasın (en iyi çaba; giriş durmaz).
          const endedAt = now();
          const { error: historyError } = await admin
            .from("platform_impersonation_history")
            .update({
              ended_at: new Date(endedAt).toISOString(),
              end_kind: new Date(snapshot.expires_at).getTime() <= endedAt ? "expired" : "recovered",
            })
            .eq("staff_id", userId)
            .eq("auth_session_id", snapshot.auth_session_id)
            .is("ended_at", null);
          if (historyError && historyError.code !== "PGRST205") {
            console.error("signIn impersonation recovery history", historyError.message);
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
        return { error: actionErrorMessage(tenantError, "Ofis durumu doğrulanamadı.") };
      }

      // DG7: ofisin IP kısıtı giriş anında da uygulanır (oturum açık kalmaz, 2FA SMS'i gönderilmez, günlükte
      // başarılı görünmez). Karar proxy ile aynı IP kaynağı ve önbellekli politikayla verilir.
      if (!(await officeLoginIpAllowed({ tenantId, role: profile.role, headers: await headers() }))) {
        await supabase.auth.signOut();
        await logLoginEvent({ userId, tenantId, ip, userAgent, result: "failed" });
        return { error: OFFICE_IP_LOGIN_ERROR };
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
          return { error: actionErrorMessage(proofClearError, "İki adımlı doğrulama oturumu hazırlanamadı.") };
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
        return { error: actionErrorMessage(challengeError, "Doğrulama başlatılamadı. Lütfen tekrar deneyin.") };
      }

      const message = `EmlakSoft giriş kodunuz: ${code}`;
      const sms = tenantId
        ? await sendSignerSms(tenantId, profile.phone, message)
        : await sendSms(profile.phone, message);
      if (!sms.ok) {
        console.error("signIn 2fa sms", sms.error);
        await admin.from("login_challenges").delete().eq("user_id", userId);
        await supabase.auth.signOut();
        return { error: actionErrorMessage(null, "Doğrulama SMS'i gönderilemedi. Lütfen tekrar deneyin.") };
      }

      await logLoginEvent({ userId, tenantId, ip, userAgent, result: "2fa_pending" });
      redirect(`/giris/dogrulama?next=${encodeURIComponent(target)}`);
    }

    // MFA kararı env + yönetim anahtarı + geçiş süresinden (isPlatformMfaRequiredNow(true) = zorunluluk ilan edilmiş);
    // faktörü olmayan personel geçiş süresinde parolayla girer.
    if (isPlatformStaff && (await isPlatformMfaRequiredNow(true))) {
      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const required = await isPlatformMfaRequiredNow(assurance?.nextLevel === "aal2");
      if (required && (assuranceError || assurance.currentLevel !== "aal2")) {
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

const SIGNUP_GLOBAL_KEY = "signup:global:ok";
const SIGNUP_GLOBAL_LIMIT = 300;
const SIGNUP_GENERIC_ERROR =
  "Hesap oluşturulamadı: bilgilerinizi kontrol edip tekrar deneyin. Daha önce kayıt olduysanız giriş sayfasını kullanın.";

/**
 * Kayıt — iki giriş yolu, TEK provizyon çekirdeği (`provisionOfficeForUser`):
 * - e-posta/şifre: auth kullanıcısı burada oluşur; provizyon başarısızsa tek telafi hedefi odur (silinir).
 * - Google (`auth_mode=google`, /kayit/tamamla): auth kullanıcısı OAuth oturumundan gelir; şifre/e-posta
 *   formdan alınmaz, telefon zorunlu; provizyon sonrası oturum claim'leri yenilenir. Başarısızlıkta
 *   Google kullanıcısı silinmez (yeniden dener). Kapılar (kayıt açık, rıza, hız sınırı) iki yolda AYNI.
 */
export async function signUp(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  // Platform ayarı: yeni ofis kaydı kapalıysa hiçbir şey oluşturulmaz (mevcut kullanıcı girişi açık).
  // Okuma hatasında güvenli varsayılan "kayıt açık" (platform-flags).
  if (!(await isRegistrationOpen())) {
    return { error: REGISTRATION_CLOSED_MESSAGE };
  }

  const googleMode = String(formData.get("auth_mode") ?? "") === "google";
  const fullName = String(formData.get("name") ?? "").trim();
  const rawPhone = String(formData.get("phone") ?? "").trim();
  // Kayıtta ofis adı SORULMAZ: varsayılan "<Ad Soyad> Emlak" ile kurulur, Kurulum sihirbazının ilk adımında düzenlenir.
  // (Eski istemciler `company` gönderirse o kullanılır.)
  const company = (String(formData.get("company") ?? "").trim() || (fullName ? `${fullName} Emlak` : "")).slice(0, 120);
  const publicClient = await createClient();

  // Google yolu: kimlik oturumdan (OAuth), e-posta formdan DEĞİL.
  let email: string;
  let password = "";
  let oauthUserId: string | null = null;
  if (googleMode) {
    if (!isGoogleAuthEnabled()) return { error: "Google ile kayıt şu an kullanılamıyor." };
    const {
      data: { user: oauthUser },
    } = await publicClient.auth.getUser();
    if (!oauthUser?.email || !hasGoogleIdentity(oauthUser)) {
      return { error: "Google oturumunuz bulunamadı. Lütfen Google ile yeniden devam edin." };
    }
    if (typeof oauthUser.app_metadata?.tenant_id === "string") {
      redirect("/app");
    }
    if (isDemoIdentityEmail(oauthUser.email) || isPlatformAllowlistedEmail(oauthUser.email)) {
      return { error: "Bu hesapla Google üzerinden yeni ofis açılamaz." };
    }
    oauthUserId = oauthUser.id;
    email = normalizeEmail(oauthUser.email);
    if (!fullName) {
      return { error: "Ad soyad zorunlu.", field: "name" };
    }
  } else {
    email = normalizeEmail(String(formData.get("email") ?? ""));
    password = String(formData.get("password") ?? "");
    if (!fullName) return { error: "Ad soyad zorunlu.", field: "name" };
    if (!email) return { error: "E-posta zorunlu.", field: "email" };
    if (!password) return { error: "Şifre zorunlu.", field: "password" };
    if (password.length < 8) {
      return { error: "Şifre en az 8 karakter olmalı.", field: "password" };
    }
  }
  // Cep telefonu iki yolda da zorunlu (güvenlik doğrulaması ve bildirimler); TR cep kuralı aşağıda parsePhoneStrict ile.
  if (!rawPhone) {
    return { error: "Cep telefonu zorunlu.", field: "phone" };
  }
  // Kullanım koşulları ve KVKK metni formda bilgi satırı olarak gösterilir (onay kutusu yok); kayıtla birlikte
  // sürümler registration_consents'a yazılır (provision_registration).

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
    return { error: EMAIL_ERROR_MESSAGE, field: "email" };
  }
  // E-posta (normalize) başına ve global saatlik tavan: IP rotasyonlu toplu kayıt/posta bombalamayı keser.
  const emailLimit = await checkRateLimit(`signup:email:${email}`, { limit: 10, windowSec: 3600, failurePolicy: "deny" });
  if (!emailLimit.allowed) {
    return { error: "Çok fazla kayıt denemesi. Lütfen bir süre sonra tekrar deneyin." };
  }
  // profiles.phone şu an DB'de yalnız TR cep (05XXXXXXXXX) kabul eder (profiles_phone_tr_format);
  // 2FA SMS'i de Netgsm (yalnız TR) ile gider. Yabancı numara için migration gerekir.
  let phone = "";
  if (rawPhone) {
    const parsed = parsePhoneStrict(rawPhone);
    if (!parsed.ok) return { error: parsed.error ?? PHONE_ERROR_MESSAGE, field: "phone" };
    if (parsed.country !== "TR" || parsed.kind !== "mobile") return { error: TR_MOBILE_ERROR_MESSAGE, field: "phone" };
    phone = parsed.stored;
  }
  const userAgent = ((await headers()).get("user-agent") ?? "").slice(0, 512);
  const admin = createAdminClient();

  // Bilinçli ödünleşim: bu okuma ile aşağıdaki artış atomik DEĞİL; eşzamanlı kayıtlar tavanı (300/saat) birkaç kayıt
  // aşabilir. Tavan hassas bir kota değil, toplu kötüye kullanıma karşı kaba sigortadır; hassas koruma IP/e-posta
  // sınırlarıdır (üstte, atomik RPC). Başarısız denemelerin gerçek kayıtları engellememesi bu payın karşılığıdır.
  // Global saatlik tavan YALNIZ başarılı provizyonları sayar (aşağıda, provizyon sonrası artar). Burada sadece
  // sayaca bakılır (tüketmez): başarısız/geçersiz denemeler (ör. kayıtlı e-posta, hatalı alan) global tavanı doldurup
  // gerçek kayıtları engelleyemez. Okuma hatasında güvenli tarafta kalınır (reddet).
  {
    const { data: bucket, error: bucketError } = await admin
      .from("rate_limits")
      .select("hits, window_end")
      .eq("bucket", `v1:${opaqueRateLimitPart(SIGNUP_GLOBAL_KEY)}`)
      .maybeSingle();
    const hits = Number((bucket as { hits?: number } | null)?.hits ?? 0);
    const windowEnd = Date.parse(String((bucket as { window_end?: string } | null)?.window_end ?? ""));
    if (bucketError || (hits >= SIGNUP_GLOBAL_LIMIT && Number.isFinite(windowEnd) && windowEnd > Date.now())) {
      return { error: "Kayıt şu anda yoğun. Lütfen biraz sonra tekrar deneyin." };
    }
  }

  let userId: string;
  if (oauthUserId) {
    // Google: kullanıcı zaten provizyonlu ya da platform personeli ise yeni ofis açılmaz.
    const [{ data: existingProfile, error: profileReadError }, { data: staffRow, error: staffReadError }] = await Promise.all([
      admin.from("profiles").select("id").eq("id", oauthUserId).maybeSingle(),
      admin.from("platform_staff").select("id").eq("id", oauthUserId).maybeSingle(),
    ]);
    if (profileReadError || staffReadError) {
      console.error("signUp google identity", profileReadError ?? staffReadError);
      return { error: actionErrorMessage(profileReadError ?? staffReadError, "Hesap durumu doğrulanamadı.") };
    }
    if (staffRow) return { error: "Bu hesapla Google üzerinden yeni ofis açılamaz." };
    if (existingProfile) redirect("/app");
    userId = oauthUserId;
  } else {
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
      // Hesap sayımı (enumeration) yok: kayıtlı e-posta için özel mesaj/alan işareti dönmez; her hata aynı genel metni alır.
      return { error: SIGNUP_GENERIC_ERROR };
    }
    userId = created.user.id;
  }

  // Ortak provizyon çekirdeği (ofis + profil + abonelik + rıza → atıf → sihirbaz profili → demo veri).
  // Aynı admin client (yeni service_role kullanımı yok).
  const result = await provisionOfficeForUser(admin, publicClient, {
    userId,
    email,
    fullName,
    phone,
    company,
    formData,
    ip,
    userAgent,
  });
  if (!result.ok) {
    if (!oauthUserId) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
      if (cleanupError) console.error("signUp auth compensation", cleanupError);
    }
    return { error: actionErrorMessage(result.error, "Ofis hesabı güvenli şekilde oluşturulamadı. Lütfen tekrar deneyin.") };
  }
  const tenantId = result.tenantId;
  // Başarılı provizyon: global tavan sayacı artar (en iyi çaba; kayıt zaten tamamlandı, sayaç hatası kaydı bozmaz).
  await checkRateLimit(SIGNUP_GLOBAL_KEY, { limit: SIGNUP_GLOBAL_LIMIT, windowSec: 3600, failurePolicy: "deny" }); // sonuç yok sayılır (yalnız sayaç artar); politika sözleşme gereği deny

  if (oauthUserId) {
    // Profil tetikleyicisi app_metadata'ya tenant_id/role yazdı; mevcut JWT'yi yenile ki proxy kapısı geçsin.
    const { error: refreshError } = await publicClient.auth.refreshSession();
    if (refreshError) {
      console.error("signUp google refresh", refreshError);
      return { error: "Ofisiniz oluşturuldu ancak oturum yenilenemedi. Lütfen Google ile yeniden giriş yapın." };
    }
  } else {
    const { error: signInError } = await publicClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      return { error: "Hesap oluştu ancak giriş yapılamadı. Giriş sayfasından deneyin." };
    }
  }

  (await cookies()).delete(TWO_FACTOR_COOKIE);
  await logLoginEvent({
    userId,
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
  const jar = await cookies();
  jar.delete(TWO_FACTOR_COOKIE);
  jar.delete(IDLE_COOKIE);
  jar.delete(APP_IDLE_COOKIE);
  redirect("/");
}
