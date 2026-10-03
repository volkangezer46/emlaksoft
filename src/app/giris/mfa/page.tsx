import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPlatformMfaCandidate } from "@/lib/platform";
import { isPlatformMfaRequired } from "@/lib/platform-mfa";
import { PlatformMfaForm } from "./platform-mfa-form";

export const metadata = {
  title: "Platform Güvenlik Doğrulaması",
  description: "Platform yönetimi için zorunlu authenticator doğrulaması.",
  robots: { index: false, follow: false },
};

function safeAdminNext(value: string | undefined) {
  return value && /^\/admin(?:\/|$|\?)/.test(value) ? value : "/admin";
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

  // Geliştirme sürecinde platform MFA kapalı: doğrulama sayfası gereksiz (bkz. src/lib/platform-mfa.ts).
  if (!isPlatformMfaRequired()) redirect(next);

  const candidate = await getPlatformMfaCandidate();
  if (!candidate || user.app_metadata?.impersonating === true) redirect("/app");

  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw new Error("Platform MFA oturumu doğrulanamadı.");
  if (assurance.currentLevel === "aal2") redirect(next);

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
