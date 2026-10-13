/**
 * Tahsilat kurtarma raporu (SAF; `/admin/billing/tahsilat`). Tek kaynak fatura verisidir (`invoices`); sayılar
 * aşağıdaki tanımlarla hesaplanır ve ekranda aynen yazılır:
 *
 * - BAŞARISIZ TAHSİLAT: vadesi pencere içinde ve geçmiş, vadesinde ödenmemiş fatura (açık kaldı ya da vadeden SONRA ödendi
 *   ya da tahsil edilemedi). Taslak/iptal faturalar sayılmaz.
 * - KURTARILAN: vadeden SONRA ödenen ve ödeme tarihi pencere içinde olan fatura. Tutar = `total_try` toplamı (fatura
 *   tutarıyla birebir). Kurtarılan MRR = aylık karşılık (dönem 45 günden uzunsa tutar ÷ dönem ay sayısı).
 * - İSTEMSİZ KAYIP: başarısız tahsilatı "tahsil edilemedi" olan ya da kayıp eşiğini (son kademe ya da otomatik askı günü,
 *   hangisi önceyse) aşıp hâlâ açık olan ofis. Oran = kayıp ofis ÷ ücretli ofis (aktif + gecikmiş abonelik).
 */

export const RECOVERY_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

export type ReportInvoice = {
  id: string;
  tenant_id: string;
  invoice_no: string;
  status: string;
  total_try: number | string | null;
  due_at: string | null;
  paid_at: string | null;
  period_start?: string | null;
  period_end?: string | null;
};

export type RecoveryList = "basarisiz" | "kurtarilan" | "kayip";

export type RecoveryReport = {
  windowDays: number;
  failed: ReportInvoice[];
  recovered: ReportInvoice[];
  lost: ReportInvoice[];
  failedCount: number;
  recoveredCount: number;
  recoveredAmount: number;
  recoveredMrr: number;
  lostTenants: number;
  payingTenants: number;
  /** null = payda yok (ücretli ofis 0). */
  involuntaryChurnRate: number | null;
  /** null = başarısız tahsilat yok. */
  recoveryRate: number | null;
};

const ms = (v: string | null | undefined) => (v ? new Date(v).getTime() : NaN);
const amount = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Faturanın aylık karşılığı: dönem 45 günden uzunsa tutar ÷ ay sayısı (yıllık → /12). */
export function monthlyEquivalent(inv: Pick<ReportInvoice, "total_try" | "period_start" | "period_end">): number {
  const total = amount(inv.total_try);
  const span = ms(inv.period_end) - ms(inv.period_start);
  if (!Number.isFinite(span) || span <= 45 * DAY_MS) return total;
  const months = Math.max(1, Math.round(span / (30.4375 * DAY_MS)));
  return total / months;
}

export function computeRecoveryReport(input: {
  invoices: readonly ReportInvoice[];
  payingTenants: number;
  /** Bu gün sayısını aşan açık fatura kayıp sayılır (son kademe / askı günü). */
  lossThresholdDays: number;
  nowMs: number;
  windowDays?: number;
}): RecoveryReport {
  const windowDays = input.windowDays ?? RECOVERY_WINDOW_DAYS;
  const since = input.nowMs - windowDays * DAY_MS;
  const failed: ReportInvoice[] = [];
  const recovered: ReportInvoice[] = [];
  const lost: ReportInvoice[] = [];

  for (const inv of input.invoices) {
    if (inv.status === "draft" || inv.status === "void") continue;
    const due = ms(inv.due_at);
    if (!Number.isFinite(due)) continue;
    const paid = ms(inv.paid_at);
    const paidLate = inv.status === "paid" && Number.isFinite(paid) && paid > due;

    if (due >= since && due < input.nowMs) {
      const unpaidOnTime = inv.status === "open" || inv.status === "uncollectible" || paidLate;
      if (unpaidOnTime) {
        failed.push(inv);
        const overdueDays = Math.floor((input.nowMs - due) / DAY_MS);
        if (inv.status === "uncollectible" || (inv.status === "open" && overdueDays >= input.lossThresholdDays)) lost.push(inv);
      }
    }
    if (paidLate && paid >= since && paid <= input.nowMs) recovered.push(inv);
  }

  const lostTenants = new Set(lost.map((i) => i.tenant_id)).size;
  return {
    windowDays,
    failed,
    recovered,
    lost,
    failedCount: failed.length,
    recoveredCount: recovered.length,
    recoveredAmount: round2(recovered.reduce((s, i) => s + amount(i.total_try), 0)),
    recoveredMrr: round2(recovered.reduce((s, i) => s + monthlyEquivalent(i), 0)),
    lostTenants,
    payingTenants: input.payingTenants,
    involuntaryChurnRate: input.payingTenants > 0 ? lostTenants / input.payingTenants : null,
    recoveryRate: failed.length > 0 ? failed.filter((i) => i.status === "paid").length / failed.length : null,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function parseRecoveryList(raw: string | string[] | undefined): RecoveryList {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "kurtarilan" || v === "kayip" ? v : "basarisiz";
}
