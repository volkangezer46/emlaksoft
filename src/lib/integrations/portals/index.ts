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
// Adaptör spesifikasyonu — her portal aynı REST arayüzünü parametreler
// (create=POST, update=PUT, unpublish=DELETE). Böylece 4 portal tek, test
// edilebilir kod yolundan geçer; gerçek uçlar kurumsal API'ye göre değişebilir.
// ---------------------------------------------------------------------------

type PortalSpec = {
  label:    string;
  base:     string;
  collectionPath: string;
  headers:  (cfg: PortalPublishConfig) => Record<string, string>;
  map:      (p: PropertyPayload) => Record<string, unknown>;
  parseId:  (data: Record<string, unknown>) => string;
  parseUrl: (data: Record<string, unknown>) => string | undefined;
};

const PORTAL_SPECS: Record<PortalName, PortalSpec> = {
  sahibinden: {
    label: "Sahibinden",
    base: "https://api.sahibinden.com/v1",
    collectionPath: "/listings",
    headers: (cfg) => ({
      "Content-Type": "application/json",
      "X-API-Key": cfg.apiKey,
      ...(cfg.apiSecret ? { "X-API-Secret": cfg.apiSecret } : {}),
      ...(cfg.agencyId ? { "X-Agency-ID": cfg.agencyId } : {}),
    }),
    map: mapToSahibinden,
    parseId: (d) => String(d.id ?? ""),
    parseUrl: (d) => (typeof d.url === "string" ? d.url : undefined),
  },
  hepsiemlak: {
    label: "Hepsiemlak",
    base: "https://api.hepsiemlak.com/v2",
    collectionPath: "/adverts",
    headers: (cfg) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    }),
    map: mapToHepsiemlak,
    parseId: (d) => String(d.advertId ?? ""),
    parseUrl: (d) => (typeof d.advertUrl === "string" ? d.advertUrl : undefined),
  },
  zingat: {
    label: "Zingat",
    base: "https://api.zingat.com/v1",
    collectionPath: "/listings",
    headers: (cfg) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
      ...(cfg.agencyId ? { "X-Agency-Id": cfg.agencyId } : {}),
    }),
    map: mapToZingat,
    parseId: (d) => String(d.listingId ?? d.id ?? ""),
    parseUrl: (d) => (typeof d.listingUrl === "string" ? d.listingUrl : undefined),
  },
  emlakjet: {
    label: "Emlakjet",
    base: "https://api.emlakjet.com/v1",
    collectionPath: "/ilan",
    headers: (cfg) => ({
      "Content-Type": "application/json",
      "X-Api-Key": cfg.apiKey,
      ...(cfg.apiSecret ? { "X-Api-Secret": cfg.apiSecret } : {}),
    }),
    map: mapToEmlakjet,
    parseId: (d) => String(d.ilanId ?? d.id ?? ""),
    parseUrl: (d) => (typeof d.ilanUrl === "string" ? d.ilanUrl : undefined),
  },
};

/** Publish/update için gerçek yayın adaptörü tanımlı portallar. */
export const SUPPORTED_PORTALS = Object.keys(PORTAL_SPECS) as PortalName[];
export function isPortalSupported(portal: PortalName): boolean {
  return portal in PORTAL_SPECS;
}

async function restCreate(spec: PortalSpec, property: PropertyPayload, cfg: PortalPublishConfig): Promise<PortalPublishResult> {
  const base = cfg.baseUrl ?? spec.base;
  try {
    const res = await fetch(`${base}${spec.collectionPath}`, {
      method: "POST",
      headers: spec.headers(cfg),
      body: JSON.stringify(spec.map(property)),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `${spec.label} API hatası: ${res.status}`, errorCode: body.slice(0, 80) };
    }
    const data = (await res.json()) as Record<string, unknown>;
    return { ok: true, externalId: spec.parseId(data), externalUrl: spec.parseUrl(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bağlantı hatası." };
  }
}

async function restUpdate(spec: PortalSpec, externalId: string, property: PropertyPayload, cfg: PortalPublishConfig): Promise<PortalPublishResult> {
  const base = cfg.baseUrl ?? spec.base;
  try {
    const res = await fetch(`${base}${spec.collectionPath}/${externalId}`, {
      method: "PUT",
      headers: spec.headers(cfg),
      body: JSON.stringify(spec.map(property)),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `${spec.label} API hatası: ${res.status}`, errorCode: body.slice(0, 80) };
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: true, externalId: spec.parseId(data) || externalId, externalUrl: spec.parseUrl(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bağlantı hatası." };
  }
}

async function restDelete(spec: PortalSpec, externalId: string, cfg: PortalPublishConfig): Promise<PortalPublishResult> {
  const base = cfg.baseUrl ?? spec.base;
  try {
    const res = await fetch(`${base}${spec.collectionPath}/${externalId}`, {
      method: "DELETE",
      headers: spec.headers(cfg),
    });
    return { ok: res.ok, error: res.ok ? undefined : `${spec.label} API hatası: HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bağlantı hatası." };
  }
}

// ---------------------------------------------------------------------------
// Yönlendiriciler: portala göre doğru adaptörü çağır
// ---------------------------------------------------------------------------

export async function publishToPortal(portal: PortalName, property: PropertyPayload): Promise<PortalPublishResult> {
  const spec = PORTAL_SPECS[portal];
  if (!spec) return { ok: false, error: `${portal} entegrasyonu desteklenmiyor.` };
  const cfg = await getPortalConfig(portal);
  if (!cfg) return { ok: false, error: `${spec.label} API anahtarı tanımlanmamış.` };
  return restCreate(spec, property, cfg);
}

export async function updateOnPortal(portal: PortalName, externalId: string, property: PropertyPayload): Promise<PortalPublishResult> {
  const spec = PORTAL_SPECS[portal];
  if (!spec) return { ok: false, error: `${portal} entegrasyonu desteklenmiyor.` };
  if (!externalId) return { ok: false, error: "Güncellenecek ilan kimliği yok." };
  const cfg = await getPortalConfig(portal);
  if (!cfg) return { ok: false, error: `${spec.label} API anahtarı tanımlanmamış.` };
  return restUpdate(spec, externalId, property, cfg);
}

export async function unpublishFromPortal(portal: PortalName, externalId: string): Promise<PortalPublishResult> {
  const spec = PORTAL_SPECS[portal];
  if (!spec) return { ok: false, error: `${portal} entegrasyonu desteklenmiyor.` };
  const cfg = await getPortalConfig(portal);
  if (!cfg) return { ok: false, error: `${spec.label} API anahtarı tanımlanmamış.` };
  return restDelete(spec, externalId, cfg);
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
    floor_count:      p.floorCount,
    building_age:     p.buildingAge,
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
    floorCount:       p.floorCount,
    buildingAge:      p.buildingAge,
    photos:           (p.imageUrls ?? []).map((url) => ({ url })),
  };
}

function mapToZingat(p: PropertyPayload): Record<string, unknown> {
  return {
    referenceNo:      p.propertyCode,
    title:            p.title,
    description:      p.description ?? "",
    price:            p.listPrice,
    currency:         p.currency ?? "TRY",
    category:         p.propertyType,
    listingType:      p.transactionType === "satilik" ? "sale" : "rent",
    city:             p.province,
    district:         p.district,
    neighborhood:     p.neighborhood,
    grossArea:        p.squareMeters,
    roomCount:        p.roomCount,
    floor:            p.floorCount,
    buildingAge:      p.buildingAge,
    images:           p.imageUrls ?? [],
    phone:            p.contactPhone,
  };
}

function mapToEmlakjet(p: PropertyPayload): Record<string, unknown> {
  return {
    referansNo:       p.propertyCode,
    baslik:           p.title,
    aciklama:         p.description ?? "",
    fiyat:            p.listPrice,
    paraBirimi:       p.currency ?? "TRY",
    kategori:         p.propertyType,
    ilanTipi:         p.transactionType === "satilik" ? "satilik" : "kiralik",
    il:               p.province,
    ilce:             p.district,
    mahalle:          p.neighborhood,
    metrekare:        p.squareMeters,
    odaSayisi:        p.roomCount,
    katSayisi:        p.floorCount,
    binaYasi:         p.buildingAge,
    fotograflar:      p.imageUrls ?? [],
    telefon:          p.contactPhone,
  };
}
