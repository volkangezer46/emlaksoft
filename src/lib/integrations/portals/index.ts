/**
 * Portal Yayın Entegrasyon İskeleti
 *
 * Türkiye'deki büyük emlak portalları (Sahibinden, Hepsiemlak, Zingat)
 * kurumsal API anlaşması gerektiren kapalı API'lere sahiptir.
 * Bu modül entegrasyon noktalarını standartlaştırır; gerçek API anahtarları
 * platform_settings'ten okunur.
 *
 * Her portal adaptörü aynı arayüzü implement eder:
 *   - publishListing(property, config) → PortalPublishResult
 *   - unpublishListing(externalId, config) → PortalPublishResult
 *   - updateListing(externalId, property, config) → PortalPublishResult
 */

import { getPlatformSetting } from "@/lib/platform-settings";

// ---------------------------------------------------------------------------
// Ortak tipler
// ---------------------------------------------------------------------------

export type PortalName = "sahibinden" | "hepsiemlak" | "zingat" | "emlakjet";

export type PortalPublishConfig = {
  apiKey: string;
  apiSecret?: string;
  agencyId?: string;
  baseUrl?: string;
};

export type PropertyPayload = {
  propertyCode:  string;
  title:         string;
  description?:  string;
  listPrice:     number;
  currency?:     string;
  propertyType:  string; // "daire", "villa", "arsa" vb.
  transactionType: "satilik" | "kiralik";
  province?:     string;
  district?:     string;
  neighborhood?: string;
  squareMeters?: number;
  roomCount?:    string;
  floorCount?:   number;
  buildingAge?:  number;
  imageUrls?:    string[];
  contactPhone?: string;
};

export type PortalPublishResult = {
  ok:           boolean;
  externalId?:  string;   // Portalın verdiği ilan ID'si
  externalUrl?: string;   // Portalda ilan URL'si
  error?:       string;
  errorCode?:   string;
};

// ---------------------------------------------------------------------------
// Config okuma
// ---------------------------------------------------------------------------

export async function getPortalConfig(portal: PortalName): Promise<PortalPublishConfig | null> {
  const [apiKey, apiSecret, agencyId, baseUrl] = await Promise.all([
    getPlatformSetting(`${portal}_api_key`),
    getPlatformSetting(`${portal}_api_secret`),
    getPlatformSetting(`${portal}_agency_id`),
    getPlatformSetting(`${portal}_base_url`),
  ]);

  const key = apiKey ?? process.env[`${portal.toUpperCase()}_API_KEY`] ?? "";
  if (!key) return null;

  return {
    apiKey:    key,
    apiSecret: apiSecret ?? process.env[`${portal.toUpperCase()}_API_SECRET`] ?? undefined,
    agencyId:  agencyId  ?? process.env[`${portal.toUpperCase()}_AGENCY_ID`]  ?? undefined,
    baseUrl:   baseUrl   ?? undefined,
  };
}

export async function isPortalConfigured(portal: PortalName): Promise<boolean> {
  const cfg = await getPortalConfig(portal);
  return cfg !== null;
}

// ---------------------------------------------------------------------------
// Sahibinden.com adaptörü (kurumsal API — iskelet)
// ---------------------------------------------------------------------------

const SAHIBINDEN_BASE = "https://api.sahibinden.com/v1";

export async function sahibindenPublish(
  property: PropertyPayload,
  cfg: PortalPublishConfig,
): Promise<PortalPublishResult> {
  const base = cfg.baseUrl ?? SAHIBINDEN_BASE;
  try {
    const res = await fetch(`${base}/listings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key":    cfg.apiKey,
        ...(cfg.apiSecret ? { "X-API-Secret": cfg.apiSecret } : {}),
        ...(cfg.agencyId  ? { "X-Agency-ID":  cfg.agencyId  } : {}),
      },
      body: JSON.stringify(mapToSahibinden(property)),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Sahibinden API hatası: ${res.status}`, errorCode: body.slice(0, 80) };
    }

    const data = await res.json() as { id?: string; url?: string };
    return { ok: true, externalId: String(data.id ?? ""), externalUrl: data.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bağlantı hatası." };
  }
}

export async function sahibindenUnpublish(
  externalId: string,
  cfg: PortalPublishConfig,
): Promise<PortalPublishResult> {
  const base = cfg.baseUrl ?? SAHIBINDEN_BASE;
  try {
    const res = await fetch(`${base}/listings/${externalId}`, {
      method: "DELETE",
      headers: { "X-API-Key": cfg.apiKey },
    });
    return { ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bağlantı hatası." };
  }
}

// ---------------------------------------------------------------------------
// Hepsiemlak adaptörü (iskelet)
// ---------------------------------------------------------------------------

const HEPSIEMLAK_BASE = "https://api.hepsiemlak.com/v2";

export async function hepsiemlakPublish(
  property: PropertyPayload,
  cfg: PortalPublishConfig,
): Promise<PortalPublishResult> {
  const base = cfg.baseUrl ?? HEPSIEMLAK_BASE;
  try {
    const res = await fetch(`${base}/adverts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(mapToHepsiemlak(property)),
    });

    if (!res.ok) {
      return { ok: false, error: `Hepsiemlak API hatası: ${res.status}` };
    }

    const data = await res.json() as { advertId?: string; advertUrl?: string };
    return { ok: true, externalId: String(data.advertId ?? ""), externalUrl: data.advertUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bağlantı hatası." };
  }
}

// ---------------------------------------------------------------------------
// Yönlendirici: portala göre doğru adaptörü çağır
// ---------------------------------------------------------------------------

export async function publishToPortal(
  portal: PortalName,
  property: PropertyPayload,
): Promise<PortalPublishResult> {
  const cfg = await getPortalConfig(portal);
  if (!cfg) return { ok: false, error: `${portal} API anahtarı tanımlanmamış.` };

  switch (portal) {
    case "sahibinden": return sahibindenPublish(property, cfg);
    case "hepsiemlak": return hepsiemlakPublish(property, cfg);
    default:
      return { ok: false, error: `${portal} entegrasyonu henüz aktif değil.` };
  }
}

export async function unpublishFromPortal(
  portal: PortalName,
  externalId: string,
): Promise<PortalPublishResult> {
  const cfg = await getPortalConfig(portal);
  if (!cfg) return { ok: false, error: `${portal} API anahtarı tanımlanmamış.` };

  switch (portal) {
    case "sahibinden": return sahibindenUnpublish(externalId, cfg);
    default:
      return { ok: false, error: `${portal} entegrasyonu henüz aktif değil.` };
  }
}

// ---------------------------------------------------------------------------
// Alan eşleme yardımcıları
// ---------------------------------------------------------------------------

function mapToSahibinden(p: PropertyPayload): Record<string, unknown> {
  return {
    reference_no:     p.propertyCode,
    title:            p.title,
    description:      p.description ?? "",
    price:            p.listPrice,
    currency:         p.currency ?? "TRY",
    category:         p.propertyType,
    ad_type:          p.transactionType === "satilik" ? "SALE" : "RENT",
    province:         p.province,
    district:         p.district,
    neighborhood:     p.neighborhood,
    net_sqm:          p.squareMeters,
    room_count:       p.roomCount,
    images:           p.imageUrls ?? [],
    contact_phone:    p.contactPhone,
  };
}

function mapToHepsiemlak(p: PropertyPayload): Record<string, unknown> {
  return {
    referenceCode:    p.propertyCode,
    title:            p.title,
    description:      p.description ?? "",
    price:            p.listPrice,
    advertType:       p.transactionType === "satilik" ? "FOR_SALE" : "FOR_RENT",
    propertyType:     p.propertyType,
    province:         p.province,
    district:         p.district,
    netArea:          p.squareMeters,
    roomInfo:         p.roomCount,
    photos:           (p.imageUrls ?? []).map((url) => ({ url })),
  };
}
