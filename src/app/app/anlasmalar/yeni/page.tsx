import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deniedPageHref, requireModulePage } from "@/lib/require-module-page";
import { loadCustomFieldInputDefs } from "@/lib/custom-fields/save";
import { NewDealForm } from "./new-deal-form";
import { getStageLabels } from "@/lib/definitions";
import { stageLabelMap } from "@/lib/deal-stage-labels";
import { readPrefillContext, type PrefillSearchParams } from "@/lib/prefill-params";

export const metadata = { title: "Yeni anlaşma" };

export default async function NewDealPage({ searchParams }: { searchParams?: Promise<PrefillSearchParams> }) {
  const { perms, userId, tenantId } = await requireModulePage("commissions");
  if (!(perms.commissions ?? []).includes("create")) redirect(deniedPageHref("commissions"));
  const supabase = await createClient();
  // Bağlamdan açılış (müşteri 360 / portföy / talep "Anlaşma başlat"): ?customer=&property=&demand= (eş adlar da geçerli).
  // Talep verilip müşteri verilmediyse talebin müşterisi seçilir. Seçiciler yine değiştirilebilir.
  const ctx = readPrefillContext(await searchParams);
  const demandRow = ctx.demandId && !ctx.customerId
    ? (await supabase.from("demands").select("customer_id").eq("id", ctx.demandId).maybeSingle()).data
    : null;
  const customerId = ctx.customerId ?? ((demandRow?.customer_id as string | null | undefined) ?? null);

  // Aşama etiketleri, portföy/müşteri listeleri ve özel alanlar bağımsız: TEK turda.
  const [stageLabels, { data: properties }, { data: customers }, customFields] = await Promise.all([
    getStageLabels(),
    supabase
      .from("properties")
      .select("id, property_code, title, list_price, transaction_type")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("customers")
      .select("id, full_name")
      .is("deleted_at", null)
      .order("full_name")
      .limit(20),
    loadCustomFieldInputDefs(supabase, tenantId, "deal"),
  ]);
  // Ön seçili kayıtlar "son 20" havuzu dışında kalsa da seçicide adıyla görünmeli (tek kayıt, RLS süzgeçli).
  const [{ data: pickedProperty }, { data: pickedCustomer }] = await Promise.all([
    ctx.propertyId && !(properties ?? []).some((p) => p.id === ctx.propertyId)
      ? supabase.from("properties").select("id, property_code, title, list_price, transaction_type").eq("id", ctx.propertyId).is("deleted_at", null).maybeSingle()
      : Promise.resolve({ data: null }),
    customerId && !(customers ?? []).some((c) => c.id === customerId)
      ? supabase.from("customers").select("id, full_name").eq("id", customerId).is("deleted_at", null).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const propertyOptions = pickedProperty ? [pickedProperty, ...(properties ?? [])] : (properties ?? []);
  const customerOptions = pickedCustomer ? [pickedCustomer, ...(customers ?? [])] : (customers ?? []);
  const defaultPropertyId = ctx.propertyId && propertyOptions.some((p) => p.id === ctx.propertyId) ? ctx.propertyId : undefined;
  const defaultCustomerId = customerId && customerOptions.some((c) => c.id === customerId) ? customerId : undefined;
  const stageNames = stageLabelMap(stageLabels);
  return (
    <NewDealForm
      properties={propertyOptions}
      customers={customerOptions}
      defaultPropertyId={defaultPropertyId}
      defaultCustomerId={defaultCustomerId}
      userId={userId}
      stageNames={stageNames}
      customFields={customFields}
    />
  );
}
