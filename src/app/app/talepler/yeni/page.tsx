import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { DemandForm } from "./demand-form";

export const metadata = { title: "Yeni talep" };

export default async function NewDemandPage({
  searchParams,
}: {
  searchParams: Promise<{ musteri?: string }>;
}) {
  const { perms, userId } = await requireModulePage("demands");
  if (!(perms.demands ?? []).includes("create")) redirect("/app/talepler");

  const { musteri } = await searchParams;
  const supabase = await createClient();
  const [{ data: customers }, { data: provinces }, txDefs, propDefs, urgDefs, preselected] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("geo_provinces").select("id, name").order("name", { ascending: true }),
    getDefinitionsOrDefault("transaction_type"),
    getDefinitionsOrDefault("property_type"),
    getDefinitionsOrDefault("demand_urgency"),
    // ?musteri= ilk 300 içinde olmayabilir; RLS tenant izolasyonunu korur.
    musteri
      ? supabase.from("customers").select("id, full_name").eq("id", musteri).is("deleted_at", null).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const list = customers ?? [];
  const pre = preselected.data;
  const options = pre && !list.some((c) => c.id === pre.id) ? [pre, ...list] : list;

  return (
    <DemandForm
      userId={userId}
      customers={options}
      defaultCustomerId={pre?.id}
      provinces={provinces ?? []}
      transactionTypes={txDefs.map((d) => d.value)}
      propertyTypes={propDefs.map((d) => d.value)}
      urgencyOptions={urgDefs.map((d) => ({ value: d.value, label: d.label }))}
      cancelHref="/app/talepler"
      breadcrumbs={[{ label: "Talepler", href: "/app/talepler" }, { label: "Yeni talep" }]}
      description="Müşteri seçin ve kriterleri girin."
    />
  );
}
