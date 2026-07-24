"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import {
  publishToPortal,
  updateOnPortal,
  unpublishFromPortal,
  isPortalConfigured,
  isPortalSupported,
  SUPPORTED_PORTALS,
  type PortalName,
  type PropertyPayload,
} from "@/lib/integrations/portals";

export type PortalPublishResult = { ok?: boolean; error?: string; externalId?: string; externalUrl?: string };

const PROPERTY_SELECT = `
  id, property_code, title, address_line, list_price,
  property_type, transaction_type, features,
  province:geo_provinces(name),
  district:geo_districts(name)
` as const;

type PropertyRow = {
  property_code: string;
  title: string | null;
  address_line: string | null;
  list_price: number | null;
  property_type: string | null;
  transaction_type: string | null;
  features: { rooms?: string | null; sqm?: number | null; floor?: number | null; building_age?: number | null } | null;
  province: { name?: string } | { name?: string }[] | null;
  district: { name?: string } | { name?: string }[] | null;
};

function relName(v: { name?: string } | { name?: string }[] | null): string | undefined {
  return Array.isArray(v) ? v[0]?.name : v?.name ?? undefined;
}

function toPayload(property: PropertyRow): PropertyPayload {
  const f = property.features ?? {};
  const sqm = f.sqm != null ? Number(f.sqm) : undefined;
  const floor = f.floor != null ? Number(f.floor) : undefined;
  const buildingAge = f.building_age != null ? Number(f.building_age) : undefined;
  return {
    propertyCode:    property.property_code,
    title:           property.title ?? property.property_code,
    description:     property.address_line ?? undefined,
    listPrice:       property.list_price ?? 0,
    propertyType:    property.property_type ?? "daire",
    transactionType: property.transaction_type === "kiralik" ? "kiralik" : "satilik",
    province:        relName(property.province),
    district:        relName(property.district),
    squareMeters:    Number.isFinite(sqm) ? sqm : undefined,
    roomCount:       f.rooms ?? undefined,
    floorCount:      Number.isFinite(floor) ? floor : undefined,
    buildingAge:     Number.isFinite(buildingAge) ? buildingAge : undefined,
  };
}

// ---------------------------------------------------------------------------
// İlanı portale gönder
// ---------------------------------------------------------------------------

export async function publishPropertyToPortal(
  propertyId: string,
  portalName: PortalName,
): Promise<PortalPublishResult> {
  const gate = await requirePermission("portals", "create");
  if (!gate.ok) return { error: gate.error };

  if (!isPortalSupported(portalName)) {
    return { error: `${portalName} için yayın entegrasyonu henüz mevcut değil.` };
  }

  const supabase = await createClient();

  // Portföy bilgilerini çek
  const { data: property } = await supabase
    .from("properties")
    .select(PROPERTY_SELECT)
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!property) return { error: "Portföy bulunamadı." };

  // API yapılandırıldı mı?
  const configured = await isPortalConfigured(portalName);
  if (!configured) {
    return { error: `${portalName} API anahtarı tanımlanmamış. /admin/sistem'den ekleyin.` };
  }

  // Portale gönder
  const result = await publishToPortal(portalName, toPayload(property as PropertyRow));

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
// Canlı ilanı portalde güncelle (fiyat/başlık/foto değişince yeniden senkron)
// ---------------------------------------------------------------------------

export async function updatePropertyOnPortal(
  propertyId: string,
  portalName: PortalName,
  externalId: string,
  listingId: string,
): Promise<PortalPublishResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };

  if (!isPortalSupported(portalName)) {
    return { error: `${portalName} için yayın entegrasyonu henüz mevcut değil.` };
  }
  if (!externalId) return { error: "Portal ilan kimliği yok; önce yayınlayın." };

  const configured = await isPortalConfigured(portalName);
  if (!configured) return { error: `${portalName} API anahtarı tanımlanmamış.` };

  const supabase = await createClient();
  const { data: property } = await supabase
    .from("properties")
    .select(PROPERTY_SELECT)
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!property) return { error: "Portföy bulunamadı." };

  const result = await updateOnPortal(portalName, externalId, toPayload(property as PropertyRow));
  if (!result.ok) return { error: result.error };

  await supabase
    .from("portal_listings")
    .update({
      last_confirmed_at: new Date().toISOString(),
      portal_url: result.externalUrl ?? undefined,
    })
    .eq("id", listingId)
    .eq("tenant_id", gate.tenantId);

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
  // Yalnızca yayın adaptörü OLAN portalları değerlendir (UI tutarlılığı)
  const results = await Promise.all(SUPPORTED_PORTALS.map((p) => isPortalConfigured(p)));
  return SUPPORTED_PORTALS.filter((_, i) => results[i]);
}
