import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { CustomerForm } from "./customer-form";

export const metadata = { title: "Yeni müşteri" };

export default async function NewCustomerPage() {
  const { perms, userId } = await requireModulePage("customers");
  if (!(perms.customers ?? []).includes("create")) redirect("/app/musteriler");

  const supabase = await createClient();
  const [{ data: provinces }, { data: branches }, typeDefs, txDefs, propDefs, urgDefs] = await Promise.all([
    supabase.from("geo_provinces").select("id, name").order("name", { ascending: true }),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    getDefinitionsOrDefault("customer_type"),
    getDefinitionsOrDefault("transaction_type"),
    getDefinitionsOrDefault("property_type"),
    getDefinitionsOrDefault("demand_urgency"),
  ]);

  return (
    <CustomerForm
      provinces={provinces ?? []}
      branches={branches ?? []}
      types={typeDefs.map((t) => t.value)}
      userId={userId}
      canCreateDemand={(perms.demands ?? []).includes("create")}
      transactionTypes={txDefs.map((d) => d.value)}
      propertyTypes={propDefs.map((d) => d.value)}
      urgencyOptions={urgDefs.map((d) => ({ value: d.value, label: d.label }))}
    />
  );
}
