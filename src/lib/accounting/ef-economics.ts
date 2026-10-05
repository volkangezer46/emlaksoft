/**
 * EmlakFiyati kontör GELİR / MALİYET hesabı (SAF: DB yok).
 * Toptan maliyet (kardeş firma tarifesi) `platform_settings` içinde `ef.wholesale` anahtarında tutulur:
 * { valuationTl, pdfTl } = işlem başına TL, KDV HARİÇ. Varsayılan 0/0 (EmlakFiyati kullanım tarifesi 0 TL).
 * Kontör kullanımı `ef_credit_reservations` (state='committed') kayıtlarından sayılır; rapor detayı (JSON)
 * çağrısının toptan maliyeti yoktur (kardeş firma tarifesinde ayrı kalem değil).
 */
import { z } from "zod";
import type { EfItem } from "@/lib/ef-credits/config";

export const EF_WHOLESALE_SETTING_KEY = "ef.wholesale";

export const efWholesaleSchema = z.object({
  /** Ada/parsel değerleme (arsa ve konut) işlem başı maliyet, TL, KDV hariç. */
  valuationTl: z.number().min(0).max(100_000),
  /** İlk PDF indirme işlem başı maliyet, TL, KDV hariç. */
  pdfTl: z.number().min(0).max(100_000),
});
export type EfWholesale = z.infer<typeof efWholesaleSchema>;

export const EF_WHOLESALE_DEFAULT: EfWholesale = { valuationTl: 0, pdfTl: 0 };

export function parseEfWholesale(raw: string | null | undefined): EfWholesale {
  if (!raw) return EF_WHOLESALE_DEFAULT;
  try {
    const parsed = efWholesaleSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EF_WHOLESALE_DEFAULT;
  } catch {
    return EF_WHOLESALE_DEFAULT;
  }
}

export function serializeEfWholesale(v: EfWholesale): string {
  return JSON.stringify(efWholesaleSchema.parse(v));
}

/** "1.234,56" / "12.5" / "0" -> sayı (>=0, en çok 4 ondalık, üst sınırlı); geçersiz null. Sıfır GEÇERLİDİR. */
export function parseWholesaleTl(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, "").replace(/₺|TRY|TL/gi, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n <= 100_000 ? n : null;
}

export const EF_USAGE_ITEMS: readonly EfItem[] = ["valuation_arsa", "valuation_konut", "pdf_first", "report_detail"];

export const EF_ITEM_LABELS: Record<EfItem, string> = {
  valuation_arsa: "Ada/parsel değerleme (arsa)",
  valuation_konut: "Ada/parsel değerleme (konut)",
  pdf_first: "İlk PDF indirme",
  report_detail: "Rapor detayı",
};

export type EfUsageRow = { item: string; units: number };
export type EfItemUsage = { item: EfItem; transactions: number; units: number; costKurus: number };

/** Kuruş cinsinden işlem başı maliyet. */
export function wholesaleUnitCostKurus(item: EfItem, w: EfWholesale): number {
  if (item === "valuation_arsa" || item === "valuation_konut") return Math.round(w.valuationTl * 100);
  if (item === "pdf_first") return Math.round(w.pdfTl * 100);
  return 0;
}

export type EfEconomics = {
  byItem: EfItemUsage[];
  transactions: number;
  units: number;
  costKurus: number;
  /** Dönemde satılan kontör paketlerinin net geliri (kuruş). */
  revenueNetKurus: number;
  /** Brüt marj = gelir − maliyet (kuruş). */
  marginKurus: number;
  /** Net gelir ÷ harcanan kontör (kuruş); harcama yoksa null. */
  revenuePerSpentUnitKurus: number | null;
};

/**
 * `usage`: kesinleşmiş rezervasyon satırları (item + units). Bilinmeyen item sayılmaz (sessiz kayıp olmasın diye
 * `unknownItems` ayrı döner). Maliyet = işlem sayısı × toptan tarife (kontör sayısı değil).
 */
export function computeEfEconomics(
  usage: readonly EfUsageRow[],
  wholesale: EfWholesale,
  revenueNetKurus: number,
): EfEconomics & { unknownItems: number } {
  const map = new Map<EfItem, EfItemUsage>(EF_USAGE_ITEMS.map((item) => [item, { item, transactions: 0, units: 0, costKurus: 0 }]));
  let unknownItems = 0;
  for (const row of usage) {
    const entry = map.get(row.item as EfItem);
    if (!entry) {
      unknownItems += 1;
      continue;
    }
    entry.transactions += 1;
    entry.units += Math.max(0, Math.trunc(Number(row.units) || 0));
    entry.costKurus += wholesaleUnitCostKurus(entry.item, wholesale);
  }
  const byItem = [...map.values()];
  const transactions = byItem.reduce((s, r) => s + r.transactions, 0);
  const units = byItem.reduce((s, r) => s + r.units, 0);
  const costKurus = byItem.reduce((s, r) => s + r.costKurus, 0);
  return {
    byItem,
    transactions,
    units,
    costKurus,
    revenueNetKurus,
    marginKurus: revenueNetKurus - costKurus,
    revenuePerSpentUnitKurus: units > 0 ? Math.round(revenueNetKurus / units) : null,
    unknownItems,
  };
}
