import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopbar } from "@/components/admin/admin-topbar";
import { requirePlatformStaff } from "@/lib/platform";
import { PLATFORM_ROLE_LABELS, platformModulesFor } from "@/lib/platform-access";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requirePlatformStaff();
  const roleLabel = PLATFORM_ROLE_LABELS[staff.role] ?? staff.role;
  const modules = platformModulesFor(staff.role);

  // Sidebar rozet sayıları — role göre ilgili olanlar
  const admin = createAdminClient();
  const [ticketRes, riskRes, salesRes] = await Promise.all([
    modules.includes("tickets")
      ? admin.from("support_tickets").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress", "waiting"])
      : Promise.resolve({ count: 0 }),
    modules.includes("tenants")
      ? admin.from("tenants").select("id", { count: "exact", head: true }).in("status", ["past_due", "suspended"])
      : Promise.resolve({ count: 0 }),
    modules.includes("sales")
      ? admin.from("demo_requests").select("id", { count: "exact", head: true }).eq("status", "new")
      : Promise.resolve({ count: 0 }),
  ]);

  const badges = {
    tickets: ticketRes.count ?? 0,
    risk: riskRes.count ?? 0,
    sales: salesRes.count ?? 0,
  };

  return (
    <div className="flex min-h-screen bg-canvas">
      <AdminSidebar staffName={staff.full_name} role={staff.role} roleLabel={roleLabel} badges={badges} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar roleLabel={roleLabel} modules={modules} />
        <main id="main-content" className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
