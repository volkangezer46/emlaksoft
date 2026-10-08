/**
 * Kira tahsilatı SAF kuralları (Mülk yönetimi omurgası, M1). SQL tarafındaki `pm_recompute_charge` / `record_rent_payment`
 * ile BİREBİR aynı kurallar: sözleşme testi (property-management-sql-exec.test.ts) iki tarafı aynı örneklerle sınar.
 *
 * Tarihler `YYYY-MM-DD` (TR günü) olarak DIŞARIDAN verilir; burada saat okunmaz. Para birimi TRY, kuruşa yuvarlanır.
 */

export const PAYMENT_METHODS = ["cash", "bank_transfer", "card", "cheque"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Nakit",
  bank_transfer: "Havale / EFT",
  card: "Kart",
  cheque: "Çek",
};

/** Mülk sahibine ödeme yöntemleri (kart yok). */
export const PAYOUT_METHODS = ["bank_transfer", "cash", "cheque"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === "string" && (PAYMENT_METHODS as readonly string[]).includes(v);
}
export function isPayoutMethod(v: unknown): v is PayoutMethod {
  return typeof v === "string" && (PAYOUT_METHODS as readonly string[]).includes(v);
}

export type ChargeStatus = "pending" | "partial" | "paid" | "overdue";
export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  pending: "Bekliyor",
  partial: "Kısmi ödendi",
  paid: "Ödendi",
  overdue: "Gecikti",
};

/** Vadeden kaç gün sonra tahakkuk "gecikti" sayılır (cron ve SQL ile aynı). */
export const OVERDUE_GRACE_DAYS = 7;

/** Kuruşa yuvarlama (yarım yukarı; kayan nokta gürültüsüne dayanıklı). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
export const toKurus = (n: number): number => Math.round(n * 100);
export const fromKurus = (k: number): number => k / 100;

function dayNumber(day: string): number {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}
export function dayDiff(laterDay: string, earlierDay: string): number {
  return dayNumber(laterDay) - dayNumber(earlierDay);
}
export function addDays(day: string, n: number): string {
  const ms = (dayNumber(day) + n) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Tahakkuk dönemi (ayın 1'i) + vade günü (1-28) -> vade tarihi. */
export function chargeDueDate(period: string, dueDay: number): string {
  const day = Math.min(Math.max(Math.trunc(dueDay) || 1, 1), 28);
  return `${period.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

/** Kalan (ödenmemiş) tutar; negatif olmaz. */
export function remainingAmount(amount: number, paid: number): number {
  return fromKurus(Math.max(0, toKurus(amount) - toKurus(paid)));
}

/** Ödenen toplamdan durum: ödendi / vade+7 gün geçmişse gecikti / kısmi / bekliyor (SQL pm_recompute_charge ile aynı). */
export function deriveChargeStatus(input: { amount: number; paid: number; dueDate: string; today: string }): ChargeStatus {
  const amountK = toKurus(input.amount);
  const paidK = toKurus(input.paid);
  if (paidK >= amountK) return "paid";
  if (dayDiff(input.today, input.dueDate) > OVERDUE_GRACE_DAYS) return "overdue";
  return paidK > 0 ? "partial" : "pending";
}

/** Gecikme günü: ödenmemiş tutar varken vadeden bugüne gün sayısı (vade gelmediyse 0). Tam ödenmişse 0. */
export function daysLate(input: { amount: number; paid: number; dueDate: string; today: string }): number {
  if (toKurus(input.paid) >= toKurus(input.amount)) return 0;
  return Math.max(0, dayDiff(input.today, input.dueDate));
}

export type LateFeeSettings = { enabled: boolean; monthlyPercent: number; graceDays: number };

export const LATE_FEE_DEFAULTS: LateFeeSettings = { enabled: false, monthlyPercent: 0, graceDays: 0 };

/**
 * Gecikme bedeli (YALNIZ ofis ayarı AÇIKSA): kalan tutar × aylık % × (gecikme günü − hoşgörü günü) / 30, kuruşa yuvarlanır.
 * Bilgi amaçlıdır: tahakkuka otomatik eklenmez, ofis isterse tahsil eder.
 */
export function computeLateFee(input: { outstanding: number; daysLate: number; settings: LateFeeSettings }): number {
  const { settings } = input;
  if (!settings.enabled || !(settings.monthlyPercent > 0)) return 0;
  const effectiveDays = Math.max(0, Math.trunc(input.daysLate) - Math.max(0, Math.trunc(settings.graceDays)));
  if (effectiveDays === 0 || !(input.outstanding > 0)) return 0;
  return round2((input.outstanding * settings.monthlyPercent * effectiveDays) / 100 / 30);
}

export const PAYOUT_REMINDER_TOLERANCE_DAYS = 3;

/** Bu gün mülk sahibine ödeme hatırlatma penceresinde mi? (gün = ayın günü, ödeme günü 1-28) */
export function inPayoutWindow(dayOfMonth: number, payoutDay: number): boolean {
  return dayOfMonth >= payoutDay && dayOfMonth <= payoutDay + PAYOUT_REMINDER_TOLERANCE_DAYS;
}

/** Makbuz numarası gösterimi: MKB-000123. */
export function formatReceiptNo(n: number): string {
  return `MKB-${String(Math.max(0, Math.trunc(n))).padStart(6, "0")}`;
}
/** Ofis sayacının bir sonraki makbuz sırası (SQL: last_no + 1). */
export function nextReceiptNo(last: number | null | undefined): number {
  return Math.max(0, Math.trunc(last ?? 0)) + 1;
}

export type FeeType = "percent" | "fixed";

/**
 * Bir tahsilattan ofisin yönetim ücreti (SQL ile aynı):
 *  - yüzde: tutar × oran / 100, kuruşa yuvarlanır;
 *  - sabit (TL/ay): aynı tahakkuk için en çok sabit tutar; önceki tahsilatlarda alınan ücret düşülür, tahsilat tutarını aşmaz.
 */
export function calcPaymentFee(input: { feeType: FeeType | null; feeValue: number | null; amount: number; priorFeeOnCharge?: number }): number {
  const { feeType, feeValue, amount } = input;
  if (!feeType || feeValue == null || !(feeValue >= 0) || !(amount > 0)) return 0;
  if (feeType === "percent") return round2((amount * feeValue) / 100);
  const priorK = toKurus(input.priorFeeOnCharge ?? 0);
  return fromKurus(Math.max(0, Math.min(toKurus(feeValue) - priorK, toKurus(amount))));
}
