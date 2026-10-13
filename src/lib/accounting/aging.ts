/**
 * Tahsilat yaşlandırması (SAF; sunucu, rapor merkezi ve test ortak). Tüm AÇIK faturalar (taslak/iptal borç sayılmaz)
 * vadeden bu yana geçen gün sayısıyla kovalara ayrılır. Vadesi gelmemiş ya da vadesiz fatura 0 gün sayılır ve "0-30"
 * kovasına girer (ayrıca `notDue` olarak sayılır; muhasebe "Bekleyen" kartı ile aynı kural: `isOverdue`).
 * Kova toplamı = muhasebe "Bekleyen + Gecikmiş" toplamı (aynı açık fatura listesi; test bunu doğrular).
 */
import { DAY_MS } from "@/lib/clock";
import { isOverdue, type LedgerInvoice } from "@/lib/accounting/ledger";

export const AGING_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  "0-30": "0-30 gün",
  "31-60": "31-60 gün",
  "61-90": "61-90 gün",
  "90+": "90+ gün",
};

export function isAgingBucket(v: unknown): v is AgingBucket {
  return typeof v === "string" && (AGING_BUCKETS as readonly string[]).includes(v);
}

/** Vadeden bu yana geçen tam gün (vade gelmediyse ya da vadesizse 0). */
export function daysPastDue(inv: Pick<LedgerInvoice, "dueAt">, nowMs: number): number {
  if (!inv.dueAt) return 0;
  const ref = Date.parse(inv.dueAt);
  if (!Number.isFinite(ref)) return 0;
  return Math.max(0, Math.floor((nowMs - ref) / DAY_MS));
}

export function agingBucketOf(days: number): AgingBucket {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export type AgingSummary = {
  buckets: Record<AgingBucket, { count: number; gross: number }>;
  total: { count: number; gross: number };
  /** Vadesi henüz gelmemiş (0-30 kovasının içinde). */
  notDue: { count: number; gross: number };
};

/** Yalnız durumu "open" olan satırlar sayılır; tutar BRÜT kuruş. */
export function summarizeAging(rows: readonly LedgerInvoice[], nowMs: number): AgingSummary {
  const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b, { count: 0, gross: 0 }])) as AgingSummary["buckets"];
  const total = { count: 0, gross: 0 };
  const notDue = { count: 0, gross: 0 };
  for (const inv of rows) {
    if (inv.status !== "open") continue;
    const b = buckets[agingBucketOf(daysPastDue(inv, nowMs))];
    b.count += 1;
    b.gross += inv.grossKurus;
    total.count += 1;
    total.gross += inv.grossKurus;
    if (!isOverdue(inv, nowMs)) {
      notDue.count += 1;
      notDue.gross += inv.grossKurus;
    }
  }
  return { buckets, total, notDue };
}
