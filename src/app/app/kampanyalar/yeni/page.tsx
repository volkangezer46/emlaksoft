import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { copyTitle } from "@/lib/record-copy";
import { NewCampaignForm, type CampaignInitial } from "./new-campaign-form";

export default async function YeniKampanyaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { perms, userId, tenantId } = await requireModulePage("campaigns", "/app/kampanyalar");
  if (!(perms.campaigns ?? []).includes("create")) redirect("/app/kampanyalar");
  // "Kaydı çoğalt": ?kopya=<kampanya id> → içerik ön doldurulur; alıcı kuyruğu oluşturmada yeniden hesaplanır.
  const sp = await searchParams;
  const copyId = Array.isArray(sp.kopya) ? sp.kopya[0] : sp.kopya;
  let initial: CampaignInitial | null = null;
  if (copyId && /^[0-9a-f-]{36}$/i.test(copyId) && tenantId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("campaigns")
      .select("title, channel, message, whatsapp_template_name, whatsapp_template_language")
      .eq("id", copyId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (data && (data.channel === "sms" || data.channel === "whatsapp")) {
      initial = {
        title: copyTitle(String(data.title ?? "Kampanya"), 120),
        channel: data.channel,
        message: String(data.message ?? ""),
        // Hedef kitle kampanyada saklanmaz (alıcı kuyruğu oluşturmada hesaplanır): kullanıcı yeniden seçer.
        filter: "all",
        whatsappTemplateName: String(data.whatsapp_template_name ?? ""),
        whatsappTemplateLanguage: String(data.whatsapp_template_language ?? ""),
      };
    }
  }
  return <NewCampaignForm userId={userId} initial={initial} />;
}
