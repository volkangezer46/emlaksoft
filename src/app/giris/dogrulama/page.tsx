import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isTwoFactorCookieValid, TWO_FACTOR_COOKIE } from "@/lib/two-factor";
import { maskPhone } from "@/app/imza/_lib/sms";
import { VerifyForm } from "./verify-form";

export const metadata = {
  title: "Giriş Doğrulama",
  description: "SMS ile gönderilen giriş kodunu doğrulayın.",
  robots: { index: false, follow: false },
};

/**
 * SMS 2FA ara adımı — şifre doğrulandı, oturum açık; ancak es_2fa_ok çerezi
 * set edilene dek middleware /app - /admin'i buraya yönlendirir.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = params.next?.startsWith("/") ? params.next : "/app";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/giris");

  const cookieStore = await cookies();
  if (await isTwoFactorCookieValid(cookieStore.get(TWO_FACTOR_COOKIE)?.value, user.id)) {
    redirect(next); // zaten doğrulanmış
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("two_factor_sms, phone")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.two_factor_sms || !profile.phone) redirect(next); // 2FA gerekli değil

  return <VerifyForm next={next} maskedPhone={maskPhone(profile.phone)} />;
}
