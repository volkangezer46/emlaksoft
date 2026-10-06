/**
 * Raporlar sayfasının saf hesapları (DOM/zaman yok). Yalnız gerçek veriden türetir:
 * veri yoksa `null`/boş döner, sahte seri üretilmez.
 */

export type MonthFlow = { label: string; income: number; expense: number };
export type NetPoint = { label: string; income: number; expense: number; net: number };

/** Ay başına net (gelir - gider). Sonlu olmayan değerler 0 sayılır. */
export function netSeries(months: readonly MonthFlow[]): NetPoint[] {
  const f = (n: number) => (Number.isFinite(n) ? n : 0);
  return months.map((m) => ({ label: m.label, income: f(m.income), expense: f(m.expense), net: f(m.income) - f(m.expense) }));
}

/** Net görseli yalnız en az bir ayda gelir ya da gider varsa anlamlıdır. */
export function hasNetData(points: readonly NetPoint[]): boolean {
  return points.some((p) => p.income > 0 || p.expense > 0);
}

/**
 * Sapma çubuğu geometrisi: sıfır çizgisi ortak ölçekte. `pct` mutlak en büyük net'e göre 0-100;
 * sıfır net 0 döner (çubuk çizilmez, sahte yükseklik yok).
 */
export function divergingBars(points: readonly NetPoint[]): { label: string; net: number; pct: number }[] {
  const max = Math.max(0, ...points.map((p) => Math.abs(p.net)));
  return points.map((p) => ({ label: p.label, net: p.net, pct: max === 0 ? 0 : Math.round((Math.abs(p.net) / max) * 1000) / 10 }));
}

/** Çubuk genişliği: değer / en büyük; sıfırdan büyük değer en az `floor` görünür. */
export function shareOfMax(value: number, max: number, floor = 3): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || value <= 0 || max <= 0) return 0;
  return Math.min(100, Math.max(floor, (value / max) * 100));
}

/** Toplam içindeki yüzde (tam sayı). Toplam 0 ise 0. */
export function shareOfTotal(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((value / total) * 100);
}
