import { redirect } from "next/navigation";
import { officeAdminCan } from "@/lib/admin/office-admin-access";
import { requirePlatformModule } from "@/lib/platform";
import { OfficeForm } from "./office-form";
import { provinceOptionsResult } from "@/lib/geo/reader";
import { getEffectiveTrialDays } from "@/lib/billing/plan-support";

export const metadata = { title: "Yeni ofis" };

/**
 * Platform yönetiminden ofis açma. Kapı, kayıt action'ı (`createTenantByAdmin`) ile aynıdır:
 * ofis açabilen roller = demo dönüşümünü yapabilen roller ("sales" modülü).
 */
export default async function YeniOfisPage() {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "create")) redirect("/admin/tenants");

  // İl listesi coğrafya merkezinden gelir (aktif iller).
  const [{ data: provinces }, trialDays] = await Promise.all([provinceOptionsResult(), getEffectiveTrialDays()]);

  return (
    <OfficeForm
      provinces={(provinces ?? []) as { id: string; name: string }[]}
      canCreateActive={officeAdminCan(staff.role, "create_active")}
      trialDays={trialDays}
    />
  );
}
