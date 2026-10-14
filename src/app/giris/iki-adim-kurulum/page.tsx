import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isTenantSmsAvailable } from "@/lib/messaging/tenant-providers";
import { readOfficeSecurityPolicyCached } from "@/lib/office-security/policy-cache";
import { SetupForm } from "./setup-form";

export const metadata = {
  title: "İki adımlı doğrulama kurulumu",
  description: "Telefonunuzu doğrulayarak iki adımlı doğrulamayı açın.",
  robots: { index: false, follow: false },
};

/**
 * DG7: ofis politikası rolü için 2FA'yı zorunlu kıldığında proxy bu ekrana yönlendirir (kurulmadan /app açılmaz).
 * /app dışında olduğundan modül/paket kapısı yoktur; kimlik ve ofis eşleşmesi eylemlerde ayrıca doğrulanır.
 */
export default async function TwoFactorSetupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const next = params.next && /^\/(?![/\\])/.test(params.next) ? params.next : "/app";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/giris");

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, role, is_active, two_factor_sms, phone")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_active || !profile.tenant_id) redirect("/giris?reason=inactive_or_invalid_identity");
  // Zaten açık: normal doğrulama akışı (proxy gerekirse /giris/dogrulama'ya yönlendirir).
  if (profile.two_factor_sms) redirect(next);

  const [policy, smsReady] = await Promise.all([
    readOfficeSecurityPolicyCached(profile.tenant_id),
    isTenantSmsAvailable(profile.tenant_id).catch(() => false),
  ]);
  const required = Boolean(policy && profile.role && policy.mfaRoles.includes(profile.role));

  return <SetupForm next={next} phone={profile.phone ?? null} required={required} smsReady={smsReady} />;
}
