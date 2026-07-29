import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopbar } from "@/components/admin/admin-topbar";
import { requirePlatformStaff } from "@/lib/platform";
import { PLATFORM_ROLE_LABELS, platformModulesFor } from "@/lib/platform-access";
import { getAdminBadges } from "@/lib/admin-badges";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requirePlatformStaff();
  const roleLabel = PLATFORM_ROLE_LABELS[staff.role] ?? staff.role;
  const modules = platformModulesFor(staff.role);

  // Sidebar rozet sayıları — 30 sn önbellekli (bkz. admin-badges.ts); her
  // gezinmede 3 count sorgusu koşmasın.
  const badges = await getAdminBadges(modules);

  return (
    <div className="flex min-h-screen bg-canvas">
      <AdminSidebar staffName={staff.full_name} role={staff.role} roleLabel={roleLabel} badges={badges} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar roleLabel={roleLabel} modules={modules} />
        {/* pb-24 (mobil alt-nav) + overflow-x-clip (geniş tablolar ICB'yi şişirmesin) */}
        <main id="main-content" className="min-w-0 max-w-full flex-1 overflow-x-clip p-4 pb-24 md:p-6 md:pb-6">{children}</main>
      </div>
    </div>
  );
}
