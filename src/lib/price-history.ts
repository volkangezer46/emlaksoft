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
  /** O günkü TCMB kuruyla döviz karşılıkları (kur yoksa null) */
  new_price_usd?: number | null;
  new_price_eur?: number | null;
  old_price_usd?: number | null;
  old_price_eur?: number | null;
  /** Kurun alındığı tarih — hafta sonu/tatilde önceki iş gününe düşer */
  fx_date?: string | null;
};

/** Fiyatların gösterileceği para birimi. */
export type PriceCurrency = "TRY" | "USD" | "EUR";

export const CURRENCY_LABEL: Record<PriceCurrency, string> = {
  TRY: "₺ TL",
  USD: "$ USD",
  EUR: "€ EUR",
};

const fmt: Record<PriceCurrency, Intl.NumberFormat> = {
  TRY: new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }),
  USD: new Intl.NumberFormat("tr-TR", { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
  EUR: new Intl.NumberFormat("tr-TR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }),
};

export function formatPrice(amount: number | null | undefined, currency: PriceCurrency): string {
  if (amount === null || amount === undefined) return "—";
  return fmt[currency].format(amount);
}

/**
 * Bir kaydın seçili para birimindeki tutarı.
 *
 * Kur kaydı yoksa `null` döner — TL değerini döviz gibi göstermek yerine
 * bilinmiyor demek doğrusu. (Uydurulmuş kur, yanlış karara yol açar.)
 */
export function priceIn(row: PriceHistoryRow, currency: PriceCurrency, which: "new" | "old" = "new"): number | null {
  if (currency === "TRY") return which === "new" ? row.new_price : row.old_price;
  if (currency === "USD") return (which === "new" ? row.new_price_usd : row.old_price_usd) ?? null;
  return (which === "new" ? row.new_price_eur : row.old_price_eur) ?? null;
}

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
 *
 * Döviz modunda kur verisi olmayan kayıtlar atlanır — TL değerini döviz
 * eksenine karıştırmak grafiği yalancı yapar.
 */
export function toChartSeries(
  rows: PriceHistoryRow[],
  currency: PriceCurrency = "TRY",
): Array<Record<string, string | number>> {
  if (rows.length === 0) return [];

  const fmt2 = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" });
  const points: Array<Record<string, string | number>> = [];
  for (const row of rows) {
    const value = priceIn(row, currency);
    if (value === null) continue;
    points.push({ tarih: fmt2.format(new Date(row.created_at)), fiyat: value });
  }

  if (points.length === 0) return [];

  const lastMs = new Date(rows[rows.length - 1].created_at).getTime();
  if (Date.now() - lastMs > 86_400_000) {
    points.push({ tarih: "Bugün", fiyat: points[points.length - 1].fiyat });
  }

  return points;
}
