import { PORTAL_FORM_RULES, TRANSFER_PORTALS, type TransferPortal } from "./rules";

/**
 * EKSİK PORTAL (SAF, testli): portföy yayında ama ofisin kullandığı bir portalda canlı ilanı yok. "Ofisin kullandığı portal" =
 * ofiste o portalda EN AZ BİR canlı ilan var (ayrı ayar tutulmaz, migration yok); hiçbir portalda kaydı olmayan ofis için kart üretilmez
 * (veri yoksa kart yok). Sayılar ve hedef liste AYNI fonksiyondan gelir (sıfır çıkmaz metrik).
 */
export type PortalGap = { portal: TransferPortal; label: string; used: number; missing: string[] };

export function computeMissingPortals(liveProperties: readonly string[], liveListings: readonly { propertyId: string; portal: string }[]): PortalGap[] {
  const byPortal = new Map<TransferPortal, Set<string>>();
  for (const l of liveListings) {
    const p = TRANSFER_PORTALS.find((x) => x === l.portal.trim().toLowerCase());
    if (!p) continue;
    const set = byPortal.get(p) ?? new Set<string>();
    set.add(l.propertyId);
    byPortal.set(p, set);
  }
  const out: PortalGap[] = [];
  for (const portal of TRANSFER_PORTALS) {
    const has = byPortal.get(portal);
    if (!has || has.size === 0) continue;
    const missing = liveProperties.filter((id) => !has.has(id));
    if (missing.length > 0) out.push({ portal, label: PORTAL_FORM_RULES[portal].label, used: has.size, missing });
  }
  return out.sort((a, b) => b.missing.length - a.missing.length);
}

export type DifferenceCard = { key: string; label: string; count: number; href: string; hint: string };

/** Fiyat / durum farkı kartları: yalnız SIFIRDAN BÜYÜK sayılar kart olur; hedef, ana ekrandaki KPI listesiyle aynı kaynaktır. */
export function differenceCards(summary: { price_mismatch: number; portal_missing: number }, kpiHref: (k: "price_mismatch" | "portal_missing") => string): DifferenceCard[] {
  const cards: DifferenceCard[] = [];
  if (summary.price_mismatch > 0) {
    cards.push({ key: "price", label: "Fiyat farkı", count: summary.price_mismatch, href: kpiHref("price_mismatch"), hint: "Portaldaki fiyat EmlakSoft'tan farklı" });
  }
  if (summary.portal_missing > 0) {
    cards.push({ key: "status", label: "Durum farkı", count: summary.portal_missing, href: kpiHref("portal_missing"), hint: "EmlakSoft'ta aktif, portalda yok ya da pasif görünüyor" });
  }
  return cards;
}
