/** Gider kategori grafiği kararı: 7+ dilimde pasta okunmaz → sıralı yatay çubuk. */
export const CATEGORY_PIE_MAX_SLICES = 6;

export function categoryChartMode(sliceCount: number): "donut" | "bars" {
  return sliceCount > CATEGORY_PIE_MAX_SLICES ? "bars" : "donut";
}

export type CategoryShareRow<T> = T & { share: number; barPct: number };

/** Büyükten küçüğe sıralar; share = toplam içindeki pay (%), barPct = en büyüğe göre genişlik (%). Negatif/NaN 0 sayılır. */
export function categoryShares<T extends { total: number }>(items: readonly T[]): CategoryShareRow<T>[] {
  const clean = items.map((i) => ({ ...i, total: Number.isFinite(i.total) && i.total > 0 ? i.total : 0 }));
  const sum = clean.reduce((a, i) => a + i.total, 0);
  const max = Math.max(0, ...clean.map((i) => i.total));
  return clean
    .sort((a, b) => b.total - a.total)
    .map((i) => ({ ...i, share: sum > 0 ? Math.round((i.total / sum) * 100) : 0, barPct: max > 0 ? Math.max(i.total > 0 ? 2 : 0, (i.total / max) * 100) : 0 }));
}
