/**
 * Ağ eşleştirmesi (OA10; SAF, birim testli): diğer ofislerin MASKELİ ağ ilanı ↔ açık alıcı talebi. Yalnız ağda zaten
 * görünen alanlar kullanılır (işlem türü, tür, il/ilçe adı, oda, fiyat); malik, açık adres ya da iç not hiçbir zaman.
 *
 * Kural (hepsi sağlanmalı; talepte boş olan ölçüt aranmaz):
 *  - işlem türü (satılık/kiralık) aynı;
 *  - tür (daire, villa...) aynı;
 *  - konum: talepte ilçe varsa ilçe, yoksa il aynı;
 *  - oda: talepte oda varsa ilanınki aynı (ilanda oda yoksa geçer — tahmin yok, eleme yok);
 *  - fiyat: bütçe aralığının %10 toleransı içinde (fiyatı gizli ilan geçer; bütçesiz talep geçer).
 * Puan = sağlanan "güçlü" ölçüt sayısı (sıralama için); sahte yüzde üretilmez.
 */

export type MatchDemand = {
  transactionType: string | null;
  propertyType: string | null;
  rooms: string | null;
  provinceName: string | null;
  districtName: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
};

export type MatchListing = {
  transactionType: string | null;
  propertyType: string | null;
  rooms: string | null;
  provinceName: string | null;
  districtName: string | null;
  price: number | null;
};

export const BUDGET_TOLERANCE = 0.1;

/** Türkçe duyarsız karşılaştırma anahtarı ("Satılık" = "satilik", "3+1 " = "3+1"). */
export function normKey(v: string | null | undefined): string {
  return String(v ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\s+/g, "")
    .trim();
}

const fin = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Eşleşirse puan (≥1), eşleşmezse null. */
export function networkMatchScore(d: MatchDemand, l: MatchListing): number | null {
  const same = (a: string | null, b: string | null) => normKey(a) === normKey(b);
  if (normKey(d.transactionType) && !same(d.transactionType, l.transactionType)) return null;
  let score = 1;
  if (normKey(d.propertyType)) {
    if (!same(d.propertyType, l.propertyType)) return null;
    score += 1;
  }
  if (normKey(d.districtName)) {
    if (!same(d.districtName, l.districtName)) return null;
    score += 2;
  } else if (normKey(d.provinceName)) {
    if (!same(d.provinceName, l.provinceName)) return null;
    score += 1;
  } else {
    // Konumsuz talep ağda eşleştirilmez: tüm ülkedeki ilanları "uygun" saymak boş vaattir.
    return null;
  }
  if (normKey(d.rooms) && normKey(l.rooms)) {
    if (!same(d.rooms, l.rooms)) return null;
    score += 1;
  }
  if (fin(l.price) && (fin(d.budgetMin) || fin(d.budgetMax))) {
    const lo = fin(d.budgetMin) ? d.budgetMin * (1 - BUDGET_TOLERANCE) : 0;
    const hi = fin(d.budgetMax) ? d.budgetMax * (1 + BUDGET_TOLERANCE) : Number.POSITIVE_INFINITY;
    if (l.price < lo || l.price > hi) return null;
    score += 1;
  }
  return score;
}

/** Talebe uyan ilanlar, puana göre (eşitlikte giriş sırası korunur). */
export function matchListingsForDemand<T extends MatchListing>(d: MatchDemand, listings: readonly T[]): T[] {
  return listings
    .map((l, i) => ({ l, i, s: networkMatchScore(d, l) }))
    .filter((x): x is { l: T; i: number; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.l);
}
