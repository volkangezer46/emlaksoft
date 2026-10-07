import { RoleNotAllowedNotice, StaffNoTenantNotice } from "@/components/app/staff-no-tenant-notice";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { canViewTv, TV_VIEW_ROLES } from "@/lib/tv/tv-logic";
import { TvBoard } from "./tv-board";
import "./tv.css";

export const metadata = { title: "Ofis Panosu · TV" };

/**
 * Ofis Panosu (TV): oturumlu, ofis geneli kapsam rolleri (owner / gm / branch_manager) içindir.
 * Sayfa yalnız kapıyı ve ofis adını çözer; veri istemciden `/api/app/tv-data` ile canlı akar
 * (realtime + yedek yoklama), kabuk tam ekran katmanla örtülür. Gelir/komisyon varsayılan KAPALI.
 */
export default async function PanoTvPage() {
  const { tenantId, role, userId } = await requireModulePage("reports", "/app/pano-tv");

  // Platform personeli ofis bağlamı olmadan gelir (tenantId null): yetki değil bağlam eksik.
  if (!tenantId) return <StaffNoTenantNotice feature="Pano TV" />;
  if (!canViewTv(role)) {
    return (
      <RoleNotAllowedNotice
        feature="Pano TV"
        allowedRoles={TV_VIEW_ROLES}
        role={role}
        alternative={{ href: "/app/performansim", label: "Performansım" }}
      />
    );
  }

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("tenants!profiles_tenant_id_fkey(name)").eq("id", userId).maybeSingle();
  const tenant = profile?.tenants as { name?: string } | { name?: string }[] | null | undefined;
  const officeName = (Array.isArray(tenant) ? tenant[0]?.name : tenant?.name) || "Ofis";

  return <TvBoard tenantId={tenantId} officeName={officeName} />;
}
