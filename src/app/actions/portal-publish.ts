"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { publishToPortal, unpublishFromPortal, isPortalConfigured, type PortalName } from "@/lib/integrations/portals";

export type PortalPublishResult = { ok?: boolean; error?: string; externalId?: string; externalUrl?: string };

// ---------------------------------------------------------------------------
// İlanı portale gönder
// ---------------------------------------------------------------------------

export async function publishPropertyToPortal(
  propertyId: string,
  portalName: PortalName,
): Promise<PortalPublishResult> {
  const gate = await requirePermission("portals", "create");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();

  // Portföy bilgilerini çek
  const { data: property } = await supabase
    .from("properties")
    .select(`
      id, property_code, title, description, list_price,
      property_type, transaction_type,
      province:provinces(name),
      district:districts(name),
      net_sqm, room_count, floor, building_age
    `)
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!property) return { error: "Portföy bulunamadı." };

  // API yapılandırıldı mı?
  const configured = await isPortalConfigured(portalName);
  if (!configured) {
    return { error: `${portalName} API anahtarı tanımlanmamış. /admin/sistem'den ekleyin.` };
  }

  const provinceName = Array.isArray(property.province)
    ? property.province[0]?.name
    : (property.province as { name?: string } | null)?.name;

  const districtName = Array.isArray(property.district)
    ? property.district[0]?.name
    : (property.district as { name?: string } | null)?.name;

  // Portale gönder
  const result = await publishToPortal(portalName, {
    propertyCode:    property.property_code,
    title:           property.title ?? property.property_code,
    description:     property.description ?? undefined,
    listPrice:       property.list_price ?? 0,
    propertyType:    property.property_type ?? "daire",
    transactionType: (property.transaction_type === "kiralik" ? "kiralik" : "satilik"),
    province:        provinceName,
    district:        districtName,
    squareMeters:    property.net_sqm ?? undefined,
    roomCount:       property.room_count ?? undefined,
    floorCount:      property.floor ?? undefined,
    buildingAge:     property.building_age ?? undefined,
  });

  if (!result.ok) return { error: result.error };

  // portal_listings kaydını güncelle / oluştur
  const now = new Date().toISOString();
  await supabase.from("portal_listings").upsert(
    {
      tenant_id:         gate.tenantId,
      property_id:       propertyId,
      portal_name:       portalName,
      portal_listing_id: result.externalId ?? null,
      portal_url:        result.externalUrl ?? null,
      status:            "live",
      last_confirmed_at: now,
      published_at:      now,
      published_by:      gate.userId,
    },
    { onConflict: "tenant_id,property_id,portal_name" },
  );

  revalidatePath("/app/portallar");
  revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, externalId: result.externalId, externalUrl: result.externalUrl };
}

// ---------------------------------------------------------------------------
// İlanı portalden çek
// ---------------------------------------------------------------------------

export async function unpublishPropertyFromPortal(
  listingId: string,
  portalName: PortalName,
  externalId: string,
): Promise<PortalPublishResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };

  const configured = await isPortalConfigured(portalName);
  if (!configured) {
    return { error: `${portalName} API anahtarı tanımlanmamış.` };
  }

  const result = await unpublishFromPortal(portalName, externalId);
  if (!result.ok) return { error: result.error };

  const supabase = await createClient();
  await supabase
    .from("portal_listings")
    .update({
      status:      "removed",
      removed_at:  new Date().toISOString(),
      removal_reason: "API ile kaldırıldı",
    })
    .eq("id", listingId)
    .eq("tenant_id", gate.tenantId);

  revalidatePath("/app/portallar");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Hangi portallerin API entegrasyonu aktif?
// ---------------------------------------------------------------------------

export async function getConfiguredPortals(): Promise<PortalName[]> {
  const portals: PortalName[] = ["sahibinden", "hepsiemlak", "zingat", "emlakjet"];
  const results = await Promise.all(portals.map((p) => isPortalConfigured(p)));
  return portals.filter((_, i) => results[i]);
}
