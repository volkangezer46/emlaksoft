"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export type PasswordResetResult = { ok?: boolean; error?: string };

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Şifre sıfırlama bağlantısı ister. E-posta sistemde kayıtlı olsa da olmasa da
 * aynı nötr yanıt döner — hesap varlığı asla ele verilmez (enumeration koruması).
 */
export async function requestPasswordReset(
  _prev: PasswordResetResult,
  formData: FormData,
): Promise<PasswordResetResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Geçerli bir e-posta adresi girin." };
  }

  // Hız sınırı — IP başına saatte 5 istek (e-posta bombardımanını engelle)
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`pwreset:${ip}`, { limit: 5, windowSec: 3600 });
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
