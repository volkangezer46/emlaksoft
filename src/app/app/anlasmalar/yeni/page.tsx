import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { loadCustomFieldInputDefs } from "@/lib/custom-fields/save";
import { NewDealForm } from "./new-deal-form";
import { getStageLabels } from "@/lib/definitions";
import { stageLabelMap } from "@/lib/deal-stage-labels";

export const metadata = { title: "Yeni anlaşma" };

export default async function NewDealPage() {
  const { perms, userId, tenantId } = await requireModulePage("commissions");
  if (!(perms.commissions ?? []).includes("create")) redirect("/app/anlasmalar");
  const supabase = await createClient();

  // Aşama etiketleri, portföy/müşteri listeleri ve özel alanlar bağımsız: TEK turda.
  const [stageLabels, { data: properties }, { data: customers }, customFields] = await Promise.all([
    getStageLabels(),
    supabase
      .from("properties")
      .select("id, property_code, title, list_price, transaction_type")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("customers")
      .select("id, full_name")
      .is("deleted_at", null)
      .order("full_name")
      .limit(200),
    loadCustomFieldInputDefs(supabase, tenantId, "deal"),
  ]);
  const stageNames = stageLabelMap(stageLabels);
  return <NewDealForm properties={properties ?? []} customers={customers ?? []} userId={userId} stageNames={stageNames} customFields={customFields} />;
}
