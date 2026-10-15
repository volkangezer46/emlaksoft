import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { copyTitle } from "@/lib/record-copy";
import { CAMPAIGN_OPEN_DEMAND_STATUSES, isValidCampaignTag } from "@/lib/campaign-audience";
import { NewCampaignForm, type CampaignAudienceOptions, type CampaignInitial } from "./new-campaign-form";

export const metadata = { title: "Yeni kampanya" };

export default async function YeniKampanyaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { perms, userId, tenantId } = await requireModulePage("campaigns", "/app/kampanyalar");
  if (!(perms.campaigns ?? []).includes("create")) redirect("/app/kampanyalar");
  // "Kaydı çoğalt": ?kopya=<kampanya id> → içerik ön doldurulur; alıcı kuyruğu oluşturmada yeniden hesaplanır.
  const sp = await searchParams;
  const copyId = Array.isArray(sp.kopya) ? sp.kopya[0] : sp.kopya;
  const audienceOptions = tenantId ? await loadAudienceOptions(tenantId) : EMPTY_AUDIENCE_OPTIONS;
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
  return <NewCampaignForm userId={userId} initial={initial} audienceOptions={audienceOptions} />;
}

const EMPTY_AUDIENCE_OPTIONS: CampaignAudienceOptions = { tags: [], districts: [], advisors: [] };
const AUDIENCE_SCAN_LIMIT = 5000;

/** Hedef kitle seçenekleri: kiracıdaki etiketler, açık talep ilçeleri ve aktif danışmanlar (bağımsız sorgular paralel). */
async function loadAudienceOptions(tenantId: string): Promise<CampaignAudienceOptions> {
  const supabase = await createClient();
  const [tagsRes, demandsRes, advisorsRes] = await Promise.all([
    supabase
      .from("customers")
      .select("tags")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .not("tags", "eq", "{}")
      .limit(AUDIENCE_SCAN_LIMIT),
    supabase
      .from("customer_demands")
      .select("district_id, district:geo_districts!customer_demands_district_id_fkey(name)")
      .eq("tenant_id", tenantId)
      .in("status", [...CAMPAIGN_OPEN_DEMAND_STATUSES])
      .not("district_id", "is", null)
      .limit(AUDIENCE_SCAN_LIMIT),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("full_name")
      .limit(200),
  ]);

  const tags = new Set<string>();
  for (const row of (tagsRes.data ?? []) as { tags: string[] | null }[]) {
    for (const t of row.tags ?? []) if (isValidCampaignTag(t)) tags.add(t);
  }
  const districts = new Map<string, string>();
  for (const row of (demandsRes.data ?? []) as unknown as { district_id: string; district: { name: string } | { name: string }[] | null }[]) {
    const d = Array.isArray(row.district) ? row.district[0] : row.district;
    if (row.district_id && !districts.has(row.district_id)) districts.set(row.district_id, d?.name ?? "İlçe");
  }
  const collator = new Intl.Collator("tr-TR");
  return {
    tags: [...tags].sort(collator.compare),
    districts: [...districts].map(([id, name]) => ({ id, name })).sort((a, b) => collator.compare(a.name, b.name)),
    advisors: ((advisorsRes.data ?? []) as { id: string; full_name: string | null }[]).map((p) => ({
      id: p.id,
      name: p.full_name?.trim() || "Adsız kullanıcı",
    })),
  };
}
