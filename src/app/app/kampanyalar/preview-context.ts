import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/base-url";
import type { CampaignPreviewContext } from "./campaign-message-field";

/**
 * Kampanya mesaj önizlemesinin ofis bağlamı (yeni + düzenle ortak): ofis adı/telefonu, vitrin bağlantısı ({portfoy_link}),
 * oturumdaki kullanıcının adı ({danisman} yedeği) ve aktif danışman adları. Bağımsız sorgular tek turda.
 */
export async function loadCampaignPreviewContext(tenantId: string | null, userId: string): Promise<CampaignPreviewContext> {
  if (!tenantId) return { officeName: "", officePhone: "", portfolioUrl: "", userName: "", advisorNames: {} };
  const supabase = await createClient();
  const [{ data: tenant }, { data: profiles }] = await Promise.all([
    supabase.from("tenants").select("name, phone, slug").eq("id", tenantId).maybeSingle(),
    supabase.from("profiles").select("id, full_name").eq("tenant_id", tenantId).eq("is_active", true).limit(300),
  ]);
  const advisorNames: Record<string, string> = {};
  for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) {
    if (p.full_name?.trim()) advisorNames[p.id] = p.full_name.trim();
  }
  const t = tenant as { name?: string | null; phone?: string | null; slug?: string | null } | null;
  let portfolioUrl = "";
  if (t?.slug) {
    try {
      portfolioUrl = `${getBaseUrl().replace(/\/$/, "")}/vitrin/${encodeURIComponent(t.slug)}`;
    } catch {
      portfolioUrl = "";
    }
  }
  return {
    officeName: t?.name ?? "",
    officePhone: t?.phone ?? "",
    portfolioUrl,
    userName: advisorNames[userId] ?? "",
    advisorNames,
  };
}
