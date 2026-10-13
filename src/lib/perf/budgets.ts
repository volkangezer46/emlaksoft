/**
 * HIZ BÜTÇELERİ (tek kaynak; SAF). Statik ana sayfa HTML'i (satır içi CSS + düz JS dahil, adacıklar hariç):
 *  - gzip ≤ 80 KB, ham ≤ 360 KB (F1). Ölçüm: `scripts/check-bundle-budget.ts` (CI kapısı) ve Hız ekranı (canlı önbellek).
 * Panel JS bütçeleri ayrı tutulur (scripts/check-bundle-budget.ts `BUDGET`).
 */
export const STATIC_HTML_BUDGET = { gzipKb: 80, rawKb: 360 } as const;

/** PSI puanında bu kadardan FAZLA düşüş bulgu üretir (speedCollector). */
export const PSI_DROP_THRESHOLD = 5;

export type HtmlSize = { rawBytes: number; gzipBytes: number };
export type BudgetViolation = { metric: "gzip" | "raw"; actualKb: number; limitKb: number; message: string };

export const toKb = (bytes: number) => bytes / 1024;

/** Ölçümü statik HTML bütçesiyle karşılaştırır (yan etkisiz). */
export function checkStaticHtmlBudget(size: HtmlSize, budget: { gzipKb: number; rawKb: number } = STATIC_HTML_BUDGET): BudgetViolation[] {
  const out: BudgetViolation[] = [];
  const gz = toKb(size.gzipBytes);
  const raw = toKb(size.rawBytes);
  if (gz > budget.gzipKb) out.push({ metric: "gzip", actualKb: gz, limitKb: budget.gzipKb, message: `gzip ${gz.toFixed(1)} KB > ${budget.gzipKb} KB` });
  if (raw > budget.rawKb) out.push({ metric: "raw", actualKb: raw, limitKb: budget.rawKb, message: `ham ${raw.toFixed(1)} KB > ${budget.rawKb} KB` });
  return out;
}
