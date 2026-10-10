"use server";

import { createClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { getBaseUrl } from "@/lib/base-url";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/action-errors";
import { isEmailVerified } from "@/lib/auth/email-verification";

export type VerifyEmailResult = { ok?: boolean; error?: string; message?: string };

/**
 * Doğrulama e-postasını (yeniden) gönderir: Supabase auth e-posta bağlantısı (signInWithOtp, yeni hesap AÇMAZ).
 * Bağlantı `/auth/eposta-dogrula` rotasında doğrulama işaretini yazar. Hız sınırı: kullanıcı başına saatte 3.
 * Yumuşak özellik: kayıtta zorunlu değildir, hiçbir özelliği kilitlemez.
 */
export async function resendVerificationEmail(): Promise<VerifyEmailResult> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda e-posta doğrulaması gönderilemez." };

  const { allowed } = await checkRateLimit(`verify-email:${gate.userId}`, { limit: 3, windowSec: 3600, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok fazla deneme yapıldı. Bir saat sonra tekrar deneyin." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || user.id !== gate.userId) return { error: SESSION_EXPIRED_MESSAGE };
  if (isEmailVerified(user)) return { ok: true, message: "E-postanız zaten doğrulanmış." };

  const { error } = await supabase.auth.signInWithOtp({
    email: user.email,
    options: { shouldCreateUser: false, emailRedirectTo: `${getBaseUrl()}/auth/eposta-dogrula` },
  });
  if (error) {
    console.error("resendVerificationEmail", error.message);
    return { error: "Doğrulama e-postası gönderilemedi. Biraz sonra tekrar deneyin." };
  }
  return { ok: true, message: "Doğrulama e-postası gönderildi. Gelen kutunuzu kontrol edin." };
}
