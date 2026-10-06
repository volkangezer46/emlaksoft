import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateFromComparables } from "@/lib/comparables";
import { homeValueDisplay, type HomeValueDisplay } from "@/lib/home-value/core";

export type HomeValueItem = { propertyId: string; label: string; display: HomeValueDisplay };

/**
 * Müşterinin ofisten SATIN ALDIĞI portföyler (kazanılmış satış anlaşması) için güncel değer aralığı.
 * İstemci çağırandan (müşteri portalı sayfasının mevcut istemcisi); her sorgu AÇIK tenant_id filtreli.
 * Ofiste örnek (is_sample) portföy varsa boş döner (emsal motoru örnek veriyi süzmez).
 */
export async function loadHomeValues(db: SupabaseClient, tenantId: string, customerId: string): Promise<HomeValueItem[]> {
  const { count: sampleCount, error: sampleError } = await db
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("is_sample", true);
  if (sampleError || (sampleCount ?? 0) > 0) return [];

  const { data: deals } = await db
    .from("deals")
    .select("property_id")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .eq("deal_type", "sale")
    .eq("stage", "won")
    .eq("is_sample", false)
    .not("property_id", "is", null)
    .limit(5);
  const ids = [...new Set(((deals ?? []) as { property_id: string }[]).map((d) => d.property_id))];
  if (ids.length === 0) return [];

  const { data: props } = await db
    .from("properties")
    .select("id, title, property_code, district_id, property_type, transaction_type, features")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  const out: HomeValueItem[] = [];
  for (const p of (props ?? []) as {
    id: string;
    title: string | null;
    property_code: string | null;
    district_id: string | null;
    property_type: string | null;
    transaction_type: string | null;
    features: Record<string, unknown> | null;
  }[]) {
    const f = p.features ?? {};
    const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
    const estimate = await estimateFromComparables(db, {
      tenantId,
      districtId: p.district_id,
      propertyType: p.property_type,
      transactionType: p.transaction_type,
      sqm: num(f.sqm),
      excludePropertyId: p.id,
      targetFloor: num(f.floor),
      targetBuildingAge: num(f.building_age),
      targetHeating: typeof f.heating === "string" ? f.heating : null,
      targetFacade: typeof f.facade === "string" ? f.facade : null,
    });
    const display = homeValueDisplay(estimate);
    if (display) out.push({ propertyId: p.id, label: p.title || p.property_code || "Eviniz", display });
  }
  return out;
}
