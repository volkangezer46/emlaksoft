import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ThemeController } from "@/components/theme-controller";
import { FontScaleBoot } from "@/components/font-scale-boot";
import { OwnPasswordForm } from "@/app/admin/hesabim/account-forms";
import { mustChangePassword, requirePlatformStaffForAccount } from "@/lib/platform";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { FONT_SCALE_COOKIE, FONT_SCALE_META_KEY, resolveFontScale } from "@/lib/font-scale";

export const metadata = { title: "Parolanızı değiştirin" };

/**
 * Geçici parolayla açılan personel hesabı: kendi parolasını belirleyene dek yönetim kabuğu açılmaz. Yönetim layout'u
 * böyle bir hesabı buraya yönlendirir (eskiden aynı ekranı layout içinde çiziyordu; parola formu her yönetim sayfasının
 * paketine giriyordu). Parola değişince form `router.refresh()` yapar; bayrak kalkmışsa panele dönülür.
 */
export default async function ForcedPasswordPage() {
  const user = await getRequestUser();
  const staff = await requirePlatformStaffForAccount();
  if (!mustChangePassword(user)) redirect("/admin");
  const jar = await cookies();
  const fontScale = resolveFontScale({
    userId: user?.id,
    cookieValue: jar.get(FONT_SCALE_COOKIE)?.value,
    metadataValue: user?.user_metadata?.[FONT_SCALE_META_KEY],
  });
  return (
    <div className="grid min-h-screen place-items-center bg-canvas p-4">
      <ThemeController />
      <FontScaleBoot scale={fontScale} />
      <div className="w-full max-w-xl space-y-4">
        <p role="status" className="rounded-[var(--radius-card)] border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {staff.full_name}, güvenliğiniz için yönetim paneline girmeden önce parolanızı değiştirmeniz gerekiyor.
        </p>
        <OwnPasswordForm forced />
      </div>
    </div>
  );
}
