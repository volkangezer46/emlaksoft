"use server";

import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { getBaseUrl } from "@/lib/base-url";

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

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl()}/sifre-yenile`,
  });

  // Hata da nötr yanıtla yutulur; yalnızca sunucu loguna düşer.
  if (error) console.error("requestPasswordReset", error.message);
  return { ok: true };
}
