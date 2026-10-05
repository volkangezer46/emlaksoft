import { Suspense } from "react";
import { RouteSplash } from "@/components/route-splash";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopbar } from "@/components/admin/admin-topbar";
import { mustChangePassword, requirePlatformStaffForAccount } from "@/lib/platform";
import { PLATFORM_ROLE_LABELS, platformModulesFor } from "@/lib/platform-access";
import { getAdminBadges, getAdminHealth } from "@/lib/admin-badges";
import "@/app/console.css";
import { SidebarBoot } from "@/components/ui/console/sidebar-boot";
import { ThemeController } from "@/components/theme-controller";
import { PLATFORM_MFA_DB_SETTING_KEY, isPlatformMfaRequired, platformMfaSyncIssue } from "@/lib/platform-mfa";
import { getPlatformSetting } from "@/lib/platform-settings";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { cookies } from "next/headers";
import { FontScaleBoot } from "@/components/font-scale-boot";
import { FONT_SCALE_COOKIE, FONT_SCALE_META_KEY, resolveFontScale } from "@/lib/font-scale";
import { OwnPasswordForm } from "@/app/admin/hesabim/account-forms";

/** Kok loading.tsx kaldirildi: kabuk sorgulari Suspense icinde, splash hemen ustunde. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<RouteSplash />}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}

async function AdminShell({ children }: { children: React.ReactNode }) {
  const staff = await requirePlatformStaffForAccount();

  // Geçici parolayla açılan hesap: kendi parolasını belirleyene dek yönetim kabuğu açılmaz.
  const user = await getRequestUser();
  const jar = await cookies();
  const fontScale = resolveFontScale({
    userId: user?.id,
    cookieValue: jar.get(FONT_SCALE_COOKIE)?.value,
    metadataValue: user?.user_metadata?.[FONT_SCALE_META_KEY],
  });
  if (mustChangePassword(user)) {
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

  const roleLabel = PLATFORM_ROLE_LABELS[staff.role] ?? staff.role;
  const modules = platformModulesFor(staff.role);

  // Sidebar rozet sayıları — 30 sn önbellekli (bkz. admin-badges.ts); her
  // gezinmede 3 count sorgusu koşmasın.
  const [badges, health] = await Promise.all([
    getAdminBadges(modules),
    modules.includes("sistem") ? getAdminHealth().catch(() => null) : Promise.resolve(null),
  ]);

  // MFA tek kaynak uyumu: env ile DB ayarı (SQL kapıları yalnız ayara bakar) ayrışırsa uyarı şeridi.
  const mfaSyncIssue = platformMfaSyncIssue(isPlatformMfaRequired(), await getPlatformSetting(PLATFORM_MFA_DB_SETTING_KEY));

  return (
    <div className="flex min-h-screen bg-canvas">
      <ThemeController />
      <FontScaleBoot scale={fontScale} />
      <SidebarBoot />
      <AdminSidebar staffName={staff.full_name} role={staff.role} roleLabel={roleLabel} badges={badges} health={health} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar roleLabel={roleLabel} staffName={staff.full_name} modules={modules} fontScale={fontScale} />
        {mfaSyncIssue === "env_on_db_off" ? (
          <p role="alert" className="border-b border-red-300/50 bg-red-50 px-4 py-1.5 text-center text-xs font-semibold text-red-800">
            MFA tutarsız: PLATFORM_MFA_ENFORCEMENT açık ama platform_settings &quot;platform.mfa_enforced&quot; kapalı; veritabanı personel kapıları MFA istemiyor. Ayarı da açın.
          </p>
        ) : null}
        {!isPlatformMfaRequired() ? (
          <p role="status" className="border-b border-amber-300/50 bg-amber-50 px-4 py-1.5 text-center text-xs font-semibold text-amber-800">
            Geliştirme modu: platform iki adımlı doğrulaması (TOTP) kapalı. Yayın öncesi PLATFORM_MFA_ENFORCEMENT=on yapın.
          </p>
        ) : null}
        {/* grid + minmax(0,1fr): geniş tablolar kendi kaplarında kaydırılır,
            belgeyi şişirmez (iOS `overflow:clip` viewport'a propagate etmiyor). */}
        <main
          id="main-content"
          className="grid min-w-0 max-w-full flex-1 grid-cols-[minmax(0,1fr)] content-start overflow-x-clip p-4 pb-24 md:p-6 md:pb-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
