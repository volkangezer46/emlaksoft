import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { isVitrinEnabled } from "@/lib/vitrin-settings";
import { readTenantSettings } from "@/lib/settings/tenant-read";
import { VITRIN_AI_CHAT_KEY } from "@/lib/settings/registry/tenant";
import { searchVitrinListingIds } from "@/lib/vitrin/listing-search";
import type { ListingFilters } from "@/lib/vitrin/listing-filters";

/**
 * Vitrin yüzeyinin sunucu kapısı (service_role YALNIZ burada; kabul listesi). Vitrin sayfasıyla AYNI okuma: slug → etkin
 * ofis + vitrin açık mı; sayım vitrinin kendi arama RPC'si (`searchVitrinListingIds`: yalnız yayındaki, örnek olmayan
 * ilanlar). GPT yalnız ofisin "vitrin sohbet asistanı" ayarı açıksa (varsayılan KAPALI) ve kredisi varsa kullanılır.
 */
export type VitrinOffice = { tenantId: string; name: string; slug: string; aiChat: boolean };

export async function resolveVitrinOffice(slug: string): Promise<VitrinOffice | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,119}$/.test(slug)) return null;
  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("id, name, slug, status").eq("slug", slug).maybeSingle();
  if (!tenant || !isPublicTenantActive(tenant.status as string | null)) return null;
  const [enabled, settings] = await Promise.all([
    isVitrinEnabled(admin, tenant.id as string).catch(() => true),
    readTenantSettings(admin, tenant.id as string, [VITRIN_AI_CHAT_KEY]).catch(() => ({}) as Record<string, unknown>),
  ]);
  if (!enabled) return null;
  return { tenantId: tenant.id as string, name: (tenant.name as string) || "Ofis", slug, aiChat: settings[VITRIN_AI_CHAT_KEY] === true };
}

export async function countVitrinListings(tenantId: string, f: ListingFilters): Promise<number | null> {
  try {
    const page = await searchVitrinListingIds(createAdminClient(), tenantId, { ...f, sayfa: 1 });
    return page.total;
  } catch {
    return null;
  }
}
