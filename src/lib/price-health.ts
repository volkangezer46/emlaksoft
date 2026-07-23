export type PriceHealth = "green" | "yellow" | "red" | "pending";

/**
 * Liste fiyatını hızlı iç m² modeline göre sağlık bandına oturtur.
 * Liste/portföy sayfalarında satır başına çağrılır — dış API'ye (Endeksa/Tapusor)
 * gitmez, senkron ve ücretsizdir. Derin çok-kaynaklı değerleme için
 * `/app/degerleme` → `estimateMultiSourceValue` kullanılır.
 * green ≤%8 sapma · yellow ≤%15 · red üzeri
 */
export function computePriceHealth(input: {
  listPrice: number | null;
  sqm: number | null;
  districtHint: string | null;
}): { health: PriceHealth; mid: number | null; deltaPct: number | null; note: string } {
  const list = input.listPrice && input.listPrice > 0 ? input.listPrice : null;
  if (!list) {
    return { health: "pending", mid: null, deltaPct: null, note: "Liste fiyatı yok" };
  }
  const sqm = input.sqm && input.sqm > 0 ? input.sqm : null;
  if (!sqm) {
    return { health: "pending", mid: null, deltaPct: null, note: "Karşılaştırma için m² gerekli" };
  }

  const districtFactor =
    input.districtHint?.toLocaleLowerCase("tr-TR").includes("onikişubat") ||
    input.districtHint?.toLocaleLowerCase("tr-TR").includes("merkez")
      ? 42000
      : 35000;
  const mid = Math.round(sqm * districtFactor);

  const deltaPct = Math.round((Math.abs(list - mid) / mid) * 1000) / 10;
  let health: PriceHealth = "green";
  if (deltaPct > 15) health = "red";
  else if (deltaPct > 8) health = "yellow";

  const direction = list > mid ? "yüksek" : list < mid ? "düşük" : "denk";
  return {
    health,
    mid,
    deltaPct,
    note: `İç model ~${mid.toLocaleString("tr-TR")} ₺ · liste %${deltaPct} ${direction}`,
  };
}
