/**
 * Komisyon üst sınırı kontrolü — saf aritmetik, mevzuat gömülü DEĞİL.
 *
 * ÖNEMLİ: Aşağıdaki varsayılanlar (satışta %4, kirada 1 aylık kira, KDV %20)
 * PARAMETREDİR ve DOĞRULANMALIDIR (Ticaret Bakanlığı Gayrimenkul Ticareti
 * Hakkında Yönetmelik / ilgili tebliğ ve güncel KDV oranı; bkz.
 * docs/TURKIYE_UYUM_NOTLARI.md). Mevzuat değişirse çağıran taraf kendi
 * değerini geçer; uygulama hukuki karar vermez.
 *
 * Tavan, KDV HARİÇ toplam hizmet bedeli (alıcı + satıcı/kiracı + kiraya veren
 * toplamı) üzerinden değerlendirilir; KDV ayrıca eklenir.
 */

/** Doğrulanmalı: satış hizmet bedeli üst sınırı, yüzde (KDV hariç, taraflar toplamı). */
export const DEFAULT_SALE_CAP_RATE = 4;
/** Doğrulanmalı: kira hizmet bedeli üst sınırı, aylık kira katı (KDV hariç). */
export const DEFAULT_RENT_CAP_MONTHS = 1;
/** Doğrulanmalı: genel KDV oranı, yüzde (src/lib/commission.ts ile aynı değer). */
export const DEFAULT_CAP_VAT_RATE = 20;
/** Tavanı yaklaşmış sayma eşiği (tavanın kaçı). */
export const NEAR_CAP_RATIO = 0.9;

export type CommissionCapKind = "sale" | "rent";

export type CommissionCapParams = {
  /** Satış tavanı, yüzde. */
  saleCapRate?: number;
  /** Kira tavanı, aylık kira katı. */
  rentCapMonths?: number;
  /** KDV oranı, yüzde. */
  vatRate?: number;
};

export type CommissionCapInput = CommissionCapParams & {
  kind: CommissionCapKind;
  /** Satışta satış bedeli, kirada AYLIK kira. */
  amount: number;
  /** Komisyon oranı (yüzde, KDV hariç). `commissionAmount` ile birlikte verilirse tutar önceliklidir. */
  commissionRate?: number;
  /** Komisyon tutarı. */
  commissionAmount?: number;
  /** `commissionAmount` KDV dahil mi? Varsayılan false (KDV hariç). */
  vatIncluded?: boolean;
};

export type CommissionCapResult = {
  /** Girdiler geçerli ve hesaplanabildi mi. */
  valid: boolean;
  /** Geçersizse neden (Türkçe, kullanıcıya gösterilebilir). */
  reason?: string;
  /** Uygulanan tavan, KDV hariç tutar (TL). */
  capNet: number;
  /** Tavanın KDV dahil karşılığı. */
  capGross: number;
  /** Alınmak istenen komisyon, KDV hariç. */
  requestedNet: number;
  /** Tavanı aşıyor mu. */
  exceeds: boolean;
  /** Tavanın %90'ına ulaştı ama aşmadı. */
  nearCap: boolean;
  /** Aşan kısım, KDV hariç (aşmıyorsa 0). */
  excessNet: number;
  /** Aşan kısmın KDV dahil karşılığı. */
  excessGross: number;
  /** İstenen komisyonun bedele oranı (yüzde). */
  requestedRatePct: number;
  /** Tavan içindeki komisyonun KDV'si. */
  capVat: number;
};

/** Kuruşa yuvarlar; NaN/Infinity için 0. */
export function roundKurus(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function emptyResult(reason: string): CommissionCapResult {
  return {
    valid: false,
    reason,
    capNet: 0,
    capGross: 0,
    requestedNet: 0,
    exceeds: false,
    nearCap: false,
    excessNet: 0,
    excessGross: 0,
    requestedRatePct: 0,
    capVat: 0,
  };
}

function isNonNegFinite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** Tavanı KDV hariç TL olarak döndürür. Geçersiz girdide 0. */
export function computeCapNet(
  kind: CommissionCapKind,
  amount: number,
  params: CommissionCapParams = {},
): number {
  if (!isNonNegFinite(amount)) return 0;
  const { saleCapRate = DEFAULT_SALE_CAP_RATE, rentCapMonths = DEFAULT_RENT_CAP_MONTHS } = params;
  const factor = kind === "sale" ? saleCapRate / 100 : rentCapMonths;
  if (!isNonNegFinite(factor)) return 0;
  return roundKurus(amount * factor);
}

export function checkCommissionCap(input: CommissionCapInput): CommissionCapResult {
  const { kind, amount, commissionRate, commissionAmount, vatIncluded = false } = input;
  const vatRate = input.vatRate ?? DEFAULT_CAP_VAT_RATE;

  if (!isNonNegFinite(amount) || amount === 0) {
    return emptyResult(kind === "sale" ? "Satış bedeli sıfırdan büyük olmalı." : "Aylık kira sıfırdan büyük olmalı.");
  }
  if (!isNonNegFinite(vatRate)) return emptyResult("KDV oranı geçersiz.");

  const capNet = computeCapNet(kind, amount, input);
  if (capNet <= 0) return emptyResult("Tavan parametresi geçersiz.");

  let requestedNet: number;
  if (commissionAmount !== undefined) {
    if (!isNonNegFinite(commissionAmount)) return emptyResult("Komisyon tutarı geçersiz.");
    requestedNet = vatIncluded ? commissionAmount / (1 + vatRate / 100) : commissionAmount;
  } else if (commissionRate !== undefined) {
    if (!isNonNegFinite(commissionRate)) return emptyResult("Komisyon oranı geçersiz.");
    requestedNet = (amount * commissionRate) / 100;
  } else {
    return emptyResult("Komisyon oranı veya tutarı girilmedi.");
  }
  requestedNet = roundKurus(requestedNet);

  const excessNet = roundKurus(Math.max(0, requestedNet - capNet));
  const exceeds = excessNet > 0;
  const k = 1 + vatRate / 100;

  return {
    valid: true,
    capNet,
    capGross: roundKurus(capNet * k),
    requestedNet,
    exceeds,
    nearCap: !exceeds && requestedNet >= capNet * NEAR_CAP_RATIO,
    excessNet,
    excessGross: roundKurus(excessNet * k),
    requestedRatePct: roundKurus((requestedNet / amount) * 100),
    capVat: roundKurus(capNet * (vatRate / 100)),
  };
}

export type CommissionSplit = {
  /** Alıcı (veya kiracı) tarafı, KDV hariç. */
  buyerNet: number;
  /** Satıcı (veya kiraya veren) tarafı, KDV hariç. */
  sellerNet: number;
  buyerVat: number;
  sellerVat: number;
  buyerGross: number;
  sellerGross: number;
  /** Toplam KDV hariç (buyerNet + sellerNet = tutar). */
  totalNet: number;
};

/**
 * Toplam KDV hariç komisyonu iki tarafa böler (varsayılan %50/%50, ör. %2+%2).
 * Kuruş farkı satıcıya yazılır; böylece toplam her zaman tutara eşittir.
 */
export function suggestCommissionSplit(
  totalNet: number,
  options: { vatRate?: number; buyerSharePct?: number } = {},
): CommissionSplit {
  const vatRate = isNonNegFinite(options.vatRate) ? options.vatRate : DEFAULT_CAP_VAT_RATE;
  const share = isNonNegFinite(options.buyerSharePct) && options.buyerSharePct <= 100 ? options.buyerSharePct : 50;
  const total = isNonNegFinite(totalNet) ? roundKurus(totalNet) : 0;
  const buyerNet = roundKurus((total * share) / 100);
  const sellerNet = roundKurus(total - buyerNet);
  const buyerVat = roundKurus((buyerNet * vatRate) / 100);
  const sellerVat = roundKurus((sellerNet * vatRate) / 100);
  return {
    buyerNet,
    sellerNet,
    buyerVat,
    sellerVat,
    buyerGross: roundKurus(buyerNet + buyerVat),
    sellerGross: roundKurus(sellerNet + sellerVat),
    totalNet: total,
  };
}
