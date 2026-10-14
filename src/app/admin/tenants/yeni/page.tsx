import { redirect } from "next/navigation";
import { officeAdminCan } from "@/lib/admin/office-admin-access";
import { requirePlatformModule } from "@/lib/platform";
import { OfficeForm } from "./office-form";
import { provinceOptionsResult } from "@/lib/geo/reader";
import { getEffectiveTrialDays } from "@/lib/billing/plan-support";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { adminAssignablePlans, PLANS } from "@/lib/billing/plans";

export const metadata = { title: "Yeni ofis" };

/**
 * Platform yönetiminden ofis açma. Kapı, kayıt action'ı (`createTenantByAdmin`) ile aynıdır:
 * ofis açabilen roller = demo dönüşümünü yapabilen roller ("sales" modülü).
 */
export default async function YeniOfisPage() {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff, "create")) redirect("/admin/tenants");

  // İl listesi coğrafya merkezinden gelir (aktif iller).
  // Paketler katalogdan (DG2): taban paketler admin düzenlemesiyle + adminden eklenenler; arşivli ve gizli şablon hariç.
  // Katalog okunamazsa kod tanımlı taban paketler (ofis açma yine çalışır; eylem aynı kuralla doğrular).
  const [{ data: provinces }, trialDays, catalog] = await Promise.all([
    provinceOptionsResult(),
    getEffectiveTrialDays(),
    getPlanDefinitions().catch(() => null),
  ]);
  const plans = adminAssignablePlans(catalog ?? PLANS);

  return (
    <OfficeForm
      provinces={(provinces ?? []) as { id: string; name: string }[]}
      canCreateActive={officeAdminCan(staff, "create_active")}
      trialDays={trialDays}
      plans={plans}
    />
  );
}
