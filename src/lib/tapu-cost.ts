/**
 * Tapu harcı hesabı — saf, parametrik. ORAN GÖMÜLÜ DEĞİL.
 *
 * Harç, tapu harçları mevzuatındaki oranlarla hesaplanır; oranlar ve
 * matrah esasları (beyan/rayiç/emlak vergi değeri) DOĞRULANMALIDIR
 * (bkz. docs/TURKIYE_UYUM_NOTLARI.md). Varsayılan oran YOKTUR: çağıran
 * `buyerRatePct` ve `sellerRatePct` geçmek zorundadır. Tek varsayılan,
 * düşük beyan uyarı eşiğidir (doğrulanmalı).
 */

/** Doğrulanmalı: beyan, rayiç değerin bu oranının altındaysa uyarı (yüzde). */
export const DEFAULT_UNDERDECLARATION_THRESHOLD_PCT = 90;

export type TapuCostInput = {
  /** Satış/beyan bedeli (TL). */
  declaredValue: number;
  /** Alıcı harç oranı, yüzde (2 = %2). Zorunlu parametre. */
  buyerRatePct: number;
  /** Satıcı harç oranı, yüzde. Zorunlu parametre. */
  sellerRatePct: number;
  /** Rayiç/emlak vergi değeri veya ekspertiz (TL); varsa beyanla kıyaslanır. */
  appraisedValue?: number;
  /** Düşük beyan uyarı eşiği, yüzde. */
  thresholdPct?: number;
};

export type TapuCostResult = {
  valid: boolean;
  reason?: string;
  buyerFee: number;
  sellerFee: number;
  totalFee: number;
  /** Harcın hesaplandığı matrah. */
  base: number;
  /** Rayiç verildiyse: beyan/rayiç oranı (yüzde). */
  declaredToAppraisedPct: number | null;
  /** Beyan rayiçten eşik kadar düşükse true. */
  underDeclared: boolean;
  /** Rayiç - beyan farkı (TL); beyan düşük değilse 0. */
  valueGap: number;
  /** Uyarı mesajı (Türkçe) veya null. */
  warning: string | null;
};

export function roundKurus(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function invalid(reason: string): TapuCostResult {
  return {
    valid: false,
    reason,
    buyerFee: 0,
    sellerFee: 0,
    totalFee: 0,
    base: 0,
    declaredToAppraisedPct: null,
    underDeclared: false,
    valueGap: 0,
    warning: null,
  };
}

const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

export function computeTapuCost(input: TapuCostInput): TapuCostResult {
  const { declaredValue, buyerRatePct, sellerRatePct, appraisedValue } = input;
  const threshold = input.thresholdPct ?? DEFAULT_UNDERDECLARATION_THRESHOLD_PCT;

  if (!ok(declaredValue) || declaredValue === 0) return invalid("Beyan bedeli sıfırdan büyük olmalı.");
  if (!ok(buyerRatePct) || !ok(sellerRatePct)) return invalid("Harç oranları girilmeli ve negatif olamaz.");
  if (!ok(threshold) || threshold > 100) return invalid("Uyarı eşiği 0-100 arasında olmalı.");
  if (appraisedValue !== undefined && !ok(appraisedValue)) return invalid("Rayiç değer geçersiz.");

  const buyerFee = roundKurus((declaredValue * buyerRatePct) / 100);
  const sellerFee = roundKurus((declaredValue * sellerRatePct) / 100);

  let pct: number | null = null;
  let under = false;
  let gap = 0;
  let warning: string | null = null;
  if (appraisedValue !== undefined && appraisedValue > 0) {
    pct = roundKurus((declaredValue / appraisedValue) * 100);
    under = (declaredValue / appraisedValue) * 100 < threshold;
    if (under) {
      gap = roundKurus(appraisedValue - declaredValue);
      warning =
        "Beyan edilen bedel rayiç/değer tespitinin belirgin altında. Düşük beyan idari yaptırım riski doğurabilir; " +
        "güncel mevzuatı doğrulayın.";
    }
  }

  return {
    valid: true,
    buyerFee,
    sellerFee,
    totalFee: roundKurus(buyerFee + sellerFee),
    base: roundKurus(declaredValue),
    declaredToAppraisedPct: pct,
    underDeclared: under,
    valueGap: gap,
    warning,
  };
}
