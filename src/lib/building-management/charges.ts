/**
 * Bina aidatı tahakkuk SAF kuralları. Durum SQL tarafında saklanan `pending|partial|paid` + vade geçti (okuma anında türetilir).
 * Tarihler `YYYY-MM-DD` (TR günü) olarak DIŞARIDAN verilir; burada saat okunmaz.
 */
import { dayDiff, round2, toKurus, fromKurus } from "@/lib/property-management/payments";

export type BuildingChargeStatus = "pending" | "partial" | "paid" | "overdue";

export const BUILDING_STATUS_LABELS: Record<BuildingChargeStatus, string> = {
  pending: "Bekliyor",
  partial: "Kısmi ödendi",
  paid: "Ödendi",
  overdue: "Gecikti",
};

export const BATCH_KIND_LABELS = { aidat: "Aylık aidat", expense_share: "Ortak gider" } as const;
export type BatchKind = keyof typeof BATCH_KIND_LABELS;

export const PAYER_LABELS = { owner: "Malik", tenant: "Kiracı" } as const;
export type PayerRole = keyof typeof PAYER_LABELS;

export const BUILDING_PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Nakit",
  bank_transfer: "Havale / EFT",
  card: "Kart",
  cheque: "Çek",
  owner_offset: "Kira hakedişinden mahsup",
};

/**
 * Durum: ödendi → vadesi geçmiş ödenmemiş "gecikti" → kısmi → bekliyor.
 * Vade günü dahil değil: vade tarihi bugünden KÜÇÜKSE gecikti (SQL: due_date < bugün ile aynı).
 */
export function deriveBuildingChargeStatus(input: { amount: number; paid: number; dueDate: string; today: string }): BuildingChargeStatus {
  const amountK = toKurus(input.amount);
  const paidK = toKurus(input.paid);
  if (paidK >= amountK) return "paid";
  if (dayDiff(input.today, input.dueDate) > 0) return "overdue";
  return paidK > 0 ? "partial" : "pending";
}

/** Vade günü (1-28) + dönem (ayın 1'i) → vade tarihi. */
export function buildingDueDate(period: string, dueDay: number): string {
  const day = Math.min(Math.max(Math.trunc(dueDay) || 1, 1), 28);
  return `${period.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

/** Dönem başlangıcı: `YYYY-MM` → `YYYY-MM-01`. */
export function periodStart(month: string): string {
  return `${month.slice(0, 7)}-01`;
}

/** Yönetim ücreti açıklaması: "%8" ya da "Daire başına ₺150 / ay". */
export function buildingFeeDescription(feeType: "percent" | "fixed" | null, feeValue: number | null): string {
  if (!feeType || feeValue == null) return "Ücret yok";
  if (feeType === "percent") return `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(feeValue)}`;
  return `Daire başına ${new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(feeValue)} / ay`;
}

export type SummaryCharge = { amount: number; paid: number; dueDate: string };

/** Tahakkuk listesi özeti (kuruş toplamı): tahakkuk, ödenen, kalan, geciken adet/tutar. */
export function summarizeCharges(charges: readonly SummaryCharge[], today: string) {
  let amountK = 0;
  let paidK = 0;
  let overdueK = 0;
  let overdueCount = 0;
  for (const c of charges) {
    const a = toKurus(c.amount);
    const p = Math.min(toKurus(c.paid), a);
    amountK += a;
    paidK += p;
    if (p < a && dayDiff(today, c.dueDate) > 0) {
      overdueK += a - p;
      overdueCount += 1;
    }
  }
  return {
    charged: fromKurus(amountK),
    paid: fromKurus(paidK),
    outstanding: fromKurus(amountK - paidK),
    overdueCount,
    overdueAmount: fromKurus(overdueK),
    collectionRate: amountK > 0 ? round2((paidK / amountK) * 100) : 0,
  };
}
