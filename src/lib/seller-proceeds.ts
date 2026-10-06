/**
 * Satıcı net hesaplayıcı — "elime ne geçer?" (SAF fonksiyon: I/O yok, tarih yok).
 *
 * Tüm yasal sabitler `src/lib/legal-constants` tek kaynağından gelir; `purchase-costs.ts`
 * ile AYNI sabitleri kullanır (harç oranı, KDV, komisyon). HER SONUÇ TAHMİNİDİR:
 * mali müşavirlik değildir, satıcının vergi durumu kişiye özeldir (diğer gelirler,
 * miras/bağış, daha önce kullanılan istisna, ÜFE endekslemesi vb.).
 *
 * Değer artış kazancı (GVK m.80 / mükerrer 80, yalın anlatım):
 *   kazanç = satış bedeli − (edinme bedeli [endekslenmiş] + edinme/iyileştirme giderleri) − satış giderleri
 *   edinmeden itibaren 5 yıl (60 ay) dolduysa vergi yok; dolmadıysa kazanç, yıllık istisnayı
 *   aşan kısım kadar gelir vergisine tabidir.
 */

import { round2 } from "@/lib/purchase-costs";
import {
  INCOME_TAX_BRACKETS,
  legalValue,
  progressiveTax,
  type LegalKey,
} from "@/lib/legal-constants";

export type SellerDeedFeeShare = "half" | "seller" | "none";

export type SellerProceedsInput = {
  /** Satış bedeli (₺). */
  salePrice: number;
  /** Alış (edinme) bedeli (₺). Bilinmiyorsa 0 → kazanç hesabı güvenilmez, uyarı çıkar. */
  acquisitionPrice: number;
  /** Edinmeden satışa geçen süre (ay). */
  holdingMonths: number;
  /** Edinme/iyileştirme giderleri: alış harcı, tadilat, komisyon vb. (₺). */
  acquisitionExpenses?: number;
  /** Alıştan satışa Yİ-ÜFE artışı (%). Eşiği (varsayılan %10) aşarsa alış bedeli endekslenir. */
  ufeIncreasePct?: number | null;
  /** Satıcı tarafı komisyon oranı (%, KDV hariç). Varsayılan: tavanın yarısı. */
  commissionPct?: number | null;
  /** Tapu harcı satıcı payı. Varsayılan "half" (kanuni %2). */
  deedFeeShare?: SellerDeedFeeShare;
  /** Satıştan kapatılacak kalan kredi/ipotek (₺). */
  outstandingLoan?: number | null;
  /** Aynı yıl içinde başka satışlarda kullanılan değer artışı istisnası (₺). */
  exemptionAlreadyUsed?: number | null;
  /** Aynı yıl beyan edilecek diğer gelir vergisi matrahı (₺) — kademeyi yükseltir. */
  otherTaxableIncome?: number | null;
  /** Taşınmazın emlak vergisi değeri (₺) — yalnız DKV uyarısı için; yoksa satış bedeli ipucu olarak kullanılır. */
  propertyTaxValue?: number | null;
};

export type SellerProceedsLine = { key: string; label: string; amount: number; note: string };

export type SellerProceedsResult = {
  /** Her sonuç tahmindir — arayüzde "Tahmini" etiketi bu bayrağa bağlıdır. */
  estimate: true;
  salePrice: number;
  deedFee: number;
  commissionNet: number;
  commissionVat: number;
  outstandingLoan: number;
  /** Elde tutma 5 yıldan kısa mı (vergi doğurabilir)? */
  withinTaxWindow: boolean;
  indexedAcquisitionCost: number;
  /** Vergi öncesi değer artış kazancı (negatifse 0). */
  gain: number;
  exemptionApplied: number;
  taxableGain: number;
  incomeTax: number;
  /** Vergi ve masraflar sonrası elde kalan (kredi kapatma dahil). */
  netProceeds: number;
  /** Vergi hariç, yalnız masraflar ve kredi sonrası. */
  netBeforeTax: number;
  lines: SellerProceedsLine[];
  notes: string[];
  warnings: string[];
  /** Hesapta kullanılan yasal sabitler — arayüz doğrulama rozeti için. */
  usedConstants: LegalKey[];
  usedTables: ("income_tax" | "dkv")[];
  dkvWarning: boolean;
};

function pos(n: number | null | undefined): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function computeSellerProceeds(input: SellerProceedsInput): SellerProceedsResult {
  const salePrice = pos(input.salePrice);
  const acquisitionPrice = pos(input.acquisitionPrice);
  const acquisitionExpenses = pos(input.acquisitionExpenses);
  const holdingMonths = Math.max(0, Math.floor(pos(input.holdingMonths)));
  const outstandingLoan = pos(input.outstandingLoan);
  const exemptionUsed = pos(input.exemptionAlreadyUsed);
  const otherIncome = pos(input.otherTaxableIncome);

  const vatPct = legalValue("vatGeneralPct");
  const commissionPct =
    input.commissionPct == null ? legalValue("saleCommissionCapPct") / 2 : Math.max(0, Number(input.commissionPct) || 0);

  const lines: SellerProceedsLine[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  const usedConstants: LegalKey[] = ["vatGeneralPct", "saleCommissionCapPct", "deedFeeTotalPct"];
  const usedTables: ("income_tax" | "dkv")[] = [];

  // --- Satış giderleri ---
  const share = input.deedFeeShare ?? "half";
  const deedPct = share === "none" ? 0 : share === "seller" ? legalValue("deedFeeTotalPct") : legalValue("deedFeeTotalPct") / 2;
  const deedFee = round2((salePrice * deedPct) / 100);
  const commissionNet = round2((salePrice * commissionPct) / 100);
  const commissionVat = round2((commissionNet * vatPct) / 100);

  if (deedFee > 0) {
    lines.push({
      key: "deed_fee",
      label: "Tapu harcı (satıcı payı)",
      amount: deedFee,
      note: share === "seller" ? "Toplam harcın tamamı satıcıda (taraflarca kararlaştırıldıysa)." : "Toplam harcın yarısı satıcıda, kanuni paylaşım.",
    });
  }
  if (commissionNet > 0) {
    lines.push({
      key: "commission",
      label: `Emlak komisyonu (%${commissionPct} + KDV %${vatPct})`,
      amount: round2(commissionNet + commissionVat),
      note: "Hizmet bedeli tavanı ve paylaşımı için komisyon tavanı denetimine bakın.",
    });
  }
  if (outstandingLoan > 0) {
    lines.push({
      key: "loan_payoff",
      label: "Kalan kredi / ipotek kapatma",
      amount: round2(outstandingLoan),
      note: "Bankadan alınacak kapatma tutarıyla netleştirin (erken kapama masrafı dahil değil).",
    });
  }

  // --- Değer artış kazancı ---
  const holdingLimit = legalValue("valueGainHoldingMonths");
  const withinTaxWindow = holdingMonths < holdingLimit;
  usedConstants.push("valueGainHoldingMonths");

  const idx = Number(input.ufeIncreasePct);
  const idxThreshold = legalValue("valueGainIndexThresholdPct");
  const indexing = Number.isFinite(idx) && idx > idxThreshold;
  if (indexing) usedConstants.push("valueGainIndexThresholdPct");
  const indexedAcquisitionCost = round2(indexing ? acquisitionPrice * (1 + idx / 100) : acquisitionPrice);

  const saleExpenses = round2(deedFee + commissionNet);
  const rawGain = salePrice - indexedAcquisitionCost - acquisitionExpenses - saleExpenses;
  const gain = rawGain > 0 ? round2(rawGain) : 0;

  let exemptionApplied = 0;
  let taxableGain = 0;
  let incomeTax = 0;

  if (withinTaxWindow) {
    usedConstants.push("valueGainExemptionTry");
    usedTables.push("income_tax");
    const exemptionLeft = Math.max(0, legalValue("valueGainExemptionTry") - exemptionUsed);
    exemptionApplied = round2(Math.min(gain, exemptionLeft));
    taxableGain = round2(gain - exemptionApplied);
    incomeTax = round2(progressiveTax(otherIncome + taxableGain, INCOME_TAX_BRACKETS) - progressiveTax(otherIncome, INCOME_TAX_BRACKETS));
    if (acquisitionPrice === 0) {
      warnings.push("Alış bedeli girilmedi: kazanç satış bedelinin tamamı sayıldı; vergi gerçekte çok daha düşük olabilir.");
    }
    if (incomeTax > 0) {
      lines.push({
        key: "income_tax",
        label: "Değer artış kazancı gelir vergisi (tahmini)",
        amount: incomeTax,
        note: `Edinmeden ${holdingMonths} ay geçmiş (5 yıl = ${holdingLimit} ay dolmadı). Kazanç ${gain.toLocaleString("tr-TR")} ₺, istisna ${exemptionApplied.toLocaleString("tr-TR")} ₺.`,
      });
    } else if (gain === 0) {
      notes.push("Hesaplanan değer artışı yok (satış bedeli maliyetin altında): vergi çıkmadı.");
    } else {
      notes.push("Kazanç yıllık istisna tutarı içinde kaldı: vergi çıkmadı.");
    }
    notes.push("Satıcının vergi durumu kişiye özeldir; diğer gelirler, miras/bağış ve önceki istisna kullanımı sonucu değiştirir.");
  } else {
    notes.push("Edinmeden 5 yıl (60 ay) geçtiği varsayımıyla değer artış kazancı vergisi hesaplanmadı.");
  }

  // --- DKV: yalnız bilgi ---
  const dkvBase = pos(input.propertyTaxValue) || salePrice;
  const dkvThreshold = legalValue("dkvThresholdTry");
  const dkvWarning = dkvBase >= dkvThreshold;
  if (dkvWarning) {
    usedConstants.push("dkvThresholdTry");
    usedTables.push("dkv");
    warnings.push(
      `Değer, değerli konut vergisi eşiğine (${dkvThreshold.toLocaleString("tr-TR")} ₺) ulaşıyor olabilir. Bu yalnız bilgi uyarısıdır; vergi hesabı yapılmadı, matrah emlak vergisi değeridir.`,
    );
  }

  const netBeforeTax = round2(salePrice - deedFee - commissionNet - commissionVat - outstandingLoan);
  const netProceeds = round2(netBeforeTax - incomeTax);

  if (salePrice === 0) warnings.push("Satış bedeli girilmedi.");
  if (netProceeds < 0) warnings.push("Net tutar negatif görünüyor: kredi kapatma ve masraflar satış bedelini aşıyor.");

  return {
    estimate: true,
    salePrice,
    deedFee,
    commissionNet,
    commissionVat,
    outstandingLoan: round2(outstandingLoan),
    withinTaxWindow,
    indexedAcquisitionCost,
    gain,
    exemptionApplied,
    taxableGain,
    incomeTax,
    netProceeds,
    netBeforeTax,
    lines,
    notes,
    warnings,
    usedConstants: Array.from(new Set(usedConstants)),
    usedTables,
    dkvWarning,
  };
}
