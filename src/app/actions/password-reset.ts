"use server";

import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { getBaseUrl } from "@/lib/base-url";
import { passwordPolicyError, PASSWORD_MAX_LENGTH } from "@/lib/password-policy";

export type PasswordResetResult = { ok?: boolean; error?: string };

function appUrl() {
  return getBaseUrl();
}

/**
 * Şifre sıfırlama bağlantısı ister. E-posta sistemde kayıtlı olsa da olmasa da
 * aynı nötr yanıt döner — hesap varlığı asla ele verilmez (enumeration koruması).
 */
export async function requestPasswordReset(
  _prev: PasswordResetResult,
  formData: FormData,
): Promise<PasswordResetResult> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!email || !isValidEmail(email)) {
    return { error: EMAIL_ERROR_MESSAGE };
  }

  // Hız sınırı — IP başına saatte 5 istek (e-posta bombardımanını engelle)
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`pwreset:${ip}`, {
    limit: 5,
    windowSec: 3600,
    failurePolicy: "deny",
  });
  if (!allowed) {
    return { error: "Çok fazla deneme yapıldı. Lütfen bir süre sonra tekrar deneyin." };
  }

  // E-posta başına sınır: IP değiştirerek aynı kutuya bağlantı yağdırmak (posta bombası) engellenir. Sınır aşılınca
  // da nötr yanıt döner — yanıt farkı hesap varlığını ya da sınırı ele vermez; bağlantı yalnız gönderilmez.
  const { allowed: emailAllowed } = await checkRateLimit(`pwreset:email:${email}`, {
    limit: 3,
    windowSec: 3600,
    failurePolicy: "deny",
  });
  if (!emailAllowed) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl()}/sifre-yenile`,
  });

  // Hata da nötr yanıtla yutulur; yalnızca sunucu loguna düşer.
  if (error) console.error("requestPasswordReset", error.message);
  return { ok: true };
}

export type CompletePasswordResetResult = { ok?: true; error?: string; invalid?: true };

/**
 * Sıfırlama bağlantısıyla açılan kurtarma oturumunda yeni parolayı SUNUCUDA belirler: istemci doğrudan
 * `updateUser` çağırsaydı ortak parola politikası (yaygın liste, e-posta / ad / ofis adı) atlanabilirdi.
 */
export async function completePasswordReset(
  _prev: CompletePasswordResetResult,
  formData: FormData,
): Promise<CompletePasswordResetResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length > PASSWORD_MAX_LENGTH) return { error: `Şifre en fazla ${PASSWORD_MAX_LENGTH} karakter olabilir.` };
  if (password !== confirm) return { error: "Şifreler eşleşmiyor. İki alana da aynı şifreyi yazın." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { invalid: true };

  const { allowed } = await checkRateLimit(`pwreset:complete:${user.id}`, { limit: 10, windowSec: 900, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok fazla deneme yapıldı. Lütfen 15 dakika sonra tekrar deneyin." };

  const tenantId = typeof user.app_metadata?.tenant_id === "string" ? user.app_metadata.tenant_id : null;
  // Ofis adı kendi kiracısından okunur (RLS); 2FA kanıtı olmayan kurtarma oturumunda okunamazsa kural ad/e-postayla sürer.
  const office = tenantId
    ? (await supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle()).data as { name?: string | null } | null
    : null;
  const weak = passwordPolicyError(password, {
    email: user.email,
    fullName: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null,
    officeName: office?.name ?? null,
  });
  if (weak) return { error: weak };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("different from the old")) return { error: "Yeni şifreniz eski şifrenizle aynı olamaz." };
    if (msg.includes("session missing") || msg.toLowerCase().includes("expired")) return { invalid: true };
    console.error("completePasswordReset", msg);
    return { error: "Şifre güncellenemedi. Bağlantının süresi dolmuş olabilir; yeni bağlantı isteyin." };
  }
  return { ok: true };
}
