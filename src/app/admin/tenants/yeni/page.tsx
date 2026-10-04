import { redirect } from "next/navigation";
import { officeAdminCan } from "@/lib/admin/office-admin-access";
import { requirePlatformModule } from "@/lib/platform";
import { createClient } from "@/lib/supabase/server";
import { OfficeForm } from "./office-form";

export const metadata = { title: "Yeni ofis" };

/**
 * Platform yönetiminden ofis açma. Kapı, kayıt action'ı (`createTenantByAdmin`) ile aynıdır:
 * ofis açabilen roller = demo dönüşümünü yapabilen roller ("sales" modülü).
 */
export default async function YeniOfisPage() {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "create")) redirect("/admin/tenants");

  // İl listesi herkese açık referans verisidir (RLS'li istemci yeterli; service_role gerekmez).
  const supabase = await createClient();
  const { data: provinces } = await supabase.from("geo_provinces").select("id, name").order("name", { ascending: true });

  return (
    <OfficeForm
      provinces={(provinces ?? []) as { id: string; name: string }[]}
      canCreateActive={officeAdminCan(staff.role, "create_active")}
    />
  );
}
