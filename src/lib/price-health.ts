export type PriceHealth = "green" | "yellow" | "red" | "pending";

/**
 * İl bazlı m² referans fiyatları (TL/m², Türkiye ortalamaları — 2026 Q2)
 * Kaynak: Endeksa/Tapusor canlı veri yoksa bu tablo kullanılır.
 * Canlı Endeksa/Tapusor değeri varsa DB'den override edilir.
 *
 * Güncelleme: Her çeyrekte bu tabloyu Endeksa API sonuçlarıyla güncelle.
 */
const PROVINCE_SQM_PRICE: Record<string, number> = {
  // Büyük şehirler
  "istanbul":    120_000,
  "ankara":       55_000,
  "izmir":        80_000,
  "antalya":      70_000,
  "bursa":        50_000,
  "adana":        35_000,
  "konya":        32_000,
  "gaziantep":    30_000,
  "mersin":       40_000,
  "kocaeli":      52_000,
  "esenyurt":    110_000, // ilçe hint
  "kadıköy":     145_000,
  "beşiktaş":    160_000,
  "şişli":       140_000,
  "üsküdar":     120_000,
  "bağcılar":     95_000,
  "başakşehir":  100_000,
  "çankaya":      58_000,
  "keçiören":     48_000,
  "bornova":      75_000,
  "karşıyaka":    82_000,
  "muratpaşa":    72_000,
  "konyaaltı":    68_000,
  "osmangazi":    52_000,
  "nilüfer":      55_000,
  // Diğer iller
  "trabzon":      40_000,
  "samsun":       28_000,
  "kayseri":      28_000,
  "eskişehir":    32_000,
  "denizli":      30_000,
  "malatya":      25_000,
  "diyarbakır":   22_000,
  "şanlıurfa":    18_000,
  "batman":       16_000,
  "elazığ":       20_000,
  "erzurum":      18_000,
  "van":          15_000,
  "kahramanmaraş": 24_000,
  "hatay":        22_000,
  "manisa":       28_000,
  "balıkesir":    32_000,
  "aydın":        35_000,
  "muğla":        85_000,
  "bodrum":      120_000,
  "marmaris":     95_000,
  "fethiye":      90_000,
  "alanya":       72_000,
  "rize":         28_000,
  "giresun":      22_000,
  "ordu":         20_000,
};

const DEFAULT_SQM_PRICE = 32_000; // Türkiye genel ortalama

/**
 * Hint string'inden m² fiyatı bul — il ve ilçe adı matchlenir.
 * Büyük/küçük harf ve Türkçe karakter duyarsız karşılaştırma.
 */
function lookupSqmPrice(hint: string | null): number {
  if (!hint) return DEFAULT_SQM_PRICE;
  const normalized = hint
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c");

  for (const [key, price] of Object.entries(PROVINCE_SQM_PRICE)) {
    const normKey = key
      .toLocaleLowerCase("tr-TR")
      .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
      .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c");
    if (normalized.includes(normKey)) return price;
  }
  return DEFAULT_SQM_PRICE;
}

/**
 * Liste fiyatını hızlı iç m² modeline göre sağlık bandına oturtur.
 * Liste/portföy sayfalarında satır başına çağrılır — dış API'ye (Endeksa/Tapusor)
 * gitmez, senkron ve ücretsizdir. Derin çok-kaynaklı değerleme için
 * `/app/degerleme` → `estimateMultiSourceValue` kullanılır.
 *
 * Eşik değerleri: green ≤%10 sapma · yellow ≤%20 · red üzeri
 * (Türkiye'nin yüksek enflasyon ortamında %8 çok dar; %10/%20 daha gerçekçi)
 *
 * @param overrideSqmPrice — Endeksa/Tapusor'dan gelen canlı m² fiyatı varsa geçin
 */
export function computePriceHealth(input: {
  listPrice: number | null;
  sqm: number | null;
  districtHint: string | null;
  transactionType?: string | null;
  overrideSqmPrice?: number | null;
}): { health: PriceHealth; mid: number | null; deltaPct: number | null; note: string; sqmPrice: number } {
  const list = input.listPrice && input.listPrice > 0 ? input.listPrice : null;
  if (!list) {
    return { health: "pending", mid: null, deltaPct: null, note: "Liste fiyatı yok", sqmPrice: 0 };
  }
  const sqm = input.sqm && input.sqm > 0 ? input.sqm : null;
  if (!sqm) {
    return { health: "pending", mid: null, deltaPct: null, note: "Karşılaştırma için m² gerekli", sqmPrice: 0 };
  }

  // Kiralık için m² fiyatları çok farklı — kira için ayrı çarpan
  const isRent = input.transactionType?.toLowerCase().includes("kira") ||
                 input.transactionType?.toLowerCase().includes("rent");

  const sqmPrice = input.overrideSqmPrice ??
    (isRent
      ? Math.round(lookupSqmPrice(input.districtHint) / 240) // yıllık/aylık dönüşüm ~%0.4 brüt kira verimi
      : lookupSqmPrice(input.districtHint));

  const mid = Math.round(sqm * sqmPrice);
  const deltaPct = Math.round((Math.abs(list - mid) / mid) * 1000) / 10;

  // Geniş bant eşikleri — yüksek enflasyon ortamına uygun
  let health: PriceHealth = "green";
  if (deltaPct > 20) health = "red";
  else if (deltaPct > 10) health = "yellow";

  const direction = list > mid ? "yüksek" : list < mid ? "düşük" : "denk";
  return {
    health,
    mid,
    deltaPct,
    note: `${isRent ? "Kira" : "Satış"} modeli ~${mid.toLocaleString("tr-TR")} ₺ · liste %${deltaPct} ${direction}`,
    sqmPrice,
  };
}
