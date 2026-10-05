import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { getProvinceOptions } from "@/lib/geo/reader";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { isPoolEnabled } from "@/lib/pool/server";
import { PropertyForm } from "./property-form";

export const metadata = { title: "Yeni portföy" };

export default async function NewPropertyPage() {
  const { perms, userId, tenantId } = await requireModulePage("properties", "/app/portfoyler");
  if (!(perms.properties ?? []).includes("create")) redirect("/app/portfoyler");

  const supabase = await createClient();
  const [provinces, { data: branches }, propertyTypes, transactionTypes, poolEnabled] = await Promise.all([
    // İl listesi 81 satırlık sabit referans verisi — istekler arası cache'li (src/lib/geo.ts)
    getProvinceOptions(),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    getDefinitionsOrDefault("property_type"),
    getDefinitionsOrDefault("transaction_type"),
    tenantId ? isPoolEnabled(supabase, tenantId) : Promise.resolve(false),
  ]);

  return (
    <PropertyForm
      provinces={provinces}
      branches={branches ?? []}
      propertyTypes={propertyTypes.map((d) => d.value)}
      transactionTypes={transactionTypes.map((d) => d.value)}
      userId={userId}
      poolEnabled={poolEnabled}
    />
  );
}
