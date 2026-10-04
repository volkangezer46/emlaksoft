"use server";

import { revalidatePath } from "next/cache";
import { createClient as createJsClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveSupabasePublicKey } from "@/lib/supabase/keys";
import { requireActiveTenant } from "@/lib/tenant-guard";
import { logActivity } from "@/lib/activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { PHONE_ERROR_MESSAGE, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { validateNewPassword } from "@/lib/account/password-rules";
import { emailSchema } from "@/lib/validation/contact";
import { getBaseUrl } from "@/lib/base-url";
import { maskEmail } from "@/lib/account/email-change";

export type AccountResult = { ok?: boolean; error?: string; message?: string };

async function ownerCtx() {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error } as const;
  if (gate.impersonating) return { error: "Destek oturumunda hesap değiştirilemez." } as const;
  return { gate } as const;
}

/** Kullanıcının kendi adı, telefonu ve unvanı (P1-F1). E-posta bu formdan değişmez (bkz. requestMyEmailChange). */
export async function updateMyProfile(_prev: AccountResult, formData: FormData): Promise<AccountResult> {
  const ctx = await ownerCtx();
  if ("error" in ctx) return { error: ctx.error };
  const { gate } = ctx;

  const fullName = String(formData.get("full_name") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  if (!fullName) return { error: "Ad soyad zorunlu." };
  if (fullName.length > 120) return { error: "Ad soyad en fazla 120 karakter olabilir." };
  if (title.length > 80) return { error: "Unvan en fazla 80 karakter olabilir." };

  let phone: string | null = null;
  if (phoneRaw) {
    const parsed = parsePhoneStrict(phoneRaw);
    if (!parsed.ok) return { error: parsed.error ?? PHONE_ERROR_MESSAGE };
    if (parsed.country !== "TR" || parsed.kind !== "mobile") return { error: TR_MOBILE_ERROR_MESSAGE };
    phone = parsed.stored;
  }

  const admin = createAdminClient();
  const { data: current } = await admin
    .from("profiles")
    .select("phone, two_factor_sms")
    .eq("id", gate.userId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!current) return { error: "Profil bulunamadı." };

  // 2FA SMS'i bu numaraya gider: oturumu ele geçiren biri telefonu değiştirip 2FA'yı aşamasın.
  if (current.two_factor_sms && (current.phone ?? null) !== phone) {
    return {
      error: "İki adımlı doğrulama açıkken telefon değiştirilemez. Önce Güvenlik sayfasından kapatın, telefonu güncelleyin, sonra yeniden açın.",
    };
  }

  const { error } = await admin
    .from("profiles")
    .update({ full_name: fullName, phone, title: title || null })
    .eq("id", gate.userId)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("updateMyProfile", error.message);
    return { error: "Profil güncellenemedi." };
  }
  const { error: metaError } = await admin.auth.admin.updateUserById(gate.userId, {
    user_metadata: { full_name: fullName, phone: phone ?? "" },
  });
  if (metaError) console.error("updateMyProfile meta", metaError.message);

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "account.profile_updated",
    entityType: "profile",
    entityId: gate.userId,
    newValue: { full_name: fullName, title: title || null, phone_changed: (current.phone ?? null) !== phone },
  });
  revalidatePath("/app/hesabim");
  revalidatePath("/app", "layout");
  return { ok: true, message: "Profiliniz kaydedildi." };
}

/**
 * Uygulama içi parola değiştirme: mevcut parola ayrı (çerezsiz) bir istemciyle doğrulanır,
 * sonra yeni parola yazılır ve diğer cihazlardaki oturumlar kapatılır.
 */
export async function changeMyPassword(_prev: AccountResult, formData: FormData): Promise<AccountResult> {
  const ctx = await ownerCtx();
  if ("error" in ctx) return { error: ctx.error };
  const { gate } = ctx;

  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  const invalid = validateNewPassword({ current, next, confirm });
  if (invalid) return { error: invalid };

  const { allowed } = await checkRateLimit(`pwchange:${gate.userId}`, {
    limit: 5,
    windowSec: 900,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla deneme yapıldı. 15 dakika sonra tekrar deneyin." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || user.id !== gate.userId) return { error: "Oturum doğrulanamadı." };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = resolveSupabasePublicKey();
  if (!url || !key) return { error: "Kimlik servisi yapılandırılmamış." };
  const verifier = createJsClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: verifyError } = await verifier.auth.signInWithPassword({ email: user.email, password: current });
  if (verifyError) return { error: "Mevcut parola hatalı." };

  const { error: updateError } = await supabase.auth.updateUser({ password: next });
  if (updateError) {
    console.error("changeMyPassword", updateError.message);
    return { error: "Parola güncellenemedi. Daha güçlü bir parola deneyin." };
  }

  // Diğer cihazlardaki oturumlar kapanır; bu oturum açık kalır. Başarısızlık parola değişimini geri almaz.
  const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
  if (signOutError) console.error("changeMyPassword signOut others", signOutError.message);

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "account.password_changed",
    entityType: "profile",
    entityId: gate.userId,
    newValue: { other_sessions_closed: !signOutError },
  });
  return {
    ok: true,
    message: signOutError
      ? "Parolanız değişti. Diğer cihazlardaki oturumlar kapatılamadı; 'Diğer cihazlardan çık' ile deneyin."
      : "Parolanız değişti; diğer cihazlardaki oturumlar kapatıldı.",
  };
}

/** Bu cihaz dışındaki tüm oturumları kapatır (Supabase Auth: scope "others"). */
export async function signOutOtherDevices(_prev: AccountResult, _formData: FormData): Promise<AccountResult> {
  void _formData;
  const ctx = await ownerCtx();
  if ("error" in ctx) return { error: ctx.error };
  const { gate } = ctx;

  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) {
    console.error("signOutOtherDevices", error.message);
    return { error: "Diğer oturumlar kapatılamadı. Lütfen tekrar deneyin." };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "account.other_sessions_closed",
    entityType: "profile",
    entityId: gate.userId,
  });
  return { ok: true, message: "Bu cihaz dışındaki tüm oturumlar kapatıldı." };
}

/**
 * Kendi e-postanı değiştirme (güvenli akış): parola yeniden doğrulanır, Supabase Auth yeni adrese doğrulama
 * bağlantısı yollar; bağlantı onaylanana kadar ESKİ e-posta geçerli kalır ve giriş kimliği değişmez.
 * E-posta hiçbir yerde doğrudan yazılmaz. Başkasının e-postası bu action ile değişmez.
 */
export async function requestMyEmailChange(_prev: AccountResult, formData: FormData): Promise<AccountResult> {
  const ctx = await ownerCtx();
  if ("error" in ctx) return { error: ctx.error };
  const { gate } = ctx;

  const parsed = emailSchema.safeParse(formData.get("new_email"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Geçerli bir e-posta adresi girin" };
  const newEmail = parsed.data;
  const password = String(formData.get("current_password") ?? "");
  if (!password) return { error: "Onay için mevcut parolanızı girin." };

  const { allowed } = await checkRateLimit(`emailchange:${gate.userId}`, {
    limit: 3,
    windowSec: 3600,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla deneme yapıldı. Bir saat sonra tekrar deneyin." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || user.id !== gate.userId) return { error: "Oturum doğrulanamadı." };
  if (user.email.toLowerCase() === newEmail) return { error: "Bu zaten mevcut e-posta adresiniz." };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = resolveSupabasePublicKey();
  if (!url || !key) return { error: "Kimlik servisi yapılandırılmamış." };
  const verifier = createJsClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: verifyError } = await verifier.auth.signInWithPassword({ email: user.email, password });
  if (verifyError) return { error: "Mevcut parola hatalı." };

  const { error } = await supabase.auth.updateUser(
    { email: newEmail },
    { emailRedirectTo: `${getBaseUrl()}/app/hesabim?eposta=onay` },
  );
  if (error) {
    // Adres başkasında kayıtlı olsa bile hesap varlığı ele verilmez: nötr hata.
    console.error("requestMyEmailChange", error.message);
    return { error: "E-posta değişikliği başlatılamadı. Başka bir adres deneyin veya biraz sonra tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "account.email_change_requested",
    entityType: "profile",
    entityId: gate.userId,
    newValue: { new_email_masked: maskEmail(newEmail) },
  });
  revalidatePath("/app/hesabim");
  return {
    ok: true,
    message: `${newEmail} adresine doğrulama bağlantısı gönderildi. Bağlantıyı onaylayana kadar giriş e-postanız değişmez (ayarlara göre eski adrese de onay e-postası gelebilir).`,
  };
}
