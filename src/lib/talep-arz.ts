/**
 * Talep-Arz raporu — saf toplulaştırma yardımcıları.
 *
 * `/app/raporlar/talep-arz` sayfası müşteri taleplerini (customer_demands) ve
 * yayındaki portföyleri (properties) il/ilçe kırılımında karşılaştırır. Bu
 * modül DB'ye dokunmaz; sayfanın çektiği ham satırları alır, bölge başına
 * talep/arz sayısı, medyan bütçe/fiyat ve denge sınıflandırması üretir.
 */

export type TalepArzDemandRow = {
  province_id: string | null;
  district_id: string | null;
  budget_min: number | null;
  budget_max: number | null;
};

export type TalepArzPropertyRow = {
  province_id: string | null;
  district_id: string | null;
  list_price: number | null;
};

export type TalepArzAgg = {
  provinceId: string;
  districtId: string | null;
  demandCount: number;
  supplyCount: number;
  /** Talep bütçe orta noktaları (medyan hesabı için ham liste). */
  budgets: number[];
  /** Yayındaki portföylerin liste fiyatları. */
  prices: number[];
};

/** Bölge dengesi — rozet ve harita rengi tek sözlükten türesin diye ortak tip. */
export type TalepArzTone = "mint" | "amber" | "red";

/** Sıralı dizinin medyanı — boş liste için null (0 uydurmayız). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Talep bütçesinin tek sayıya indirgenmesi: iki uç varsa orta nokta, tek uç varsa o. */
export function budgetMid(min: number | null, max: number | null): number | null {
  const lo = typeof min === "number" && min > 0 ? min : null;
  const hi = typeof max === "number" && max > 0 ? max : null;
  if (lo !== null && hi !== null) return (lo + hi) / 2;
  return hi ?? lo;
}

/**
 * Arz/talep karşılama tonu — haritadaki daire ve tablodaki oran rengi:
 *  - mint : arz talebi karşılıyor (oran ≥ 1 veya hiç talep yok)
 *  - amber: kısmi karşılama (0.5 ≤ oran < 1)
 *  - red  : talep aç (oran < 0.5)
 */
export function coverageTone(demandCount: number, supplyCount: number): TalepArzTone {
  if (demandCount === 0) return "mint";
  const ratio = supplyCount / demandCount;
  if (ratio >= 1) return "mint";
  if (ratio >= 0.5) return "amber";
  return "red";
}

export type TalepArzGap = "collect" | "generate" | "balanced";

/** Boşluk rozeti: talep>arz → portföy topla fırsatı, arz>talep → talep üret. */
export function gapKind(demandCount: number, supplyCount: number): TalepArzGap {
  if (demandCount > supplyCount) return "collect";
  if (supplyCount > demandCount) return "generate";
  return "balanced";
}

/**
 * İl+ilçe anahtarıyla toplulaştırma. İlçesi olmayan kayıtlar ilin
 * "(İlçe belirtilmedi)" kovasına düşer; ili de olmayan kayıtlar bölgeye
 * bağlanamadığı için atlanır (toplam sayaçlar sayfada ayrıca tutulur).
 */
export function aggregateTalepArz(
  demands: TalepArzDemandRow[],
  properties: TalepArzPropertyRow[],
): Map<string, TalepArzAgg> {
  const out = new Map<string, TalepArzAgg>();
  const bucket = (provinceId: string, districtId: string | null): TalepArzAgg => {
    const key = `${provinceId}|${districtId ?? ""}`;
    let agg = out.get(key);
    if (!agg) {
      agg = { provinceId, districtId, demandCount: 0, supplyCount: 0, budgets: [], prices: [] };
      out.set(key, agg);
    }
    return agg;
  };
  for (const d of demands) {
    if (!d.province_id) continue;
    const agg = bucket(d.province_id, d.district_id);
    agg.demandCount += 1;
    const mid = budgetMid(d.budget_min, d.budget_max);
    if (mid !== null) agg.budgets.push(mid);
  }
  for (const p of properties) {
    if (!p.province_id) continue;
    const agg = bucket(p.province_id, p.district_id);
    agg.supplyCount += 1;
    if (typeof p.list_price === "number" && p.list_price > 0) agg.prices.push(Number(p.list_price));
  }
  return out;
}

/** İl bazlı ikinci toplulaştırma — harita daireleri için (ilçe kovalarını toplar). */
export function rollupByProvince(
  aggs: Iterable<TalepArzAgg>,
): Map<string, { demandCount: number; supplyCount: number }> {
  const out = new Map<string, { demandCount: number; supplyCount: number }>();
  for (const agg of aggs) {
    const cur = out.get(agg.provinceId) ?? { demandCount: 0, supplyCount: 0 };
    cur.demandCount += agg.demandCount;
    cur.supplyCount += agg.supplyCount;
    out.set(agg.provinceId, cur);
  }
  return out;
}
