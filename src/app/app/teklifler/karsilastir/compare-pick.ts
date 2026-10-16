/** Teklif karşılaştırma — portföy seçici (SAF): değerlendirmede ≥2 teklifi olan portföyler, en çok teklif alan önce. */
export type PickProperty = { id: string; title: string | null; property_code: string | null; list_price: number | string | null };

export type ComparableProperty = {
  propertyId: string;
  title: string;
  code: string | null;
  listPrice: number | null;
  count: number;
  maxAmount: number;
};

export function groupComparableProperties(
  rows: { propertyId: string; amount: number; property: PickProperty | null }[],
  minOffers = 2,
): ComparableProperty[] {
  const map = new Map<string, ComparableProperty>();
  for (const r of rows) {
    if (!r.propertyId) continue;
    const amount = Number.isFinite(r.amount) ? r.amount : 0;
    const cur = map.get(r.propertyId);
    if (cur) {
      cur.count += 1;
      cur.maxAmount = Math.max(cur.maxAmount, amount);
      continue;
    }
    const lp = r.property?.list_price;
    map.set(r.propertyId, {
      propertyId: r.propertyId,
      title: r.property?.title ?? r.property?.property_code ?? "Portföy",
      code: r.property?.property_code ?? null,
      listPrice: lp != null && Number.isFinite(Number(lp)) ? Number(lp) : null,
      count: 1,
      maxAmount: amount,
    });
  }
  return [...map.values()]
    .filter((c) => c.count >= minOffers)
    .sort((a, b) => b.count - a.count || b.maxAmount - a.maxAmount)
    .slice(0, 30);
}
