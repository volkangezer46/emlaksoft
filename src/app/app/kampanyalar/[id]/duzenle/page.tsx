import { notFound, redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { getCampaign } from "@/app/actions/campaigns";
import { EditCampaignForm } from "./edit-campaign-form";
import { createClient } from "@/lib/supabase/server";
import { loadCampaignPreviewContext } from "../../preview-context";

export const metadata = { title: "Kampanyayı düzenle" };

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { perms, tenantId, userId } = await requireModulePage("campaigns", "/app/kampanyalar");
  const { id } = await params;
  if (!(perms.campaigns ?? []).includes("edit")) redirect(`/app/kampanyalar/${id}`);
  const [campaign, previewContext, sampleRows] = await Promise.all([
    getCampaign(id),
    loadCampaignPreviewContext(tenantId, userId),
    loadRecipientSamples(id),
  ]);
  if (!campaign) notFound();
  // Yalnız taslak düzenlenir; gönderilmiş kampanya salt okunur detaya döner.
  if (campaign.status !== "draft") redirect(`/app/kampanyalar/${id}`);
  return (
    <EditCampaignForm
      campaign={{
        id: campaign.id,
        title: campaign.title,
        channel: campaign.channel,
        message: campaign.message ?? "",
        whatsappTemplateName: campaign.whatsapp_template_name ?? "",
        whatsappTemplateLanguage: campaign.whatsapp_template_language ?? "tr",
      }}
      previewContext={previewContext}
      samples={sampleRows.samples}
      longestName={sampleRows.longestName}
    />
  );
}

/** Taslağın alıcı kuyruğundan önizleme örnekleri (ilk 5 ad + sorumlu danışman) ve en uzun ad (SMS boyu bu adla). */
async function loadRecipientSamples(campaignId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaign_recipients")
    .select("full_name, customer:customers!campaign_recipients_customer_id_fkey(assigned_to)")
    .eq("campaign_id", campaignId)
    .order("full_name", { ascending: true })
    .limit(1000);
  type Row = { full_name: string | null; customer: { assigned_to: string | null } | { assigned_to: string | null }[] | null };
  const samples: { name: string; advisorId: string | null }[] = [];
  let longestName = "";
  for (const r of (data ?? []) as unknown as Row[]) {
    const name = (r.full_name ?? "").trim();
    if (!name) continue;
    const cust = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    if (samples.length < 5) samples.push({ name, advisorId: cust?.assigned_to ?? null });
    if (name.length > longestName.length) longestName = name;
  }
  return { samples, longestName };
}
