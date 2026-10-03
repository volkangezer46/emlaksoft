import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { DemandForm } from "@/app/app/talepler/yeni/demand-form";

export const metadata = { title: "Yeni talep" };

export default async function NewCustomerDemandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { perms, userId } = await requireModulePage("customers");
  const customerHref = `/app/musteriler/${id}`;
  if (!(perms.demands ?? []).includes("create")) redirect(customerHref);

  const supabase = await createClient();
  const [{ data: customer }, { data: provinces }, txDefs, propDefs, urgDefs] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name, province_id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("geo_provinces").select("id, name").order("name", { ascending: true }),
    getDefinitionsOrDefault("transaction_type"),
    getDefinitionsOrDefault("property_type"),
    getDefinitionsOrDefault("demand_urgency"),
  ]);
  if (!customer) notFound();

  return (
    <DemandForm
      userId={userId}
      fixedCustomer={{ id: customer.id, full_name: customer.full_name }}
      provinces={provinces ?? []}
      defaultProvinceId={customer.province_id}
      transactionTypes={txDefs.map((d) => d.value)}
      propertyTypes={propDefs.map((d) => d.value)}
      urgencyOptions={urgDefs.map((d) => ({ value: d.value, label: d.label }))}
      cancelHref={customerHref}
      breadcrumbs={[
        { label: "Müşteriler", href: "/app/musteriler" },
        { label: customer.full_name, href: customerHref },
        { label: "Yeni talep" },
      ]}
      description={customer.full_name}
    />
  );
}
