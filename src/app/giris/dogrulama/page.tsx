import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  isTwoFactorCookieValid,
  TWO_FACTOR_COOKIE,
  twoFactorBindingFromClaims,
} from "@/lib/two-factor";
import { maskPhone } from "@/app/imza/_lib/sms";
import { VerifyForm } from "./verify-form";
import { TotpVerifyForm } from "./verify-totp-form";
import { safeNextPath } from "@/lib/auth/safe-next";

export const metadata = {
  title: "Giriş Doğrulama",
  description: "Authenticator uygulamasındaki ya da SMS ile gönderilen giriş kodunu doğrulayın.",
  robots: { index: false, follow: false },
};

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; kaynak?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/giris");

  const { data: profile } = await supabase
    .from("profiles")
    .select("two_factor_sms, two_factor_method, two_factor_version, phone, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_active) redirect("/giris?reason=inactive_or_invalid_identity");
  if (!profile.two_factor_sms) redirect(next);

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const binding = claimsError
    ? null
    : twoFactorBindingFromClaims(
        user.id,
        profile.two_factor_version,
        claimsData?.claims,
      );
  const cookieStore = await cookies();
  if (
    binding &&
    await isTwoFactorCookieValid(cookieStore.get(TWO_FACTOR_COOKIE)?.value, binding)
  ) {
    redirect(next);
  }

  if (profile.two_factor_method === "totp") {
    // Authenticator yöntemi: doğrulanmış TOTP faktörü istemcide challenge/verify için gerekir. Faktör yoksa (ör. silinmiş)
    // yalnız kurtarma kodu yolu açık kalır.
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = factors?.totp.find((f) => f.status === "verified") ?? null;
    return <TotpVerifyForm next={next} factorId={verified?.id ?? null} viaGoogle={params.kaynak === "google"} />;
  }

  return (
    <VerifyForm
      next={next}
      maskedPhone={profile.phone ? maskPhone(profile.phone) : "Telefon tanimli degil"}
      autoSend={params.kaynak === "google"}
    />
  );
}
