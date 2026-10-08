"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { publishBlockReason } from "@/lib/property-owner/server";
import { authorityPublishWarning } from "@/lib/eids/authority-status";
import { now as clockNow } from "@/lib/clock";
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

export type PortalPublishResult = { ok?: boolean; error?: string; externalId?: string; externalUrl?: string; warning?: string };

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

type LedgerInput = {
  tenantId: string;
  userId: string;
  propertyId: string;
  portalName: string;
  externalId: string | null;
  externalUrl: string | null;
  nowIso: string;
};

/** Yayın sonrası yerel portal_listings kaydı. Hata yoksa null. (admin istemcisi çağıran işlevden gelir.) */
async function recordPublishedListing(
  admin: SupabaseClient,
  i: LedgerInput,
): Promise<{ code?: string | null } | null> {
  const { data: live } = await admin
    .from("portal_listings")
    .select("id, portal_listing_id")
    .eq("tenant_id", i.tenantId)
    .eq("property_id", i.propertyId)
    .eq("portal_name", i.portalName)
    .eq("status", "live")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const existing = live as { id: string; portal_listing_id: string | null } | null;

  if (existing && i.externalId && existing.portal_listing_id !== i.externalId) {
    const { data, error } = await admin.rpc("lc_rotate_portal_listing", {
      p_tenant_id: i.tenantId,
      p_actor_id: i.userId,
      p_listing_id: existing.id,
      p_new_external_id: i.externalId,
      p_new_url: i.externalUrl,
      p_reason: null,
    });
    if (!error) {
      const outcome = (data as { outcome?: string } | null)?.outcome;
      return outcome === "applied" || outcome === "unchanged" ? null : { code: String(outcome ?? "rotate_failed") };
    }
    if (!isMissingSchema(error)) return error;
  } else if (!existing) {
    const { data, error } = await admin.rpc("lc_bind_portal_listing", {
      p_tenant_id: i.tenantId,
      p_actor_id: i.userId,
      p_property_id: i.propertyId,
      p_portal_name: i.portalName,
      p_external_id: i.externalId,
      p_url: i.externalUrl,
      p_source_kind: "api",
      p_created_via: "api",
    });
    if (!error) {
      const outcome = (data as { outcome?: string } | null)?.outcome;
      return outcome === "applied" || outcome === "replay" ? null : { code: String(outcome ?? "bind_failed") };
    }
    if (!isMissingSchema(error)) return error;
  } else {
    // Aynı ilan no zaten canlı (ya da portal yeni no döndürmedi): yalnız teyit zamanını yenile.
    const { error } = await admin
      .from("portal_listings")
      .update({ last_confirmed_at: i.nowIso, portal_url: i.externalUrl ?? undefined })
      .eq("id", existing.id)
      .eq("tenant_id", i.tenantId);
    return error ?? null;
  }

  // RPC yok (migration uygulanmamış): doğrudan ekleme / güncelleme.
  if (existing) {
    const { error } = await admin
      .from("portal_listings")
      .update({ portal_listing_id: i.externalId, portal_url: i.externalUrl, last_confirmed_at: i.nowIso })
      .eq("id", existing.id)
      .eq("tenant_id", i.tenantId);
    return error ?? null;
  }
  const { error } = await admin.from("portal_listings").insert({
    tenant_id: i.tenantId,
    property_id: i.propertyId,
    portal_name: i.portalName,
    portal_listing_id: i.externalId,
    portal_url: i.externalUrl,
    status: "live",
    last_confirmed_at: i.nowIso,
    published_at: i.nowIso,
    published_by: i.userId,
  });
  return error ?? null;
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

  // Yayın kapısı: havuzda bekleyen veya eksik ilan sahibi bilgisi olan ilan portala gönderilemez.
  const blocked = await publishBlockReason(supabase, gate.tenantId, propertyId);
  if (blocked) return { error: blocked };

  // API yapılandırıldı mı?
  const configured = await isPortalConfigured(portalName);
  if (!configured) {
    return { error: `${portalName} API anahtarı tanımlanmamış. /admin/sistem'den ekleyin.` };
  }

  // Yetki (EİDS) uyarısı: engellemez; yeni sütunlar yoksa (migration uygulanmamış) sessizce atlanır.
  const { data: authRow } = await supabase
    .from("properties")
    .select("authorization_start, authorization_end, authority_eids_status")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  const warning = authRow
    ? (authorityPublishWarning(
        {
          authorization_start: (authRow as { authorization_start?: string | null }).authorization_start ?? null,
          authorization_end: (authRow as { authorization_end?: string | null }).authorization_end ?? null,
          authority_eids_status: (authRow as { authority_eids_status?: string | null }).authority_eids_status ?? null,
        },
        clockNow(),
      ) ?? undefined)
    : undefined;

  // Portale gönder
  const result = await publishToPortal(portalName, toPayload(property as PropertyRow));

  if (!result.ok) return { error: result.error };

  // portal_listings kaydını güncelle / oluştur
  const now = new Date().toISOString();
  const admin = createAdminClient();
  // Eski upsert onConflict 'tenant_id,property_id,portal_name' için unique index HİÇ olmadığından 42P10 verirdi ve aynı
  // portalda ilan no değişimini/çoklu ilanı dışlıyordu. Yerine: mevcut canlı satır varsa ilan no değiştiyse zincirle
  // (supersedes), aynıysa dokun; yoksa bağla. RPC yoksa (migration uygulanmamış) doğrudan ekleme/güncelleme.
  const localError = await recordPublishedListing(admin, {
    tenantId: gate.tenantId,
    userId: gate.userId,
    propertyId,
    portalName,
    externalId: result.externalId ?? null,
    externalUrl: result.externalUrl ?? null,
    nowIso: now,
  });
  if (localError) {
    console.error("publishPropertyToPortal local ledger", { code: localError.code });
    return {
      error: `${portalName} yayını başarılı oldu ancak yerel kayıt güncellenemedi. Dış ilan: ${result.externalId ?? "kimlik alınamadı"}. Operasyon ekibine bildirin.`,
      externalId: result.externalId,
      externalUrl: result.externalUrl,
    };
  }

  revalidatePath("/app/portallar");
  revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, externalId: result.externalId, externalUrl: result.externalUrl, warning };
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

  const admin = createAdminClient();
  const { data: updated, error: localError } = await admin
    .from("portal_listings")
    .update({
      last_confirmed_at: new Date().toISOString(),
      portal_url: result.externalUrl ?? undefined,
    })
    .eq("id", listingId)
    .eq("tenant_id", gate.tenantId)
    .eq("property_id", propertyId)
    .eq("portal_name", portalName)
    .eq("status", "live")
    .select("id")
    .maybeSingle();
  if (localError || !updated) {
    return {
      error: `${portalName} güncellendi ancak yerel senkron damgası yazılamadı. Operasyon ekibine bildirin.`,
      externalId: result.externalId,
      externalUrl: result.externalUrl,
    };
  }

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

  if (!isPortalSupported(portalName)) {
    return { error: `${portalName} için yayın entegrasyonu henüz mevcut değil.` };
  }
  if (!externalId) return { error: "Portal ilan kimliği yok; ilan kaldırılamaz." };

  const configured = await isPortalConfigured(portalName);
  if (!configured) {
    return { error: `${portalName} API anahtarı tanımlanmamış.` };
  }

  const result = await unpublishFromPortal(portalName, externalId);
  if (!result.ok) return { error: result.error };

  const admin = createAdminClient();
  const { data: updated, error: localError } = await admin
    .from("portal_listings")
    .update({
      status:      "removed",
      removed_at:  new Date().toISOString(),
      removal_reason: "API ile kaldırıldı",
    })
    .eq("id", listingId)
    .eq("tenant_id", gate.tenantId)
    .eq("portal_name", portalName)
    .eq("portal_listing_id", externalId)
    .eq("status", "live")
    .select("id")
    .maybeSingle();
  if (localError || !updated) {
    return { error: `${portalName} ilanı kaldırıldı ancak yerel kayıt kapanamadı. Operasyon ekibine bildirin.` };
  }

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
