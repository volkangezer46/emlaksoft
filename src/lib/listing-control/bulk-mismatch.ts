import { normalizeExternalId } from "./matching";

/**
 * TOPLU UYUŞMAZLIK (SAF): portal envanteri (API/feed/CSV) ile CRM'deki canlı ilanları portal bazında karşılaştırır.
 * "CRM'de 100, portalda 92" gibi toplam farkı AYRINTILI kırılımla verir: portalda eksik olanlar, portalda olup CRM'de
 * kayıtsız olanlar (kayıtsız portal ilanı → eşleştirme önerisi) ve fiyat farkı olanlar. Envanter olmayan portal için
 * sonuç üretilmez ("envanter yok", ölçülemedi); kısmi/eski dosya karşılaştırmaya girmez (`inventoryFresh`).
 */

export type CrmListingRef = { listingId: string; propertyId: string; externalId: string | null; price: number | null };
export type PortalInventoryItem = { externalId: string; price: number | null; title?: string | null; url?: string | null };

export type BulkMismatch = {
  portal: string;
  crmCount: number;
  portalCount: number;
  difference: number;
  missingOnPortal: CrmListingRef[];
  unregisteredOnPortal: PortalInventoryItem[];
  /** CRM satırında ilan no yok → eşleştirilemedi (ayrı sayılır, "eksik" yazılmaz). */
  crmWithoutExternalId: CrmListingRef[];
};

export function compareInventory(
  portal: string,
  crm: readonly CrmListingRef[],
  inventory: readonly PortalInventoryItem[] | null,
  inventoryFresh: boolean,
): BulkMismatch | null {
  if (!inventory || !inventoryFresh) return null;
  const invMap = new Map<string, PortalInventoryItem>();
  for (const it of inventory) {
    const k = normalizeExternalId(it.externalId);
    if (k) invMap.set(k, it);
  }
  const crmKeys = new Set<string>();
  const missing: CrmListingRef[] = [];
  const withoutId: CrmListingRef[] = [];
  for (const c of crm) {
    const k = normalizeExternalId(c.externalId);
    if (!k) {
      withoutId.push(c);
      continue;
    }
    crmKeys.add(k);
    if (!invMap.has(k)) missing.push(c);
  }
  const unregistered = [...invMap.entries()].filter(([k]) => !crmKeys.has(k)).map(([, v]) => v);
  return {
    portal,
    crmCount: crm.length,
    portalCount: invMap.size,
    difference: crm.length - invMap.size,
    missingOnPortal: missing,
    unregisteredOnPortal: unregistered,
    crmWithoutExternalId: withoutId,
  };
}
