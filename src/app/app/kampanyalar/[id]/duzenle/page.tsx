import { notFound, redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { getCampaign } from "@/app/actions/campaigns";
import { EditCampaignForm } from "./edit-campaign-form";

export const metadata = { title: "Kampanyayı düzenle" };

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { perms } = await requireModulePage("campaigns", "/app/kampanyalar");
  const { id } = await params;
  if (!(perms.campaigns ?? []).includes("edit")) redirect(`/app/kampanyalar/${id}`);
  const campaign = await getCampaign(id);
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
    />
  );
}
