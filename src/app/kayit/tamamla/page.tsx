import { redirect } from "next/navigation";
import { RegisterForm } from "../register-form";
import { loadRegisterFormProps, RegistrationClosed, type RegisterSearchParams } from "../_lib/register-page-data";
import { signOut } from "@/app/actions/auth";
import { hasGoogleIdentity, isGoogleAuthEnabled, GOOGLE_ONBOARDING_PATH } from "@/lib/auth/google-auth";
import { isRegistrationOpen } from "@/lib/platform-flags";
import { createClient } from "@/lib/supabase/server";

// Oturumlu, kişiye özel ara adım: HER ZAMAN noindex (sitemap'e girmez; robots'ta /kayit/tamamla kapalı).
export const metadata = {
  title: "Ofis kurulumunu tamamla",
  description: "Google hesabınızla ofis kurulumunu tamamlayın.",
  robots: { index: false, follow: false },
};

/**
 * Google ile ilk kez gelen (profili/ofisi olmayan) kullanıcının kurulum sihirbazı. Hesap adımı Google'dan
 * gelir; ofis/marka/odak/ekip/demo veri adımları ve rıza `/kayit` ile AYNI bileşen ve AYNI action (`signUp`,
 * `auth_mode=google`). Yarım bırakılırsa proxy bir sonraki `/app` isteğinde buraya yönlendirir.
 */
export default async function CompleteGoogleSignupPage({
  searchParams,
}: {
  searchParams: Promise<RegisterSearchParams>;
}) {
  // searchParams önce: sayfa istek zamanlı (oturuma özel) kalır, bayrak durumundan bağımsız statik üretilmez.
  const params = await searchParams;
  if (!isGoogleAuthEnabled()) redirect("/kayit");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/giris?next=${encodeURIComponent(GOOGLE_ONBOARDING_PATH)}`);
  // Ofisi olan (claim'li) ya da Google kimliği olmayan kullanıcı burada işi yok: kapılar /app'te.
  if (typeof user.app_metadata?.tenant_id === "string" || !hasGoogleIdentity(user)) redirect("/app");

  const { data: staff } = await supabase
    .from("platform_staff")
    .select("id")
    .eq("id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (staff) redirect("/admin");

  if (!(await isRegistrationOpen())) {
    return (
      <RegistrationClosed
        action={
          <form action={signOut} className="mt-6">
            <button
              type="submit"
              className="inline-flex min-h-[42px] items-center rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Çıkış yap
            </button>
          </form>
        }
      />
    );
  }

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name = [meta.full_name, meta.name].find((v): v is string => typeof v === "string" && v.trim() !== "")?.trim() ?? "";
  const props = await loadRegisterFormProps(params);
  return <RegisterForm {...props} googleAccount={{ name: name.slice(0, 120), email: user.email ?? "" }} />;
}
