"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidOptionalTurkishMobile, normalizeTurkishPhone, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  generateLoginCode,
  LOGIN_CODE_TTL_MS,
  sha256Hex,
  TWO_FACTOR_COOKIE,
  twoFactorCookieOptions,
  twoFactorCookieValue,
} from "@/lib/two-factor";
import { sendSignerSms } from "@/app/imza/_lib/sms";
import { sendSms } from "@/lib/messaging/netgsm";
import { logLoginEvent } from "@/app/giris/_lib/login-events";

function slugify(input: string) {
  return input
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function planFromTeamSize(size: string) {
  if (size === "1") return "advisor" as const;
  if (size === "50+") return "enterprise" as const;
  if (size === "10-50") return "professional" as const;
  return "office" as const;
}

export type AuthResult = { error?: string; ok?: true };

export async function signIn(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/app");

  if (!email || !password) {
    return { error: "E-posta ve şifre gerekli." };
  }

  const ip = await clientIp();
  const userAgent = (await headers()).get("user-agent");

  const supabase = await createClient();
  const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Şifre yanlış → kullanıcı kimliği bilinmez, yalnız IP izi kalır
    await logLoginEvent({ ip, userAgent, result: "failed" });
    return { error: "Giriş başarısız. E-posta veya şifreyi kontrol edin." };
  }

  const userId = signInData.user?.id ?? null;
  // Açık yönlendirme koruması: yalnız site-içi mutlak yol ("//evil.com" ve
  // "/\evil.com" tarayıcıda şema-göreli dış URL sayılır — kabul edilmez).
  const target = /^\/(?![/\\])/.test(next) ? next : "/app";
  const cookieStore = await cookies();

  if (userId) {
    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("two_factor_sms, phone, tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) {
      // Fail-closed: profil okunamazsa 2FA'lı hesap kod atlamadan içeri giremesin
      console.error("signIn profile", profileError);
      await supabase.auth.signOut();
      return { error: "Giriş doğrulanamadı. Lütfen tekrar deneyin." };
    }
    const tenantId = (profile?.tenant_id as string | null) ?? null;

    // SMS 2FA: oturum açık kalır ama es_2fa_ok çerezi olmadan middleware
    // /app - /admin'i /giris/dogrulama'ya yönlendirir (bkz. src/lib/two-factor.ts).
    if (profile?.two_factor_sms && profile.phone) {
      cookieStore.delete(TWO_FACTOR_COOKIE); // her şifreli girişte yeniden doğrulanır

      const { allowed } = await checkRateLimit(`2fa-send:${userId}`, { limit: 5, windowSec: 300 });
      if (!allowed) {
        await supabase.auth.signOut();
        return { error: "Çok sık doğrulama kodu istendi. Lütfen birkaç dakika sonra tekrar deneyin." };
      }

      const code = generateLoginCode();
      await admin.from("login_challenges").delete().eq("user_id", userId);
      const { error: chError } = await admin.from("login_challenges").insert({
        user_id: userId,
        code_hash: await sha256Hex(code),
        expires_at: new Date(Date.now() + LOGIN_CODE_TTL_MS).toISOString(),
      });
      if (chError) {
        console.error("signIn 2fa challenge", chError);
        await supabase.auth.signOut();
        return { error: "Doğrulama başlatılamadı. Lütfen tekrar deneyin." };
      }

      // Tenant Netgsm kaydı öncelikli; yoksa platform varsayılanı
      const text = `EmlakSoft giriş kodunuz: ${code}`;
      const sms = tenantId
        ? await sendSignerSms(tenantId, profile.phone, text)
        : await sendSms(profile.phone, text);
      if (!sms.ok) {
        console.error("signIn 2fa sms", sms.error);
        await admin.from("login_challenges").delete().eq("user_id", userId);
        await supabase.auth.signOut();
        return { error: "Doğrulama SMS'i gönderilemedi. Lütfen tekrar deneyin." };
      }

      await logLoginEvent({ userId, tenantId, ip, userAgent, result: "2fa_pending" });
      redirect(`/giris/dogrulama?next=${encodeURIComponent(target)}`);
    }

    // 2FA kapalı → çerez hemen set edilir, middleware ek sorgu yapmaz
    cookieStore.set(TWO_FACTOR_COOKIE, await twoFactorCookieValue(userId), twoFactorCookieOptions());
    await logLoginEvent({ userId, tenantId, ip, userAgent, result: "success" });
  }

  // Akıllı yönlendirme: kullanıcı belirli bir sayfa istemediyse (varsayılan "/app"),
  // EmlakSoft personeli /admin'e, ofis kullanıcıları /app'e iner. Aynı giriş kapısı.
  const explicitTarget = target !== "/app";
  if (!explicitTarget && userId) {
    const admin = createAdminClient();
    const { data: staff } = await admin
      .from("platform_staff")
      .select("id")
      .eq("id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (staff) redirect("/admin");
  }

  redirect(target);
}

export async function signUp(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const fullName = String(formData.get("name") ?? "").trim();
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const company = String(formData.get("company") ?? "").trim();
  const teamSize = String(formData.get("agents") ?? "2-10");

  if (!fullName || !email || !password || !company) {
    return { error: "Ad, e-posta, şifre ve firma adı zorunlu." };
  }
  if (password.length < 8) {
    return { error: "Şifre en az 8 karakter olmalı." };
  }

  // Hız sınırı — IP başına saatte 5 kayıt (sınırsız ofis/hesap oluşturmayı engelle)
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`signup:${ip}`, { limit: 5, windowSec: 3600 });
  if (!allowed) {
    return { error: "Çok fazla kayıt denemesi. Lütfen bir süre sonra tekrar deneyin." };
  }
  if (!isValidOptionalTurkishMobile(rawPhone)) {
    return { error: TR_MOBILE_ERROR_MESSAGE };
  }
  const phone = rawPhone ? normalizeTurkishPhone(rawPhone) : "";

  const admin = createAdminClient();
  const baseSlug = slugify(company) || "ofis";
  let slug = baseSlug;
  for (let i = 0; i < 5; i++) {
    const { data: existing } = await admin
      .from("tenants")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${Math.floor(100 + Math.random() * 900)}`;
  }

  const plan = planFromTeamSize(teamSize);
  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + 14);

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({
      name: company,
      slug,
      plan,
      status: "trial",
      trial_ends_at: trialEnds.toISOString(),
    })
    .select("id")
    .single();

  if (tenantError || !tenant) {
    console.error(tenantError);
    return { error: "Ofis oluşturulamadı. Şema yüklü mü kontrol edin." };
  }

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, phone },
      app_metadata: { tenant_id: tenant.id, role: "owner" },
    });

  if (createError || !created.user) {
    await admin.from("tenants").delete().eq("id", tenant.id);
    console.error(createError);
    return {
      error:
        createError?.message?.includes("already")
          ? "Bu e-posta zaten kayıtlı."
          : "Hesap oluşturulamadı.",
    };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    tenant_id: tenant.id,
    full_name: fullName,
    phone: phone || null,
    role: "owner",
  });

  if (profileError) {
    console.error(profileError);
    await admin.auth.admin.deleteUser(created.user.id);
    await admin.from("tenants").delete().eq("id", tenant.id);
    return { error: "Profil oluşturulamadı." };
  }

  const planPrices: Record<string, number> = {
    advisor: 990,
    office: 2490,
    professional: 5990,
    enterprise: 12900,
  };
  await admin.from("subscriptions").insert({
    tenant_id: tenant.id,
    plan,
    status: "trialing",
    billing_cycle: "monthly",
    amount_try: planPrices[plan] ?? 2490,
    trial_ends_at: trialEnds.toISOString(),
    current_period_start: new Date().toISOString(),
  });

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    return {
      error: "Hesap oluştu ama giriş yapılamadı. /giris sayfasından deneyin.",
    };
  }

  // Yeni hesapta 2FA kapalı — çerez set edilir ki middleware ek sorgu yapmasın
  const cookieStore = await cookies();
  cookieStore.set(TWO_FACTOR_COOKIE, await twoFactorCookieValue(created.user.id), twoFactorCookieOptions());
  await logLoginEvent({
    userId: created.user.id,
    tenantId: tenant.id,
    ip,
    userAgent: (await headers()).get("user-agent"),
    result: "success",
  });

  redirect("/app");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(TWO_FACTOR_COOKIE);
  redirect("/");
}
