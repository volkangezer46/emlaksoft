import { ResetPasswordForm } from "./reset-form";

export const metadata = {
  title: "Yeni Şifre Belirle",
  description: "EmlakSoft hesabınız için yeni şifrenizi belirleyin.",
  robots: { index: false, follow: false },
};

/**
 * E-postadaki sıfırlama bağlantısı buraya iner. Ayrı bir callback route'u yok:
 * `createBrowserClient` (PKCE + detectSessionInUrl) URL'deki `?code=` veya
 * `#access_token` parametrelerini istemcide otomatik oturuma çevirir; form da
 * bu recovery oturumuyla `updateUser({ password })` çağırır.
 */
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
