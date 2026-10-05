/**
 * Fatura × kredi planı — SAF para matematiği (kuruş tamsayısı; float toplama hatası YOK).
 * Kredi faturanın KDV DAHİL toplamına uygulanır; fatura tutarı/KDV'si değişmez. iyzico yalnız `cashTry` tahsil eder.
 * SQL `try_credit_reserve` ile aynı kural: kredi ≤ floor(toplam × pay, kuruş) ve ≤ harcanabilir bakiye.
 */
import { KURUS, TRY_DEFAULT_MAX_SHARE, TRY_FULL_CREDIT_SHARE } from "./constants";

/** TL → kuruş (yuvarlama: en yakın kuruş). */
export function toKurus(tl: number): number {
  return Math.round(tl * KURUS);
}

export function fromKurus(kurus: number): number {
  return kurus / KURUS;
}

/** Bu faturada kullanılabilecek EN YÜKSEK kredi (TL): min(harcanabilir, floor(toplam × pay)). */
export function maxCreditForInvoice(input: { totalTry: number; availableTry: number; maxShare?: number }): number {
  const share = input.maxShare ?? TRY_DEFAULT_MAX_SHARE;
  if (!(share > 0) || share > 1) return 0;
  const totalK = toKurus(input.totalTry);
  const availK = Math.max(0, toKurus(input.availableTry));
  if (!(totalK > 0)) return 0;
  // Pay çarpımında float hatası olmasın: pay 1/10000 hassasiyetinde tamsayıya çevrilir.
  const shareBp = Math.round(share * 10000);
  const capK = Math.floor((totalK * shareBp) / 10000);
  return fromKurus(Math.min(availK, capK));
}

export type InvoiceCreditPlan = {
  /** Kredi ile ödenecek tutar (KDV dahil toplamdan). */
  creditTry: number;
  /** iyzico'dan tahsil edilecek tutar (>= 0). */
  cashTry: number;
  /** Kredi toplamın tamamını karşılıyor: iyzico ÇAĞRILMAZ (yalnız pay = 1 yapılandırmasında olur). */
  fullCredit: boolean;
};

/**
 * Kullanıcı isteğine göre kredi planı. `requestedTry` verilmezse mümkün olan en yüksek tutar kullanılır
 * ("kredimi kullan" onay kutusu). Sıfır/negatif/geçersiz → kredi yok.
 */
export function planInvoiceCredit(input: {
  totalTry: number;
  availableTry: number;
  maxShare?: number;
  requestedTry?: number | null;
}): InvoiceCreditPlan {
  const totalK = toKurus(input.totalTry);
  const maxTry = maxCreditForInvoice(input);
  let creditK = toKurus(maxTry);
  if (input.requestedTry != null) {
    const reqK = toKurus(input.requestedTry);
    creditK = Number.isFinite(reqK) && reqK > 0 ? Math.min(reqK, creditK) : 0;
  }
  if (!(creditK > 0) || !(totalK > 0)) return { creditTry: 0, cashTry: fromKurus(Math.max(totalK, 0)), fullCredit: false };
  const cashK = totalK - creditK;
  return { creditTry: fromKurus(creditK), cashTry: fromKurus(cashK), fullCredit: cashK === 0 };
}

/** Pay yapılandırması tam krediyi mümkün kılıyor mu? */
export function fullCreditEnabled(maxShare: number): boolean {
  return maxShare >= TRY_FULL_CREDIT_SHARE;
}

/**
 * İade dağılımı: iade tutarı ÖNCE nakit kısmından düşer, artan kısım krediye geri yazılır.
 * `refundTry` = faturaya kaydedilen iade; `cashPaidTry` = iyzico'dan alınan; `creditUsedTry` = harcanan kredi;
 * `alreadyRestoredTry` = daha önce geri yazılan kredi (kısmi/tekrarlı iade).
 */
export function creditRestoreForRefund(input: {
  refundTry: number;
  cashPaidTry: number;
  creditUsedTry: number;
  alreadyRestoredTry?: number;
}): number {
  const refundK = Math.max(0, toKurus(input.refundTry));
  const cashK = Math.max(0, toKurus(input.cashPaidTry));
  const usedK = Math.max(0, toKurus(input.creditUsedTry));
  const doneK = Math.max(0, toKurus(input.alreadyRestoredTry ?? 0));
  const wantK = Math.max(0, refundK - cashK);
  return fromKurus(Math.max(0, Math.min(wantK, usedK) - doneK));
}
