/**
 * Portföy fiyat tarihçesi — tip tanımları ve saf hesaplamalar.
 *
 * Server action'dan ayrı tutuldu: `"use server"` dosyaları yalnızca async
 * fonksiyon export edebiliyor, ayrıca bu hesaplar istemcide de çalışsın
 * istiyoruz (para birimi/görünüm değişince ağ turu gerekmesin).
 */

export type PriceField = "list_price" | "min_price" | "hidden_price";

export const PRICE_FIELD_LABEL: Record<PriceField, string> = {
  list_price: "Liste fiyatı",
  min_price: "Minimum fiyat",
  hidden_price: "Gizli fiyat",
};

export type PriceHistoryRow = {
  id: string;
  price_field: PriceField;
  old_price: number | null;
  new_price: number;
  change_pct: number | null;
  reason: string | null;
  created_at: string;
  changed_by: { full_name?: string } | { full_name?: string }[] | null;
};

export type PriceHistorySummary = {
  firstPrice: number;
  lastPrice: number;
  firstDate: string;
  lastDate: string;
  totalChange: number;
  totalChangePct: number;
  /** İlk kayıt "başlangıç"tır, değişim sayılmaz */
  changeCount: number;
  cutCount: number;
  raiseCount: number;
  /** Ortalama kaç günde bir fiyat güncellenmiş — değişim yoksa 0 */
  avgDaysBetween: number;
  /** İlk kayıttan bugüne geçen gün */
  daysOnMarket: number;
  /** Son değişimden bu yana geçen gün */
  daysSinceLastChange: number;
};

export function historyAuthorName(value: PriceHistoryRow["changed_by"]): string {
  if (!value) return "Sistem";
  const row = Array.isArray(value) ? value[0] : value;
  return row?.full_name ?? "Sistem";
}

export function summarizePriceHistory(rows: PriceHistoryRow[]): PriceHistorySummary | null {
  if (rows.length === 0) return null;

  const first = rows[0];
  const last = rows[rows.length - 1];
  const firstPrice = first.new_price;
  const lastPrice = last.new_price;
  const totalChange = lastPrice - firstPrice;
  const totalChangePct = firstPrice > 0 ? (totalChange / firstPrice) * 100 : 0;

  const firstMs = new Date(first.created_at).getTime();
  const lastMs = new Date(last.created_at).getTime();
  const now = Date.now();

  const changeCount = rows.length - 1;
  let cutCount = 0;
  let raiseCount = 0;
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].new_price < rows[i - 1].new_price) cutCount += 1;
    else if (rows[i].new_price > rows[i - 1].new_price) raiseCount += 1;
  }

  return {
    firstPrice,
    lastPrice,
    firstDate: first.created_at,
    lastDate: last.created_at,
    totalChange,
    totalChangePct: Math.round(totalChangePct * 10) / 10,
    changeCount,
    cutCount,
    raiseCount,
    avgDaysBetween: changeCount > 0 ? Math.round((lastMs - firstMs) / 86_400_000 / changeCount) : 0,
    daysOnMarket: Math.max(0, Math.floor((now - firstMs) / 86_400_000)),
    daysSinceLastChange: Math.max(0, Math.floor((now - lastMs) / 86_400_000)),
  };
}

/**
 * Grafik için veri noktaları. Recharts serileştirilebilir düz nesne istiyor.
 * Son noktadan sonra "bugün" kuyruğu eklenir ki fiyatın ne kadardır sabit
 * kaldığı çizgide görünsün.
 */
export function toChartSeries(rows: PriceHistoryRow[]): Array<Record<string, string | number>> {
  if (rows.length === 0) return [];

  const fmt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" });
  const points = rows.map((row) => ({
    tarih: fmt.format(new Date(row.created_at)),
    fiyat: row.new_price,
  }));

  const lastMs = new Date(rows[rows.length - 1].created_at).getTime();
  if (Date.now() - lastMs > 86_400_000) {
    points.push({ tarih: "Bugün", fiyat: rows[rows.length - 1].new_price });
  }

  return points;
}
