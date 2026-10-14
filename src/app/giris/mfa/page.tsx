import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/server";
import { getPlatformMfaCandidate } from "@/lib/platform";
import { isPlatformMfaRequiredNow } from "@/lib/platform-mfa";
import { PlatformMfaForm } from "./platform-mfa-form";

export const metadata = {
  title: "Platform Güvenlik Doğrulaması",
  description: "Platform yönetimi için zorunlu authenticator doğrulaması.",
  robots: { index: false, follow: false },
};

function safeAdminNext(value: string | undefined) {
  const next = safeNextPath(value, "/admin");
  return /^\/admin(?:\/|$|\?)/.test(next) ? next : "/admin";
}

export default async function PlatformMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeAdminNext((await searchParams).next);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/giris?next=${encodeURIComponent(next)}`);

  // MFA zorunlu değilse (yönetim anahtarı/env kapalı) doğrulama sayfası gereksiz (bkz. src/lib/platform-mfa.ts).
  if (!(await isPlatformMfaRequiredNow(true))) redirect(next);

  const candidate = await getPlatformMfaCandidate();
  if (!candidate || user.app_metadata?.impersonating === true) redirect("/app");

  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw new Error("Platform MFA oturumu doğrulanamadı.");
  if (assurance.currentLevel === "aal2") redirect(next);
  // Geçiş süresinde doğrulayıcısı olmayan personel parolayla devam eder (kurulum Hesabım > Güvenlik'te).
  if (!(await isPlatformMfaRequiredNow(assurance.nextLevel === "aal2"))) redirect(next);

  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError) throw new Error("Platform MFA faktörleri okunamadı.");
  const verifiedTotp = factors.totp.find((factor) => factor.status === "verified") ?? null;

  return (
    <PlatformMfaForm
      next={next}
      existingFactorId={verifiedTotp?.id ?? null}
      staffName={candidate.full_name}
    />
  );
}
