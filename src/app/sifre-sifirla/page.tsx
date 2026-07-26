import { ForgotPasswordForm } from "./forgot-form";

export const metadata = {
  title: "Şifremi Unuttum",
  description: "EmlakSoft hesabınız için şifre sıfırlama bağlantısı isteyin.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
