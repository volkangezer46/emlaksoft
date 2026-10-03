import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { getProvincesCached } from "@/lib/geo";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { PropertyForm } from "./property-form";

export const metadata = { title: "Yeni portföy" };

export default async function NewPropertyPage() {
  const { perms, userId } = await requireModulePage("properties", "/app/portfoyler");
  if (!(perms.properties ?? []).includes("create")) redirect("/app/portfoyler");

  const supabase = await createClient();
  const [provinces, { data: branches }, propertyTypes, transactionTypes] = await Promise.all([
    // İl listesi 81 satırlık sabit referans verisi — istekler arası cache'li (src/lib/geo.ts)
    getProvincesCached(),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    getDefinitionsOrDefault("property_type"),
    getDefinitionsOrDefault("transaction_type"),
  ]);

  return (
    <PropertyForm
      provinces={provinces}
      branches={branches ?? []}
      propertyTypes={propertyTypes.map((d) => d.value)}
      transactionTypes={transactionTypes.map((d) => d.value)}
      userId={userId}
    />
  );
}
