import type { User } from "@supabase/supabase-js";

/**
 * E-posta doğrulama durumu (YUMUŞAK: yalnız bilgi şeridi, hiçbir özelliği kilitlemez).
 *
 * Kayıt/ekip hesapları `email_confirm: true` ile açıldığı için Supabase `email_confirmed_at` her hesapta doludur;
 * bu yüzden gerçek doğrulama kanıtı kullanıcı meta verisindeki `email_verified_at` işaretidir. Şerit "Doğrulama
 * e-postasını gönder" ile Supabase'in e-posta bağlantısını (signInWithOtp) yollar; bağlantı
 * `/auth/eposta-dogrula` rotasında işareti yazar. Google ile girenlerin e-postası sağlayıcıca doğrulanmıştır.
 * Kritik e-posta gönderimi bu işarete BAĞLANMAZ (işaret kullanıcı tarafından yazılabilir; yalnız bilgi amaçlı).
 */
export const EMAIL_VERIFIED_META_KEY = "email_verified_at";

export function isEmailVerified(user: Pick<User, "app_metadata" | "user_metadata"> | null | undefined): boolean {
  if (!user) return true;
  const mark = user.user_metadata?.[EMAIL_VERIFIED_META_KEY];
  if (typeof mark === "string" && mark.length > 0) return true;
  const providers = user.app_metadata?.providers;
  if (user.app_metadata?.provider === "google") return true;
  return Array.isArray(providers) && providers.includes("google");
}
