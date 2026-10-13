import { CTR_RULE, expectedCtr } from "./collector";

/**
 * Arama performansı ekranı yardımcıları (SAF). Fırsat bayrağı toplayıcıdaki `gsc-ctr-opportunity` eşiğiyle aynıdır
 * (pozisyon 4–15, gösterim ≥100, CTR beklenenin yarısından düşük); beklenen CTR tahminidir ve ekranda öyle etiketlenir.
 */

export type PerfRow = { key: string; clicks: number; impressions: number; ctr: number; avg_position: number };

export const PERIODS = [28, 90] as const;
export type Period = (typeof PERIODS)[number];

export function parsePeriod(raw: string | undefined): Period {
  return raw === "90" ? 90 : 28;
}

export function isOpportunity(r: PerfRow): boolean {
  if (r.impressions < CTR_RULE.minImpressions) return false;
  if (r.avg_position < CTR_RULE.minPosition || r.avg_position > CTR_RULE.maxPosition) return false;
  return r.ctr < expectedCtr(r.avg_position) * CTR_RULE.lowRatio;
}

export function totals(rows: readonly PerfRow[]): { clicks: number; impressions: number; ctr: number } {
  let clicks = 0;
  let impressions = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
  }
  return { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0 };
}

export const fmtInt = (n: number) => n.toLocaleString("tr-TR");
export const fmtPct = (n: number) => `%${(n * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;
export const fmtPos = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
