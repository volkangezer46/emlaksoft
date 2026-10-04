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
import { isPlatformMfaRequired } from "@/lib/platform-mfa";
import { getRequestUser } from "@/lib/supabase/auth-cache";
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
  if (mustChangePassword(user)) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas p-4">
        <ThemeController />
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

  return (
    <div className="flex min-h-screen bg-canvas">
      <ThemeController />
      <SidebarBoot />
      <AdminSidebar staffName={staff.full_name} role={staff.role} roleLabel={roleLabel} badges={badges} health={health} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar roleLabel={roleLabel} staffName={staff.full_name} modules={modules} />
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
